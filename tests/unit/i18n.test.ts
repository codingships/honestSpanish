import { describe, it, expect } from 'vitest';
import { getLangFromUrl, useTranslations, getLocalizedPath } from '../../src/i18n/utils';

describe('getLangFromUrl', () => {
    it('returns es for /es/... URL', () => {
        expect(getLangFromUrl(new URL('http://localhost/es/campus'))).toBe('es');
    });

    it('returns en for /en/... URL', () => {
        expect(getLangFromUrl(new URL('http://localhost/en/campus'))).toBe('en');
    });

    it('returns ru for /ru/... URL', () => {
        expect(getLangFromUrl(new URL('http://localhost/ru/campus'))).toBe('ru');
    });

    it('returns default lang (es) for unknown lang segment', () => {
        expect(getLangFromUrl(new URL('http://localhost/fr/campus'))).toBe('es');
    });

    it('returns default lang (es) for root URL', () => {
        expect(getLangFromUrl(new URL('http://localhost/'))).toBe('es');
    });

    it('returns default lang (es) for URL with no lang segment', () => {
        expect(getLangFromUrl(new URL('http://localhost/campus'))).toBe('es');
    });
});

describe('useTranslations', () => {
    it('returns string value for a top-level key', () => {
        const t = useTranslations('es');
        // nav.brand is "ESPAÑOL HONESTO"
        const result = t('nav.brand');
        expect(typeof result).toBe('string');
        expect(result).not.toBe('nav.brand');
    });

    it('returns the key itself as fallback for nonexistent key', () => {
        const t = useTranslations('es');
        expect(t('this.key.does.not.exist')).toBe('this.key.does.not.exist');
    });

    it('returns the key if intermediate segment is missing', () => {
        const t = useTranslations('es');
        expect(t('nav.nonexistent.deep')).toBe('nav.nonexistent.deep');
    });

    it('returns correct value for nested campus.dashboard.title', () => {
        const t = useTranslations('es');
        expect(t('campus.dashboard.title')).toBe('Panel de control');
    });

    it('returns correct value for campus.nav.dashboard', () => {
        const t = useTranslations('es');
        expect(t('campus.nav.dashboard')).toBe('Panel');
    });

    it('returns correct value for auth.login', () => {
        const t = useTranslations('es');
        expect(t('auth.login')).toBe('Iniciar sesión');
    });

    it('works for English locale', () => {
        const tEs = useTranslations('es');
        const tEn = useTranslations('en');
        // Both should return strings, and they should differ for some keys
        const esResult = tEs('nav.brand');
        const enResult = tEn('nav.brand');
        expect(typeof esResult).toBe('string');
        expect(typeof enResult).toBe('string');
    });
});

describe('getLocalizedPath', () => {
    it('returns /lang for root path /', () => {
        expect(getLocalizedPath('/', 'es')).toBe('/es');
        expect(getLocalizedPath('/', 'en')).toBe('/en');
        expect(getLocalizedPath('/', 'ru')).toBe('/ru');
    });

    it('returns /lang/campus for /campus path', () => {
        expect(getLocalizedPath('/campus', 'es')).toBe('/es/campus');
    });

    it('returns /lang/path for any path with lang prefix', () => {
        expect(getLocalizedPath('/campus/classes', 'en')).toBe('/en/campus/classes');
    });

    it('prepends lang to nested paths', () => {
        expect(getLocalizedPath('/campus/admin/students', 'es')).toBe('/es/campus/admin/students');
    });
});
