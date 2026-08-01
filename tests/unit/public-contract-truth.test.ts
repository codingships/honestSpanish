import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ui } from '../../src/i18n/translations';
import { useTranslations as makeTranslations, type SupportedLang } from '../../src/i18n/utils';
import { buildLandingSchema } from '../../src/lib/landing-schema';

const languages: SupportedLang[] = ['es', 'en', 'ru'];
const landingPage = readFileSync('src/components/LandingPage.astro', 'utf8');
const anchorContractPatterns: Record<SupportedLang, RegExp[]> = {
    es: [
        /autoservicio/iu,
        /máximo inclusivo de 28 días desde la fecha originalmente comprada/iu,
        /soporte fuera de esa ventana no mueve automáticamente el ancla/iu,
        /ancla queda fija cuando comienza la primera clase/iu,
    ],
    en: [
        /through self-service/iu,
        /up to and including 28 days after the date originally purchased/iu,
        /support outside that window does not automatically move the anchor/iu,
        /anchor becomes fixed when the first class starts/iu,
    ],
    ru: [
        /самостоятельно перенести первую дату/iu,
        /не более чем на 28 дней включительно от первоначально приобретённой даты/iu,
        /поддержку за пределами этого окна не сдвигает дату продления автоматически/iu,
        /дата продления фиксируется с началом первого занятия/iu,
    ],
};

function faqText(lang: SupportedLang): string {
    return ui[lang].faq.items
        .flatMap((item) => [item.question, item.answer])
        .join(' ');
}

function faqSchema(lang: SupportedLang) {
    return buildLandingSchema(lang, makeTranslations(lang), [])['@graph']
        .find((node) => node['@type'] === 'FAQPage') as {
            '@type': string;
            mainEntity: unknown;
        } | undefined;
}

describe('public contract truth', () => {
    it.each(languages)('keeps the %s FAQ on the single launch contract', (lang) => {
        expect(ui[lang].faq.items).toHaveLength(6);

        const text = faqText(lang);
        for (const fragment of ['4', '50', '259', '28', '24', '194']) {
            expect(text).toContain(fragment);
        }
        for (const pattern of anchorContractPatterns[lang]) {
            expect(text).toMatch(pattern);
        }

        expect(text).not.toMatch(/\bA2\b/u);
        expect(text).not.toMatch(/change plans?|cambiar de plan|сменить план/iu);
        expect(text).not.toMatch(/classes? for compan|clases para empresas|уроки для компаний/iu);
        expect(text).not.toMatch(/3 months?|3 meses|3 месяца/iu);
    });

    it.each(languages)('uses the visible %s FAQ verbatim in JSON-LD', (lang) => {
        const schema = faqSchema(lang);
        expect(schema).toBeDefined();
        expect(schema?.mainEntity).toEqual(ui[lang].faq.items.map((item) => ({
            '@type': 'Question',
            name: item.question,
            acceptedAnswer: {
                '@type': 'Answer',
                text: item.answer,
            },
        })));
    });

    it.each(languages)('describes %s progress as observable milestones without a timetable', (lang) => {
        expect(ui[lang].progress.levels).toHaveLength(6);
        expect(ui[lang].progress.levels.every((level) => level.duration.trim().length > 0)).toBe(true);

        const text = [
            ui[lang].progress.subheadline,
            ui[lang].progress.paragraph,
            ...ui[lang].progress.levels.flatMap((level) => [level.duration, level.description]),
        ].join(' ');

        expect(text).not.toMatch(/(?:5|10|15)\s+(?:months?|meses|месяц(?:а|ев)?)/iu);
        expect(text).not.toMatch(/practically bilingual|prácticamente bilingüe|практически двуязычна/iu);
    });

    it('keeps the time-to-fluency articles public without unsupported universal promises', () => {
        for (const path of [
            'src/content/blog/es/cuanto-tiempo-hablar-espanol-fluido.md',
            'src/content/blog/en/how-long-to-speak-spanish-fluently.md',
            'src/content/blog/ru/how-long-to-speak-spanish-fluently.md',
        ]) {
            const article = readFileSync(path, 'utf8');

            expect(article).toContain('translationKey: "time-to-fluency"');
            expect(article).not.toMatch(/^draft:\s*true\s*$/mu);
            expect(article).not.toMatch(/600\s*(?:[-–]|to|a|до)\s*800/iu);
            expect(article).not.toMatch(/8\s*(?:[-–]|to|a|до)\s*10\s*(?:months?|meses|месяц(?:а|ев)?)/iu);
            expect(article).not.toMatch(/(?:150|200|350|400|600|800)\s*(?:[-–]|to|a|до)?\s*(?:hours?|horas|час(?:а|ов)?)/iu);
            expect(article).not.toMatch(/(?:it will take you|tardarás|вам потребуется)\s+\d+\s+(?:years?|años|лет)/iu);
            expect(article).toMatch(/259\s*EUR|EUR\s*259/iu);
            expect(article).toMatch(/50[-\s]*(?:minutes?|minutos|минут)/iu);
            expect(article).toMatch(/28[-\s](?:day|día|днев)/iu);
        }
    });

    it('does not imply a minimum level on the home page', () => {
        expect(landingPage).toContain("label: 'Conversación adaptada a ti'");
        expect(landingPage).not.toContain("label: 'Conversación A2/B1+'");
    });
});
