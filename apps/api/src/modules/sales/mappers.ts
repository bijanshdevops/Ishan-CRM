import type { DealDto, LeadDto, StageDto } from '@ishan/contracts';
import { normalizePhone, normalizeText } from '@ishan/contracts';

export const toStageDto = (s: {
  id: string;
  name: string;
  position: number;
  probability: number;
  kind: 'OPEN' | 'WON' | 'LOST';
}): StageDto => ({
  id: s.id,
  name: s.name,
  position: s.position,
  probability: s.probability,
  kind: s.kind,
});

export const leadInclude = {
  owner: { select: { id: true, name: true } },
  source: { select: { id: true, name: true } },
  campaign: { select: { id: true, name: true } },
} as const;

export function toLeadDto(l: {
  id: string;
  name: string;
  company: string | null;
  email: string | null;
  phone: string | null;
  source: { id: string; name: string } | null;
  campaign: { id: string; name: string } | null;
  status: LeadDto['status'];
  owner: { id: string; name: string } | null;
  notes: string | null;
  disqualifyReason: string | null;
  convertedAt: Date | null;
  convertedCustomerId: string | null;
  convertedDealId: string | null;
  createdAt: Date;
  updatedAt: Date;
}): LeadDto {
  return {
    id: l.id,
    name: l.name,
    company: l.company,
    email: l.email,
    phone: l.phone,
    source: l.source,
    campaign: l.campaign,
    status: l.status,
    owner: l.owner,
    notes: l.notes,
    disqualifyReason: l.disqualifyReason,
    convertedAt: l.convertedAt?.toISOString() ?? null,
    convertedCustomerId: l.convertedCustomerId,
    convertedDealId: l.convertedDealId,
    createdAt: l.createdAt.toISOString(),
    updatedAt: l.updatedAt.toISOString(),
  };
}

export function leadSearchText(l: {
  name: string;
  company?: string | null;
  email?: string | null;
  phone?: string | null;
  sourceName?: string | null;
}): string {
  return normalizeText(
    [l.name, l.company, l.email, l.phone && normalizePhone(l.phone), l.sourceName]
      .filter(Boolean)
      .join(' '),
  );
}

export const dealInclude = {
  customer: { select: { id: true, name: true } },
  contact: { select: { id: true, firstName: true, lastName: true } },
  stage: true,
  owner: { select: { id: true, name: true } },
} as const;

export function toDealDto(d: {
  id: string;
  title: string;
  amount: bigint;
  expectedCloseDate: Date | null;
  notes: string | null;
  lostReason: string | null;
  closedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  customer: { id: string; name: string };
  contact: { id: string; firstName: string; lastName: string } | null;
  stage: Parameters<typeof toStageDto>[0];
  owner: { id: string; name: string } | null;
}): DealDto {
  return {
    id: d.id,
    title: d.title,
    customer: d.customer,
    contact: d.contact
      ? { id: d.contact.id, name: `${d.contact.firstName} ${d.contact.lastName}` }
      : null,
    stage: toStageDto(d.stage),
    amount: d.amount.toString(),
    expectedCloseDate: d.expectedCloseDate?.toISOString().slice(0, 10) ?? null,
    owner: d.owner,
    notes: d.notes,
    lostReason: d.lostReason,
    closedAt: d.closedAt?.toISOString() ?? null,
    createdAt: d.createdAt.toISOString(),
    updatedAt: d.updatedAt.toISOString(),
  };
}
