import { test, expect } from '@playwright/test';

test.describe('Landing Page', () => {
    test('should load home page in Spanish by default', async ({ page }) => {
        await page.goto('/');
        // Should redirect to /es or show Spanish content
        await expect(page.locator('body')).toContainText(/VIVIR|ESPAÑOL/i);
    });

    test('should display all main sections', async ({ page }) => {
        await page.goto('/es');

        // Hero section
        await expect(page.locator('text=VIVIR')).toBeVisible();

        // Method section
        await expect(page.locator('#metodo')).toBeVisible();

        // Progress section  
        await expect(page.locator('#progreso')).toBeVisible();

        // Pricing section
        await expect(page.locator('#planes')).toBeVisible();

        // Team section
        await expect(page.locator('#equipo')).toBeVisible();

        // FAQ section
        await expect(page.locator('#faq')).toBeVisible();
    });

    test('should switch languages correctly', async ({ page }) => {
        await page.goto('/es');

        // Click English language switch
        await page.click('a[href="/en"]');
        await expect(page).toHaveURL('/en');
        await expect(page.locator('body')).toContainText(/LIVE|SPAIN/i);

        // Click Russian language switch
        await page.click('a[href="/ru"]');
        await expect(page).toHaveURL('/ru');
    });

    test('should open pricing modal when clicking select', async ({ page }) => {
        await page.goto('/es');

        // Scroll to pricing section
        await page.locator('#planes').scrollIntoViewIfNeeded();

        // Click on a "Seleccionar" button
        const selectButton = page.locator('button:has-text("Seleccionar")').first();
        await selectButton.click();

        // Modal should appear
        await expect(page.locator('[role="dialog"], .fixed.inset-0')).toBeVisible();
    });

    test('should expand FAQ items', async ({ page }) => {
        await page.goto('/es');

        // Scroll to FAQ
        await page.locator('#faq').scrollIntoViewIfNeeded();

        // Click first FAQ question
        const firstQuestion = page.locator('[data-faq-button="0"]');
        await firstQuestion.click();

        // Answer should be visible
        await expect(page.locator('#faq-content-0')).toBeVisible();
    });

    test('navigation links should work', async ({ page }) => {
        await page.goto('/es');

        // Click on "Método" nav link
        await page.click('a[href="#metodo"]');

        // Should scroll to method section
        const metodoSection = page.locator('#metodo');
        await expect(metodoSection).toBeInViewport();
    });
});
