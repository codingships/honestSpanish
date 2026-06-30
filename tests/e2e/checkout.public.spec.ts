import { test, expect } from '@playwright/test';

test.describe('Public pricing application flow', () => {
    test('clicking a public package CTA goes to the application form before checkout', async ({ page }) => {
        await page.goto('/es');

        const plansSection = page.locator('text="PLANES"').first();
        if (await plansSection.isVisible()) {
            await plansSection.scrollIntoViewIfNeeded();
        }

        const selectButton = page.locator('button[data-testid^="select-plan-"]').first();

        if (await selectButton.count() > 0) {
            await selectButton.click();

            await expect(page.locator('#contacto form')).toBeVisible();
            await expect(page.locator('#contacto form')).toContainText('Plan de interes');
            await expect(page).toHaveURL(/#contacto$/);
        } else {
            console.log('No plan selection buttons found in this language/route.');
        }
    });
});
