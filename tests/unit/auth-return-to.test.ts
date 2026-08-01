import { describe, expect, it } from 'vitest';
import { appendAuthReturnTo, sanitizeAuthReturnTo } from '../../src/lib/auth-return-to';

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
        `/en/campus?checkoutSlot=${slotPublicId}#planes`,
        `/fr?checkoutSlot=${slotPublicId}#planes`,
        `/en?checkoutSlot=${slotPublicId}%0A#planes`,
        `/en?checkoutSlot=${slotPublicId}#planes\u0000`,
        `/en?checkoutSlot=${slotPublicId}#planes${'x'.repeat(600)}`,
    ])('rejects every destination outside the one checkout return contract: %s', (input) => {
        expect(sanitizeAuthReturnTo(input)).toBeNull();
    });

    it('appends one encoded destination without changing the internal base route', () => {
        expect(appendAuthReturnTo('/api/auth/post-login?lang=en', returnTo)).toBe(
            `/api/auth/post-login?lang=en&returnTo=${encodeURIComponent(returnTo)}`,
        );
        expect(appendAuthReturnTo('/en/login', null)).toBe('/en/login');
    });
});
