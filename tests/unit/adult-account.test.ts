import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { hasVerifiedAdultAccount } from '../../src/lib/adult-account';

const migration = readFileSync(
    'supabase/migrations/20260710144000_enforce_adult_account_attestation.sql',
    'utf8',
).replace(/\r\n/g, '\n');

describe('adult account attestation', () => {
    it('requires the persisted boolean, server timestamp and policy version together', () => {
        expect(hasVerifiedAdultAccount({
            adult_confirmed: true,
            adult_confirmed_at: '2026-07-10T10:00:00.000Z',
            age_policy_version: '2026-07-10',
        })).toBe(true);

        expect(hasVerifiedAdultAccount({
            adult_confirmed: true,
            adult_confirmed_at: null,
            age_policy_version: '2026-07-10',
        })).toBe(false);
        expect(hasVerifiedAdultAccount({
            adult_confirmed: false,
            adult_confirmed_at: '2026-07-10T10:00:00.000Z',
            age_policy_version: '2026-07-10',
        })).toBe(false);
    });

    it('backfills only prior lead or explicit Auth metadata evidence, never email allowlists', () => {
        expect(migration).toContain('WHERE lead.adult_confirmed = TRUE');
        expect(migration).toContain("raw_user_meta_data->'adult_confirmed' = 'true'::jsonb");
        expect(migration).not.toMatch(/(?:example\.com|gmail\.com|outlook\.com)/i);
        expect(migration).toContain('profiles_adult_attestation_complete');
    });

    it('persists new signup attestations in the profile trigger', () => {
        expect(migration).toContain('CREATE OR REPLACE FUNCTION public.handle_new_user()');
        expect(migration).toContain('adult_confirmed_at');
        expect(migration).toContain('age_policy_version');
        expect(migration).toContain('GRANT EXECUTE ON FUNCTION public.handle_new_user() TO service_role;');
    });

    it('blocks direct authenticated profile updates while preserving service-role writes', () => {
        const authNullCheck = migration.indexOf('IF auth.uid() IS NULL THEN');
        const attestationGuard = migration.indexOf('Cannot modify adult account attestation');
        const adminBypass = migration.indexOf('IF (select private.is_admin()) THEN');

        expect(authNullCheck).toBeGreaterThan(-1);
        expect(attestationGuard).toBeGreaterThan(authNullCheck);
        expect(adminBypass).toBeGreaterThan(attestationGuard);
        expect(migration).toContain('NEW.adult_confirmed IS DISTINCT FROM OLD.adult_confirmed');
        expect(migration).toContain('NEW.adult_confirmed_at IS DISTINCT FROM OLD.adult_confirmed_at');
        expect(migration).toContain('NEW.age_policy_version IS DISTINCT FROM OLD.age_policy_version');
        expect(migration).toContain('BEFORE UPDATE ON public.profiles');
    });

    it('keeps a localized server-backed re-attestation route for existing students', () => {
        const page = readFileSync('src/pages/[lang]/adult-confirmation.astro', 'utf8');
        const api = readFileSync('src/pages/api/auth/confirm-adult.ts', 'utf8');

        expect(page).toContain('/api/auth/confirm-adult');
        expect(page).toContain("window.location.assign(`/${pageCopy.lang || 'es'}/campus`)");
        expect(page).toContain('Подтверждение совершеннолетия');
        expect(api).toContain('LEGAL_POLICY_VERSION');
        expect(api).toContain('adult_confirmed_at: adultConfirmedAt');
    });
});
