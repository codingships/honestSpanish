import type { LandingPackage } from './landing-data';

const brandName = `Espa${String.fromCodePoint(0x00F1)}ol Honesto`;
const siteUrl = 'https://espanolhonesto.com';

const languageByLang = {
    es: 'es-ES',
    en: 'en-US',
    ru: 'ru-RU',
} as const;

const applyActionNameByLang = {
    es: 'Solicitar plaza',
    en: 'Request a place',
    ru: 'Оставить заявку',
} as const;

function packageDescription(lang: 'es' | 'en' | 'ru', pkg: LandingPackage): string {
    const sessions = pkg.sessions_per_month;
    const isGroupOnly = pkg.name === 'group';
    const pieces = {
        es: [
            isGroupOnly ? `${sessions} sesiones grupales de conversacion al mes si hay grupo compatible` : `${sessions} clases privadas al mes`,
            !isGroupOnly && pkg.has_group_session ? 'conversacion grupal cuando haya compatibilidad' : null,
            pkg.has_dual_teacher ? 'seguimiento con dos profesores' : null,
            isGroupOnly ? 'grupo segun compatibilidad de nivel e intereses' : null,
        ],
        en: [
            isGroupOnly ? `${sessions} group conversation sessions per month when a compatible group exists` : `${sessions} private classes per month`,
            !isGroupOnly && pkg.has_group_session ? 'compatible group conversation when available' : null,
            pkg.has_dual_teacher ? 'two-teacher follow-up' : null,
            isGroupOnly ? 'group depends on compatible level and interests' : null,
        ],
        ru: [
            isGroupOnly ? `${sessions} групповых разговорных занятий в месяц при совместимой группе` : `${sessions} индивидуальных занятий в месяц`,
            !isGroupOnly && pkg.has_group_session ? 'групповая беседа при совместимости' : null,
            pkg.has_dual_teacher ? 'сопровождение двумя преподавателями' : null,
            isGroupOnly ? 'группа зависит от совместимого уровня и интересов' : null,
        ],
    }[lang].filter(Boolean);

    return pieces.join(', ');
}

function courseNodes(lang: 'es' | 'en' | 'ru', packages: LandingPackage[]) {
    return packages.map((pkg) => ({
        '@type': 'Course',
        name: pkg.display_name[lang] || pkg.display_name.es || pkg.name,
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
            availability: 'https://schema.org/InStock',
            url: `${siteUrl}/${lang}#contacto`,
        },
        potentialAction: {
            '@type': 'ApplyAction',
            name: applyActionNameByLang[lang],
            target: `${siteUrl}/${lang}#contacto`,
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
            ...courseNodes(lang, packages),
        ],
    };
}
