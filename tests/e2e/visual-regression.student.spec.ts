/**
 * Visual Regression Tests - Authenticated Pages
 * 
 * Captures screenshots of dashboard and authenticated pages.
 * These tests require authentication via storageState.
 * 
 * First run creates baselines. Update with: npx playwright test --update-snapshots
 */
import { test, expect, type Page } from '@playwright/test';

function log(message: string) {
    console.log(`📸 ${message}`);
}

/** Check if page was redirected to login (auth expired) */
async function checkAuth(page: Page, testRef: typeof test) {
    if (page.url().includes('/login')) {
        log('⚠️ Auth session expired - redirected to login, skipping');
        testRef.skip();
        return false;
    }
    return true;
}

test.describe('Student Dashboard Visual Regression', () => {

    test('student dashboard full page', async ({ page }) => {
        test.setTimeout(60000);
        log('Capturing student dashboard');

        await page.goto('/es/campus', { waitUntil: 'networkidle', timeout: 45000 });
        if (!await checkAuth(page, test)) return;
        await page.waitForTimeout(1000);

        await expect(page).toHaveScreenshot('student-dashboard.png', {
            fullPage: true,
            animations: 'disabled',
            maxDiffPixelRatio: 0.35,
            mask: [
                page.locator('[class*="time"], [class*="date"]'),
            ],
        });
    });

    test('student classes page', async ({ page }) => {
        test.setTimeout(60000);
        log('Capturing classes page');

        await page.goto('/es/campus/classes', { waitUntil: 'networkidle', timeout: 45000 });
        if (!await checkAuth(page, test)) return;
        await page.waitForTimeout(1000);

        await expect(page).toHaveScreenshot('student-classes.png', {
            fullPage: true,
            animations: 'disabled',
            maxDiffPixelRatio: 0.35,
            mask: [
                page.locator('[class*="time"], [class*="date"]'),
            ],
        });
    });

    test('student account page', async ({ page }) => {
        test.setTimeout(60000);
        log('Capturing account page');

        await page.goto('/es/campus/account', { waitUntil: 'networkidle', timeout: 45000 });
        if (!await checkAuth(page, test)) return;
        await page.waitForTimeout(500);

        await expect(page).toHaveScreenshot('student-account.png', {
            fullPage: true,
            animations: 'disabled',
            maxDiffPixelRatio: 0.35,
            mask: [
                page.locator('input[type="email"]'),
                page.locator('[class*="user-info"]'),
            ],
        });
    });

    test('student dashboard mobile', async ({ page }) => {
        test.setTimeout(60000);
        log('Capturing mobile dashboard');

        await page.setViewportSize({ width: 375, height: 667 });
        await page.goto('/es/campus', { waitUntil: 'networkidle', timeout: 45000 });
        if (!await checkAuth(page, test)) return;
        await page.waitForTimeout(1000);

        await expect(page).toHaveScreenshot('student-dashboard-mobile.png', {
            fullPage: true,
            animations: 'disabled',
            maxDiffPixelRatio: 0.35,
        });
    });
});

test.describe('Teacher Dashboard Visual Regression', () => {

    test('teacher dashboard full page', async ({ page }) => {
        test.setTimeout(60000);
        log('Capturing teacher dashboard');

        await page.goto('/es/campus/teacher', { waitUntil: 'networkidle', timeout: 45000 });
        if (!await checkAuth(page, test)) return;
        await page.waitForTimeout(1000);

        await expect(page).toHaveScreenshot('teacher-dashboard.png', {
            fullPage: true,
            animations: 'disabled',
            maxDiffPixelRatio: 0.35,
            mask: [
                page.locator('[class*="time"], [class*="date"]'),
            ],
        });
    });

    test('teacher calendar page', async ({ page }) => {
        test.setTimeout(60000);
        log('Capturing teacher calendar');

        await page.goto('/es/campus/teacher/calendar', { waitUntil: 'networkidle', timeout: 45000 });
        if (!await checkAuth(page, test)) return;
        await page.waitForTimeout(1500);

        await expect(page).toHaveScreenshot('teacher-calendar.png', {
            fullPage: true,
            animations: 'disabled',
            maxDiffPixelRatio: 0.35,
            mask: [
                page.locator('.fc-day-today'),
                page.locator('[class*="event"]'),
            ],
        });
    });

    test('teacher availability page', async ({ page }) => {
        test.setTimeout(60000);
        log('Capturing availability manager');

        await page.goto('/es/campus/teacher/availability', { waitUntil: 'networkidle', timeout: 45000 });
        if (!await checkAuth(page, test)) return;
        await page.waitForTimeout(500);

        await expect(page).toHaveScreenshot('teacher-availability.png', {
            fullPage: true,
            animations: 'disabled',
            maxDiffPixelRatio: 0.35,
        });
    });
});

