import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { defaultLang, languages, ui } from '../../src/i18n/translations';

type Status = 'OK' | 'WARNING' | 'BLOCKED';

interface Finding {
    status: 'ok' | 'warning' | 'failed';
    area: string;
    message: string;
    details?: string[];
}

const startedAt = new Date();
const outputDir = path.join(process.cwd(), 'outputs', 'launch-content', stamp(startedAt));
mkdirSync(outputDir, { recursive: true });

const requiredLocales = ['es', 'en', 'ru'] as const;
const findings: Finding[] = [];
const allowedEmptyTranslationPaths = new Set([
    'es.progress.levels[3].duration',
    'es.progress.levels[4].duration',
    'es.progress.levels[5].duration',
    'en.progress.levels[3].duration',
    'en.progress.levels[4].duration',
    'en.progress.levels[5].duration',
    'ru.progress.levels[3].duration',
    'ru.progress.levels[4].duration',
    'ru.progress.levels[5].duration',
]);

checkLocales();
checkTranslationShape();
checkTranslationText();
checkCommercialPositioningPromise();
checkPublishedContentText();
checkPublicSourceEditorNotes();
checkTextEncoding();
checkLocalizedRoutes();

const failed = findings.filter((finding) => finding.status === 'failed');
const warnings = findings.filter((finding) => finding.status === 'warning');
const status: Status = failed.length > 0 ? 'BLOCKED' : warnings.length > 0 ? 'WARNING' : 'OK';
const contentReviewWorksheetPath = path.join(outputDir, 'content-review-worksheet.md');
const summary = {
    schemaVersion: 1,
    startedAt: startedAt.toISOString(),
    endedAt: new Date().toISOString(),
    status,
    contentReviewWorksheetPath,
    outputDir,
    findings,
};

writeFileSync(path.join(outputDir, 'summary.json'), JSON.stringify(summary, null, 2), 'utf8');
writeFileSync(path.join(outputDir, 'summary.md'), renderMarkdown(summary), 'utf8');
writeFileSync(contentReviewWorksheetPath, renderContentReviewWorksheet(summary), 'utf8');

console.log(`[launch:content] Status: ${status}`);
console.log(`[launch:content] Failed: ${failed.length}`);
console.log(`[launch:content] Warnings: ${warnings.length}`);
console.log(`[launch:content] Summary: ${path.join(outputDir, 'summary.md')}`);
console.log(`[launch:content] Content review worksheet: ${contentReviewWorksheetPath}`);

if (failed.length > 0) process.exit(1);

function checkLocales(): void {
    const languageKeys = Object.keys(languages);
    const translationKeys = Object.keys(ui);
    const missingLanguages = requiredLocales.filter((locale) => !languageKeys.includes(locale));
    const missingTranslations = requiredLocales.filter((locale) => !translationKeys.includes(locale));
    const extraTranslations = translationKeys.filter((locale) => !requiredLocales.includes(locale as typeof requiredLocales[number]));
    const details = [
        ...missingLanguages.map((locale) => `languages missing ${locale}`),
        ...missingTranslations.map((locale) => `ui missing ${locale}`),
        ...extraTranslations.map((locale) => `unexpected ui locale ${locale}`),
    ];

    if (defaultLang !== 'es') {
        details.push(`defaultLang is ${defaultLang}, expected es`);
    }

    findings.push({
        status: details.length === 0 ? 'ok' : 'failed',
        area: 'locale registry',
        message: details.length === 0
            ? 'Supported locales and default language match launch scope.'
            : 'Supported locales or default language do not match launch scope.',
        details,
    });
}

