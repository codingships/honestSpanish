import { test as setup, expect } from '@playwright/test';

const authFile = 'tests/e2e/.auth/admin.json';

setup('authenticate as admin', async ({ page }) => {
    await page.goto('/es/login');
    await page.fill('input[type="email"]', process.env.TEST_ADMIN_EMAIL!);
    await page.fill('input[type="password"]', process.env.TEST_ADMIN_PASSWORD!);
    await page.click('button[type="submit"]');

    // Esperar a que termine el login (redirige a /campus)
    await page.waitForURL(/\/campus/, { timeout: 10000 });

    // Navegar manualmente al área de admin
    await page.goto('/es/campus/admin');
    await expect(page).toHaveURL(/\/campus\/admin/);

    await page.context().storageState({ path: authFile });
});