import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';

const astroEnvMock = vi.hoisted(() => ({
    getEnv: vi.fn(),
}));

vi.mock('astro/env/runtime', () => ({
    getEnv: astroEnvMock.getEnv,
}));

describe('runtime env helpers', () => {
    afterEach(() => {
        vi.unstubAllEnvs();
        vi.restoreAllMocks();
    });

    it('prefers Cloudflare runtime context values over other env sources', async () => {
        vi.resetModules();
        astroEnvMock.getEnv.mockReturnValue('from-astro-env');
        vi.stubEnv('RUNTIME_ENV_TEST_KEY', 'from-import-meta');

        const { readRuntimeEnv } = await import('../../src/lib/runtime-env');

        expect(readRuntimeEnv('RUNTIME_ENV_TEST_KEY', {
            locals: {
                runtime: {
                    env: {
                        RUNTIME_ENV_TEST_KEY: 'from-context',
                    },
                },
            },
        } as any)).toBe('from-context');
    });

    it('falls back when Astro runtime env is unavailable', async () => {
        vi.resetModules();
        astroEnvMock.getEnv.mockImplementation(() => {
            throw new Error('runtime env unavailable');
        });
        vi.stubEnv('RUNTIME_ENV_PROCESS_FALLBACK', 'from-process-env');

        const { readRuntimeEnv } = await import('../../src/lib/runtime-env');

        expect(readRuntimeEnv('RUNTIME_ENV_PROCESS_FALLBACK')).toBe('from-process-env');
    });

    it('keeps the Astro dev import.meta.env fallback before process.env', () => {
        const source = readFileSync('src/lib/runtime-env.ts', 'utf8');
        const importMetaFallbackIndex = source.indexOf('getImportMetaEnvValue(key)');
        const processFallbackIndex = source.indexOf('getProcessEnvValue(key)');
        const importMetaFunction = source.slice(
            source.indexOf('function getImportMetaEnvValue'),
            source.indexOf('function getAstroEnvValue')
        );

        expect(source).toContain('function getImportMetaEnvValue');
        expect(source).toContain('import.meta as ImportMeta');
        expect(source).toContain("case 'PUBLIC_SUPABASE_URL'");
        expect(importMetaFunction).not.toContain('meta.env?.[key]');
        expect(importMetaFunction).not.toContain('env?.[key]');
        expect(importMetaFallbackIndex).toBeGreaterThan(-1);
        expect(processFallbackIndex).toBeGreaterThan(importMetaFallbackIndex);
    });

    it('throws a clear error when a required value is missing', async () => {
        vi.resetModules();
        astroEnvMock.getEnv.mockReturnValue(undefined);

        const { requireRuntimeEnv } = await import('../../src/lib/runtime-env');

        expect(() => requireRuntimeEnv('RUNTIME_ENV_MISSING')).toThrow(
            'Missing RUNTIME_ENV_MISSING environment variable'
        );
    });
});
