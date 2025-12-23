import { defineCollection, z } from 'astro:content';

const blog = defineCollection({
    type: 'content',
    schema: z.object({
        title: z.string(),
        description: z.string(),
        publishedAt: z.date(),
        updatedAt: z.date().optional(),
        author: z.enum(['alejandro', 'alin']),
        category: z.enum(['aprendizaje', 'niveles', 'expatriados', 'cultura', 'metodo']),
        tags: z.array(z.string()),
        image: z.string().optional(),
        imageAlt: z.string().optional(),
        lang: z.enum(['es', 'en', 'ru']),
        translationKey: z.string(), // para vincular traducciones del mismo artículo
    }),
});

export const collections = { blog };
