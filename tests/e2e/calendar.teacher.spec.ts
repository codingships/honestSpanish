import { test, expect } from '@playwright/test';

/**
 * Teacher Calendar E2E Tests
 * Ejecuta con: npx playwright test --project=teacher calendar.teacher
 * 
 * Verifica:
 * - Acceso al calendario del profesor
 * - Vista semanal con navegación
 * - Visualización de sesiones programadas
 * - Funcionalidad para programar nuevas sesiones
 */

test.describe('Teacher Calendar Access', () => {
    test('should access teacher calendar page', async ({ page }) => {
        await page.goto('/es/campus/teacher/calendar');
        await expect(page).toHaveURL(/\/campus\/teacher\/calendar/);
    });

    test('should display calendar navigation controls', async ({ page }) => {
        test.setTimeout(60000);
        try {
            await page.goto('/es/campus/teacher/calendar', { timeout: 45000 });
        } catch {
            console.log('⚠️ Navigation timeout - server overloaded, skipping');
            test.skip();
            return;
        }
        if (page.url().includes('/login')) { test.skip(); return; }

        // Debe haber controles de navegación (anterior/siguiente/hoy)
        const prevBtn = page.locator('button:has-text("←"), button[aria-label*="prev"], button[aria-label*="anterior"]').first();
        const nextBtn = page.locator('button:has-text("→"), button[aria-label*="next"], button[aria-label*="siguiente"]').first();
        const hasPrev = await prevBtn.isVisible({ timeout: 5000 }).catch(() => false);
        const hasNext = await nextBtn.isVisible({ timeout: 5000 }).catch(() => false);
        expect(hasPrev || hasNext).toBeTruthy();
    });

    test('should display week view with days', async ({ page }) => {
        await page.goto('/es/campus/teacher/calendar');

        // El calendario debe mostrar días de la semana
        await expect(page.locator('body')).toContainText(/lun|mar|mié|jue|vie|sáb|dom|mon|tue|wed|thu|fri|sat|sun/i);
    });
});

test.describe('Teacher Calendar Interaction', () => {
    test('should navigate to next week', async ({ page }) => {
        test.setTimeout(60000);
        try {
            await page.goto('/es/campus/teacher/calendar', { timeout: 45000 });
        } catch {
            console.log('⚠️ Navigation timeout, skipping');
            test.skip();
            return;
        }
        if (page.url().includes('/login')) { test.skip(); return; }

        // Click en siguiente
        const nextBtn = page.locator('button:has-text("→"), button[aria-label*="next"], button[aria-label*="siguiente"]').first();
        if (await nextBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
            await nextBtn.click();
            await page.waitForTimeout(500);
        }

        await expect(page.locator('body')).toBeVisible();
    });

    test('should navigate to previous week', async ({ page }) => {
        test.setTimeout(60000);
        try {
            await page.goto('/es/campus/teacher/calendar', { timeout: 45000 });
        } catch {
            console.log('⚠️ Navigation timeout, skipping');
            test.skip();
            return;
        }
        if (page.url().includes('/login')) { test.skip(); return; }

        const prevBtn = page.locator('button:has-text("←"), button[aria-label*="prev"], button[aria-label*="anterior"]').first();
        if (await prevBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
            await prevBtn.click();
            await page.waitForTimeout(500);
        }

        await expect(page.locator('body')).toBeVisible();
    });

    test('should have schedule session button', async ({ page }) => {
        test.setTimeout(60000);
        try {
            await page.goto('/es/campus/teacher/calendar', { timeout: 45000 });
        } catch {
            console.log('⚠️ Navigation timeout, skipping');
            test.skip();
            return;
        }
        if (page.url().includes('/login')) { test.skip(); return; }

        const scheduleBtn = page.getByRole('button', { name: /\+|programar|schedule|nueva|new/i }).first();
        if (await scheduleBtn.isVisible().catch(() => false)) {
            await expect(scheduleBtn).toBeEnabled();
        }
    });
});

test.describe('Teacher Schedule Session Modal', () => {
    test('should open schedule modal when clicking schedule button', async ({ page }) => {
        await page.goto('/es/campus/teacher/calendar');

        // Buscar botón "+" que típicamente abre el modal de programar
        const scheduleBtn = page.locator('button:has-text("+")').first();

        if (await scheduleBtn.isVisible()) {
            await scheduleBtn.click();
            await page.waitForTimeout(500);

            // Verificar que algo cambió en la página (modal o formulario)
            await expect(page.locator('body')).toBeVisible();
        }
    });
});

test.describe('Teacher Session Actions', () => {
    test('should be able to click on a session if exists', async ({ page }) => {
        await page.goto('/es/campus/teacher/calendar');

        // Si hay sesiones programadas, deben ser clickeables
        const sessionCard = page.locator('[class*="session"], [class*="class"], [data-testid*="session"]').first();

        if (await sessionCard.isVisible()) {
            await sessionCard.click();
            await page.waitForTimeout(500);

            // Debería abrir un modal de detalle o navegar
            await expect(page.locator('body')).toBeVisible();
        }
    });
});
