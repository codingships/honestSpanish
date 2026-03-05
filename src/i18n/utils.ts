import { ui, defaultLang } from './translations';



export function getLangFromUrl(url: URL) {
    const [, lang] = url.pathname.split('/');
    if (lang in ui) return lang as keyof typeof ui;
    return defaultLang;
}

export function useTranslations(lang: keyof typeof ui) {
    return function t(key: string) {
        const keys = key.split('.');
        let value: unknown = ui[lang];
        for (const k of keys) {
            if (value && typeof value === 'object' && k in (value as object)) {
                value = (value as Record<string, unknown>)[k];
            } else {
                return key;
            }
        }
        return value as string;
    }
}

export function getLocalizedPath(path: string, lang: string) {
    // If the path is just /, return /lang
    if (path === '/') return `/${lang}`;
    // Warning: this simple logic assumes path starts with /
    return `/${lang}${path}`;
}
