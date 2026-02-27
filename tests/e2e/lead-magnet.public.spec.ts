import { test, expect } from '@playwright/test';

test.describe('Lead Magnet Form — public', () => {
    test('successfully submits the lead capture form', async ({ page }) => {
        // Intercept the Cloudflare Turnstile script and replace it with a mock
        // that immediately fires the onSuccess callback.
        await page.route('**/challenges.cloudflare.com/turnstile/**', async (route) => {
            await route.fulfill({
                status: 200,
                contentType: 'application/javascript',
                body: `
                    window.turnstile = {
                        render: function(container, params) {
                            if (params && params.callback) {
                                setTimeout(() => params.callback('fake-e2e-token'), 50);
                            }
                            return 'fake-widget-id';
                        },
                        reset: function() {},
                        remove: function() {},
                        isExpired: function() { return false; }
                    };
                `,
            });
        });

        // Mock the /api/subscribe endpoint
        await page.route('**/api/subscribe', async (route) => {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({ message: 'Success' }),
            });
        });

        await page.goto('/es');

        // Scroll to the contact section to trigger client:visible hydration
        await page.locator('#contacto').scrollIntoViewIfNeeded();

        // CRITICAL: Wait for the astro-island to be fully hydrated.
        // When hydrated, Astro removes the `ssr` attribute from the astro-island element.
        await page.waitForFunction(() => {
            const island = document.querySelector('#contacto astro-island');
            return island && !island.hasAttribute('ssr');
        }, { timeout: 10000 });

        // At this point React has mounted and initialized its state.
        // Now we can safely fill the form without React wiping our values.
        const nameInput = page.locator('#contacto form input[name="name"]');
        const emailInput = page.locator('#contacto form input[name="email"]');

        await nameInput.fill('Playwright Test User');
        await emailInput.fill('e2e-test-lead@espanolhonesto.com');

        // Verify the name was actually set (if still empty, something is wrong)
        await expect(nameInput).toHaveValue('Playwright Test User');

        // Select an interest
        const selectInterest = page.locator('#contacto form select[name="interest"]');
        if (await selectInterest.count() > 0) {
            await selectInterest.selectOption({ index: 1 });
        }

        // Check the privacy consent checkbox
        await page.locator('#consent').check();

        // Wait for the fake Turnstile callback to fire (50ms + margin)
        await page.waitForTimeout(300);

        // Submit the form
        await page.locator('#contacto form button[type="submit"]').click();

        // Wait for the success message to appear
        const successMessage = page.locator('text="¡Gracias! Te escribiremos pronto."');
        await expect(successMessage).toBeVisible({ timeout: 5000 });
    });

    test('shows an error if privacy policy is not checked', async ({ page }) => {
        await page.goto('/es');

        // Scroll to trigger client:visible hydration
        await page.locator('#contacto').scrollIntoViewIfNeeded();

        // Wait for full hydration
        await page.waitForFunction(() => {
            const island = document.querySelector('#contacto astro-island');
            return island && !island.hasAttribute('ssr');
        }, { timeout: 10000 });

        await page.locator('#contacto form input[name="name"]').fill('No Consent User');
        await page.locator('#contacto form input[name="email"]').fill('noconsent@test.com');

        // Deliberately do NOT check the consent box
        await page.locator('#contacto form button[type="submit"]').click();

        // Success message should NOT appear
        const successMessage = page.locator('text="¡Gracias! Te escribiremos pronto."');
        await expect(successMessage).not.toBeVisible();
    });
});
