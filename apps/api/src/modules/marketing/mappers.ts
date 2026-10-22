import type { CampaignDto, CampaignStatus, LeadSourceDto } from '@ishan/contracts';
import { normalizeText } from '@ishan/contracts';

export const toLeadSourceDto = (s: {
  id: string;
  name: string;
  active: boolean;
  updatedAt: Date;
}): LeadSourceDto => ({
  id: s.id,
  name: s.name,
  active: s.active,
  updatedAt: s.updatedAt.toISOString(),
});

export const campaignInclude = {
  owner: { select: { id: true, name: true } },
  _count: { select: { leads: { where: { deletedAt: null } } } },
} as const;

const dateOnly = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

export function toCampaignDto(c: {
  id: string;
  name: string;
  channel: string | null;
  status: CampaignStatus;
  startDate: Date | null;
  endDate: Date | null;
  budget: bigint;
  owner: { id: string; name: string } | null;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
  _count: { leads: number };
}): CampaignDto {
  return {
    id: c.id,
    name: c.name,
    channel: c.channel,
    status: c.status,
    startDate: dateOnly(c.startDate),
    endDate: dateOnly(c.endDate),
    budget: c.budget.toString(),
    owner: c.owner,
    notes: c.notes,
    leadCount: c._count.leads,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
  };
}

export const campaignSearchText = (c: {
  name: string;
  channel?: string | null;
  notes?: string | null;
}) => normalizeText([c.name, c.channel, c.notes].filter(Boolean).join(' '));
