import { z } from 'zod';
import { EmailSchema } from './identity';
import { normalizePhone } from './text';

const optStr = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === '' ? undefined : v))
    .optional();

export const PhoneSchema = z
  .string()
  .trim()
  .transform((v) => normalizePhone(v))
  .refine((v) => /^\+?\d{5,15}$/.test(v), 'شماره تلفن نامعتبر است');
const optPhone = z
  .union([z.literal(''), PhoneSchema])
  .transform((v) => (v === '' ? undefined : v))
  .optional();
const optEmail = z
  .union([z.literal(''), EmailSchema])
  .transform((v) => (v === '' ? undefined : v))
  .optional();

export const CUSTOMER_KINDS = ['PERSON', 'ORGANIZATION'] as const;
export const CustomerKindSchema = z.enum(CUSTOMER_KINDS);
export type CustomerKind = z.infer<typeof CustomerKindSchema>;

const customerFields = {
  kind: CustomerKindSchema,
  name: z.string().trim().min(2, 'نام باید حداقل ۲ نویسه باشد').max(150),
  nationalId: optStr(20),
  economicCode: optStr(20),
  email: optEmail,
  phone: optPhone,
  website: optStr(200),
  province: optStr(60),
  city: optStr(60),
  address: optStr(500),
  notes: optStr(4000),
  ownerId: z.string().uuid().nullable().optional(),
};

export const CreateCustomerRequestSchema = z.object(customerFields);
export type CreateCustomerRequest = z.infer<typeof CreateCustomerRequestSchema>;

export const UpdateCustomerRequestSchema = z
  .object(
    Object.fromEntries(
      Object.entries(customerFields).map(([k, v]) => [k, (v as z.ZodTypeAny).optional()]),
    ) as { [K in keyof typeof customerFields]: z.ZodOptional<(typeof customerFields)[K]> },
  )
  .extend({
    // Allow clearing optional text fields with null on update.
    nationalId: z.string().trim().max(20).nullable().optional(),
    economicCode: z.string().trim().max(20).nullable().optional(),
    email: z.union([z.literal(''), EmailSchema]).nullable().optional(),
    phone: z.union([z.literal(''), PhoneSchema]).nullable().optional(),
    website: z.string().trim().max(200).nullable().optional(),
    province: z.string().trim().max(60).nullable().optional(),
    city: z.string().trim().max(60).nullable().optional(),
    address: z.string().trim().max(500).nullable().optional(),
    notes: z.string().trim().max(4000).nullable().optional(),
  });
export type UpdateCustomerRequest = z.infer<typeof UpdateCustomerRequestSchema>;

export const CustomerListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().uuid().optional(),
  q: z.string().trim().max(100).optional(),
  kind: CustomerKindSchema.optional(),
  tagId: z.string().uuid().optional(),
  ownerId: z.string().uuid().optional(),
});
export type CustomerListQuery = z.infer<typeof CustomerListQuerySchema>;

export const SetCustomerTagsRequestSchema = z.object({
  tagIds: z.array(z.string().uuid()).max(50),
});

export const TagColorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'رنگ نامعتبر است');
export const CreateTagRequestSchema = z.object({
  name: z.string().trim().min(1).max(40),
  color: TagColorSchema.default('#6366f1'),
});
export const UpdateTagRequestSchema = CreateTagRequestSchema.partial();

export const CreateContactRequestSchema = z.object({
  firstName: z.string().trim().min(1, 'نام الزامی است').max(80),
  lastName: z.string().trim().min(1, 'نام خانوادگی الزامی است').max(80),
  jobTitle: optStr(100),
  email: optEmail,
  phone: optPhone,
  mobile: optPhone,
  isPrimary: z.boolean().default(false),
  notes: optStr(2000),
});
export type CreateContactRequest = z.infer<typeof CreateContactRequestSchema>;
export const UpdateContactRequestSchema = z.object({
  firstName: z.string().trim().min(1).max(80).optional(),
  lastName: z.string().trim().min(1).max(80).optional(),
  jobTitle: z.string().trim().max(100).nullable().optional(),
  email: z.union([z.literal(''), EmailSchema]).nullable().optional(),
  phone: z.union([z.literal(''), PhoneSchema]).nullable().optional(),
  mobile: z.union([z.literal(''), PhoneSchema]).nullable().optional(),
  isPrimary: z.boolean().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
});

export const ImportCustomersRequestSchema = z.object({
  csv: z.string().min(1).max(2_000_000),
  dryRun: z.boolean().default(false),
});
export type ImportCustomersRequest = z.infer<typeof ImportCustomersRequestSchema>;

export interface ImportReport {
  dryRun: boolean;
  total: number;
  created: number;
  skipped: number;
  errors: Array<{ row: number; message: string }>;
}

export interface TagDto {
  id: string;
  name: string;
  color: string;
}

export interface ContactDto {
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
  createdAt: string;
}

export interface CustomerDto {
  id: string;
  kind: CustomerKind;
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
  owner: { id: string; name: string } | null;
  tags: TagDto[];
  createdAt: string;
  updatedAt: string;
}

export interface CustomerDetailDto extends CustomerDto {
  contacts: ContactDto[];
}

export interface SearchResultDto {
  customers: Array<{ id: string; name: string; kind: CustomerKind }>;
  contacts: Array<{ id: string; name: string; customerId: string | null }>;
}
