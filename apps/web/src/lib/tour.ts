import { PERMISSIONS, type Permission } from '@ishan/contracts';

/**
 * Pure logic of the guided tour (UI lives in `components/tour.tsx`).
 * A step points at a sidebar link by its `href` (`data-tour="<href>"`); the tour only
 * walks through the links the signed-in user can actually see.
 */

export type TourTarget =
  | '/'
  | '/customers'
  | '/leads'
  | '/campaigns'
  | '/deals'
  | '/quotes'
  | '/activities'
  | '/workflows'
  | '/teams';

/** Same permissions the sidebar uses to show each link (null = always visible). */
const STEP_PERMISSION: Record<TourTarget, Permission | null> = {
  '/': null,
  '/customers': PERMISSIONS.CUSTOMERS_READ,
  '/leads': PERMISSIONS.LEADS_READ,
  '/campaigns': PERMISSIONS.CAMPAIGNS_READ,
  '/deals': PERMISSIONS.DEALS_READ,
  '/quotes': PERMISSIONS.QUOTES_READ,
  '/activities': PERMISSIONS.ACTIVITIES_READ,
  '/workflows': PERMISSIONS.WORKFLOWS_READ,
  '/teams': PERMISSIONS.TEAMS_READ,
};

export const TOUR_ORDER = Object.keys(STEP_PERMISSION) as TourTarget[];

export type TourStep =
  | { kind: 'welcome' }
  | { kind: 'target'; target: TourTarget }
  | { kind: 'done' };

/** Welcome, then one step per visible area (in sidebar order), then the closing step. */
export function buildTourSteps(can: (p: Permission) => boolean): TourStep[] {
  const targets = TOUR_ORDER.filter((t) => {
    const p = STEP_PERMISSION[t];
    return p === null || can(p);
  });
  return [
    { kind: 'welcome' },
    ...targets.map((target) => ({ kind: 'target', target }) as const),
    { kind: 'done' },
  ];
}

export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

export type Placement =
  | { mode: 'center' }
  | { mode: 'bottom' }
  | { mode: 'side'; left: number; top: number };

export const POPOVER_WIDTH = 320;
export const POPOVER_GAP = 14;
const MARGIN = 8;
/** Below this viewport width the sidebar becomes a horizontal strip and the card docks to the bottom. */
export const WIDE_VIEWPORT = 768;

/**
 * Where the explanation card goes. The sidebar sits at the inline-start edge (right in RTL),
 * so on wide screens the card opens toward the content, beside the highlighted link.
 * Without a target it is centred; on narrow screens (or when it would not fit) it docks to the bottom.
 */
export function placePopover(
  target: Box | null,
  viewport: { width: number; height: number },
  popoverHeight = 220,
): Placement {
  if (!target) return { mode: 'center' };
  if (viewport.width < WIDE_VIEWPORT) return { mode: 'bottom' };
  const left = target.left - POPOVER_GAP - POPOVER_WIDTH;
  if (left < MARGIN) return { mode: 'bottom' };
  const centred = target.top + target.height / 2 - popoverHeight / 2;
  const top = Math.min(
    Math.max(MARGIN, centred),
    Math.max(MARGIN, viewport.height - popoverHeight - MARGIN),
  );
  return { mode: 'side', left, top };
}

export const stepCount = (steps: readonly TourStep[]) => steps.length;

export const clampStep = (i: number, total: number) =>
  Math.min(Math.max(0, i), Math.max(0, total - 1));

/** What the arrow keys do. In RTL the "next" step is to the inline-end, i.e. the left arrow. */
export function stepForKey(
  key: string,
  i: number,
  total: number,
  rtl = true,
): number | 'close' | null {
  if (key === 'Escape') return 'close';
  const forward = rtl ? 'ArrowLeft' : 'ArrowRight';
  const back = rtl ? 'ArrowRight' : 'ArrowLeft';
  if (key === forward) return i >= total - 1 ? 'close' : i + 1;
  if (key === back) return clampStep(i - 1, total);
  return null;
}

/* ── per-user, per-browser memory (nothing is sent to the server) ── */

export type TourMemory = 'completed' | 'skipped';

const tourKey = (userId: string) => `ishan.tour.v1.${userId}`;
const cardKey = (userId: string) => `ishan.gettingStarted.dismissed.v1.${userId}`;

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function write(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* storage unavailable (private mode, blocked): the tour still works, it just is not remembered */
  }
}

export const readTourMemory = (userId: string): TourMemory | null => {
  const v = read(tourKey(userId));
  return v === 'completed' || v === 'skipped' ? v : null;
};
export const writeTourMemory = (userId: string, v: TourMemory) => write(tourKey(userId), v);
export const isCardDismissed = (userId: string) => read(cardKey(userId)) === '1';
export const dismissCard = (userId: string) => write(cardKey(userId), '1');
