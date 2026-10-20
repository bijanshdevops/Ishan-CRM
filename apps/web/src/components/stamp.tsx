import type { ContractStatus, QuoteStatus } from '@ishan/contracts';
import { fa } from '@ishan/i18n';

type Kind = QuoteStatus | ContractStatus | 'EXPIRED';

/**
 * Status as a rubber stamp. Colour is never the only signal: every state carries its own text
 * and its own border shape (double = accepted, dashed = rejected/expired, dotted = draft, ...).
 * `animate` plays the press-down once; it is set only after a user action, never on page load.
 */
const STYLE: Record<Kind, { color: string; border: string; extra?: string }> = {
  DRAFT: { color: 'var(--color-stamp-ink)', border: '2px dotted' },
  SENT: { color: 'var(--color-brand)', border: '2px solid' },
  ACCEPTED: { color: 'var(--color-stamp-blue)', border: '5px double' },
  REJECTED: { color: 'var(--color-stamp-red)', border: '2px dashed' },
  SUPERSEDED: { color: 'var(--color-stamp-ink)', border: '2px solid', extra: 'line-through' },
  EXPIRED: { color: 'var(--color-stamp-red)', border: '2px dashed' },
  ACTIVE: { color: 'var(--color-stamp-blue)', border: '5px double' },
  COMPLETED: { color: 'var(--color-success)', border: '2px solid' },
  TERMINATED: { color: 'var(--color-stamp-red)', border: '2px dashed' },
};

export function Stamp({
  status,
  animate = false,
  scope = 'quote',
  className = '',
}: {
  status: Kind;
  scope?: 'quote' | 'contract';
  animate?: boolean;
  className?: string;
}) {
  const s = STYLE[status];
  const label =
    status === 'EXPIRED'
      ? fa.quotes.expired
      : scope === 'contract'
        ? fa.contracts.statuses[status as ContractStatus]
        : fa.quotes.statuses[status as QuoteStatus];
  return (
    <span
      data-testid="stamp"
      data-status={status}
      data-animate={animate ? 'true' : undefined}
      className={`stamp inline-block select-none rounded-[var(--radius-sm)] px-3 py-1 text-base font-extrabold ${s.extra ?? ''} ${className}`}
      style={{ color: s.color, border: `${s.border} ${s.color}` }}
    >
      {label}
    </span>
  );
}
