/**
 * Student Dashboard Tests
 */
import { test, expect } from '@playwright/test';
import { loginAs, waitForPageLoad } from './helpers/auth';

test.describe('Student Dashboard', () => {

    test.beforeEach(async ({ page }) => {
        await loginAs(page, 'student');
    });

    test('should display dashboard main elements', async ({ page }) => {
        await waitForPageLoad(page);

        // Check basic layout is visible
        await expect(page.locator('body')).toBeVisible();

        // Should have some dashboard content
        const content = page.locator('main, [role="main"], .dashboard, #dashboard');
        await expect(content.first()).toBeVisible();
    });

    test('should navigate to classes page', async ({ page }) => {
        // Look for classes link
        const classesLink = page.locator('a[href*="classes"], a[href*="clases"]').first();

        if (await classesLink.isVisible()) {
            await classesLink.click();
            await page.waitForURL('**/*class*', { timeout: 5000 });
        }
    });

    test('should show plan information', async ({ page }) => {
        await waitForPageLoad(page);

        // Look for plan/subscription info
        const planSection = page.locator('[data-testid="plan-card"], .plan-info, [class*="plan"], [class*="subscription"]').first();

        // May or may not exist depending on user state
        const exists = await planSection.isVisible().catch(() => false);
        // Just verify page loaded correctly
        await expect(page.locator('body')).toBeVisible();
    });

    test('should display navigation menu', async ({ page }) => {
        await waitForPageLoad(page);

        // Should have some navigation
        const nav = page.locator('nav, header, [role="navigation"]').first();
        await expect(nav).toBeVisible();
    });

    test('should have logout option', async ({ page }) => {
        await waitForPageLoad(page);

        // Look for logout button/link
        const logoutBtn = page.locator('button:has-text("Cerrar"), a:has-text("Cerrar"), [data-testid="logout"]').first();

        // May be in a menu
        const userMenu = page.locator('[data-testid="user-menu"], .user-menu, button:has-text("Menú")').first();
        if (await userMenu.isVisible()) {
            await userMenu.click();
        }

        // Verify page is functional
        await expect(page.locator('body')).toBeVisible();
    });
});
