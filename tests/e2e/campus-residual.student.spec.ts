import { expect, test } from '@playwright/test';

test.describe('Residual student campus pages', () => {
    test('student account exposes profile, security, billing and logout controls', async ({ page }) => {
        const response = await page.goto('/es/campus/account');

        expect(response?.status()).toBe(200);
        await expect(page).toHaveURL(/\/es\/campus\/account$/);
        await expect(page.getByRole('heading', { name: /informaci/i })).toBeVisible();
        await expect(page.locator('input[type="email"]').first()).toBeVisible();
        await expect(page.getByRole('button', { name: /cambiar contrase/i })).toBeVisible();
        await expect(page.getByRole('main').getByRole('link', { name: /cerrar todas/i })).toBeVisible();
    });

    test('student support page shows issue guidance and opens the local report form', async ({ page }) => {
        const response = await page.goto('/es/campus/support');

        expect(response?.status()).toBe(200);
        await expect(page).toHaveURL(/\/es\/campus\/support$/);
        await expect(page.getByRole('main').getByRole('heading', { name: /^soporte$/i })).toBeVisible();

        const reportButton = page.getByRole('button', { name: /avisar de este error/i }).first();
        await expect(reportButton).toBeVisible();
        await reportButton.click();

        await expect(page.locator('textarea[name="message"]').first()).toBeVisible();
        await expect(page.getByRole('button', { name: /enviar aviso/i }).first()).toBeVisible();
        await page.getByRole('button', { name: /^cancelar$/i }).first().click();
        await expect(page.locator('textarea[name="message"]').first()).toBeHidden();
    });
});
