/**
 * Test Users for E2E Tests
 * These users must exist in the test database
 */
function requiredCredential(name: string): string {
    const value = process.env[name]?.trim();
    if (!value) throw new Error(`[e2e-users] Missing required ${name}; hardcoded credential fallbacks are forbidden.`);
    return value;
}

export const TEST_USERS = {
    student: {
        email: requiredCredential('TEST_STUDENT_EMAIL'),
        password: requiredCredential('TEST_STUDENT_PASSWORD'),
        name: 'Test Student',
    },
    teacher: {
        email: requiredCredential('TEST_TEACHER_EMAIL'),
        password: requiredCredential('TEST_TEACHER_PASSWORD'),
        name: 'Test Teacher',
    },
    admin: {
        email: requiredCredential('TEST_ADMIN_EMAIL'),
        password: requiredCredential('TEST_ADMIN_PASSWORD'),
        name: 'Test Admin',
    },
};

export const TEST_PACKAGES = {
    group: {
        name: 'Grupal Externo',
        sessionsPerMonth: 4,
    },
    standard: {
        name: 'Mensual Estándar',
        sessionsPerMonth: 4,
    },
    hybrid: {
        name: 'Híbrido Mensual',
        sessionsPerMonth: 4,
    },
    bootcamp: {
        name: 'Intensivo Bootcamp',
        sessionsPerMonth: 20,
    },
};

export type UserRole = keyof typeof TEST_USERS;
