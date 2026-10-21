import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  WEBHOOK_MAX_ENDPOINTS,
  WEBHOOK_SECRET_GRACE_HOURS,
  WEBHOOK_TEST_EVENT_TYPE,
  buildWebhookEnvelope,
  webhookCatalog,
  type CreateWebhookRequest,
  type Page,
  type UpdateWebhookRequest,
  type WebhookCatalogDto,
  type WebhookDeliveryDto,
  type WebhookDeliveryListQuery,
  type WebhookDeliveryStatus,
  type WebhookDisabledReason,
  type WebhookDto,
  type WebhookWithSecretDto,
  type DomainEventType,
} from '@ishan/contracts';
import { assertIfMatch, hasPrecondition, staleEntity, unchangedSince } from '../../common/etag';
import type { AuthUser } from '../../common/decorators';
import { APP_CONFIG, type AppConfig } from '../../config';
import { PrismaService } from '../../infra/prisma.service';
import { QueueService } from '../../infra/queue/queue.service';
import { publishDeliveries } from '../../jobs/webhooks';
import { AuditService } from '../audit/audit.service';
import { CryptoService } from '../auth/crypto.service';
import { generateWebhookSecret, secretHint } from './signing';
import { resolveSafeTarget, UnsafeTargetError, type GuardOptions } from './url-guard';

interface EndpointRow {
  id: string;
  name: string;
  url: string;
  eventTypes: string[];
  enabled: boolean;
  disabledReason: string | null;
  consecutiveFailures: number;
  secretHint: string;
  previousSecretExpiresAt: Date | null;
  createdById: string;
  createdAt: Date;
  updatedAt: Date;
}

/** Never includes the secret or its ciphertext. */
export const toWebhookDto = (w: EndpointRow, now = new Date()): WebhookDto => ({
  id: w.id,
  name: w.name,
  url: w.url,
  eventTypes: w.eventTypes as DomainEventType[],
  enabled: w.enabled,
  disabledReason: w.disabledReason as WebhookDisabledReason | null,
  consecutiveFailures: w.consecutiveFailures,
  secretHint: w.secretHint,
  previousSecretExpiresAt:
    w.previousSecretExpiresAt && w.previousSecretExpiresAt > now
      ? w.previousSecretExpiresAt.toISOString()
      : null,
  createdById: w.createdById,
  createdAt: w.createdAt.toISOString(),
  updatedAt: w.updatedAt.toISOString(),
});

interface DeliveryRow {
  id: string;
  endpointId: string;
  eventId: string | null;
  eventType: string;
  status: string;
  attempt: number;
  nextAttemptAt: Date | null;
  lastStatusCode: number | null;
  lastError: string | null;
  responseSnippet: string | null;
  durationMs: number | null;
  createdAt: Date;
  deliveredAt: Date | null;
}

export const toDeliveryDto = (d: DeliveryRow): WebhookDeliveryDto => ({
  id: d.id,
  endpointId: d.endpointId,
  eventId: d.eventId,
  eventType: d.eventType,
  status: d.status as WebhookDeliveryStatus,
  attempt: d.attempt,
  nextAttemptAt: d.nextAttemptAt?.toISOString() ?? null,
  lastStatusCode: d.lastStatusCode,
  lastError: d.lastError,
  responseSnippet: d.responseSnippet,
  durationMs: d.durationMs,
  createdAt: d.createdAt.toISOString(),
  deliveredAt: d.deliveredAt?.toISOString() ?? null,
});

const DELIVERY_SELECT = {
  id: true,
  endpointId: true,
  eventId: true,
  eventType: true,
  status: true,
  attempt: true,
  nextAttemptAt: true,
  lastStatusCode: true,
  lastError: true,
  responseSnippet: true,
  durationMs: true,
  createdAt: true,
  deliveredAt: true,
} as const;

