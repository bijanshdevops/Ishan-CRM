/**
 * The Ishan mark: two people (an "i" that is also a person) in a conversation bubble.
 * Decorative: the product name is always rendered as text next to it.
 */
export function Logo({ size = 32, className = '' }: { size?: number; className?: string }) {
  return (
    <svg
      viewBox="0 0 128 128"
      width={size}
      height={size}
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      <path
        d="M32 6 H96 A26 26 0 0 1 122 32 V74 A26 26 0 0 1 96 100 H78 L56 124 V100 H32 A26 26 0 0 1 6 74 V32 A26 26 0 0 1 32 6 Z"
        fill="var(--color-brand)"
      />
      <circle cx="47" cy="36.5" r="10.5" fill="var(--color-brand-contrast)" />
      <rect x="39.5" y="52" width="15" height="36" rx="5" fill="var(--color-brand-contrast)" />
      <circle cx="80" cy="48.5" r="8.5" fill="#f07c90" />
      <rect x="73.5" y="62" width="13" height="26" rx="5" fill="#f07c90" />
    </svg>
  );
}
