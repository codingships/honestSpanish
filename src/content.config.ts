import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

function isSafeBlogCtaLink(value: string): boolean {
    if (value.startsWith('/')) {
        return !value.startsWith('//')
            && !value.includes('\\')
            && !value.includes('?')
            && !value.includes('#')
            && !/^\/(?:es|en|ru)(?:\/|$)/u.test(value);
    }

    try {
        return new URL(value).protocol === 'https:';
    } catch {
        return false;
    }
}

const blog = defineCollection({
    loader: glob({
        pattern: '**/*.{md,mdoc}',
        base: './src/content/blog',
    }),
    schema: ({ image }) => z.object({
        title: z.string(),
        description: z.string(),
        publishedAt: z.coerce.date(),
        updatedAt: z.coerce.date().optional(),
        author: z.enum(['alejandro', 'alin', 'equipo']),
        category: z.enum(['aprendizaje', 'niveles', 'expatriados', 'cultura', 'metodo']),
        tags: z.array(z.string()),
        image: image().optional(),
        imageAlt: z.string().trim().optional(),
        lang: z.enum(['es', 'en', 'ru']),
        draft: z.boolean().default(false),
        translationKey: z.string().trim().optional(),
        relatedTranslationKeys: z.array(z.string().trim().min(1)).max(3).refine(
            (keys) => new Set(keys).size === keys.length,
            { message: 'Related translation keys must be unique.' },
        ).optional(),
        ctaText: z.string().trim().max(120).optional(),
        ctaLink: z.string().trim().max(300).refine(isSafeBlogCtaLink, {
            message: 'CTA links must be an unlocalized internal path or an HTTPS URL.',
        }).optional(),
    }).superRefine((entry, context) => {
        if (!entry.draft && !entry.translationKey) {
            context.addIssue({
                code: 'custom',
                path: ['translationKey'],
                message: 'Published posts require a non-empty translationKey.',
            });
        }
        if (!entry.draft && !entry.relatedTranslationKeys?.length) {
            context.addIssue({
                code: 'custom',
                path: ['relatedTranslationKeys'],
                message: 'Published posts require at least one localized related article.',
            });
        }
        if (!entry.draft && !entry.ctaText) {
            context.addIssue({
                code: 'custom',
                path: ['ctaText'],
                message: 'Published posts require localized CTA text.',
            });
        }
        if (!entry.draft && !entry.ctaLink) {
            context.addIssue({
                code: 'custom',
                path: ['ctaLink'],
                message: 'Published posts require a safe CTA destination.',
            });
        }
        if (Boolean(entry.ctaText) !== Boolean(entry.ctaLink)) {
            context.addIssue({
                code: 'custom',
                path: entry.ctaText ? ['ctaLink'] : ['ctaText'],
                message: 'CTA text and destination must be provided together.',
            });
        }
        if (entry.image && !entry.imageAlt) {
            context.addIssue({
                code: 'custom',
                path: ['imageAlt'],
                message: 'Posts with an image require imageAlt.',
            });
        }
        if (!entry.image && entry.imageAlt) {
            context.addIssue({
                code: 'custom',
                path: ['imageAlt'],
                message: 'Image alt text cannot exist without an image override.',
            });
        }
    }),
});

export const collections = { blog };
