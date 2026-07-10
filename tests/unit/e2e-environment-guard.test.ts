import { describe, expect, it } from 'vitest';
import {
    buildLocalStagingEnvironment,
    PRODUCTION_SUPABASE_PROJECT_REF,
    STAGING_SUPABASE_PROJECT_REF,
} from '../e2e/environment-guard';

const testEnv = {
    TEST_BASE_URL: 'http://localhost:4321',
    TEST_STUDENT_EMAIL: 'old-student@example.test',
    E2E_DISABLE_EXTERNAL_INTEGRATIONS: 'false',
};

const stagingEnv = {
    PUBLIC_SUPABASE_URL: `https://${STAGING_SUPABASE_PROJECT_REF}.supabase.co`,
    PUBLIC_SUPABASE_ANON_KEY: 'staging-anon',
    SUPABASE_SERVICE_ROLE_KEY: 'staging-service-role',
    SUPABASE_DB_URL: 'postgresql://staging.example.test/postgres',
    RESEND_API_KEY: 'must-not-be-copied',
    TEST_STUDENT_EMAIL: 'student@staging.example.test',
    TEST_STUDENT_PASSWORD: 'student-password',
    TEST_TEACHER_EMAIL: 'teacher@staging.example.test',
    TEST_TEACHER_PASSWORD: 'teacher-password',
    TEST_ADMIN_EMAIL: 'admin@staging.example.test',
    TEST_ADMIN_PASSWORD: 'admin-password',
};

const productionEnv = {
    PUBLIC_SUPABASE_URL: `https://${PRODUCTION_SUPABASE_PROJECT_REF}.supabase.co`,
    SUPABASE_SERVICE_ROLE_KEY: 'production-service-role',
};

describe('E2E staging environment guard', () => {
    it('selects staging accounts and forces external effects off', () => {
        const result = buildLocalStagingEnvironment(testEnv, stagingEnv, productionEnv);

        expect(result.stagingRef).toBe(STAGING_SUPABASE_PROJECT_REF);
        expect(result.values).toMatchObject({
            TEST_BASE_URL: 'http://localhost:4321',
            TEST_STUDENT_EMAIL: 'student@staging.example.test',
            TEST_TEACHER_EMAIL: 'teacher@staging.example.test',
            TEST_ADMIN_EMAIL: 'admin@staging.example.test',
            PUBLIC_SUPABASE_URL: `https://${STAGING_SUPABASE_PROJECT_REF}.supabase.co`,
            PUBLIC_APP_ENV: 'staging',
            CHECKOUT_ENABLED: 'false',
            E2E_DISABLE_EXTERNAL_INTEGRATIONS: 'true',
            E2E_RUNTIME_ISOLATED: 'true',
            E2E_TARGET_SUPABASE_REF: STAGING_SUPABASE_PROJECT_REF,
        });
        expect(result.values.RESEND_API_KEY).toBeUndefined();
    });

    it('rejects a staging file that points at the production project', () => {
        expect(() => buildLocalStagingEnvironment(
            testEnv,
            { ...stagingEnv, PUBLIC_SUPABASE_URL: productionEnv.PUBLIC_SUPABASE_URL },
            productionEnv,
        )).toThrow('.env.staging must target the approved staging project');
    });

    it('rejects files whose staging and production identities were swapped', () => {
        expect(() => buildLocalStagingEnvironment(
            testEnv,
            { ...stagingEnv, PUBLIC_SUPABASE_URL: productionEnv.PUBLIC_SUPABASE_URL },
            { ...productionEnv, PUBLIC_SUPABASE_URL: stagingEnv.PUBLIC_SUPABASE_URL },
        )).toThrow('.env.staging must target the approved staging project');
    });

    it('rejects a staging file that reuses the production service-role key', () => {
        expect(() => buildLocalStagingEnvironment(
            testEnv,
            { ...stagingEnv, SUPABASE_SERVICE_ROLE_KEY: productionEnv.SUPABASE_SERVICE_ROLE_KEY },
            productionEnv,
        )).toThrow('staging and production use the same Supabase service-role key');
    });

    it('fails closed when a required staging credential is absent', () => {
        expect(() => buildLocalStagingEnvironment(
            testEnv,
            { ...stagingEnv, TEST_ADMIN_PASSWORD: '' },
            productionEnv,
        )).toThrow('.env.staging is missing TEST_ADMIN_PASSWORD');
    });

    it('rejects a remote base URL before credentials can leave localhost', () => {
        expect(() => buildLocalStagingEnvironment(
            { ...testEnv, TEST_BASE_URL: 'https://staging.example.test' },
            stagingEnv,
            productionEnv,
        )).toThrow('TEST_BASE_URL must be an exact local Astro origin on port 4321');
    });
});
