// Flexible permission toggles that can be granted to individual employees
// (e.g. to turn one into a "Supervisor") without a separate user role.
// Stored in profiles.permissions (jsonb). Add new keys here as new
// capabilities are built — no schema change needed.

export interface EmployeePermissions {
  supervisor?: boolean
  checkin_team?: boolean
  delete_team_photos?: boolean
  create_extras?: boolean
  close_payroll?: boolean
  track_mileage?: boolean
  manual_mileage?: boolean
  upload_receipts?: boolean
}

export const PERMISSION_KEYS = [
  'supervisor',
  'checkin_team',
  'delete_team_photos',
  'create_extras',
  'close_payroll',
  'track_mileage',
  'manual_mileage',
  'upload_receipts',
] as const

export type PermissionKey = (typeof PERMISSION_KEYS)[number]

export function hasPermission(permissions: EmployeePermissions | null | undefined, key: PermissionKey): boolean {
  return permissions?.[key] === true
}

export function hasAnyPermission(permissions: EmployeePermissions | null | undefined): boolean {
  return PERMISSION_KEYS.some(key => hasPermission(permissions, key))
}
