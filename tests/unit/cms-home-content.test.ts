import { describe, expect, it } from 'vitest';
import {
    CMS_HOME_LOCALES,
    createCmsHomeTranslator,
    getDefaultCmsHomeContent,
    parseCmsHomeContent,
} from '../../src/lib/cms-home-content';

describe('managed homepage content contract', () => {
    it.each(CMS_HOME_LOCALES)('derives a valid integrated fallback for %s', (locale) => {
        const content = getDefaultCmsHomeContent(locale);

        expect(content.seo.title).not.toHaveLength(0);
        expect(content.nav.blog).not.toHaveLength(0);
        expect(content.hero.cta).not.toHaveLength(0);
        expect(content.faq.items.length).toBeGreaterThan(0);
        expect(parseCmsHomeContent(content)).toEqual(content);
    });

    it('rejects malformed or over-broad payloads instead of publishing partial content', () => {
        const valid = getDefaultCmsHomeContent('en');

        expect(parseCmsHomeContent({ ...valid, unexpected: true })).toBeNull();
        expect(parseCmsHomeContent({
            ...valid,
            faq: { ...valid.faq, items: [] },
        })).toBeNull();
        expect(parseCmsHomeContent({
            ...valid,
            seo: { ...valid.seo, title: 'x'.repeat(101) },
        })).toBeNull();
    });

    it('overrides only the managed surface and preserves integrated translations elsewhere', () => {
        const content = getDefaultCmsHomeContent('en');
        content.hero.cta = 'Managed CTA';
        const fallback = (key: string) => `fallback:${key}`;
        const translate = createCmsHomeTranslator(fallback, content);

        expect(translate('hero.cta')).toBe('Managed CTA');
        expect(translate('method.headline')).toBe('fallback:method.headline');
    });
});
