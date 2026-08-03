import { expect, test } from '@playwright/test';

const showsEnvironmentBanner = ['staging', 'test'].includes(process.env.PUBLIC_APP_ENV?.toLowerCase() ?? '');
const russianLabel = String.fromCodePoint(0x0422, 0x0435, 0x0441, 0x0442, 0x043e, 0x0432, 0x0430, 0x044f, 0x20, 0x0441, 0x0440, 0x0435, 0x0434, 0x0430);
const russianText = String.fromCodePoint(
    0x041d, 0x0435, 0x20, 0x0438, 0x0441, 0x043f, 0x043e, 0x043b, 0x044c, 0x0437, 0x0443, 0x0439, 0x0442, 0x0435,
    0x20, 0x0441, 0x20, 0x0440, 0x0435, 0x0430, 0x043b, 0x044c, 0x043d, 0x044b, 0x043c, 0x0438, 0x20, 0x0443,
    0x0447, 0x0435, 0x043d, 0x0438, 0x043a, 0x0430, 0x043c, 0x0438,
);

// Component coverage for src/components/EnvironmentBanner.astro.
test.describe('EnvironmentBanner', () => {
    test('stays hidden on normal public localhost by default', async ({ page }) => {
        test.skip(showsEnvironmentBanner, 'Default-hidden behavior is covered outside test and staging.');

        await page.goto('/es');

        await expect(page.getByTestId('environment-banner')).toHaveCount(0);
    });

    test('shows a semantic localized warning in isolated non-production modes', async ({ page }) => {
        test.skip(!showsEnvironmentBanner, 'EnvironmentBanner requires PUBLIC_APP_ENV=test or staging.');

        await page.setViewportSize({ width: 390, height: 844 });
        await page.goto('/ru');

        const banner = page.getByTestId('environment-banner');
        await expect(banner).toBeVisible();
        await expect(banner).toHaveAttribute('role', 'status');
        await expect(banner).toHaveAttribute('aria-live', 'polite');
        await expect(banner).toHaveAttribute('aria-atomic', 'true');
        await expect(banner).toHaveAttribute('aria-label', russianLabel);
        await expect(page.getByRole('status', { name: russianLabel })).toBeVisible();
        await expect(banner).toContainText(russianText);
        await expect(banner).not.toContainText(/[\u00d0\u00d1\ufffd]/);

        await page.evaluate(() => window.scrollTo(0, 700));
        await expect.poll(async () => page.evaluate(() => (
            Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--environment-banner-height'))
        ))).toBeGreaterThan(0);

        const navigation = page.getByTestId('primary-navigation');
        const bannerBox = await banner.boundingBox();
        const navigationBox = await navigation.boundingBox();
        expect(bannerBox).not.toBeNull();
        expect(navigationBox).not.toBeNull();
        expect(navigationBox!.y).toBeGreaterThanOrEqual(bannerBox!.y + bannerBox!.height - 1);

        await page.locator('#mobile-menu-btn').click();
        const overlayBox = await page.locator('#mobile-overlay').boundingBox();
        expect(overlayBox).not.toBeNull();
        expect(overlayBox!.y).toBeGreaterThanOrEqual(navigationBox!.y + navigationBox!.height - 1);
    });
});
