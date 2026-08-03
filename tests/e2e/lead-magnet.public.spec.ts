import { test, expect } from '@playwright/test';

const subscribeEndpoint = /\/api\/subscribe(?:\?.*)?$/;

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
                                setTimeout(() => {
                                    params.callback('fake-e2e-token');
                                    document.documentElement.dataset.e2eTurnstileReady = 'true';
                                }, 0);
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

        // Keep the public CI run fully inert: the browser request is captured
        // here and can never reach Astro, Supabase, CRM or email providers.
        let subscribeCalls = 0;
        let submittedPayload: Record<string, unknown> | null = null;
        await page.route(subscribeEndpoint, async (route) => {
            subscribeCalls += 1;
            submittedPayload = route.request().postDataJSON() as Record<string, unknown>;
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
        const goalInput = page.locator('#contacto form textarea[name="learningGoal"]');
        const availabilityInput = page.locator('#contacto form textarea[name="availability"]');

        await nameInput.fill('Playwright Test User');
        await emailInput.fill('e2e-test-lead@espanolhonesto.com');
        await goalInput.fill('Quiero hablar mejor para vivir en España y entender conversaciones reales.');
        await availabilityInput.fill('Entre semana por la tarde, Europe/Madrid.');

        // Verify the name was actually set (if still empty, something is wrong)
        await expect(nameInput).toHaveValue('Playwright Test User');

        // Select an interest
        const selectInterest = page.locator('#contacto form select[name="interest"]');
        if (await selectInterest.count() > 0) {
            await selectInterest.selectOption({ index: 1 });
        }
        await page.locator('#contacto form select[name="currentLevel"]').selectOption('b1');

        // The current policy requires both independent declarations.
        await page.locator('#contacto form input[name="adultConfirmed"]').check();
        await page.locator('#consent').check();

        await page.waitForFunction(() => document.documentElement.dataset.e2eTurnstileReady === 'true');

        // Submit the form
        await page.locator('#contacto form button[type="submit"]').click();

        await expect(page.locator('#contacto').getByRole('status')).toContainText(
            'Gracias. Te escribiremos para responder tu consulta.',
        );
        expect(subscribeCalls).toBe(1);
        expect(submittedPayload).toMatchObject({
            adultConfirmed: true,
            consent: true,
            'cf-turnstile-response': 'fake-e2e-token',
        });
    });

    test('shows an error if privacy policy is not checked', async ({ page }) => {
        let subscribeCalls = 0;
        await page.route(subscribeEndpoint, async (route) => {
            subscribeCalls += 1;
            await route.fulfill({
                status: 500,
                contentType: 'application/json',
                body: JSON.stringify({ error: 'Unexpected E2E request' }),
            });
        });

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
        await page.locator('#contacto form input[name="adultConfirmed"]').check();

        // Deliberately do NOT check the consent box
        await page.locator('#contacto form button[type="submit"]').click();

        // Success message should NOT appear
        const successMessage = page.locator('text="Gracias. Te escribiremos para responder tu consulta."');
        await expect(successMessage).not.toBeVisible();
        await expect(page.getByRole('alert')).toContainText('Debes aceptar');
        expect(subscribeCalls).toBe(0);
    });
});

test.describe('Lead Magnet Form without JavaScript', () => {
    test.use({ javaScriptEnabled: false });

    test('keeps typed personal data out of the URL and does not submit before hydration', async ({ page }) => {
        await page.goto('/en');

        const form = page.locator('#contacto form');
        await expect(form).toHaveAttribute('method', 'post');
        await expect(form).toHaveAttribute('action', '/api/subscribe');
        await expect(form).toHaveAttribute('data-interactive', 'false');
        await expect(form.getByRole('status')).toContainText('Enable JavaScript');
        await expect(form.getByRole('button', { name: 'SEND QUESTION' })).toBeDisabled();
        await expect(form.locator('[name]')).toHaveCount(0);

        await form.locator('#lead-name').fill('No Script Person');
        await form.locator('#lead-email').fill('private-address@example.test');

        expect(new URL(page.url()).search).toBe('');
        expect(page.url()).not.toContain('No%20Script%20Person');
        expect(page.url()).not.toContain('private-address');
    });
});
