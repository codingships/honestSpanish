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
    reporter: [
        ['list', { printSteps: true }],
        ['html', { open: 'never', outputFolder: 'playwright-report' }],
    ],
    timeout: 60000,
    expect: {
        timeout: 10000,
    },
    use: {
        baseURL: process.env.TEST_BASE_URL || 'http://localhost:4321',
        trace: 'on-first-retry',
        screenshot: 'only-on-failure',
        video: 'retain-on-failure',
        bypassCSP: true,
        actionTimeout: 15000,
        navigationTimeout: 30000,
    },
    outputDir: 'test-results/artifacts',
    globalSetup: './tests/e2e/global-setup.ts',
    globalTeardown: './tests/e2e/global-teardown.ts',
    projects: [
        {
            name: 'public',
            testMatch: /.*\.public\.spec\.ts/,
            use: { ...devices['Desktop Chrome'] },
        },
        {
            name: 'public-firefox',
            testMatch: /.*\.public\.spec\.ts/,
            use: { ...devices['Desktop Firefox'] },
        },
        {
            name: 'public-webkit',
            testMatch: /.*\.public\.spec\.ts/,
            use: { ...devices['Desktop Safari'] },
        },
        {
            name: 'mobile',
            testMatch: /.*\.public\.spec\.ts/,
            use: { ...devices['Pixel 5'] },
        },
    ],
    webServer: {
        command: 'node tests/e2e/start-server.mjs',
        url: 'http://localhost:4321/api/e2e-runtime/environment',
        reuseExistingServer: false,
        timeout: 120000,
    },
});
