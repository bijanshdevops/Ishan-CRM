import {
  ConflictException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  CAMPAIGN_MAX_RECIPIENTS,
  CAMPAIGN_RECIPIENT_STATUSES,
  CAMPAIGN_TEST_PER_HOUR,
  CampaignAudienceSchema,
  renderCampaignText,
  type CampaignPreviewDto,
  type CampaignRecipientStatus,
  type CampaignSendingDto,
  type CampaignSendingState,
  type CreateSuppression,
  type SaveCampaignSending,
  type StartCampaignSending,
  type SuppressionDto,
} from '@ishan/contracts';
import { z } from 'zod';
import type { AuthUser } from '../../common/decorators';
import { ownerWhere } from '../../common/access-scope';
import { RateLimiter } from '../../common/rate-limiter';
import { APP_CONFIG, type AppConfig } from '../../config';
import { PrismaService } from '../../infra/prisma.service';
import { QueueService } from '../../infra/queue/queue.service';
import { publishCampaignEmails } from '../../jobs/campaign-emails';
import { AuditService } from '../audit/audit.service';
import { MailerService } from '../notifications/mailer.service';
import { buildCampaignEmail } from './campaign-message';
import { signUnsubscribe, verifyUnsubscribe } from './unsubscribe-token';

const HOUR_MS = 60 * 60 * 1000;
const CUSTOMER_SCAN_CAP = 20_000;
const SUPPRESSION_CHUNK = 1000;
const emailCheck = z.string().email().max(254);

interface Candidate {
  email: string;
  name: string;
  customerId: string;
}

const unavailable = () =>
  new UnprocessableEntityException({
    code: 'email_channel_unavailable',
    message: 'ارسال ایمیل در این سامانه پیکربندی نشده است.',
  });

@Injectable()
export class CampaignSendingService {
  private readonly testLimiter = new RateLimiter(CAMPAIGN_TEST_PER_HOUR, HOUR_MS);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mailer: MailerService,
    private readonly audit: AuditService,
    private readonly queues: QueueService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  private async campaign(actor: AuthUser, id: string) {
    const c = await this.prisma.campaign.findFirst({
      where: { id, organizationId: actor.organizationId, deletedAt: null, ...ownerWhere(actor) },
      select: { id: true, status: true, name: true },
    });
    if (!c) throw new NotFoundException({ code: 'not_found', message: 'کمپین پیدا نشد.' });
    return c;
  }

  private async toDto(row: {
    id: string;
    campaignId: string;
    subject: string;
    body: string;
    audience: unknown;
    status: string;
    startedAt: Date | null;
    finishedAt: Date | null;
  }): Promise<CampaignSendingDto> {
    const grouped = await this.prisma.campaignRecipient.groupBy({
      by: ['status'],
      where: { sendingId: row.id },
      _count: { _all: true },
    });
    const counts = Object.fromEntries(CAMPAIGN_RECIPIENT_STATUSES.map((s) => [s, 0])) as Record<
      CampaignRecipientStatus,
      number
    >;
    for (const g of grouped) counts[g.status as CampaignRecipientStatus] = g._count._all;
    return {
      id: row.id,
      campaignId: row.campaignId,
      subject: row.subject,
      body: row.body,
      audience: CampaignAudienceSchema.parse(row.audience),
      status: row.status as CampaignSendingDto['status'],
      startedAt: row.startedAt?.toISOString() ?? null,
      finishedAt: row.finishedAt?.toISOString() ?? null,
      counts,
    };
  }

  async get(actor: AuthUser, campaignId: string): Promise<CampaignSendingState> {
    await this.campaign(actor, campaignId);
    const row = await this.prisma.campaignSending.findUnique({ where: { campaignId } });
    return {
      emailAvailable: this.mailer.available,
      sending: row ? await this.toDto(row) : null,
    };
  }

