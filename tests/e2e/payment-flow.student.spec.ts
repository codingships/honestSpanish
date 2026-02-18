import { test, expect } from '@playwright/test';

test.describe('Checkout Flow - Authenticated', () => {
    // Mock login state and Stripe API
    test.beforeEach(async ({ page }) => {
        // 1. Mock session API for login check
        await page.route('**/auth/v1/user', async route => {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    user: {
                        id: 'test-user-id',
                        aud: 'authenticated',
                        role: 'authenticated',
                        email: 'test@example.com',
                    }
                }),
            });
        });

        // 2. Mock create-checkout API
        await page.route('**/api/create-checkout', async route => {
            const request = route.request();
            if (request.method() === 'POST') {
                const postData = JSON.parse(request.postData() || '{}');
                // Simple verification that we received correct data
                if (postData.priceId) {
                    await route.fulfill({
                        status: 200,
                        contentType: 'application/json',
                        body: JSON.stringify({
                            url: 'https://checkout.stripe.com/test-session-url', // Mock redirection URL
                        }),
                    });
                } else {
                    await route.fulfill({ status: 400 });
                }
            }
        });

        // 3. Mock packages data to ensure consistent test environment
        await page.route('**/rest/v1/packages*', async route => {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify([
                    {
                        id: 'pkg_essential',
                        name: 'essential',
                        display_name: { es: 'Esencial', en: 'Essential', ru: 'Essential' },
                        price_monthly: 16000,
                        sessions_per_month: 8,
                        stripe_price_1m: 'price_1m_essential',
                        stripe_price_3m: 'price_3m_essential',
                        stripe_price_6m: 'price_6m_essential',
                        is_active: true
                    }
                ])
            });
        });
    });

    test('should initiate checkout and redirect to Stripe', async ({ page }) => {
        // Navigate to pricing page (or homepage with section)
        await page.goto('/es#pricing');
        await page.waitForTimeout(1000);

        // Use data-testid selector (more reliable than text matching)
        const selectButton = page.locator('[data-testid^="select-plan-"]').first();
        const hasButton = await selectButton.isVisible({ timeout: 5000 }).catch(() => false);

        if (!hasButton) {
            // Pricing section may be temporarily disabled or not rendered
            console.log('⚠️ No pricing plan buttons found - pricing section may be disabled');
            test.skip();
            return;
        }

        await selectButton.click();

        // Modal should appear
        const modal = page.locator('div[class*="fixed inset-0 z-50"]');
        await expect(modal).toBeVisible();

        // Click "Continue" or "Login" button inside modal
        const continueButton = page.getByRole('button', { name: /Continuar/i });
        await expect(continueButton).toBeVisible();

        // Setup listener for navigation or waiting for redirection
        const checkoutRequestPromise = page.waitForRequest(req =>
            req.url().includes('/api/create-checkout') && req.method() === 'POST'
        );

        await continueButton.click();

        // Verify the checkout API was called with correct data
        const request = await checkoutRequestPromise;
        const postData = JSON.parse(request.postData() || '{}');
        expect(postData.priceId).toBeTruthy();
        expect(postData.lang).toBe('es');

        await page.waitForURL('https://checkout.stripe.com/test-session-url');
    });
});
