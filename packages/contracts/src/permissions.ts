/** Closed catalog of permissions. Roles store a subset of these keys. */
export const PERMISSIONS = {
  USERS_READ: 'users.read',
  USERS_WRITE: 'users.write',
  TEAMS_READ: 'teams.read',
  TEAMS_WRITE: 'teams.write',
  ROLES_READ: 'roles.read',
  ROLES_WRITE: 'roles.write',
  AUDIT_READ: 'audit.read',
  CUSTOMERS_READ: 'customers.read',
  CUSTOMERS_WRITE: 'customers.write',
  CUSTOMERS_DELETE: 'customers.delete',
  CUSTOMERS_IMPORT: 'customers.import',
  CUSTOMERS_EXPORT: 'customers.export',
  TAGS_WRITE: 'tags.write',
  LEADS_READ: 'leads.read',
  LEADS_WRITE: 'leads.write',
  LEADS_CONVERT: 'leads.convert',
  DEALS_READ: 'deals.read',
  DEALS_WRITE: 'deals.write',
  DEALS_DELETE: 'deals.delete',
  PIPELINE_MANAGE: 'pipeline.manage',
  ACTIVITIES_READ: 'activities.read',
  ACTIVITIES_WRITE: 'activities.write',
  ACTIVITIES_DELETE: 'activities.delete',
  /** Edit/complete/delete activities owned by other users. */
  ACTIVITIES_MANAGE_ALL: 'activities.manage_all',
  /** Organization-wide dashboard scope and reports (others only see their own numbers). */
  REPORTS_READ: 'reports.read',
  REPORTS_EXPORT: 'reports.export',
  PRODUCTS_READ: 'products.read',
  PRODUCTS_WRITE: 'products.write',
  QUOTES_READ: 'quotes.read',
  QUOTES_WRITE: 'quotes.write',
  QUOTES_DELETE: 'quotes.delete',
  CONTRACTS_READ: 'contracts.read',
  CONTRACTS_WRITE: 'contracts.write',
  CAMPAIGNS_READ: 'campaigns.read',
  CAMPAIGNS_WRITE: 'campaigns.write',
  CAMPAIGNS_DELETE: 'campaigns.delete',
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
      PERMISSIONS.CUSTOMERS_READ,
      PERMISSIONS.CUSTOMERS_WRITE,
      PERMISSIONS.CUSTOMERS_DELETE,
      PERMISSIONS.CUSTOMERS_IMPORT,
      PERMISSIONS.CUSTOMERS_EXPORT,
      PERMISSIONS.TAGS_WRITE,
      PERMISSIONS.LEADS_READ,
      PERMISSIONS.LEADS_WRITE,
      PERMISSIONS.LEADS_CONVERT,
      PERMISSIONS.DEALS_READ,
      PERMISSIONS.DEALS_WRITE,
      PERMISSIONS.DEALS_DELETE,
      PERMISSIONS.PIPELINE_MANAGE,
      PERMISSIONS.ACTIVITIES_READ,
      PERMISSIONS.ACTIVITIES_WRITE,
      PERMISSIONS.ACTIVITIES_DELETE,
      PERMISSIONS.ACTIVITIES_MANAGE_ALL,
      PERMISSIONS.REPORTS_READ,
      PERMISSIONS.REPORTS_EXPORT,
      PERMISSIONS.PRODUCTS_READ,
      PERMISSIONS.PRODUCTS_WRITE,
      PERMISSIONS.QUOTES_READ,
      PERMISSIONS.QUOTES_WRITE,
      PERMISSIONS.QUOTES_DELETE,
      PERMISSIONS.CONTRACTS_READ,
      PERMISSIONS.CONTRACTS_WRITE,
      PERMISSIONS.CAMPAIGNS_READ,
      PERMISSIONS.CAMPAIGNS_WRITE,
      PERMISSIONS.CAMPAIGNS_DELETE,
    ],
  },
  {
    key: 'sales',
    name: 'کارشناس فروش',
    description: 'کار با مشتریان و مخاطبان',
    permissions: [
      PERMISSIONS.TEAMS_READ,
      PERMISSIONS.CUSTOMERS_READ,
      PERMISSIONS.CUSTOMERS_WRITE,
      PERMISSIONS.TAGS_WRITE,
      PERMISSIONS.LEADS_READ,
      PERMISSIONS.LEADS_WRITE,
      PERMISSIONS.LEADS_CONVERT,
      PERMISSIONS.DEALS_READ,
      PERMISSIONS.DEALS_WRITE,
      PERMISSIONS.ACTIVITIES_READ,
      PERMISSIONS.ACTIVITIES_WRITE,
      PERMISSIONS.PRODUCTS_READ,
      PERMISSIONS.QUOTES_READ,
      PERMISSIONS.QUOTES_WRITE,
      PERMISSIONS.CONTRACTS_READ,
      PERMISSIONS.CAMPAIGNS_READ,
    ],
  },
  {
    key: 'viewer',
    name: 'مشاهده‌گر',
    description: 'فقط مشاهده',
    permissions: [
      PERMISSIONS.CUSTOMERS_READ,
      PERMISSIONS.LEADS_READ,
      PERMISSIONS.DEALS_READ,
      PERMISSIONS.ACTIVITIES_READ,
      PERMISSIONS.PRODUCTS_READ,
      PERMISSIONS.QUOTES_READ,
      PERMISSIONS.CONTRACTS_READ,
      PERMISSIONS.CAMPAIGNS_READ,
    ],
  },
];
