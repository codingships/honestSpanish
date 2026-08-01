import type { BlogEntry } from './blog-routes';
import { getPublishedBlogGroups } from './blog-routes';
import {
    PUBLIC_LANGS,
    publicUrl,
    type LocalizedPublicPaths,
    type PublicLang,
} from './public-seo';

type SitemapGroup = {
    paths: LocalizedPublicPaths;
    lastModifiedByLang?: Partial<Record<PublicLang, Date>>;
};

const STATIC_GROUPS: readonly SitemapGroup[] = [
    { paths: { es: '/', en: '/', ru: '/' } },
    { paths: { es: '/blog', en: '/blog', ru: '/blog' } },
    { paths: { es: '/espanol-para-vivir-en-espana' } },
    { paths: { es: '/espanol-para-profesionales' } },
    { paths: { es: '/clases-de-conversacion-en-espanol' } },
];

function xmlEscape(value: string): string {
    return value
        .replace(/&/gu, '&amp;')
        .replace(/</gu, '&lt;')
        .replace(/>/gu, '&gt;')
        .replace(/"/gu, '&quot;')
        .replace(/'/gu, '&apos;');
}

function publishedDate(entry: BlogEntry): Date {
    return entry.data.updatedAt ?? entry.data.publishedAt;
}

function blogGroups(entries: readonly BlogEntry[]): SitemapGroup[] {
    return getPublishedBlogGroups(entries).map((group) => {
        const lastModifiedByLang: Partial<Record<PublicLang, Date>> = {};
        for (const lang of PUBLIC_LANGS) {
            const entry = group.entries[lang];
            if (entry) lastModifiedByLang[lang] = publishedDate(entry);
        }

        return { paths: group.paths, lastModifiedByLang };
    });
}

function renderUrl(group: SitemapGroup, lang: PublicLang): string {
    const path = group.paths[lang];
    if (!path) throw new Error('Cannot render a sitemap URL without a localized path.');

    const alternateLinks = PUBLIC_LANGS.flatMap((alternateLang) => {
        const alternatePath = group.paths[alternateLang];
        return alternatePath
            ? ['        <xhtml:link rel="alternate" hreflang="' + alternateLang
                + '" href="' + xmlEscape(publicUrl(alternateLang, alternatePath)) + '" />']
            : [];
    });
    const defaultPath = group.paths.en;
    if (defaultPath) {
        alternateLinks.push(
            '        <xhtml:link rel="alternate" hreflang="x-default" href="'
            + xmlEscape(publicUrl('en', defaultPath)) + '" />',
        );
    }

    const lastModified = group.lastModifiedByLang?.[lang];
    const lines = [
        '    <url>',
        '        <loc>' + xmlEscape(publicUrl(lang, path)) + '</loc>',
        ...alternateLinks,
        ...(lastModified ? ['        <lastmod>' + lastModified.toISOString().slice(0, 10) + '</lastmod>'] : []),
        '    </url>',
    ];

    return lines.join('\n');
}

export function buildPublicSitemap(entries: readonly BlogEntry[]): string {
    const groups = [...STATIC_GROUPS, ...blogGroups(entries)];
    const urls = groups.flatMap((group) => (
        PUBLIC_LANGS.flatMap((lang) => group.paths[lang] ? [renderUrl(group, lang)] : [])
    ));

    return [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">',
        ...urls,
        '</urlset>',
    ].join('\n');
}
