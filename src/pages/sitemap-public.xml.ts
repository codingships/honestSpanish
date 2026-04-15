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
            
            const alternateLinks = LANGS.map(alternateLang => {
                const alternateLoc = xmlEscape(`${SITE}/${alternateLang}${path === '/' ? '' : path}`);
                return `\n        <xhtml:link rel="alternate" hreflang="${alternateLang}" href="${alternateLoc}" />`;
            }).join('');
            
            const defaultLoc = xmlEscape(`${SITE}/es${path === '/' ? '' : path}`);
            const xDefaultLink = `\n        <xhtml:link rel="alternate" hreflang="x-default" href="${defaultLoc}" />`;

            urls.push(`
    <url>
        <loc>${loc}</loc>${alternateLinks}${xDefaultLink}
        <changefreq>${changefreq}</changefreq>
        <priority>${priority}</priority>
    </url>`);
        }
    }

    // 2. Blog posts — Group by slug to cross-link translated versions
    const postsBySlug: Record<string, typeof blogPosts> = {};
    for (const post of blogPosts) {
        const [postLang, ...rest] = post.id.split('/');
        const slug = rest.join('/').replace(/\.md$/, '');
        if (!postsBySlug[slug]) postsBySlug[slug] = [];
        postsBySlug[slug].push(post);
    }

    for (const slug in postsBySlug) {
        const localizedPosts = postsBySlug[slug];
        
        for (const post of localizedPosts) {
            const [postLang] = post.id.split('/');
            const loc = xmlEscape(`${SITE}/${postLang}/blog/${slug}`);
            
            const alternateLinks = localizedPosts.map(p => {
                const [pLang] = p.id.split('/');
                const pLoc = xmlEscape(`${SITE}/${pLang}/blog/${slug}`);
                return `\n        <xhtml:link rel="alternate" hreflang="${pLang}" href="${pLoc}" />`;
            }).join('');
            
            const esPost = localizedPosts.find(p => p.id.startsWith('es/'));
            let xDefaultLink = '';
            if (esPost) {
                const defaultLoc = xmlEscape(`${SITE}/es/blog/${slug}`);
                xDefaultLink = `\n        <xhtml:link rel="alternate" hreflang="x-default" href="${defaultLoc}" />`;
            }

            urls.push(`
    <url>
        <loc>${loc}</loc>${alternateLinks}${xDefaultLink}
        <changefreq>monthly</changefreq>
        <priority>0.7</priority>
        <lastmod>${post.data.publishedAt ? new Date(post.data.publishedAt).toISOString().split('T')[0] : new Date().toISOString().split('T')[0]}</lastmod>
    </url>`);
        }
    }

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">${urls.join('')}
</urlset>`;

    return new Response(xml, {
        headers: {
            'Content-Type': 'application/xml; charset=utf-8',
            'Cache-Control': 'public, max-age=3600', // 1 hour cache
        },
    });
};
