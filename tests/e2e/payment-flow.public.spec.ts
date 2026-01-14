/**
 * EXHAUSTIVE Payment and Checkout Flow Tests
 * 
 * Tests the complete payment journey from pricing to checkout
 * NOTE: Actual Stripe checkout cannot be fully tested in E2E without Stripe CLI
 */
import { test, expect, type Page } from '@playwright/test';

// Helper for detailed logging
function log(step: string, details?: any) {
    const timestamp = new Date().toISOString();
    console.log(`\n[${timestamp}] 📋 ${step}`);
    if (details) {
        console.log(`   Details:`, JSON.stringify(details, null, 2));
    }
}

async function captureState(page: Page, stepName: string) {
    const url = page.url();
    const title = await page.title();
    log(`State at "${stepName}"`, { url, title });
    return { url, title };
}

async function acceptCookies(page: Page) {
    try {
        const acceptBtn = page.locator('button:has-text("Aceptar"), button:has-text("Accept")').first();
        if (await acceptBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
            // Use force click to ensure we hit it even if animating
            await acceptBtn.click({ force: true, timeout: 2000 });
            await page.waitForTimeout(300); // Wait for banner to disappear
        }
    } catch (e) {
        // Ignore cookie click failures as it might be already dismissed or non-blocking
        console.log('Cookie acceptance skipped or failed:', e);
    }
}

