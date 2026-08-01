import { describe, expect, it, vi } from 'vitest';
import {
    appendAcquisitionAttribution,
    captureAcquisitionAttribution,
    readAcquisitionAttributionFromSearchParams,
    sanitizeAcquisitionAttribution,
} from '../../src/lib/acquisition-attribution';

const requestId = '10000000-0000-4000-8000-000000000001';
const nextRequestId = '20000000-0000-4000-8000-000000000002';
const createRequestId = () => requestId;

describe('acquisition attribution', () => {
    it.each([
        ['', { referrerKind: 'direct' }],
        ['https://espanolhonesto.com/en/blog/moving', {
            referrerKind: 'internal',
            referrerPath: '/en/blog/moving',
        }],
        ['https://www.google.com/search?q=private', {
            referrerKind: 'external',
            referrerHost: 'www.google.com',
        }],
    ])('captures a minimal %s referrer without its query', (referrer, expected) => {
        expect(captureAcquisitionAttribution('en', {
            href: 'https://espanolhonesto.com/en?utm_source=google&utm_medium=cpc&utm_campaign=Move_To_Spain',
            referrer,
            requestId: createRequestId,
        })).toEqual(expect.objectContaining({
            requestId,
            landingPath: '/en',
            entryLanguage: 'en',
            utmSource: 'google',
            utmMedium: 'cpc',
            utmCampaign: 'Move_To_Spain',
            ...expected,
        }));
    });

    it.each([
        ['email-shaped UTM', 'https://espanolhonesto.com/en?utm_campaign=person%40example.com'],
        ['URL-shaped UTM', 'https://espanolhonesto.com/en?utm_source=https%3A%2F%2Ftracker.example'],
        ['control character', 'https://espanolhonesto.com/en?utm_medium=line%0Abreak'],
        ['overlength UTM', `https://espanolhonesto.com/en?utm_source=${'x'.repeat(101)}`],
        ['duplicate UTM', 'https://espanolhonesto.com/en?utm_source=one&utm_source=two'],
    ])('omits the entire envelope for an invalid %s', (_label, href) => {
        expect(captureAcquisitionAttribution('en', {
            href,
            requestId: createRequestId,
        })).toBeNull();
    });

    it('normalizes accepted campaign values with NFKC', () => {
        expect(captureAcquisitionAttribution('es', {
            href: 'https://espanolhonesto.com/es?utm_campaign=%EF%BC%A1_B',
            requestId: createRequestId,
        })?.utmCampaign).toBe('A_B');
    });

    it('round-trips only a valid, internally named envelope', () => {
        const attribution = captureAcquisitionAttribution('ru', {
            href: 'https://espanolhonesto.com/ru?utm_source=pilot',
            referrer: 'https://partner.example/path?identity=private',
            requestId: createRequestId,
        });
        expect(attribution).not.toBeNull();

        const params = new URLSearchParams();
        expect(appendAcquisitionAttribution(params, attribution!)).toBe(true);
        expect(readAcquisitionAttributionFromSearchParams(params)).toEqual(attribution);

        params.append('attrRequestId', requestId);
        expect(readAcquisitionAttributionFromSearchParams(params)).toBeNull();
    });

    it('uses a fresh operation UUID while preserving propagated origin data after login', () => {
        const params = new URLSearchParams();
        appendAcquisitionAttribution(params, {
            requestId,
            landingPath: '/en',
            referrerKind: 'external',
            referrerHost: 'www.google.com',
            entryLanguage: 'en',
            utmCampaign: 'move_to_spain',
        });

        expect(captureAcquisitionAttribution('en', {
            href: `https://espanolhonesto.com/en?${params.toString()}`,
            requestId: () => nextRequestId,
        })).toEqual({
            requestId: nextRequestId,
            landingPath: '/en',
            referrerKind: 'external',
            referrerHost: 'www.google.com',
            entryLanguage: 'en',
            utmCampaign: 'move_to_spain',
        });
    });

    it.each([
        'https://espanolhonesto.com/en/campus/admin/crm/contact/10000000-0000-4000-8000-000000000001',
        'https://espanolhonesto.com/en/blog/10000000-0000-4000-8000-000000000001',
        'https://espanolhonesto.com/api/auth/confirm',
    ])('redacts a private or dynamic same-origin referrer: %s', (referrer) => {
        expect(captureAcquisitionAttribution('en', {
            href: 'https://espanolhonesto.com/en',
            referrer,
            requestId: createRequestId,
        })).toMatchObject({
            referrerKind: 'internal',
            referrerPath: '/internal',
        });
    });

    it('rejects unexpected fields instead of retaining excess data', () => {
        expect(sanitizeAcquisitionAttribution({
            requestId,
            landingPath: '/en',
            referrerKind: 'direct',
            entryLanguage: 'en',
            clickId: 'not-allowed',
        })).toBeNull();
    });

    it.each(['/en/%0Aprivate', '/en/%3Fprivate', '/en/%23private', '/en/%5Cprivate'])(
        'rejects a path that becomes unsafe only after decoding: %s',
        (landingPath) => {
            expect(sanitizeAcquisitionAttribution({
                requestId,
                landingPath,
                referrerKind: 'direct',
                entryLanguage: 'en',
            })).toBeNull();
        },
    );

    it.each([
        '/en/10000000-0000-4000-8000-000000000001',
        '/en/0123456789abcdef0123456789abcdef',
        '/en/aB3dEfGhIjKlMnOpQrStUvWxYz012345',
    ])('rejects an identifier-like landing path rather than retaining it: %s', (landingPath) => {
        expect(sanitizeAcquisitionAttribution({
            requestId,
            landingPath,
            referrerKind: 'direct',
            entryLanguage: 'en',
        })).toBeNull();
    });

    it('never reads browser storage and degrades to null when UUID creation fails', () => {
        const localStorageSpy = vi.spyOn(Storage.prototype, 'getItem');
        const sessionStorageSpy = vi.spyOn(Storage.prototype, 'getItem');

        expect(captureAcquisitionAttribution('en', {
            href: 'https://espanolhonesto.com/en',
            requestId: () => { throw new Error('crypto unavailable'); },
        })).toBeNull();
        expect(localStorageSpy).not.toHaveBeenCalled();
        expect(sessionStorageSpy).not.toHaveBeenCalled();
    });
});