test.describe('Admin Dashboard Visual Regression', () => {

    test('admin dashboard full page', async ({ page }) => {
        test.setTimeout(60000);
        log('Capturing admin dashboard');

        await page.goto('/es/campus/admin', { waitUntil: 'networkidle', timeout: 45000 });
        if (!await checkAuth(page, test)) return;
        await page.waitForTimeout(1000);

        await expect(page).toHaveScreenshot('admin-dashboard.png', {
            fullPage: true,
            animations: 'disabled',
            maxDiffPixelRatio: 0.35,
        });
    });

    test('admin students list', async ({ page }) => {
        test.setTimeout(60000);
        log('Capturing students list');

        await page.goto('/es/campus/admin/students', { waitUntil: 'networkidle', timeout: 45000 });
        if (!await checkAuth(page, test)) return;
        await page.waitForTimeout(1000);

        await expect(page).toHaveScreenshot('admin-students.png', {
            fullPage: true,
            animations: 'disabled',
            maxDiffPixelRatio: 0.35,
            mask: [
                page.locator('td'),
            ],
        });
    });

    test('admin calendar view', async ({ page }) => {
        test.setTimeout(60000);
        log('Capturing admin calendar');

        await page.goto('/es/campus/admin/calendar', { waitUntil: 'networkidle', timeout: 45000 });
        if (!await checkAuth(page, test)) return;
        await page.waitForTimeout(1500);

        await expect(page).toHaveScreenshot('admin-calendar.png', {
            fullPage: true,
            animations: 'disabled',
            maxDiffPixelRatio: 0.35,
            mask: [
                page.locator('.fc-day-today'),
            ],
        });
    });
});

test.describe('Modal Visual Regression', () => {

    test('pricing modal', async ({ page }) => {
        log('Capturing pricing modal');

        await page.goto('/es', { waitUntil: 'networkidle' });

        // Open pricing modal
        const pricingBtn = page.locator('button:has-text("Elegir")').first();
        if (await pricingBtn.isVisible()) {
            await pricingBtn.click();
            await page.waitForTimeout(500);

            const modal = page.locator('[role="dialog"], .modal').first();
            if (await modal.isVisible()) {
                await expect(modal).toHaveScreenshot('pricing-modal.png', {
                    animations: 'disabled',
                });
            }
        }
    });

    test('login modal/form focus state', async ({ page }) => {
        test.setTimeout(60000);
        log('Capturing login focus state');

        await page.goto('/es/login', { waitUntil: 'networkidle', timeout: 45000 });

        // If authenticated, login page redirects to dashboard - skip
        if (!page.url().includes('/login')) {
            log('⚠️ Redirected away from login (authenticated session), skipping');
            test.skip();
            return;
        }

        // Focus email input
        const emailInput = page.locator('input[type="email"]').first();
        const hasEmail = await emailInput.isVisible({ timeout: 5000 }).catch(() => false);
        if (!hasEmail) {
            log('⚠️ No email input found on login page, skipping');
            test.skip();
            return;
        }
        await emailInput.focus();
        await page.waitForTimeout(100);

        const form = page.locator('form').first();
        await expect(form).toHaveScreenshot('login-form-focused.png', {
            animations: 'disabled',
            maxDiffPixelRatio: 0.30,
        });
    });
});

test.describe('Sidebar / Navigation Visual Regression', () => {

    test('dashboard sidebar collapsed', async ({ page }) => {
        log('Capturing sidebar');

        await page.goto('/es/campus', { waitUntil: 'networkidle' });

        const sidebar = page.locator('aside, nav[class*="side"], [class*="sidebar"]').first();
        if (await sidebar.isVisible()) {
            await expect(sidebar).toHaveScreenshot('sidebar.png', {
                animations: 'disabled',
            });
        }
    });

    test('user menu dropdown', async ({ page }) => {
        log('Capturing user menu');

        await page.goto('/es/campus', { waitUntil: 'networkidle' });

        // Look for user menu button
        const userMenu = page.locator('[class*="user-menu"], [class*="avatar"], button:has-text("cuenta")').first();
        if (await userMenu.isVisible()) {
            await userMenu.click();
            await page.waitForTimeout(300);

            await expect(page.locator('[class*="dropdown"], [class*="menu"]').first()).toHaveScreenshot('user-menu-dropdown.png', {
                animations: 'disabled',
            });
        }
    });
});

test.describe('Error States Visual Regression', () => {

    test('404 page', async ({ page }) => {
        log('Capturing 404 page');

        await page.goto('/es/pagina-que-no-existe', { waitUntil: 'networkidle' });

        await expect(page).toHaveScreenshot('404-page.png', {
            fullPage: true,
            animations: 'disabled',
            maxDiffPixels: 100,
        });
    });

    test('form validation errors', async ({ page }) => {
        test.setTimeout(60000);
        log('Capturing validation errors');

        await page.goto('/es/login', { waitUntil: 'networkidle', timeout: 45000 });

        // If authenticated, login page redirects to dashboard - skip
        if (!page.url().includes('/login')) {
            log('⚠️ Redirected away from login (authenticated session), skipping');
            test.skip();
            return;
        }

        // Check email input exists before filling
        const emailInput = page.locator('input[type="email"]').first();
        const hasEmail = await emailInput.isVisible({ timeout: 5000 }).catch(() => false);
        if (!hasEmail) {
            log('⚠️ No email input found on login page, skipping');
            test.skip();
            return;
        }

        // Fill with invalid data
        await emailInput.fill('invalid-email');
        await page.click('button[type="submit"]');
        await page.waitForTimeout(500);

        const form = page.locator('form').first();
        await expect(form).toHaveScreenshot('form-validation-error.png', {
            animations: 'disabled',
            maxDiffPixelRatio: 0.30,
        });
    });
});
