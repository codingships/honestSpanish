import { describe, expect, it } from 'vitest';
import {
    buildCampusSessionLoginUrl,
    isCampusSessionFailure,
} from '../../src/lib/campus-session-recovery';

describe('campus session recovery', () => {
    const current = 'https://staging.espanolhonesto.com/es/campus/admin/packages?tab=drafts#editor';

    it.each([
        ['/api/admin/catalog-v2', 401],
        [new URL('/api/calendar/sessions', current), 401],
        [new Request('https://staging.espanolhonesto.com/api/admin/content'), 401],
    ])('recognizes a same-origin API 401 from %s', (target, status) => {
        expect(isCampusSessionFailure(target, status, current)).toBe(true);
    });

    it('recognizes a 401 from the exact configured Supabase Auth origin', () => {
        expect(isCampusSessionFailure(
            'https://mzjyvmlxfpzdfdjzxxyj.supabase.co/auth/v1/user',
            401,
            current,
            'https://mzjyvmlxfpzdfdjzxxyj.supabase.co',
        )).toBe(true);
    });

    it.each([
        ['/api/admin/catalog-v2', 403],
        ['/es/campus/admin', 401],
        ['https://api.example.com/api/admin/catalog-v2', 401],
        ['not a valid URL%', 401],
    ])('ignores a response that is not a campus session failure: %s %s', (target, status) => {
        expect(isCampusSessionFailure(target, status, current)).toBe(false);
    });

    it('does not treat another Supabase project or non-auth path as the active session', () => {
        expect(isCampusSessionFailure(
            'https://another-project.supabase.co/auth/v1/user',
            401,
            current,
            'https://mzjyvmlxfpzdfdjzxxyj.supabase.co',
        )).toBe(false);
        expect(isCampusSessionFailure(
            'https://mzjyvmlxfpzdfdjzxxyj.supabase.co/rest/v1/profiles',
            401,
            current,
            'https://mzjyvmlxfpzdfdjzxxyj.supabase.co',
        )).toBe(false);
    });

    it('returns an administrator to the exact current campus screen after login', () => {
        expect(buildCampusSessionLoginUrl('es', 'admin', current)).toBe(
            `/es/login?returnTo=${encodeURIComponent('/es/campus/admin/packages?tab=drafts#editor')}`,
        );
    });

    it('falls back to localized login when the current destination is incompatible', () => {
        expect(buildCampusSessionLoginUrl(
            'en',
            'teacher',
            'https://staging.espanolhonesto.com/en/campus/admin',
        )).toBe('/en/login');
    });
});
