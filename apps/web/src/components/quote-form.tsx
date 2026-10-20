'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import {
  DEFAULT_TAX_RATE_BP,
  calculateQuoteTotals,
  type QuoteTotals,
  type DealDto,
  type Page,
  type ProductDto,
  type QuoteDto,
} from '@ishan/contracts';
import { fa, formatMoney, formatNumber } from '@ishan/i18n';
import { ApiClientError, api } from '@/lib/api';
import { rialToTomanInput, tomanInputToRial } from '@/lib/money';
import { CustomerPicker } from './customer-picker';
import { JalaliDateField } from './jalali-date-field';
import { useToast } from './toast';
import { Button, ErrorBanner, Field, Input, Select, Textarea } from './ui';

const msg = (e: unknown) =>
  e instanceof ApiClientError || e instanceof Error ? e.message : fa.common.error;

interface Row {
  key: number;
  productId: string | null;
  description: string;
  quantity: string;
  unitPrice: string; // toman
}

type Parsed =
  | { problem: string }
  | {
      problem?: undefined;
      items: {
        productId: string | null;
        description: string;
        quantity: number;
        unitPrice: bigint;
      }[];
      disc: bigint;
      taxRateBp: number;
      totals: QuoteTotals;
    };

let rowKey = 0;
const blankRow = (): Row => ({
  key: ++rowKey,
  productId: null,
  description: '',
  quantity: '1',
  unitPrice: '',
});

