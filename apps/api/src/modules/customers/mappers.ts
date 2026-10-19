import type { ContactDto, CustomerDto, TagDto } from '@ishan/contracts';
import { normalizePhone, normalizeText } from '@ishan/contracts';

export const customerInclude = {
  owner: { select: { id: true, name: true } },
  tags: { include: { tag: true } },
} as const;

type CustomerRow = {
  id: string;
  kind: 'PERSON' | 'ORGANIZATION';
  name: string;
  nationalId: string | null;
  economicCode: string | null;
  email: string | null;
  phone: string | null;
  website: string | null;
  province: string | null;
  city: string | null;
  address: string | null;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
  owner: { id: string; name: string } | null;
  tags: Array<{ tag: { id: string; name: string; color: string } }>;
};

export function toTagDto(t: { id: string; name: string; color: string }): TagDto {
  return { id: t.id, name: t.name, color: t.color };
}

export function toCustomerDto(c: CustomerRow): CustomerDto {
  return {
    id: c.id,
    kind: c.kind,
    name: c.name,
    nationalId: c.nationalId,
    economicCode: c.economicCode,
    email: c.email,
    phone: c.phone,
    website: c.website,
    province: c.province,
    city: c.city,
    address: c.address,
    notes: c.notes,
    owner: c.owner,
    tags: c.tags.map((t) => toTagDto(t.tag)).sort((a, b) => a.name.localeCompare(b.name, 'fa')),
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
  };
}

export function toContactDto(c: {
  id: string;
  customerId: string | null;
  firstName: string;
  lastName: string;
  jobTitle: string | null;
  email: string | null;
  phone: string | null;
  mobile: string | null;
  isPrimary: boolean;
  notes: string | null;
  createdAt: Date;
}): ContactDto {
  return {
    id: c.id,
    customerId: c.customerId,
    firstName: c.firstName,
    lastName: c.lastName,
    jobTitle: c.jobTitle,
    email: c.email,
    phone: c.phone,
    mobile: c.mobile,
    isPrimary: c.isPrimary,
    notes: c.notes,
    createdAt: c.createdAt.toISOString(),
  };
}

export function customerSearchText(c: {
  name: string;
  nationalId?: string | null;
  economicCode?: string | null;
  email?: string | null;
  phone?: string | null;
  city?: string | null;
}): string {
  return normalizeText(
    [c.name, c.nationalId, c.economicCode, c.email, c.phone && normalizePhone(c.phone), c.city]
      .filter(Boolean)
      .join(' '),
  );
}

export function contactSearchText(c: {
  firstName: string;
  lastName: string;
  email?: string | null;
  phone?: string | null;
  mobile?: string | null;
  jobTitle?: string | null;
}): string {
  return normalizeText(
    [
      c.firstName,
      c.lastName,
      c.jobTitle,
      c.email,
      c.phone && normalizePhone(c.phone),
      c.mobile && normalizePhone(c.mobile),
    ]
      .filter(Boolean)
      .join(' '),
  );
}

/** Converts update payload null/'' to null for DB. */
export function nullify<T>(v: T | null | undefined): T | null | undefined {
  if (v === undefined) return undefined;
  if (v === null || (typeof v === 'string' && v === '')) return null;
  return v;
}
