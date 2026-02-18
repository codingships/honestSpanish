import { test as setup, expect } from '@playwright/test';

const authFile = 'tests/e2e/.auth/admin.json';

setup('authenticate as admin', async ({ page }) => {
    await page.goto('/es/login');

    await page.fill('input[type="email"]', process.env.TEST_ADMIN_EMAIL!);
    await page.fill('input[type="password"]', process.env.TEST_ADMIN_PASSWORD!);

    await page.click('button[type="submit"]');

    await page.waitForURL(/\/campus/, { timeout: 10000 });

    await expect(page).toHaveURL(/\/campus/);

    await page.context().storageState({ path: authFile });
});
