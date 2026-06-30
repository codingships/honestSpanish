import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync('src/pages/[lang]/campus/support.astro', 'utf8');

describe('campus support page accessibility hooks', () => {
    it('keeps support report forms connected to live status messages', () => {
        expect(source).toContain('aria-describedby={statusId}');
        expect(source).toContain('aria-live="polite"');
        expect(source).toContain('role="status"');
    });

    it('moves focus into the free-text report form when a card is opened', () => {
        expect(source).toContain("form.querySelector('textarea[name=\"message\"]')");
        expect(source).toContain('requestAnimationFrame(() => textarea.focus())');
    });

    it('marks report forms busy while the alert is being sent', () => {
        expect(source).toContain("form.setAttribute('aria-busy', 'true')");
        expect(source).toContain("form.removeAttribute('aria-busy')");
    });
});
