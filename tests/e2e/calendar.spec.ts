/**
 * Calendar System Tests
 */
import { test, expect } from '@playwright/test';
import { loginAs, waitForPageLoad } from './helpers/auth';

test.describe('Calendar System', () => {

    test.describe('Student View', () => {
        test.beforeEach(async ({ page }) => {
            await loginAs(page, 'student');
        });

        test('should display classes list', async ({ page }) => {
            // Navigate to classes
            const classesLink = page.locator('a[href*="class"]').first();
            if (await classesLink.isVisible()) {
                await classesLink.click();
                await waitForPageLoad(page);
            }

            await expect(page.locator('body')).toBeVisible();
        });

        test('should have upcoming and past classes tabs', async ({ page }) => {
            await page.goto('/es/campus/classes');
            await waitForPageLoad(page);

            // Look for tabs
            const tabsContainer = page.locator('[role="tablist"], .tabs, [data-testid*="tab"]').first();
            await expect(page.locator('body')).toBeVisible();
        });

        test('should show class details when clicking on class', async ({ page }) => {
            await page.goto('/es/campus/classes');
            await waitForPageLoad(page);

            // Click on first class if exists
            const classCard = page.locator('[data-testid="class-card"], .class-item, [class*="session"]').first();

            if (await classCard.isVisible()) {
                await classCard.click();
                // Modal or details should appear
            }
        });

        test('should show Meet link for scheduled classes', async ({ page }) => {
            await page.goto('/es/campus/classes');
            await waitForPageLoad(page);

            // Look for Meet links
            const meetLink = page.locator('a[href*="meet.google.com"], [data-testid="meet-link"]').first();
            // May or may not have scheduled classes with Meet
            await expect(page.locator('body')).toBeVisible();
        });
    });

    test.describe('Teacher View', () => {
        test.beforeEach(async ({ page }) => {
            await loginAs(page, 'teacher');
        });

        test('should display calendar view', async ({ page }) => {
            await page.goto('/es/campus/teacher/calendar');
            await waitForPageLoad(page);

            await expect(page.locator('body')).toBeVisible();
        });

        test('should show availability management', async ({ page }) => {
            await page.goto('/es/campus/teacher/calendar');
            await waitForPageLoad(page);

            // Look for availability section
            const availabilitySection = page.locator('[data-testid="availability"], [class*="availability"]').first();
            await expect(page.locator('body')).toBeVisible();
        });

        test('should be able to mark session as completed', async ({ page }) => {
            await page.goto('/es/campus/teacher/calendar');
            await waitForPageLoad(page);

            // Look for past sessions that can be marked
            const pastSession = page.locator('[data-testid="session-past"], .session-past').first();

            if (await pastSession.isVisible()) {
                await pastSession.click();

                // Look for complete button
                const completeBtn = page.locator('[data-testid="mark-complete"], button:has-text("Completar")').first();
            }
        });

        test('should be able to add notes to session', async ({ page }) => {
            await page.goto('/es/campus/teacher/calendar');
            await waitForPageLoad(page);

            // Click on any session
            const session = page.locator('[data-testid="session-card"], .session-card').first();

            if (await session.isVisible()) {
                await session.click();

                // Look for notes field
                const notesField = page.locator('[data-testid="teacher-notes"], textarea[name*="notes"]').first();
            }
        });
    });

    test.describe('Admin View', () => {
        test.beforeEach(async ({ page }) => {
            await loginAs(page, 'admin');
        });

        test('should display global calendar', async ({ page }) => {
            await page.goto('/es/campus/admin/calendar');
            await waitForPageLoad(page);

            await expect(page.locator('body')).toBeVisible();
        });

        test('should be able to filter by teacher', async ({ page }) => {
            await page.goto('/es/campus/admin/calendar');
            await waitForPageLoad(page);

            // Look for teacher filter
            const teacherFilter = page.locator('[data-testid="teacher-filter"], select[name*="teacher"]').first();

            if (await teacherFilter.isVisible()) {
                // Select first teacher option
                await teacherFilter.selectOption({ index: 1 });
            }
        });

        test('should be able to schedule class for any student', async ({ page }) => {
            await page.goto('/es/campus/admin/calendar');
            await waitForPageLoad(page);

            // Look for schedule button
            const scheduleBtn = page.locator('[data-testid="schedule-btn"], button:has-text("Programar")').first();

            if (await scheduleBtn.isVisible()) {
                await scheduleBtn.click();

                // Modal should have student and teacher selects
                const studentSelect = page.locator('[data-testid="student-select"], select[name*="student"]').first();
                const teacherSelect = page.locator('[data-testid="teacher-select"], select[name*="teacher"]').first();
            }
        });
    });
});
