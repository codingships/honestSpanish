import { defineConfig, devices } from '@playwright/test';
import dotenv from 'dotenv';

// Cargar variables de entorno de .env.test
dotenv.config({ path: '.env.test' });

export default defineConfig({
    testDir: './tests/e2e',
    fullyParallel: true,
    forbidOnly: !!process.env.CI,
    retries: process.env.CI ? 2 : 0,
    workers: process.env.CI ? 1 : undefined,
    reporter: 'html',
    use: {
        baseURL: process.env.TEST_BASE_URL || 'http://localhost:4321',
        trace: 'on-first-retry',
        // Guardar estado de autenticación
        storageState: undefined,
    },
    projects: [
        // Proyecto para tests sin autenticación
        {
            name: 'public',
            testMatch: /.*\.public\.spec\.ts/,
            use: { ...devices['Desktop Chrome'] },
        },
        // Proyecto para tests de estudiante
        {
            name: 'student',
            testMatch: /.*\.student\.spec\.ts/,
            use: {
                ...devices['Desktop Chrome'],
                storageState: 'tests/e2e/.auth/student.json',
            },
            dependencies: ['student-setup'],
        },
        // Proyecto para tests de profesor
        {
            name: 'teacher',
            testMatch: /.*\.teacher\.spec\.ts/,
            use: {
                ...devices['Desktop Chrome'],
                storageState: 'tests/e2e/.auth/teacher.json',
            },
            dependencies: ['teacher-setup'],
        },
        // Proyecto para tests de admin
        {
            name: 'admin',
            testMatch: /.*\.admin\.spec\.ts/,
            use: {
                ...devices['Desktop Chrome'],
                storageState: 'tests/e2e/.auth/admin.json',
            },
            dependencies: ['admin-setup'],
        },
        // Setup de autenticación
        {
            name: 'student-setup',
            testMatch: /student\.setup\.ts/,
            use: { ...devices['Desktop Chrome'] },
        },
        {
            name: 'teacher-setup',
            testMatch: /teacher\.setup\.ts/,
            use: { ...devices['Desktop Chrome'] },
        },
        {
            name: 'admin-setup',
            testMatch: /admin\.setup\.ts/,
            use: { ...devices['Desktop Chrome'] },
        },
    ],
    webServer: {
        command: 'npm run dev',
        url: 'http://localhost:4321',
        reuseExistingServer: !process.env.CI,
    },
});