import { createReader } from '@keystatic/core/reader';
import { describe, expect, it } from 'vitest';
import keystaticConfig from '../../keystatic.config';

describe('Keystatic blog editor contract', () => {
    it('edits the real flat Markdown collections separately by language', () => {
        const collections = keystaticConfig.collections;
        expect(collections).toBeDefined();
        if (!collections) throw new Error('Missing Keystatic collections');

        expect(Object.keys(collections)).toEqual(['blogEs', 'blogEn', 'blogRu']);
        expect(collections.blogEs.path).toBe('src/content/blog/es/*');
        expect(collections.blogEn.path).toBe('src/content/blog/en/*');
        expect(collections.blogRu.path).toBe('src/content/blog/ru/*');

        for (const collection of Object.values(collections)) {
            expect(collection.format).toEqual({ contentField: 'content' });
            expect(collection.entryLayout).toBe('content');
            expect(Object.keys(collection.schema)).toEqual(expect.arrayContaining([
                'updatedAt',
                'draft',
                'translationKey',
                'relatedTranslationKeys',
                'ctaText',
                'ctaLink',
                'content',
            ]));
            expect(collection.schema.content).toMatchObject({
                kind: 'form',
                formKind: 'content',
                contentExtension: '.md',
            });
        }
    });

    it('creates new articles as drafts instead of publishing incomplete content', () => {
        const collections = keystaticConfig.collections;
        if (!collections) throw new Error('Missing Keystatic collections');

        for (const collection of Object.values(collections)) {
            const draftField = collection.schema.draft;
            expect(draftField.kind).toBe('form');
            if (draftField.kind !== 'form') throw new Error('Draft must be a form field');
            expect(draftField.defaultValue()).toBe(true);
        }
    });

    it('reads the current flat Markdown articles without changing their slugs or language', async () => {
        const reader = createReader(process.cwd(), keystaticConfig);
        const expected = {
            blogEs: {
                lang: 'es',
                slugs: [
                    'atascado-nivel-b1-espanol',
                    'cuanto-tiempo-hablar-espanol-fluido',
                    'espanol-expatriados-verdad',
                ],
            },
            blogEn: {
                lang: 'en',
                slugs: [
                    'how-long-to-speak-spanish-fluently',
                    'spanish-for-expats-truth',
                    'stuck-at-b1-spanish',
                ],
            },
            blogRu: {
                lang: 'ru',
                slugs: [
                    'how-long-to-speak-spanish-fluently',
                    'spanish-for-expats-truth',
                    'stuck-at-b1-spanish',
                ],
            },
        } as const;

        for (const collectionKey of Object.keys(expected) as Array<keyof typeof expected>) {
            const contract = expected[collectionKey];
            const collection = reader.collections[collectionKey];
            const slugs = await collection.list();
            expect(slugs).toEqual(expect.arrayContaining([...contract.slugs]));

            for (const slug of contract.slugs) {
                const article = await collection.read(slug);
                expect(article?.lang).toBe(contract.lang);
                expect(article?.draft).toBe(false);
            }
        }
    });
});
