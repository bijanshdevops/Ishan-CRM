import type { EventHandler } from './events';

/**
 * Everything that reacts to a dispatched domain event (notifications, workflows, …, ADR 0011).
 * Each handler must be idempotent. Empty until the first consumer lands.
 */
export const EVENT_HANDLERS: EventHandler[] = [];
