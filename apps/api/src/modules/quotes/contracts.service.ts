import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  ContractDto,
  ContractListQuery,
  ContractStatus,
  CreateContractRequest,
  Page,
  UpdateContractRequest,
} from '@ishan/contracts';
import { normalizeText } from '@ishan/contracts';
import type { AuthUser } from '../../common/decorators';
import { ownerWhere } from '../../common/access-scope';
import { PrismaService } from '../../infra/prisma.service';
import { AuditService } from '../audit/audit.service';
import {
  contractInclude,
  contractNumber,
  dateOnly,
  quoteNumber,
  tehranToday,
  toContractDto,
} from './mappers';
import { nextSequence } from './quotes.service';

const isUniqueViolation = (e: unknown) =>
  typeof e === 'object' && e !== null && (e as { code?: string }).code === 'P2002';

@Injectable()
export class ContractsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** A contract belongs to whoever owns its quote. */
  private scope(actor: AuthUser) {
    return actor.scopeUserIds === null ? {} : { quote: { is: ownerWhere(actor) } };
  }

  async list(actor: AuthUser, q: ContractListQuery): Promise<Page<ContractDto>> {
    const term = q.q ? normalizeText(q.q) : '';
    const rows = await this.prisma.contract.findMany({
      where: {
        organizationId: actor.organizationId,
        deletedAt: null,
        ...this.scope(actor),
        ...(q.status ? { status: q.status } : {}),
        ...(q.customerId ? { customerId: q.customerId } : {}),
        ...(term ? { searchText: { contains: term } } : {}),
        ...(q.cursor ? { id: { lt: q.cursor } } : {}),
      },
      include: contractInclude,
      orderBy: { id: 'desc' },
      take: q.limit + 1,
    });
    const items = rows.slice(0, q.limit).map(toContractDto);
    return { items, nextCursor: rows.length > q.limit ? (items.at(-1)?.id ?? null) : null };
  }

  async get(actor: AuthUser, id: string): Promise<ContractDto> {
    const c = await this.prisma.contract.findFirst({
      where: { id, organizationId: actor.organizationId, deletedAt: null, ...this.scope(actor) },
      include: contractInclude,
    });
    if (!c) throw new NotFoundException('قرارداد یافت نشد');
    return toContractDto(c);
  }

  async create(actor: AuthUser, dto: CreateContractRequest, ip?: string): Promise<ContractDto> {
    const quote = await this.prisma.quote.findFirst({
      where: {
        id: dto.quoteId,
        organizationId: actor.organizationId,
        deletedAt: null,
        ...ownerWhere(actor),
      },
      include: { customer: { select: { name: true, deletedAt: true } } },
    });
    if (!quote)
      throw new BadRequestException({ code: 'INVALID_QUOTE', message: 'پیش‌فاکتور نامعتبر است' });
    if (quote.status !== 'ACCEPTED') {
      throw new ConflictException({
        code: 'QUOTE_NOT_ACCEPTED',
        message: 'قرارداد فقط از پیش‌فاکتور پذیرفته‌شده ساخته می‌شود',
      });
    }
    const title = dto.title ?? quote.title;
    const startDate = dto.startDate ?? tehranToday();
    if (dto.endDate && dto.endDate < startDate) {
      throw new BadRequestException({
        code: 'INVALID_DATES',
        message: 'پایان قرارداد نمی‌تواند پیش از شروع باشد',
      });
    }
    try {
      const created = await this.prisma.$transaction(async (tx) => {
        const seq = await nextSequence(tx, actor.organizationId, 'contract');
        return tx.contract.create({
          data: {
            organizationId: actor.organizationId,
            seq,
            title,
            customerId: quote.customerId,
            quoteId: quote.id,
            amount: quote.total,
            startDate: dateOnly(startDate),
            endDate: dto.endDate ? dateOnly(dto.endDate) : null,
            terms: dto.terms ?? quote.terms ?? null,
            searchText: normalizeText(
              `${contractNumber(seq)} ${quoteNumber(quote.seq)} ${title} ${quote.customer.name}`,
            ),
            createdById: actor.id,
          },
        });
      });
      await this.audit.record({
        organizationId: actor.organizationId,
        actorId: actor.id,
        action: 'contract.created',
        entityType: 'contract',
        entityId: created.id,
        metadata: { number: contractNumber(created.seq), quote: quoteNumber(quote.seq) },
        ip,
      });
      return this.get(actor, created.id);
    } catch (e) {
      if (isUniqueViolation(e)) {
        throw new ConflictException({
          code: 'CONTRACT_EXISTS',
          message: 'برای این پیش‌فاکتور قبلاً قرارداد ساخته شده است',
        });
      }
      throw e;
    }
  }

  async update(actor: AuthUser, id: string, dto: UpdateContractRequest, ip?: string) {
    const c = await this.prisma.contract.findFirst({
      where: { id, organizationId: actor.organizationId, deletedAt: null, ...this.scope(actor) },
    });
    if (!c) throw new NotFoundException('قرارداد یافت نشد');
    if (c.status === 'COMPLETED' || c.status === 'TERMINATED') {
      throw new ConflictException({
        code: 'CONTRACT_CLOSED',
        message: 'قرارداد بسته‌شده ویرایش نمی‌شود',
      });
    }
    const start = dto.startDate ?? c.startDate.toISOString().slice(0, 10);
    const end =
      dto.endDate === undefined ? (c.endDate?.toISOString().slice(0, 10) ?? null) : dto.endDate;
    if (end && end < start) {
      throw new BadRequestException({
        code: 'INVALID_DATES',
        message: 'پایان قرارداد نمی‌تواند پیش از شروع باشد',
      });
    }
    await this.prisma.contract.update({
      where: { id },
      data: {
        title: dto.title,
        startDate: dto.startDate ? dateOnly(dto.startDate) : undefined,
        endDate: dto.endDate === undefined ? undefined : dto.endDate ? dateOnly(dto.endDate) : null,
        terms: dto.terms === undefined ? undefined : dto.terms || null,
      },
    });
    await this.audit.record({
      organizationId: actor.organizationId,
      actorId: actor.id,
      action: 'contract.updated',
      entityType: 'contract',
      entityId: id,
      ip,
    });
    return this.get(actor, id);
  }

  private static readonly FLOW: Record<
    'activate' | 'complete' | 'terminate',
    {
      from: ContractStatus[];
      to: ContractStatus;
    }
  > = {
    activate: { from: ['DRAFT'], to: 'ACTIVE' },
    complete: { from: ['ACTIVE'], to: 'COMPLETED' },
    terminate: { from: ['DRAFT', 'ACTIVE'], to: 'TERMINATED' },
  };

  async transition(
    actor: AuthUser,
    id: string,
    action: 'activate' | 'complete' | 'terminate',
    ip?: string,
  ) {
    const c = await this.prisma.contract.findFirst({
      where: { id, organizationId: actor.organizationId, deletedAt: null, ...this.scope(actor) },
    });
    if (!c) throw new NotFoundException('قرارداد یافت نشد');
    const rule = ContractsService.FLOW[action];
    if (!rule.from.includes(c.status)) {
      throw new ConflictException({
        code: 'INVALID_TRANSITION',
        message: 'این تغییر وضعیت برای قرارداد مجاز نیست',
      });
    }
    const now = new Date();
    // Compare-and-set on the old status so concurrent transitions cannot both win.
    const { count } = await this.prisma.contract.updateMany({
      where: { id, status: c.status },
      data: {
        status: rule.to,
        ...(rule.to === 'ACTIVE' ? { signedAt: now } : { closedAt: now }),
      },
    });
    if (count !== 1) {
      throw new ConflictException({ code: 'CONFLICT', message: 'قرارداد هم‌زمان تغییر کرد' });
    }
    await this.audit.record({
      organizationId: actor.organizationId,
      actorId: actor.id,
      action: `contract.${rule.to.toLowerCase()}`,
      entityType: 'contract',
      entityId: id,
      metadata: { number: contractNumber(c.seq) },
      ip,
    });
    return this.get(actor, id);
  }
}
