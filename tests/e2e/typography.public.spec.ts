import { expect, test, type Page } from '@playwright/test';
import { createHash } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

const thirdPartyFontHosts = new Set([
    'fonts.googleapis.com',
    'fonts.gstatic.com',
    'cdnjs.cloudflare.com',
]);

type SupportedLocale = 'es' | 'en' | 'ru';

async function primeFullPageRendering(page: Page) {
    await page.evaluate(async () => {
        const waitForPaint = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        const step = Math.max(window.innerHeight * 0.8, 320);
        for (let offset = 0; offset < document.documentElement.scrollHeight; offset += step) {
            window.scrollTo(0, offset);
            await waitForPaint();
        }
        window.scrollTo(0, 0);
        await waitForPaint();
    });
}

async function prepareVisualCapture(page: Page) {
    await page.evaluate(() => {
        try {
            window.localStorage.setItem('cookie_consent', 'accepted');
        } catch {
            // Visual QA remains deterministic when storage is unavailable.
        }
        document.documentElement.removeAttribute('data-environment-banner');
        document.documentElement.removeAttribute('data-cookie-banner-visible');
        const cookieBanner = document.querySelector<HTMLElement>('#cookie-banner');
        if (cookieBanner) {
            cookieBanner.hidden = true;
            cookieBanner.style.display = 'none';
        }
        const environmentBanner = document.querySelector<HTMLElement>('[data-testid="environment-banner"]');
        if (environmentBanner) environmentBanner.style.display = 'none';
    });
}

async function appendTypographySpecimen(page: Page, locale: SupportedLocale) {
    await page.evaluate((activeLocale) => {
        const existing = document.querySelector('#typography-qa-specimen');
        existing?.remove();

        const section = document.createElement('section');
        section.id = 'typography-qa-specimen';
        section.lang = activeLocale;
        section.style.cssText = [
            'box-sizing:border-box',
            'width:100%',
            'padding:clamp(24px,5vw,64px)',
            'background:#e5fbff',
            'color:#006c70',
            'border-block:2px solid #006c70',
        ].join(';');

        const addSample = (label: string, text: string, className: string, styles: Partial<CSSStyleDeclaration>) => {
            const wrapper = document.createElement('div');
            wrapper.style.marginBottom = '32px';
            const caption = document.createElement('p');
            caption.textContent = label;
            caption.style.cssText = [
                'margin:0 0 10px',
                'font:700 12px/1.2 "Inter Variable",sans-serif',
                'letter-spacing:.12em',
                'text-transform:uppercase',
            ].join(';');
            const sample = document.createElement('p');
            sample.className = className;
            sample.textContent = text;
            sample.style.margin = '0';
            Object.assign(sample.style, styles);
            wrapper.appendChild(caption);
            wrapper.appendChild(sample);
            section.appendChild(wrapper);
        };

        const copy = {
            es: {
                hero: 'VIVIR EN ESPAÑA',
                focus: 'Aa · Gg · Mm · Rr · Ss · Ññ',
                words: 'GENTE · ESCUELA · FORMA · CONVERSACIÓN',
                compact: 'El veloz murciélago hindú comía feliz cardillo y kiwi.',
                body: 'Conversación, filosofía y aprendizaje sin prisa.',
            },
            en: {
                hero: 'LIVE IN SPAIN',
                focus: 'Aa · Gg · Mm · Rr · Ss · Ññ',
                words: 'PEOPLE · SCHOOL · SHAPE · CONVERSATION',
                compact: 'The quick brown fox jumps over the lazy dog.',
                body: 'Conversation, culture and learning without haste.',
            },
            ru: {
                hero: 'ЖИТЬ В ИСПАНИИ',
                focus: 'Лл · Зз · Шш · Щщ · Фф · Ёё',
                words: 'ЛАЗУРЬ · ПЛАНЫ · ЗАЩИТА · ЩУКА · ФИЛОСОФИЯ',
                compact: 'Съешь ещё этих мягких французских булок, да выпей чаю.',
                body: 'Площадь, ощущение и защищённый разговор без спешки.',
            },
        }[activeLocale];

        addSample('Marca grande · titular', copy.hero, 'font-brand-display hero-headline', {
            fontSize: 'clamp(44px,8vw,96px)',
            lineHeight: '1.1',
        });
        addSample('Marca grande · glifos de control', copy.focus, 'font-brand-display', {
            fontSize: 'clamp(34px,5.5vw,72px)',
            lineHeight: '1.3',
        });
        addSample('Marca grande · palabras', copy.words, 'font-brand-display', {
            fontSize: 'clamp(30px,4.5vw,60px)',
            lineHeight: '1.3',
        });
        addSample('Encabezado compacto', copy.compact, 'font-display', {
            fontSize: 'clamp(20px,2.5vw,28px)',
            lineHeight: '1.35',
        });
        addSample('Texto', copy.body, '', {
            fontSize: '18px',
            lineHeight: '1.55',
        });

        document.body.replaceChildren(section);
        document.body.style.margin = '0';
        document.body.style.padding = '0';
        document.body.style.minHeight = '0';
    }, locale);
    await page.evaluate(() => document.fonts.ready);
}

