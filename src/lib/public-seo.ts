export const SITE_ORIGIN = 'https://espanolhonesto.com';
export const PUBLIC_LANGS = ['es', 'en', 'ru'] as const;

export type PublicLang = (typeof PUBLIC_LANGS)[number];
export type LocalizedPublicPaths = Partial<Record<PublicLang, string>>;

export function isPublicLang(value: string | undefined): value is PublicLang {
    return PUBLIC_LANGS.some((lang) => lang === value);
}

export function normalizePublicPath(path: string): string {
    const pathname = path.split(/[?#]/u, 1)[0] || '/';
    const withLeadingSlash = pathname.startsWith('/') ? pathname : '/' + pathname;
    const withoutDuplicateSlashes = withLeadingSlash.replace(/\/{2,}/gu, '/');

    return withoutDuplicateSlashes === '/'
        ? '/'
        : withoutDuplicateSlashes.replace(/\/+$/u, '');
}

export function unlocalizePublicPath(path: string): string {
    const normalized = normalizePublicPath(path);
    const withoutLanguage = normalized.replace(/^\/(?:es|en|ru)(?=\/|$)/u, '');

    return normalizePublicPath(withoutLanguage || '/');
}

export function localizedPublicPath(lang: PublicLang, path: string): string {
    const normalized = normalizePublicPath(path);
    return normalized === '/' ? '/' + lang : '/' + lang + normalized;
}

export function publicUrl(lang: PublicLang, path: string): string {
    return SITE_ORIGIN + localizedPublicPath(lang, path);
}

export function absolutePublicUrl(pathOrUrl: string): string {
    if (/^https?:\/\//u.test(pathOrUrl)) return pathOrUrl;
    return SITE_ORIGIN + normalizePublicPath(pathOrUrl);
}
