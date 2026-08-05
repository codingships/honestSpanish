import { describe, expect, it } from 'vitest';
import {
    appendAuthReturnTo,
    resolveAuthReturnToForRole,
    sanitizeAuthReturnTo,
} from '../../src/lib/auth-return-to';

const slotPublicId = '10000000-0000-4000-8000-000000000001';
const returnTo = `/en?checkoutSlot=${slotPublicId}#planes`;
const attributedReturnTo = `/en?checkoutSlot=${slotPublicId}&attrRequestId=10000000-0000-4000-8000-000000000001&attrLandingPath=%2Fen&attrReferrerKind=external&attrReferrerHost=www.google.com&attrEntryLanguage=en&attrUtmSource=google#planes`;

describe('authentication return destinations', () => {
    it.each([
        [returnTo, returnTo],
        [`/es/?checkoutSlot=${slotPublicId}#planes`, `/es?checkoutSlot=${slotPublicId}#planes`],
        [`/ru?checkoutSlot=${slotPublicId.toUpperCase()}#planes`, `/ru?checkoutSlot=${slotPublicId.toUpperCase()}#planes`],
        [attributedReturnTo, attributedReturnTo],
    ])('accepts and canonicalizes the checkout landing destination %s', (input, expected) => {
        expect(sanitizeAuthReturnTo(input)).toBe(expected);
    });

    it.each([
        '/es/campus',
        '/en/campus/classes?view=upcoming#next',
        '/ru/campus/teacher/calendar?week=2026-08-10',
        '/es/campus/admin/packages',
        '/en/campus/account',
    ])('accepts the localized campus destination %s', (input) => {
        expect(sanitizeAuthReturnTo(input)).toBe(input);
    });

    it.each([
        'https://evil.example/en',
        '//evil.example/en',
        '/\\evil.example/en',
        `/en//?checkoutSlot=${slotPublicId}#planes`,
        `/en/%2F%2Fevil.example?checkoutSlot=${slotPublicId}#planes`,
        `/en?checkoutSlot=${slotPublicId}`,
        `/en?checkoutSlot=${slotPublicId}#other`,
        `/en?checkoutSlot=not-a-uuid#planes`,
        `/en?checkoutSlot=${slotPublicId}&next=evil#planes`,
        `/en?checkoutSlot=${slotPublicId}&checkoutSlot=${slotPublicId}#planes`,
        `${attributedReturnTo.replace('#planes', '')}&attrUtmSource=duplicate#planes`,
        `${attributedReturnTo.replace('#planes', '')}&attrLandingPath=https%3A%2F%2Fevil.example#planes`,
        `${attributedReturnTo.replace('#planes', '')}&attrUnknown=value#planes`,
        `/en/blog/example?checkoutSlot=${slotPublicId}#planes`,
        `/en/login?checkoutSlot=${slotPublicId}#planes`,
        `/en/campuses?checkoutSlot=${slotPublicId}#planes`,
        '/en/campus%2Fadmin',
        '/en/campus/%5Cevil',
        '/en/campus?filter=%0Aheader',
        `/fr?checkoutSlot=${slotPublicId}#planes`,
        `/en?checkoutSlot=${slotPublicId}%0A#planes`,
        `/en?checkoutSlot=${slotPublicId}#planes\u0000`,
        `/en?checkoutSlot=${slotPublicId}#planes${'x'.repeat(600)}`,
    ])('rejects every destination outside the authentication return contracts: %s', (input) => {
        expect(sanitizeAuthReturnTo(input)).toBeNull();
    });

    it.each([
        ['/es/campus/classes?view=upcoming', 'student', 'es', '/es/campus/classes?view=upcoming'],
        ['/es/campus/admin/packages', 'admin', 'es', '/es/campus/admin/packages'],
        ['/es/campus/teacher/calendar', 'teacher', 'es', '/es/campus/teacher/calendar'],
        ['/es/campus/account', 'admin', 'es', '/es/campus/account'],
        ['/es/campus/support', 'teacher', 'es', '/es/campus/support'],
        [returnTo, 'student', 'en', returnTo],
    ])('allows %s for the compatible %s role', (input, role, lang, expected) => {
        expect(resolveAuthReturnToForRole(input, role, lang)).toBe(expected);
    });

    it.each([
        ['/es/campus/admin', 'student', 'es'],
        ['/es/campus/teacher', 'student', 'es'],
        ['/es/campus/classes', 'admin', 'es'],
        ['/es/campus/admin', 'teacher', 'es'],
        ['/es/campus/teacher', 'admin', 'es'],
        ['/en/campus/classes', 'student', 'es'],
        [returnTo, 'teacher', 'en'],
        ['/es/campus', 'unexpected', 'es'],
    ])('rejects %s for the incompatible %s role or locale', (input, role, lang) => {
        expect(resolveAuthReturnToForRole(input, role, lang)).toBeNull();
    });

    it('appends one encoded destination without changing the internal base route', () => {
        expect(appendAuthReturnTo('/api/auth/post-login?lang=en', returnTo)).toBe(
            `/api/auth/post-login?lang=en&returnTo=${encodeURIComponent(returnTo)}`,
        );
        expect(appendAuthReturnTo('/en/login', null)).toBe('/en/login');
    });
});
