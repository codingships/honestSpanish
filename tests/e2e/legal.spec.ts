import { test, expect } from '@playwright/test';

test.describe('Legal Pages', () => {
    test('should display legal page', async ({ page }) => {
        await page.goto('/es/legal');
        await expect(page.locator('body')).toContainText(/legal|privacidad|cookies/i);
    });

    test('legal page should be accessible in all languages', async ({ page }) => {
        await page.goto('/es/legal');
        await expect(page).toHaveURL('/es/legal');

        await page.goto('/en/legal');
        await expect(page).toHaveURL('/en/legal');

        await page.goto('/ru/legal');
        await expect(page).toHaveURL('/ru/legal');
    });
});