function checkTranslationShape(): void {
    const baseline = collectShape(ui[defaultLang]);
    const parityDetails: string[] = [];
    const requiredDetails: string[] = [];
    const requiredPaths = collectRequiredTranslationPaths(baseline);

    for (const locale of requiredLocales) {
        const current = collectShape(ui[locale]);

        for (const [keyPath, kind] of baseline) {
            if (!current.has(keyPath)) {
                parityDetails.push(`${locale} missing ${keyPath}`);
                continue;
            }
            const currentKind = current.get(keyPath);
            if (currentKind !== kind) {
                parityDetails.push(`${locale} ${keyPath} kind is ${currentKind}, expected ${kind}`);
            }
        }

        for (const keyPath of current.keys()) {
            if (!baseline.has(keyPath)) {
                parityDetails.push(`${locale} has extra key ${keyPath}`);
            }
        }

        for (const keyPath of requiredPaths) {
            if (!current.has(keyPath)) {
                requiredDetails.push(`${locale} missing required ${keyPath}`);
                continue;
            }
            const expectedKind = baseline.get(keyPath);
            const currentKind = current.get(keyPath);
            if (expectedKind !== currentKind) {
                requiredDetails.push(`${locale} required ${keyPath} kind is ${currentKind}, expected ${expectedKind}`);
            }
        }
    }

    findings.push({
        status: requiredDetails.length === 0 ? 'ok' : 'failed',
        area: 'required translation keys',
        message: requiredDetails.length === 0
            ? 'Critical translation keys used by launch surfaces exist in ES/EN/RU.'
            : 'Critical translation keys used by launch surfaces are missing or incompatible.',
        details: requiredDetails.slice(0, 80),
    });

    findings.push({
        status: parityDetails.length === 0 ? 'ok' : 'warning',
        area: 'full translation parity',
        message: parityDetails.length === 0
            ? 'ES/EN/RU translations have the same complete key, array and value structure.'
            : 'Translations have extra or missing non-critical keys that should be cleaned up.',
        details: parityDetails.slice(0, 80),
    });
}

function checkTranslationText(): void {
    const strings = collectStrings(ui);
    const placeholderFindings = strings
        .filter((entry) => hasPlaceholder(entry.value))
        .map((entry) => `${entry.path}: ${entry.value}`);
    const emptyFindings = strings
        .filter((entry) => entry.value.trim() === '')
        .filter((entry) => !allowedEmptyTranslationPaths.has(entry.path))
        .map((entry) => entry.path);

    findings.push({
        status: placeholderFindings.length === 0 ? 'ok' : 'failed',
        area: 'translation placeholders',
        message: placeholderFindings.length === 0
            ? 'No TODO/TBD/placeholder markers detected in translation strings.'
            : 'Translation strings contain launch-blocking placeholders.',
        details: placeholderFindings.slice(0, 80),
    });

    findings.push({
        status: emptyFindings.length === 0 ? 'ok' : 'warning',
        area: 'empty translation strings',
        message: emptyFindings.length === 0
            ? 'No unexpected empty translation strings detected.'
            : 'Unexpected empty translation strings need content review.',
        details: emptyFindings.slice(0, 80),
    });
}

function checkCommercialPositioningPromise(): void {
    const details: string[] = [];
    const marketingPlanPath = path.join(process.cwd(), 'docs', 'launch', 'LAUNCH_MARKETING_PLAN.md');
    const enye = String.fromCodePoint(0x00F1);
    const oAcute = String.fromCodePoint(0x00F3);
    const spanishHeroPromise = `entrar en Espa${enye}a de verdad`;
    const spanishHeroManifesto = `Conversaci${oAcute}n, cultura y criterio`;
    const russianHeroPromise = String.fromCodePoint(
        0x043F,
        0x043E,
        0x002D,
        0x043D,
        0x0430,
        0x0441,
        0x0442,
        0x043E,
        0x044F,
        0x0449,
        0x0435,
        0x043C,
        0x0443,
        0x0020,
        0x0432,
        0x043E,
        0x0439,
        0x0442,
        0x0438,
        0x0020,
        0x0432,
        0x0020,
        0x0436,
        0x0438,
        0x0437,
        0x043D,
        0x044C,
        0x0020,
        0x0418,
        0x0441,
        0x043F,
        0x0430,
        0x043D,
        0x0438,
        0x0438,
    );

    if (!existsSync(marketingPlanPath)) {
        details.push('docs/launch/LAUNCH_MARKETING_PLAN.md is missing.');
    } else {
        const marketingPlan = readFileSync(marketingPlanPath, 'utf8');
        if (!marketingPlan.includes('Espanol para entrar en Espana de verdad')) {
            details.push('Launch Marketing Plan is missing the guide promise.');
        }
        if (!marketingPlan.includes('conversacion, cultura y criterio')) {
            details.push('Launch Marketing Plan is missing the conversation/culture/judgement frame.');
        }
        if (!marketingPlan.includes('solicitar plaza')) {
            details.push('Launch Marketing Plan is missing application-first conversion language.');
        }
    }

    if (!ui.es.hero.manifesto.includes(spanishHeroManifesto)) {
        details.push('ES hero manifesto no longer contains the conversation/culture/judgement frame.');
    }
    if (!ui.es.hero.subtitle.includes(spanishHeroPromise)) {
        details.push('ES hero subtitle no longer says entrar en Espana de verdad.');
    }
    if (ui.es.hero.cta !== 'SOLICITAR PLAZA') {
        details.push(`ES hero CTA is ${ui.es.hero.cta}, expected SOLICITAR PLAZA.`);
    }

    if (!ui.en.hero.subtitle.includes('a real way into Spain')) {
        details.push('EN hero subtitle no longer says a real way into Spain.');
    }
    if (ui.en.hero.cta !== 'APPLY FOR A PLACE') {
        details.push(`EN hero CTA is ${ui.en.hero.cta}, expected APPLY FOR A PLACE.`);
    }

    if (!ui.ru.hero.subtitle.includes(russianHeroPromise)) {
        details.push('RU hero subtitle no longer keeps the real-way-into-Spain promise.');
    }
    if (ui.ru.hero.cta !== 'ОСТАВИТЬ ЗАЯВКУ') {
        details.push(`RU hero CTA is ${ui.ru.hero.cta}, expected ОСТАВИТЬ ЗАЯВКУ.`);
    }

    findings.push({
        status: details.length === 0 ? 'ok' : 'failed',
        area: 'commercial positioning promise',
        message: details.length === 0
            ? 'Launch Marketing Plan, public hero and application CTA stay aligned with the release positioning.'
            : 'Launch positioning drifted away from the public hero or application-first CTA.',
        details,
    });
}

