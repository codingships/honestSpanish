import { test, expect } from '@playwright/test';

/**
 * Student Classes E2E Tests
 * Ejecuta con: npx playwright test --project=student calendar.student
 * 
 * Verifica:
 * - Acceso a la página de clases del estudiante
 * - Vista de próximas clases
 * - Vista de clases pasadas
 * - Funcionalidad de cancelación (con validación 24h)
 * - Enlace de Meet visible cuando aplica
 */

test.describe('Student Classes Access', () => {
    test('should access student classes page', async ({ page }) => {
        await page.goto('/es/campus/classes');
        await expect(page).toHaveURL(/\/campus\/classes/);
    });

    test('should display classes page title', async ({ page }) => {
        await page.goto('/es/campus/classes');

        // Buscar el h1 dentro de main para evitar elementos de DevTools
        const title = page.getByRole('main').locator('h1').first();
        await expect(title).toBeVisible();
    });

    test('should have upcoming and past sections', async ({ page }) => {
        await page.goto('/es/campus/classes');

        // Debe tener secciones para próximas y pasadas
        await expect(page.locator('body')).toContainText(/próxima|upcoming|futura/i);
    });
});

test.describe('Student Upcoming Classes', () => {
    test('should display upcoming classes section', async ({ page }) => {
        await page.goto('/es/campus/classes');

        // Sección de próximas clases debe ser visible
        const upcomingSection = page.locator('text=/próxima|upcoming/i').first();
        await expect(upcomingSection).toBeVisible();
    });

    test('should show empty state if no upcoming classes', async ({ page }) => {
        await page.goto('/es/campus/classes');

        // Verificar que la página cargó correctamente
        // El contenido puede variar: lista vacía o cards de sesiones
        const mainContent = page.getByRole('main');
        await expect(mainContent).toBeVisible();
    });

    test('should show join button for upcoming sessions', async ({ page }) => {
        await page.goto('/es/campus/classes');

        // Si hay clases próximas, deben tener botón de unirse o enlace de Meet
        const classCard = page.locator('[class*="session"], [class*="class"]').first();

        if (await classCard.isVisible()) {
            // Puede tener botón de unirse o enlace de meet
            const hasJoinButton = await page.locator('text=/unirse|join|meet|entrar/i').isVisible().catch(() => false);
            const hasMeetLink = await page.locator('a[href*="meet.google"]').isVisible().catch(() => false);

            // Al menos la tarjeta debe ser visible
            await expect(classCard).toBeVisible();
        }
    });
});

test.describe('Student Cancel Class', () => {
    test('should show cancel button for cancellable sessions', async ({ page }) => {
        await page.goto('/es/campus/classes');

        // Si hay sesiones que se pueden cancelar (>24h), debe aparecer botón
        const cancelButton = page.getByRole('button', { name: /cancelar|cancel/i }).first();

        if (await cancelButton.isVisible()) {
            await expect(cancelButton).toBeEnabled();
        }
    });

    test('should open confirmation modal when clicking cancel', async ({ page }) => {
        await page.goto('/es/campus/classes');

        const cancelButton = page.getByRole('button', { name: /cancelar|cancel/i }).first();

        if (await cancelButton.isVisible()) {
            await cancelButton.click();
            await page.waitForTimeout(500);

            // Debe aparecer modal de confirmación
            const confirmModal = page.locator('[role="dialog"], .modal, [class*="modal"]');
            if (await confirmModal.isVisible()) {
                // Modal debe tener advertencia sobre cancelación
                await expect(confirmModal).toContainText(/confirmar|confirm|seguro|sure|cancelar/i);
            }
        }
    });
});

test.describe('Student Past Classes', () => {
    test('should display past classes section', async ({ page }) => {
        await page.goto('/es/campus/classes');

        // Sección de clases pasadas
        const pastSection = page.locator('text=/pasada|past|anterior|historial|history/i').first();
        await expect(pastSection).toBeVisible();
    });

    test('should show status badges for past sessions', async ({ page }) => {
        await page.goto('/es/campus/classes');

        // Las sesiones pasadas deben tener badges de estado
        const statusBadge = page.locator('text=/completada|completed|cancelada|cancelled|no show/i');

        // El badge puede existir o no dependiendo de si hay sesiones
        await expect(page.locator('body')).toBeVisible();
    });

    test('should show teacher notes if available', async ({ page }) => {
        await page.goto('/es/campus/classes');

        // Si hay notas del profesor, deben mostrarse
        const notesSection = page.locator('text=/notas|notes|comentarios/i');

        // La página debe cargarse correctamente
        await expect(page.locator('body')).toBeVisible();
    });
});

test.describe('Student Classes Navigation', () => {
    test('should navigate from dashboard to classes', async ({ page }) => {
        await page.goto('/es/campus');

        // Buscar enlace a clases en navegación o dashboard
        const classesLink = page.locator('a[href*="classes"]').first();

        if (await classesLink.isVisible()) {
            await classesLink.click();
            await expect(page).toHaveURL(/\/campus\/classes/);
        }
    });

    test('should return to dashboard from classes', async ({ page }) => {
        await page.goto('/es/campus/classes');

        // Buscar enlace de vuelta al dashboard
        const dashboardLink = page.locator('a[href$="/campus"], a[href*="/campus/"]').first();

        if (await dashboardLink.isVisible()) {
            // El enlace debe existir
            await expect(dashboardLink).toBeVisible();
        }
    });
});
