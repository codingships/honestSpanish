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

        // Find the select button for the Essential plan and click it
        // Note: We need a reliable selector. Based on previous runs, we might need to target by text or test-id
        // Assuming the button contains "SELECCIONAR" in Spanish
        const selectButton = page.getByRole('button', { name: /SELECCIONAR/i }).first();
        await expect(selectButton).toBeVisible();
        await selectButton.click();

        // Modal should appear
        const modal = page.locator('div[class*="fixed inset-0 z-50"]');
        await expect(modal).toBeVisible();

        // Click "Continue" or "Login" button inside modal
        // Since we mocked auth user, it should show "Continuar al pago" (or similar translation key t.continue)
        // Checking PricingModal.tsx: it renders {isLoading ? t.loading : (isLoggedIn ? t.continue : t.login)}
        // In Spanish 'continue' is likely "Continuar al pago" based on translations.ts
        const continueButton = page.getByRole('button', { name: /Continuar/i });
        await expect(continueButton).toBeVisible();

        // Setup listener for navigation or waiting for redirection
        // Since our mock returns a URL and window.location.href sets it, we expect a navigation event
        // or we can verify the API call was made.

        const checkoutRequestPromise = page.waitForRequest(req =>
            req.url().includes('/api/create-checkout') && req.method() === 'POST'
        );

        await continueButton.click();

        // Verify the checkout API was called with correct data
        const request = await checkoutRequestPromise;
        const postData = JSON.parse(request.postData() || '{}');
        expect(postData.priceId).toBeTruthy();
        expect(postData.lang).toBe('es');

        // In a real browser test with window.location.href = external_url, Playwright might not "navigate" 
        // to the external domain if we don't handle it, but we blocked the route or mocked it.
        // However, the frontend code does: window.location.href = data.url;
        // We can assert that we are redirected to the mocked stripe URL or that the page unloaded.
        // simpler: check if page url changes to the mock url
        await page.waitForURL('https://checkout.stripe.com/test-session-url');
    });
});
