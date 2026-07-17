import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';

const astroEnvMock = vi.hoisted(() => ({
    getSecret: vi.fn(),
}));

vi.mock('astro:env/server', () => ({
    getSecret: astroEnvMock.getSecret,
}));

describe('runtime env helpers', () => {
    afterEach(() => {
        vi.unstubAllEnvs();
        vi.restoreAllMocks();
    });

    it('prefers the adapter-provided runtime secret over process env', async () => {
        vi.resetModules();
        astroEnvMock.getSecret.mockReturnValue('from-astro-secret');
        vi.stubEnv('RUNTIME_ENV_TEST_KEY', 'from-process-env');

        const { readRuntimeEnv } = await import('../../src/lib/runtime-env');

        expect(readRuntimeEnv('RUNTIME_ENV_TEST_KEY')).toBe('from-astro-secret');
        expect(astroEnvMock.getSecret).toHaveBeenCalledWith('RUNTIME_ENV_TEST_KEY');
    });

    it('falls back when Astro runtime env is unavailable', async () => {
        vi.resetModules();
        astroEnvMock.getSecret.mockImplementation(() => {
            throw new Error('runtime env unavailable');
        });
        vi.stubEnv('RUNTIME_ENV_PROCESS_FALLBACK', 'from-process-env');

        const { readRuntimeEnv } = await import('../../src/lib/runtime-env');

        expect(readRuntimeEnv('RUNTIME_ENV_PROCESS_FALLBACK')).toBe('from-process-env');
    });

    it('does not enumerate server secrets through import.meta.env', () => {
        const source = readFileSync('src/lib/runtime-env.ts', 'utf8');

        expect(source).toContain("from 'astro:env/server'");
        expect(source).toContain('getSecret(key)');
        expect(source).not.toContain('import.meta.env');
        expect(source).not.toContain('getImportMetaEnvValue');
        expect(source).not.toContain("case 'STRIPE_SECRET_KEY'");
        expect(source).not.toContain("case 'SUPABASE_SERVICE_ROLE_KEY'");
    });

    it('throws a clear error when a required value is missing', async () => {
        vi.resetModules();
        astroEnvMock.getSecret.mockReturnValue(undefined);

        const { requireRuntimeEnv } = await import('../../src/lib/runtime-env');

        expect(() => requireRuntimeEnv('RUNTIME_ENV_MISSING')).toThrow(
            'Missing RUNTIME_ENV_MISSING environment variable'
        );
    });
});
