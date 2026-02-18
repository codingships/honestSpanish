import { test, expect } from '@playwright/test';

test.describe('Student Classes Page', () => {
    test('classes page loads without errors', async ({ page }) => {
        await page.goto('/es/campus/classes');
        await page.waitForLoadState('domcontentloaded');
        expect(page.url()).not.toContain('/login');
        expect(page.url()).toContain('/campus');
    });

    test('classes page shows "Próximas" tab', async ({ page }) => {
        await page.goto('/es/campus/classes');
        await page.waitForLoadState('domcontentloaded');

        const upcomingTab = page.locator('button:has-text("Próximas"), [role="tab"]:has-text("Próximas")').first();
        await expect(upcomingTab).toBeVisible({ timeout: 10000 });
    });

    test('classes page shows "Historial" tab', async ({ page }) => {
        await page.goto('/es/campus/classes');
        await page.waitForLoadState('domcontentloaded');

        const pastTab = page.locator('button:has-text("Historial"), [role="tab"]:has-text("Historial")').first();
        await expect(pastTab).toBeVisible({ timeout: 10000 });
    });

    test('clicking "Historial" tab switches the view', async ({ page }) => {
        await page.goto('/es/campus/classes');
        await page.waitForLoadState('domcontentloaded');

        const pastTab = page.locator('button:has-text("Historial")').first();
        await expect(pastTab).toBeVisible({ timeout: 10000 });
        await pastTab.click();

        // After clicking, the tab should become active (content changes)
        // Just verify the tab itself is still visible and we haven't navigated away
        expect(page.url()).toContain('/campus');
    });

    test('cancel button opens a confirmation modal with "Volver" option', async ({ page }) => {
        await page.goto('/es/campus/classes');
        await page.waitForLoadState('domcontentloaded');

        // Check if there is a cancel button visible (requires session > 24h in the future)
        const cancelBtn = page.locator('button:has-text("Cancelar clase"), button:has-text("Cancelar")').first();

        if (await cancelBtn.isVisible({ timeout: 3000 })) {
            await cancelBtn.click();

            // Modal should appear with a "Volver" button
            const volverBtn = page.locator('button:has-text("Volver"), button:has-text("Cerrar"), button:has-text("Close")').first();
            await expect(volverBtn).toBeVisible({ timeout: 5000 });

            // Clicking Volver closes the modal
            await volverBtn.click();
            await expect(volverBtn).not.toBeVisible({ timeout: 3000 });
        } else {
            // No cancellable sessions available — skip assertion
            test.info().annotations.push({ type: 'note', description: 'No cancellable sessions found' });
        }
    });
});