function checkPublishedContentText(): void {
    const details = filesUnder(path.join(process.cwd(), 'src', 'content'))
        .filter((file) => /\.(md|mdoc)$/.test(file))
        .filter((file) => !isDraftMarkdown(readFileSync(file, 'utf8')))
        .flatMap((file) => findPublishedContentPlaceholders(file));

    findings.push({
        status: details.length === 0 ? 'ok' : 'failed',
        area: 'published content placeholders',
        message: details.length === 0
            ? 'Published content has no launch-blocking editor notes, templates or lorem ipsum markers.'
            : 'Published content contains editor notes, templates or lorem ipsum markers.',
        details: details.slice(0, 80),
    });
}

function checkPublicSourceEditorNotes(): void {
    const roots = [
        path.join(process.cwd(), 'src', 'components'),
        path.join(process.cwd(), 'src', 'layouts'),
        path.join(process.cwd(), 'src', 'pages'),
    ];
    const details = roots
        .flatMap((root) => filesUnder(root))
        .filter((file) => /\.(astro|jsx|tsx|ts)$/.test(file))
        .filter((file) => !isFinalOnlyLegalSource(file))
        .flatMap((file) => findPublicSourceEditorNotes(file));

    findings.push({
        status: details.length === 0 ? 'ok' : 'failed',
        area: 'public source editor notes',
        message: details.length === 0
            ? 'Public non-legal source files have no launch-blocking editor notes or lorem ipsum markers.'
            : 'Public non-legal source files contain editor notes or lorem ipsum markers.',
        details: details.slice(0, 80),
    });
}

function isFinalOnlyLegalSource(file: string): boolean {
    const normalized = path.relative(process.cwd(), file).replace(/\\/g, '/');
    return normalized === 'src/pages/[lang]/legal.astro'
        || normalized.startsWith('src/pages/[lang]/legal/')
        || normalized === 'src/layouts/LegalLayout.astro';
}

function isDraftMarkdown(content: string): boolean {
    const frontmatter = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    return Boolean(frontmatter?.[1] && /^draft:\s*true\s*$/im.test(frontmatter[1]));
}

function findPublishedContentPlaceholders(file: string): string[] {
    const lines = readFileSync(file, 'utf8').split(/\r?\n/);
    return lines
        .map((line, index) => ({ line, index }))
        .filter(({ line }) => hasPlaceholder(line))
        .map(({ line, index }) => `${path.relative(process.cwd(), file).replace(/\\/g, '/')}:${index + 1}: ${line.trim()}`);
}

function findPublicSourceEditorNotes(file: string): string[] {
    const lines = readFileSync(file, 'utf8').split(/\r?\n/);
    return lines
        .map((line, index) => ({ line, index }))
        .filter(({ line }) => hasPublicEditorMarker(line))
        .map(({ line, index }) => `${path.relative(process.cwd(), file).replace(/\\/g, '/')}:${index + 1}: ${line.trim()}`);
}

