import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
    type AuditConfiguration,
    validateLighthouseResults,
} from '../../scripts/ci/run-lighthouse';
import { distribution, renderMarkdown, summarizeLighthouse } from '../../scripts/ci/summarize-lighthouse';

const require = createRequire(import.meta.url);
const configPath = resolve('lighthouse.config.cjs');
const originalEnvironment = { ...process.env };

function loadConfig(environment: Record<string, string> = {}): AuditConfiguration {
    process.env = { ...originalEnvironment, ...environment };
    delete require.cache[configPath];
    return require(configPath) as AuditConfiguration;
}

afterEach(() => {
    process.env = { ...originalEnvironment };
    delete require.cache[configPath];
});

describe('Lighthouse audit contract', () => {
    it('audits seven representative templates three times by default', () => {
        const config = loadConfig();
        expect(config.runCount).toBe(3);
        expect(config.routes).toHaveLength(7);
        expect(config.routes).toContain('/ru');
        expect(config.routes).toContain('/es/blog/cuanto-tiempo-hablar-espanol-fluido');
        expect(config.localServer).toBe(true);
        expect(config.baseOrigin).toBe('http://localhost:4321');
    });

    it('keeps pull-request smoke intentionally narrow', () => {
        const config = loadConfig({ LHCI_SCOPE: 'smoke', LHCI_RUNS: '1' });
        expect(config.runCount).toBe(1);
        expect(config.routes).toEqual([
            '/es',
            '/es/blog/cuanto-tiempo-hablar-espanol-fluido',
        ]);
    });

    it('allows only the isolated local origin or canonical staging', () => {
        const staging = loadConfig({ LHCI_BASE_URL: 'https://staging.espanolhonesto.com' });
        expect(staging.localServer).toBe(false);
        expect(staging.baseOrigin).toBe('https://staging.espanolhonesto.com');
        expect(() => loadConfig({ LHCI_BASE_URL: 'https://example.com' })).toThrow('must be exactly');
        expect(() => loadConfig({ LHCI_BASE_URL: 'https://staging.espanolhonesto.com/path' })).toThrow('must be exactly');
    });

    it('does not turn the deliberate staging noindex into a false gate', () => {
        const config = loadConfig();
        expect(config.seoIsInformational).toBe(true);
        expect(config.floors.performanceMedian).toBe(70);
        expect(config.floors.clsWorst).toBe(0.1);
    });
});

describe('Lighthouse summary', () => {
    const result = (performance: number, lcp: number, cls: number) => ({
        audits: {
            'cumulative-layout-shift': { numericValue: cls },
            'first-contentful-paint': { numericValue: 1_000 },
            'largest-contentful-paint': { numericValue: lcp },
            'speed-index': { numericValue: 1_500 },
            'total-blocking-time': { numericValue: 100 },
            'total-byte-weight': { numericValue: 512 * 1024 },
            'errors-in-console': { score: 1 },
        },
        categories: {
            performance: { score: performance },
            accessibility: { score: 1 },
            'best-practices': { score: 0.96 },
            seo: { score: 0.61 },
        },
        configSettings: { formFactor: 'mobile' },
        fetchTime: '2026-08-04T00:00:00.000Z',
        finalUrl: 'http://localhost:4321/es',
        lighthouseVersion: '13.0.0',
        requestedUrl: 'http://localhost:4321/es',
    });

    it('reports median and pessimistic result without averaging scores into readiness', () => {
        expect(distribution([70, 90, 80], 'higher')).toEqual({ median: 80, worst: 70 });
        expect(distribution([2_000, 4_000, 3_000], 'lower')).toEqual({ median: 3_000, worst: 4_000 });
        const routes = summarizeLighthouse([
            result(0.70, 4_000, 0.03),
            result(0.90, 2_000, 0.01),
            result(0.80, 3_000, 0.02),
        ]);
        expect(routes[0]).toMatchObject({
            runs: 3,
            categories: { performance: { median: 80, worst: 70 } },
            metrics: { lcpMs: { median: 3_000, worst: 4_000 } },
        });
        expect(renderMarkdown(routes, {
            sourceSha: 'abc',
            profile: 'mobile',
            scope: 'full',
            lighthouseVersions: '13.0.0',
        })).toContain('| /es | 3 | 80/70 | 3000/4000 |');
        const validation = validateLighthouseResults([
            result(0.70, 4_000, 0.03),
            result(0.90, 2_000, 0.01),
            result(0.80, 3_000, 0.02),
        ], loadConfig());
        expect(validation.failures).toEqual([]);
        expect(validation.warnings).toHaveLength(1);
    });
});
