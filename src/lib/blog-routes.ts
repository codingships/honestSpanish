import type { CollectionEntry } from 'astro:content';
import {
    PUBLIC_LANGS,
    type LocalizedPublicPaths,
    type PublicLang,
} from './public-seo';

export type BlogEntry = Pick<CollectionEntry<'blog'>, 'id' | 'data'>;
export type BlogLang = PublicLang;
export type BlogCategory = 'aprendizaje' | 'niveles' | 'expatriados' | 'cultura' | 'metodo';
export type BlogTranslationGroup = {
    translationKey: string;
    entries: Partial<Record<BlogLang, BlogEntry>>;
    paths: LocalizedPublicPaths;
};

const BLOG_LANGS = new Set<BlogLang>(['es', 'en', 'ru']);
const BLOG_CATEGORY_LABELS: Record<BlogLang, Record<BlogCategory, string>> = {
    es: {
        aprendizaje: 'Aprendizaje',
        niveles: 'Niveles',
        expatriados: 'Expatriados',
        cultura: 'Cultura',
        metodo: 'Método',
    },
    en: {
        aprendizaje: 'Learning',
        niveles: 'Levels',
        expatriados: 'Life in Spain',
        cultura: 'Culture',
        metodo: 'Method',
    },
    ru: {
        aprendizaje: 'Обучение',
        niveles: 'Уровни',
        expatriados: 'Жизнь в Испании',
        cultura: 'Культура',
        metodo: 'Методика',
    },
};

export function getBlogCategoryLabel(lang: BlogLang, category: BlogCategory): string {
    return BLOG_CATEGORY_LABELS[lang][category];
}

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

export function getBlogTranslationKey(entry: BlogEntry): string {
    const translationKey = entry.data.translationKey?.trim();
    if (!translationKey) {
        throw new Error('Published blog post "' + entry.id + '" requires a non-empty translationKey.');
    }

    return translationKey;
}

export function getPublishedBlogGroups(entries: readonly BlogEntry[]): BlogTranslationGroup[] {
    const groups = new Map<string, BlogTranslationGroup>();
    const routeOwners = new Map<string, string>();

    for (const entry of entries.filter(isPublishedBlogPost)) {
        const translationKey = getBlogTranslationKey(entry);
        const { lang, slug } = getBlogEntryParts(entry);
        if (!slug) throw new Error('Published blog post "' + entry.id + '" requires a route slug.');
        if (entry.data.lang !== lang) {
            throw new Error(
                'Published blog post "' + entry.id + '" declares lang "' + entry.data.lang
                + '" but resolves to "' + lang + '".',
            );
        }

        const route = '/' + lang + '/blog/' + slug;
        const routeOwner = routeOwners.get(route);
        if (routeOwner) {
            throw new Error('Duplicate public blog route "' + route + '" in "' + routeOwner + '" and "' + entry.id + '".');
        }
        routeOwners.set(route, entry.id);

        const group = groups.get(translationKey) ?? {
            translationKey,
            entries: {},
            paths: {},
        };
        const existingTranslation = group.entries[lang];
        if (existingTranslation) {
            throw new Error(
                'Duplicate "' + lang + '" translation for "' + translationKey + '": "'
                + existingTranslation.id + '" and "' + entry.id + '".',
            );
        }

        group.entries[lang] = entry;
        group.paths[lang] = '/blog/' + slug;
        groups.set(translationKey, group);
    }

    return [...groups.values()].sort((left, right) => (
        left.translationKey.localeCompare(right.translationKey)
    ));
}

export function getBlogTranslationGroup(
    entry: BlogEntry,
    entries: readonly BlogEntry[],
): BlogTranslationGroup {
    const translationKey = getBlogTranslationKey(entry);
    const group = getPublishedBlogGroups(entries).find((candidate) => (
        candidate.translationKey === translationKey
    ));

    if (!group) throw new Error('Missing published blog translation group for "' + entry.id + '".');
    return group;
}

export function getBlogAlternatePaths(
    entry: BlogEntry,
    entries: readonly BlogEntry[],
): LocalizedPublicPaths {
    return getBlogTranslationGroup(entry, entries).paths;
}

export function getRelatedBlogEntries(
    entry: BlogEntry,
    entries: readonly BlogEntry[],
): BlogEntry[] {
    const requestedKeys: readonly string[] = entry.data.relatedTranslationKeys ?? [];
    if (requestedKeys.length === 0) return [];

    const currentKey = getBlogTranslationKey(entry);
    const { lang } = getBlogEntryParts(entry);
    const groups = new Map(
        getPublishedBlogGroups(entries).map((group) => [group.translationKey, group]),
    );
    const seen = new Set<string>();

    return requestedKeys.map((requestedKey) => {
        const translationKey = requestedKey.trim();
        if (translationKey === currentKey) {
            throw new Error(
                'Blog post "' + entry.id + '" cannot relate to its own translationKey "'
                + translationKey + '".',
            );
        }
        if (seen.has(translationKey)) {
            throw new Error(
                'Blog post "' + entry.id + '" repeats related translationKey "'
                + translationKey + '".',
            );
        }
        seen.add(translationKey);

        const relatedGroup = groups.get(translationKey);
        if (!relatedGroup) {
            throw new Error(
                'Blog post "' + entry.id + '" references missing related translationKey "'
                + translationKey + '".',
            );
        }

        const relatedEntry = relatedGroup.entries[lang];
        if (!relatedEntry) {
            throw new Error(
                'Blog post "' + entry.id + '" references related translationKey "'
                + translationKey + '" without a published "' + lang + '" translation.',
            );
        }

        return relatedEntry;
    });
}

export function getBlogOgKey(entry: BlogEntry): string {
    const { lang, slug } = getBlogEntryParts(entry);
    return lang + '-' + slug;
}

export function orderedBlogLanguages(paths: LocalizedPublicPaths): BlogLang[] {
    return PUBLIC_LANGS.filter((lang) => Boolean(paths[lang]));
}