function checkTextEncoding(): void {
    const details = filesUnder(path.join(process.cwd(), 'src'))
        .filter((file) => /\.(astro|jsx|tsx|ts)$/.test(file))
        .flatMap((file) => findMojibakeFindings(file));

    findings.push({
        status: details.length === 0 ? 'ok' : 'failed',
        area: 'text encoding',
        message: details.length === 0
            ? 'No common mojibake or replacement-character artifacts detected in user-facing source text.'
            : 'Source text contains likely mojibake or replacement-character artifacts.',
        details: details.slice(0, 80),
    });
}

function checkLocalizedRoutes(): void {
    const requiredFiles = [
        'src/pages/index.astro',
        ...requiredLocales.map((locale) => `src/pages/${locale}/index.astro`),
        'src/pages/[lang]/login.astro',
        'src/pages/[lang]/reset-password.astro',
        'src/pages/[lang]/legal.astro',
        'src/pages/[lang]/legal/aviso-legal.astro',
        'src/pages/[lang]/legal/privacidad.astro',
        'src/pages/[lang]/legal/terminos.astro',
        'src/pages/[lang]/legal/cookies.astro',
        'src/pages/[lang]/campus/index.astro',
        'src/pages/[lang]/campus/classes.astro',
        'src/pages/[lang]/campus/support.astro',
        'src/pages/[lang]/campus/account.astro',
    ];
    const missing = requiredFiles.filter((file) => !existsSync(path.join(process.cwd(), file)));

    findings.push({
        status: missing.length === 0 ? 'ok' : 'failed',
        area: 'localized route surface',
        message: missing.length === 0
            ? 'Public, auth, legal and critical campus route files exist for the launch locale model.'
            : 'Required localized route files are missing.',
        details: missing,
    });
}

function collectShape(value: unknown, keyPath = '(root)', output = new Map<string, string>()): Map<string, string> {
    if (Array.isArray(value)) {
        output.set(keyPath, `array:${value.length}`);
        value.forEach((item, index) => collectShape(item, `${keyPath}[${index}]`, output));
        return output;
    }

    if (value && typeof value === 'object') {
        output.set(keyPath, 'object');
        for (const key of Object.keys(value as Record<string, unknown>).sort()) {
            collectShape((value as Record<string, unknown>)[key], keyPath === '(root)' ? key : `${keyPath}.${key}`, output);
        }
        return output;
    }

    output.set(keyPath, typeof value);
    return output;
}

function collectRequiredTranslationPaths(baseline: Map<string, string>): Set<string> {
    const required = new Set<string>();
    const criticalNamespaces = [
        'auth',
        'common',
        'leadCapture',
        'pricing',
        'campus.nav',
        'campus.role',
        'campus.dashboard',
        'campus.student.classes',
    ];

    for (const [keyPath, kind] of baseline) {
        if (kind === 'object' || kind.startsWith('array:')) continue;
        if (criticalNamespaces.some((namespace) => keyPath === namespace || keyPath.startsWith(`${namespace}.`) || keyPath.startsWith(`${namespace}[`))) {
            required.add(keyPath);
        }
    }

    for (const keyPath of collectKeysUsedByTFunction()) {
        for (const [shapePath] of baseline) {
            if (shapePath === keyPath || shapePath.startsWith(`${keyPath}.`) || shapePath.startsWith(`${keyPath}[`)) {
                required.add(shapePath);
            }
        }
    }

    required.add('pricing.modal.contact');
    required.add('pricing.modal.contactMessage');
    return required;
}

function collectKeysUsedByTFunction(): Set<string> {
    const keys = new Set<string>();
    for (const file of filesUnder(path.join(process.cwd(), 'src'))) {
        if (!/\.(astro|jsx|tsx|ts)$/.test(file)) continue;
        const content = readFileSync(file, 'utf8');
        const matches = content.matchAll(/\bt\(\s*['"]([^'"]+)['"]\s*\)/g);
        for (const match of matches) {
            keys.add(match[1]);
        }
    }
    return keys;
}

function filesUnder(root: string): string[] {
    if (!existsSync(root)) return [];

    const entries = readdirSync(root, { withFileTypes: true });
    return entries.flatMap((entry) => {
        const file = path.join(root, entry.name);
        if (entry.isDirectory()) return filesUnder(file);
        return file;
    });
}

function collectStrings(value: unknown, keyPath = '(root)', output: Array<{ path: string; value: string }> = []): Array<{ path: string; value: string }> {
    if (typeof value === 'string') {
        output.push({ path: keyPath, value });
        return output;
    }

    if (Array.isArray(value)) {
        value.forEach((item, index) => collectStrings(item, `${keyPath}[${index}]`, output));
        return output;
    }

    if (value && typeof value === 'object') {
        for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
            collectStrings(nested, keyPath === '(root)' ? key : `${keyPath}.${key}`, output);
        }
    }

    return output;
}

