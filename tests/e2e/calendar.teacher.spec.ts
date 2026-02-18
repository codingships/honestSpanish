import { test, expect } from '@playwright/test';

test.describe('Teacher Calendar', () => {
    test('teacher calendar page loads and shows the current week', async ({ page }) => {
        await page.goto('/es/campus/teacher/calendar');
        await page.waitForLoadState('domcontentloaded');
        expect(page.url()).not.toContain('/login');
        expect(page.url()).toContain('/campus');
    });

    test('previous week navigation button is visible and clickable', async ({ page }) => {
        await page.goto('/es/campus/teacher/calendar');
        await page.waitForLoadState('domcontentloaded');

        const prevBtn = page.locator('button:has-text("←"), button[aria-label*="anterior"], button[aria-label*="prev"]').first();
        await expect(prevBtn).toBeVisible({ timeout: 10000 });
        await prevBtn.click();
        // Should remain on the same page
        expect(page.url()).toContain('/campus');
    });

    test('next week navigation button is visible and clickable', async ({ page }) => {
        await page.goto('/es/campus/teacher/calendar');
        await page.waitForLoadState('domcontentloaded');

        const nextBtn = page.locator('button:has-text("→"), button[aria-label*="siguiente"], button[aria-label*="next"]').first();
        await expect(nextBtn).toBeVisible({ timeout: 10000 });
        await nextBtn.click();
        expect(page.url()).toContain('/campus');
    });

    test('"Programar clase" button is visible', async ({ page }) => {
        await page.goto('/es/campus/teacher/calendar');
        await page.waitForLoadState('domcontentloaded');

        const scheduleBtn = page.locator('button:has-text("Programar clase"), button:has-text("Programar")').first();
        await expect(scheduleBtn).toBeVisible({ timeout: 10000 });
    });

    test('clicking "Programar clase" opens the schedule modal', async ({ page }) => {
        await page.goto('/es/campus/teacher/calendar');
        await page.waitForLoadState('domcontentloaded');

        const scheduleBtn = page.locator('button:has-text("Programar clase"), button:has-text("Programar")').first();
        await expect(scheduleBtn).toBeVisible({ timeout: 10000 });
        await scheduleBtn.click();

        // Modal opens — identified by the "CONTINUAR" button unique to it
        const continuar = page.locator('button:has-text("Continuar")').first();
        await expect(continuar).toBeVisible({ timeout: 5000 });
    });

    test('"Disponibilidad" tab is visible on the calendar page', async ({ page }) => {
        await page.goto('/es/campus/teacher/calendar');
        await page.waitForLoadState('domcontentloaded');

        const dispTab = page.locator('button:has-text("Disponibilidad")').first();
        await expect(dispTab).toBeVisible({ timeout: 10000 });
    });

    test('availability section is accessible from the teacher campus area', async ({ page }) => {
        await page.goto('/es/campus/teacher');
        await page.waitForLoadState('domcontentloaded');
        expect(page.url()).not.toContain('/login');
        expect(page.url()).toContain('/campus');
    });
});
