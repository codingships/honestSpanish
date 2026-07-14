import { expect, test } from '@playwright/test';

test.use({ bypassCSP: false });

// Component coverage for src/components/LandingPage.astro.
test.describe('LandingPage', () => {
    test('FAQ behaves as an accessible single-open accordion', async ({ page }) => {
        await page.goto('/es');
        await page.locator('#faq').scrollIntoViewIfNeeded();

        const firstButton = page.locator('[data-faq-button="0"]');
        const secondButton = page.locator('[data-faq-button="1"]');
        const firstContent = page.locator('#faq-content-0');
        const secondContent = page.locator('#faq-content-1');

        await expect(firstButton).toHaveAttribute('type', 'button');
        await expect(firstButton).toHaveAttribute('aria-expanded', 'false');
        await expect(firstButton).toHaveAttribute('aria-controls', 'faq-content-0');
        await expect(firstContent).toHaveAttribute('role', 'region');
        await expect(firstContent).toHaveAttribute('aria-labelledby', 'faq-button-0');
        await expect(firstContent).toHaveAttribute('aria-hidden', 'true');
        await expect(firstContent).toHaveJSProperty('hidden', true);

        await firstButton.click();
        await expect(firstButton).toHaveAttribute('aria-expanded', 'true');
        await expect(firstContent).toHaveAttribute('aria-hidden', 'false');
        await expect(firstContent).toHaveJSProperty('hidden', false);
        await expect(firstContent).toBeVisible();

        await secondButton.click();
        await expect(firstButton).toHaveAttribute('aria-expanded', 'false');
        await expect(firstContent).toHaveAttribute('aria-hidden', 'true');
        await expect(firstContent).toHaveJSProperty('hidden', true);
        await expect(secondButton).toHaveAttribute('aria-expanded', 'true');
        await expect(secondContent).toHaveAttribute('aria-hidden', 'false');

        await secondButton.click();
        await expect(secondButton).toHaveAttribute('aria-expanded', 'false');
        await expect(secondContent).toHaveAttribute('aria-hidden', 'true');
        await expect(secondContent).toHaveJSProperty('hidden', true);
    });

    test('mobile menu is hidden from focus until opened and closes from keyboard or link selection', async ({ page }) => {
        await page.setViewportSize({ width: 390, height: 844 });
        await page.goto('/es');

        const menuButton = page.locator('#mobile-menu-btn');
        const overlay = page.locator('#mobile-overlay');

        await expect(menuButton).toBeVisible();
        await expect(menuButton).toHaveAttribute('type', 'button');
        await expect(menuButton).toHaveAttribute('aria-expanded', 'false');
        await expect(menuButton).toHaveAttribute('aria-controls', 'mobile-overlay');
        await expect(overlay).toHaveAttribute('aria-hidden', 'true');
        await expect(overlay).toHaveJSProperty('hidden', true);

        await menuButton.click();
        await expect(menuButton).toHaveAttribute('aria-expanded', 'true');
        await expect(overlay).toHaveAttribute('aria-hidden', 'false');
        await expect(overlay).toHaveJSProperty('hidden', false);
        await expect
            .poll(() => page.evaluate(() => document.body.classList.contains('overflow-hidden')))
            .toBe(true);

        await page.keyboard.press('Escape');
        await expect(menuButton).toHaveAttribute('aria-expanded', 'false');
        await expect(overlay).toHaveAttribute('aria-hidden', 'true');
        await expect(overlay).toHaveJSProperty('hidden', true);
        await expect
            .poll(() => page.evaluate(() => document.body.classList.contains('overflow-hidden')))
            .toBe(false);

        await menuButton.click();
        await page.locator('#mobile-overlay a[href="#faq"]').click();
        await expect(menuButton).toHaveAttribute('aria-expanded', 'false');
        await expect(page).toHaveURL(/#faq$/);
        await expect(overlay).toHaveAttribute('aria-hidden', 'true');
        await expect(overlay).toHaveJSProperty('hidden', true);
    });
});