  async save(
    actor: AuthUser,
    campaignId: string,
    input: SaveCampaignSending,
  ): Promise<CampaignSendingDto> {
    if (!this.mailer.available) throw unavailable();
    await this.campaign(actor, campaignId);
    if (input.audience.tagIds.length > 0) {
      const found = await this.prisma.tag.count({
        where: { organizationId: actor.organizationId, id: { in: input.audience.tagIds } },
      });
      if (found !== new Set(input.audience.tagIds).size) {
        throw new UnprocessableEntityException({
          code: 'unknown_tag',
          message: 'یکی از برچسب‌های انتخاب‌شده وجود ندارد.',
        });
      }
    }
    const existing = await this.prisma.campaignSending.findUnique({ where: { campaignId } });
    if (existing && existing.status !== 'DRAFT') {
      throw new ConflictException({
        code: 'sending_locked',
        message: 'این کمپین قبلاً ارسال شده و دیگر قابل ویرایش نیست.',
      });
    }
    const data = {
      subject: input.subject,
      body: input.body,
      audience: input.audience as never,
    };
    const row = existing
      ? await this.prisma.campaignSending.update({ where: { campaignId }, data })
      : await this.prisma.campaignSending.create({
          data: { ...data, campaignId, organizationId: actor.organizationId },
        });
    return this.toDto(row);
  }

  /** Everyone the audience reaches, minus suppressed addresses. Throws when it is over the limit. */
  async resolveAudience(
    actor: Pick<AuthUser, 'organizationId' | 'scopeUserIds'>,
    audienceJson: unknown,
  ): Promise<{ recipients: Candidate[]; suppressed: number }> {
    const audience = CampaignAudienceSchema.parse(audienceJson);
    const customers = await this.prisma.customer.findMany({
      where: {
        organizationId: actor.organizationId,
        deletedAt: null,
        // A restricted user can only mail customers they are allowed to see.
        ...ownerWhere(actor),
        ...(audience.kind ? { kind: audience.kind } : {}),
        ...(audience.tagIds.length > 0
          ? { tags: { some: { tagId: { in: audience.tagIds } } } }
          : {}),
      },
      orderBy: { id: 'asc' },
      take: CUSTOMER_SCAN_CAP + 1,
      select: {
        id: true,
        name: true,
        email: true,
        contacts: {
          where: { deletedAt: null, isPrimary: true },
          select: { firstName: true, lastName: true, email: true },
        },
      },
    });
    if (customers.length > CUSTOMER_SCAN_CAP) throw this.tooMany();
    const byEmail = new Map<string, Candidate>();
    const add = (raw: string | null, name: string, customerId: string) => {
      const email = raw?.trim().toLowerCase();
      if (!email || !emailCheck.safeParse(email).success || byEmail.has(email)) return;
      byEmail.set(email, { email, name, customerId });
    };
    for (const c of customers) {
      add(c.email, c.name, c.id);
      for (const k of c.contacts) {
        add(k.email, `${k.firstName} ${k.lastName}`.trim() || c.name, c.id);
      }
    }
    const all = [...byEmail.values()];
    const blocked = new Set<string>();
    for (let i = 0; i < all.length; i += SUPPRESSION_CHUNK) {
      const rows = await this.prisma.marketingSuppression.findMany({
        where: {
          organizationId: actor.organizationId,
          email: { in: all.slice(i, i + SUPPRESSION_CHUNK).map((c) => c.email) },
        },
        select: { email: true },
      });
      for (const r of rows) blocked.add(r.email);
    }
    const recipients = all.filter((c) => !blocked.has(c.email));
    if (recipients.length > CAMPAIGN_MAX_RECIPIENTS) throw this.tooMany();
    return { recipients, suppressed: all.length - recipients.length };
  }

  private tooMany() {
    return new UnprocessableEntityException({
      code: 'too_many_recipients',
      message: `هر کمپین حداکثر ${CAMPAIGN_MAX_RECIPIENTS} گیرنده دارد. مخاطبان را با برچسب محدود کنید.`,
    });
  }

  private async draft(actor: AuthUser, campaignId: string) {
    await this.campaign(actor, campaignId);
    const row = await this.prisma.campaignSending.findUnique({ where: { campaignId } });
    if (!row) {
      throw new ConflictException({
        code: 'no_draft',
        message: 'ابتدا متن ایمیل را ذخیره کنید.',
      });
    }
    return row;
  }

  async preview(actor: AuthUser, campaignId: string): Promise<CampaignPreviewDto> {
    if (!this.mailer.available) throw unavailable();
    const row = await this.draft(actor, campaignId);
    const { recipients, suppressed } = await this.resolveAudience(actor, row.audience);
    const name = recipients[0]?.name ?? 'مشتری گرامی';
    return {
      recipients: recipients.length,
      suppressed,
      sample: {
        subject: renderCampaignText(row.subject, name),
        text: renderCampaignText(row.body, name),
      },
    };
  }

