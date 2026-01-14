import { test, expect } from '@playwright/test';

/**
 * Student Campus Tests
 * Ejecuta con: npx playwright test --project=student
 * 
 * Verifica:
 * - Dashboard de estudiante visible
 * - Acceso a cuenta
 * - NO puede acceder a áreas de teacher/admin
 * - Navegación interna
 */

test.describe('Student Dashboard', () => {
    test('should show student dashboard with key elements', async ({ page }) => {
        await page.goto('/es/campus');
        await expect(page).toHaveURL(/\/campus/);

        // Debe mostrar panel de control
        await expect(page.locator('h1').filter({ hasText: /panel de control/i }).first()).toBeVisible();
    });

    test('should display student navigation menu', async ({ page }) => {
        await page.goto('/es/campus');

        // Verificar elementos de navegación básicos
        await expect(page.getByRole('navigation')).toBeVisible();
    });
});

test.describe('Student Account', () => {
    test('should access account page', async ({ page }) => {
        await page.goto('/es/campus/account');
        await expect(page.getByRole('heading', { name: /mi cuenta|account/i }).first()).toBeVisible();
    });

    test('should display profile form on account page', async ({ page }) => {
        await page.goto('/es/campus/account');

        // Debe haber un formulario de perfil
        await expect(page.locator('form')).toBeVisible();
    });
});

test.describe('Student Access Control - CRITICAL', () => {
    test('should NOT access teacher area - redirect to campus', async ({ page }) => {
        await page.goto('/es/campus/teacher');

        // Debe redirigir a /campus (estudiante no tiene acceso a teacher)
        await expect(page).toHaveURL(/\/es\/campus$/);
    });

    test('should NOT access admin area - redirect to campus', async ({ page }) => {
        await page.goto('/es/campus/admin');

        // Debe redirigir a /campus (estudiante no tiene acceso a admin)
        await expect(page).toHaveURL(/\/es\/campus$/);
    });

    test('should NOT access admin students list', async ({ page }) => {
        await page.goto('/es/campus/admin/students');

        // Debe redirigir
        await expect(page).not.toHaveURL(/\/admin\/students/);
    });

    test('should NOT access teacher dashboard directly', async ({ page }) => {
        await page.goto('/es/campus/teacher/dashboard');

        // Debe redirigir
        await expect(page).not.toHaveURL(/\/teacher\/dashboard/);
    });
});

test.describe('Student Navigation', () => {
    test('should navigate between campus pages', async ({ page }) => {
        // Ir a campus
        await page.goto('/es/campus');
        await expect(page).toHaveURL(/\/campus/);

        // Ir a cuenta
        await page.goto('/es/campus/account');
        await expect(page).toHaveURL(/\/campus\/account/);
    });

    test('should be able to access public pages while logged in', async ({ page }) => {
        // Un estudiante logueado también puede ver páginas públicas
        await page.goto('/es');
        await expect(page).toHaveURL(/\/es$/);
    });
});

test.describe('Student Logout', () => {
    test('should logout and redirect to login', async ({ page }) => {
        await page.goto('/es/campus');

        // Ir a logout
        await page.goto('/es/logout');

        // Debe redirigir a login o home
        await page.waitForTimeout(1000);

        // Intentar acceder a campus debe redirigir a login
        await page.goto('/es/campus');
        await expect(page).toHaveURL(/\/login/);
    });
});

test.describe('Student Profile Editing', () => {
    test('should display profile form with current data', async ({ page }) => {
        await page.goto('/es/campus/account');

        // Email field should be visible and disabled (read-only)
        const emailInput = page.locator('input[type="email"]');
        await expect(emailInput).toBeVisible();
        await expect(emailInput).toBeDisabled();
    });

    test('should allow editing profile fields', async ({ page }) => {
        await page.goto('/es/campus/account');

        // Name field should be editable
        const nameInput = page.locator('input[name="fullName"]');
        if (await nameInput.isVisible()) {
            await nameInput.fill('Test Name Updated');
            await expect(nameInput).toHaveValue('Test Name Updated');
        }
    });

    test('should show save button on profile form', async ({ page }) => {
        await page.goto('/es/campus/account');

        // Submit button should be visible
        const submitButton = page.locator('button[type="submit"]');
        await expect(submitButton).toBeVisible();
    });
});