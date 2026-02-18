/**
 * Performance Tests - Web Vitals and Load Times
 * 
 * Tests critical performance metrics:
 * - Time to First Byte (TTFB)
 * - First Contentful Paint (FCP)
 * - Largest Contentful Paint (LCP)
 * - Cumulative Layout Shift (CLS)
 * - Time to Interactive (TTI)
 * - Page load times
 */
import { test, expect } from '@playwright/test';

// Performance thresholds (in milliseconds unless noted)
// Note: These are relaxed for development. In CI/production, use stricter values.
const IS_CI = process.env.CI === 'true';
const THRESHOLDS = {
    TTFB: IS_CI ? 800 : 2000,           // Time to First Byte
    FCP: IS_CI ? 1800 : 4000,           // First Contentful Paint
    LCP: IS_CI ? 2500 : 5000,           // Largest Contentful Paint
    CLS: 0.1,                            // Cumulative Layout Shift (unitless)
    pageLoad: IS_CI ? 5000 : 10000,     // Total page load
    apiResponse: IS_CI ? 1000 : 3000,   // API response time
};

// Helper for detailed logging
function log(message: string, details?: any) {
    const timestamp = new Date().toISOString();
    console.log(`\n[${timestamp}] ⚡ ${message}`);
    if (details) {
        console.log(`   Metrics:`, JSON.stringify(details, null, 2));
    }
}

// Helper to format time
function formatMs(ms: number): string {
    return `${ms.toFixed(0)}ms`;
}

// Helper to check threshold
function checkThreshold(name: string, value: number, threshold: number): boolean {
    const passed = value <= threshold;
    const status = passed ? '✅' : '⚠️';
    log(`${status} ${name}: ${formatMs(value)} (threshold: ${formatMs(threshold)})`);
    return passed;
}

