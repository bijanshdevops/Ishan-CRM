import type { ActivityDto } from '@ishan/contracts';
import { normalizeText } from '@ishan/contracts';

export const activityInclude = {
  assignee: { select: { id: true, name: true } },
  createdBy: { select: { id: true, name: true } },
  customer: { select: { id: true, name: true } },
  contact: { select: { id: true, firstName: true, lastName: true } },
  deal: { select: { id: true, title: true } },
} as const;

type Row = {
  id: string;
  type: ActivityDto['type'];
  status: ActivityDto['status'];
  priority: ActivityDto['priority'];
  title: string;
  description: string | null;
  dueAt: Date | null;
  endAt: Date | null;
  completedAt: Date | null;
  outcome: string | null;
  remindAt: Date | null;
  reminderDismissedAt: Date | null;
  assignee: { id: string; name: string } | null;
  createdBy: { id: string; name: string } | null;
  customer: { id: string; name: string } | null;
  contact: { id: string; firstName: string; lastName: string } | null;
  deal: { id: string; title: string } | null;
  createdAt: Date;
  updatedAt: Date;
};

export function toActivityDto(a: Row, now: Date = new Date()): ActivityDto {
  return {
    id: a.id,
    type: a.type,
    status: a.status,
    priority: a.priority,
    title: a.title,
    description: a.description,
    dueAt: a.dueAt?.toISOString() ?? null,
    endAt: a.endAt?.toISOString() ?? null,
    completedAt: a.completedAt?.toISOString() ?? null,
    outcome: a.outcome,
    remindAt: a.remindAt?.toISOString() ?? null,
    reminderDismissed: a.reminderDismissedAt !== null,
    overdue: a.status === 'PLANNED' && a.dueAt !== null && a.dueAt.getTime() < now.getTime(),
    assignee: a.assignee,
    customer: a.customer,
    contact: a.contact
      ? { id: a.contact.id, name: `${a.contact.firstName} ${a.contact.lastName}`.trim() }
      : null,
    deal: a.deal,
    createdBy: a.createdBy,
    createdAt: a.createdAt.toISOString(),
    updatedAt: a.updatedAt.toISOString(),
  };
}

export function activitySearchText(a: {
  title: string;
  description?: string | null;
  outcome?: string | null;
}): string {
  return normalizeText([a.title, a.description, a.outcome].filter(Boolean).join(' '));
}
