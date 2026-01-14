import { test as setup, expect } from '@playwright/test';

const authFile = 'tests/e2e/.auth/teacher.json';

setup('authenticate as teacher', async ({ page }) => {
    await page.goto('/es/login');
    await page.fill('input[type="email"]', process.env.TEST_TEACHER_EMAIL!);
    await page.fill('input[type="password"]', process.env.TEST_TEACHER_PASSWORD!);
    await page.click('button[type="submit"]');

    // Esperar a que termine el login (redirige a /campus)
    await page.waitForURL(/\/campus/, { timeout: 10000 });

    // Navegar manualmente al área de teacher
    await page.goto('/es/campus/teacher');
    await expect(page).toHaveURL(/\/campus\/teacher/);

    await page.context().storageState({ path: authFile });
});