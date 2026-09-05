import { describe, expect, it } from 'vitest';
import type { LandingPackage } from '../../src/lib/landing-data';
import { buildLandingSchema } from '../../src/lib/landing-schema';

const targetPackage: LandingPackage = {
    name: 'individual_4x50_28d',
    price_monthly: 25900,
    sessions_per_month: 4,
};

const makeTranslate = (planName: string) => (key: string): unknown => {
    if (key === 'meta.description') return 'Spanish classes for real life.';
    if (key === 'pricing.plans') return { individual_4x50_28d: { name: planName } };
    if (key === 'faq.items') {
        return [
            { question: 'How do classes work?', answer: 'Online, with live practice and follow-up.' },
        ];
    }
    return '';
};
const translate = makeTranslate('4 clases individuales');

function courseNodes(schema: ReturnType<typeof buildLandingSchema>) {
    return schema['@graph'].filter((node) => node['@type'] === 'Course');
}

function faqNode(schema: ReturnType<typeof buildLandingSchema>) {
    return schema['@graph'].find((node) => node['@type'] === 'FAQPage');
}

describe('buildLandingSchema', () => {
    it('publishes the exact target offer without inventing static availability', () => {
        const course = courseNodes(buildLandingSchema('es', translate, [targetPackage]))[0];

        expect(course).toMatchObject({
            '@type': 'Course',
            name: '4 clases individuales',
            description: '4 clases individuales de 50 minutos por ciclo de 28 días; profesor y franja semanal identificados antes de pagar',
            inLanguage: 'es-ES',
            offers: {
                price: '259',
                priceCurrency: 'EUR',
                url: 'https://espanolhonesto.com/es#planes',
            },
            potentialAction: {
                '@type': 'ViewAction',
                name: 'Ver la oferta',
                target: 'https://espanolhonesto.com/es#planes',
            },
        });
        expect(course).not.toHaveProperty('offers.availability');
    });

    it('localizes the offer without changing its commercial contract', () => {
        const enCourse = courseNodes(buildLandingSchema('en', makeTranslate('4 individual classes'), [targetPackage]))[0];
        const ruCourse = courseNodes(buildLandingSchema('ru', makeTranslate('4 индивидуальных занятия'), [targetPackage]))[0];

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
