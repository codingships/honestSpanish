import { describe, expect, it } from 'vitest';
import { normalizeDisplayName, type LandingPackage } from '../../src/lib/landing-data';
import { buildLandingSchema } from '../../src/lib/landing-schema';

const targetPackage: LandingPackage = {
    id: 'pkg-individual-4x50-28d',
    name: 'individual_4x50_28d',
    display_name: {
        es: '4 clases individuales',
        en: '4 individual classes',
        ru: '4 индивидуальных занятия',
    },
    price_monthly: 25900,
    sessions_per_month: 4,
    has_group_session: false,
    has_dual_teacher: false,
    stripe_price_1m: null,
    stripe_price_3m: null,
    stripe_price_6m: null,
};

const translate = (key: string): unknown => {
    if (key === 'meta.description') return 'Spanish classes for real life.';
    if (key === 'faq.items') {
        return [
            { question: 'How do classes work?', answer: 'Online, with live practice and follow-up.' },
        ];
    }
    return '';
};

function courseNodes(schema: ReturnType<typeof buildLandingSchema>) {
    return schema['@graph'].filter((node) => node['@type'] === 'Course');
}

function faqNode(schema: ReturnType<typeof buildLandingSchema>) {
    return schema['@graph'].find((node) => node['@type'] === 'FAQPage');
}

describe('normalizeDisplayName', () => {
    it('normalizes localized JSON display names with fallbacks', () => {
        expect(normalizeDisplayName({ es: 'Individual', en: 'Individual' }, 'individual_4x50_28d')).toEqual({
            es: 'Individual',
            en: 'Individual',
            ru: 'individual_4x50_28d',
        });
    });

    it('falls back when display_name is not an object', () => {
        expect(normalizeDisplayName(null, 'individual_4x50_28d')).toEqual({
            es: 'individual_4x50_28d',
            en: 'individual_4x50_28d',
            ru: 'individual_4x50_28d',
        });
    });
});

describe('buildLandingSchema', () => {
    it('publishes the exact target offer as unavailable until checkout is ready', () => {
        const course = courseNodes(buildLandingSchema('es', translate, [targetPackage]))[0];

        expect(course).toMatchObject({
            '@type': 'Course',
            name: '4 clases individuales',
            description: '4 clases individuales de 50 minutos por ciclo de 28 días; profesor y franja semanal identificados antes de pagar',
            inLanguage: 'es-ES',
            offers: {
                price: '259',
                priceCurrency: 'EUR',
                availability: 'https://schema.org/OutOfStock',
                url: 'https://espanolhonesto.com/es#planes',
            },
            potentialAction: {
                '@type': 'ViewAction',
                name: 'Ver la oferta',
                target: 'https://espanolhonesto.com/es#planes',
            },
        });
    });

    it('localizes the offer without changing its commercial contract', () => {
        const enCourse = courseNodes(buildLandingSchema('en', translate, [targetPackage]))[0];
        const ruCourse = courseNodes(buildLandingSchema('ru', translate, [targetPackage]))[0];

        expect(enCourse).toMatchObject({
            name: '4 individual classes',
            description: '4 individual 50-minute classes per 28-day cycle; teacher and weekly time identified before payment',
            inLanguage: 'en-US',
            potentialAction: {
                '@type': 'ViewAction',
                name: 'View the offer',
                target: 'https://espanolhonesto.com/en#planes',
            },
        });
        expect(ruCourse).toMatchObject({
            name: '4 индивидуальных занятия',
            inLanguage: 'ru-RU',
        });
        expect(ruCourse.description).toContain('28');
    });

    it('does not invent an offer when packages are unavailable', () => {
        expect(courseNodes(buildLandingSchema('es', translate, []))).toHaveLength(0);
    });

    it('includes FAQPage schema from visible landing FAQ translations', () => {
        expect(faqNode(buildLandingSchema('es', translate, [targetPackage]))).toMatchObject({
            '@type': 'FAQPage',
            mainEntity: [
                {
                    '@type': 'Question',
                    name: 'How do classes work?',
                    acceptedAnswer: {
                        '@type': 'Answer',
                        text: 'Online, with live practice and follow-up.',
                    },
                },
            ],
        });
    });
});
