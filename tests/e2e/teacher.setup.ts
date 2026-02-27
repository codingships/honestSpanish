import { test as setup, expect } from '@playwright/test';

const authFile = 'tests/e2e/.auth/teacher.json';

setup('authenticate as teacher', async ({ page }) => {
    await page.goto('/es/login');

    // Esperar hidratación del componente AuthForm
    await page.waitForFunction(() => {
        const island = document.querySelector('astro-island');
        return island && !island.hasAttribute('ssr');
    }, { timeout: 10000 });

    await page.fill('input[type="email"]', process.env.TEST_TEACHER_EMAIL!);
    await page.fill('input[type="password"]', process.env.TEST_TEACHER_PASSWORD!);

    await page.click('button[type="submit"]');

    await page.waitForURL(/\/campus\/teacher/, { timeout: 15000 });

    await expect(page).toHaveURL(/\/campus\/teacher/);

    await page.context().storageState({ path: authFile });
});
