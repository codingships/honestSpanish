import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
    applyStagingBrowserEnvironment,
    assertStagingOrLocalBrowserBaseUrl,
    buildStagingBrowserEnvironment,
    PRODUCTION_BROWSER_SUPABASE_REF,
    STAGING_BROWSER_ORIGIN,
    STAGING_BROWSER_SUPABASE_REF,
} from '../../scripts/staging-browser-environment';

const buildFixtureDbUrl = (projectRef: string) => {
    const url = new URL('postgresql://pooler.supabase.com:6543/postgres');
    url.username = `postgres.${projectRef}`;
    url.password = 'fixture-only';
    return url.toString();
};

const stagingEnv = {
    PUBLIC_APP_ENV: 'staging',
    PUBLIC_SITE_URL: STAGING_BROWSER_ORIGIN,
    CHECKOUT_ENABLED: 'false',
    CHECKOUT_ENABLED_OVERRIDE: 'false',
    PUBLIC_SUPABASE_URL: `https://${STAGING_BROWSER_SUPABASE_REF}.supabase.co`,
    PUBLIC_SUPABASE_ANON_KEY: 'staging-anon',
    SUPABASE_SERVICE_ROLE_KEY: 'staging-service-role',
    SUPABASE_DB_URL: buildFixtureDbUrl(STAGING_BROWSER_SUPABASE_REF),
    SUPABASE_EXPECTED_PROJECT_REF: STAGING_BROWSER_SUPABASE_REF,
    PUBLIC_TURNSTILE_SITE_KEY: 'staging-turnstile',
    TEST_STUDENT_EMAIL: 'staging-student@example.test',
};

const protectedProductionEnv = {
    PUBLIC_SUPABASE_URL: `https://${PRODUCTION_BROWSER_SUPABASE_REF}.supabase.co`,
    PUBLIC_SUPABASE_ANON_KEY: 'production-anon',
    SUPABASE_SERVICE_ROLE_KEY: 'production-service-role',
    SUPABASE_DB_URL: buildFixtureDbUrl(PRODUCTION_BROWSER_SUPABASE_REF),
};

