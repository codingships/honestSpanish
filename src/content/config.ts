import { defineCollection, z } from 'astro:content';

const blog = defineCollection({
    type: 'content',
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
        translationKey: z.string().optional(), // para vincular traducciones del mismo artículo
    }),
});

export const collections = { blog };
