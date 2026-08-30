import { expect, test, type CDPSession, type Page } from '@playwright/test';

const cyrillicDisplayFontName = 'BoldoneseCyrillic-Regular';
const cyrillicDisplayFamily = 'Boldonese Cyrillic';
const heroSelector = '.hero-headline';
const delayedFontMs = 800;

type PlatformFont = {
    familyName: string;
    glyphCount: number;
    isCustomFont: boolean;
};

type ScreenshotClip = {
    x: number;
    y: number;
    width: number;
    height: number;
    scale: number;
};

async function platformFontsForSelector(
    session: CDPSession,
    selector: string,
): Promise<PlatformFont[]> {
    const { root } = await session.send('DOM.getDocument', {
        depth: -1,
        pierce: true,
    });
    const { nodeId } = await session.send('DOM.querySelector', {
        nodeId: root.nodeId,
        selector,
    });
    if (!nodeId) return [];

    const { fonts } = await session.send('CSS.getPlatformFontsForNode', { nodeId });
    return fonts as PlatformFont[];
}

async function screenshotClipForSelector(page: Page, selector: string): Promise<ScreenshotClip> {
    return page.locator(selector).evaluate((element) => {
        const bounds = element.getBoundingClientRect();
        const x = Math.floor(bounds.left + window.scrollX);
        const y = Math.floor(bounds.top + window.scrollY);
        const right = Math.ceil(bounds.right + window.scrollX);
        const bottom = Math.ceil(bounds.bottom + window.scrollY);
        return {
            x,
            y,
            width: right - x,
            height: bottom - y,
            scale: 1,
        };
    });
}

async function captureClip(session: CDPSession, clip: ScreenshotClip): Promise<string> {
    const { data } = await session.send('Page.captureScreenshot', {
        format: 'png',
        fromSurface: true,
        captureBeyondViewport: true,
        clip,
    });
    return data;
}

async function waitForTwoFrames(page: Page): Promise<void> {
    await page.evaluate(() => new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    }));
}

