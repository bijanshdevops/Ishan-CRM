import { assertIfMatch, assertWritten, casWhere } from '../../common/etag';
import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type {
  CreateProductRequest,
  Page,
  ProductDto,
  ProductListQuery,
  UpdateProductRequest,
} from '@ishan/contracts';
import { normalizeText, parseRial } from '@ishan/contracts';
import type { AuthUser } from '../../common/decorators';
import { PrismaService } from '../../infra/prisma.service';
import { AuditService } from '../audit/audit.service';
import { toProductDto } from './mappers';

const searchText = (p: { name: string; sku?: string | null; description?: string | null }) =>
  normalizeText([p.name, p.sku, p.description].filter(Boolean).join(' '));

const isUniqueViolation = (e: unknown) =>
  typeof e === 'object' && e !== null && (e as { code?: string }).code === 'P2002';

@Injectable()
export class ProductsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(actor: AuthUser, q: ProductListQuery): Promise<Page<ProductDto>> {
    const term = q.q ? normalizeText(q.q) : '';
    const rows = await this.prisma.product.findMany({
      where: {
        organizationId: actor.organizationId,
        ...(q.activeOnly === 'true' ? { active: true } : {}),
        ...(term ? { searchText: { contains: term } } : {}),
        ...(q.cursor ? { id: { lt: q.cursor } } : {}),
      },
      orderBy: { id: 'desc' },
      take: q.limit + 1,
    });
    const items = rows.slice(0, q.limit).map(toProductDto);
    return { items, nextCursor: rows.length > q.limit ? (items.at(-1)?.id ?? null) : null };
  }

  async get(actor: AuthUser, id: string): Promise<ProductDto> {
    const p = await this.prisma.product.findFirst({
      where: { id, organizationId: actor.organizationId },
    });
    if (!p) throw new NotFoundException('محصول یافت نشد');
    return toProductDto(p);
  }

  async create(actor: AuthUser, dto: CreateProductRequest, ip?: string): Promise<ProductDto> {
    try {
      const p = await this.prisma.product.create({
        data: {
          organizationId: actor.organizationId,
          name: dto.name,
          sku: dto.sku ?? null,
          unit: dto.unit,
          unitPrice: parseRial(dto.unitPrice),
          description: dto.description ?? null,
          searchText: searchText(dto),
          createdById: actor.id,
        },
      });
      await this.audit.record({
        organizationId: actor.organizationId,
        actorId: actor.id,
        action: 'product.created',
        entityType: 'product',
        entityId: p.id,
        ip,
      });
      return toProductDto(p);
    } catch (e) {
      if (isUniqueViolation(e)) {
        throw new ConflictException({
          code: 'SKU_TAKEN',
          message: 'این کد محصول قبلاً استفاده شده است',
        });
      }
      throw e;
    }
  }

  async update(
    actor: AuthUser,
    id: string,
    dto: UpdateProductRequest,
    ip?: string,
    ifMatch?: string,
  ) {
    const existing = await this.prisma.product.findFirst({
      where: { id, organizationId: actor.organizationId },
    });
    if (!existing) throw new NotFoundException('محصول یافت نشد');
    assertIfMatch(ifMatch, existing.updatedAt);
    const merged = {
      name: dto.name ?? existing.name,
      sku: dto.sku === undefined ? existing.sku : dto.sku || null,
      description: dto.description === undefined ? existing.description : dto.description || null,
    };
    try {
      const written = await this.prisma.product.updateMany({
        where: casWhere(id, ifMatch, existing.updatedAt),
        data: {
          name: merged.name,
          sku: merged.sku,
          description: merged.description,
          unit: dto.unit,
          unitPrice: dto.unitPrice !== undefined ? parseRial(dto.unitPrice) : undefined,
          active: dto.active,
          searchText: searchText(merged),
        },
      });
      assertWritten(written.count, ifMatch, new NotFoundException('محصول یافت نشد'));
      const p = await this.prisma.product.findUniqueOrThrow({ where: { id } });
      await this.audit.record({
        organizationId: actor.organizationId,
        actorId: actor.id,
        action: dto.active === false ? 'product.archived' : 'product.updated',
        entityType: 'product',
        entityId: id,
        ip,
      });
      return toProductDto(p);
    } catch (e) {
      if (isUniqueViolation(e)) {
        throw new ConflictException({
          code: 'SKU_TAKEN',
          message: 'این کد محصول قبلاً استفاده شده است',
        });
      }
      throw e;
    }
  }
}
