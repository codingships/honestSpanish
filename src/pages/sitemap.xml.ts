import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';
import { buildPublicSitemap } from '../lib/public-sitemap';

export const prerender = true;

export const GET: APIRoute = async () => {
    const blogPosts = await getCollection('blog');
    const xml = buildPublicSitemap(blogPosts);

    return new Response(xml, {
        headers: {
            'Content-Type': 'application/xml; charset=utf-8',
            'Cache-Control': 'public, max-age=3600',
        },
    });
};