function hasPlaceholder(value: string): boolean {
    return /\bTODO\b/.test(value)
        || /\b(?:FIXME|PLACEHOLDER|LOREM IPSUM|TBD|STARTFRAGMENT|ENDFRAGMENT)\b/i.test(value)
        || /\[(?:TODO|TBD|NAME|NOMBRE|FULL|NUMBER|DIRECCI|ADDRESS|EMAIL|PHONE|PENDIENTE)[^\]\r\n]{0,80}\]/i.test(value)
        || /\[(?:El redactor debe completar|A(?:\u00F1|\u00C3\u00B1)adir plantilla)[^\]\r\n]{0,220}\]/i.test(value);
}

function hasPublicEditorMarker(value: string): boolean {
    return /\[(?:El redactor debe completar|A(?:\u00F1|\u00C3\u00B1)adir plantilla)[^\]\r\n]{0,220}\]/i.test(value)
        || /\b(?:LOREM IPSUM|STARTFRAGMENT|ENDFRAGMENT|TODO_PUBLIC_COPY|PUBLIC_COPY_TODO|COPY_TODO)\b/i.test(value)
        || /Sed ut perspiciatis/i.test(value);
}

function findMojibakeFindings(file: string): string[] {
    const patterns: Array<[string, RegExp]> = [
        ['latin1-decoded UTF-8 marker', /\u00C3[\u0080-\u00BF\u2018-\u201D]?/g],
        ['stray Latin-1 control marker', /\u00C2[\u0080-\u00BF\u00BF\u00A1]?/g],
        ['mojibake punctuation marker', /\u00E2(?:\u20AC[\u0080-\u00BF]?|[\u201E\u201C\u201D\u2019])/g],
        ['Cyrillic mojibake marker', /\u00D0[\u0080-\u00BF\u0400-\u04FF]?/g],
        ['replacement character', /\uFFFD/g],
    ];
    const result: string[] = [];
    const lines = readFileSync(file, 'utf8').split(/\r?\n/);

    lines.forEach((line, index) => {
        for (const [label, pattern] of patterns) {
            const matches = Array.from(new Set(line.match(pattern) || []));
            for (const match of matches) {
                result.push(`${path.relative(process.cwd(), file).replace(/\\/g, '/')}:${index + 1}: ${label} ${JSON.stringify(match)}`);
            }
        }
    });

    return result;
}

function renderMarkdown(report: typeof summary): string {
    const lines = [
        '# Launch Content Audit',
        '',
        `- Status: ${report.status}`,
        `- Started: ${report.startedAt}`,
        `- Ended: ${report.endedAt}`,
        `- Output: ${report.outputDir}`,
        `- Content review worksheet: ${report.contentReviewWorksheetPath}`,
        '',
        '| Status | Area | Message |',
        '| --- | --- | --- |',
    ];

    for (const finding of report.findings) {
        lines.push(`| ${finding.status} | ${escapeCell(finding.area)} | ${escapeCell(finding.message)} |`);
        if (finding.details?.length) {
            lines.push(`|  |  | ${escapeCell(finding.details.join(' / '))} |`);
        }
    }

    lines.push('');
    lines.push('## Scope');
    lines.push('');
    lines.push('This automated audit checks translation structure, placeholder markers, published-content editor notes, public non-legal source editor notes, common mojibake/replacement-character artifacts and critical localized route files. It does not replace human review of copy quality, prices, legal wording or live product catalog data.');
    lines.push('');

    return `${lines.join('\n')}\n`;
}

