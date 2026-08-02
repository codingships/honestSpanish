import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { getBlogImagePresentation } from '../../src/lib/blog-images';
import {
    getBlogCategoryLabel,
    getRelatedBlogEntries,
    type BlogEntry,
} from '../../src/lib/blog-routes';
import type { PublicLang } from '../../src/lib/public-seo';

type PostOptions = {
    id: string;
    lang: PublicLang;
    translationKey: string;
    relatedTranslationKeys?: string[];
    draft?: boolean;
};

function post({
    id,
    lang,
    translationKey,
    relatedTranslationKeys,
    draft = false,
}: PostOptions): BlogEntry {
    return {
        id,
        data: {
            title: id,
            description: 'Description',
            publishedAt: new Date('2025-01-15T00:00:00.000Z'),
            author: 'alejandro',
            category: 'aprendizaje',
            tags: ['spanish'],
            lang,
            draft,
            translationKey,
            relatedTranslationKeys,
        },
    };
}

describe('blog related-content contract', () => {
    it('localizes every editorial category instead of exposing internal keys', () => {
        expect(getBlogCategoryLabel('es', 'aprendizaje')).toBe('Aprendizaje');
        expect(getBlogCategoryLabel('en', 'expatriados')).toBe('Life in Spain');
        expect(getBlogCategoryLabel('ru', 'niveles')).toBe('Уровни');
    });

    it('uses responsive generated covers by default and preserves a future safe override', () => {
        const generated = getBlogImagePresentation(post({
            id: 'en/how-long-to-speak-spanish-fluently',
            lang: 'en',
            translationKey: 'time-to-fluency',
        }));
        expect(generated).toEqual({
            src: '/og/en-how-long-to-speak-spanish-fluently.png',
            srcSet: '/og/en-how-long-to-speak-spanish-fluently-600.png 600w, /og/en-how-long-to-speak-spanish-fluently.png 1200w',
            alt: '',
            width: 1200,
            height: 630,
            generated: true,
        });

        const override = post({
            id: 'en/custom',
            lang: 'en',
            translationKey: 'custom',
        });
        override.data.image = {
            src: '/_astro/custom.hash.webp',
            width: 800,
            height: 450,
            format: 'webp',
        };
        override.data.imageAlt = 'A real class in progress';
        expect(getBlogImagePresentation(override)).toMatchObject({
            src: '/_astro/custom.hash.webp',
            alt: 'A real class in progress',
            width: 800,
            height: 450,
            generated: false,
        });
    });

    it('keeps the editorial order and selects only the current language', () => {
        const current = post({
            id: 'en/how-long-to-speak-spanish-fluently',
            lang: 'en',
            translationKey: 'time-to-fluency',
            relatedTranslationKeys: ['stuck-at-b1', 'expats-truth'],
        });
        const entries = [
            current,
            post({ id: 'es/atascado-nivel-b1-espanol', lang: 'es', translationKey: 'stuck-at-b1' }),
            post({ id: 'en/stuck-at-b1-spanish', lang: 'en', translationKey: 'stuck-at-b1' }),
            post({ id: 'es/espanol-expatriados-verdad', lang: 'es', translationKey: 'expats-truth' }),
            post({ id: 'en/spanish-for-expats-truth', lang: 'en', translationKey: 'expats-truth' }),
        ];

        expect(getRelatedBlogEntries(current, entries).map((entry) => entry.id)).toEqual([
            'en/stuck-at-b1-spanish',
            'en/spanish-for-expats-truth',
        ]);
    });

    it('fails fast for self-links, duplicates and missing published targets', () => {
        const base = {
            id: 'es/cuanto-tiempo-hablar-espanol-fluido',
            lang: 'es' as const,
            translationKey: 'time-to-fluency',
        };

        const selfLinked = post({ ...base, relatedTranslationKeys: ['time-to-fluency'] });
        expect(() => getRelatedBlogEntries(selfLinked, [selfLinked])).toThrow(
            'cannot relate to its own translationKey',
        );

        const duplicated = post({ ...base, relatedTranslationKeys: ['stuck-at-b1', 'stuck-at-b1'] });
        const b1 = post({ id: 'es/atascado-nivel-b1-espanol', lang: 'es', translationKey: 'stuck-at-b1' });
        expect(() => getRelatedBlogEntries(duplicated, [duplicated, b1])).toThrow(
            'repeats related translationKey',
        );

        const missing = post({ ...base, relatedTranslationKeys: ['unpublished'] });
        const draft = post({
            id: 'es/unpublished',
            lang: 'es',
            translationKey: 'unpublished',
            draft: true,
        });
        expect(() => getRelatedBlogEntries(missing, [missing, draft])).toThrow(
            'references missing related translationKey',
        );
    });

    it('fails when a related group lacks a published translation in the current language', () => {
        const current = post({
            id: 'ru/how-long-to-speak-spanish-fluently',
            lang: 'ru',
            translationKey: 'time-to-fluency',
            relatedTranslationKeys: ['expats-truth'],
        });
        const spanishOnly = post({
            id: 'es/espanol-expatriados-verdad',
            lang: 'es',
            translationKey: 'expats-truth',
        });

        expect(() => getRelatedBlogEntries(current, [current, spanishOnly])).toThrow(
            'without a published "ru" translation',
        );
    });

    it('keeps every published article connected to localized related content and a CTA', () => {
        const publicArticlePaths = [
            'src/content/blog/es/cuanto-tiempo-hablar-espanol-fluido.md',
            'src/content/blog/en/how-long-to-speak-spanish-fluently.md',
            'src/content/blog/ru/how-long-to-speak-spanish-fluently.md',
            'src/content/blog/es/atascado-nivel-b1-espanol.md',
            'src/content/blog/en/stuck-at-b1-spanish.md',
            'src/content/blog/ru/stuck-at-b1-spanish.md',
            'src/content/blog/es/espanol-expatriados-verdad.md',
            'src/content/blog/en/spanish-for-expats-truth.md',
            'src/content/blog/ru/spanish-for-expats-truth.md',
        ];

        for (const articlePath of publicArticlePaths) {
            const article = readFileSync(resolve(articlePath), 'utf8');
            expect(article, articlePath).toMatch(/^updatedAt: 2026-08-02$/mu);
            expect(article, articlePath).toMatch(/^draft: false$/mu);
            expect(article, articlePath).toMatch(/^relatedTranslationKeys: \["[^"]+", "[^"]+"\]$/mu);
            expect(article, articlePath).toMatch(/^ctaText: ".+"$/mu);
            expect(article, articlePath).toMatch(/^ctaLink: "\/"$/mu);
            expect(article, articlePath).not.toMatch(/^image(?:Alt)?:/mu);
        }
    });

    it('uses existing localized translation keys in the related-content UI', () => {
        const layout = readFileSync(resolve('src/layouts/BlogLayout.astro'), 'utf8');
        expect(layout).toContain("t('common.related')");
        expect(layout).toContain("t('common.readMore')");
        expect(layout).not.toContain("t('blog.related')");
        expect(layout).not.toContain("t('blog.readMore')");
    });

    it('keeps image-only card links named and propagates commercial Markdown links', () => {
        const index = readFileSync(resolve('src/pages/[lang]/blog/index.astro'), 'utf8');
        const baseLayout = readFileSync(resolve('src/layouts/BaseLayout.astro'), 'utf8');
        const blogLayout = readFileSync(resolve('src/layouts/BlogLayout.astro'), 'utf8');
        const continuity = readFileSync(
            resolve('src/components/blog/BlogAttributionContinuity.astro'),
            'utf8',
        );
        expect(index).toContain('aria-label={post.data.title}');
        expect(index).toContain('ogImage={`/og/${lang}-blog.png`}');
        expect(index).toContain("loading={index === 0 ? 'eager' : 'lazy'}");
        expect(index).toContain("fetchpriority={index === 0 ? 'high' : undefined}");
        expect(baseLayout).toContain('<meta property="og:image:alt" content={resolvedOgImageAlt} />');
        expect(baseLayout).toContain('<meta name="twitter:image:alt" content={resolvedOgImageAlt} />');
        expect(blogLayout).toContain('ogImageAlt={articleImage.alt || title}');
        expect(continuity).toContain('.prose a[href^="/"]');

        for (const articlePath of [
            'src/content/blog/es/cuanto-tiempo-hablar-espanol-fluido.md',
            'src/content/blog/en/how-long-to-speak-spanish-fluently.md',
            'src/content/blog/ru/how-long-to-speak-spanish-fluently.md',
        ]) {
            expect(readFileSync(resolve(articlePath), 'utf8'), articlePath).toMatch(/\]\(\/(?:es|en|ru)\/#(?:planes|contacto)\)/u);
        }
    });

    it('states the renewal and pre-payment schedule consistently in the commercial summaries', () => {
        const summaries = [
            {
                paths: [
                    'src/content/blog/es/cuanto-tiempo-hablar-espanol-fluido.md',
                    'src/content/blog/es/atascado-nivel-b1-espanol.md',
                    'src/content/blog/es/espanol-expatriados-verdad.md',
                ],
                patterns: [
                    /259 € al reservar/u,
                    /se renueva automáticamente/u,
                    /28 días después de la primera clase/u,
                    /las cuatro fechas previstas/u,
                    /la fecha exacta del siguiente cobro/u,
                    /mediante autoservicio dentro del plazo permitido/u,
                    /soporte fuera de ese plazo no mueve automáticamente el ancla/u,
                    /cuando comienza la primera clase, queda fija/u,
                ],
            },
            {
                paths: [
                    'src/content/blog/en/how-long-to-speak-spanish-fluently.md',
                    'src/content/blog/en/stuck-at-b1-spanish.md',
                    'src/content/blog/en/spanish-for-expats-truth.md',
                ],
                patterns: [
                    /€259 when booking/u,
                    /renews automatically/u,
                    /28 days after the first class/u,
                    /all four planned dates/u,
                    /the exact next-charge date/u,
                    /through self-service within the permitted window/u,
                    /support change outside that window does not move the anchor automatically/u,
                    /fixed when the first class begins/u,
                ],
            },
            {
                paths: [
                    'src/content/blog/ru/how-long-to-speak-spanish-fluently.md',
                    'src/content/blog/ru/stuck-at-b1-spanish.md',
                    'src/content/blog/ru/spanish-for-expats-truth.md',
                ],
                patterns: [
                    /При бронировании списывается 259 €/u,
                    /продлевается автоматически/u,
                    /через 28 дней после первого занятия/u,
                    /все четыре запланированные даты/u,
                    /точную дату следующего списания/u,
                    /через личный кабинет в разрешённый срок/u,
                    /поддержку вне этого срока не сдвигает якорную дату автоматически/u,
                    /фиксируется с началом первого занятия/u,
                ],
            },
        ];

        for (const { paths, patterns } of summaries) {
            for (const articlePath of paths) {
                const article = readFileSync(resolve(articlePath), 'utf8');
                for (const pattern of patterns) expect(article, articlePath).toMatch(pattern);
            }
        }
    });
});
