import { PERMISSIONS, type Permission } from '@ishan/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  POPOVER_WIDTH,
  buildTourSteps,
  clampStep,
  dismissCard,
  isCardDismissed,
  placePopover,
  readTourMemory,
  stepForKey,
  writeTourMemory,
} from './tour';

const only =
  (...ps: Permission[]) =>
  (p: Permission) =>
    ps.includes(p);
const targets = (can: (p: Permission) => boolean) =>
  buildTourSteps(can).flatMap((s) => (s.kind === 'target' ? [s.target] : []));

describe('buildTourSteps', () => {
  it('always opens with the welcome and closes with the done step', () => {
    const steps = buildTourSteps(() => false);
    expect(steps[0]).toEqual({ kind: 'welcome' });
    expect(steps.at(-1)).toEqual({ kind: 'done' });
  });

  it('shows only the home step to a user with no permissions', () => {
    expect(targets(() => false)).toEqual(['/']);
  });

  it('includes exactly the areas the user may read, in sidebar order', () => {
    const can = only(PERMISSIONS.DEALS_READ, PERMISSIONS.CUSTOMERS_READ, PERMISSIONS.TEAMS_READ);
    expect(targets(can)).toEqual(['/', '/customers', '/deals', '/teams']);
  });

  it('walks every area for a user who can read everything', () => {
    expect(targets(() => true)).toHaveLength(9);
  });
});

describe('placePopover', () => {
  const vp = { width: 1280, height: 800 };
  const link = { left: 1000, top: 300, width: 220, height: 40 };

  it('centres the card when there is nothing to point at', () => {
    expect(placePopover(null, vp)).toEqual({ mode: 'center' });
  });

  it('opens beside the sidebar link toward the content on wide screens', () => {
    const p = placePopover(link, vp, 200);
    expect(p).toEqual({ mode: 'side', left: 1000 - 14 - POPOVER_WIDTH, top: 220 });
  });

  it('keeps the card inside the viewport vertically', () => {
    const near = placePopover({ ...link, top: 780 }, vp, 200);
    expect(near.mode === 'side' && near.top).toBe(800 - 200 - 8);
    const top = placePopover({ ...link, top: 0 }, vp, 200);
    expect(top.mode === 'side' && top.top).toBe(8);
  });

  it('docks to the bottom on narrow screens or when the side has no room', () => {
    expect(placePopover(link, { width: 390, height: 800 })).toEqual({ mode: 'bottom' });
    expect(placePopover({ ...link, left: 100 }, vp)).toEqual({ mode: 'bottom' });
  });
});

describe('stepForKey', () => {
  it('maps RTL arrows: left goes forward, right goes back', () => {
    expect(stepForKey('ArrowLeft', 1, 5)).toBe(2);
    expect(stepForKey('ArrowRight', 1, 5)).toBe(0);
  });

  it('flips for LTR documents', () => {
    expect(stepForKey('ArrowRight', 1, 5, false)).toBe(2);
    expect(stepForKey('ArrowLeft', 1, 5, false)).toBe(0);
  });

  it('never goes below the first step and closes after the last', () => {
    expect(stepForKey('ArrowRight', 0, 5)).toBe(0);
    expect(stepForKey('ArrowLeft', 4, 5)).toBe('close');
  });

  it('closes on Escape and ignores other keys', () => {
    expect(stepForKey('Escape', 2, 5)).toBe('close');
    expect(stepForKey('a', 2, 5)).toBeNull();
  });

  it('clamps indexes', () => {
    expect(clampStep(-3, 4)).toBe(0);
    expect(clampStep(9, 4)).toBe(3);
    expect(clampStep(0, 0)).toBe(0);
  });
});

describe('tour memory', () => {
  afterEach(() => vi.unstubAllGlobals());

  const fakeStorage = () => {
    const m = new Map<string, string>();
    return {
      getItem: (k: string) => m.get(k) ?? null,
      setItem: (k: string, v: string) => void m.set(k, v),
    };
  };

  it('remembers per user and ignores unknown values', () => {
    const s = fakeStorage();
    vi.stubGlobal('localStorage', s);
    expect(readTourMemory('u1')).toBeNull();
    writeTourMemory('u1', 'completed');
    expect(readTourMemory('u1')).toBe('completed');
    expect(readTourMemory('u2')).toBeNull();
    s.setItem('ishan.tour.v1.u3', 'garbage');
    expect(readTourMemory('u3')).toBeNull();
  });

  it('remembers that the getting-started card was dismissed, per user', () => {
    vi.stubGlobal('localStorage', fakeStorage());
    expect(isCardDismissed('u1')).toBe(false);
    dismissCard('u1');
    expect(isCardDismissed('u1')).toBe(true);
    expect(isCardDismissed('u2')).toBe(false);
  });

  it('degrades silently when storage throws', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    });
    expect(readTourMemory('u1')).toBeNull();
    expect(() => writeTourMemory('u1', 'skipped')).not.toThrow();
    expect(isCardDismissed('u1')).toBe(false);
    expect(() => dismissCard('u1')).not.toThrow();
  });
});
