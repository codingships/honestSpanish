import { describe, expect, it } from 'vitest';
import { serializeJsonForHtml, sha256CspHash } from '../../src/lib/csp';

describe('CSP helpers', () => {
    it('produces the standard SHA-256 CSP digest for exact inline content', async () => {
        await expect(sha256CspHash('hello')).resolves.toBe(
            'sha256-LPJNul+wow4m6DsqxbninhsWHlwfp0JecwQzYpOLmCQ=',
        );
    });

    it('serializes JSON-LD without allowing a closing script tag', () => {
        const value = { label: '</script><script>alert(1)</script>' };
        const serialized = serializeJsonForHtml(value);

        expect(serialized).not.toContain('<');
        expect(JSON.parse(serialized)).toEqual(value);
    });

    it('rejects values that JSON cannot serialize', () => {
        expect(() => serializeJsonForHtml(undefined)).toThrow(
            'CSP JSON serialization requires a JSON-serializable value',
        );
    });
});
