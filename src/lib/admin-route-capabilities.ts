import type { AdminCapability } from './admin-access-contract';

function isReadMethod(method: string): boolean {
    return ['GET', 'HEAD', 'OPTIONS'].includes(method.toUpperCase());
}

/** Central capability map for administrator-only HTTP surfaces. */
export function requiredAdminCapabilityForRequest(
    pathname: string,
    method: string,
): AdminCapability | null {
    const read = isReadMethod(method);

    if (pathname.startsWith('/api/admin/')) {
        const domain = pathname.split('/').filter(Boolean)[2];
        if (domain === 'access') return read ? 'access.read' : 'access.write';
        if (domain === 'audit') return 'access.read';
        if (domain === 'content') return read ? 'content.read' : 'content.write';
        if (['packages', 'catalog-v2'].includes(domain)) {
            return read ? 'catalog.read' : 'catalog.write';
        }
        if (['profitability', 'teacher-compensation', 'guarantees'].includes(domain)) {
            return read ? 'finance.read' : 'finance.write';
        }
        return read ? 'operations.read' : 'operations.write';
    }

    if (pathname === '/api/email/preview-frame') return 'content.read';
    if (pathname === '/api/email/send-test') return 'content.write';
    if (pathname === '/api/google/create-student-folder') return 'operations.write';
    if (pathname === '/api/test/full-class-flow') return 'operations.write';
    if (pathname === '/api/internal/staging-e2e-checkout') return 'operations.write';

    return null;
}

/** Read capability needed to render one localized administrator page. */
export function requiredAdminCapabilityForCampusPath(
    pathname: string,
): AdminCapability | null {
    const segments = pathname.split('/').filter(Boolean);
    if (segments[1] !== 'campus' || segments[2] !== 'admin') return null;

    const domain = segments[3];
    if (!domain) return 'dashboard.read';
    if (domain === 'packages') return 'catalog.read';
    if (domain === 'content') return 'content.read';
    if (domain === 'emails') return 'content.read';
    if (domain === 'access') return 'access.read';
    if (domain === 'audit') return 'access.read';
    if (['payments', 'profitability', 'compensation', 'guarantees'].includes(domain)) {
        return 'finance.read';
    }
    return 'operations.read';
}

/** Capability required only when the authenticated actor is an administrator. */
export function requiredAdminActorCapabilityForRequest(
    pathname: string,
    method: string,
): AdminCapability | null {
    const read = isReadMethod(method);

    if (pathname === '/api/update-student-notes') return 'operations.write';
    if (pathname === '/api/drive/append-homework') return 'operations.write';
    if (pathname === '/api/teacher/availability') {
        return read ? 'operations.read' : 'operations.write';
    }
    if (pathname === '/api/teacher/compensation-export') return 'finance.read';
    if (pathname === '/api/calendar/available-slots') return 'operations.read';
    if (pathname === '/api/calendar/sessions') {
        return read ? 'operations.read' : 'operations.write';
    }
    if (
        pathname === '/api/calendar/recurring-sessions'
        || pathname === '/api/calendar/bulk-sessions'
        || pathname === '/api/calendar/session-action'
    ) {
        return 'operations.write';
    }

    return null;
}
