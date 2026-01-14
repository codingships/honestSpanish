/**
 * Authentication Tests
 */
import { test, expect } from '@playwright/test';
import { TEST_USERS } from './fixtures/test-users';
import { loginAs, logout, getDashboardUrl } from './helpers/auth';

test.describe('Authentication', () => {

    test('should show login page with form', async ({ page }) => {
        await page.goto('/es/login');

        await expect(page.locator('input[type="email"]')).toBeVisible();
        await expect(page.locator('input[type="password"]')).toBeVisible();
        await expect(page.locator('button[type="submit"]')).toBeVisible();
    });

    test('should show error for invalid credentials', async ({ page }) => {
        await page.goto('/es/login');

        await page.fill('input[type="email"]', 'invalid@email.com');
        await page.fill('input[type="password"]', 'wrongpassword');
        await page.click('button[type="submit"]');

        // Wait for error message
        await page.waitForTimeout(2000);

        // Should still be on login page
        expect(page.url()).toContain('/login');
    });

    test('should login as student successfully', async ({ page }) => {
        await loginAs(page, 'student');

        expect(page.url()).toContain('/campus');
        await expect(page.locator('body')).toBeVisible();
    });

    test('should login as teacher successfully', async ({ page }) => {
        await loginAs(page, 'teacher');

        expect(page.url()).toContain('/campus');
    });

    test('should login as admin successfully', async ({ page }) => {
        await loginAs(page, 'admin');

        expect(page.url()).toContain('/campus');
    });

    test('should redirect unauthenticated users from campus', async ({ page }) => {
        await page.goto('/es/campus');

        // Should redirect to login
        await page.waitForURL('**/login', { timeout: 5000 });
        expect(page.url()).toContain('/login');
    });

    test('should handle language switching on login page', async ({ page }) => {
        await page.goto('/es/login');
        await expect(page.locator('html')).toHaveAttribute('lang', 'es');

        await page.goto('/en/login');
        await expect(page.locator('html')).toHaveAttribute('lang', 'en');

        await page.goto('/ru/login');
        await expect(page.locator('html')).toHaveAttribute('lang', 'ru');
    });
});
