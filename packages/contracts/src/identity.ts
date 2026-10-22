import { z } from 'zod';

export const EmailSchema = z.string().trim().toLowerCase().email().max(254);

export const PasswordSchema = z
  .string()
  .min(12, 'گذرواژه باید حداقل ۱۲ نویسه باشد')
  .max(128)
  .refine((v) => new Set(v).size >= 5, 'گذرواژه بیش از حد ساده است');

export const TotpCodeSchema = z.string().regex(/^\d{6}$/);

export const LoginRequestSchema = z.object({
  email: EmailSchema,
  password: z.string().min(1).max(128),
  totpCode: TotpCodeSchema.optional(),
});
export type LoginRequest = z.infer<typeof LoginRequestSchema>;

export const ChangePasswordRequestSchema = z.object({
  currentPassword: z.string().min(1).max(128),
  newPassword: PasswordSchema,
});

export const MfaEnableRequestSchema = z.object({ code: TotpCodeSchema });
export const MfaDisableRequestSchema = z.object({
  password: z.string().min(1).max(128),
  code: TotpCodeSchema,
});

export const CreateUserRequestSchema = z.object({
  email: EmailSchema,
  name: z.string().trim().min(2).max(100),
  roleId: z.string().uuid(),
  password: PasswordSchema,
  mustChangePassword: z.boolean().default(true),
});
export type CreateUserRequest = z.infer<typeof CreateUserRequestSchema>;

export const UpdateUserRequestSchema = z
  .object({
    name: z.string().trim().min(2).max(100),
    roleId: z.string().uuid(),
    status: z.enum(['ACTIVE', 'DISABLED']),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'حداقل یک فیلد لازم است');

export const ResetPasswordRequestSchema = z.object({ newPassword: PasswordSchema });

export const CreateTeamRequestSchema = z.object({
  name: z.string().trim().min(2).max(80),
  description: z.string().trim().max(500).optional(),
});
export const UpdateTeamRequestSchema = CreateTeamRequestSchema.partial().refine(
  (v) => Object.keys(v).length > 0,
  'حداقل یک فیلد لازم است',
);
export const AddTeamMemberRequestSchema = z.object({
  userId: z.string().uuid(),
  role: z.enum(['MEMBER', 'LEAD']).default('MEMBER'),
});

export const CreateRoleRequestSchema = z.object({
  key: z.string().regex(/^[a-z][a-z0-9_-]{1,38}$/, 'کلید نقش نامعتبر است'),
  name: z.string().trim().min(2).max(80),
  description: z.string().trim().max(300).optional(),
  permissions: z.array(z.string()).max(64),
  dataScope: z.enum(['ALL', 'TEAM', 'OWN']).default('ALL'),
});
export const UpdateRoleRequestSchema = z
  .object({
    name: z.string().trim().min(2).max(80),
    description: z.string().trim().max(300),
    permissions: z.array(z.string()).max(64),
    dataScope: z.enum(['ALL', 'TEAM', 'OWN']),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'حداقل یک فیلد لازم است');

export const ListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().uuid().optional(),
  q: z.string().trim().max(100).optional(),
});
export type ListQuery = z.infer<typeof ListQuerySchema>;

export interface UserDto {
  id: string;
  email: string;
  name: string;
  status: 'ACTIVE' | 'DISABLED';
  mfaEnabled: boolean;
  mustChangePassword: boolean;
  role: { id: string; key: string; name: string };
  lastLoginAt: string | null;
  createdAt: string;
}

export interface SessionUserDto extends UserDto {
  permissions: string[];
}

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}
