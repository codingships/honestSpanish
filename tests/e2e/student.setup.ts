import { test as setup, expect } from '@playwright/test';

const authFile = 'tests/e2e/.auth/student.json';

setup('authenticate as student', async ({ page }) => {
    // Ir a login
    await page.goto('/es/login');

    // Esperar hidratación del componente AuthForm
    await page.waitForFunction(() => {
        const island = document.querySelector('astro-island');
        return island && !island.hasAttribute('ssr');
    }, { timeout: 10000 });

    // Rellenar credenciales
    await page.fill('input[type="email"]', process.env.TEST_STUDENT_EMAIL!);
    await page.fill('input[type="password"]', process.env.TEST_STUDENT_PASSWORD!);

    // Click en submit
    await page.click('button[type="submit"]');

    // Esperar a que redirija al campus
    await page.waitForURL(/\/campus/, { timeout: 15000 });

    // Verificar que estamos logueados
    await expect(page).toHaveURL(/\/campus/);

    // Guardar estado de autenticación (cookies, localStorage)
    await page.context().storageState({ path: authFile });
});
