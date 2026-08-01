import { describe, expect, it } from 'vitest';
import {
    getBlogAlternatePaths,
    getPublishedBlogGroups,
    type BlogEntry,
} from '../../src/lib/blog-routes';
import {
    localizedPublicPath,
    normalizePublicPath,
    publicUrl,
    unlocalizePublicPath,
    type PublicLang,
} from '../../src/lib/public-seo';
import { buildPublicSitemap } from '../../src/lib/public-sitemap';

type PostOptions = {
    id: string;
    lang: PublicLang;
    translationKey?: string;
    draft?: boolean;
    publishedAt?: string;
};

function post({
    id,
    lang,
    translationKey,
    draft = false,
    publishedAt = '2025-01-15T00:00:00.000Z',
}: PostOptions): BlogEntry {
    return {
        id,
        data: {
            title: id,
            description: 'Description',
            publishedAt: new Date(publishedAt),
            author: 'alejandro',
            category: 'aprendizaje',
            tags: ['spanish'],
            lang,
            draft,
            translationKey,
        },
    };
}

const translatedPosts = [
    post({ id: 'es/cuanto-tiempo-hablar-espanol-fluido', lang: 'es', translationKey: 'time-to-fluency' }),
    post({ id: 'en/how-long-to-speak-spanish-fluently', lang: 'en', translationKey: 'time-to-fluency' }),
    post({ id: 'ru/how-long-to-speak-spanish-fluently', lang: 'ru', translationKey: 'time-to-fluency' }),
];

describe('public SEO contract', () => {
    it('normalizes one canonical representation for localized public URLs', () => {
        expect(normalizePublicPath('/blog/example/?utm_source=test')).toBe('/blog/example');
        expect(unlocalizePublicPath('/es/blog/example/')).toBe('/blog/example');
        expect(localizedPublicPath('es', '/')).toBe('/es');
        expect(publicUrl('ru', '/blog/example/')).toBe('https://espanolhonesto.com/ru/blog/example');
    });

    it('resolves reciprocal blog translations by translationKey rather than slug', () => {
        const groups = getPublishedBlogGroups(translatedPosts);

        expect(groups).toHaveLength(1);
        expect(getBlogAlternatePaths(translatedPosts[0], translatedPosts)).toEqual({
            es: '/blog/cuanto-tiempo-hablar-espanol-fluido',
            en: '/blog/how-long-to-speak-spanish-fluently',
            ru: '/blog/how-long-to-speak-spanish-fluently',
        });
    });

    it('fails the build for missing keys, duplicate translations or duplicate routes', () => {
        expect(() => getPublishedBlogGroups([
            post({ id: 'es/missing-key', lang: 'es' }),
        ])).toThrow('requires a non-empty translationKey');

        expect(() => getPublishedBlogGroups([
            post({ id: 'es/first', lang: 'es', translationKey: 'duplicate' }),
            post({ id: 'es/second', lang: 'es', translationKey: 'duplicate' }),
        ])).toThrow('Duplicate "es" translation');

        expect(() => getPublishedBlogGroups([
            post({ id: 'es/same-route', lang: 'es', translationKey: 'first' }),
            post({ id: 'es/same-route', lang: 'es', translationKey: 'second' }),
        ])).toThrow('Duplicate public blog route');
    });

    it('builds the announced allowlisted sitemap without drafts or private routes', () => {
        const xml = buildPublicSitemap([
            ...translatedPosts,
            post({
                id: 'es/not-public-yet',
                lang: 'es',
                translationKey: '',
                draft: true,
            }),
        ]);

        expect(xml).toContain('<loc>https://espanolhonesto.com/es</loc>');
        expect(xml).toContain('<loc>https://espanolhonesto.com/es/blog/cuanto-tiempo-hablar-espanol-fluido</loc>');
        expect(xml).toContain(
            'hreflang="en" href="https://espanolhonesto.com/en/blog/how-long-to-speak-spanish-fluently"',
        );
        expect(xml).toContain(
            'hreflang="x-default" href="https://espanolhonesto.com/en/blog/how-long-to-speak-spanish-fluently"',
        );
        expect(xml).not.toContain('not-public-yet');
        expect(xml).not.toMatch(/\/(?:api|campus|login|legal|success|cancel|demo)(?:\/|<)/u);
    });
});
