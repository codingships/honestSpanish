const LOCAL_ORIGIN = 'http://localhost:4321';
const STAGING_ORIGIN = 'https://staging.espanolhonesto.com';

const fullRoutes = [
    '/es',
    '/en',
    '/ru',
    '/es/espanol-para-vivir-en-espana',
    '/es/blog',
    '/es/blog/cuanto-tiempo-hablar-espanol-fluido',
    '/es/legal/privacidad',
];
const smokeRoutes = [
    '/es',
    '/es/blog/cuanto-tiempo-hablar-espanol-fluido',
];

function exactEnum(name, allowed, fallback) {
    const value = process.env[name]?.trim() || fallback;
    if (!allowed.includes(value)) {
        throw new Error(`${name} must be one of: ${allowed.join(', ')}.`);
    }
    return value;
}

function exactRunCount() {
    const value = Number.parseInt(process.env.LHCI_RUNS?.trim() || '3', 10);
    if (!Number.isInteger(value) || value < 1 || value > 5) {
        throw new Error('LHCI_RUNS must be an integer from 1 to 5.');
    }
    return value;
}

function exactBaseOrigin() {
    const parsed = new URL(process.env.LHCI_BASE_URL?.trim() || LOCAL_ORIGIN);
    if (
        ![LOCAL_ORIGIN, STAGING_ORIGIN].includes(parsed.origin)
        || parsed.pathname !== '/'
        || parsed.search
        || parsed.hash
        || parsed.username
        || parsed.password
    ) {
        throw new Error(`LHCI_BASE_URL must be exactly ${LOCAL_ORIGIN} or ${STAGING_ORIGIN}.`);
    }
    return parsed.origin;
}

const baseOrigin = exactBaseOrigin();
const profile = exactEnum('LHCI_PROFILE', ['mobile', 'desktop'], 'mobile');
const scope = exactEnum('LHCI_SCOPE', ['smoke', 'full'], 'full');
const isSmoke = scope === 'smoke';

module.exports = {
    baseOrigin,
    localServer: baseOrigin === LOCAL_ORIGIN,
    // Chrome's trace collector repeatedly reports NO_FCP for this prerendered
    // page behind local Wrangler even though a clean browser records FCP. Keep
    // the local candidate check as an explicit paint probe; staging remains a
    // strict Lighthouse audit for every route.
    localPaintProbeRoutes: ['/es/blog/cuanto-tiempo-hablar-espanol-fluido'],
    outputDirectory: `test-results/lighthouse/${profile}`,
    profile,
    routes: scope === 'smoke' ? smokeRoutes : fullRoutes,
    runCount: exactRunCount(),
    scope,
    settings: {
        chromeFlags: ['--headless', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
        maxWaitForLoadMs: 60_000,
        onlyCategories: ['performance', 'accessibility', 'best-practices', 'seo'],
    },
    floors: {
        accessibilityWorst: 95,
        bestPracticesMedian: 80,
        clsWorst: 0.10,
        consoleErrorsWorst: 100,
        // The one-run PR smoke protects the measured baseline with enough room
        // for laboratory variance. The three-run release audit retains the
        // stricter launch target and therefore exposes the current LCP debt.
        lcpMedianMs: isSmoke ? 7_000 : 4_000,
        performanceMedian: isSmoke ? 65 : 70,
        tbtMedianMs: 600,
    },
    // Test and staging deliberately refuse indexing. Production crawlability is
    // checked separately during the live gate; SEO remains visible in reports.
    seoIsInformational: true,
};
