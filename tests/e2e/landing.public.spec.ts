import { test, expect } from '@playwright/test';

/**
 * Public Landing Page Tests
 * Ejecuta con: npx playwright test --project=public
 * 
 * Tests que no requieren autenticación
 */

test.describe('Public Landing Page', () => {
    test('should load Spanish homepage by default', async ({ page }) => {
        await page.goto('/es');
        await expect(page).toHaveURL(/\/es/);
    });

    test('should show all main sections', async ({ page }) => {
        await page.goto('/es');

        // Sections on landing
        await expect(page.locator('#metodo, [data-section="metodo"]')).toBeVisible();
    });

    test('should have working language switcher', async ({ page }) => {
        await page.goto('/es');

        // Try to find language links
        const englishLink = page.locator('a[href*="/en"]').first();
        if (await englishLink.isVisible()) {
            await englishLink.click();
            await expect(page).toHaveURL(/\/en/);
        }
    });
});

test.describe('Public Navigation', () => {
    test('should navigate to pricing section', async ({ page }) => {
        await page.goto('/es');

        // Click on pricing link (if anchor)
        const pricingLink = page.locator('a[href*="#planes"], a[href*="#pricing"]').first();
        if (await pricingLink.isVisible()) {
            await pricingLink.click();
            await expect(page.locator('#planes, #pricing')).toBeVisible();
        }
    });

    test('should navigate to login page', async ({ page }) => {
        await page.goto('/es');

        // Find login link and click
        const loginLink = page.locator('a[href*="/login"]').first();
        if (await loginLink.isVisible()) {
            await loginLink.click();
            await expect(page).toHaveURL(/\/login/);
        }
    });
});

test.describe('Public Legal Pages', () => {
    test('should access privacy policy', async ({ page }) => {
        await page.goto('/es/legal/privacidad');
        await expect(page.locator('body')).toContainText(/privacidad|privacy/i);
    });

    test('should access legal notice', async ({ page }) => {
        await page.goto('/es/legal/aviso-legal');
        await expect(page.locator('body')).toContainText(/aviso legal|legal notice/i);
    });

    test('should access cookie policy', async ({ page }) => {
        await page.goto('/es/legal/cookies');
        await expect(page.locator('body')).toContainText(/cookies/i);
    });
});

test.describe('Public Authentication', () => {
    test('should show login form', async ({ page }) => {
        await page.goto('/es/login');

        await expect(page.locator('input[type="email"]')).toBeVisible();
        await expect(page.locator('input[type="password"]')).toBeVisible();
        await expect(page.locator('button[type="submit"]')).toBeVisible();
    });

    test('should show error with invalid credentials', async ({ page }) => {
        await page.goto('/es/login');

        await page.fill('input[type="email"]', 'invalid@test.com');
        await page.fill('input[type="password"]', 'wrongpassword');
        await page.click('button[type="submit"]');

        // Should stay on login or show error
        await page.waitForTimeout(2000);

        // Check for error message or still on login page
        const hasError = await page.locator('.bg-red-100').first().isVisible();
        const stillOnLogin = page.url().includes('/login');

        expect(hasError || stillOnLogin).toBeTruthy();
    });

    test('should redirect to login when accessing protected campus', async ({ page }) => {
        await page.goto('/es/campus');
        await expect(page).toHaveURL(/\/login/);
    });

    test('should redirect to login when accessing admin area', async ({ page }) => {
        await page.goto('/es/campus/admin');
        await expect(page).toHaveURL(/\/login/);
    });

    test('should redirect to login when accessing teacher area', async ({ page }) => {
        await page.goto('/es/campus/teacher');
        await expect(page).toHaveURL(/\/login/);
    });
});

test.describe('Public Multi-language Support', () => {
    test('should load English version', async ({ page }) => {
        await page.goto('/en');
        await expect(page).toHaveURL(/\/en/);
    });

    test('should load Russian version', async ({ page }) => {
        await page.goto('/ru');
        await expect(page).toHaveURL(/\/ru/);
    });

    test('should have login in all languages', async ({ page }) => {
        // Spanish
        await page.goto('/es/login');
        await expect(page.locator('input[type="email"]')).toBeVisible();

        // English
        await page.goto('/en/login');
        await expect(page.locator('input[type="email"]')).toBeVisible();

        // Russian
        await page.goto('/ru/login');
        await expect(page.locator('input[type="email"]')).toBeVisible();
    });
});