/**
 * Visual Regression Tests - Public Pages
 * 
 * Captures screenshots of public pages and compares against baselines.
 * Uses Playwright's built-in visual comparison with toHaveScreenshot().
 * 
 * First run will create baseline screenshots in __snapshots__ folder.
 * Subsequent runs will compare against baselines.
 * 
 * Update baselines with: npx playwright test --update-snapshots
 */
import { test, expect } from '@playwright/test';

// Configure visual comparison settings
const SCREENSHOT_OPTIONS = {
    fullPage: true,
    animations: 'disabled' as const,
    mask: [] as any[], // Add selectors to mask dynamic content
};

// Helper for logging
function log(message: string) {
    console.log(`📸 ${message}`);
}

test.describe('Homepage Visual Regression', () => {

    test.beforeEach(async ({ page }) => {
        // Wait for fonts to load to prevent false positives
        await page.goto('/es', { waitUntil: 'networkidle' });
        await page.waitForTimeout(500); // Extra time for fonts/animations
    });

    test('homepage full page screenshot', async ({ page }) => {
        log('Capturing homepage full page');

        await expect(page).toHaveScreenshot('homepage-full.png', {
            ...SCREENSHOT_OPTIONS,
            maxDiffPixels: 100, // Allow small differences
        });
    });

    test('homepage header section', async ({ page }) => {
        log('Capturing header section');

        const header = page.locator('header').first();
        await expect(header).toHaveScreenshot('homepage-header.png', {
            animations: 'disabled',
        });
    });

    test('homepage hero section', async ({ page }) => {
        log('Capturing hero section');

        // Target the first major section after header
        const hero = page.locator('section').first();
        if (await hero.isVisible()) {
            await expect(hero).toHaveScreenshot('homepage-hero.png', {
                animations: 'disabled',
            });
        }
    });

    test('homepage pricing section', async ({ page }) => {
        log('Capturing pricing section');

        // Navigate to pricing section
        await page.goto('/es#pricing', { waitUntil: 'networkidle' });
        await page.waitForTimeout(500);

        const pricing = page.locator('#pricing, [id*="precio"], section:has-text("precio")').first();
        if (await pricing.isVisible()) {
            await expect(pricing).toHaveScreenshot('homepage-pricing.png', {
                animations: 'disabled',
            });
        }
    });

    test('homepage footer', async ({ page }) => {
        log('Capturing footer');

        const footer = page.locator('footer').first();
        await expect(footer).toHaveScreenshot('homepage-footer.png', {
            animations: 'disabled',
        });
    });
});

test.describe('Login Page Visual Regression', () => {

    test('login page full', async ({ page }) => {
        log('Capturing login page');

        await page.goto('/es/login', { waitUntil: 'networkidle' });
        await page.waitForTimeout(500);

        await expect(page).toHaveScreenshot('login-page.png', {
            ...SCREENSHOT_OPTIONS,
            maxDiffPixels: 50,
        });
    });

    test('login form', async ({ page }) => {
        log('Capturing login form');

        await page.goto('/es/login', { waitUntil: 'networkidle' });

        const form = page.locator('form').first();
        await expect(form).toHaveScreenshot('login-form.png', {
            animations: 'disabled',
        });
    });

    test('login with validation errors', async ({ page }) => {
        log('Capturing login with validation errors');

        await page.goto('/es/login', { waitUntil: 'networkidle' });

        // Trigger validation by clicking submit without filling
        await page.click('button[type="submit"]');
        await page.waitForTimeout(300);

        const form = page.locator('form').first();
        await expect(form).toHaveScreenshot('login-form-errors.png', {
            animations: 'disabled',
        });
    });
});

test.describe('Legal Pages Visual Regression', () => {

    test('privacy policy page', async ({ page }) => {
        log('Capturing privacy policy');

        await page.goto('/es/legal/privacidad', { waitUntil: 'networkidle' });

        await expect(page).toHaveScreenshot('privacy-policy.png', {
            fullPage: true,
            animations: 'disabled',
            maxDiffPixels: 100,
        });
    });

    test('legal notice page', async ({ page }) => {
        log('Capturing legal notice');

        await page.goto('/es/legal/aviso-legal', { waitUntil: 'networkidle' });

        await expect(page).toHaveScreenshot('legal-notice.png', {
            fullPage: true,
            animations: 'disabled',
            maxDiffPixels: 100,
        });
    });

    test('cookie policy page', async ({ page }) => {
        log('Capturing cookie policy');

        await page.goto('/es/legal/cookies', { waitUntil: 'networkidle' });

        await expect(page).toHaveScreenshot('cookie-policy.png', {
            fullPage: true,
            animations: 'disabled',
            maxDiffPixels: 100,
        });
    });
});

