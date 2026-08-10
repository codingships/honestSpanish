import { expect, test } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

const thirdPartyFontHosts = new Set([
    'fonts.googleapis.com',
    'fonts.gstatic.com',
    'cdnjs.cloudflare.com',
]);

for (const locale of ['es', 'ru'] as const) {
    test(`${locale} uses deterministic same-origin typography`, async ({ page }) => {
        const thirdPartyRequests: string[] = [];
        const fontRequests: string[] = [];

        page.on('request', (request) => {
            const url = new URL(request.url());
            if (thirdPartyFontHosts.has(url.hostname)) thirdPartyRequests.push(request.url());
            if (request.resourceType() === 'font') fontRequests.push(request.url());
        });

        await page.goto(`/${locale}`);
        await page.evaluate(() => document.fonts.ready);

        const typography = await page.evaluate(() => {
            const display = document.querySelector<HTMLElement>('.font-display');
            return {
                body: getComputedStyle(document.body).fontFamily,
                display: display ? getComputedStyle(display).fontFamily : '',
                loadedFamilies: Array.from(document.fonts)
                    .filter((font) => font.status === 'loaded')
                    .map((font) => font.family),
            };
        });

        expect(typography.body).toContain('Inter Variable');
        expect(typography.display).toContain(locale === 'ru' ? 'Boldonese Cyrillic' : 'Boldonse');
        expect(typography.loadedFamilies).toContain('Inter Variable');
        expect(typography.loadedFamilies).toContain(locale === 'ru' ? 'Boldonese Cyrillic' : 'Boldonse');
        if (locale === 'ru') {
            expect(fontRequests.some((url) => url.includes('/fonts/BoldoneseCyrillic-Regular.woff2'))).toBe(true);
        }
        expect(fontRequests.length).toBeGreaterThan(0);
        expect(fontRequests.every((url) => new URL(url).origin === new URL(page.url()).origin)).toBe(true);
        expect(thirdPartyRequests).toEqual([]);

        if (process.env.CAPTURE_TYPOGRAPHY_SCREENSHOTS === 'true') {
            const outputDirectory = path.resolve('output/playwright');
            await mkdir(outputDirectory, { recursive: true });
            await page.screenshot({
                path: path.join(outputDirectory, `typography-${locale}-desktop.png`),
                fullPage: true,
            });
        }
    });
}