/** Create or edit (DRAFT only) a quote. Amounts are typed in toman and sent as integer rials. */
export function QuoteForm({
  quote,
  presetCustomer,
  onSaved,
  onCancel,
}: {
  quote?: QuoteDto;
  presetCustomer?: { id: string; name: string };
  onSaved: (q: QuoteDto) => void;
  onCancel: () => void;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const [title, setTitle] = useState(quote?.title ?? '');
  const [customerId, setCustomerId] = useState(quote?.customer.id ?? presetCustomer?.id ?? '');
  const [dealId, setDealId] = useState(quote?.deal?.id ?? '');
  const [issueDate, setIssueDate] = useState(quote?.issueDate ?? '');
  const [validUntil, setValidUntil] = useState(quote?.validUntil ?? '');
  const [rows, setRows] = useState<Row[]>(
    quote
      ? quote.items.map((i) => ({
          key: ++rowKey,
          productId: i.productId,
          description: i.description,
          quantity: String(i.quantity),
          unitPrice: rialToTomanInput(i.unitPrice),
        }))
      : [blankRow()],
  );
  const [discount, setDiscount] = useState(quote ? rialToTomanInput(quote.discount) : '0');
  const [taxPercent, setTaxPercent] = useState(
    String((quote?.taxRateBp ?? DEFAULT_TAX_RATE_BP) / 100),
  );
  const [notes, setNotes] = useState(quote?.notes ?? '');
  const [terms, setTerms] = useState(quote?.terms ?? '');
  const [error, setError] = useState('');

  const products = useQuery({
    queryKey: ['products', 'picker'],
    queryFn: () => api<Page<ProductDto>>('/products?limit=100&activeOnly=true'),
  });
  const deals = useQuery({
    queryKey: ['deals', 'for-quote', customerId],
    enabled: Boolean(customerId),
    queryFn: () => api<Page<DealDto>>(`/deals?limit=50&customerId=${customerId}`),
  });

  const update = (key: number, patch: Partial<Row>) =>
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  /** Parsed state for submission and live preview; `problem` is a user-facing message. */
  const parsed = useMemo<Parsed>(() => {
    const items = [];
    for (const [idx, r] of rows.entries()) {
      const qty = Number(r.quantity);
      const price = tomanInputToRial(r.unitPrice);
      if (!r.description.trim())
        return { problem: `${fa.quotes.description} (${formatNumber(idx + 1)})` };
      if (!Number.isInteger(qty) || qty < 1)
        return { problem: `${fa.quotes.quantity} (${formatNumber(idx + 1)})` };
      if (price === null) return { problem: `${fa.quotes.unitPrice} (${formatNumber(idx + 1)})` };
      items.push({
        productId: r.productId,
        description: r.description.trim(),
        quantity: qty,
        unitPrice: price,
      });
    }
    const disc = tomanInputToRial(discount || '0');
    if (disc === null) return { problem: fa.quotes.discount };
    const pct = Number(taxPercent);
    if (!(pct >= 0 && pct <= 100)) return { problem: fa.quotes.taxRate };
    const taxRateBp = Math.round(pct * 100);
    try {
      const totals = calculateQuoteTotals(items, disc, taxRateBp);
      return { items, disc, taxRateBp, totals };
    } catch (e) {
      return { problem: e instanceof Error ? e.message : fa.common.error };
    }
  }, [rows, discount, taxPercent]);

  const save = useMutation({
    mutationFn: () => {
      if (!customerId) throw new Error(fa.quotes.customer);
      if (parsed.problem !== undefined) throw new Error(parsed.problem);
      const body = {
        title,
        customerId,
        dealId: dealId || null,
        ...(issueDate ? { issueDate } : {}),
        validUntil: validUntil || null,
        discount: parsed.disc.toString(),
        taxRateBp: parsed.taxRateBp,
        notes: notes.trim() || (quote ? null : undefined),
        terms: terms.trim() || (quote ? null : undefined),
        items: parsed.items.map((i) => ({ ...i, unitPrice: i.unitPrice.toString() })),
      };
      return quote
        ? api<QuoteDto>(`/quotes/${quote.id}`, { method: 'PATCH', body })
        : api<QuoteDto>('/quotes', { method: 'POST', body });
    },
    onSuccess: (q) => {
      toast(quote ? fa.quotes.updated : fa.quotes.created);
      void qc.invalidateQueries({ queryKey: ['quotes'] });
      onSaved(q);
    },
    onError: (e) => setError(msg(e)),
  });

  const totals = parsed.problem === undefined ? parsed.totals : null;

  return (
    <form
      className="flex flex-col gap-5"
      onSubmit={(e) => {
        e.preventDefault();
        setError('');
        save.mutate();
      }}
    >
      <Field label={fa.quotes.quoteTitle}>
        {(p) => <Input {...p} required value={title} onChange={(e) => setTitle(e.target.value)} />}
      </Field>
      <CustomerPicker
        value={customerId}
        onChange={(id) => {
          setCustomerId(id);
          setDealId('');
        }}
        initial={quote ? quote.customer : presetCustomer}
      />
      <Field label={fa.quotes.deal}>
        {(p) => (
          <Select
            {...p}
            value={dealId}
            onChange={(e) => setDealId(e.target.value)}
            disabled={!customerId}
          >
            <option value="">{fa.quotes.noDeal}</option>
            {deals.data?.items.map((d) => (
              <option key={d.id} value={d.id}>
                {d.title}
              </option>
            ))}
            {quote?.deal && !deals.data?.items.some((d) => d.id === quote.deal!.id) ? (
              <option value={quote.deal.id}>{quote.deal.title}</option>
            ) : null}
          </Select>
        )}
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <JalaliDateField label={fa.quotes.issueDate} value={issueDate} onChange={setIssueDate} />
        <JalaliDateField
          label={fa.quotes.validUntil}
          value={validUntil}
          onChange={setValidUntil}
          optional
        />
      </div>

      <fieldset className="flex flex-col gap-3">
        <legend className="mb-1 text-sm font-medium">{fa.quotes.items}</legend>
        <p className="text-sm text-[var(--color-text-muted)]">{fa.quotes.amountsHint}</p>
        {rows.map((r, idx) => {
          const n = formatNumber(idx + 1);
          return (
            <div
              key={r.key}
              className="grid gap-2 rounded-[var(--radius-md)] border border-[var(--color-border)] p-3 sm:grid-cols-[1fr_6rem_9rem_auto]"
            >
              <div className="flex flex-col gap-2">
                <Select
                  aria-label={`${fa.quotes.fromProduct} (${n})`}
                  value={r.productId ?? ''}
                  onChange={(e) => {
                    const prod = products.data?.items.find((x) => x.id === e.target.value);
                    update(
                      r.key,
                      prod
                        ? {
                            productId: prod.id,
                            description: prod.name,
                            unitPrice: rialToTomanInput(prod.unitPrice),
                          }
                        : { productId: null },
                    );
                  }}
                >
                  <option value="">{fa.quotes.fromProduct}</option>
                  {products.data?.items.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </Select>
                <Input
                  aria-label={`${fa.quotes.description} (${n})`}
                  placeholder={fa.quotes.description}
                  value={r.description}
                  onChange={(e) => update(r.key, { description: e.target.value })}
                />
              </div>
              <Input
                aria-label={`${fa.quotes.quantity} (${n})`}
                inputMode="numeric"
                value={r.quantity}
                onChange={(e) => update(r.key, { quantity: e.target.value })}
              />
              <Input
                aria-label={`${fa.quotes.unitPrice} (${n})`}
                inputMode="numeric"
                value={r.unitPrice}
                onChange={(e) => update(r.key, { unitPrice: e.target.value })}
              />
              <Button
                type="button"
                variant="ghost"
                disabled={rows.length === 1}
                aria-label={`${fa.quotes.removeItem} (${n})`}
                onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))}
              >
                ✕
              </Button>
            </div>
          );
        })}
        <div>
          <Button
            type="button"
            variant="secondary"
            onClick={() => setRows((rs) => [...rs, blankRow()])}
          >
            {fa.quotes.addItem}
          </Button>
        </div>
      </fieldset>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={fa.quotes.discount}>
          {(p) => (
            <Input
              {...p}
              inputMode="numeric"
              value={discount}
              onChange={(e) => setDiscount(e.target.value)}
            />
          )}
        </Field>
        <Field label={fa.quotes.taxRate}>
          {(p) => (
            <Input
              {...p}
              inputMode="decimal"
              value={taxPercent}
              onChange={(e) => setTaxPercent(e.target.value)}
            />
          )}
        </Field>
      </div>

      <section
        aria-label={fa.quotes.preview}
        className="rounded-[var(--radius-md)] bg-[var(--color-surface-2)] p-4 text-sm"
      >
        {totals ? (
          <dl className="grid grid-cols-[1fr_auto] gap-x-6 gap-y-1 tabular-nums">
            <dt>{fa.quotes.subtotal}</dt>
            <dd>{formatMoney(totals.subtotal, 'toman')}</dd>
            <dt>{fa.quotes.discount}</dt>
            <dd>{formatMoney(totals.discount, 'toman')}</dd>
            <dt>{fa.quotes.tax}</dt>
            <dd>{formatMoney(totals.taxAmount, 'toman')}</dd>
            <dt className="font-bold">{fa.quotes.total}</dt>
            <dd className="font-bold">{formatMoney(totals.total, 'toman')}</dd>
          </dl>
        ) : (
          <p className="text-[var(--color-danger)]">{parsed.problem ?? ''}</p>
        )}
      </section>

      <Field label={fa.quotes.notes}>
        {(p) => <Textarea {...p} value={notes} onChange={(e) => setNotes(e.target.value)} />}
      </Field>
      <Field label={fa.quotes.terms}>
        {(p) => (
          <Textarea {...p} rows={4} value={terms} onChange={(e) => setTerms(e.target.value)} />
        )}
      </Field>

      {error ? <ErrorBanner message={error} /> : null}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onCancel}>
          {fa.common.cancel}
        </Button>
        <Button type="submit" loading={save.isPending}>
          {fa.common.save}
        </Button>
      </div>
    </form>
  );
}
