import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

test.use({ bypassCSP: false });

const representativePublicRoutes = [
    { name: 'English offer', path: '/en' },
    { name: 'Russian offer', path: '/ru' },
    { name: 'Spanish blog index', path: '/es/blog/' },
    { name: 'Spanish article', path: '/es/blog/cuanto-tiempo-hablar-espanol-fluido' },
    { name: 'Spanish legal index', path: '/es/legal' },
    { name: 'Spanish diagnostic form', path: '/es/diagnostico' },
    { name: 'Spanish authentication', path: '/es/login' },
] as const;

test.describe('representative public accessibility', () => {
    for (const route of representativePublicRoutes) {
        test(`${route.name} passes the automated A/AA scan and 320px reflow`, async ({ page }) => {
            const response = await page.goto(route.path, { waitUntil: 'domcontentloaded' });

            expect(response?.status()).toBe(200);
            await page.evaluate(() => document.fonts.ready);

            const results = await new AxeBuilder({ page })
                .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
                .analyze();

            const summary = results.violations.map((violation) => ({
                id: violation.id,
                impact: violation.impact,
                help: violation.help,
                nodes: violation.nodes.map((node) => ({
                    target: node.target,
                    summary: node.failureSummary,
                })),
            }));

            expect(summary, JSON.stringify(summary, null, 2)).toEqual([]);

            await page.setViewportSize({ width: 320, height: 800 });
            const reflow = await page.evaluate(() => ({
                contentWidth: document.documentElement.scrollWidth,
                viewportWidth: document.documentElement.clientWidth,
                offenders: Array.from(document.querySelectorAll<HTMLElement>('body *'))
                    .map((element) => {
                        const rect = element.getBoundingClientRect();
                        return {
                            tag: element.tagName.toLowerCase(),
                            className: element.className,
                            text: element.innerText.trim().slice(0, 80),
                            left: Math.round(rect.left),
                            right: Math.round(rect.right),
                            width: Math.round(rect.width),
                        };
                    })
                    .filter((element) => element.left < -1 || element.right > document.documentElement.clientWidth + 1)
                    .slice(0, 12),
            }));
            expect(reflow.contentWidth, JSON.stringify(reflow)).toBeLessThanOrEqual(reflow.viewportWidth);
        });
    }
});