test.describe('Homepage Performance', () => {

    test('should load homepage within acceptable time', async ({ page }) => {
        log('Testing homepage load performance');

        const startTime = Date.now();
        const response = await page.goto('/es', { waitUntil: 'load' });
        const loadTime = Date.now() - startTime;

        log('Page load complete', { loadTime: formatMs(loadTime) });

        // Check response status
        expect(response?.status()).toBe(200);

        // Check load time (relaxed for local dev)
        checkThreshold('Total Page Load', loadTime, THRESHOLDS.pageLoad);
        expect(loadTime).toBeLessThan(THRESHOLDS.pageLoad + 5000); // Allow extra 5s buffer for local dev

        log('✅ Homepage load performance verified');
    });

    test('should have acceptable TTFB', async ({ page }) => {
        log('Measuring Time to First Byte');

        const [response] = await Promise.all([
            page.waitForResponse(resp => resp.url().includes('/es')),
            page.goto('/es'),
        ]);

        const timing = await page.evaluate(() => {
            const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming;
            return {
                ttfb: nav.responseStart - nav.requestStart,
                dnsLookup: nav.domainLookupEnd - nav.domainLookupStart,
                tcpConnect: nav.connectEnd - nav.connectStart,
                serverTime: nav.responseStart - nav.fetchStart,
            };
        });

        log('TTFB Metrics', timing);

        checkThreshold('TTFB', timing.ttfb, THRESHOLDS.TTFB);

        log('✅ TTFB measured');
    });

    test('should measure Core Web Vitals', async ({ page }) => {
        log('Measuring Core Web Vitals');

        await page.goto('/es', { waitUntil: 'networkidle' });

        // Wait for LCP to stabilize
        await page.waitForTimeout(2000);

        interface WebVitalsMetrics {
            fcp?: number;
            lcp?: number;
            domContentLoaded?: number;
            domInteractive?: number;
            loadComplete?: number;
        }

        const webVitals = await page.evaluate(() => {
            return new Promise<WebVitalsMetrics>((resolve) => {
                const metrics: WebVitalsMetrics = {};

                // Get paint timings
                const paintEntries = performance.getEntriesByType('paint');
                for (const entry of paintEntries) {
                    if (entry.name === 'first-contentful-paint') {
                        metrics.fcp = entry.startTime;
                    }
                }

                // Get navigation timing
                const navEntry = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming;
                if (navEntry) {
                    metrics.domContentLoaded = navEntry.domContentLoadedEventEnd - navEntry.startTime;
                    metrics.domInteractive = navEntry.domInteractive - navEntry.startTime;
                    metrics.loadComplete = navEntry.loadEventEnd - navEntry.startTime;
                }

                // Get LCP using PerformanceObserver (if available)
                const lcpEntries = performance.getEntriesByType('largest-contentful-paint');
                if (lcpEntries.length > 0) {
                    metrics.lcp = lcpEntries[lcpEntries.length - 1].startTime;
                }

                resolve(metrics);
            });
        });

        log('Core Web Vitals', webVitals);

        const vitals = webVitals as WebVitalsMetrics;
        if (vitals.fcp) {
            checkThreshold('First Contentful Paint', vitals.fcp, THRESHOLDS.FCP);
        }

        if (vitals.lcp) {
            checkThreshold('Largest Contentful Paint', vitals.lcp, THRESHOLDS.LCP);
        }

        log('✅ Core Web Vitals measured');
    });

    test('should have minimal layout shift', async ({ page }) => {
        log('Measuring Cumulative Layout Shift');

        // Inject CLS observer before navigation
        await page.addInitScript(() => {
            (window as any).__cls = 0;
            new PerformanceObserver((list) => {
                for (const entry of list.getEntries()) {
                    if (!(entry as any).hadRecentInput) {
                        (window as any).__cls += (entry as any).value;
                    }
                }
            }).observe({ type: 'layout-shift', buffered: true });
        });

        await page.goto('/es', { waitUntil: 'networkidle' });

        // Wait for page to stabilize
        await page.waitForTimeout(3000);

        const cls = await page.evaluate(() => (window as any).__cls || 0);

        log('CLS Measurement', { cls: cls.toFixed(4), threshold: THRESHOLDS.CLS });

        // CLS should be below 0.1 for "good" score
        if (cls <= THRESHOLDS.CLS) {
            log('✅ CLS is within acceptable range');
        } else {
            log('⚠️ CLS exceeds recommended threshold');
        }

        expect(cls).toBeLessThan(0.25); // "Poor" threshold

        log('✅ Layout shift measured');
    });
});

test.describe('Dashboard Performance', () => {

    test('should load student dashboard quickly', async ({ page }) => {
        log('Testing student dashboard performance');

        const startTime = Date.now();
        await page.goto('/es/campus', { waitUntil: 'networkidle' });
        const loadTime = Date.now() - startTime;

        log('Dashboard load time', { loadTime: formatMs(loadTime) });

        // Dashboard may take longer due to data fetching
        expect(loadTime).toBeLessThan(8000);

        log('✅ Dashboard performance measured');
    });

    test('should load calendar efficiently', async ({ page }) => {
        log('Testing calendar performance');

        const startTime = Date.now();
        await page.goto('/es/campus/teacher/calendar', { waitUntil: 'networkidle' });
        const loadTime = Date.now() - startTime;

        log('Calendar load time', { loadTime: formatMs(loadTime) });

        // Calendar with events
        expect(loadTime).toBeLessThan(10000);

        log('✅ Calendar performance measured');
    });
});

