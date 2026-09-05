import type { LandingPackage } from './landing-data';

const brandName = `Espa${String.fromCodePoint(0x00F1)}ol Honesto`;
const siteUrl = 'https://espanolhonesto.com';

const languageByLang = {
    es: 'es-ES',
    en: 'en-US',
    ru: 'ru-RU',
} as const;

const viewActionNameByLang = {
    es: 'Ver la oferta',
    en: 'View the offer',
    ru: 'Посмотреть предложение',
} as const;

function packageDescription(lang: 'es' | 'en' | 'ru', pkg: LandingPackage): string {
    return {
        es: `${pkg.sessions_per_month} clases individuales de 50 minutos por ciclo de 28 días; profesor y franja semanal identificados antes de pagar`,
        en: `${pkg.sessions_per_month} individual 50-minute classes per 28-day cycle; teacher and weekly time identified before payment`,
        ru: `${pkg.sessions_per_month} индивидуальных занятия по 50 минут за цикл из 28 дней; преподаватель и время известны до оплаты`,
    }[lang];
}

function courseNodes(
    lang: 'es' | 'en' | 'ru',
    packages: LandingPackage[],
    planNames: Record<string, { name?: string }>,
) {
    return packages.map((pkg) => ({
        '@type': 'Course',
        name: planNames[pkg.name]?.name || pkg.name,
        description: packageDescription(lang, pkg),
        inLanguage: languageByLang[lang],
        provider: {
            '@type': 'EducationalOrganization',
            name: brandName,
            url: siteUrl,
        },
        offers: {
            '@type': 'Offer',
            price: String(pkg.price_monthly / 100),
            priceCurrency: 'EUR',
            url: `${siteUrl}/${lang}#planes`,
        },
        potentialAction: {
            '@type': 'ViewAction',
            name: viewActionNameByLang[lang],
            target: `${siteUrl}/${lang}#planes`,
        },
        courseMode: 'online',
    }));
}

export function buildLandingSchema(
    lang: 'es' | 'en' | 'ru',
    translate: (key: string) => unknown,
    packages: LandingPackage[],
) {
    const faqItems = translate('faq.items') as Array<{ question: string; answer: string }>;

    return {
        '@context': 'https://schema.org',
        '@graph': [
            {
                '@type': 'WebSite',
                name: brandName,
                url: siteUrl,
                inLanguage: languageByLang[lang],
                publisher: {
                    '@type': 'EducationalOrganization',
                    name: brandName,
                },
            },
            {
                '@type': 'EducationalOrganization',
                name: brandName,
                description: translate('meta.description'),
                url: siteUrl,
                logo: `${siteUrl}/favicon.png`,
                address: {
                    '@type': 'PostalAddress',
                    addressLocality: 'Madrid',
                    addressCountry: 'ES',
                },
                email: 'alejandro@espanolhonesto.com',
                knowsAbout: [
                    'Spanish language',
                    'Spanish for expats',
                    'Spanish conversation',
                    'Spanish for professionals',
                ],
            },
            {
                '@type': 'FAQPage',
                mainEntity: faqItems.map((item) => ({
                    '@type': 'Question',
                    name: item.question,
                    acceptedAnswer: {
                        '@type': 'Answer',
                        text: item.answer,
                    },
                })),
            },
            ...courseNodes(
                lang,
                packages,
                translate('pricing.plans') as Record<string, { name?: string }>,
            ),
        ],
    };
}
