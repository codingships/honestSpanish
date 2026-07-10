import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const runtimeEnv = vi.hoisted(() => ({
    values: {} as Record<string, string | undefined>,
    readRuntimeEnv: vi.fn((key: string) => runtimeEnv.values[key]),
    requireRuntimeEnv: vi.fn((key: string) => {
        const value = runtimeEnv.values[key];
        if (!value) throw new Error(`Missing ${key}`);
        return value;
    }),
}));

vi.mock('../../src/lib/runtime-env', () => ({
    readRuntimeEnv: runtimeEnv.readRuntimeEnv,
    requireRuntimeEnv: runtimeEnv.requireRuntimeEnv,
}));

describe('Supabase runtime isolation', () => {
    it('uses statically analyzable Vite env access for build/runtime binding', () => {
        const source = readFileSync('src/lib/supabase-runtime-guard.ts', 'utf8');
        expect(source).toContain('import.meta.env.PUBLIC_SUPABASE_URL');
        expect(source).toContain('import.meta.env.PUBLIC_SUPABASE_ANON_KEY');
        expect(source).not.toContain('const importMeta = import.meta');
    });

    beforeEach(() => {
        vi.resetModules();
        vi.clearAllMocks();
        runtimeEnv.values = {};
        vi.stubEnv('PUBLIC_SUPABASE_URL', 'https://stagingref.supabase.co');
        vi.stubEnv('PUBLIC_SUPABASE_ANON_KEY', 'anon-build');
    });

    it('accepts a deployed runtime only when build, runtime and expected refs match', async () => {
        runtimeEnv.values = {
            PUBLIC_APP_ENV: 'staging',
            PUBLIC_SUPABASE_URL: 'https://stagingref.supabase.co',
            SUPABASE_EXPECTED_PROJECT_REF: 'stagingref',
        };
        const { getSupabaseRuntimeConfig } = await import('../../src/lib/supabase-runtime-guard');

        expect(getSupabaseRuntimeConfig()).toEqual({
            appEnvironment: 'staging',
            projectRef: 'stagingref',
            url: 'https://stagingref.supabase.co',
        });
    });

    it('fails closed when staging runtime points to a different project', async () => {
        runtimeEnv.values = {
            PUBLIC_APP_ENV: 'staging',
            PUBLIC_SUPABASE_URL: 'https://productionref.supabase.co',
            SUPABASE_EXPECTED_PROJECT_REF: 'stagingref',
        };
        const { getSupabaseRuntimeConfig } = await import('../../src/lib/supabase-runtime-guard');

        expect(() => getSupabaseRuntimeConfig()).toThrow(/Build-time and runtime Supabase projects/);
    });

    it('requires an explicit expected project in staging and production', async () => {
        runtimeEnv.values = {
            PUBLIC_APP_ENV: 'production',
            PUBLIC_SUPABASE_URL: 'https://stagingref.supabase.co',
        };
        const { getSupabaseRuntimeConfig } = await import('../../src/lib/supabase-runtime-guard');

        expect(() => getSupabaseRuntimeConfig()).toThrow(/Missing SUPABASE_EXPECTED_PROJECT_REF/);
    });
});
