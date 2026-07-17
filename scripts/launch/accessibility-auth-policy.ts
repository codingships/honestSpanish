export type AccessibilityAuthRole = 'student' | 'teacher' | 'admin';

export type AuthLanding =
    | { kind: 'role-surface'; expectedPath: string }
    | { kind: 'adult-gate'; expectedPath: string }
    | { kind: 'unexpected'; expectedPath: string };

export const ADULT_CONFIRMATION_PATH = '/es/adult-confirmation';

const roleLandingPaths: Record<AccessibilityAuthRole, string> = {
    student: '/es/campus',
    teacher: '/es/campus/teacher',
    admin: '/es/campus/admin',
};

export function classifyAuthLanding(role: AccessibilityAuthRole, pathname: string): AuthLanding {
    const expectedPath = roleLandingPaths[role];
    const normalizedPath = normalizePathname(pathname);

    if (normalizedPath === expectedPath) {
        return { kind: 'role-surface', expectedPath };
    }
    if (role === 'student' && normalizedPath === ADULT_CONFIRMATION_PATH) {
        return { kind: 'adult-gate', expectedPath };
    }
    return { kind: 'unexpected', expectedPath };
}

export function describeStudentAdultGate(protectedRoutes: string[]): string {
    const routes = [...new Set(protectedRoutes)].join(', ');
    return [
        'The authenticated staging student was redirected by the 18+ policy.',
        `Axe audited ${ADULT_CONFIRMATION_PATH}; protected student route content was not audited in this run.`,
        `Routes protected by the audited gate: ${routes}.`,
        'A student whose adult attestation is already persisted is audited on those routes instead.',
    ].join(' ');
}

function normalizePathname(pathname: string): string {
    if (pathname.length > 1 && pathname.endsWith('/')) return pathname.slice(0, -1);
    return pathname;
}
