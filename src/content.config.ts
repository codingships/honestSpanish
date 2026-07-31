import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

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
        ctaText: z.string().optional(),
        ctaLink: z.string().optional(),
    }).superRefine((entry, context) => {
        if (!entry.draft && !entry.translationKey) {
            context.addIssue({
                code: 'custom',
                path: ['translationKey'],
                message: 'Published posts require a non-empty translationKey.',
            });
        }
        if (entry.image && !entry.imageAlt) {
            context.addIssue({
                code: 'custom',
                path: ['imageAlt'],
                message: 'Posts with an image require imageAlt.',
            });
        }
    }),
});

export const collections = { blog };
