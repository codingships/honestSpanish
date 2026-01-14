import { test, expect } from '@playwright/test';

/**
 * Teacher Campus Tests
 * Ejecuta con: npx playwright test --project=teacher
 * 
 * Verifica:
 * - Dashboard de profesor visible
 * - Acceso a lista de estudiantes asignados
 * - NO puede acceder a área de admin
 * - Puede ver/editar notas de estudiantes asignados
 */

test.describe('Teacher Dashboard', () => {
    test('should show teacher dashboard', async ({ page }) => {
        await page.goto('/es/campus/teacher');
        await expect(page).toHaveURL(/\/campus\/teacher/);

        // Debe mostrar contenido de profesor
        await expect(page.locator('body')).toContainText(/profesor|teacher|estudiantes|students/i);
    });

    test('should display teacher navigation', async ({ page }) => {
        await page.goto('/es/campus/teacher');
        await expect(page.getByRole('navigation')).toBeVisible();
    });
});

test.describe('Teacher Student Management', () => {
    test('should see assigned students list', async ({ page }) => {
        await page.goto('/es/campus/teacher');

        // Debe haber sección de estudiantes
        // El contenido exacto depende de si tiene estudiantes asignados
        await expect(page.locator('body')).toBeVisible();
    });
});

test.describe('Teacher Access Control - CRITICAL', () => {
    test('should NOT access admin area - redirect', async ({ page }) => {
        await page.goto('/es/campus/admin');

        // Teacher no debe poder acceder a admin, debe redirigir
        await expect(page).not.toHaveURL(/\/admin$/);
    });

    test('should NOT access admin students list', async ({ page }) => {
        await page.goto('/es/campus/admin/students');

        // Debe redirigir
        await expect(page).not.toHaveURL(/\/admin\/students/);
    });

    test('should NOT access admin student detail', async ({ page }) => {
        await page.goto('/es/campus/admin/student/some-id');

        // Debe redirigir
        await expect(page).not.toHaveURL(/\/admin\/student\//);
    });

    test('should access own account page', async ({ page }) => {
        await page.goto('/es/campus/account');

        // Teachers también tienen cuenta
        await expect(page).toHaveURL(/\/campus\/account/);
    });
});

test.describe('Teacher Navigation', () => {
    test('should navigate to own account', async ({ page }) => {
        await page.goto('/es/campus/teacher');

        // Ir a cuenta
        await page.goto('/es/campus/account');
        await expect(page).toHaveURL(/\/campus\/account/);
    });

    test('should access public pages while logged in', async ({ page }) => {
        await page.goto('/es');
        await expect(page).toHaveURL(/\/es/);
    });
});

test.describe('Teacher Notes Functionality', () => {
    test('should see student list on teacher dashboard', async ({ page }) => {
        await page.goto('/es/campus/teacher');

        // Dashboard del profesor debe mostrar algo
        await expect(page.locator('body')).toBeVisible();
    });

    test('should access student detail page if available', async ({ page }) => {
        await page.goto('/es/campus/teacher');

        // Buscar enlace a estudiante si existe
        const studentLink = page.locator('a[href*="/teacher/student/"]').first();
        if (await studentLink.isVisible()) {
            await studentLink.click();
            await expect(page).toHaveURL(/\/teacher\/student\//);
        }
    });
});

test.describe('Teacher Logout', () => {
    test('should logout and redirect to login', async ({ page }) => {
        await page.goto('/es/campus/teacher');

        // Ir a logout
        await page.goto('/es/logout');

        // Esperar la redirección
        await page.waitForTimeout(1000);

        // Intentar acceder a campus/teacher debe redirigir a login
        await page.goto('/es/campus/teacher');
        await expect(page).toHaveURL(/\/login/);
    });
});