import { describe, expect, it } from 'vitest';
import { normalizeDisplayName, type LandingPackage } from '../../src/lib/landing-data';
import { buildLandingSchema } from '../../src/lib/landing-schema';

const basePackage: LandingPackage = {
    id: 'pkg_hybrid',
    name: 'hybrid',
    display_name: {
        es: 'Hibrido mensual',
        en: 'Hybrid monthly',
        ru: 'Гибридный месяц',
    },
    price_monthly: 15000,
    sessions_per_month: 4,
    has_group_session: true,
    has_dual_teacher: true,
    stripe_price_1m: 'price_1m',
    stripe_price_3m: 'price_3m',
    stripe_price_6m: 'price_6m',
};

const groupPackage: LandingPackage = {
    id: 'pkg_group',
    name: 'group',
    display_name: {
        es: 'Grupal externo',
        en: 'External group',
        ru: 'Групповые занятия',
    },
    price_monthly: 5000,
    sessions_per_month: 4,
    has_group_session: true,
    has_dual_teacher: false,
    stripe_price_1m: 'price_group_1m',
    stripe_price_3m: 'price_group_3m',
    stripe_price_6m: 'price_group_6m',
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
        expect(normalizeDisplayName({ es: 'Grupal', en: 'Group' }, 'group')).toEqual({
            es: 'Grupal',
            en: 'Group',
            ru: 'group',
        });
    });

    it('falls back when display_name is not an object', () => {
        expect(normalizeDisplayName(null, 'standard')).toEqual({
            es: 'standard',
            en: 'standard',
            ru: 'standard',
        });
    });
});

describe('buildLandingSchema', () => {
    it('builds course schema from active runtime packages', () => {
        const schema = buildLandingSchema('es', translate, [basePackage]);
        const courses = courseNodes(schema);

        expect(courses).toHaveLength(1);
        expect(courses[0]).toMatchObject({
            '@type': 'Course',
            name: 'Hibrido mensual',
            description: '4 clases privadas al mes, conversacion grupal cuando haya compatibilidad, seguimiento con dos profesores',
            inLanguage: 'es-ES',
            offers: {
                price: '150',
                priceCurrency: 'EUR',
                url: 'https://espanolhonesto.com/es#contacto',
            },
            potentialAction: {
                '@type': 'ApplyAction',
                name: 'Solicitar plaza',
                target: 'https://espanolhonesto.com/es#contacto',
            },
        });
    });

    it('localizes course names and package descriptions', () => {
        const enCourse = courseNodes(buildLandingSchema('en', translate, [basePackage]))[0];
        const ruCourse = courseNodes(buildLandingSchema('ru', translate, [basePackage]))[0];

        expect(enCourse).toMatchObject({
            name: 'Hybrid monthly',
            description: '4 private classes per month, compatible group conversation when available, two-teacher follow-up',
            inLanguage: 'en-US',
            potentialAction: {
                '@type': 'ApplyAction',
                name: 'Request a place',
                target: 'https://espanolhonesto.com/en#contacto',
            },
        });
        expect(ruCourse).toMatchObject({
            name: 'Гибридный месяц',
            description: '4 индивидуальных занятий в месяц, групповая беседа при совместимости, сопровождение двумя преподавателями',
            inLanguage: 'ru-RU',
        });
    });

    it('does not invent legacy course offers when packages are unavailable', () => {
        const schema = buildLandingSchema('es', translate, []);

        expect(courseNodes(schema)).toHaveLength(0);
        expect(JSON.stringify(schema)).not.toContain('essential');
        expect(JSON.stringify(schema)).not.toContain('premium');
    });

    it('includes FAQPage schema from visible landing FAQ translations', () => {
        const schema = buildLandingSchema('es', translate, [basePackage]);

        expect(faqNode(schema)).toMatchObject({
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

    it('describes group-only packages as group conversation, not private classes', () => {
        const schema = buildLandingSchema('es', translate, [groupPackage]);
        const courses = courseNodes(schema);

        expect(courses[0]).toMatchObject({
            name: 'Grupal externo',
            description: '4 sesiones grupales de conversacion al mes si hay grupo compatible, grupo segun compatibilidad de nivel e intereses',
        });
        expect(courses[0].description).not.toContain('clases privadas');
    });
});
