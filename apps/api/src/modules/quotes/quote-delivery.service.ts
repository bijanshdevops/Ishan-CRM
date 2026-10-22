import {
  ConflictException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  QUOTE_EMAIL_PER_HOUR,
  QUOTE_EMAILABLE_STATUSES,
  type QuoteEmailDto,
  type QuoteEmailOptionsDto,
  type QuoteEmailStatus,
  type SendQuoteEmail,
} from '@ishan/contracts';
import type { AuthUser } from '../../common/decorators';
import { ownerWhere } from '../../common/access-scope';
import { APP_CONFIG, type AppConfig } from '../../config';
import { PrismaService } from '../../infra/prisma.service';
import { AuditService } from '../audit/audit.service';
import { MailerService } from '../notifications/mailer.service';
import { PdfRenderer } from './pdf-renderer';
import { quoteInclude, toQuoteDto } from './mappers';
import { buildQuoteHtml, quotePdfFilename, vazirmatnFontCss } from './quote-pdf';

export const PDF_RENDERER = Symbol('PDF_RENDERER');
const HOUR_MS = 3_600_000;

const err = (status: HttpStatus, code: string, message: string) =>
  new HttpException({ code, message }, status);

@Injectable()
export class QuoteDeliveryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly mailer: MailerService,
    @Inject(PDF_RENDERER) private readonly renderer: PdfRenderer,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  private async load(actor: AuthUser, id: string) {
    const q = await this.prisma.quote.findFirst({
      where: { id, organizationId: actor.organizationId, deletedAt: null, ...ownerWhere(actor) },
      include: {
        ...quoteInclude,
        customer: { select: { id: true, name: true, email: true } },
        contact: { select: { id: true, firstName: true, lastName: true, email: true } },
      },
    });
    if (!q) throw new NotFoundException('پیش‌فاکتور یافت نشد');
    return q;
  }

  /** PDF bytes of one quote version (nothing is stored). */
  async pdf(actor: AuthUser, id: string): Promise<{ filename: string; data: Buffer }> {
    if (!this.renderer.available) {
      throw err(
        HttpStatus.SERVICE_UNAVAILABLE,
        'pdf_unavailable',
        'تولید PDF در این سرور فعال نیست.',
      );
    }
    const q = await this.load(actor, id);
    const org = await this.prisma.organization.findUniqueOrThrow({
      where: { id: actor.organizationId },
      select: { name: true },
    });
    const dto = toQuoteDto(q, q.version);
    const data = await this.renderer.render(buildQuoteHtml(dto, org.name, vazirmatnFontCss()));
    return { filename: quotePdfFilename(dto), data };
  }

  async options(actor: AuthUser, id: string): Promise<QuoteEmailOptionsDto> {
    const q = await this.load(actor, id);
    const me = await this.prisma.user.findUnique({
      where: { id: actor.id },
      select: { email: true, emailVerifiedAt: true },
    });
    const recipients: QuoteEmailOptionsDto['recipients'] = [];
    const add = (email: string | null | undefined, label: string) => {
      const e = email?.trim().toLowerCase();
      if (e && !recipients.some((r) => r.email === e)) recipients.push({ email: e, label });
    };
    add(q.contact?.email, `${q.contact?.firstName ?? ''} ${q.contact?.lastName ?? ''}`.trim());
    add(q.customer.email, q.customer.name);
    return {
      emailAvailable: this.mailer.available,
      pdfAvailable: this.renderer.available,
      replyTo: me?.emailVerifiedAt ? me.email : null,
      recipients,
    };
  }

  async list(actor: AuthUser, id: string): Promise<QuoteEmailDto[]> {
    await this.load(actor, id);
    const rows = await this.prisma.quoteEmail.findMany({
      where: { quoteId: id, organizationId: actor.organizationId },
      include: {
        sender: { select: { id: true, name: true } },
        quote: { select: { version: true } },
      },
      orderBy: { id: 'desc' },
      take: 50,
    });
    return rows.map((r) => ({
      id: r.id,
      quoteId: r.quoteId,
      version: r.quote.version,
      to: r.toEmail,
      message: r.message,
      status: r.status as QuoteEmailStatus,
      attempt: r.attempt,
      lastError: r.lastError,
      sender: r.sender,
      sentAt: r.sentAt?.toISOString() ?? null,
      createdAt: r.createdAt.toISOString(),
    }));
  }

  /** Queues the e-mail; the worker renders the PDF and delivers it (ADR 0016). */
  async send(
    actor: AuthUser,
    id: string,
    input: SendQuoteEmail,
    ip?: string,
  ): Promise<QuoteEmailDto> {
    if (!this.mailer.available) {
      throw err(
        HttpStatus.CONFLICT,
        'email_unavailable',
        'ارسال ایمیل در این سرور پیکربندی نشده است.',
      );
    }
    if (!this.renderer.available) {
      throw err(HttpStatus.CONFLICT, 'pdf_unavailable', 'تولید PDF در این سرور فعال نیست.');
    }
    const opts = await this.options(actor, id);
    const q = await this.load(actor, id);
    if (!(QUOTE_EMAILABLE_STATUSES as readonly string[]).includes(q.status)) {
      throw new ConflictException({
        code: 'quote_not_sendable',
        message: 'فقط پیش‌فاکتور ارسال‌شده یا پذیرفته‌شده را می‌توان ایمیل کرد.',
      });
    }
    if (!opts.replyTo) {
      throw err(
        HttpStatus.CONFLICT,
        'email_not_verified',
        'ابتدا ایمیل خود را در «حساب من» تأیید کنید.',
      );
    }
    if (!opts.recipients.some((r) => r.email === input.to)) {
      throw err(
        HttpStatus.BAD_REQUEST,
        'recipient_not_allowed',
        'این نشانی در پرونده‌ی مشتری ثبت نشده است.',
      );
    }
    const now = new Date();
    const row = await this.prisma.$transaction(async (tx) => {
      // Serialize concurrent clicks for the same (quote, recipient) and the per-user hourly cap.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`quote-email:${id}:${input.to}`}))`;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`quote-email-user:${actor.id}`}))`;
      const recent = await tx.quoteEmail.count({
        where: { senderId: actor.id, createdAt: { gt: new Date(now.getTime() - HOUR_MS) } },
      });
      if (recent >= QUOTE_EMAIL_PER_HOUR) {
        throw err(
          HttpStatus.TOO_MANY_REQUESTS,
          'rate_limited',
          'سقف ارسال ایمیل پیش‌فاکتور در ساعت پر شده است.',
        );
      }
      const pending = await tx.quoteEmail.count({
        where: { quoteId: id, toEmail: input.to, status: 'PENDING' },
      });
      if (pending > 0) {
        throw err(
          HttpStatus.CONFLICT,
          'already_queued',
          'ایمیل این پیش‌فاکتور برای همین نشانی در صف است.',
        );
      }
      return tx.quoteEmail.create({
        data: {
          organizationId: actor.organizationId,
          quoteId: id,
          senderId: actor.id,
          toEmail: input.to,
          replyTo: opts.replyTo!,
          message: input.message,
          status: 'PENDING',
          nextAttemptAt: now,
        },
        include: {
          sender: { select: { id: true, name: true } },
          quote: { select: { version: true } },
        },
      });
    });
    await this.audit.record({
      organizationId: actor.organizationId,
      actorId: actor.id,
      action: 'quote.emailed',
      entityType: 'quote',
      entityId: id,
      metadata: { emailId: row.id, to: input.to },
      ip,
    });
    return {
      id: row.id,
      quoteId: row.quoteId,
      version: row.quote.version,
      to: row.toEmail,
      message: row.message,
      status: 'PENDING',
      attempt: 0,
      lastError: null,
      sender: row.sender,
      sentAt: null,
      createdAt: row.createdAt.toISOString(),
    };
  }

  /** A failed e-mail goes back to the queue with a fresh set of attempts. */
  async retry(actor: AuthUser, id: string, emailId: string): Promise<void> {
    await this.load(actor, id);
    const res = await this.prisma.quoteEmail.updateMany({
      where: { id: emailId, quoteId: id, organizationId: actor.organizationId, status: 'FAILED' },
      data: { status: 'PENDING', attempt: 0, nextAttemptAt: new Date(), lastError: null },
    });
    if (res.count === 0) {
      throw new ConflictException({
        code: 'not_failed',
        message: 'فقط ایمیل ناموفق دوباره ارسال می‌شود.',
      });
    }
  }
}
