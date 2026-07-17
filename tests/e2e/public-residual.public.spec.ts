import { expect, test } from '@playwright/test';

const mojibakePattern = /[\u00c2\u00c3\ufffd]|\u00d0[\u0080-\u00bf\u2018-\u201f]|\u00d1[\u0080-\u00bf\u2018-\u201f]|\u00e2[\u0080-\u00bf\u2018-\u201f]/u;
const demoGuideEnabled = process.env.DEMO_GUIDE_ENABLED === 'true';

async function expectPageHasNoMojibake(page: import('@playwright/test').Page) {
    const text = await page.locator('body').innerText();
    expect(text).not.toMatch(mojibakePattern);
}

test.describe('Residual public routes', () => {
    test('root route redirects permanently to the Spanish home', async ({ page }) => {
        const response = await page.request.get('/', { maxRedirects: 0 });

        expect(response.status()).toBe(301);
        expect(response.headers().location).toBe('/es/');

        await page.goto('/', { waitUntil: 'domcontentloaded' });
        await expect(page).toHaveURL(/\/es\/?$/);
        await expect(page.locator('html')).toHaveAttribute('lang', 'es');
        await expectPageHasNoMojibake(page);
    });

    test('blog index lists localized posts and links to article pages', async ({ page }) => {
        const response = await page.goto('/es/blog/', { waitUntil: 'domcontentloaded' });

        expect(response?.status()).toBe(200);
        const main = page.locator('main#main-content');
        await expect(main).toHaveCount(1);
        await expect(main).toContainText('Blog');
        await expect(page.getByRole('navigation', { name: 'Ruta de navegación' })).toBeVisible();
        const skipLink = page.getByRole('link', { name: 'Saltar al contenido principal' });
        await skipLink.focus();
        await expect(skipLink).toBeVisible();
        await page.keyboard.press('Enter');
        await expect(main).toBeFocused();
        await expect(page.locator('article')).not.toHaveCount(0);
        await expect(page.locator('article a[href^="/es/blog/"]').first()).toBeVisible();
        await expect(page.locator('a[href="/es#contacto"]')).toBeVisible();
        await expectPageHasNoMojibake(page);
    });

    test('blog article renders content, canonical metadata and CTA', async ({ page }) => {
        await page.goto('/es/blog/', { waitUntil: 'domcontentloaded' });
        const articleHref = await page.locator('article a[href^="/es/blog/"]').first().getAttribute('href');

        expect(articleHref).toBeTruthy();

        const response = await page.goto(articleHref!, { waitUntil: 'domcontentloaded' });

        expect(response?.status()).toBe(200);
        const main = page.locator('main#main-content');
        await expect(main).toHaveCount(1);
        await expect(page.getByRole('navigation', { name: 'Ruta de navegación' })).toBeVisible();
        const skipLink = page.getByRole('link', { name: 'Saltar al contenido principal' });
        await skipLink.focus();
        await expect(skipLink).toBeVisible();
        await page.keyboard.press('Enter');
        await expect(main).toBeFocused();
        await expect(page.locator('article h1')).toBeVisible();
        await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
            'href',
            new RegExp(`${articleHref!.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\/?$`),
        );
        await expect(page.locator('nav a[href="/es/blog"]')).toBeVisible();
        await expect(page.locator('section a[href="/es#contacto"]')).toBeVisible();
        await expectPageHasNoMojibake(page);
    });

    test('localized blog and segment skip links move keyboard focus to main content', async ({ page }) => {
        const localizedBlogRoutes = [
            {
                index: '/es/blog/',
                article: '/es/blog/cuanto-tiempo-hablar-espanol-fluido',
                skip: 'Saltar al contenido principal',
                breadcrumb: 'Ruta de navegación',
            },
            {
                index: '/en/blog/',
                article: '/en/blog/how-long-to-speak-spanish-fluently',
                skip: 'Skip to main content',
                breadcrumb: 'Breadcrumb',
            },
            {
                index: '/ru/blog/',
                article: '/ru/blog/how-long-to-speak-spanish-fluently',
                skip: 'Перейти к основному содержанию',
                breadcrumb: 'Навигационная цепочка',
            },
        ];

        for (const localized of localizedBlogRoutes) {
            for (const route of [localized.index, localized.article]) {
                await page.goto(route, { waitUntil: 'domcontentloaded' });
                const main = page.locator('main#main-content');
                await expect(main).toHaveCount(1);
                await expect(page.getByRole('navigation', { name: localized.breadcrumb })).toBeVisible();
                const skipLink = page.getByRole('link', { name: localized.skip });
                await skipLink.focus();
                await expect(skipLink).toBeVisible();
                await page.keyboard.press('Enter');
                await expect(main).toBeFocused();
            }
        }

        await page.goto('/es/espanol-para-vivir-en-espana', { waitUntil: 'domcontentloaded' });
        const segmentMain = page.locator('main#main-content');
        await expect(segmentMain).toHaveCount(1);
        await expect(page.getByRole('navigation', { name: 'Navegación principal' })).toBeVisible();
        const segmentSkipLink = page.getByRole('link', { name: 'Saltar al contenido principal' });
        await segmentSkipLink.focus();
        await expect(segmentSkipLink).toBeVisible();
        await page.keyboard.press('Enter');
        await expect(segmentMain).toBeFocused();
    });

    test('blog RSS feed returns localized XML without encoded text corruption', async ({ page }) => {
        const response = await page.request.get('/es/blog/rss.xml');
        const text = await response.text();

        expect(response.status()).toBe(200);
        expect(response.headers()['content-type']).toMatch(/xml|rss/);
        expect(text).toContain('<rss');
        expect(text).toContain('<language>es</language>');
        expect(text).toContain('/es/blog/');
        expect(text).not.toMatch(mojibakePattern);
    });

    test('checkout success and cancel result pages are noindex and link to the right next step', async ({ page }) => {
        const success = await page.goto('/es/success', { waitUntil: 'domcontentloaded' });
        expect(success?.status()).toBe(200);
        await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
        await expect(page.getByRole('heading', { level: 1, name: 'Pago completado' })).toBeVisible();
        await expect(page.getByRole('link', { name: 'Ir al campus' })).toHaveAttribute('href', '/es/campus');
        await expectPageHasNoMojibake(page);

        const cancel = await page.goto('/es/cancel', { waitUntil: 'domcontentloaded' });
        expect(cancel?.status()).toBe(200);
        await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
        await expect(page.getByRole('heading', { level: 1, name: 'Pago cancelado' })).toBeVisible();
        await expect(page.getByRole('link', { name: 'Volver a precios' })).toHaveAttribute('href', '/es/#pricing');
        await expectPageHasNoMojibake(page);
    });

    test('demo routes are noindex 404s when the guided demo is disabled', async ({ page }) => {
        test.skip(demoGuideEnabled, 'Enabled demo redirect behavior is covered by demo-guide.public.spec.ts.');

        for (const route of ['/es/demo', '/demo']) {
            const requestResponse = await page.request.get(route);
            expect(requestResponse.status()).toBe(404);
            expect(requestResponse.headers()['x-robots-tag']).toContain('noindex');

            const response = await page.goto(route, { waitUntil: 'domcontentloaded' });
            expect(response?.status()).toBe(404);
            expect(response?.headers()['x-robots-tag']).toContain('noindex');
            await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
            await expectPageHasNoMojibake(page);
        }
    });

    test('Russian landing page renders with Cyrillic text and no mojibake', async ({ page }) => {
        const response = await page.goto('/ru/', { waitUntil: 'domcontentloaded' });

        expect(response?.status()).toBe(200);
        await expect(page.locator('html')).toHaveAttribute('lang', 'ru');
        await expect(page.locator('body')).toContainText(/[\u0400-\u04ff]/);
        await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', /\/ru\/?$/);
        await expectPageHasNoMojibake(page);
    });
});
