import { PERMISSIONS, type Permission } from '@ishan/contracts';

export const DEMO_ROLE_KEY = 'demo';
export const DEMO_USER_EMAIL = 'demo@ishan-demo.invalid';
export const DEMO_USER_NAME = 'کاربر دمو';

/**
 * What a visitor of the public demo may do: everything about customers and sales, nothing about the system
 * itself. Missing on purpose: users, roles, audit, webhooks, campaign sending, imports/exports (bulk data
 * leaving or entering), pipeline configuration.
 */
export const DEMO_PERMISSIONS: Permission[] = [
  PERMISSIONS.TEAMS_READ,
  PERMISSIONS.CUSTOMERS_READ,
  PERMISSIONS.CUSTOMERS_WRITE,
  PERMISSIONS.CUSTOMERS_DELETE,
  PERMISSIONS.TAGS_WRITE,
  PERMISSIONS.LEADS_READ,
  PERMISSIONS.LEADS_WRITE,
  PERMISSIONS.LEADS_CONVERT,
  PERMISSIONS.DEALS_READ,
  PERMISSIONS.DEALS_WRITE,
  PERMISSIONS.DEALS_DELETE,
  PERMISSIONS.ACTIVITIES_READ,
  PERMISSIONS.ACTIVITIES_WRITE,
  PERMISSIONS.ACTIVITIES_DELETE,
  PERMISSIONS.ACTIVITIES_MANAGE_ALL,
  PERMISSIONS.REPORTS_READ,
  PERMISSIONS.PRODUCTS_READ,
  PERMISSIONS.PRODUCTS_WRITE,
  PERMISSIONS.QUOTES_READ,
  PERMISSIONS.QUOTES_WRITE,
  PERMISSIONS.QUOTES_DELETE,
  PERMISSIONS.CONTRACTS_READ,
  PERMISSIONS.CONTRACTS_WRITE,
  PERMISSIONS.CAMPAIGNS_READ,
  PERMISSIONS.CAMPAIGNS_WRITE,
  PERMISSIONS.WORKFLOWS_READ,
];

/** Tables holding visitor-editable business data; emptied by every reset. Users, roles and sessions stay. */
export const DEMO_RESET_TABLES = [
  'team_members',
  'teams',
  'quote_emails',
  'quote_items',
  'contracts',
  'quotes',
  'products',
  'activities',
  'deal_stage_events',
  'deals',
  'customer_tags',
  'tags',
  'contacts',
  'leads',
  'campaign_recipients',
  'campaign_sendings',
  'campaigns',
  'customers',
  'notifications',
  'workflow_runs',
  'workflows',
  'domain_events',
  'document_counters',
  'audit_logs',
  'email_deliveries',
  'marketing_suppressions',
  'webhook_deliveries',
  'webhook_endpoints',
] as const;

/** Routes a demo visitor must not use even though they are open to every signed-in user. */
export const DEMO_BLOCKED_ROUTES: RegExp[] = [
  /^\/api\/v1\/auth\/change-password$/,
  /^\/api\/v1\/auth\/mfa\//,
];
