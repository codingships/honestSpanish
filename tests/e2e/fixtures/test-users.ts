/**
 * Test Users for E2E Tests
 * These users must exist in the test database
 */
export const TEST_USERS = {
    student: {
        email: process.env.TEST_STUDENT_EMAIL || 'alindev95@gmail.com',
        password: process.env.TEST_STUDENT_PASSWORD || 'test123',
        name: 'Test Student',
    },
    teacher: {
        email: process.env.TEST_TEACHER_EMAIL || 'alinandrei74@gmail.com',
        password: process.env.TEST_TEACHER_PASSWORD || 'test123',
        name: 'Test Teacher',
    },
    admin: {
        email: process.env.TEST_ADMIN_EMAIL || 'alejandro@espanolhonesto.com',
        password: process.env.TEST_ADMIN_PASSWORD || 'test123',
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
