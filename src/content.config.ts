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
        publishedAt: z.date(),
        updatedAt: z.date().optional(),
        author: z.enum(['alejandro', 'alin', 'equipo']),
        category: z.enum(['aprendizaje', 'niveles', 'expatriados', 'cultura', 'metodo']),
        tags: z.array(z.string()),
        image: image().optional(),
        imageAlt: z.string().optional(),
        lang: z.enum(['es', 'en', 'ru']),
        draft: z.boolean().default(false),
        translationKey: z.string().optional(),
        ctaText: z.string().optional(),
        ctaLink: z.string().optional(),
    }),
});

export const collections = { blog };
