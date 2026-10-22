import { ForbiddenException, NotFoundException } from '@nestjs/common';
import type { AuthUser } from './decorators';

/**
 * The only place that decides which records a user may see (ADR 0017). Services never write their own
 * ownership conditions; they combine these fragments with `AND`.
 */
type Scoped = Pick<AuthUser, 'id' | 'scopeUserIds'>;

/** True when the user is not restricted to their own / their team's records. */
export const seesAll = (actor: Pick<AuthUser, 'scopeUserIds'>) => actor.scopeUserIds === null;

/** Condition on a column that holds the owner id (`owner_id`). `{}` = no restriction. */
export function ownerWhere(actor: Pick<AuthUser, 'scopeUserIds'>, field = 'ownerId') {
  return actor.scopeUserIds === null ? {} : { [field]: { in: actor.scopeUserIds } };
}

/** Activities belong to their assignee, or to the creator while nobody is assigned. */
export function activityScopeWhere(actor: Pick<AuthUser, 'scopeUserIds'>) {
  if (actor.scopeUserIds === null) return {};
  const ids = actor.scopeUserIds;
  return {
    OR: [{ assigneeId: { in: ids } }, { assigneeId: null, createdById: { in: ids } }],
  };
}

/** Is a record with this owner inside the user's scope? Unowned records are visible only to ALL. */
export function ownerInScope(actor: Pick<AuthUser, 'scopeUserIds'>, ownerId: string | null) {
  return actor.scopeUserIds === null || (ownerId !== null && actor.scopeUserIds.includes(ownerId));
}

/** Out of scope looks exactly like missing, so existence is never revealed. */
export function assertVisible(
  actor: Pick<AuthUser, 'scopeUserIds'>,
  ownerId: string | null,
  message: string,
): void {
  if (!ownerInScope(actor, ownerId)) throw new NotFoundException(message);
}

/**
 * Owner for a new record. A restricted user who names nobody becomes the owner (no orphans);
 * a named owner must be someone the user could reach (ALL: anyone, TEAM: a teammate, OWN: self).
 */
export function resolveOwner(
  actor: Scoped,
  requested: string | null | undefined,
): string | null | undefined {
  if (actor.scopeUserIds === null) return requested;
  if (requested === undefined || requested === null) return actor.id;
  assertCanAssign(actor, requested);
  return requested;
}

/** Reassigning a record: allowed only to users inside the actor's own scope. */
export function assertCanAssign(actor: Scoped, ownerId: string | null | undefined): void {
  if (actor.scopeUserIds === null || ownerId === null || ownerId === undefined) {
    if (actor.scopeUserIds !== null && ownerId === null) {
      throw new ForbiddenException({
        code: 'owner_out_of_scope',
        message: 'برای رکورد باید مالک مشخص شود.',
      });
    }
    return;
  }
  if (!actor.scopeUserIds.includes(ownerId)) {
    throw new ForbiddenException({
      code: 'owner_out_of_scope',
      message: 'فقط می‌توانید به خودتان یا هم‌تیمی‌هایتان واگذار کنید.',
    });
  }
}
