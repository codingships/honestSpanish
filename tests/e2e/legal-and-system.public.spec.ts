import { expect, test } from '@playwright/test';

// Route coverage for src/pages/[lang]/logout.astro, src/pages/404.astro, /:lang/logout and /404.
test.describe('Legal and system public pages', () => {
    test('/es/legal renders the legal index with document links', async ({ page }) => {
        const response = await page.goto('/es/legal');

        expect(response?.status()).toBe(200);
        await expect(page.locator('article header h1')).toHaveText('Información legal');
        await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
        await expect(page.locator('article a[href="/es/legal/aviso-legal"]')).toContainText('Aviso Legal');
        await expect(page.locator('article a[href="/es/legal/cookies"]')).toContainText('Política de Cookies');
        await expect(page.locator('article a[href="/es/legal/privacidad"]')).toContainText('Política de Privacidad');
        await expect(page.locator('article a[href="/es/legal/terminos"]')).toContainText('Términos');
        await expect(page.locator('nav.legal-nav a[href="/es/legal/aviso-legal"]')).toBeVisible();
        await expect(page.locator('nav.legal-nav a[href="/es/legal/cookies"]')).toBeVisible();
        await expect(page.locator('nav.legal-nav a[href="/es/legal/privacidad"]')).toBeVisible();
        await expect(page.locator('nav.legal-nav a[href="/es/legal/terminos"]')).toBeVisible();
    });

    for (const slug of ['aviso-legal', 'cookies', 'privacidad', 'terminos']) {
        test(`/es/legal/${slug} renders as a noindex legal page`, async ({ page }) => {
            const response = await page.goto(`/es/legal/${slug}`);

            expect(response?.status()).toBe(200);
            await expect(page.locator('article header h1')).toBeVisible();
            await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
            await expect(page.locator('nav.legal-nav a[href="/es/legal/aviso-legal"]')).toBeVisible();
            await expect(page.locator('nav.legal-nav a[href="/es/legal/cookies"]')).toBeVisible();
            await expect(page.locator('nav.legal-nav a[href="/es/legal/privacidad"]')).toBeVisible();
            await expect(page.locator('nav.legal-nav a[href="/es/legal/terminos"]')).toBeVisible();
        });
    }

    test('/en/logout signs out and returns to the localized home', async ({ page }) => {
        await page.route('**/auth/v1/logout*', async (route) => {
            await route.fulfill({ status: 204, body: '' });
        });

        await page.goto('/en/logout');

        await page.waitForURL(/\/en$/, { timeout: 10000 });
        await expect(page).toHaveURL(/\/en$/);
    });

    test('404 page returns not found status and keeps localized home link', async ({ page }) => {
        const response = await page.goto('/en/strict-qa-missing-page');

        expect(response?.status()).toBe(404);
        expect(response?.headers()['x-robots-tag']).toContain('noindex');
        await expect(page.locator('.error-code')).toHaveText('404');
        await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
        await expect(page.locator('#home-btn')).toHaveAttribute('href', '/en');
    });
});
