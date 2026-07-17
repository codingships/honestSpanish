import { expect, test } from '@playwright/test';

test.use({ bypassCSP: false });

// Component coverage for src/components/CookieBanner.astro.
const bannerAppearTimeoutMs = 5000;

test.describe('Cookie banner', () => {
    test('appears, links the cookie policy and persists the accepted state', async ({ page }) => {
        await page.goto('/es', { waitUntil: 'domcontentloaded' });
        await page.evaluate(() => {
            window.localStorage.removeItem('cookie_consent');
            window.localStorage.removeItem('cookie_consent_date');
        });
        await page.reload({ waitUntil: 'domcontentloaded' });

        const banner = page.locator('#cookie-banner');
        await expect(banner).toBeHidden();
        await expect(banner).toHaveAttribute('aria-hidden', 'true');
        await expect(banner).toBeVisible({ timeout: bannerAppearTimeoutMs });
        await expect(banner).toHaveAttribute('data-visible', 'true');
        await expect(page.locator('#cookie-banner a[href="/es/legal/cookies"]')).toBeVisible();

        const acceptButton = page.getByRole('button', { name: /Aceptar/i });
        await expect(acceptButton).toHaveAttribute('type', 'button');
        await acceptButton.click();

        await expect(banner).toBeHidden({ timeout: 2000 });
        await expect(banner).toHaveAttribute('aria-hidden', 'true');
        await expect(banner).toHaveAttribute('data-visible', 'false');
        expect(await page.evaluate(() => window.localStorage.getItem('cookie_consent'))).toBe('accepted');
        expect(await page.evaluate(() => window.localStorage.getItem('cookie_consent_date'))).toMatch(/^\d{4}-\d{2}-\d{2}T/);

        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(1200);
        await expect(banner).toBeHidden();
        await expect(banner).toHaveAttribute('aria-hidden', 'true');
    });

    test('remains usable when browser storage is unavailable', async ({ page }) => {
        await page.addInitScript(() => {
            const blockedStorage = () => {
                throw new Error('localStorage blocked for strict QA');
            };

            Object.defineProperty(Storage.prototype, 'getItem', {
                configurable: true,
                value: blockedStorage,
            });
            Object.defineProperty(Storage.prototype, 'setItem', {
                configurable: true,
                value: blockedStorage,
            });
        });

        await page.goto('/en', { waitUntil: 'domcontentloaded' });

        const banner = page.locator('#cookie-banner');
        await expect(banner).toBeVisible({ timeout: bannerAppearTimeoutMs });
        await page.getByRole('button', { name: /Accept/i }).click();
        await expect(banner).toBeHidden({ timeout: 2000 });
    });
});
