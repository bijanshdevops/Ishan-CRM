import { PERMISSIONS, type NotificationDto, type Permission } from '@ishan/contracts';

/**
 * Where a notification leads. Returns null when the user may not open that area, so the bell never
 * offers a link that ends in "forbidden"; the text of the notification is still shown.
 */
export function notificationHref(
  n: Pick<NotificationDto, 'entityType' | 'entityId'>,
  can: (p: Permission) => boolean,
): string | null {
  if (!n.entityType || !n.entityId) return null;
  switch (n.entityType) {
    case 'customer':
      return can(PERMISSIONS.CUSTOMERS_READ) ? `/customers/${n.entityId}` : null;
    case 'lead':
      return can(PERMISSIONS.LEADS_READ) ? '/leads' : null;
    case 'deal':
      return can(PERMISSIONS.DEALS_READ) ? '/deals' : null;
    case 'quote':
      return can(PERMISSIONS.QUOTES_READ) ? `/quotes/${n.entityId}` : null;
    case 'contract':
      return can(PERMISSIONS.CONTRACTS_READ) ? `/contracts/${n.entityId}` : null;
    case 'activity':
      return can(PERMISSIONS.ACTIVITIES_READ) ? '/activities' : null;
    default:
      return null;
  }
}
