import { test, expect, type Page } from '@playwright/test';

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

async function mockTurnstile(page: Page): Promise<void> {
    await page.route('**/challenges.cloudflare.com/turnstile/**', async (route) => {
        await route.fulfill({
            status: 200,
            contentType: 'application/javascript',
            body: `
                window.turnstile = {
                    render: function(container, params) {
                        var target = typeof container === 'string'
                            ? document.querySelector(container)
                            : container;
                        if (target) {
                            var widget = document.createElement('div');
                            widget.dataset.mockCheckoutTurnstile = 'ready';
                            target.appendChild(widget);
                        }
                        if (params && params.callback) {
                            setTimeout(function() {
                                params.callback('fake-public-checkout-token');
                                document.documentElement.dataset.e2eCheckoutTurnstileReady = 'true';
                            }, 0);
                        }
                        return 'fake-checkout-widget';
                    },
                    reset: function() {},
                    remove: function() {},
                    isExpired: function() { return false; }
                };
            `,
        });
    });
}

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

    test('carries the normal public journey from an available place to hosted checkout', async ({ page }) => {
        await mockTurnstile(page);

        let checkoutRequests = 0;
        let checkoutPayload: Record<string, unknown> | null = null;
        await page.route('**/api/bookable-slots', async (route) => {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({ ...availability, checkoutEnabled: true }),
            });
        });
        await page.route('**/api/auth/checkout-readiness', async (route) => {
            await route.fulfill({ status: 204 });
        });
        await page.route('**/api/create-checkout', async (route) => {
            checkoutRequests += 1;
            checkoutPayload = route.request().postDataJSON() as Record<string, unknown>;
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    url: 'https://checkout.stripe.com/c/pay/cs_test_public_checkout_e2e',
                }),
            });
        });
        await page.route('https://checkout.stripe.com/**', async (route) => {
            await route.fulfill({
                status: 200,
                contentType: 'text/html',
                body: '<!doctype html><title>Synthetic hosted checkout</title><h1>Synthetic hosted checkout</h1>',
            });
        });

        await page.goto('/es?utm_source=checkout-e2e');
        await page.getByTestId('select-plan-individual_4x50_28d').click();

        const dialog = page.getByRole('dialog');
        await dialog.getByRole('radio', { name: /Álex/i }).check();
        await expect(dialog.getByRole('checkbox')).toHaveCount(4);
        for (const checkbox of await dialog.getByRole('checkbox').all()) await checkbox.check();
        await page.waitForFunction(() => (
            document.documentElement.dataset.e2eCheckoutTurnstileReady === 'true'
        ));

        await dialog.getByRole('button', { name: 'Reservar y pagar' }).click();

        await expect(page).toHaveURL('https://checkout.stripe.com/c/pay/cs_test_public_checkout_e2e');
        await expect(page.getByRole('heading', { name: 'Synthetic hosted checkout' })).toBeVisible();
        expect(checkoutRequests).toBe(1);
        expect(checkoutPayload).toMatchObject({
            slotPublicId,
            lang: 'es',
            adultConfirmed: true,
            termsAccepted: true,
            serviceStartRequested: true,
            withdrawalLossAcknowledged: true,
            'cf-turnstile-response': 'fake-public-checkout-token',
            attribution: {
                utmSource: 'checkout-e2e',
            },
        });
    });
});

