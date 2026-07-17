import { expect, test } from '@playwright/test';

const isStagingEnv = process.env.PUBLIC_APP_ENV?.toLowerCase() === 'staging';
const russianLabel = String.fromCodePoint(0x0422, 0x0435, 0x0441, 0x0442, 0x043e, 0x0432, 0x0430, 0x044f, 0x20, 0x0441, 0x0440, 0x0435, 0x0434, 0x0430);
const russianText = String.fromCodePoint(
    0x041d, 0x0435, 0x20, 0x0438, 0x0441, 0x043f, 0x043e, 0x043b, 0x044c, 0x0437, 0x0443, 0x0439, 0x0442, 0x0435,
    0x20, 0x0441, 0x20, 0x0440, 0x0435, 0x0430, 0x043b, 0x044c, 0x043d, 0x044b, 0x043c, 0x0438, 0x20, 0x0443,
    0x0447, 0x0435, 0x043d, 0x0438, 0x043a, 0x0430, 0x043c, 0x0438,
);

// Component coverage for src/components/EnvironmentBanner.astro.
test.describe('EnvironmentBanner', () => {
    test('stays hidden on normal public localhost by default', async ({ page }) => {
        test.skip(isStagingEnv, 'Default-hidden behavior is covered when PUBLIC_APP_ENV is not staging.');

        await page.goto('/es');

        await expect(page.getByTestId('environment-banner')).toHaveCount(0);
    });

    test('shows a semantic localized warning in staging mode', async ({ page }) => {
        test.skip(!isStagingEnv, 'EnvironmentBanner staging mode requires PUBLIC_APP_ENV=staging.');

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
    });
});
