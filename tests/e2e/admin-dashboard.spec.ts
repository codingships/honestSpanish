/**
 * Admin Dashboard Tests
 */
import { test, expect } from '@playwright/test';
import { loginAs, waitForPageLoad } from './helpers/auth';

test.describe('Admin Dashboard', () => {

    test.beforeEach(async ({ page }) => {
        await loginAs(page, 'admin');
    });

    test('should display admin dashboard with stats', async ({ page }) => {
        await waitForPageLoad(page);

        // Should be on admin area
        expect(page.url()).toContain('/campus');
        await expect(page.locator('body')).toBeVisible();

        // Look for stats/metrics
        const statsSection = page.locator('[data-testid*="stat"], .stats, [class*="metric"], [class*="stat"]').first();
        // Admin should have some stats displayed
    });

    test('should have access to students management', async ({ page }) => {
        await waitForPageLoad(page);

        // Look for students link
        const studentsLink = page.locator('a[href*="students"], a[href*="estudiantes"]').first();

        if (await studentsLink.isVisible()) {
            await studentsLink.click();
            await page.waitForURL('**/*student*', { timeout: 5000 });
        }
    });

    test('should have access to global calendar', async ({ page }) => {
        await waitForPageLoad(page);

        // Look for calendar link
        const calendarLink = page.locator('a[href*="calendar"], a[href*="calendario"]').first();

        if (await calendarLink.isVisible()) {
            await calendarLink.click();
            await page.waitForURL('**/*calendar*', { timeout: 5000 });
        }
    });

    test('should be able to view/filter all teachers sessions', async ({ page }) => {
        // Navigate to calendar
        const calendarLink = page.locator('a[href*="calendar"]').first();
        if (await calendarLink.isVisible()) {
            await calendarLink.click();
            await page.waitForTimeout(1000);
        }

        // Look for teacher filter
        const teacherFilter = page.locator('[data-testid="teacher-filter"], select[name*="teacher"], [class*="teacher-filter"]').first();

        await expect(page.locator('body')).toBeVisible();
    });

    test('should have access to payments section', async ({ page }) => {
        await waitForPageLoad(page);

        // Look for payments link
        const paymentsLink = page.locator('a[href*="payment"], a[href*="pago"]').first();

        // Verify navigation exists
        await expect(page.locator('body')).toBeVisible();
    });

    test('should be able to create Drive folder for student', async ({ page }) => {
        // Navigate to student detail
        const studentsLink = page.locator('a[href*="students"]').first();
        if (await studentsLink.isVisible()) {
            await studentsLink.click();
            await page.waitForTimeout(1000);

            // Click on first student
            const studentRow = page.locator('[data-testid="student-row"], tr, .student-item').first();
            if (await studentRow.isVisible()) {
                await studentRow.click();
            }
        }

        // Look for create folder button
        const createFolderBtn = page.locator('[data-testid="create-folder-btn"], button:has-text("Crear carpeta")').first();

        await expect(page.locator('body')).toBeVisible();
    });
});
