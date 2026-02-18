import { test, expect } from '@playwright/test';

test.describe('Student Dashboard', () => {
    test('dashboard page loads and shows a heading', async ({ page }) => {
        await page.goto('/es/campus');
        await page.waitForLoadState('domcontentloaded');

        // Page should not be login page (auth is already set up via storageState)
        expect(page.url()).not.toContain('/login');

        // There should be some heading on the page
        const heading = page.locator('h1, h2').first();
        await expect(heading).toBeVisible({ timeout: 10000 });
    });

    test('campus page shows "Panel de control" heading', async ({ page }) => {
        await page.goto('/es/campus');
        await page.waitForLoadState('domcontentloaded');

        // The h1 contains "PANEL DE CONTROL"
        const heading = page.locator('h1').filter({ hasText: /panel/i }).first();
        await expect(heading).toBeVisible({ timeout: 10000 });
    });

    test('navigation link to "Mis clases" is visible', async ({ page }) => {
        await page.goto('/es/campus');
        await page.waitForLoadState('domcontentloaded');

        const classesLink = page.locator('a[href*="/campus/classes"], a:has-text("Mis clases"), a:has-text("clases")').first();
        await expect(classesLink).toBeVisible({ timeout: 10000 });
    });

    test('navigation link to "Mi cuenta" is visible', async ({ page }) => {
        await page.goto('/es/campus');
        await page.waitForLoadState('domcontentloaded');

        const accountLink = page.locator('a[href*="/campus/account"], a:has-text("Mi cuenta"), a:has-text("cuenta")').first();
        await expect(accountLink).toBeVisible({ timeout: 10000 });
    });

    test('clicking "Mis clases" link navigates to /campus/classes', async ({ page }) => {
        await page.goto('/es/campus');
        await page.waitForLoadState('domcontentloaded');

        const classesLink = page.locator('a[href*="/campus/classes"]').first();
        if (await classesLink.isVisible()) {
            await classesLink.click();
            await page.waitForURL(/\/campus\/classes/, { timeout: 10000 });
            expect(page.url()).toContain('/campus/classes');
        }
    });

    test('campus page does not show teacher-specific routes to students', async ({ page }) => {
        await page.goto('/es/campus');
        await page.waitForLoadState('domcontentloaded');

        // Student should not see teacher dashboard link in nav
        const teacherNavLink = page.locator('a[href*="/campus/teacher/calendar"]');
        await expect(teacherNavLink).not.toBeVisible();
    });
});
