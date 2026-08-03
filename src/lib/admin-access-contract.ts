import type { Enums } from '../types/database.types';

export type AdminAccessRole = Enums<'admin_access_role'>;
export type AdminCapability = Enums<'admin_capability'>;

export const ADMIN_ACCESS_ROLES = [
    'owner',
    'content_editor',
    'catalog_editor',
    'operator',
    'finance',
    'viewer',
] as const satisfies readonly AdminAccessRole[];
