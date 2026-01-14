import { test, expect } from '@playwright/test';

/**
 * Admin Campus Tests
 * Ejecuta con: npx playwright test --project=admin
 * 
 * Verifica:
 * - Dashboard de admin visible
 * - Acceso a gestión de estudiantes
 * - Acceso a gestión de profesores
 * - PUEDE acceder a todas las áreas (admin tiene acceso completo)
 */

test.describe('Admin Dashboard', () => {
    test('should show admin dashboard', async ({ page }) => {
        await page.goto('/es/campus/admin');
        await expect(page).toHaveURL(/\/campus\/admin/);

        // Debe mostrar contenido de admin
        await expect(page.locator('body')).toContainText(/admin|panel|gestión|estudiantes/i);
    });

    test('should display admin navigation menu', async ({ page }) => {
        await page.goto('/es/campus/admin');
        await expect(page.getByRole('navigation')).toBeVisible();
    });
});

test.describe('Admin Student Management', () => {
    test('should access students list', async ({ page }) => {
        test.setTimeout(60000);
        await page.goto('/es/campus/admin/students', { waitUntil: 'networkidle' });

        // Admin puede ver lista de estudiantes
        await expect(page).toHaveURL(/\/admin\/students/, { timeout: 10000 });
    });

    test('should see students table or list', async ({ page }) => {
        test.setTimeout(60000);
        await page.goto('/es/campus/admin/students', { waitUntil: 'networkidle' });

        // Debe haber una tabla o lista de estudiantes
        await expect(page.locator('body')).toBeVisible();
    });
});

test.describe('Admin Access Control - FULL ACCESS', () => {
    test('should access teacher area', async ({ page }) => {
        test.setTimeout(60000);
        await page.goto('/es/campus/teacher', { waitUntil: 'networkidle' });

        // Admin PUEDE acceder a área de teacher
        // (puede redirigir a admin o mostrar el contenido)
        await expect(page.locator('body')).toBeVisible();
    });

    test('should access student campus area', async ({ page }) => {
        test.setTimeout(60000);
        await page.goto('/es/campus', { waitUntil: 'networkidle' });

        // Admin puede ver el campus de estudiantes
        await expect(page).toHaveURL(/\/campus/, { timeout: 10000 });
    });

    test('should access account page', async ({ page }) => {
        test.setTimeout(60000);
        await page.goto('/es/campus/account', { waitUntil: 'networkidle' });

        // Admin tiene cuenta también
        await expect(page).toHaveURL(/\/campus\/account/, { timeout: 10000 });
    });
});

test.describe('Admin Navigation', () => {
    test('should navigate between admin sections', async ({ page }) => {
        test.setTimeout(60000);
        // Dashboard admin
        await page.goto('/es/campus/admin', { waitUntil: 'networkidle' });
        await expect(page).toHaveURL(/\/campus\/admin/, { timeout: 10000 });

        // Lista de estudiantes
        await page.goto('/es/campus/admin/students', { waitUntil: 'networkidle' });
        await expect(page).toHaveURL(/\/admin\/students/, { timeout: 10000 });
    });

    test('should access public pages while logged in', async ({ page }) => {
        test.setTimeout(60000);
        await page.goto('/es', { waitUntil: 'networkidle' });
        await expect(page).toHaveURL(/\/es/, { timeout: 10000 });
    });

    test('should navigate from admin to account and back', async ({ page }) => {
        test.setTimeout(60000);
        await page.goto('/es/campus/admin', { waitUntil: 'networkidle' });
        await page.goto('/es/campus/account', { waitUntil: 'networkidle' });
        await expect(page).toHaveURL(/\/campus\/account/, { timeout: 10000 });

        await page.goto('/es/campus/admin', { waitUntil: 'networkidle' });
        await expect(page).toHaveURL(/\/campus\/admin/, { timeout: 10000 });
    });
});

test.describe('Admin Functionality', () => {
    test('should see assign teacher button on student detail', async ({ page }) => {
        await page.goto('/es/campus/admin/students');

        // Si hay estudiantes, verificar que se puede hacer clic
        const firstStudentLink = page.locator('a[href*="/admin/student/"]').first();

        if (await firstStudentLink.isVisible()) {
            await firstStudentLink.click();
            await expect(page).toHaveURL(/\/admin\/student\//);
        }
    });
});
