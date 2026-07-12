import { ui, defaultLang } from './translations';

export type SupportedLang = keyof typeof ui;

export function isSupportedLang(value: unknown): value is SupportedLang {
    return value === 'es' || value === 'en' || value === 'ru';
}

export function getLangFromParam(value: string | undefined): SupportedLang {
    return isSupportedLang(value) ? value : defaultLang;
}

export function getLangFromUrl(url: URL) {
    const [, lang] = url.pathname.split('/');
    return getLangFromParam(lang);
}

export function useTranslations(lang: SupportedLang) {
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
