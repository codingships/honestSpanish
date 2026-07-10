import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('staging seed safety', () => {
    it('routes db:seed through the exact staging-only E2E guard', () => {
        const packageJson = readFileSync('package.json', 'utf8');
        const source = readFileSync('scripts/prepare-e2e-data.ts', 'utf8');

        expect(packageJson).toContain('"db:seed": "tsx scripts/prepare-e2e-data.ts"');
        expect(source).toContain('STAGING_SUPABASE_PROJECT_REF');
        expect(source).toContain('E2E_STAGING_WRITE_CONFIRMATION');
        expect(source).toContain("selectedEnvironment.target !== 'staging'");
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
        const source = readFileSync('tests/e2e/fixtures/test-users.ts', 'utf8');
        expect(source).toContain('hardcoded credential fallbacks are forbidden');
        expect(source).not.toContain("|| 'test123'");
        expect(source).not.toContain("|| 'alindev95@gmail.com'");
        expect(source).not.toContain("|| 'alinandrei74@gmail.com'");
    });
});
