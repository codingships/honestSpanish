import { expect, test } from '@playwright/test';

test.describe('Residual admin campus pages', () => {
    test('admin calendar page exposes global stats and scheduler controls', async ({ page }) => {
        const response = await page.goto('/es/campus/admin/calendar', { waitUntil: 'domcontentloaded' });

        expect(response?.status()).toBe(200);
        await expect(page).toHaveURL(/\/es\/campus\/admin\/calendar$/);
        await expect(page.getByRole('main').getByRole('heading', { name: /calendario global/i })).toBeVisible();
        await expect(page.getByText(/tasa/i)).toBeVisible();
        await expect(page.getByRole('button', { name: /programar clase/i })).toBeVisible();
        await expect(page.locator('select').first()).toBeVisible();
    });

    test('admin CRM contact detail route handles an unknown contact id safely', async ({ page }) => {
        const response = await page.goto('/es/campus/admin/crm/contact/00000000-0000-0000-0000-000000000000', { waitUntil: 'domcontentloaded' });

        expect(response?.status()).toBe(200);
        await expect(page).toHaveURL(/\/es\/campus\/admin\/crm\/contact\/[^/]+$/);
        await expect(page.getByRole('link', { name: /volver a crm leads/i })).toBeVisible();
        await expect(page.getByText('Ficha CRM')).toBeVisible();
        await expect(page.getByText('Historial CRM unificado')).toBeVisible();
        await expect(page.getByText(/Contacto CRM no encontrado|CRM pendiente de migracion/i)).toBeVisible();
    });

    test('admin payments page exposes metrics, filters and recovery action surface', async ({ page }) => {
        const response = await page.goto('/es/campus/admin/payments', { waitUntil: 'domcontentloaded' });

        expect(response?.status()).toBe(200);
        await expect(page).toHaveURL(/\/es\/campus\/admin\/payments$/);
        await expect(page.getByRole('main').getByRole('heading', { name: /historial de pagos/i })).toBeVisible();
        await expect(page.locator('#date-filter')).toBeVisible();
        await expect(page.locator('#status-filter')).toBeVisible();
        await expect(page.locator('#search-filter')).toBeVisible();
        await expect(page.locator('#payments-table')).toBeVisible();
    });

    test('admin support page exposes ticket filters and ticket table states', async ({ page }) => {
        const ticketsResponsePromise = page.waitForResponse((response) =>
            response.url().includes('/api/admin/support-tickets')
            && response.request().method() === 'GET'
        );
        const response = await page.goto('/es/campus/admin/support', { waitUntil: 'domcontentloaded' });

        expect(response?.status()).toBe(200);
        const ticketsResponse = await ticketsResponsePromise;
        expect(ticketsResponse.status()).toBe(200);
        await expect(page).toHaveURL(/\/es\/campus\/admin\/support$/);
        await expect(page.getByRole('button', { name: /abiertos/i })).toBeVisible();
        await expect(page.getByRole('button', { name: /revisados/i })).toBeVisible();
        await expect(page.getByRole('button', { name: /cerrados/i })).toBeVisible();
        await expect(page.locator('[aria-label="Tabla de avisos de soporte"]')).toBeVisible();
    });

    test('admin users page exposes matchmaking counts and assignment controls', async ({ page }) => {
        const response = await page.goto('/es/campus/admin/users', { waitUntil: 'domcontentloaded' });

        expect(response?.status()).toBe(200);
        await expect(page).toHaveURL(/\/es\/campus\/admin\/users$/);
        await expect(page.getByText(/gesti.n de alumnos/i)).toBeVisible();
        await expect(page.getByText(/alumnos:/i)).toBeVisible();
        await expect(page.getByText(/profesores:/i)).toBeVisible();
        await expect(page.locator('table, [role="status"]').first()).toBeVisible();
    });
});