describe('staging browser environment', () => {
    it('sources runtime values from staging and only test-prefixed overrides from .env.test', () => {
        const result = buildStagingBrowserEnvironment(stagingEnv, {
            TEST_STUDENT_EMAIL: 'test-student@example.test',
            E2E_DISABLE_EXTERNAL_INTEGRATIONS: 'true',
            PUBLIC_TURNSTILE_SITE_KEY: 'must-not-override-staging',
            DEMO_BASE_URL: 'https://espanolhonesto.com',
        }, protectedProductionEnv);

        expect(result).toMatchObject({
            stagingRef: STAGING_BROWSER_SUPABASE_REF,
            protectedProductionCompared: true,
        });
        expect(result.values).toMatchObject({
            PUBLIC_APP_ENV: 'staging',
            PUBLIC_SUPABASE_URL: `https://${STAGING_BROWSER_SUPABASE_REF}.supabase.co`,
            SUPABASE_EXPECTED_PROJECT_REF: STAGING_BROWSER_SUPABASE_REF,
            E2E_TARGET_SUPABASE_REF: STAGING_BROWSER_SUPABASE_REF,
            CHECKOUT_ENABLED: 'false',
            CHECKOUT_ENABLED_OVERRIDE: 'false',
            TEST_STUDENT_EMAIL: 'test-student@example.test',
            E2E_DISABLE_EXTERNAL_INTEGRATIONS: 'true',
            PUBLIC_TURNSTILE_SITE_KEY: 'staging-turnstile',
            CLOUDFLARE_ENV: 'staging',
        });
        expect(result.values.DEMO_BASE_URL).toBeUndefined();
        expect(result.values.SUPABASE_DB_URL).toBeUndefined();
    });

    it('never exposes migration/database credentials to browser or Astro child processes', () => {
        const processEnv: NodeJS.ProcessEnv = {
            SUPABASE_DB_URL: 'protected',
            SUPABASE_STAGING_DB_URL: 'protected',
            SUPABASE_PRODUCTION_DB_URL: 'protected',
            DATABASE_URL: 'protected',
            PGPASSWORD: 'protected',
            KEEP_ME: 'yes',
        };

        applyStagingBrowserEnvironment(processEnv, {
            PUBLIC_APP_ENV: 'staging',
            SUPABASE_DB_URL: 'must-not-survive',
        });

        for (const key of [
            'SUPABASE_DB_URL',
            'SUPABASE_STAGING_DB_URL',
            'SUPABASE_PRODUCTION_DB_URL',
            'DATABASE_URL',
            'PGPASSWORD',
        ]) {
            expect(processEnv[key]).toBeUndefined();
        }
        expect(processEnv).toMatchObject({ PUBLIC_APP_ENV: 'staging', KEEP_ME: 'yes' });
    });

    it('rejects production Supabase URLs, refs and database identities', () => {
        expect(() => buildStagingBrowserEnvironment({
            ...stagingEnv,
            PUBLIC_SUPABASE_URL: protectedProductionEnv.PUBLIC_SUPABASE_URL,
        }, {}, protectedProductionEnv)).toThrow('must target approved Supabase staging');

        expect(() => buildStagingBrowserEnvironment({
            ...stagingEnv,
            SUPABASE_EXPECTED_PROJECT_REF: PRODUCTION_BROWSER_SUPABASE_REF,
        }, {}, protectedProductionEnv)).toThrow('inconsistent Supabase project ref');

        expect(() => buildStagingBrowserEnvironment({
            ...stagingEnv,
            SUPABASE_DB_URL: protectedProductionEnv.SUPABASE_DB_URL,
        }, {}, protectedProductionEnv)).toThrow('production SUPABASE_DB_URL');
    });

    it('rejects protected production keys without exposing their values in the error', () => {
        const secret = 'production-service-role-do-not-print';
        expect(() => buildStagingBrowserEnvironment({
            ...stagingEnv,
            SUPABASE_SERVICE_ROLE_KEY: secret,
        }, {}, {
            ...protectedProductionEnv,
            SUPABASE_SERVICE_ROLE_KEY: secret,
        })).toThrowError(expect.objectContaining({
            message: expect.not.stringContaining(secret),
        }));
    });

    it('rejects every attempt to place Supabase runtime identity in .env.test', () => {
        for (const key of [
            'PUBLIC_SUPABASE_URL',
            'PUBLIC_SUPABASE_ANON_KEY',
            'SUPABASE_SERVICE_ROLE_KEY',
            'SUPABASE_DB_URL',
            'SUPABASE_EXPECTED_PROJECT_REF',
            'E2E_TARGET_SUPABASE_REF',
        ]) {
            expect(() => buildStagingBrowserEnvironment(
                stagingEnv,
                { [key]: 'forbidden-test-override' },
                protectedProductionEnv,
            )).toThrow(`.env.test cannot override ${key}`);
        }
    });

    it('accepts exact local origins and the stable staging Worker only', () => {
        expect(assertStagingOrLocalBrowserBaseUrl('http://localhost:4321/', 'test')).toBe('http://localhost:4321');
        expect(assertStagingOrLocalBrowserBaseUrl('http://127.0.0.1:4391', 'test')).toBe('http://127.0.0.1:4391');
        expect(assertStagingOrLocalBrowserBaseUrl(STAGING_BROWSER_ORIGIN, 'test')).toBe(STAGING_BROWSER_ORIGIN);

        for (const rejected of [
            'https://espanolhonesto.com',
            'https://example.test',
            `${STAGING_BROWSER_ORIGIN}/es`,
            `${STAGING_BROWSER_ORIGIN}?unsafe=true`,
            'http://0.0.0.0:4321',
        ]) {
            expect(() => assertStagingOrLocalBrowserBaseUrl(rejected, 'test')).toThrow('Refusing test');
        }
    });

    it('routes all four browser entry points through the shared guard and keeps local servers on pnpm dev', () => {
        const sources = [
            'scripts/launch/accessibility-smoke.ts',
            'scripts/launch/public-visual-smoke.ts',
            'scripts/demo/dev.ts',
            'scripts/demo/run.ts',
        ].map((file) => [file, readFileSync(file, 'utf8')] as const);

        for (const [file, source] of sources) {
            expect(source, file).toContain('loadStagingBrowserEnvironment');
            expect(source, file).not.toContain("dotenv.config({ path: '.env'");
        }

        for (const file of [
            'scripts/launch/accessibility-smoke.ts',
            'scripts/launch/public-visual-smoke.ts',
            'scripts/demo/dev.ts',
        ]) {
            expect(readFileSync(file, 'utf8'), file).toContain("['pnpm', 'dev'");
        }
    });
});