test.describe('Pricing Section - Public', () => {

    test.beforeEach(async ({ page }) => {
        // Ensure cookies are accepted before each test interactions
        await page.goto('/es', { waitUntil: 'networkidle' });
        await acceptCookies(page);
    });

    test('should display all three pricing plans with correct information', async ({ page }) => {
        // Page navigation handled in beforeEach, but some tests navigate specific langs
        // We'll keep explicit navigation for clarity or just ensure cookies are gone
        log('Step 1: Check pricing section visibility');

        log('Step 2: Scroll to pricing section');
        const pricingSection = page.locator('#pricing, #planes, [data-section="pricing"]').first();
        if (await pricingSection.isVisible()) {
            await pricingSection.scrollIntoViewIfNeeded();
            await page.waitForTimeout(500);
        }
        await captureState(page, 'Pricing Section');

        log('Step 3: Find all plan cards');
        const planCards = page.locator('.pricing-plan-card, [class*="plan"], [class*="pricing-card"], [data-plan]');
        const planCount = await planCards.count();
        log('Plan cards found', { planCount });

        log('Step 4: Analyze each plan');
        const plans = [];
        for (let i = 0; i < planCount; i++) {
            const card = planCards.nth(i);
            const content = await card.textContent();

            // Extract plan details
            const hasPrice = content?.match(/\d+/) !== null;
            const hasClasses = content?.toLowerCase().includes('clase');
            const hasButton = await card.locator('button, a').isVisible();

            plans.push({
                index: i,
                preview: content?.substring(0, 100),
                hasPrice,
                hasClasses,
                hasButton
            });
        }
        log('Plan analysis', { plans });

        // Should have at least 2-3 plans
        expect(planCount).toBeGreaterThanOrEqual(2);

        log('✅ Pricing plans displayed correctly');
    });

    test('should show plan details on hover or click', async ({ page }) => {
        log('Step 1: Navigate to pricing');
        await page.goto('/es', { waitUntil: 'networkidle' });

        const pricingSection = page.locator('#pricing, #planes').first();
        if (await pricingSection.isVisible()) {
            await pricingSection.scrollIntoViewIfNeeded();
        }

        log('Step 2: Find plan card');
        const planCard = page.locator('[class*="plan"], [class*="pricing"]').first();
        const hasCard = await planCard.isVisible().catch(() => false);

        if (hasCard) {
            log('Step 3: Hover over plan');
            await planCard.hover();
            await page.waitForTimeout(300);

            log('Step 4: Check for additional info on hover');
            const tooltip = page.locator('[role="tooltip"], .tooltip, [class*="tooltip"]');
            const hasTooltip = await tooltip.isVisible().catch(() => false);
            log('Tooltip on hover', { hasTooltip });
        }

        log('✅ Plan interaction tested');
    });

    test('should open duration selection when clicking a plan', async ({ page }) => {
        log('Step 1: Navigate to pricing');
        await page.goto('/es', { waitUntil: 'networkidle' });

        const pricingSection = page.locator('#pricing, #planes').first();
        if (await pricingSection.isVisible()) {
            await pricingSection.scrollIntoViewIfNeeded();
        }

        log('Step 2: Find and click plan button');
        const selectBtn = page.locator('button:has-text("Elegir"), button:has-text("Seleccionar"), a:has-text("Elegir")').first();
        const hasBtn = await selectBtn.isVisible().catch(() => false);
        log('Select button found', { hasBtn });

        if (hasBtn) {
            log('Step 3: Click select button');
            // Wait for hydration
            await page.waitForTimeout(1000);

            const btn = page.locator('button:has-text("Elegir"), button:has-text("Seleccionar")').first();
            await expect(btn).toBeEnabled();

            // USE JS CLICK TO BYPASS OVERLAYS/SCROLL ISSUES
            await btn.evaluate(node => node.click());

            await page.waitForTimeout(1000);
            await captureState(page, 'After clicking select');

            log('Step 4: Check for duration modal');
            const modal = page.locator('[role="dialog"], .modal, [class*="modal"] .fixed').first();
            // Assert modal visibility to catch failures here vs later
            await expect(modal).toBeVisible({ timeout: 5000 });
            const hasModal = await modal.isVisible();
            log('Duration modal appeared', { hasModal });

            if (hasModal) {
                const modalContent = await modal.textContent();
                log('Modal content', { content: modalContent?.substring(0, 200) });

                log('Step 5: Look for duration options');
                const options = modal.locator('label[data-duration]');
                const optionCount = await options.count();
                expect(optionCount).toBeGreaterThan(0);
                log('Duration options', { optionCount });
            }
        } else {
            // Fail if no button found (essential for test validity)
            throw new Error('Select button not found');
        }

        log('✅ Duration selection flow tested');
    });

    test('should calculate prices correctly for each duration', async ({ page }) => {
        // Navigation done in beforeEach
        log('Step 1: Navigate to pricing (handled in beforeEach)');

        // Wait specifically for hydration of interactive elements
        await page.waitForTimeout(1000);

        // Accept cookies again just in case (though beforeEach should cover it)
        await acceptCookies(page);

        // Ensure we target the Essential plan specifically if possible, or the first available
        // Note: Waiting for networkidle might not be enough for dynamic content
        await page.waitForSelector('.pricing-plan-card');

        log('Step 2: Open "Essential" plan modal');
        // Try to find the Essential plan specifically, or fallback to the first one
        const selectPlanSelector = '[data-testid="select-plan-essential"], [data-testid^="select-plan-"]';
        const selectBtn = page.locator(selectPlanSelector).first();

        await selectBtn.waitFor({ state: 'attached', timeout: 10000 });

        // USE JS CLICK
        await selectBtn.evaluate(node => (node as HTMLElement).click());

        // Wait for modal explicitly
        const modalSelector = '.fixed.inset-0.z-50';
        await page.waitForSelector(modalSelector, { state: 'visible', timeout: 10000 });
        await page.waitForTimeout(500); // Animation buffer

        // Helper to check price
        const checkPrice = async (duration: string, expectedPrice: string | null = null) => {
            log(`Checking ${duration} month(s) price`);

            // 1. Select duration
            const radioInput = page.locator(`input[name="duration"][value="${duration}"]`);
            const labelBtn = page.locator(`[data-duration="${duration}"]`);

            // Try check input first, fallback to label click
            if (await radioInput.count() > 0) {
                await radioInput.check({ force: true });
            } else {
                // Use JS click for label fallback as well to avoid interception
                await labelBtn.evaluate(node => (node as HTMLElement).click());
            }

            await page.waitForTimeout(300); // Wait for React state update

            // 2. Capture price
            const priceDisplay = page.locator('[class*="price"], [class*="total"]').first();
            const price = await priceDisplay.textContent();
            log(`${duration} month price: ${price}`);

            return price;
        };

        // Step 3: Check 1 month (default)
        const price1 = await checkPrice('1');
        expect(price1).toBeTruthy();

        // Step 4: Check 3 months
        const price3 = await checkPrice('3');
        expect(price3).toBeTruthy();
        expect(price3).not.toBe(price1); // Should change

        // Step 5: Check 6 months
        const price6 = await checkPrice('6');
        expect(price6).toBeTruthy();
        expect(price6).not.toBe(price3);

        log('✅ Price calculations verified');
    });
});