function renderContentReviewWorksheet(report: typeof summary): string {
    const lines = [
        '# Content Review Worksheet',
        '',
        `- Status: ${report.status}`,
        `- Generated: ${report.endedAt}`,
        `- Output: ${report.outputDir}`,
        '',
        'This worksheet is generated by `pnpm launch:content`. It is not a source-of-truth status document. Use it to collect safe review evidence, then update `docs/launch/MANUAL_EVIDENCE.local.json` under `content_review`.',
        '',
        '## Rules',
        '',
        '- Review public copy in ES, EN and RU before launch.',
        '- Confirm visible prices, package names, quotas, CTAs, emails, empty states and error states match the current product decision.',
        '- Do not paste private user data, secret URLs, API keys, payment details or screenshots with tokens.',
        '- Record routes reviewed, reviewer, date, environment and any accepted risk in local manual evidence.',
        '',
        '## Locales',
        '',
        `- Default language: ${defaultLang}`,
        `- Required launch locales: ${requiredLocales.join(', ')}`,
        '',
        '## Public And Auth Routes',
        '',
        '| Locale | Route | Source | Review focus |',
        '| --- | --- | --- | --- |',
    ];

    const routeChecks = [
        {
            route: '/{locale}/',
            source: 'src/pages/{locale}/index.astro',
            focus: 'hero, method, levels, pricing entry, CTAs, lead capture.',
        },
        {
            route: '/{locale}/login',
            source: 'src/pages/[lang]/login.astro',
            focus: 'login/register/reset labels, validation and support copy.',
        },
        {
            route: '/{locale}/reset-password',
            source: 'src/pages/[lang]/reset-password.astro',
            focus: 'password reset copy and error states.',
        },
        {
            route: '/{locale}/legal',
            source: 'src/pages/[lang]/legal.astro',
            focus: 'legal navigation and final legal links; real legal data remains final-only.',
        },
        {
            route: '/{locale}/legal/aviso-legal',
            source: 'src/pages/[lang]/legal/aviso-legal.astro',
            focus: 'placeholder-free copy after Alin fills real data.',
        },
        {
            route: '/{locale}/legal/privacidad',
            source: 'src/pages/[lang]/legal/privacidad.astro',
            focus: 'processors, privacy wording and final legal placeholders.',
        },
        {
            route: '/{locale}/legal/terminos',
            source: 'src/pages/[lang]/legal/terminos.astro',
            focus: 'commercial terms, checkout posture, class duration, cancellation and no-show expectations.',
        },
        {
            route: '/{locale}/legal/cookies',
            source: 'src/pages/[lang]/legal/cookies.astro',
            focus: 'technical cookies, Stripe, Supabase, Cloudflare/Turnstile and analytics decision.',
        },
    ];

    for (const locale of requiredLocales) {
        for (const routeCheck of routeChecks) {
            lines.push(`| ${locale} | ${routeCheck.route.replace('{locale}', locale)} | ${routeCheck.source.replace('{locale}', locale)} | ${routeCheck.focus} |`);
        }
    }

    lines.push('');
    lines.push('## Campus And Product Surfaces');
    lines.push('');
    lines.push('| Surface | Source | Review focus |');
    lines.push('| --- | --- | --- |');
    for (const surface of [
        {
            name: 'Student dashboard',
            source: 'src/pages/[lang]/campus/index.astro',
            focus: 'empty states, onboarding, next class copy, account prompts.',
        },
        {
            name: 'Classes',
            source: 'src/pages/[lang]/campus/classes.astro; src/components/calendar/StudentClassList.tsx',
            focus: 'scheduled/cancelled/empty states and booking language.',
        },
        {
            name: 'Support',
            source: 'src/pages/[lang]/campus/support.astro',
            focus: 'support expectations, response wording and contact path.',
        },
        {
            name: 'Pricing and packages',
            source: 'src/components/PricingSection.tsx; docs/launch/PRODUCTS.md',
            focus: 'prices, quotas, package names, Stripe-disabled/live wording.',
        },
        {
            name: 'Lead capture',
            source: 'src/components/LeadCaptureForm.tsx',
            focus: 'consent, Turnstile, success/error states and email expectations.',
        },
        {
            name: 'Transactional email previews',
            source: 'src/lib/email/previews.ts; src/components/admin/EmailTemplateManager.tsx',
            focus: 'welcome/session/reminder/test email copy and language tone.',
        },
        {
            name: 'Auth and validation',
            source: 'src/components/AuthForm.jsx; src/i18n/translations.ts',
            focus: 'form labels, validation, loading states and failures.',
        },
    ]) {
        lines.push(`| ${surface.name} | ${surface.source} | ${surface.focus} |`);
    }

    lines.push('');
    lines.push('## Evidence To Record');
    lines.push('');
    lines.push('- `manual_note`: routes and surfaces reviewed, reviewer, date, environment and result.');
    lines.push('- `screenshot`: redacted screenshots for representative ES/EN/RU pricing/copy states.');
    lines.push('- `document`: local copy approval note if a separate document is used.');
    lines.push('- `command_output`: this audit summary as supporting evidence, not as a substitute for human review.');
    lines.push('');

    return `${lines.join('\n')}\n`;
}

function stamp(date: Date): string {
    return date.toISOString().replace(/[:.]/g, '-');
}

function escapeCell(value: string): string {
    return value.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}
