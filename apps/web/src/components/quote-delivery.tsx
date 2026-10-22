'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import {
  PERMISSIONS,
  QUOTE_EMAIL_MESSAGE_MAX,
  QUOTE_EMAILABLE_STATUSES,
  type QuoteDto,
  type QuoteEmailDto,
  type QuoteEmailOptionsDto,
} from '@ishan/contracts';
import { fa, formatJalaliDateTime, formatNumber } from '@ishan/i18n';
import { ApiClientError, api, apiBlob } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useToast } from './toast';
import { Badge, Button, Card, ErrorBanner, Field, Modal, Select, Skeleton, Textarea } from './ui';

const t = fa.quoteDelivery;
const msg = (e: unknown) =>
  e instanceof ApiClientError || e instanceof Error ? e.message : fa.common.error;
export const emailable = (q: Pick<QuoteDto, 'status'>) =>
  (QUOTE_EMAILABLE_STATUSES as readonly string[]).includes(q.status);

/** Downloads the server-made PDF; the browser print button stays as the fallback. */
export function QuotePdfButton({ quote }: { quote: Pick<QuoteDto, 'id' | 'number' | 'version'> }) {
  const toast = useToast();
  const pdf = useMutation({
    mutationFn: async () => {
      const blob = await apiBlob(`/quotes/${quote.id}/pdf`).catch((e: unknown) => {
        throw e instanceof ApiClientError && e.status === 503
          ? new Error(t.pdfUnavailable)
          : new Error(t.pdfFailed);
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${quote.number}-v${quote.version}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    },
    onError: (e) => toast(msg(e), 'error'),
  });
  return (
    <Button variant="secondary" loading={pdf.isPending} onClick={() => pdf.mutate()}>
      {t.downloadPdf}
    </Button>
  );
}

const emailsKey = (id: string) => ['quote', id, 'emails'];

/** Opens the send dialog. Hidden unless the caller may write and the quote is sendable. */
export function QuoteEmailButton({ quote }: { quote: QuoteDto }) {
  const { can } = useAuth();
  const [open, setOpen] = useState(false);
  if (!can(PERMISSIONS.QUOTES_WRITE) || !emailable(quote)) return null;
  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}>
        {t.sendEmail}
      </Button>
      {open ? <EmailDialog quote={quote} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

function EmailDialog({ quote, onClose }: { quote: QuoteDto; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [to, setTo] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState<string | null>(null);
  const options = useQuery({
    queryKey: ['quote', quote.id, 'email-options'],
    queryFn: () => api<QuoteEmailOptionsDto>(`/quotes/${quote.id}/email-options`),
  });
  const send = useMutation({
    mutationFn: (address: string) =>
      api<QuoteEmailDto>(`/quotes/${quote.id}/emails`, {
        method: 'POST',
        body: { to: address, ...(message.trim() ? { message: message.trim() } : {}) },
      }),
    onSuccess: () => {
      toast(t.queued);
      void qc.invalidateQueries({ queryKey: emailsKey(quote.id) });
      onClose();
    },
    onError: (e) => setError(msg(e)),
  });

  const o = options.data;
  const address = to || o?.recipients[0]?.email || '';
  const blocked = !o
    ? null
    : !o.emailAvailable || !o.pdfAvailable
      ? t.unavailable
      : !o.replyTo
        ? t.needVerified
        : o.recipients.length === 0
          ? t.noRecipients
          : null;

  return (
    <Modal title={`${t.title} · ${quote.number}`} onClose={onClose}>
      {options.isLoading ? (
        <Skeleton rows={3} />
      ) : options.isError ? (
        <ErrorBanner message={msg(options.error)} onRetry={() => void options.refetch()} />
      ) : (
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (address) send.mutate(address);
          }}
        >
          {error ? <ErrorBanner message={error} /> : null}
          {blocked ? (
            <p role="status" className="text-sm">
              {blocked}
            </p>
          ) : (
            <>
              <Field label={t.recipient}>
                {(p) => (
                  <Select {...p} value={address} onChange={(e) => setTo(e.target.value)}>
                    {o!.recipients.map((r) => (
                      <option key={r.email} value={r.email}>
                        {r.label} — {r.email}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              <Field label={t.message} hint={t.messageHint}>
                {(p) => (
                  <Textarea
                    {...p}
                    rows={4}
                    maxLength={QUOTE_EMAIL_MESSAGE_MAX}
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                  />
                )}
              </Field>
              <p className="text-sm text-[var(--color-text-muted)]">
                {t.replyTo}: <span dir="ltr">{o!.replyTo}</span>
              </p>
            </>
          )}
          <div className="flex gap-2">
            {!blocked ? (
              <Button type="submit" loading={send.isPending}>
                {t.send}
              </Button>
            ) : null}
            <Button type="button" variant="ghost" onClick={onClose}>
              {fa.common.close}
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
}

/** Sends of this quote version with their state; a failed one can be queued again. */
export function QuoteEmailsCard({ quote }: { quote: QuoteDto }) {
  const qc = useQueryClient();
  const toast = useToast();
  const { can } = useAuth();
  const canWrite = can(PERMISSIONS.QUOTES_WRITE);
  const list = useQuery({
    queryKey: emailsKey(quote.id),
    queryFn: () => api<QuoteEmailDto[]>(`/quotes/${quote.id}/emails`),
    refetchInterval: (q) => (q.state.data?.some((e) => e.status === 'PENDING') ? 5000 : false),
  });
  const retry = useMutation({
    mutationFn: (emailId: string) =>
      api(`/quotes/${quote.id}/emails/${emailId}/retry`, { method: 'POST' }),
    onSuccess: () => {
      toast(t.retried);
      void qc.invalidateQueries({ queryKey: emailsKey(quote.id) });
    },
    onError: (e) => toast(msg(e), 'error'),
  });
  const rows = list.data ?? [];
  // Nothing to show for a draft, or for a quote that was never mailed and cannot be.
  if (!emailable(quote) && rows.length === 0) return null;
  return (
    <section className="mt-6 print:hidden" aria-label={t.listTitle}>
      <Card title={t.listTitle}>
        {list.isLoading ? (
          <Skeleton rows={2} />
        ) : list.isError ? (
          <ErrorBanner message={msg(list.error)} onRetry={() => void list.refetch()} />
        ) : rows.length === 0 ? (
          <p className="text-sm text-[var(--color-text-muted)]">{t.empty}</p>
        ) : (
          <ul className="flex flex-col divide-y divide-[var(--color-border)]">
            {rows.map((e) => (
              <li key={e.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2 text-sm">
                <span dir="ltr" className="font-medium">
                  {e.to}
                </span>
                <Badge
                  tone={
                    e.status === 'SENT' ? 'success' : e.status === 'FAILED' ? 'danger' : 'neutral'
                  }
                >
                  {t.status[e.status]}
                </Badge>
                <span className="text-[var(--color-text-muted)]">
                  {formatJalaliDateTime(e.sentAt ?? e.createdAt)}
                  {e.sender ? ` · ${t.by} ${e.sender.name}` : ''}
                  {e.status !== 'SENT' && e.attempt > 0
                    ? ` · ${t.attempts} ${formatNumber(e.attempt)}`
                    : ''}
                </span>
                {e.status === 'FAILED' && e.lastError ? (
                  <span className="basis-full text-[var(--color-danger)]" dir="auto">
                    {e.lastError}
                  </span>
                ) : null}
                {e.status === 'FAILED' && canWrite ? (
                  <Button
                    variant="secondary"
                    loading={retry.isPending && retry.variables === e.id}
                    onClick={() => retry.mutate(e.id)}
                  >
                    {t.retry}
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </section>
  );
}
