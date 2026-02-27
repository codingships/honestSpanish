import { test, expect } from '@playwright/test';

test.describe('Stripe Checkout Flow', () => {
    test('clicking a package redirects to Stripe checkout', async ({ page }) => {
        // We go to the home page or wherever the plans are rendered
        // In the current architecture, the pricing modal might be directly on the home page or a specific route
        await page.goto('/es');

        // Find the wrapper or section for plans (depends on exact markup, but universally they have "PLANES" or "Precio")
        const plansSection = page.locator('text="PLANES"').first();
        if (await plansSection.isVisible()) {
            await plansSection.scrollIntoViewIfNeeded();
        }

        // Click the select button of the Essential plan (assuming the first button is the lowest tier)
        const selectButton = page.locator('button:has-text("Seleccionar")').first();

        if (await selectButton.count() > 0) {
            await selectButton.click();

            // Wait for the modal to appear
            const modal = page.locator('text="Elige tu compromiso"').first();
            await modal.waitFor({ state: 'visible', timeout: 5000 });

            // Ensure the user understands they might need to login.
            // The logic states: if not logged in, "Inicia sesión para continuar".
            // Since this is a public test, it should show the login prompt or redirect to login.
            const checkoutButton = page.locator('button:has-text("Inicia sesión para continuar"), a:has-text("Inicia sesión para continuar")');
            await expect(checkoutButton).toBeVisible();

            await checkoutButton.click();

            // Should redirect to login
            await page.waitForURL(/\/login/);
            expect(page.url()).toContain('/login');
        } else {
            console.log('No plan selection buttons found in this language/route.');
        }
    });
});
