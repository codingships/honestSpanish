import { ui, defaultLang } from './translations';

export function getLangFromUrl(url: URL) {
    const [, lang] = url.pathname.split('/');
    if (lang in ui) return lang as keyof typeof ui;
    return defaultLang;
}

export function useTranslations(lang: keyof typeof ui) {
    return function t(key: string) {
        const keys = key.split('.');
        let value: any = ui[lang];
        for (const k of keys) {
            if (value && typeof value === 'object' && k in value) {
                value = value[k as keyof typeof value];
            } else {
                return key; // Fallback to key if not found
            }
        }
        return value;
    }
}

export function getLocalizedPath(path: string, lang: string) {
    // If the path is just /, return /lang
    if (path === '/') return `/${lang}`;
    // Warning: this simple logic assumes path starts with /
    return `/${lang}${path}`;
}
