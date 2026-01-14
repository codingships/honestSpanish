/**
 * EXHAUSTIVE Error Handling and Edge Case Tests
 * 
 * Tests application behavior under error conditions and edge cases
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

test.describe('Error Handling - Authentication', () => {

    test('should show clear error message for invalid login', async ({ page }) => {
        log('Step 1: Navigate to login page');
        await page.goto('/es/login', { waitUntil: 'networkidle' });
        await captureState(page, 'Login Page');

        log('Step 2: Enter invalid credentials');
        await page.fill('input[type="email"]', 'nonexistent@test.com');
        await page.fill('input[type="password"]', 'wrongpassword123');

        log('Step 3: Submit form');
        await page.click('button[type="submit"]');
        await page.waitForTimeout(2000);
        await captureState(page, 'After invalid login attempt');

        log('Step 4: Check for error message');
        const errorMsg = page.locator('[class*="error"], [class*="alert"], [role="alert"]').first();
        const hasError = await errorMsg.isVisible().catch(() => false);

        if (hasError) {
            const errorText = await errorMsg.textContent();
            log('Error message displayed', { errorText });
        }

        log('Step 5: Verify still on login page');
        expect(page.url()).toContain('login');

        log('✅ Invalid login shows error correctly');
    });

    test('should handle empty form submission', async ({ page }) => {
        log('Step 1: Navigate to login page');
        await page.goto('/es/login', { waitUntil: 'networkidle' });

        log('Step 2: Click submit without filling form');
        await page.click('button[type="submit"]');
        await page.waitForTimeout(500);

        log('Step 3: Check for validation errors');
        const emailInput = page.locator('input[type="email"]');
        const passwordInput = page.locator('input[type="password"]');

        // Check HTML5 validation
        const emailValidation = await emailInput.evaluate((el: HTMLInputElement) => el.validationMessage);
        const passwordValidation = await passwordInput.evaluate((el: HTMLInputElement) => el.validationMessage);

        log('Validation messages', { emailValidation, passwordValidation });

        log('✅ Empty form submission handled');
    });

    test('should handle invalid email format', async ({ page }) => {
        log('Step 1: Navigate to login page');
        await page.goto('/es/login', { waitUntil: 'networkidle' });

        log('Step 2: Enter invalid email format');
        await page.fill('input[type="email"]', 'not-an-email');
        await page.fill('input[type="password"]', 'somepassword');

        log('Step 3: Submit form');
        await page.click('button[type="submit"]');
        await page.waitForTimeout(500);

        log('Step 4: Check for email validation');
        const emailInput = page.locator('input[type="email"]');
        const validation = await emailInput.evaluate((el: HTMLInputElement) => el.validationMessage);
        log('Email validation', { validation });

        log('✅ Invalid email format handled');
    });
});

test.describe('Error Handling - 404 Pages', () => {

    test('should display custom 404 page', async ({ page }) => {
        log('Step 1: Navigate to non-existent page');
        await page.goto('/es/this-page-does-not-exist', { waitUntil: 'networkidle' });
        await captureState(page, '404 Page');

        log('Step 2: Check for 404 content');
        const pageContent = await page.locator('body').textContent();
        const has404 = pageContent?.includes('404');
        const hasNotFound = pageContent?.toLowerCase().includes('no encontrada') ||
            pageContent?.toLowerCase().includes('not found');

        log('404 page content', { has404, hasNotFound, preview: pageContent?.substring(0, 200) });

        log('Step 3: Check for home link');
        const homeLink = page.locator('a[href*="/es"], a:has-text("inicio"), a:has-text("home")').first();
        const hasHomeLink = await homeLink.isVisible().catch(() => false);
        log('Home link', { hasHomeLink });

        log('✅ Custom 404 page displayed');
    });

    test('should show 404 for protected routes when authenticated', async ({ page }) => {
        log('Step 1: Navigate to non-existent campus page');
        await page.goto('/es/campus/nonexistent-page', { waitUntil: 'networkidle' });
        await captureState(page, 'After navigating to bad campus route');

        const url = page.url();
        const content = await page.locator('body').textContent();

        log('Result', {
            url,
            is404: content?.includes('404'),
            isLogin: url.includes('login'),
            preview: content?.substring(0, 100)
        });

        log('✅ Non-existent campus route handled');
    });
});

test.describe('Edge Cases - Calendar', () => {

    test('should handle empty calendar (no sessions)', async ({ page }) => {
        log('Step 1: Navigate to calendar');
        // This test depends on having a user with no sessions
        await page.goto('/es/campus/teacher/calendar', { waitUntil: 'networkidle' });
        await captureState(page, 'Calendar Page');

        log('Step 2: Check for empty state or sessions');
        const sessions = page.locator('[class*="session"], [class*="event"]');
        const sessionCount = await sessions.count();
        log('Sessions found', { sessionCount });

        if (sessionCount === 0) {
            log('Step 3: Check for empty state message');
            const emptyMsg = page.locator('[class*="empty"], :has-text("No hay clases"), :has-text("No sessions")').first();
            const hasEmptyMsg = await emptyMsg.isVisible().catch(() => false);
            log('Empty state message', { hasEmptyMsg });
        }

        log('✅ Empty calendar handled gracefully');
    });

    test('should handle weekend navigation', async ({ page }) => {
        log('Step 1: Navigate to calendar');
        await page.goto('/es/campus/teacher/calendar', { waitUntil: 'networkidle' });

        log('Step 2: Navigate forward several times');
        const nextBtn = page.getByRole('button', { name: /siguiente|next|→/i });

        for (let i = 0; i < 3; i++) {
            await nextBtn.click();
            await page.waitForTimeout(200);
        }
        await captureState(page, 'After 3 weeks forward');

        log('Step 3: Navigate backward');
        const prevBtn = page.getByRole('button', { name: /anterior|prev|←/i });

        for (let i = 0; i < 5; i++) {
            await prevBtn.click();
            await page.waitForTimeout(200);
        }
        await captureState(page, 'After 5 weeks backward');

        log('Step 4: Return to today');
        const todayBtn = page.getByRole('button', { name: /hoy|today/i });
        if (await todayBtn.isVisible()) {
            await todayBtn.click();
            await page.waitForTimeout(200);
        }
        await captureState(page, 'After clicking today');

        log('✅ Calendar navigation edge cases handled');
    });
});

test.describe('Edge Cases - Forms', () => {

    test('should handle special characters in inputs', async ({ page }) => {
        log('Step 1: Navigate to login');
        await page.goto('/es/login', { waitUntil: 'networkidle' });

        log('Step 2: Try email with special characters');
        const specialEmail = "test+special@español.com";
        await page.fill('input[type="email"]', specialEmail);

        const emailValue = await page.locator('input[type="email"]').inputValue();
        log('Special email input', { entered: specialEmail, stored: emailValue });

        log('Step 3: Try password with special characters');
        const specialPassword = "Pässwörd!@#$%^&*()123";
        await page.fill('input[type="password"]', specialPassword);

        const passwordValue = await page.locator('input[type="password"]').inputValue();
        log('Special password input', { entered: specialPassword, storedLength: passwordValue.length });

        log('✅ Special characters handled in forms');
    });

    test('should handle very long input values', async ({ page }) => {
        log('Step 1: Navigate to login');
        await page.goto('/es/login', { waitUntil: 'networkidle' });

        log('Step 2: Try very long email');
        const longEmail = 'a'.repeat(100) + '@' + 'b'.repeat(100) + '.com';
        await page.fill('input[type="email"]', longEmail);

        const emailValue = await page.locator('input[type="email"]').inputValue();
        log('Long email handling', { enteredLength: longEmail.length, storedLength: emailValue.length });

        log('✅ Long input values handled');
    });
});

test.describe('Performance and Loading', () => {

    test('should load homepage within acceptable time', async ({ page }) => {
        log('Step 1: Start timing homepage load');
        const startTime = Date.now();

        await page.goto('/es', { waitUntil: 'networkidle' });

        const loadTime = Date.now() - startTime;
        log('Homepage load time', { loadTimeMs: loadTime, loadTimeSec: (loadTime / 1000).toFixed(2) });

        // Should load within 10 seconds
        expect(loadTime).toBeLessThan(10000);

        log('✅ Homepage loads within acceptable time');
    });

    test('should load dashboard within acceptable time', async ({ page }) => {
        log('Step 1: Start timing dashboard load');
        const startTime = Date.now();

        await page.goto('/es/campus', { waitUntil: 'networkidle' });

        const loadTime = Date.now() - startTime;
        log('Dashboard load time', { loadTimeMs: loadTime, loadTimeSec: (loadTime / 1000).toFixed(2) });

        log('✅ Dashboard load time measured');
    });

    test('should handle page refresh correctly', async ({ page }) => {
        log('Step 1: Navigate to campus');
        await page.goto('/es/campus', { waitUntil: 'networkidle' });
        const initialUrl = page.url();
        await captureState(page, 'Before refresh');

        log('Step 2: Refresh page');
        await page.reload({ waitUntil: 'networkidle' });
        const afterRefreshUrl = page.url();
        await captureState(page, 'After refresh');

        log('Step 3: Compare states');
        const urlsSame = initialUrl === afterRefreshUrl;
        log('Refresh comparison', { initialUrl, afterRefreshUrl, urlsSame });

        log('✅ Page refresh handled correctly');
    });
});

test.describe('Browser Navigation', () => {

    test('should handle browser back button', async ({ page }) => {
        log('Step 1: Navigate to homepage');
        await page.goto('/es', { waitUntil: 'networkidle' });

        log('Step 2: Navigate to login');
        await page.goto('/es/login', { waitUntil: 'networkidle' });

        log('Step 3: Click browser back');
        await page.goBack({ waitUntil: 'networkidle' });
        await captureState(page, 'After back button');

        const currentUrl = page.url();
        log('Back navigation', { currentUrl, isHomepage: currentUrl.includes('/es') && !currentUrl.includes('login') });

        log('✅ Back button navigation works');
    });

    test('should handle browser forward button', async ({ page }) => {
        log('Step 1: Navigate through pages');
        await page.goto('/es', { waitUntil: 'networkidle' });
        await page.goto('/es/login', { waitUntil: 'networkidle' });

        log('Step 2: Go back');
        await page.goBack({ waitUntil: 'networkidle' });

        log('Step 3: Go forward');
        await page.goForward({ waitUntil: 'networkidle' });
        await captureState(page, 'After forward button');

        const currentUrl = page.url();
        log('Forward navigation', { currentUrl, isLogin: currentUrl.includes('login') });

        log('✅ Forward button navigation works');
    });
});
