import { test, expect } from '@playwright/test';

test.describe('Auth — public', () => {
    test('login page renders email and password fields', async ({ page }) => {
        await page.goto('/es/login');
        await expect(page.locator('input[type="email"]')).toBeVisible();
        await expect(page.locator('input[type="password"]')).toBeVisible();
        await expect(page.locator('button[type="submit"]')).toBeVisible();
    });

    test('login with wrong credentials shows an error message', async ({ page }) => {
        await page.goto('/es/login');

        // Esperar hidratación del componente AuthForm
        await page.waitForFunction(() => {
            const island = document.querySelector('astro-island');
            return island && !island.hasAttribute('ssr');
        }, { timeout: 10000 });

        await page.fill('input[type="email"]', 'notareal@user.com');
        await page.fill('input[type="password"]', 'wrongpassword123');
        await page.click('button[type="submit"]');

        // Wait for error to appear
        const errorLocator = page.locator('[class*="error"], [class*="alert"], [role="alert"], .text-red-500, .text-red-700');
        await expect(errorLocator.first()).toBeVisible({ timeout: 8000 });
    });

    test('accessing /es/campus without auth redirects to login', async ({ page }) => {
        await page.goto('/es/campus');
        await page.waitForURL(/\/login/, { timeout: 10000 });
        expect(page.url()).toContain('/login');
    });

    test('accessing a protected route without auth redirects to login', async ({ page }) => {
        await page.goto('/es/campus/classes');
        await page.waitForURL(/\/login/, { timeout: 10000 });
        expect(page.url()).toContain('/login');
    });

    test('/en/login renders form in English', async ({ page }) => {
        await page.goto('/en/login');
        await expect(page.locator('input[type="email"]')).toBeVisible();
        await expect(page.locator('input[type="password"]')).toBeVisible();
        // The page should have loaded the English locale
        await expect(page).toHaveURL(/\/en\/login/);
    });
});
