import type { CollectionEntry } from 'astro:content';

type BlogEntry = Pick<CollectionEntry<'blog'>, 'id' | 'data'>;
type BlogLang = 'es' | 'en' | 'ru';

const BLOG_LANGS = new Set<BlogLang>(['es', 'en', 'ru']);

function stripIndex(parts: string[]) {
    return parts.at(-1) === 'index' ? parts.slice(0, -1) : parts;
}

export function getBlogEntryParts(entry: BlogEntry): { lang: BlogLang; slug: string } {
    const parts = entry.id.split('/').filter(Boolean);
    const firstPart = parts[0] as BlogLang | undefined;

    if (firstPart && BLOG_LANGS.has(firstPart)) {
        return {
            lang: firstPart,
            slug: stripIndex(parts.slice(1)).join('/'),
        };
    }

    return {
        lang: entry.data.lang,
        slug: stripIndex(parts).join('/'),
    };
}

export function getBlogEntrySlug(entry: BlogEntry) {
    return getBlogEntryParts(entry).slug;
}

export function isPublishedBlogPost(entry: BlogEntry): boolean {
    return entry.data.draft !== true;
}
