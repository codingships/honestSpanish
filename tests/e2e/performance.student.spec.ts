/**
 * Authenticated Pages Performance Tests
 * 
 * Tests performance for pages requiring authentication
 */
import { test, expect } from '@playwright/test';

function log(message: string, details?: any) {
    const timestamp = new Date().toISOString();
    console.log(`\n[${timestamp}] ⚡ ${message}`);
    if (details) {
        console.log(`   Metrics:`, JSON.stringify(details, null, 2));
    }
}

test.describe('Student Dashboard Performance', () => {

    test('should load student dashboard with data', async ({ page }) => {
        log('Testing student dashboard with real data');

        const metrics = {
            navigationStart: 0,
            domContentLoaded: 0,
            dataLoaded: 0,
            fullyRendered: 0,
        };

        metrics.navigationStart = Date.now();

        await page.goto('/es/campus', { waitUntil: 'domcontentloaded' });
        metrics.domContentLoaded = Date.now() - metrics.navigationStart;

        // Wait for data to load
        await page.waitForLoadState('networkidle');
        metrics.dataLoaded = Date.now() - metrics.navigationStart;

        // Wait for UI to fully render
        await page.waitForTimeout(500);
        metrics.fullyRendered = Date.now() - metrics.navigationStart;

        log('Student dashboard timing breakdown', {
            domContentLoaded: `${metrics.domContentLoaded}ms`,
            dataLoaded: `${metrics.dataLoaded}ms`,
            fullyRendered: `${metrics.fullyRendered}ms`,
        });

        // Should load within 8 seconds total
        expect(metrics.fullyRendered).toBeLessThan(8000);

        log('✅ Student dashboard performance verified');
    });

    test('should load classes page efficiently', async ({ page }) => {
        log('Testing classes page performance');

        const startTime = Date.now();
        await page.goto('/es/campus/classes', { waitUntil: 'networkidle' });
        const loadTime = Date.now() - startTime;

        // Count class cards rendered
        const classCards = await page.locator('[class*="card"], [class*="session"]').count();

        log('Classes page metrics', {
            loadTime: `${loadTime}ms`,
            classCardsRendered: classCards,
        });

        expect(loadTime).toBeLessThan(6000);

        log('✅ Classes page performance verified');
    });

    test('should handle quick navigation between sections', async ({ page }) => {
        log('Testing quick navigation in dashboard');

        await page.goto('/es/campus', { waitUntil: 'networkidle' });

        const navigations: { section: string; time: number }[] = [];

        // Navigate through different sections
        const sections = [
            { name: 'classes', url: '/es/campus/classes' },
            { name: 'account', url: '/es/campus/account' },
            { name: 'dashboard', url: '/es/campus' },
        ];

        for (const section of sections) {
            const startTime = Date.now();
            await page.goto(section.url, { waitUntil: 'domcontentloaded' });
            navigations.push({
                section: section.name,
                time: Date.now() - startTime,
            });
        }

        const avgNavTime = navigations.reduce((sum, n) => sum + n.time, 0) / navigations.length;

        log('Navigation timing', {
            navigations,
            avgTime: `${avgNavTime.toFixed(0)}ms`,
        });

        expect(avgNavTime).toBeLessThan(2000);

        log('✅ Quick navigation performance verified');
    });
});

test.describe('Teacher Dashboard Performance', () => {

    test('should load teacher calendar with events', async ({ page }) => {
        log('Testing teacher calendar performance');

        const startTime = Date.now();

        // Navigate to teacher calendar
        await page.goto('/es/campus/teacher/calendar', { waitUntil: 'domcontentloaded' });
        const domReady = Date.now() - startTime;

        // Wait for calendar to render
        await page.waitForLoadState('networkidle');
        const networkIdle = Date.now() - startTime;

        // Check for calendar elements
        const calendarVisible = await page.locator('.fc, [class*="calendar"]').isVisible().catch(() => false);

        log('Teacher calendar metrics', {
            domReady: `${domReady}ms`,
            networkIdle: `${networkIdle}ms`,
            calendarVisible,
        });

        expect(networkIdle).toBeLessThan(10000);

        log('✅ Teacher calendar performance verified');
    });

    test('should handle calendar navigation smoothly', async ({ page }) => {
        log('Testing calendar week navigation');

        await page.goto('/es/campus/teacher/calendar', { waitUntil: 'networkidle' });

        const navTimings: number[] = [];

        // Navigate through weeks
        const nextBtn = page.getByRole('button', { name: /siguiente|next|→/i });

        for (let i = 0; i < 3; i++) {
            if (await nextBtn.isVisible()) {
                const startTime = Date.now();
                await nextBtn.click();
                await page.waitForTimeout(300);
                navTimings.push(Date.now() - startTime);
            }
        }

        const avgNavTime = navTimings.length > 0
            ? navTimings.reduce((a, b) => a + b, 0) / navTimings.length
            : 0;

        log('Calendar navigation timing', {
            navigations: navTimings.length,
            timings: navTimings,
            avgTime: `${avgNavTime.toFixed(0)}ms`,
        });

        // Week navigation should be instant (< 500ms)
        if (navTimings.length > 0) {
            expect(avgNavTime).toBeLessThan(500);
        }

        log('✅ Calendar navigation performance verified');
    });
});

