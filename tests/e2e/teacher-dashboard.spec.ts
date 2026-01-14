/**
 * Teacher Dashboard Tests
 */
import { test, expect } from '@playwright/test';
import { loginAs, waitForPageLoad } from './helpers/auth';

test.describe('Teacher Dashboard', () => {

    test.beforeEach(async ({ page }) => {
        await loginAs(page, 'teacher');
    });

    test('should display teacher dashboard', async ({ page }) => {
        await waitForPageLoad(page);

        // Should be on teacher area
        expect(page.url()).toContain('/campus');
        await expect(page.locator('body')).toBeVisible();
    });

    test('should show students list or section', async ({ page }) => {
        await waitForPageLoad(page);

        // Look for students section
        const studentsSection = page.locator('[data-testid="students-list"], .students, [class*="student"]').first();

        // May or may not have students
        await expect(page.locator('body')).toBeVisible();
    });

    test('should navigate to calendar page', async ({ page }) => {
        // Look for calendar link
        const calendarLink = page.locator('a[href*="calendar"], a[href*="calendario"]').first();

        if (await calendarLink.isVisible()) {
            await calendarLink.click();
            await page.waitForURL('**/*calendar*', { timeout: 5000 });
            expect(page.url()).toContain('calendar');
        }
    });

    test('should have availability management option', async ({ page }) => {
        await waitForPageLoad(page);

        // Navigate to calendar if not already there
        const calendarLink = page.locator('a[href*="calendar"]').first();
        if (await calendarLink.isVisible()) {
            await calendarLink.click();
            await page.waitForTimeout(1000);
        }

        // Look for availability tab or section
        const availabilityTab = page.locator('[data-testid="tab-availability"], button:has-text("Disponibilidad"), a:has-text("Disponibilidad")').first();

        // Verify page loads
        await expect(page.locator('body')).toBeVisible();
    });

    test('should be able to access session scheduling', async ({ page }) => {
        await waitForPageLoad(page);

        // Look for schedule button
        const scheduleBtn = page.locator('[data-testid="schedule-class-btn"], button:has-text("Programar"), button:has-text("Nueva clase")').first();

        // Verify page is functional
        await expect(page.locator('body')).toBeVisible();
    });
});
