import { SUPER_ADMIN_ROLE_ID } from './role.schema';

/**
 * Every permission, with the description shown in the role editor.
 * Each one guards specific routes, so a new permission is added here with the feature that needs it.
 */
export const permissions = {
  'orders.view': 'List and view any order',
  'orders.manage': 'Change order status, and confirm or reject payments',
  'orders.refund': 'Record refunds',
  'products.view': 'See all products and variants, including inactive ones',
  'products.manage': 'Create and edit products, prices, variants, and images, and turn them off',
  'inventory.manage': 'Change variant stock only',
  'categories.manage': 'Create, edit, and delete categories',
  'blogs.manage': 'Write blogs and read drafts',
  'assets.manage': 'List, upload, and delete files',
  'payment_methods.manage': 'Manage payment methods and see account numbers',
  'reports.operations': 'Order status and low stock reports',
  'reports.sales': 'Sales summary, chart, and top products',
  'audit_logs.view': 'Read the audit log',
} as const;

export type Permission = keyof typeof permissions;

export const allPermissions = Object.keys(permissions) as Permission[];

/**
 * What a role can do. Super admins have every permission, including ones added later.
 * Names no longer in the list above are ignored, and the order always follows the list.
 */
export function resolvePermissions(
  roleId: string | null,
  granted: readonly string[] | null,
): Permission[] {
  if (roleId === SUPER_ADMIN_ROLE_ID) return allPermissions;
  return allPermissions.filter((permission) => granted?.includes(permission));
}
