import { expect, test } from '@playwright/test';

test.skip(process.env.DEMO_GUIDE_ENABLED !== 'true', 'DemoGuide is only mounted when DEMO_GUIDE_ENABLED=true.');

// Component coverage for src/components/DemoGuide.astro.
test.describe('DemoGuide', () => {
    test('launcher starts the guided demo and the overlay can finish', async ({ page }) => {
        await page.goto('/es?demo=launcher&demoStart=1');

        const launcher = page.locator('#eh-guide-launcher');
        await expect(launcher).toBeVisible();
        await expect(launcher).toHaveAttribute('role', 'region');
        await expect(launcher).toHaveAttribute('aria-label', 'Lanzador de demo guiada');

        await page.getByRole('button', { name: 'Iniciar demo' }).click();
        await expect(page).toHaveURL(/demo=guide/);

        const overlay = page.locator('#eh-guide-overlay');
        await expect(overlay).toBeVisible();
        await expect(overlay).toHaveAttribute('role', 'region');
        await expect(overlay).toHaveAttribute('aria-label', 'Guia de demo');
        await expect(page.getByRole('button', { name: 'Siguiente' })).toBeVisible();

        await page.getByRole('button', { name: 'Finalizar' }).click();
        await expect(overlay).toHaveCount(0);
    });

    test('overlay controls remain usable when localStorage methods throw', async ({ page }) => {
        await page.addInitScript(() => {
            const blockedStorage = () => {
                throw new Error('localStorage blocked for DemoGuide strict QA');
            };

            Object.defineProperty(Storage.prototype, 'getItem', {
                configurable: true,
                value: blockedStorage,
            });
            Object.defineProperty(Storage.prototype, 'setItem', {
                configurable: true,
                value: blockedStorage,
            });
            Object.defineProperty(Storage.prototype, 'removeItem', {
                configurable: true,
                value: blockedStorage,
            });
        });

        await page.goto('/es?demo=guide&demoStart=1');

        const overlay = page.locator('#eh-guide-overlay');
        await expect(overlay).toBeVisible();
        await page.getByRole('button', { name: 'Compacto' }).click();
        await expect(page.getByRole('button', { name: 'Expandir' })).toBeVisible();
        await page.getByRole('button', { name: 'Posicion' }).click();
        await page.getByRole('button', { name: 'Finalizar' }).click();
        await expect(overlay).toHaveCount(0);
    });
});
