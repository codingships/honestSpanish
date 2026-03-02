import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';

const SITE = 'https://espanolhonesto.com';
const LANGS = ['es', 'en', 'ru'];

// Change frequency and priority by page type
const STATIC_PAGES = [
    // Landing pages
    { path: '/', changefreq: 'weekly', priority: '1.0' },
    // Legal
    { path: '/legal', changefreq: 'monthly', priority: '0.3' },
    { path: '/legal/privacidad', changefreq: 'monthly', priority: '0.3' },
    { path: '/legal/cookies', changefreq: 'monthly', priority: '0.3' },
    { path: '/legal/aviso-legal', changefreq: 'monthly', priority: '0.3' },
    // Blog index
    { path: '/blog', changefreq: 'weekly', priority: '0.8' },
];

function xmlEscape(str: string) {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export const GET: APIRoute = async () => {
    const blogPosts = await getCollection('blog');

    const urls: string[] = [];

    // 1. Static pages — one entry per language
    for (const { path, changefreq, priority } of STATIC_PAGES) {
        for (const lang of LANGS) {
            const loc = xmlEscape(`${SITE}/${lang}${path === '/' ? '' : path}`);
            urls.push(`
    <url>
        <loc>${loc}</loc>
        <changefreq>${changefreq}</changefreq>
        <priority>${priority}</priority>
    </url>`);
        }
    }

    // 2. Blog posts — one entry per language per post
    for (const post of blogPosts) {
        // post.id is like "en/my-slug.md" or "es/mi-slug.md"
        const [postLang, ...rest] = post.id.split('/');
        const slug = rest.join('/').replace(/\.md$/, '');
        const loc = xmlEscape(`${SITE}/${postLang}/blog/${slug}`);
        urls.push(`
    <url>
        <loc>${loc}</loc>
        <changefreq>monthly</changefreq>
        <priority>0.7</priority>
        <lastmod>${post.data.publishedAt ? new Date(post.data.publishedAt).toISOString().split('T')[0] : new Date().toISOString().split('T')[0]}</lastmod>
    </url>`);
    }

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.join('')}
</urlset>`;

    return new Response(xml, {
        headers: {
            'Content-Type': 'application/xml; charset=utf-8',
            'Cache-Control': 'public, max-age=3600', // 1 hour cache
        },
    });
};
