import { expect, test } from '@playwright/test';

test.describe('Residual student campus pages', () => {
    test('campus shell exposes keyboard-safe navigation and user disclosures', async ({ page }) => {
        await page.setViewportSize({ width: 375, height: 667 });
        const response = await page.goto('/es/campus');

        expect(response?.status()).toBe(200);

        const skipLink = page.getByRole('link', { name: 'Saltar al contenido principal' });
        await page.locator('body').press('Tab');
        await expect(skipLink).toBeFocused();
        await skipLink.press('Enter');
        await expect(page.locator('#main-content')).toBeFocused();

        const sidebar = page.locator('#sidebar');
        const openSidebar = page.locator('#mobile-menu-btn');
        await expect(openSidebar).toHaveAccessibleName('Abrir navegación del campus');
        await expect(openSidebar).toHaveAttribute('aria-expanded', 'false');
        await expect(sidebar).toHaveAttribute('aria-hidden', 'true');
        await expect(sidebar).toHaveAttribute('inert', '');

        await openSidebar.press('Enter');
        await expect(openSidebar).toHaveAttribute('aria-expanded', 'true');
        await expect(openSidebar).toHaveAccessibleName('Cerrar navegación del campus');
        await expect(sidebar).not.toHaveAttribute('aria-hidden', 'true');
        await expect(sidebar).not.toHaveAttribute('inert', '');
        await expect(page.locator('#mobile-menu-close-btn')).toBeFocused();

        await page.keyboard.press('Escape');
        await expect(openSidebar).toHaveAttribute('aria-expanded', 'false');
        await expect(openSidebar).toBeFocused();

        const userMenuButton = page.getByRole('button', { name: /Abrir menú de usuario:/ });
        await userMenuButton.click();
        await expect(userMenuButton).toHaveAttribute('aria-expanded', 'true');
        await expect(page.getByRole('navigation', { name: 'Menú de usuario' })).toBeVisible();
        await expect(page.getByRole('navigation', { name: 'Menú de usuario' }).getByRole('link', { name: 'Mi cuenta' })).toBeFocused();

        await page.keyboard.press('Escape');
        await expect(userMenuButton).toHaveAttribute('aria-expanded', 'false');
        await expect(userMenuButton).toBeFocused();
    });

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
