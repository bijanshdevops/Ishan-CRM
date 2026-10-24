'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { fa, formatNumber } from '@ishan/i18n';
import { useAuth } from '@/lib/auth';
import {
  POPOVER_WIDTH,
  buildTourSteps,
  placePopover,
  readTourMemory,
  stepForKey,
  writeTourMemory,
  type Box,
  type TourMemory,
  type TourStep,
} from '@/lib/tour';
import { Button } from './ui';

interface TourApi {
  /** Opens the tour from the first step. */
  start: () => void;
  /** How the signed-in user last left the tour in this browser, if ever. */
  memory: TourMemory | null;
}

const TourContext = createContext<TourApi>({ start: () => undefined, memory: null });
export const useTour = () => useContext(TourContext);

const PAD = 4;

const selectorOf = (href: string) => `[data-tour="${href}"]`;

function measure(el: Element | null): Box | null {
  if (!el) return null;
  const r = el.getBoundingClientRect();
  if (r.width === 0 && r.height === 0) return null;
  return {
    left: r.left - PAD,
    top: r.top - PAD,
    width: r.width + PAD * 2,
    height: r.height + PAD * 2,
  };
}

export function TourProvider({ children }: { children: ReactNode }) {
  const { user, can } = useAuth();
  const userId = user?.id ?? null;
  const [steps, setSteps] = useState<TourStep[] | null>(null);
  const [index, setIndex] = useState(0);
  const [memory, setMemory] = useState<TourMemory | null>(null);
  const returnFocus = useRef<HTMLElement | null>(null);

  useEffect(() => {
    setMemory(userId ? readTourMemory(userId) : null);
  }, [userId]);

  const start = useCallback(() => {
    // Only walk through links that really are on screen (the sidebar is permission-filtered).
    const all = buildTourSteps(can).filter(
      (s) => s.kind !== 'target' || document.querySelector(selectorOf(s.target)) !== null,
    );
    returnFocus.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setIndex(0);
    setSteps(all);
  }, [can]);

  const close = useCallback(
    (outcome: TourMemory) => {
      setSteps(null);
      if (userId) {
        writeTourMemory(userId, outcome);
        setMemory(outcome);
      }
      returnFocus.current?.focus({ preventScroll: true });
    },
    [userId],
  );

  const api = useMemo(() => ({ start, memory }), [start, memory]);

  return (
    <TourContext.Provider value={api}>
      {children}
      {steps ? (
        <TourOverlay steps={steps} index={index} onIndex={setIndex} onClose={close} />
      ) : null}
    </TourContext.Provider>
  );
}

function TourOverlay({
  steps,
  index,
  onIndex,
  onClose,
}: {
  steps: TourStep[];
  index: number;
  onIndex: (i: number) => void;
  onClose: (outcome: TourMemory) => void;
}) {
  const t = fa.tour;
  const step = steps[index]!;
  const total = steps.length;
  const last = index === total - 1;
  const titleId = useId();
  const bodyId = useId();
  const cardRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<Box | null>(null);
  const [cardHeight, setCardHeight] = useState(220);
  const [viewport, setViewport] = useState({ width: 1024, height: 768 });

  const text =
    step.kind === 'welcome' ? t.welcome : step.kind === 'done' ? t.done : t.steps[step.target];

  const target = step.kind === 'target' ? step.target : null;

  // Bring the highlighted link into view, then follow it on scroll/resize.
  useLayoutEffect(() => {
    const update = () => {
      setViewport({ width: window.innerWidth, height: window.innerHeight });
      setBox(target ? measure(document.querySelector(selectorOf(target))) : null);
      if (cardRef.current) setCardHeight(cardRef.current.offsetHeight);
    };
    if (target) {
      document
        .querySelector(selectorOf(target))
        ?.scrollIntoView({ block: 'nearest', inline: 'center' });
    }
    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [target]);

  // Keep keyboard focus inside the tour card as it moves.
  useEffect(() => {
    cardRef.current
      ?.querySelector<HTMLButtonElement>('[data-tour-next]')
      ?.focus({ preventScroll: true });
  }, [index]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const act = stepForKey(e.key, index, total, document.documentElement.dir !== 'ltr');
      if (act === null) return;
      e.preventDefault();
      if (act === 'close') onClose(e.key === 'Escape' ? 'skipped' : 'completed');
      else onIndex(act);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [index, total, onIndex, onClose]);

  const placement = placePopover(box, viewport, cardHeight);
  const cardClass =
    placement.mode === 'center'
      ? 'left-1/2 top-1/2 w-[min(24rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2'
      : placement.mode === 'bottom'
        ? 'inset-x-4 bottom-4 mx-auto max-w-md'
        : '';
  const cardStyle =
    placement.mode === 'side'
      ? { left: placement.left, top: placement.top, width: POPOVER_WIDTH }
      : undefined;

  return (
    <div className="print:hidden">
      {box ? (
        <div
          aria-hidden="true"
          className="pointer-events-none fixed z-[60] rounded-[var(--radius-md)]"
          style={{
            left: box.left,
            top: box.top,
            width: box.width,
            height: box.height,
            boxShadow: '0 0 0 3px var(--color-brand), 0 0 0 9999px rgba(0,0,0,0.55)',
          }}
        />
      ) : (
        <div aria-hidden="true" className="fixed inset-0 z-[60] bg-black/55" />
      )}
      <div
        ref={cardRef}
        role="dialog"
        aria-modal="false"
        aria-labelledby={titleId}
        aria-describedby={bodyId}
        aria-label={t.dialogLabel}
        className={`fixed z-[61] flex flex-col gap-3 rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4 text-[var(--color-text)] shadow-xl ${cardClass}`}
        style={cardStyle}
      >
        <p className="text-xs text-[var(--color-text-muted)]">
          {t.stepOf} {formatNumber(index + 1)} {t.of} {formatNumber(total)}
        </p>
        <h2 id={titleId} className="text-lg font-bold">
          {text.title}
        </h2>
        <p id={bodyId} className="text-sm leading-7">
          {text.body}
        </p>
        <p className="text-xs text-[var(--color-text-muted)]">{t.keyHint}</p>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Button variant="ghost" onClick={() => onClose('skipped')}>
            {t.skip}
          </Button>
          <div className="flex gap-2">
            {index > 0 ? (
              <Button variant="secondary" onClick={() => onIndex(index - 1)}>
                {t.prev}
              </Button>
            ) : null}
            <Button
              data-tour-next=""
              onClick={() => (last ? onClose('completed') : onIndex(index + 1))}
            >
              {last ? t.finish : t.next}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Sidebar button that (re)starts the tour. */
export function TourButton() {
  const { start } = useTour();
  return (
    <Button variant="ghost" onClick={start} aria-label={fa.tour.helpLabel} title={fa.tour.help}>
      ؟
    </Button>
  );
}
