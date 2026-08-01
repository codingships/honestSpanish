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
    post({ id: 'es/atascado-nivel-b1-espanol', lang: 'es', translationKey: 'stuck-at-b1' }),
    post({ id: 'en/stuck-at-b1-spanish', lang: 'en', translationKey: 'stuck-at-b1' }),
    post({ id: 'ru/stuck-at-b1-spanish', lang: 'ru', translationKey: 'stuck-at-b1' }),
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
            es: '/blog/atascado-nivel-b1-espanol',
            en: '/blog/stuck-at-b1-spanish',
            ru: '/blog/stuck-at-b1-spanish',
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
        expect(xml).toContain('<loc>https://espanolhonesto.com/es/blog/atascado-nivel-b1-espanol</loc>');
        expect(xml).toContain(
            'hreflang="en" href="https://espanolhonesto.com/en/blog/stuck-at-b1-spanish"',
        );
        expect(xml).toContain(
            'hreflang="x-default" href="https://espanolhonesto.com/en/blog/stuck-at-b1-spanish"',
        );
        expect(xml).not.toContain('not-public-yet');
        expect(xml).not.toMatch(/\/(?:api|campus|login|legal|success|cancel|demo)(?:\/|<)/u);
    });
});
