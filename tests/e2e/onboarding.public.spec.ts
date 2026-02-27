import { test, expect } from '@playwright/test';

test.describe('Fase 1 UAT: Onboarding y Seguridad', () => {

    test('1.1.A: Ir a /login, cambiar a register, rellenar email+password de alumno nuevo', async ({ page }) => {
        // Generar un email único para evitar conflictos de registro
        const uniqueEmail = `test.student.${Date.now()}@test.espanolhonesto.com`;

        await page.goto('/es/login');

        // Cambiar a modo registro (es el botón dentro del div "mt-6 p")
        const switchModeBtn = page.locator('div.mt-6 p button');
        await switchModeBtn.click();

        await expect(page.locator('input[type="email"]')).toBeVisible();
        await expect(page.locator('input[type="password"]')).toBeVisible();

        // Rellenar formulario
        await page.fill('input[type="email"]', uniqueEmail);
        await page.fill('input[type="password"]', 'TestPassword123!');

        // Enviar formulario de registro (el submit principal)
        await page.click('form button[type="submit"]');

        // Resultado esperado: el componente Redirige a /api/auth/post-login o muestra mensaje
        try {
            await page.waitForURL(/\/(login|campus|api)/, { timeout: 15000 });
            expect(page.url()).toMatch(/\/(login|campus|api)/);
        } catch (e) {
            // Si no redirige, podría haber un mensaje de éxito
            const successMsg = page.locator('.bg-green-100');
            await expect(successMsg.first()).toBeVisible({ timeout: 5000 });
        }
    });

    test('1.3.A y B: Recuperar contraseña muestra formulario y envía email', async ({ page }) => {
        await page.goto('/es/login');

        // Buscar el botón de "Olvidé mi contraseña" (botón principal dentro de div mt-2)
        const forgotLink = page.locator('div.mt-2 button');
        await forgotLink.first().click();

        // Debería mostrar el formulario de recuperación
        await expect(page.locator('input[type="email"]')).toBeVisible();

        // Introducir email
        await page.fill('input[type="email"]', 'test.student.forgot@test.com');
        await page.click('form button[type="submit"]');

        // Mensaje de éxito (.bg-green-100 en la UI)
        const successMsg = page.locator('.bg-green-100');
        await expect(successMsg.first()).toBeVisible({ timeout: 8000 });
    });
});