@Injectable()
export class WebhooksService {
  private readonly log = new Logger(WebhooksService.name);
  private readonly guard: GuardOptions;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly crypto: CryptoService,
    private readonly queues: QueueService,
    @Inject(APP_CONFIG) config: AppConfig,
  ) {
    this.guard = { allowLocal: config.WEBHOOK_ALLOW_INSECURE && config.NODE_ENV !== 'production' };
  }

  catalog(): WebhookCatalogDto {
    return webhookCatalog();
  }

  private async assertUrlAllowed(url: string) {
    try {
      await resolveSafeTarget(url, this.guard);
    } catch (err) {
      if (err instanceof UnsafeTargetError) {
        throw new BadRequestException({ code: 'UNSAFE_WEBHOOK_URL', message: err.message });
      }
      throw err;
    }
  }

  async list(actor: AuthUser, q: { limit: number; cursor?: string }): Promise<Page<WebhookDto>> {
    const rows = await this.prisma.webhookEndpoint.findMany({
      where: {
        organizationId: actor.organizationId,
        deletedAt: null,
        ...(q.cursor ? { id: { lt: q.cursor } } : {}),
      },
      orderBy: { id: 'desc' },
      take: q.limit + 1,
    });
    const items = rows.slice(0, q.limit).map((r) => toWebhookDto(r));
    return { items, nextCursor: rows.length > q.limit ? (items.at(-1)?.id ?? null) : null };
  }

  private async load(actor: AuthUser, id: string) {
    const w = await this.prisma.webhookEndpoint.findFirst({
      where: { id, organizationId: actor.organizationId, deletedAt: null },
    });
    if (!w) throw new NotFoundException('وب‌هوک یافت نشد');
    return w;
  }

  async get(actor: AuthUser, id: string): Promise<WebhookDto> {
    return toWebhookDto(await this.load(actor, id));
  }

  private async assertRoomForEnabled(actor: AuthUser) {
    const active = await this.prisma.webhookEndpoint.count({
      where: { organizationId: actor.organizationId, deletedAt: null, enabled: true },
    });
    if (active >= WEBHOOK_MAX_ENDPOINTS) {
      throw new ConflictException({
        code: 'TOO_MANY_WEBHOOKS',
        message: `حداکثر ${WEBHOOK_MAX_ENDPOINTS} وب‌هوک فعال مجاز است`,
      });
    }
  }

  async create(
    actor: AuthUser,
    dto: CreateWebhookRequest,
    ip?: string,
  ): Promise<WebhookWithSecretDto> {
    await this.assertUrlAllowed(dto.url);
    await this.assertRoomForEnabled(actor);
    const secret = generateWebhookSecret();
    const w = await this.prisma.webhookEndpoint.create({
      data: {
        organizationId: actor.organizationId,
        name: dto.name,
        url: dto.url,
        eventTypes: dto.eventTypes,
        enabled: true,
        secretCiphertext: this.crypto.encrypt(secret),
        secretHint: secretHint(secret),
        createdById: actor.id,
      },
    });
    await this.audit.record({
      organizationId: actor.organizationId,
      actorId: actor.id,
      action: 'webhook.created',
      entityType: 'webhook',
      entityId: w.id,
      metadata: { name: w.name, eventTypes: w.eventTypes },
      ip,
    });
    return { ...toWebhookDto(w), secret };
  }

  async update(
    actor: AuthUser,
    id: string,
    dto: UpdateWebhookRequest,
    ifMatch?: string,
    ip?: string,
  ): Promise<WebhookDto> {
    const cur = await this.load(actor, id);
    assertIfMatch(ifMatch, cur.updatedAt);
    if (dto.url !== undefined && dto.url !== cur.url) await this.assertUrlAllowed(dto.url);
    const clean = Object.fromEntries(
      Object.entries({ name: dto.name, url: dto.url, eventTypes: dto.eventTypes }).filter(
        ([, v]) => v !== undefined,
      ),
    );
    const written = await this.prisma.webhookEndpoint.updateMany({
      where: {
        id,
        organizationId: actor.organizationId,
        deletedAt: null,
        ...(hasPrecondition(ifMatch) ? unchangedSince(cur.updatedAt) : {}),
      },
      data: clean,
    });
    if (written.count === 0) {
      throw hasPrecondition(ifMatch) ? staleEntity() : new NotFoundException('وب‌هوک یافت نشد');
    }
    await this.audit.record({
      organizationId: actor.organizationId,
      actorId: actor.id,
      action: 'webhook.updated',
      entityType: 'webhook',
      entityId: id,
      metadata: { fields: Object.keys(clean) },
      ip,
    });
    return this.get(actor, id);
  }

  async setEnabled(
    actor: AuthUser,
    id: string,
    enabled: boolean,
    ip?: string,
  ): Promise<WebhookDto> {
    const cur = await this.load(actor, id);
    if (cur.enabled === enabled) return toWebhookDto(cur);
    if (enabled) {
      await this.assertRoomForEnabled(actor);
      await this.assertUrlAllowed(cur.url);
    }
    await this.prisma.webhookEndpoint.updateMany({
      where: { id, organizationId: actor.organizationId, deletedAt: null },
      data: enabled
        ? { enabled: true, disabledReason: null, consecutiveFailures: 0 }
        : { enabled: false, disabledReason: 'MANUAL' },
    });
    await this.audit.record({
      organizationId: actor.organizationId,
      actorId: actor.id,
      action: enabled ? 'webhook.enabled' : 'webhook.disabled',
      entityType: 'webhook',
      entityId: id,
      ip,
    });
    return this.get(actor, id);
  }

  async rotateSecret(actor: AuthUser, id: string, ip?: string): Promise<WebhookWithSecretDto> {
    const cur = await this.load(actor, id);
    const secret = generateWebhookSecret();
    await this.prisma.webhookEndpoint.updateMany({
      where: { id, organizationId: actor.organizationId, deletedAt: null },
      data: {
        secretCiphertext: this.crypto.encrypt(secret),
        secretHint: secretHint(secret),
        previousSecretCiphertext: cur.secretCiphertext,
        previousSecretExpiresAt: new Date(Date.now() + WEBHOOK_SECRET_GRACE_HOURS * 3_600_000),
      },
    });
    await this.audit.record({
      organizationId: actor.organizationId,
      actorId: actor.id,
      action: 'webhook.secret_rotated',
      entityType: 'webhook',
      entityId: id,
      ip,
    });
    return { ...(await this.get(actor, id)), secret };
  }

  async remove(actor: AuthUser, id: string, ip?: string): Promise<void> {
    await this.load(actor, id);
    await this.prisma.webhookEndpoint.updateMany({
      where: { id, organizationId: actor.organizationId, deletedAt: null },
      data: { deletedAt: new Date(), enabled: false },
    });
    await this.audit.record({
      organizationId: actor.organizationId,
      actorId: actor.id,
      action: 'webhook.deleted',
      entityType: 'webhook',
      entityId: id,
      ip,
    });
  }

  private async enqueue(id: string) {
    try {
      await publishDeliveries(this.queues, [{ id, attempt: 0 }]);
    } catch (err) {
      this.log.warn(`could not queue webhook delivery ${id}; the sweeper will: ${String(err)}`);
    }
  }

  /** Sends a single `webhook.test` event; pings are never retried and never count as failures. */
  async test(actor: AuthUser, id: string): Promise<WebhookDeliveryDto> {
    const ep = await this.load(actor, id);
    if (!ep.enabled) {
      throw new ConflictException({
        code: 'WEBHOOK_DISABLED',
        message: 'ابتدا وب‌هوک را روشن کنید',
      });
    }
    const envelope = buildWebhookEnvelope({
      id: randomUUID(),
      type: WEBHOOK_TEST_EVENT_TYPE,
      organizationId: ep.organizationId,
      entityType: 'webhook',
      entityId: ep.id,
      occurredAt: new Date(),
      payload: { message: 'Ishan CRM webhook test' },
    });
    const d = await this.prisma.webhookDelivery.create({
      data: {
        endpointId: ep.id,
        eventType: WEBHOOK_TEST_EVENT_TYPE,
        payload: envelope as never,
        nextAttemptAt: new Date(),
      },
      select: DELIVERY_SELECT,
    });
    await this.enqueue(d.id);
    return toDeliveryDto(d);
  }

  async deliveries(
    actor: AuthUser,
    id: string,
    q: WebhookDeliveryListQuery,
  ): Promise<Page<WebhookDeliveryDto>> {
    await this.load(actor, id);
    const rows = await this.prisma.webhookDelivery.findMany({
      where: {
        endpointId: id,
        ...(q.status ? { status: q.status } : {}),
        ...(q.cursor ? { id: { lt: q.cursor } } : {}),
      },
      orderBy: { id: 'desc' },
      take: q.limit + 1,
      select: DELIVERY_SELECT,
    });
    const items = rows.slice(0, q.limit).map(toDeliveryDto);
    return { items, nextCursor: rows.length > q.limit ? (items.at(-1)?.id ?? null) : null };
  }

  /** A fresh delivery with the same envelope (and a fresh attempt budget). */
  async redeliver(actor: AuthUser, deliveryId: string, ip?: string): Promise<WebhookDeliveryDto> {
    const old = await this.prisma.webhookDelivery.findFirst({
      where: {
        id: deliveryId,
        endpoint: { organizationId: actor.organizationId, deletedAt: null },
      },
      include: { endpoint: { select: { enabled: true } } },
    });
    if (!old) throw new NotFoundException('تحویل یافت نشد');
    if (!old.endpoint.enabled) {
      throw new ConflictException({
        code: 'WEBHOOK_DISABLED',
        message: 'ابتدا وب‌هوک را روشن کنید',
      });
    }
    // eventId stays empty: the (endpoint, event) pair of the original keeps its UNIQUE slot.
    const d = await this.prisma.webhookDelivery.create({
      data: {
        endpointId: old.endpointId,
        eventType: old.eventType,
        payload: old.payload as never,
        nextAttemptAt: new Date(),
      },
      select: DELIVERY_SELECT,
    });
    await this.audit.record({
      organizationId: actor.organizationId,
      actorId: actor.id,
      action: 'webhook.redelivered',
      entityType: 'webhook',
      entityId: old.endpointId,
      metadata: { from: deliveryId, to: d.id },
      ip,
    });
    await this.enqueue(d.id);
    return toDeliveryDto(d);
  }
}