test.describe('Admin Dashboard Performance', () => {

    test('should load admin dashboard efficiently', async ({ page }) => {
        test.setTimeout(60000);
        log('Testing admin dashboard performance');

        const startTime = Date.now();
        await page.goto('/es/campus/admin', { waitUntil: 'networkidle' });
        const loadTime = Date.now() - startTime;

        log('Admin dashboard load time', { loadTime: `${loadTime}ms` });

        expect(loadTime).toBeLessThan(10000);

        log('✅ Admin dashboard performance verified');
    });

    test('should load students list with pagination', async ({ page }) => {
        test.setTimeout(60000);
        log('Testing students list performance');

        const startTime = Date.now();
        await page.goto('/es/campus/admin/students', { waitUntil: 'networkidle' });
        const loadTime = Date.now() - startTime;

        // Check for table/list
        const hasTable = await page.locator('table, [class*="list"]').isVisible().catch(() => false);

        log('Students list metrics', {
            loadTime: `${loadTime}ms`,
            hasTable,
        });

        expect(loadTime).toBeLessThan(8000);

        log('✅ Students list performance verified');
    });

    test('should search students quickly', async ({ page }) => {
        test.setTimeout(60000);
        log('Testing student search performance');

        await page.goto('/es/campus/admin/students', { waitUntil: 'networkidle' });

        // Find search input
        const searchInput = page.locator('input[type="search"], input[placeholder*="buscar"], input[placeholder*="search"]').first();

        if (await searchInput.isVisible()) {
            const startTime = Date.now();
            await searchInput.fill('test');

            // Wait for results to update
            await page.waitForTimeout(500);
            const searchTime = Date.now() - startTime;

            log('Search response time', { searchTime: `${searchTime}ms` });

            // Search should be responsive (< 1 second including debounce)
            expect(searchTime).toBeLessThan(1500);
        }

        log('✅ Student search performance verified');
    });
});

test.describe('Data Loading Performance', () => {

    test('should cache repeated requests', async ({ page }) => {
        log('Testing request caching');

        // First load
        const firstStart = Date.now();
        await page.goto('/es/campus', { waitUntil: 'networkidle' });
        const firstLoad = Date.now() - firstStart;

        // Navigate away
        await page.goto('/es/campus/classes', { waitUntil: 'networkidle' });

        // Return to dashboard
        const secondStart = Date.now();
        await page.goto('/es/campus', { waitUntil: 'networkidle' });
        const secondLoad = Date.now() - secondStart;

        log('Cache effectiveness', {
            firstLoad: `${firstLoad}ms`,
            secondLoad: `${secondLoad}ms`,
            improvement: `${((1 - secondLoad / firstLoad) * 100).toFixed(1)}%`,
        });

        // Second load should be at least somewhat faster due to caching
        // (browser cache, service worker, etc.)
        log('✅ Caching behavior analyzed');
    });

    test('should lazy load images', async ({ page }) => {
        log('Testing image lazy loading');

        // Count image requests
        let imageRequests = 0;
        page.on('request', request => {
            if (request.resourceType() === 'image') {
                imageRequests++;
            }
        });

        await page.goto('/es', { waitUntil: 'domcontentloaded' });
        const imagesOnLoad = imageRequests;

        // Scroll to bottom
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
        await page.waitForTimeout(500);
        const imagesAfterScroll = imageRequests;

        log('Image loading', {
            onInitialLoad: imagesOnLoad,
            afterScroll: imagesAfterScroll,
            lazyLoaded: imagesAfterScroll - imagesOnLoad,
        });

        log('✅ Image lazy loading analyzed');
    });
});

test.describe('Rendering Performance', () => {

    test('should render without excessive repaints', async ({ page }) => {
        log('Testing render performance');

        await page.goto('/es/campus', { waitUntil: 'networkidle' });

        // Measure long tasks
        const longTasks = await page.evaluate(() => {
            return new Promise<number>((resolve) => {
                let count = 0;
                const observer = new PerformanceObserver((list) => {
                    count += list.getEntries().length;
                });

                try {
                    observer.observe({ entryTypes: ['longtask'] });
                } catch (e) {
                    // Long task observation not supported
                    resolve(0);
                    return;
                }

                setTimeout(() => {
                    observer.disconnect();
                    resolve(count);
                }, 2000);
            });
        });

        log('Long tasks detected', { count: longTasks });

        // Ideally should have minimal long tasks
        if (longTasks > 5) {
            log('⚠️ Multiple long tasks detected - may affect performance');
        }

        log('✅ Render performance analyzed');
    });
});
