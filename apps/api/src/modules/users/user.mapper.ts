import type { SessionUserDto, UserDto } from '@ishan/contracts';

interface UserWithRole {
  id: string;
  email: string;
  name: string;
  status: 'ACTIVE' | 'DISABLED';
  mfaEnabled: boolean;
  mustChangePassword: boolean;
  lastLoginAt: Date | null;
  createdAt: Date;
  role: { id: string; key: string; name: string; permissions?: string[] };
}

export function toUserDto(u: UserWithRole): UserDto {
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    status: u.status,
    mfaEnabled: u.mfaEnabled,
    mustChangePassword: u.mustChangePassword,
    role: { id: u.role.id, key: u.role.key, name: u.role.name },
    lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
    createdAt: u.createdAt.toISOString(),
  };
}

export function toSessionUserDto(u: UserWithRole): SessionUserDto {
  return { ...toUserDto(u), permissions: u.role.permissions ?? [] };
}
