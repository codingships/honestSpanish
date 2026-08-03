import { z } from 'zod';
import { ui } from '../i18n/translations';
import type { SupportedLang } from '../i18n/utils';

export const CMS_HOME_CONTENT_KEY = 'homepage';
export const CMS_HOME_LOCALES = ['es', 'en', 'ru'] as const;

const text = (maximum: number) => z.string().trim().min(1).max(maximum);

export const cmsHomeContentSchema = z.object({
    seo: z.object({
        title: text(100),
        description: text(320),
    }).strict(),
    nav: z.object({
        brand: text(80),
        method: text(40),
        progress: text(40),
        plans: text(40),
        team: text(40),
        faq: text(40),
        blog: text(40),
        login: text(40),
    }).strict(),
    hero: z.object({
        headline1: text(60),
        headline2: text(60),
        headline3: text(60),
        manifesto: text(160),
        subtitle: text(500),
        ready: text(100),
        cta: text(80),
    }).strict(),
    faq: z.object({
        headline: text(120),
        items: z.array(z.object({
            question: text(240),
            answer: text(2000),
        }).strict()).min(1).max(12),
    }).strict(),
}).strict();

export type CmsHomeContent = z.infer<typeof cmsHomeContentSchema>;
export type CmsHomeLocale = typeof CMS_HOME_LOCALES[number];

type HomeTranslationSource = {
    meta: { title: string; description: string };
    nav: CmsHomeContent['nav'];
    hero: CmsHomeContent['hero'];
    faq: {
        headline: string;
        items: ReadonlyArray<{ readonly question: string; readonly answer: string }>;
    };
};

export function getDefaultCmsHomeContent(lang: SupportedLang): CmsHomeContent {
    const source = ui[lang] as HomeTranslationSource;
    return cmsHomeContentSchema.parse({
        seo: {
            title: source.meta.title,
            description: source.meta.description,
        },
        nav: {
            brand: source.nav.brand,
            method: source.nav.method,
            progress: source.nav.progress,
            plans: source.nav.plans,
            team: source.nav.team,
            faq: source.nav.faq,
            blog: source.nav.blog,
            login: source.nav.login,
        },
        hero: { ...source.hero },
        faq: {
            headline: source.faq.headline,
            items: source.faq.items.map((item) => ({ ...item })),
        },
    });
}

export function parseCmsHomeContent(value: unknown): CmsHomeContent | null {
    const parsed = cmsHomeContentSchema.safeParse(value);
    return parsed.success ? parsed.data : null;
}

/** Merge the managed home subset into the existing translation function. */
export function createCmsHomeTranslator(
    fallback: (key: string) => unknown,
    content: CmsHomeContent,
) {
    const managedValues: Record<string, unknown> = {
        'meta.title': content.seo.title,
        'meta.description': content.seo.description,
        'nav.brand': content.nav.brand,
        'nav.method': content.nav.method,
        'nav.progress': content.nav.progress,
        'nav.plans': content.nav.plans,
        'nav.team': content.nav.team,
        'nav.faq': content.nav.faq,
        'nav.blog': content.nav.blog,
        'nav.login': content.nav.login,
        'hero.headline1': content.hero.headline1,
        'hero.headline2': content.hero.headline2,
        'hero.headline3': content.hero.headline3,
        'hero.manifesto': content.hero.manifesto,
        'hero.subtitle': content.hero.subtitle,
        'hero.ready': content.hero.ready,
        'hero.cta': content.hero.cta,
        'faq.headline': content.faq.headline,
        'faq.items': content.faq.items,
    };

    return (key: string): unknown => (
        Object.prototype.hasOwnProperty.call(managedValues, key)
            ? managedValues[key]
            : fallback(key)
    );
}
