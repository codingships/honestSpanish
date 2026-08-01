import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync('src/components/campus/CampusLoadError.astro', 'utf8');

describe('CampusLoadError accessibility contract', () => {
    it('announces the complete error without conflicting live-region semantics', () => {
        expect(source).toContain('role="alert"');
        expect(source).toContain('aria-atomic="true"');
        expect(source).not.toContain('aria-live=');
    });

    it('uses localized defaults while allowing contextual copy', () => {
        expect(source).toContain("title ?? t('campus.loadError.title')");
        expect(source).toContain("message ?? t('campus.loadError.message')");
        expect(source).toContain("t('campus.loadError.retry')");
    });

    it('retries the current localized URL by default and preserves its query', () => {
        expect(source).toContain('retryHref ?? `${Astro.url.pathname}${Astro.url.search}`');
        expect(source).toContain('href={resolvedRetryHref}');
    });

    it('exposes a visible keyboard focus treatment for the retry link', () => {
        expect(source).toContain('focus-visible:outline');
        expect(source).toContain('focus-visible:outline-4');
    });
});
