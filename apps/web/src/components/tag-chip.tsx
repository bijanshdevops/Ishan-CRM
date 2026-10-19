import type { TagDto } from '@ishan/contracts';

export function TagChip({ tag }: { tag: TagDto }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-[var(--color-border)] px-2 py-0.5 text-xs">
      <span aria-hidden className="size-2 rounded-full" style={{ background: tag.color }} />
      {tag.name}
    </span>
  );
}