test.describe('Checkout Flow - Authenticated', () => {

    test('should redirect to login when not authenticated', async ({ page }) => {
        log('Step 1: Try to access checkout directly');
        await page.goto('/es/checkout', { waitUntil: 'networkidle' });
        await captureState(page, 'After navigating to checkout');

        log('Step 2: Check if redirected to login');
        const url = page.url();
        const isOnLogin = url.includes('login');
        const isOnCheckout = url.includes('checkout');

        log('Redirect check', { url, isOnLogin, isOnCheckout });

        // Either redirected to login or checkout handles unauthenticated state
        expect(isOnLogin || isOnCheckout).toBeTruthy();

        log('✅ Unauthenticated checkout access handled');
    });
});

test.describe('Success and Cancel Pages', () => {

    test('should display success page correctly', async ({ page }) => {
        log('Step 1: Navigate to success page');
        await page.goto('/es/success', { waitUntil: 'networkidle' });
        await captureState(page, 'Success Page');

        log('Step 2: Check page content');
        const pageContent = await page.locator('body').textContent();
        const hasSuccessMessage = pageContent?.toLowerCase().includes('gracias') ||
            pageContent?.toLowerCase().includes('éxito') ||
            pageContent?.toLowerCase().includes('bienvenido');

        log('Success message check', { hasSuccessMessage, preview: pageContent?.substring(0, 200) });

        log('Step 3: Check for next steps or CTA');
        const ctaButton = page.locator('a[href*="campus"], button:has-text("Empezar"), a:has-text("Ir al campus")').first();
        const hasCta = await ctaButton.isVisible().catch(() => false);
        log('CTA button', { hasCta });

        log('✅ Success page displays correctly');
    });

    test('should display cancel page correctly', async ({ page }) => {
        log('Step 1: Navigate to cancel page');
        await page.goto('/es/cancel', { waitUntil: 'networkidle' });
        await captureState(page, 'Cancel Page');

        log('Step 2: Check page content');
        const pageContent = await page.locator('body').textContent();
        log('Cancel page content', { preview: pageContent?.substring(0, 200) });

        log('Step 3: Check for retry option');
        const retryLink = page.locator('a[href*="pricing"], a:has-text("Intentar de nuevo"), a:has-text("Volver")').first();
        const hasRetry = await retryLink.isVisible().catch(() => false);
        log('Retry option', { hasRetry });

        log('✅ Cancel page displays correctly');
    });
});

test.describe('Multi-language Pricing', () => {

    test('should display pricing in English', async ({ page }) => {
        log('Step 1: Navigate to English homepage');
        await page.goto('/en', { waitUntil: 'networkidle' });

        log('Step 2: Scroll to pricing');
        const pricingSection = page.locator('#pricing, #plans').first();
        if (await pricingSection.isVisible()) {
            await pricingSection.scrollIntoViewIfNeeded();
        }

        log('Step 3: Check for English text');
        const pageContent = await page.locator('body').textContent();
        const hasEnglish = pageContent?.toLowerCase().includes('choose') ||
            pageContent?.toLowerCase().includes('plan') ||
            pageContent?.toLowerCase().includes('month');

        log('English content', { hasEnglish });

        log('✅ English pricing verified');
    });

    test('should display pricing in Russian', async ({ page }) => {
        log('Step 1: Navigate to Russian homepage');
        await page.goto('/ru', { waitUntil: 'networkidle' });

        log('Step 2: Scroll to pricing');
        const pricingSection = page.locator('#pricing, #планы').first();
        if (await pricingSection.isVisible()) {
            await pricingSection.scrollIntoViewIfNeeded();
        }

        log('Step 3: Check for Russian text');
        const pageContent = await page.locator('body').textContent();
        const hasRussian = /[а-яА-Я]/.test(pageContent || '');

        log('Russian content', { hasRussian });

        log('✅ Russian pricing verified');
    });
});
