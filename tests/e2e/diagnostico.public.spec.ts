import { expect, type Page, test } from '@playwright/test';

async function mockTurnstile(page: Page) {
    await page.route('**/challenges.cloudflare.com/turnstile/**', async (route) => {
        await route.fulfill({
            status: 200,
            contentType: 'application/javascript',
            body: `
                window.turnstile = {
                    render: function(container, params) {
                        if (params && params.callback) {
                            setTimeout(() => params.callback('fake-e2e-token'), 50);
                        }
                        return 'fake-widget-id';
                    },
                    reset: function() {},
                    remove: function() {},
                    isExpired: function() { return false; }
                };
            `,
        });
    });
}

// Route-level coverage for src/components/LevelCheckForm.tsx.
test.describe('LevelCheckForm diagnostic public page', () => {
    test('renders noindex diagnostic page with prefilled email and privacy link', async ({ page }) => {
        await mockTurnstile(page);

        const response = await page.goto('/es/diagnostico?email=qa.diagnostic%40example.com');

        expect(response?.headers()['x-robots-tag']).toContain('noindex');
        await expect(page.locator('main h1')).toBeVisible();
        await expect(page.locator('#level-check-email')).toHaveValue('qa.diagnostic@example.com');
        await expect(page.locator('#level-check-current-level')).toHaveValue('not_sure');
        await expect(page.locator('a[href="/es/legal/privacidad"]')).toBeVisible();
        await expect(page.locator('form')).toBeVisible();
    });

    test('submits a complete diagnostic payload and shows success state', async ({ page }) => {
        await mockTurnstile(page);

        let submittedPayload: Record<string, unknown> | undefined;
        await page.route('**/api/level-check', async (route) => {
            submittedPayload = route.request().postDataJSON();
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({ message: 'Success' }),
            });
        });

        await page.goto('/es/diagnostico?email=qa.diagnostic%40example.com');
        await expect(page.locator('#level-check-email')).toHaveValue('qa.diagnostic@example.com');

        await page.locator('#level-check-current-level').selectOption('b1');
        await page.locator('#level-check-comprehension').selectOption('depends_context');
        await page.locator('#level-check-blocker').selectOption('culture');
        await page.locator('#level-check-use-context').fill('Trabajo, reuniones y vida diaria en Madrid.');
        await page.locator('#level-check-written-sample').fill(
            'Hola, soy una persona que necesita hablar espanol con mas seguridad en reuniones, tramites y conversaciones reales de cada dia.',
        );
        await page.locator('input[name="canSendAudioLater"]').check();
        await page.locator('input[name="adultConfirmed"]').check();
        await page.locator('input[name="consent"]').check();

        await page.waitForTimeout(300);
        await page.locator('form button[type="submit"]').click();

        await expect(page.locator('form')).toHaveCount(0);
        await expect(page.getByRole('status')).toContainText('Gracias.');
        expect(submittedPayload).toMatchObject({
            email: 'qa.diagnostic@example.com',
            currentLevel: 'b1',
            comprehensionComfort: 'depends_context',
            speakingBlocker: 'culture',
            canSendAudioLater: true,
            adultConfirmed: true,
            consent: true,
            lang: 'es',
            sourcePath: '/es/diagnostico',
            'cf-turnstile-response': 'fake-e2e-token',
        });
    });

    test('shows a localized error when diagnostic consent is missing', async ({ page }) => {
        await mockTurnstile(page);

        await page.goto('/es/diagnostico?email=qa.diagnostic%40example.com');
        await page.locator('#level-check-written-sample').fill(
            'Necesito hablar espanol con mas seguridad en reuniones, tramites y conversaciones reales de cada dia.',
        );
        await page.locator('input[name="adultConfirmed"]').check();
        await page.waitForTimeout(300);
        await page.locator('form button[type="submit"]').click();

        await expect(page.getByRole('alert')).toContainText('Debes aceptar');
    });
});
