import { describe, expect, it } from 'vitest';
import {
    createCheckoutHoldFingerprint,
    normalizeCheckoutClientAddress,
} from '../../src/lib/checkout-hold-fingerprint';

const secret = '0123456789abcdef0123456789abcdef';

describe('checkout hold fingerprint', () => {
    it('canonicalizes equivalent IPv6 representations while preserving the individual address', async () => {
        expect(normalizeCheckoutClientAddress(' 2001:0DB8:0000:0000:1234:0000:0000:0001 '))
            .toBe('2001:db8::1234:0:0:1');
        expect(normalizeCheckoutClientAddress('2001:db8::1234:0:0:1'))
            .toBe('2001:db8::1234:0:0:1');

        const first = await createCheckoutHoldFingerprint({
            clientAddress: ' 2001:0DB8:0000:0000:1234:0000:0000:0001 ',
            secret,
        });
        const second = await createCheckoutHoldFingerprint({
            clientAddress: '2001:db8::1234:0:0:1',
            secret,
        });

        expect(first).toBe(second);
        expect(first).toMatch(/^v1:[0-9a-f]{64}$/u);
        expect(first).not.toContain('2001:db8');
    });

    it('groups different IPv6 addresses in the same /64 but separates different /64 prefixes', async () => {
        const first = await createCheckoutHoldFingerprint({
            clientAddress: '2001:db8:abcd:12::1',
            secret,
        });
        const sameNetwork = await createCheckoutHoldFingerprint({
            clientAddress: '2001:0db8:abcd:0012:ffff:eeee:dddd:cccc',
            secret,
        });
        const otherNetwork = await createCheckoutHoldFingerprint({
            clientAddress: '2001:db8:abcd:13::1',
            secret,
        });

        expect(first).toBe(sameNetwork);
        expect(first).not.toBe(otherNetwork);
    });

    it('keeps valid IPv4 addresses exact and separates different addresses and secrets', async () => {
        expect(normalizeCheckoutClientAddress(' 203.0.113.10 ')).toBe('203.0.113.10');

        const base = await createCheckoutHoldFingerprint({ clientAddress: '203.0.113.10', secret });
        const otherAddress = await createCheckoutHoldFingerprint({ clientAddress: '203.0.113.11', secret });
        const otherSecret = await createCheckoutHoldFingerprint({
            clientAddress: '203.0.113.10',
            secret: 'abcdef0123456789abcdef0123456789',
        });
        const mappedIpv6 = await createCheckoutHoldFingerprint({
            clientAddress: '::ffff:203.0.113.10',
            secret,
        });

        expect(base).not.toBe(otherAddress);
        expect(base).not.toBe(otherSecret);
        expect(base).toBe(mappedIpv6);
    });

    it('rejects missing or malformed IP addresses and secrets shorter than 32 bytes', async () => {
        for (const invalid of [
            '  ',
            '203.0.113.10\nforwarded',
            '203.0.113',
            '203.0.113.256',
            '203.0.113.010',
            'not-an-ip',
            '2001:db8:::1',
            'fe80::1%eth0',
        ]) expect(normalizeCheckoutClientAddress(invalid)).toBeNull();

        await expect(createCheckoutHoldFingerprint({
            clientAddress: '203.0.113.10',
            secret: 'too-short',
        })).resolves.toBeNull();
    });
});