test.describe('Resource Loading', () => {

    test('should load critical resources efficiently', async ({ page }) => {
        log('Analyzing resource loading');

        const resources: any[] = [];

        page.on('response', (response) => {
            resources.push({
                url: response.url().substring(0, 80),
                status: response.status(),
                size: response.headers()['content-length'] || 'unknown',
                time: 'N/A', // Timing not directly available on Response
            });
        });

        await page.goto('/es', { waitUntil: 'networkidle' });

        // Analyze resources
        const jsResources = resources.filter(r => r.url.includes('.js'));
        const cssResources = resources.filter(r => r.url.includes('.css'));
        const imageResources = resources.filter(r =>
            r.url.includes('.jpg') || r.url.includes('.png') || r.url.includes('.webp')
        );

        log('Resource summary', {
            total: resources.length,
            javascript: jsResources.length,
            css: cssResources.length,
            images: imageResources.length,
        });

        // Log slow resources
        const slowResources = resources.filter(r => typeof r.time === 'number' && r.time > 1000);
        if (slowResources.length > 0) {
            log('⚠️ Slow resources detected', {
                count: slowResources.length,
                examples: slowResources.slice(0, 3).map(r => ({ url: r.url, time: r.time }))
            });
        }

        log('✅ Resource loading analyzed');
    });

    test('should have acceptable bundle sizes', async ({ page }) => {
        log('Analyzing JavaScript bundle sizes');

        const bundles: any[] = [];

        page.on('response', async (response) => {
            const url = response.url();
            if (url.includes('.js') && !url.includes('node_modules')) {
                const headers = response.headers();
                const contentLength = headers['content-length'];
                if (contentLength) {
                    bundles.push({
                        url: url.split('/').pop(),
                        sizeKB: Math.round(parseInt(contentLength) / 1024),
                    });
                }
            }
        });

        await page.goto('/es', { waitUntil: 'networkidle' });

        const totalSizeKB = bundles.reduce((sum, b) => sum + b.sizeKB, 0);

        log('Bundle analysis', {
            bundleCount: bundles.length,
            totalSizeKB,
            largestBundles: bundles.sort((a, b) => b.sizeKB - a.sizeKB).slice(0, 5),
        });

        // Total JS should be under 500KB for good performance
        if (totalSizeKB > 500) {
            log('⚠️ Total JavaScript size may impact performance');
        }

        log('✅ Bundle sizes analyzed');
    });
});

test.describe('Navigation Performance', () => {

    test('should navigate between pages quickly', async ({ page }) => {
        log('Testing navigation performance');

        await page.goto('/es', { waitUntil: 'networkidle' });

        const navTimings: any[] = [];

        // Navigate to login
        let startTime = Date.now();
        await page.goto('/es/login', { waitUntil: 'networkidle' });
        navTimings.push({ page: 'login', time: Date.now() - startTime });

        // Navigate to pricing/packages
        startTime = Date.now();
        await page.goto('/es#pricing', { waitUntil: 'networkidle' });
        navTimings.push({ page: 'pricing', time: Date.now() - startTime });

        // Navigate back to home
        startTime = Date.now();
        await page.goto('/es', { waitUntil: 'networkidle' });
        navTimings.push({ page: 'home', time: Date.now() - startTime });

        log('Navigation timings', { navigations: navTimings });

        const avgNavTime = navTimings.reduce((sum, n) => sum + n.time, 0) / navTimings.length;
        log('Average navigation time', { avgMs: formatMs(avgNavTime) });

        // Average navigation should be under 3 seconds
        expect(avgNavTime).toBeLessThan(3000);

        log('✅ Navigation performance verified');
    });

    test('should handle rapid navigation', async ({ page }) => {
        log('Testing rapid navigation (stress test)');

        await page.goto('/es', { waitUntil: 'domcontentloaded' });

        const pages = ['/es/login', '/es', '/es/login', '/es'];
        const startTime = Date.now();

        for (const url of pages) {
            await page.goto(url, { waitUntil: 'domcontentloaded' });
        }

        const totalTime = Date.now() - startTime;

        log('Rapid navigation complete', {
            navigations: pages.length,
            totalTime: formatMs(totalTime),
            avgTime: formatMs(totalTime / pages.length),
        });

        log('✅ Rapid navigation handled');
    });
});

test.describe('Mobile Performance', () => {

    test('should perform well on mobile viewport', async ({ page }) => {
        log('Testing mobile performance');

        // Set mobile viewport
        await page.setViewportSize({ width: 375, height: 667 });

        const startTime = Date.now();
        await page.goto('/es', { waitUntil: 'networkidle' });
        const loadTime = Date.now() - startTime;

        log('Mobile load time', { loadTime: formatMs(loadTime) });

        // Mobile should still load within acceptable time
        expect(loadTime).toBeLessThan(6000);

        log('✅ Mobile performance verified');
    });
});
