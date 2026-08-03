import { test, expect } from '@playwright/test';

const slotPublicId = '11111111-1111-4111-8111-111111111111';
const availability = {
    checkoutEnabled: false,
    slots: [{
        publicId: slotPublicId,
        teacherName: 'Álex',
        weekday: 1,
        localStartTime: '18:00:00',
        timezoneName: 'Europe/Madrid',
        firstClassAt: '2035-01-08T17:00:00.000Z',
        renewalAt: '2035-02-05T17:00:00.000Z',
        occurrences: [
            { index: 1, startsAt: '2035-01-08T17:00:00.000Z', durationMinutes: 50 },
            { index: 2, startsAt: '2035-01-15T17:00:00.000Z', durationMinutes: 50 },
            { index: 3, startsAt: '2035-01-22T17:00:00.000Z', durationMinutes: 50 },
            { index: 4, startsAt: '2035-01-29T17:00:00.000Z', durationMinutes: 50 },
        ],
    }],
};

test.describe('Public launch offer', () => {
    test('shows real availability without opening checkout in a closed runtime', async ({ page }) => {
        let checkoutRequests = 0;
        await page.route('**/api/bookable-slots', async (route) => {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify(availability),
            });
        });
        await page.route('**/api/create-checkout', async (route) => {
            checkoutRequests += 1;
            await route.fulfill({ status: 500, body: 'checkout must remain closed' });
        });

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

        const availabilityButton = page.getByTestId('select-plan-individual_4x50_28d');
        await expect(availabilityButton).toBeEnabled();
        await expect(availabilityButton).toHaveText('Ver plazas');
        await availabilityButton.click();

        const slot = page.getByRole('radio', { name: /Álex/i });
        await expect(slot).toBeVisible();
        await expect(page.getByRole('dialog')).toContainText('Europe/Madrid');
        await expect(page.getByRole('dialog').locator('time')).toHaveCount(6);
        await slot.check();

        await expect(page.getByRole('status').filter({ hasText: 'Esta plaza es real' })).toContainText(
            'Esta plaza es real y está disponible, pero el pago todavía no está habilitado.',
        );
        await expect(page.getByRole('button', { name: 'Reservar y pagar' })).toHaveCount(0);
        expect(checkoutRequests).toBe(0);
    });
});