  /** Sends the saved draft to the caller's own verified address, without an unsubscribe link. */
  async test(actor: AuthUser, campaignId: string): Promise<{ sent: true }> {
    if (!this.mailer.available) throw unavailable();
    const row = await this.draft(actor, campaignId);
    const me = await this.prisma.user.findUniqueOrThrow({
      where: { id: actor.id },
      select: { email: true, name: true, emailVerifiedAt: true },
    });
    if (!me.emailVerifiedAt) {
      throw new UnprocessableEntityException({
        code: 'email_not_verified',
        message: 'ابتدا نشانی ایمیل خود را در «حساب من» تأیید کنید.',
      });
    }
    if (!this.testLimiter.allow(actor.id)) {
      throw new HttpException(
        { code: 'rate_limited', message: 'تعداد ایمیل آزمایشی در ساعت گذشته به سقف رسیده است.' },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    const built = buildCampaignEmail({
      subject: row.subject,
      body: row.body,
      name: me.name,
      unsubscribeUrl: null,
    });
    try {
      await this.mailer.send({
        to: me.email,
        subject: `[آزمایشی] ${built.subject}`,
        text: built.text,
        html: built.html,
        headers: { 'Auto-Submitted': 'auto-generated' },
      });
    } catch {
      throw new ServiceUnavailableException({
        code: 'email_send_failed',
        message: 'ارسال ایمیل آزمایشی ناموفق بود. تنظیمات SMTP سرور را بررسی کنید.',
      });
    }
    return { sent: true };
  }

  async start(
    actor: AuthUser,
    campaignId: string,
    input: StartCampaignSending,
    ip?: string,
  ): Promise<CampaignSendingDto> {
    if (!this.mailer.available) throw unavailable();
    const campaign = await this.campaign(actor, campaignId);
    if (campaign.status === 'CANCELED' || campaign.status === 'COMPLETED') {
      throw new ConflictException({
        code: 'campaign_closed',
        message: 'این کمپین بسته شده و ارسال ندارد.',
      });
    }
    const now = new Date();
    const result = await this.prisma.$transaction(async (tx) => {
      // The conditional update is the gate: only one start can move DRAFT to SENDING.
      const moved = await tx.campaignSending.updateMany({
        where: { campaignId, organizationId: actor.organizationId, status: 'DRAFT' },
        data: { status: 'SENDING', startedAt: now, startedById: actor.id },
      });
      if (moved.count === 0) {
        throw new ConflictException({
          code: 'sending_not_draft',
          message: 'ارسال این کمپین قبلاً شروع شده یا پیش‌نویسی ذخیره نشده است.',
        });
      }
      const row = await tx.campaignSending.findUniqueOrThrow({ where: { campaignId } });
      const { recipients } = await this.resolveAudience(actor, row.audience);
      if (recipients.length !== input.expectedRecipients) {
        throw new ConflictException({
          code: 'recipients_changed',
          message: `شمار گیرندگان اکنون ${recipients.length} است، نه ${input.expectedRecipients}. پیش‌نمایش را دوباره ببینید.`,
        });
      }
      await tx.campaignRecipient.createMany({
        data: recipients.map((r) => ({
          sendingId: row.id,
          campaignId,
          organizationId: actor.organizationId,
          customerId: r.customerId,
          email: r.email,
          name: r.name,
          nextAttemptAt: now,
        })),
      });
      await tx.campaign.update({ where: { id: campaignId }, data: { status: 'ACTIVE' } });
      return { row, count: recipients.length };
    });
    await this.audit.record({
      organizationId: actor.organizationId,
      actorId: actor.id,
      action: 'campaign.send_started',
      entityType: 'campaign',
      entityId: campaignId,
      metadata: { recipients: result.count },
      ip,
    });
    // Best effort: the minutely sweeper queues whatever this misses.
    const ids = await this.prisma.campaignRecipient.findMany({
      where: { sendingId: result.row.id },
      select: { id: true },
      take: CAMPAIGN_MAX_RECIPIENTS,
    });
    await publishCampaignEmails(
      this.queues,
      ids.map((i) => ({ id: i.id, attempt: 0 })),
    ).catch(() => undefined);
    return this.toDto(
      await this.prisma.campaignSending.findUniqueOrThrow({ where: { campaignId } }),
    );
  }

  async cancel(actor: AuthUser, campaignId: string, ip?: string): Promise<CampaignSendingDto> {
    await this.campaign(actor, campaignId);
    const now = new Date();
    const skipped = await this.prisma.$transaction(async (tx) => {
      const moved = await tx.campaignSending.updateMany({
        where: { campaignId, organizationId: actor.organizationId, status: 'SENDING' },
        data: { status: 'CANCELED', finishedAt: now },
      });
      if (moved.count === 0) {
        throw new ConflictException({
          code: 'sending_not_active',
          message: 'ارسالی در جریان نیست که لغو شود.',
        });
      }
      const row = await tx.campaignSending.findUniqueOrThrow({ where: { campaignId } });
      const res = await tx.campaignRecipient.updateMany({
        where: { sendingId: row.id, status: 'PENDING' },
        data: { status: 'SKIPPED', nextAttemptAt: null, lastError: 'canceled' },
      });
      return res.count;
    });
    await this.audit.record({
      organizationId: actor.organizationId,
      actorId: actor.id,
      action: 'campaign.send_canceled',
      entityType: 'campaign',
      entityId: campaignId,
      metadata: { skipped },
      ip,
    });
    return this.toDto(
      await this.prisma.campaignSending.findUniqueOrThrow({ where: { campaignId } }),
    );
  }

  // --- suppression list ----------------------------------------------------------------------
  async listSuppressions(actor: AuthUser): Promise<SuppressionDto[]> {
    const rows = await this.prisma.marketingSuppression.findMany({
      where: { organizationId: actor.organizationId },
      orderBy: { id: 'desc' },
      take: 500,
    });
    return rows.map((r) => ({
      id: r.id,
      email: r.email,
      reason: r.reason as SuppressionDto['reason'],
      createdAt: r.createdAt.toISOString(),
    }));
  }

  async addSuppression(
    actor: AuthUser,
    input: CreateSuppression,
    ip?: string,
  ): Promise<SuppressionDto> {
    const row = await this.prisma.marketingSuppression.upsert({
      where: {
        organizationId_email: { organizationId: actor.organizationId, email: input.email },
      },
      create: {
        organizationId: actor.organizationId,
        email: input.email,
        reason: 'MANUAL',
        createdById: actor.id,
      },
      update: {},
    });
    await this.audit.record({
      organizationId: actor.organizationId,
      actorId: actor.id,
      action: 'marketing.suppression_added',
      entityType: 'suppression',
      entityId: row.id,
      ip,
    });
    return {
      id: row.id,
      email: row.email,
      reason: row.reason as SuppressionDto['reason'],
      createdAt: row.createdAt.toISOString(),
    };
  }

  async removeSuppression(actor: AuthUser, id: string, ip?: string): Promise<void> {
    const gone = await this.prisma.marketingSuppression.deleteMany({
      where: { id, organizationId: actor.organizationId },
    });
    if (gone.count === 0) {
      throw new NotFoundException({ code: 'not_found', message: 'نشانی در فهرست پیدا نشد.' });
    }
    await this.audit.record({
      organizationId: actor.organizationId,
      actorId: actor.id,
      action: 'marketing.suppression_removed',
      entityType: 'suppression',
      entityId: id,
      ip,
    });
  }

  /** Public: the signed token is the credential. Idempotent. */
  async unsubscribe(token: string, ip?: string): Promise<{ unsubscribed: true }> {
    const v = verifyUnsubscribe(this.config.ENCRYPTION_KEY, token);
    if (!v) {
      throw new HttpException(
        { code: 'invalid_token', message: 'پیوند لغو اشتراک نامعتبر است.' },
        HttpStatus.BAD_REQUEST,
      );
    }
    const where = { organizationId: v.organizationId, email: v.email };
    // createMany + skipDuplicates tells us atomically whether this call added the row.
    const { count } = await this.prisma.marketingSuppression.createMany({
      data: [{ ...where, reason: 'UNSUBSCRIBED' }],
      skipDuplicates: true,
    });
    // Audit only the first time (a repeat click or a prefetch adds nothing).
    if (count === 1) {
      const row = await this.prisma.marketingSuppression.findFirstOrThrow({
        where,
        select: { id: true },
      });
      await this.audit.record({
        organizationId: v.organizationId,
        actorId: null,
        action: 'marketing.unsubscribed',
        entityType: 'suppression',
        entityId: row.id,
        ip,
      });
    }
    return { unsubscribed: true };
  }

  /** Used by tests and the worker-side link builder. */
  token(organizationId: string, email: string): string {
    return signUnsubscribe(this.config.ENCRYPTION_KEY, organizationId, email);
  }
}