test('ES to RU keeps the Cyrillic hero invisible until the preloaded face is ready', async ({
    browserName,
    context,
    page,
}, testInfo) => {
    test.skip(
        browserName !== 'chromium' || testInfo.project.name !== 'public',
        'Pixel capture and platform-font inspection require desktop Chromium.',
    );

    await page.goto('/es');
    await page.evaluate(() => document.fonts.ready);

    const session = await context.newCDPSession(page);
    await session.send('Page.enable');
    await session.send('DOM.enable');
    await session.send('CSS.enable');
    await session.send('Network.enable');
    await session.send('Network.setCacheDisabled', { cacheDisabled: true });

    let resolveFontRequestStarted!: (url: string) => void;
    const fontRequestStarted = new Promise<string>((resolve) => {
        resolveFontRequestStarted = resolve;
    });
    let resolveFontResponseFinished!: () => void;
    const fontResponseFinished = new Promise<void>((resolve) => {
        resolveFontResponseFinished = resolve;
    });
    let releaseFontAfterControl!: () => void;
    const transparentControlCaptured = new Promise<void>((resolve) => {
        releaseFontAfterControl = resolve;
    });
    let fontResponseCompleted = false;

    await page.route(`**/*${cyrillicDisplayFontName}*.woff2*`, async (route) => {
        resolveFontRequestStarted(route.request().url());
        await Promise.all([
            new Promise((resolve) => setTimeout(resolve, delayedFontMs)),
            transparentControlCaptured,
        ]);
        await route.continue();
    });
    page.on('response', (response) => {
        if (!response.url().includes(cyrillicDisplayFontName)) return;
        void response.finished().then(() => {
            fontResponseCompleted = true;
            resolveFontResponseFinished();
        });
    });

    await Promise.all([
        page.waitForURL('**/ru', { waitUntil: 'commit' }),
        page.locator('a[hreflang="ru"]:visible').first().click({ noWaitAfter: true }),
    ]);
    const requestedFontUrl = await fontRequestStarted;
    await page.locator(heroSelector).waitFor({ state: 'attached' });

    await page.addStyleTag({
        content: [
            '*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}',
            'html{scroll-behavior:auto!important}',
        ].join(''),
    });
    await waitForTwoFrames(page);

    const fontFaceDisplay = await page.evaluate((family) => {
        const normalizedFamily = family.toLowerCase();
        const visit = (rules: CSSRuleList): string | null => {
            for (const rule of Array.from(rules)) {
                if (rule.type === CSSRule.FONT_FACE_RULE) {
                    const style = (rule as CSSFontFaceRule).style;
                    const ruleFamily = style.getPropertyValue('font-family')
                        .replace(/["']/g, '')
                        .trim()
                        .toLowerCase();
                    if (ruleFamily === normalizedFamily) {
                        return style.getPropertyValue('font-display').trim();
                    }
                }
                const nestedRules = (rule as CSSRule & { cssRules?: CSSRuleList }).cssRules;
                if (nestedRules) {
                    const result = visit(nestedRules);
                    if (result) return result;
                }
            }
            return null;
        };

        for (const stylesheet of Array.from(document.styleSheets)) {
            try {
                const result = visit(stylesheet.cssRules);
                if (result) return result;
            } catch {
                // Ignore stylesheets whose rules are unavailable to the page.
            }
        }
        return null;
    }, cyrillicDisplayFamily);
    expect(requestedFontUrl).toContain(cyrillicDisplayFontName);
    expect(fontFaceDisplay).toBe('block');
    expect(fontResponseCompleted).toBe(false);

    const heroClip = await screenshotClipForSelector(page, heroSelector);
    const blockedHeroPixels = await captureClip(session, heroClip);

    await page.evaluate((selector) => {
        const target = document.querySelector<HTMLElement>(selector);
        if (!target) throw new Error(`Missing font-loading target: ${selector}`);
        target.dataset.fontLoadingTransparentControl = 'true';
        const style = document.createElement('style');
        style.id = 'font-loading-transparent-control';
        style.textContent = [
            '[data-font-loading-transparent-control="true"],',
            '[data-font-loading-transparent-control="true"] *{',
            'color:transparent!important;',
            '-webkit-text-fill-color:transparent!important;',
            '-webkit-text-stroke-color:transparent!important;',
            'text-shadow:none!important;',
            '}',
        ].join('');
        document.head.appendChild(style);
    }, heroSelector);
    await waitForTwoFrames(page);
    const transparentControlPixels = await captureClip(session, heroClip);

    expect(
        blockedHeroPixels,
        'The delayed hero painted visible fallback glyphs during the font-display block period.',
    ).toBe(transparentControlPixels);
    releaseFontAfterControl();

    await page.evaluate((selector) => {
        document.querySelector('#font-loading-transparent-control')?.remove();
        delete document.querySelector<HTMLElement>(selector)?.dataset.fontLoadingTransparentControl;
    }, heroSelector);

    await fontResponseFinished;
    await page.evaluate(() => document.fonts.ready);
    await page.waitForFunction(
        ([family, text]) => document.fonts.check(`400 96px "${family}"`, text),
        [cyrillicDisplayFamily, 'ЖИТЬ В ИСПАНИИ'],
    );
    await waitForTwoFrames(page);

    const loadedHeroPixels = await captureClip(session, heroClip);
    const loadedPlatformFonts = (await platformFontsForSelector(session, heroSelector))
        .filter((font) => font.glyphCount > 0);

    await page.waitForFunction(
        () => performance.getEntriesByName('first-contentful-paint').length > 0,
    );
    const loadingEvidence = await page.evaluate((fontUrl) => {
        const preload = Array.from(
            document.querySelectorAll<HTMLLinkElement>('link[rel~="preload"][as="font"]'),
        ).find((link) => link.href === fontUrl);
        const resource = (performance.getEntriesByType('resource') as PerformanceResourceTiming[])
            .find((entry) => entry.name === fontUrl);
        const firstContentfulPaint = performance.getEntriesByName('first-contentful-paint')[0];

        return {
            preload: preload ? {
                crossOrigin: preload.crossOrigin,
                href: preload.href,
                type: preload.type,
            } : null,
            resource: resource ? {
                duration: resource.duration,
                initiatorType: resource.initiatorType,
                responseEnd: resource.responseEnd,
                startTime: resource.startTime,
            } : null,
            firstContentfulPaint: firstContentfulPaint?.startTime ?? null,
        };
    }, requestedFontUrl);

    expect(
        loadedHeroPixels,
        'The hero remained visually empty after the Cyrillic display font loaded.',
    ).not.toBe(blockedHeroPixels);
    expect(loadedPlatformFonts.some((font) =>
        font.familyName === cyrillicDisplayFamily && font.isCustomFont)).toBe(true);
    expect(loadingEvidence.preload).not.toBeNull();
    expect(loadingEvidence.preload!.type).toBe('font/woff2');
    expect(loadingEvidence.preload!.crossOrigin).toBe('anonymous');
    expect(new URL(loadingEvidence.preload!.href).origin).toBe(new URL(page.url()).origin);
    expect(loadingEvidence.resource).not.toBeNull();
    expect(loadingEvidence.resource!.initiatorType).toBe('link');
    expect(loadingEvidence.firstContentfulPaint).not.toBeNull();
    expect(loadingEvidence.resource!.startTime).toBeLessThanOrEqual(
        loadingEvidence.firstContentfulPaint!,
    );
    expect(loadingEvidence.resource!.responseEnd).toBeGreaterThan(
        loadingEvidence.resource!.startTime,
    );
    expect(loadingEvidence.resource!.duration).toBeGreaterThanOrEqual(delayedFontMs);
});
