import { test as setup, expect } from '@playwright/test';
import { saveVerifiedStagingAuthState } from './helpers/auth';

const authFile = 'tests/e2e/.auth/teacher.json';

setup('authenticate as teacher', async ({ page }) => {
    await page.goto('/es/login', { waitUntil: 'domcontentloaded' });

    // Esperar hidratación del componente AuthForm
    await page.waitForFunction(() => {
        const island = document.querySelector('astro-island');
        return island && !island.hasAttribute('ssr');
    }, { timeout: 10000 });

    await page.fill('input[type="email"]', process.env.TEST_TEACHER_EMAIL!);
    await page.fill('input[type="password"]', process.env.TEST_TEACHER_PASSWORD!);

    await page.click('button[type="submit"]');

    await page.waitForURL(/\/campus\/teacher/, { timeout: 15000, waitUntil: 'domcontentloaded' });

    await expect(page).toHaveURL(/\/campus\/teacher/);

    await saveVerifiedStagingAuthState(page, authFile);
});