test.describe('Responsive Visual Regression', () => {

    test('homepage mobile view', async ({ page }) => {
        log('Capturing mobile homepage');

        await page.setViewportSize({ width: 375, height: 667 });
        await page.goto('/es', { waitUntil: 'networkidle' });
        await page.waitForTimeout(500);

        await expect(page).toHaveScreenshot('homepage-mobile.png', {
            fullPage: true,
            animations: 'disabled',
            maxDiffPixels: 150,
        });
    });

    test('homepage tablet view', async ({ page }) => {
        log('Capturing tablet homepage');

        await page.setViewportSize({ width: 768, height: 1024 });
        await page.goto('/es', { waitUntil: 'networkidle' });
        await page.waitForTimeout(500);

        await expect(page).toHaveScreenshot('homepage-tablet.png', {
            fullPage: true,
            animations: 'disabled',
            maxDiffPixels: 150,
        });
    });

    test('login mobile view', async ({ page }) => {
        log('Capturing mobile login');

        await page.setViewportSize({ width: 375, height: 667 });
        await page.goto('/es/login', { waitUntil: 'networkidle' });

        await expect(page).toHaveScreenshot('login-mobile.png', {
            fullPage: true,
            animations: 'disabled',
            maxDiffPixels: 100,
        });
    });
});

test.describe('Component Visual Regression', () => {

    test('navigation menu open state', async ({ page }) => {
        log('Capturing navigation');

        await page.goto('/es', { waitUntil: 'networkidle' });

        const nav = page.locator('nav').first();
        await expect(nav).toHaveScreenshot('navigation.png', {
            animations: 'disabled',
        });
    });

    test('mobile menu open', async ({ page }) => {
        log('Capturing mobile menu');

        await page.setViewportSize({ width: 375, height: 667 });
        await page.goto('/es', { waitUntil: 'networkidle' });

        // Try to open mobile menu
        const menuButton = page.locator('button[aria-label*="menu"], .hamburger, [class*="menu-toggle"]').first();
        if (await menuButton.isVisible()) {
            await menuButton.click();
            await page.waitForTimeout(300);

            await expect(page).toHaveScreenshot('mobile-menu-open.png', {
                animations: 'disabled',
            });
        }
    });

    test('buttons hover state', async ({ page }) => {
        log('Capturing button hover states');

        await page.goto('/es', { waitUntil: 'networkidle' });

        const primaryButton = page.locator('button, a[class*="btn"]').first();
        if (await primaryButton.isVisible()) {
            await primaryButton.hover();
            await page.waitForTimeout(100);

            await expect(primaryButton).toHaveScreenshot('button-hover.png', {
                animations: 'disabled',
            });
        }
    });
});

test.describe('Dark Mode Visual Regression', () => {

    test('homepage in dark mode (if supported)', async ({ page }) => {
        log('Capturing dark mode homepage');

        // Set dark color scheme preference
        await page.emulateMedia({ colorScheme: 'dark' });
        await page.goto('/es', { waitUntil: 'networkidle' });
        await page.waitForTimeout(500);

        await expect(page).toHaveScreenshot('homepage-dark.png', {
            fullPage: true,
            animations: 'disabled',
            maxDiffPixels: 200,
        });
    });

    test('login in dark mode (if supported)', async ({ page }) => {
        log('Capturing dark mode login');

        await page.emulateMedia({ colorScheme: 'dark' });
        await page.goto('/es/login', { waitUntil: 'networkidle' });

        await expect(page).toHaveScreenshot('login-dark.png', {
            fullPage: true,
            animations: 'disabled',
            maxDiffPixels: 100,
        });
    });
});

test.describe('Internationalization Visual Regression', () => {

    test('homepage in English', async ({ page }) => {
        log('Capturing English homepage');

        await page.goto('/en', { waitUntil: 'networkidle' });
        await page.waitForTimeout(500);

        await expect(page).toHaveScreenshot('homepage-en.png', {
            fullPage: true,
            animations: 'disabled',
            maxDiffPixels: 150,
        });
    });

    test('homepage in Russian', async ({ page }) => {
        log('Capturing Russian homepage');

        await page.goto('/ru', { waitUntil: 'networkidle' });
        await page.waitForTimeout(500);

        await expect(page).toHaveScreenshot('homepage-ru.png', {
            fullPage: true,
            animations: 'disabled',
            maxDiffPixels: 150,
        });
    });
});
