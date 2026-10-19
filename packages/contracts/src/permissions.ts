/** Closed catalog of permissions. Roles store a subset of these keys. */
export const PERMISSIONS = {
  USERS_READ: 'users.read',
  USERS_WRITE: 'users.write',
  TEAMS_READ: 'teams.read',
  TEAMS_WRITE: 'teams.write',
  ROLES_READ: 'roles.read',
  ROLES_WRITE: 'roles.write',
  AUDIT_READ: 'audit.read',
} as const;

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];
export const ALL_PERMISSIONS = Object.values(PERMISSIONS) as Permission[];

export function isPermission(value: string): value is Permission {
  return (ALL_PERMISSIONS as string[]).includes(value);
}

export interface SystemRoleDefinition {
  key: string;
  name: string;
  description: string;
  permissions: Permission[];
}

export const SYSTEM_ROLES: SystemRoleDefinition[] = [
  {
    key: 'admin',
    name: 'مدیر سیستم',
    description: 'دسترسی کامل به همه بخش‌ها',
    permissions: ALL_PERMISSIONS,
  },
  {
    key: 'manager',
    name: 'مدیر فروش',
    description: 'مشاهده کاربران و مدیریت تیم‌ها',
    permissions: [
      PERMISSIONS.USERS_READ,
      PERMISSIONS.TEAMS_READ,
      PERMISSIONS.TEAMS_WRITE,
      PERMISSIONS.ROLES_READ,
      PERMISSIONS.AUDIT_READ,
    ],
  },
  {
    key: 'sales',
    name: 'کارشناس فروش',
    description: 'دسترسی عملیاتی به داده‌های فروش (در فازهای بعد)',
    permissions: [PERMISSIONS.TEAMS_READ],
  },
  {
    key: 'viewer',
    name: 'مشاهده‌گر',
    description: 'فقط مشاهده',
    permissions: [],
  },
];
