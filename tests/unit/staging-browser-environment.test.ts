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

const databaseUrl = (projectRef: string): string => {
    const url = new URL('postgresql://pooler.supabase.com:6543/postgres');
    url.username = `postgres.${projectRef}`;
    url.password = 'fixture-only';
    return url.toString();
};

const stagingEnv = {
    PUBLIC_APP_ENV: 'staging',
    PUBLIC_SITE_URL: STAGING_BROWSER_ORIGIN,
    CHECKOUT_ENABLED: 'true',
    CHECKOUT_ENABLED_OVERRIDE: 'true',
    PUBLIC_SUPABASE_URL: `https://${STAGING_BROWSER_SUPABASE_REF}.supabase.co`,
    PUBLIC_SUPABASE_ANON_KEY: 'staging-anon',
    SUPABASE_SERVICE_ROLE_KEY: 'staging-service-role',
    SUPABASE_DB_URL: databaseUrl(STAGING_BROWSER_SUPABASE_REF),
    SUPABASE_EXPECTED_PROJECT_REF: STAGING_BROWSER_SUPABASE_REF,
};

describe('staging browser environment', () => {
    it('pins the approved staging ref and rejects the production ref', () => {
        expect(STAGING_BROWSER_SUPABASE_REF).toBe('mzjyvmlxfpzdfdjzxxyj');
        expect(PRODUCTION_BROWSER_SUPABASE_REF).toBe('vkkahxsybhbutszerawz');

        const result = buildStagingBrowserEnvironment(stagingEnv, {});
        expect(result.stagingRef).toBe(STAGING_BROWSER_SUPABASE_REF);
        expect(result.values).toMatchObject({
            PUBLIC_APP_ENV: 'staging',
            PUBLIC_SUPABASE_URL: `https://${STAGING_BROWSER_SUPABASE_REF}.supabase.co`,
            E2E_TARGET_SUPABASE_REF: STAGING_BROWSER_SUPABASE_REF,
            CHECKOUT_ENABLED: 'true',
            CHECKOUT_ENABLED_OVERRIDE: 'true',
        });
    });

    it('rejects production identity and Supabase overrides from the test environment', () => {
        expect(() => buildStagingBrowserEnvironment({
            ...stagingEnv,
            PUBLIC_SUPABASE_URL: `https://${PRODUCTION_BROWSER_SUPABASE_REF}.supabase.co`,
        }, {})).toThrow('must target approved Supabase staging');

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
            )).toThrow(`.env.test cannot override ${key}`);
        }
    });

    it('does not read an unsupported root .env file', () => {
        const source = readFileSync('scripts/staging-browser-environment.ts', 'utf8');
        expect(source).not.toContain("path.resolve(cwd, '.env')");
        expect(source).not.toContain('protectedProductionEnv');
    });

    it('removes database credentials before starting browser processes', () => {
        const processEnv: NodeJS.ProcessEnv = {
            SUPABASE_DB_URL: 'protected',
            SUPABASE_STAGING_DB_URL: 'protected',
            SUPABASE_PRODUCTION_DB_URL: 'protected',
            DATABASE_URL: 'protected',
            PGPASSWORD: 'protected',
            PGHOST: 'protected',
            PGUSER: 'protected',
            PGDATABASE: 'protected',
            PGPORT: 'protected',
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
            'PGHOST',
            'PGUSER',
            'PGDATABASE',
            'PGPORT',
        ]) {
            expect(processEnv[key]).toBeUndefined();
        }
        expect(processEnv).toMatchObject({ PUBLIC_APP_ENV: 'staging', KEEP_ME: 'yes' });
    });

    it('accepts only exact staging or explicit local browser origins', () => {
        expect(assertStagingOrLocalBrowserBaseUrl(STAGING_BROWSER_ORIGIN, 'test'))
            .toBe(STAGING_BROWSER_ORIGIN);
        expect(assertStagingOrLocalBrowserBaseUrl('http://localhost:4321/', 'test'))
            .toBe('http://localhost:4321');
        expect(assertStagingOrLocalBrowserBaseUrl('http://127.0.0.1:4321', 'test'))
            .toBe('http://127.0.0.1:4321');

        for (const rejected of [
            'https://espanolhonesto.com',
            `${STAGING_BROWSER_ORIGIN}/es`,
            'https://staging.espanolhonesto.com.example.test',
            'http://0.0.0.0:4321',
        ]) {
            expect(() => assertStagingOrLocalBrowserBaseUrl(rejected, 'test')).toThrow('Refusing test');
        }
    });

    it('routes the remaining demo entry point through the shared guard', () => {
        const file = 'scripts/demo/dev.ts';
        const source = readFileSync(file, 'utf8');
        expect(source, file).toContain('loadStagingBrowserEnvironment');
        expect(source, file).not.toContain("dotenv.config({ path: '.env'");
    });
});
