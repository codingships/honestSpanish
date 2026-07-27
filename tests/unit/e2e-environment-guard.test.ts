import { describe, expect, it } from 'vitest';
import {
    configurePlaywrightEnvironment,
    PUBLIC_E2E_BASE_URL,
    PUBLIC_E2E_SUPABASE_ANON_KEY,
    PUBLIC_E2E_SUPABASE_REF,
    PUBLIC_E2E_SUPABASE_SERVICE_ROLE_KEY,
    PUBLIC_E2E_SUPABASE_URL,
} from '../e2e/environment-guard';

describe('public E2E environment guard', () => {
    it('always installs an exact inert local runtime without reading environment files', () => {
        const processEnv = {
            CI: 'false',
            TEST_BASE_URL: 'https://remote.example.test',
            PUBLIC_SUPABASE_URL: 'https://real-project.supabase.co',
            PUBLIC_SUPABASE_ANON_KEY: 'real-anon',
            SUPABASE_SERVICE_ROLE_KEY: 'real-service-role',
            PUBLIC_APP_ENV: 'production',
            CHECKOUT_ENABLED: 'true',
            CHECKOUT_ENABLED_OVERRIDE: 'true',
            E2E_DISABLE_EXTERNAL_INTEGRATIONS: 'false',
            E2E_RUNTIME_ISOLATED: 'false',
            CLOUDFLARE_API_TOKEN: 'must-be-scrubbed',
            RESEND_API_KEY: 'must-be-scrubbed',
            STRIPE_SECRET_KEY: 'must-be-scrubbed',
            SUPABASE_DB_URL: 'postgresql://must-be-scrubbed',
        } as NodeJS.ProcessEnv;

        expect(configurePlaywrightEnvironment(processEnv)).toEqual({
            target: 'public',
            supabaseRef: PUBLIC_E2E_SUPABASE_REF,
        });
        expect(processEnv).toMatchObject({
            TEST_BASE_URL: PUBLIC_E2E_BASE_URL,
            PUBLIC_SITE_URL: PUBLIC_E2E_BASE_URL,
            PUBLIC_SUPABASE_URL: PUBLIC_E2E_SUPABASE_URL,
            PUBLIC_SUPABASE_ANON_KEY: PUBLIC_E2E_SUPABASE_ANON_KEY,
            SUPABASE_SERVICE_ROLE_KEY: PUBLIC_E2E_SUPABASE_SERVICE_ROLE_KEY,
            PUBLIC_APP_ENV: 'test',
            CHECKOUT_ENABLED: 'false',
            CHECKOUT_ENABLED_OVERRIDE: 'false',
            E2E_DISABLE_EXTERNAL_INTEGRATIONS: 'true',
            E2E_RUNTIME_ISOLATED: 'true',
            E2E_TARGET_SUPABASE_REF: PUBLIC_E2E_SUPABASE_REF,
            SUPABASE_EXPECTED_PROJECT_REF: PUBLIC_E2E_SUPABASE_REF,
            CLOUDFLARE_INCLUDE_PROCESS_ENV: 'false',
        });
        expect(processEnv.CLOUDFLARE_API_TOKEN).toBeUndefined();
        expect(processEnv.RESEND_API_KEY).toBeUndefined();
        expect(processEnv.STRIPE_SECRET_KEY).toBeUndefined();
        expect(processEnv.SUPABASE_DB_URL).toBeUndefined();
    });

    it('uses the same inert mode in CI without an opt-in switch', () => {
        const processEnv = {
            CI: 'true',
            E2E_CI_PUBLIC_PLACEHOLDER: 'false',
            TEST_PARALLEL_INDEX: '0',
            TEST_WORKER_INDEX: '0',
        } as NodeJS.ProcessEnv;

        configurePlaywrightEnvironment(processEnv);

        expect(processEnv.E2E_CI_PUBLIC_PLACEHOLDER).toBeUndefined();
        expect(processEnv.PUBLIC_APP_ENV).toBe('test');
        expect(processEnv.PUBLIC_SUPABASE_URL).toBe(PUBLIC_E2E_SUPABASE_URL);
    });

    it('fails closed when authenticated TEST_* credentials leak into public Playwright', () => {
        const processEnv = {
            TEST_STUDENT_EMAIL: 'student@example.test',
            TEST_STUDENT_PASSWORD: 'secret',
        } as NodeJS.ProcessEnv;

        expect(() => configurePlaywrightEnvironment(processEnv))
            .toThrow('Public Playwright refuses inherited TEST_* credentials: TEST_STUDENT_EMAIL, TEST_STUDENT_PASSWORD');
    });
});
