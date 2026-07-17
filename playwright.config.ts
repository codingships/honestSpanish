import { defineConfig, devices } from '@playwright/test';
import { configurePlaywrightEnvironment } from './tests/e2e/environment-guard';

configurePlaywrightEnvironment();

const configuredWorkers = Number.parseInt(process.env.PLAYWRIGHT_WORKERS ?? '1', 10);
const workerCount = Number.isInteger(configuredWorkers) && configuredWorkers > 0 ? configuredWorkers : 1;

export default defineConfig({
    testDir: './tests/e2e',
    fullyParallel: true,
    forbidOnly: !!process.env.CI,
    retries: process.env.CI ? 2 : 0,
    workers: workerCount,

    // Enhanced reporter for max observability
    reporter: [
        ['list', { printSteps: true }],
        ['html', { open: 'never', outputFolder: 'playwright-report' }],
        ['json', { outputFile: 'test-results/results.json' }],
    ],

    // Global timeout settings
    timeout: 60000,
    expect: {
        timeout: 10000,
    },

    use: {
        baseURL: process.env.TEST_BASE_URL || 'http://localhost:4321',

        // Maximum observability settings
        trace: 'on', // Always record trace
        screenshot: 'on', // Screenshot on every test
        video: 'on-first-retry', // Video on retry

        // Console and network logging
        bypassCSP: true,

        // Guardar estado de autenticación
        storageState: undefined,

        // Action timeout
        actionTimeout: 15000,
        navigationTimeout: 30000,
    },

    // Output directory for artifacts
    outputDir: 'test-results/artifacts',
    globalSetup: './tests/e2e/global-setup.ts',
    globalTeardown: './tests/e2e/global-teardown.ts',

    projects: [
        // =====================
        // CHROME PROJECTS
        // =====================

        // Tests sin autenticación - Chrome
        {
            name: 'public',
            testMatch: /.*\.public\.spec\.ts/,
            use: { ...devices['Desktop Chrome'] },
        },
        // Tests de estudiante - Chrome
        {
            name: 'student',
            testMatch: /.*\.student\.spec\.ts/,
            use: {
                ...devices['Desktop Chrome'],
                storageState: 'tests/e2e/.auth/student.json',
            },
            dependencies: ['student-setup'],
        },
        // Tests de profesor - Chrome
        {
            name: 'teacher',
            testMatch: /.*\.teacher\.spec\.ts/,
            use: {
                ...devices['Desktop Chrome'],
                storageState: 'tests/e2e/.auth/teacher.json',
            },
            dependencies: ['teacher-setup'],
        },
        // Tests de admin - Chrome
        {
            name: 'admin',
            testMatch: /.*\.admin\.spec\.ts/,
            use: {
                ...devices['Desktop Chrome'],
                storageState: 'tests/e2e/.auth/admin.json',
            },
            dependencies: ['admin-setup'],
        },

        // =====================
        // FIREFOX PROJECTS
        // =====================

        // Tests públicos - Firefox
        {
            name: 'public-firefox',
            testMatch: /.*\.public\.spec\.ts/,
            use: { ...devices['Desktop Firefox'] },
        },
        // Tests de estudiante - Firefox
        {
            name: 'student-firefox',
            testMatch: /.*\.student\.spec\.ts/,
            use: {
                ...devices['Desktop Firefox'],
                storageState: 'tests/e2e/.auth/student.json',
            },
            dependencies: ['student-setup'],
        },
        // Tests de profesor - Firefox
        {
            name: 'teacher-firefox',
            testMatch: /.*\.teacher\.spec\.ts/,
            use: {
                ...devices['Desktop Firefox'],
                storageState: 'tests/e2e/.auth/teacher.json',
            },
            dependencies: ['teacher-setup'],
        },
        // Tests de admin - Firefox
        {
            name: 'admin-firefox',
            testMatch: /.*\.admin\.spec\.ts/,
            use: {
                ...devices['Desktop Firefox'],
                storageState: 'tests/e2e/.auth/admin.json',
            },
            dependencies: ['admin-setup'],
        },

        // =====================
        // WEBKIT (SAFARI) PROJECTS
        // =====================

        // Tests públicos - Safari
        {
            name: 'public-webkit',
            testMatch: /.*\.public\.spec\.ts/,
            use: { ...devices['Desktop Safari'] },
        },
        // Tests de estudiante - Safari
        {
            name: 'student-webkit',
            testMatch: /.*\.student\.spec\.ts/,
            use: {
                ...devices['Desktop Safari'],
                storageState: 'tests/e2e/.auth/student.json',
            },
            dependencies: ['student-setup'],
        },
        // Tests de profesor - Safari
        {
            name: 'teacher-webkit',
            testMatch: /.*\.teacher\.spec\.ts/,
            use: {
                ...devices['Desktop Safari'],
                storageState: 'tests/e2e/.auth/teacher.json',
            },
            dependencies: ['teacher-setup'],
        },
        // Tests de admin - Safari
        {
            name: 'admin-webkit',
            testMatch: /.*\.admin\.spec\.ts/,
            use: {
                ...devices['Desktop Safari'],
                storageState: 'tests/e2e/.auth/admin.json',
            },
            dependencies: ['admin-setup'],
        },

        // =====================
        // MOBILE PROJECTS
        // =====================

        // Tests públicos - Mobile Chrome (Android)
        {
            name: 'public-mobile-chrome',
            testMatch: /.*\.public\.spec\.ts/,
            use: { ...devices['Pixel 5'] },
        },
        // Tests públicos - Mobile Safari (iPhone)
        {
            name: 'public-mobile-safari',
            testMatch: /.*\.public\.spec\.ts/,
            use: { ...devices['iPhone 13'] },
        },

        // =====================
        // SETUP PROJECTS
        // =====================

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
        command: 'node tests/e2e/start-server.mjs',
        // Probe a provider-free, React-free endpoint. Probing `/` follows the
        // redirect to `/es` while Vite is still settling its SSR optimizer and
        // can mix dependency hashes in the first disposable readiness request.
        url: 'http://localhost:4321/api/e2e-runtime/environment',
        reuseExistingServer: false,
        timeout: 120000,
    },
});
