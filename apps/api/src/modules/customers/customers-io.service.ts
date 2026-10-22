import { BadRequestException, Injectable } from '@nestjs/common';
import {
  CreateCustomerRequestSchema,
  normalizeText,
  type CustomerListQuery,
  type ImportReport,
} from '@ishan/contracts';
import type { AuthUser } from '../../common/decorators';
import { PrismaService } from '../../infra/prisma.service';
import { AuditService } from '../audit/audit.service';
import { parseCsv, toCsv } from './csv';
import { CustomersService } from './customers.service';
import { customerSearchText } from './mappers';

export const CSV_COLUMNS = [
  'kind',
  'name',
  'nationalId',
  'economicCode',
  'email',
  'phone',
  'website',
  'province',
  'city',
  'address',
  'notes',
] as const;

const MAX_IMPORT_ROWS = 5000;
const MAX_EXPORT_ROWS = 50_000;

const HEADER_ALIASES: Record<string, (typeof CSV_COLUMNS)[number]> = {
  نوع: 'kind',
  نام: 'name',
  'کد ملی': 'nationalId',
  'شناسه ملی': 'nationalId',
  'کد اقتصادی': 'economicCode',
  ایمیل: 'email',
  تلفن: 'phone',
  وبسایت: 'website',
  استان: 'province',
  شهر: 'city',
  آدرس: 'address',
  یادداشت: 'notes',
};

const KIND_ALIASES: Record<string, 'PERSON' | 'ORGANIZATION'> = {
  person: 'PERSON',
  organization: 'ORGANIZATION',
  حقیقی: 'PERSON',
  حقوقی: 'ORGANIZATION',
};

@Injectable()
export class CustomersIoService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly customers: CustomersService,
  ) {}

  async export(actor: AuthUser, q: Omit<CustomerListQuery, 'limit' | 'cursor'>, ip?: string) {
    const rows = await this.prisma.customer.findMany({
      where: this.customers.buildWhere(actor, q),
      orderBy: { id: 'desc' },
      take: MAX_EXPORT_ROWS,
    });
    await this.audit.record({
      organizationId: actor.organizationId,
      actorId: actor.id,
      action: 'customer.exported',
      entityType: 'customer',
      metadata: { count: rows.length },
      ip,
    });
    return toCsv(
      [...CSV_COLUMNS],
      rows.map((r) => CSV_COLUMNS.map((c) => (c === 'kind' ? r.kind : r[c]))),
    );
  }

  async import(
    actor: AuthUser,
    dto: { csv: string; dryRun: boolean },
    ip?: string,
  ): Promise<ImportReport> {
    const table = parseCsv(dto.csv);
    if (table.length < 2) {
      throw new BadRequestException({ code: 'EMPTY_IMPORT', message: 'فایل خالی است' });
    }
    const [headerRow, ...dataRows] = table as [string[], ...string[][]];
    if (dataRows.length > MAX_IMPORT_ROWS) {
      throw new BadRequestException({
        code: 'IMPORT_TOO_LARGE',
        message: `حداکثر ${MAX_IMPORT_ROWS} ردیف در هر بار مجاز است`,
      });
    }
    const cols = headerRow.map((h) => {
      const key = h.trim();
      return (CSV_COLUMNS as readonly string[]).includes(key)
        ? (key as (typeof CSV_COLUMNS)[number])
        : (HEADER_ALIASES[normalizeText(key)] ?? HEADER_ALIASES[key]);
    });
    if (!cols.includes('name')) {
      throw new BadRequestException({
        code: 'MISSING_NAME_COLUMN',
        message: 'ستون «name» (نام) یافت نشد',
      });
    }

    const existing = await this.prisma.customer.findMany({
      where: { organizationId: actor.organizationId, deletedAt: null },
      select: { email: true, nationalId: true },
    });
    const seenEmail = new Set(existing.flatMap((e) => (e.email ? [e.email] : [])));
    const seenNid = new Set(existing.flatMap((e) => (e.nationalId ? [e.nationalId] : [])));

    const report: ImportReport = {
      dryRun: dto.dryRun,
      total: dataRows.length,
      created: 0,
      skipped: 0,
      errors: [],
    };
    const valid: Array<ReturnType<typeof CreateCustomerRequestSchema.parse>> = [];

    dataRows.forEach((cells, idx) => {
      const rowNo = idx + 2; // header is row 1
      const raw: Record<string, string> = {};
      cols.forEach((c, i) => {
        if (c) raw[c] = (cells[i] ?? '').trim();
      });
      const kind = KIND_ALIASES[normalizeText(raw.kind ?? '')] ?? (raw.kind ? raw.kind : 'PERSON');
      const parsed = CreateCustomerRequestSchema.safeParse({ ...raw, kind });
      if (!parsed.success) {
        report.errors.push({ row: rowNo, message: parsed.error.issues[0]?.message ?? 'نامعتبر' });
        return;
      }
      const c = parsed.data;
      if ((c.email && seenEmail.has(c.email)) || (c.nationalId && seenNid.has(c.nationalId))) {
        report.skipped++;
        report.errors.push({ row: rowNo, message: 'تکراری (ایمیل یا کد ملی موجود است)' });
        return;
      }
      if (c.email) seenEmail.add(c.email);
      if (c.nationalId) seenNid.add(c.nationalId);
      valid.push(c);
    });

    report.created = valid.length;
    if (!dto.dryRun && valid.length > 0) {
      await this.prisma.customer.createMany({
        data: valid.map((c) => ({
          organizationId: actor.organizationId,
          kind: c.kind,
          name: c.name,
          nationalId: c.nationalId ?? null,
          economicCode: c.economicCode ?? null,
          email: c.email ?? null,
          phone: c.phone ?? null,
          website: c.website ?? null,
          province: c.province ?? null,
          city: c.city ?? null,
          address: c.address ?? null,
          notes: c.notes ?? null,
          ownerId: actor.id,
          createdById: actor.id,
          searchText: customerSearchText(c),
        })),
      });
    }
    if (!dto.dryRun) {
      await this.audit.record({
        organizationId: actor.organizationId,
        actorId: actor.id,
        action: 'customer.imported',
        entityType: 'customer',
        metadata: {
          total: report.total,
          created: report.created,
          skipped: report.skipped,
          errors: report.errors.length,
        },
        ip,
      });
    }
    return report;
  }
}
