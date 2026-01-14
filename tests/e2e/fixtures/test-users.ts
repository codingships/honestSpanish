/**
 * Test Users for E2E Tests
 * These users must exist in the test database
 */
export const TEST_USERS = {
    student: {
        email: process.env.TEST_STUDENT_EMAIL || 'test-student@espanolhonesto.com',
        password: process.env.TEST_STUDENT_PASSWORD || 'TestPassword123!',
        name: 'Test Student',
    },
    teacher: {
        email: process.env.TEST_TEACHER_EMAIL || 'test-teacher@espanolhonesto.com',
        password: process.env.TEST_TEACHER_PASSWORD || 'TestPassword123!',
        name: 'Test Teacher',
    },
    admin: {
        email: process.env.TEST_ADMIN_EMAIL || 'test-admin@espanolhonesto.com',
        password: process.env.TEST_ADMIN_PASSWORD || 'TestPassword123!',
        name: 'Test Admin',
    },
};

export const TEST_PACKAGES = {
    esencial: {
        name: 'Esencial',
        sessionsPerMonth: 4,
    },
    intensivo: {
        name: 'Intensivo',
        sessionsPerMonth: 6,
    },
    premium: {
        name: 'Premium',
        sessionsPerMonth: 12,
    },
};

export type UserRole = keyof typeof TEST_USERS;
