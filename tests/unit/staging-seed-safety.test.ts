import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('staging seed safety', () => {
    it('routes db:seed:staging through the exact staging-only browser environment', () => {
        const packageJson = readFileSync('package.json', 'utf8');
        const source = readFileSync('scripts/prepare-e2e-data.ts', 'utf8');

        expect(packageJson).toContain('"db:seed:staging": "tsx scripts/prepare-e2e-data.ts"');
        expect(source).toContain('loadStagingBrowserEnvironment');
        expect(source).toContain('STAGING_BROWSER_SUPABASE_REF');
        expect(source).toContain('E2E_STAGING_WRITE_CONFIRMATION');
        expect(source).toContain('selectedEnvironment.stagingRef !== STAGING_BROWSER_SUPABASE_REF');
        expect(source).not.toContain("from '../tests/e2e/environment-guard'");
        expect(source).toContain("const preferred = ['standard', 'bootcamp']");
        expect(source).not.toContain("['standard', 'hybrid', 'group', 'bootcamp']");
        expect(source).not.toContain("password: 'test123'");
    });

    it('removes legacy unguarded bulk-user and password-reset scripts', () => {
        expect(existsSync('scripts/create-test-users.ts')).toBe(false);
        expect(existsSync('scripts/seed-test-users.ts')).toBe(false);
        expect(existsSync('scripts/seed/index.ts')).toBe(false);
        expect(existsSync('scripts/reset-users.sql')).toBe(false);
    });

    it('has no hardcoded E2E account or password fallback', () => {
        const source = readFileSync('scripts/prepare-e2e-data.ts', 'utf8');
        expect(source).not.toContain("|| 'test123'");
        expect(source).not.toContain("|| 'alindev95@gmail.com'");
        expect(source).not.toContain("|| 'alinandrei74@gmail.com'");
    });

    it('keeps .env.test scoped to explicit staging demo and seed operations', () => {
        const example = readFileSync('.env.test.example', 'utf8');
        expect(example).toContain('explicit staging demo and seed operations only');
        expect(example).toContain('Public Playwright does not read this file');
        expect(example).not.toContain('TEST_BASE_URL');
    });
});
