import { test, expect } from '@playwright/test';

test.describe('Fase 1 UAT: Onboarding y Seguridad', () => {

    test('1.1.A: el registro exige la confirmación 18+ sin crear usuarios', async ({ page }) => {
        await page.goto('/es/login', { waitUntil: 'domcontentloaded' });

        // Esperar hidratación del componente AuthForm
        await page.waitForFunction(() => {
            const island = document.querySelector('astro-island');
            return island && !island.hasAttribute('ssr');
        }, { timeout: 10000 });

        // Cambiar a modo registro (es el botón dentro del div "mt-6 p")
        const switchModeBtn = page.locator('div.mt-6 p button');
        await switchModeBtn.click();

        await expect(page.locator('input[type="email"]')).toBeVisible();
        await expect(page.locator('input[type="password"]')).toBeVisible();

        await page.fill('input[type="email"]', 'signup-ui-only@example.com');
        await page.fill('input[type="password"]', 'TestPassword123!');

        // Sin la confirmación 18+, el componente corta el flujo antes de llamar
        // a Supabase. Este proyecto público nunca debe crear usuarios Auth.
        await page.click('form button[type="submit"]');
        await expect(page.getByRole('alert')).toContainText('Debes confirmar que tienes al menos 18 años');
        await expect(page.locator('input[type="checkbox"]')).not.toBeChecked();

        await page.locator('input[type="checkbox"]').check();
        await expect(page.locator('input[type="checkbox"]')).toBeChecked();
    });

    test('1.3.A y B: recuperar contraseña muestra el formulario sin enviar email', async ({ page }) => {
        await page.goto('/es/login', { waitUntil: 'domcontentloaded' });

        // Esperar hidratación del componente AuthForm
        await page.waitForFunction(() => {
            const island = document.querySelector('astro-island');
            return island && !island.hasAttribute('ssr');
        }, { timeout: 10000 });

        // Buscar el botón de "Olvidé mi contraseña" (botón principal dentro de div mt-2)
        const forgotLink = page.locator('div.mt-2 button');
        await forgotLink.first().click();

        // Debería mostrar el formulario de recuperación
        await expect(page.locator('input[type="email"]')).toBeVisible();

        const emailInput = page.locator('input[type="email"]');
        await emailInput.fill('reset-ui-only@example.com');
        await expect(emailInput).toHaveValue('reset-ui-only@example.com');
        await expect(page.locator('form button[type="submit"]')).toBeEnabled();
    });

    test('1.3.C: Reset password sin sesión muestra recuperación de enlace inválido', async ({ page }) => {
        await page.goto('/es/reset-password', { waitUntil: 'domcontentloaded' });

        await expect(page.getByRole('heading', { name: 'Restablecer contraseña' })).toBeVisible();
        await expect(page.getByRole('alert')).toContainText('Este enlace no es válido o ha caducado');
        await expect(page.getByRole('link', { name: 'Iniciar sesión' })).toHaveAttribute('href', '/es/login');
        await expect(page.getByLabel('Nueva contraseña', { exact: true })).toBeDisabled();
        await expect(page.getByRole('button', { name: 'Restablecer contraseña' })).toBeDisabled();
    });
});
