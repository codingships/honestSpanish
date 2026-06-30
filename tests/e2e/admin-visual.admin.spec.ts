import { expect, test, type Page } from '@playwright/test';

test.use({
    viewport: { width: 1440, height: 1000 },
});

test.describe('Admin visual guardrails', () => {
    test.beforeEach(async ({ page }) => {
        await page.addInitScript(() => {
            localStorage.setItem('cookie_consent', 'accepted');
            localStorage.setItem('cookie_consent_date', '2026-06-24T00:00:00.000Z');
            localStorage.setItem('ehDemoGuideEnabled', 'false');
        });
    });

    test('dashboard command center keeps the admin queue style contract', async ({ page }) => {
        await openAdminRoute(page, '/es/campus/admin');

        await expect(page.locator('main')).toHaveScreenshot('admin-dashboard-main.png', {
            animations: 'disabled',
            caret: 'hide',
            maxDiffPixelRatio: 0.01,
        });
    });

    test('CRM leads surface keeps the admin style contract', async ({ page }) => {
        await openAdminRoute(page, '/es/campus/admin/leads');

        await expect(page.locator('main')).toHaveScreenshot('admin-crm-leads-main.png', {
            animations: 'disabled',
            caret: 'hide',
            maxDiffPixelRatio: 0.01,
        });
    });

    test('jobs surface keeps the admin table style contract', async ({ page }) => {
        await openAdminRoute(page, '/es/campus/admin/jobs');

        await expect(page.locator('main')).toHaveScreenshot('admin-jobs-main.png', {
            animations: 'disabled',
            caret: 'hide',
            maxDiffPixelRatio: 0.01,
        });
    });

    test('email template surface keeps the admin split-panel style contract', async ({ page }) => {
        await openAdminRoute(page, '/es/campus/admin/emails');

        await expect(page.locator('main')).toHaveScreenshot('admin-emails-main.png', {
            animations: 'disabled',
            caret: 'hide',
            mask: [page.locator('iframe')],
            maskColor: '#E0F7FA',
            maxDiffPixelRatio: 0.01,
        });
    });
});

async function openAdminRoute(page: Page, route: string) {
    await page.goto(route, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => undefined);
    await page.evaluate(async () => {
        await document.fonts?.ready;
    });
    await page.addStyleTag({
        content: `
            *, *::before, *::after {
                animation-duration: 0s !important;
                animation-delay: 0s !important;
                transition-duration: 0s !important;
                transition-delay: 0s !important;
            }

            #eh-guide-overlay,
            #eh-guide-launcher {
                display: none !important;
            }
        `,
    });
    await expect(page.locator('main')).toBeVisible();
}
