import { test, expect } from '@playwright/test';

test.describe('Public launch offer', () => {
    test('shows the single 259 EUR offer while direct purchase remains closed', async ({ page }) => {
        await page.goto('/es');

        const plansSection = page.locator('#planes');
        await plansSection.scrollIntoViewIfNeeded();
        await expect(plansSection).toBeVisible();

        const planCards = plansSection.locator('.pricing-plan-card');
        await expect(planCards).toHaveCount(1);

        const launchPlan = planCards.first();
        await expect(launchPlan.getByRole('heading', { name: '4 clases individuales' })).toBeVisible();
        await expect(launchPlan).toContainText('259');
        await expect(launchPlan).toContainText('cada 28 días');
        await expect(launchPlan).toContainText('50 minutos por clase');

        const purchaseButton = page.getByTestId('select-plan-individual_4x50_28d');
        await expect(purchaseButton).toBeDisabled();
        await expect(purchaseButton).toHaveText('Compra en preparación');
        await expect(page.locator('#pricing-availability-note')).toContainText(
            'La compra directa se abrirá cuando puedas elegir una plaza real con profesor y horario antes de pagar.',
        );
    });
});