for (const locale of ['es', 'en', 'ru'] as const) {
    test(`${locale} uses deterministic same-origin typography`, async ({ page }, testInfo) => {
        const thirdPartyRequests: string[] = [];
        const fontRequests: string[] = [];
        const fontResponses: Array<{ url: string; status: number; contentType: string }> = [];

        page.on('request', (request) => {
            const url = new URL(request.url());
            if (thirdPartyFontHosts.has(url.hostname)) thirdPartyRequests.push(request.url());
            if (request.resourceType() === 'font') fontRequests.push(request.url());
        });
        page.on('response', (response) => {
            if (response.request().resourceType() !== 'font') return;
            fontResponses.push({
                url: response.url(),
                status: response.status(),
                contentType: response.headers()['content-type'] || '',
            });
        });

        await page.goto(`/${locale}`, { waitUntil: 'commit' });
        await page.locator('body').waitFor({ state: 'attached' });
        await page.locator('.font-brand-display').first().waitFor({ state: 'attached' });
        await page.waitForFunction(
            () => getComputedStyle(document.body).fontFamily.includes('Inter Variable'),
            undefined,
            { timeout: 30000 },
        );
        await page.evaluate(() => document.fonts.ready);

        const typography = await page.evaluate(() => {
            const visible = (element: HTMLElement) => element.getClientRects().length > 0;
            const brandDisplay = Array.from(document.querySelectorAll<HTMLElement>('.font-brand-display')).find(visible);
            const compactDisplay = Array.from(document.querySelectorAll<HTMLElement>('.font-display')).find((element) => {
                if (!visible(element)) return false;
                return Number.parseFloat(getComputedStyle(element).fontSize) < 32;
            });
            const wordmark = Array.from(document.querySelectorAll<HTMLElement>('.font-wordmark')).find(visible);
            const style = (element?: HTMLElement) => element ? getComputedStyle(element) : null;
            const brandStyle = style(brandDisplay);
            const compactStyle = style(compactDisplay);
            const wordmarkStyle = style(wordmark);
            const layoutStyle = (selector: string) => {
                const element = document.querySelector<HTMLElement>(selector);
                if (!element) return null;
                const computed = getComputedStyle(element);
                return {
                    fontSize: Number.parseFloat(computed.fontSize),
                    lineHeight: Number.parseFloat(computed.lineHeight),
                    letterSpacing: computed.letterSpacing,
                    overflowWrap: computed.overflowWrap,
                    wordBreak: computed.wordBreak,
                    hyphens: computed.hyphens,
                    horizontalOverflow: element.scrollWidth > element.clientWidth + 1,
                };
            };
            return {
                body: getComputedStyle(document.body).fontFamily,
                brandDisplay: brandStyle?.fontFamily || '',
                compactDisplay: compactStyle?.fontFamily || '',
                compactSize: compactStyle ? Number.parseFloat(compactStyle.fontSize) : null,
                wordmark: wordmarkStyle?.fontFamily || '',
                coverage: {
                    brandCyrillic: document.fonts.check('48px "Boldonese Cyrillic"', 'ЛЗШЩфё'),
                    displayCyrillic: document.fonts.check('24px "Boldonese Cyrillic"', 'Это вам подходит?'),
                    latin: document.fonts.check('48px "Boldonse"', 'VIVIR EN ESPAÑA'),
                },
                layout: {
                    hero: layoutStyle('.hero-headline'),
                    method: layoutStyle('#metodo h2.font-brand-display'),
                    community: layoutStyle('#comunidad h2.font-brand-display'),
                    highlightedPlan: layoutStyle('#planes h3.font-brand-display'),
                    team: layoutStyle('#equipo h2.font-brand-display'),
                    footer: layoutStyle('.brand-display-stack'),
                },
                loadedFamilies: Array.from(document.fonts)
                    .filter((font) => font.status === 'loaded')
                    .map((font) => font.family.replace(/^["']|["']$/g, '')),
            };
        });

        expect(typography.body).toContain('Inter Variable');
        const expectedDisplayFamily = locale === 'ru' ? 'Boldonese Cyrillic' : 'Boldonse';
        expect(typography.brandDisplay).toContain(expectedDisplayFamily);
        expect(typography.compactDisplay).toContain(expectedDisplayFamily);
        expect(typography.compactDisplay).toBe(typography.brandDisplay);
        expect(typography.compactSize).not.toBeNull();
        expect(typography.compactSize!).toBeLessThan(32);
        expect(typography.wordmark).toContain('Boldonse');
        expect(typography.loadedFamilies).toContain('Inter Variable');
        expect(typography.loadedFamilies).toContain('Boldonse');
        expect(typography.coverage.latin).toBe(true);
        if (locale === 'ru') {
            expect(typography.loadedFamilies).toContain('Boldonese Cyrillic');
            expect(typography.coverage.brandCyrillic).toBe(true);
            expect(typography.coverage.displayCyrillic).toBe(true);
            expect(fontRequests.some((url) => url.includes('BoldoneseCyrillic-Regular'))).toBe(true);
        }
        expect(typography.layout.hero).not.toBeNull();
        expect(typography.layout.method).not.toBeNull();
        expect(typography.layout.community).not.toBeNull();
        expect(typography.layout.highlightedPlan).not.toBeNull();
        expect(typography.layout.team).not.toBeNull();
        expect(typography.layout.footer).not.toBeNull();
        expect(typography.layout.hero!.lineHeight / typography.layout.hero!.fontSize).toBeCloseTo(1.1, 2);
        expect(Number.parseFloat(typography.layout.hero!.letterSpacing) / typography.layout.hero!.fontSize).toBeCloseTo(-0.05, 2);
        expect(typography.layout.hero!.overflowWrap).toBe('break-word');
        const expectedMethodLineHeight = testInfo.project.name === 'mobile' ? 1.25 : 1;
        expect(typography.layout.method!.lineHeight / typography.layout.method!.fontSize).toBeCloseTo(expectedMethodLineHeight, 2);
        expect(['normal', '0px']).toContain(typography.layout.method!.letterSpacing);
        expect(typography.layout.community!.hyphens).toBe('auto');
        expect(typography.layout.community!.horizontalOverflow).toBe(false);
        expect(typography.layout.highlightedPlan!.hyphens).toBe('auto');
        expect(typography.layout.highlightedPlan!.overflowWrap).toBe('break-word');
        expect(typography.layout.highlightedPlan!.horizontalOverflow).toBe(false);
        expect(typography.layout.team!.overflowWrap).toBe('break-word');
        expect(typography.layout.footer!.lineHeight / typography.layout.footer!.fontSize).toBeCloseTo(0.8, 2);
        expect(fontResponses.every((response) => response.status === 200)).toBe(true);
        expect(fontResponses.every((response) => /(?:font\/woff2|application\/font-woff2)/i.test(response.contentType))).toBe(true);
        expect(fontRequests.length).toBeGreaterThan(0);
        expect(fontRequests.every((url) => new URL(url).origin === new URL(page.url()).origin)).toBe(true);
        expect(thirdPartyRequests).toEqual([]);

        if (locale === 'ru') {
            const deployedFontUrl = fontRequests.find((url) => url.includes('BoldoneseCyrillic-Regular'));
            expect(deployedFontUrl).toBeDefined();
            const deployedFont = await page.request.get(deployedFontUrl!);
            expect(deployedFont.ok()).toBe(true);
            expect(deployedFont.headers()['content-type']).toMatch(/(?:font\/woff2|application\/font-woff2)/i);
            const deployedHash = createHash('sha256').update(await deployedFont.body()).digest('hex');
            expect(deployedHash).toBe('4fca33b1a2401423e9d9aa0b354fc408ff0506001a5b3244aeb2dbdc06e03608');
        }

        if (process.env.CAPTURE_TYPOGRAPHY_SCREENSHOTS === 'true') {
            const outputDirectory = path.resolve('output/playwright');
            await mkdir(outputDirectory, { recursive: true });
            await prepareVisualCapture(page);
            if (testInfo.project.name === 'mobile') {
                await page.locator('[data-testid="primary-navigation"]').evaluate((element) => {
                    (element as HTMLElement).style.display = 'none';
                });
                const regions = [
                    ['hero', '.hero-headline'],
                    ['problem', '.problems-section'],
                    ['method', '#metodo'],
                    ['progress', '#progreso'],
                    ['included', '#incluye'],
                    ['plans', '#planes'],
                    ['team', '#equipo'],
                    ['faq', '#faq'],
                    ['contact', '#contacto'],
                ] as const;
                for (const [name, selector] of regions) {
                    if (name === 'hero') {
                        await page.evaluate(() => window.scrollTo(0, 0));
                        await page.screenshot({
                            path: path.join(outputDirectory, `typography-${locale}-mobile-${name}.png`),
                            animations: 'disabled',
                        });
                        continue;
                    }
                    const region = page.locator(selector).first();
                    await expect(region, `Missing visual-QA region: ${selector}`).toBeVisible();
                    await region.screenshot({
                        path: path.join(outputDirectory, `typography-${locale}-mobile-${name}.png`),
                        animations: 'disabled',
                    });
                }
            } else {
                await primeFullPageRendering(page);
                await page.screenshot({
                    path: path.join(outputDirectory, `typography-${locale}-${testInfo.project.name}.png`),
                    fullPage: true,
                    animations: 'disabled',
                    scale: 'css',
                });
            }
            await appendTypographySpecimen(page, locale);
            await page.locator('#typography-qa-specimen').screenshot({
                path: path.join(outputDirectory, `typography-specimen-${locale}-${testInfo.project.name}.png`),
                animations: 'disabled',
            });
        }
    });
}
