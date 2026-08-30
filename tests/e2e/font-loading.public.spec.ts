import { expect, test, type CDPSession, type Page } from '@playwright/test';

const cyrillicDisplayFontName = 'BoldoneseCyrillic-Regular';
const cyrillicDisplayFamily = 'Boldonese Cyrillic';
// Keep the synthetic delay below Chromium's short `font-display: fallback`
// block period. A slower response may legitimately reveal the fallback face.
const moderateFontDelayMs = 75;

type PlatformFont = {
    familyName: string;
    glyphCount: number;
    isCustomFont: boolean;
};

type PlatformFontSample = {
    elapsedMs: number;
    fonts: PlatformFont[];
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

async function waitForCyrillicDisplayFont(
    page: Page,
    session: CDPSession,
): Promise<PlatformFontSample[]> {
    const startedAt = Date.now();
    const samples: PlatformFontSample[] = [];

    while (Date.now() - startedAt < 3000) {
        try {
            const fonts = (await platformFontsForSelector(session, '.hero-headline'))
                .filter((font) => font.glyphCount > 0);
            samples.push({
                elapsedMs: Date.now() - startedAt,
                fonts,
            });
            if (fonts.some((font) => font.familyName === cyrillicDisplayFamily && font.isCustomFont)) {
                return samples;
            }
        } catch {
            // The document or CSS agent can be between states during a full navigation.
        }
        await page.waitForTimeout(5);
    }

    return samples;
}

test('ES to RU preloads the Cyrillic display face before first paint', async ({
    browserName,
    context,
    page,
}, testInfo) => {
    test.skip(
        browserName !== 'chromium' || testInfo.project.name !== 'public',
        'Platform-font inspection and stable paint timing require desktop Chromium.',
    );

    await page.goto('/es');
    await page.evaluate(() => document.fonts.ready);

    const session = await context.newCDPSession(page);
    await session.send('DOM.enable');
    await session.send('CSS.enable');
    await session.send('Network.enable');
    await session.send('Network.setCacheDisabled', { cacheDisabled: true });

    await page.route(`**/*${cyrillicDisplayFontName}*.woff2*`, async (route) => {
        await new Promise((resolve) => setTimeout(resolve, moderateFontDelayMs));
        await route.continue();
    });

    await Promise.all([
        page.waitForURL('**/ru', { waitUntil: 'commit' }),
        page.locator('a[hreflang="ru"]:visible').first().click({ noWaitAfter: true }),
    ]);
    await page.locator('.hero-headline').waitFor({ state: 'attached' });

    const platformFontSamples = await waitForCyrillicDisplayFont(page, session);
    await page.evaluate(() => document.fonts.ready);
    await page.waitForFunction(
        () => performance.getEntriesByName('first-contentful-paint').length > 0,
    );

    const loadingEvidence = await page.evaluate((fontName) => {
        const preload = Array.from(
            document.querySelectorAll<HTMLLinkElement>('link[rel~="preload"][as="font"]'),
        ).find((link) => new URL(link.href).pathname.includes(fontName));
        const preloadUrl = preload?.href;
        const resource = (performance.getEntriesByType('resource') as PerformanceResourceTiming[])
            .find((entry) => entry.name === preloadUrl);
        const firstContentfulPaint = performance.getEntriesByName('first-contentful-paint')[0];

        return {
            preload: preload ? {
                crossOrigin: preload.crossOrigin,
                href: preload.href,
                type: preload.type,
            } : null,
            resource: resource ? {
                initiatorType: resource.initiatorType,
                startTime: resource.startTime,
            } : null,
            firstContentfulPaint: firstContentfulPaint?.startTime ?? null,
        };
    }, cyrillicDisplayFontName);

    const fontsSeenBeforeTarget = platformFontSamples
        .slice(0, Math.max(platformFontSamples.length - 1, 0))
        .flatMap((sample) => sample.fonts);
    const targetWasPainted = platformFontSamples.some((sample) => sample.fonts.some(
        (font) => font.familyName === cyrillicDisplayFamily && font.isCustomFont,
    ));

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
    expect(
        fontsSeenBeforeTarget,
        `A system fallback was selected before ${cyrillicDisplayFamily}: ${JSON.stringify(platformFontSamples)}`,
    ).toEqual([]);
    expect(
        targetWasPainted,
        `${cyrillicDisplayFamily} was not painted: ${JSON.stringify(platformFontSamples)}`,
    ).toBe(true);
});
