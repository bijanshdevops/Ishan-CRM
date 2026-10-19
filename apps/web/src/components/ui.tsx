'use client';

import {
  useEffect,
  useId,
  useRef,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { fa } from '@ishan/i18n';

const focusRing = 'focus-visible:shadow-[var(--focus-ring)] focus-visible:outline-none';

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost';
const variants: Record<Variant, string> = {
  primary: 'bg-[var(--color-brand)] text-[var(--color-brand-contrast)] hover:opacity-90',
  secondary:
    'border border-[var(--color-border)] bg-[var(--color-surface)] hover:bg-[var(--color-surface-2)]',
  danger: 'bg-[var(--color-danger)] text-white hover:opacity-90',
  ghost: 'hover:bg-[var(--color-surface-2)]',
};

export function Button({
  variant = 'primary',
  loading,
  className = '',
  children,
  disabled,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; loading?: boolean }) {
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={`inline-flex min-h-10 items-center justify-center gap-2 rounded-[var(--radius-md)] px-4 text-sm font-medium transition-opacity disabled:cursor-not-allowed disabled:opacity-50 ${variants[variant]} ${focusRing} ${className}`}
    >
      {loading ? fa.common.loading : children}
    </button>
  );
}

export function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  children: (props: {
    id: string;
    'aria-describedby'?: string;
    'aria-invalid'?: boolean;
  }) => ReactNode;
}) {
  const id = useId();
  const describedBy = error ? `${id}-err` : hint ? `${id}-hint` : undefined;
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      {children({ id, 'aria-describedby': describedBy, 'aria-invalid': error ? true : undefined })}
      {error ? (
        <p id={`${id}-err`} role="alert" className="text-sm text-[var(--color-danger)]">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="text-sm text-[var(--color-text-muted)]">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

const control = `min-h-10 w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-sm ${focusRing}`;

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`${control} ${props.className ?? ''}`} />;
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={`${control} ${props.className ?? ''}`} />;
}

export function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea rows={3} {...props} className={`${control} py-2 ${props.className ?? ''}`} />;
}

export function Badge({
  tone = 'neutral',
  children,
}: {
  tone?: 'neutral' | 'success' | 'danger' | 'brand';
  children: ReactNode;
}) {
  const tones = {
    neutral: 'bg-[var(--color-surface-2)] text-[var(--color-text-muted)]',
    success:
      'bg-[color-mix(in_srgb,var(--color-success)_16%,transparent)] text-[var(--color-success)]',
    danger:
      'bg-[color-mix(in_srgb,var(--color-danger)_16%,transparent)] text-[var(--color-danger)]',
    brand: 'bg-[color-mix(in_srgb,var(--color-brand)_16%,transparent)] text-[var(--color-brand)]',
  };
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${tones[tone]}`}
    >
      {children}
    </span>
  );
}

export function Card({
  title,
  actions,
  children,
}: {
  title?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
      {title || actions ? (
        <header className="mb-4 flex flex-wrap items-center justify-between gap-3">
          {title ? <h2 className="text-lg font-semibold">{title}</h2> : <span />}
          {actions}
        </header>
      ) : null}
      {children}
    </section>
  );
}

export function PageHeader({ title, actions }: { title: string; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
      <h1 className="text-2xl font-bold">{title}</h1>
      {actions}
    </div>
  );
}

export function ErrorBanner({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div
      role="alert"
      className="flex items-center justify-between gap-3 rounded-[var(--radius-md)] border border-[var(--color-danger)] p-3 text-sm text-[var(--color-danger)]"
    >
      <span>{message}</span>
      {onRetry ? (
        <Button variant="secondary" onClick={onRetry}>
          {fa.common.retry}
        </Button>
      ) : null}
    </div>
  );
}

export function Skeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div aria-busy="true" aria-label={fa.common.loading} className="flex flex-col gap-2">
      {Array.from({ length: rows }, (_, i) => (
        <div
          key={i}
          className="h-10 animate-pulse rounded-[var(--radius-sm)] bg-[var(--color-surface-2)]"
        />
      ))}
    </div>
  );
}

export function EmptyState({ children }: { children?: ReactNode }) {
  return (
    <p className="py-10 text-center text-[var(--color-text-muted)]">
      {children ?? fa.common.empty}
    </p>
  );
}

export function DataTable({ head, children }: { head: ReactNode[]; children: ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-[var(--color-border)] text-start text-[var(--color-text-muted)]">
            {head.map((h, i) => (
              <th key={i} scope="col" className="px-3 py-2 text-start font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

export const Tr = ({ children }: { children: ReactNode }) => (
  <tr className="border-b border-[var(--color-border)] last:border-0 hover:bg-[var(--color-surface-2)]">
    {children}
  </tr>
);
export const Td = ({ children, className = '' }: { children?: ReactNode; className?: string }) => (
  <td className={`px-3 py-2.5 align-middle ${className}`}>{children}</td>
);

export function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dlg = ref.current;
    if (dlg && !dlg.open) dlg.showModal();
    return () => dlg?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => e.target === ref.current && onClose()}
      aria-labelledby="modal-title"
      className="m-auto w-[min(32rem,calc(100vw-2rem))] rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] p-0 text-[var(--color-text)] backdrop:bg-black/50"
    >
      <div className="flex flex-col gap-4 p-6">
        <h2 id="modal-title" className="text-lg font-semibold">
          {title}
        </h2>
        {children}
      </div>
    </dialog>
  );
}
