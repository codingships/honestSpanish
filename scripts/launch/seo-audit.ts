import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

type Status = 'ok' | 'warning' | 'failed';

interface Finding {
    status: Status;
    area: string;
    message: string;
    details?: string[];
}

interface SeoReport {
    schemaVersion: 1;
    startedAt: string;
    endedAt: string;
    status: 'OK' | 'WARNING' | 'FAILED';
    outputDir: string;
    seoLlmWorksheetPath: string;
    findings: Finding[];
}

const startedAt = new Date();
const outputDir = path.join(process.cwd(), 'outputs', 'launch-seo', stamp(startedAt));
mkdirSync(outputDir, { recursive: true });

const findings: Finding[] = [
    reviewCrawlabilityAndIndexation(),
    reviewMetadataAndAlternates(),
    reviewEncodingSanity(),
    reviewStructuredData(),
    reviewSegmentAnswerBlocks(),
    reviewLlmSurface(),
    reviewMarketingPlanCoverage(),
    reviewFinalWorkflowCoverage(),
];

const failed = findings.filter((finding) => finding.status === 'failed');
const warnings = findings.filter((finding) => finding.status === 'warning');
const status = failed.length > 0 ? 'FAILED' : warnings.length > 0 ? 'WARNING' : 'OK';
const seoLlmWorksheetPath = path.join(outputDir, 'seo-llm-final-worksheet.md');

const report: SeoReport = {
    schemaVersion: 1,
    startedAt: startedAt.toISOString(),
    endedAt: new Date().toISOString(),
    status,
    outputDir,
    seoLlmWorksheetPath,
    findings,
};

writeFileSync(path.join(outputDir, 'summary.json'), JSON.stringify(report, null, 2), 'utf8');
writeFileSync(path.join(outputDir, 'summary.md'), renderMarkdown(report), 'utf8');
writeFileSync(seoLlmWorksheetPath, renderSeoLlmWorksheet(report), 'utf8');

console.log(`[launch:seo] Status: ${status}`);
console.log(`[launch:seo] Failed: ${failed.length}`);
console.log(`[launch:seo] Warnings: ${warnings.length}`);
console.log(`[launch:seo] Summary: ${path.join(outputDir, 'summary.md')}`);
console.log(`[launch:seo] SEO/LLM worksheet: ${seoLlmWorksheetPath}`);

if (failed.length > 0) process.exit(1);

function reviewCrawlabilityAndIndexation(): Finding {
    const astroConfig = readIfExists('astro.config.mjs');
    const robots = readIfExists(path.join('public', 'robots.txt'));
    const sitemapPublic = readIfExists(path.join('src', 'pages', 'sitemap-public.xml.ts'));
    const details = [
        ...missingSnippets('astro.config.mjs', astroConfig, [
            "site: 'https://espanolhonesto.com'",
            'sitemap({',
            "page !== 'https://espanolhonesto.com/'",
            "!page.includes('/campus')",
            "!page.includes('/login')",
            "!page.includes('/legal')",
            "!page.includes('/demo')",
            "!page.includes('/api/')",
        ]),
        ...missingSnippets(path.join('public', 'robots.txt'), robots, [
            'User-agent: *',
            'Allow: /',
            'Disallow: /api/',
            'Disallow: /es/campus/',
            'Disallow: /en/campus/',
            'Disallow: /ru/campus/',
            'Disallow: /demo',
            'Sitemap: https://espanolhonesto.com/sitemap-index.xml',
        ]),
        ...missingSnippets(path.join('src', 'pages', 'sitemap-public.xml.ts'), sitemapPublic, [
            "const SITE = 'https://espanolhonesto.com'",
            "const LANGS = ['es', 'en', 'ru']",
            'ES_SEGMENT_PAGES',
            '/espanol-para-vivir-en-espana',
            '/espanol-para-profesionales',
            '/clases-de-conversacion-en-espanol',
            'hreflang="x-default"',
            'getCollection',
        ]),
        ...forbiddenSnippets(path.join('src', 'pages', 'sitemap-public.xml.ts'), sitemapPublic, [
            '/campus',
            '/login',
            '/legal',
            '/demo',
            '/api',
            '/keystatic',
        ]),
    ];

    return {
        status: details.length === 0 ? 'ok' : 'failed',
        area: 'crawlability and indexation',
        message: details.length === 0
            ? 'Robots, sitemap integration and public sitemap source keep public pages crawlable while private/demo/API routes stay out of the public index surface.'
            : 'Crawlability or indexation controls are incomplete.',
        details,
    };
}

function reviewMetadataAndAlternates(): Finding {
    const baseLayout = readIfExists(path.join('src', 'layouts', 'BaseLayout.astro'));
    const legalLayout = readIfExists(path.join('src', 'layouts', 'LegalLayout.astro'));
    const landingRoutes = [
        path.join('src', 'pages', 'es', 'index.astro'),
        path.join('src', 'pages', 'en', 'index.astro'),
        path.join('src', 'pages', 'ru', 'index.astro'),
    ];
    const details = [
        ...missingSnippets(path.join('src', 'layouts', 'BaseLayout.astro'), baseLayout, [
            '<title>{title}</title>',
            '<meta name="description" content={description} />',
            '<link rel="canonical" href={canonicalUrl} />',
            'hreflang="es"',
            'hreflang="en"',
            'hreflang="ru"',
            'hreflang="x-default"',
            '<meta property="og:title" content={title} />',
            '<meta property="og:description" content={description} />',
            '<meta property="og:image"',
            '<meta name="twitter:card" content="summary_large_image" />',
            'name="robots" content="noindex, nofollow"',
        ]),
        ...missingSnippets(path.join('src', 'layouts', 'LegalLayout.astro'), legalLayout, [
            '<meta name="robots" content="noindex, follow">',
        ]),
    ];

    for (const route of landingRoutes) {
        const source = readIfExists(route);
        details.push(...missingSnippets(route, source, [
            'title=',
            'description=',
            'canonicalPath="/"',
        ]));
    }

    return {
        status: details.length === 0 ? 'ok' : 'failed',
        area: 'metadata and alternates',
        message: details.length === 0
            ? 'Shared layout and landing routes expose title, description, canonical, hreflang, OG, Twitter and noindex primitives.'
            : 'Metadata, alternate links or social preview primitives are incomplete.',
        details,
    };
}

function reviewEncodingSanity(): Finding {
    const files = collectLaunchCriticalSourceFiles();
    const details = files
        .map((file) => ({ file, content: readIfExists(file) }))
        .filter(({ content }) => hasLikelyMojibake(content))
        .map(({ file }) => `${file}: likely mojibake marker found.`);

    return {
        status: details.length === 0 ? 'ok' : 'failed',
        area: 'encoding sanity',
        message: details.length === 0
            ? 'Launch-critical public source files do not contain common mojibake markers.'
            : 'Launch-critical public source files include likely encoding corruption.',
        details,
    };
}

function reviewStructuredData(): Finding {
    const landingSchema = readIfExists(path.join('src', 'lib', 'landing-schema.ts'));
    const landingData = readIfExists(path.join('src', 'lib', 'landing-data.ts'));
    const landingRoutes = [
        path.join('src', 'pages', 'es', 'index.astro'),
        path.join('src', 'pages', 'en', 'index.astro'),
        path.join('src', 'pages', 'ru', 'index.astro'),
    ];
    const details = [
        ...missingSnippets(path.join('src', 'lib', 'landing-schema.ts'), landingSchema, [
            'buildLandingSchema',
            '@context',
            'Course',
            'Offer',
            'ApplyAction',
            '#contacto',
            'FAQPage',
            'faq.items',
            'acceptedAnswer',
            'packages.map',
        ]),
        ...missingSnippets(path.join('src', 'lib', 'landing-data.ts'), landingData, [
            'getLandingPageData',
            "from('packages')",
            "eq('is_active', true)",
            'price_monthly',
        ]),
        ...forbiddenSnippets(path.join('src', 'lib', 'landing-schema.ts'), landingSchema, [
            'pricing.plans.essential',
            'pricing.plans.premium',
        ]),
    ];

    for (const route of landingRoutes) {
        const source = readIfExists(route);
        details.push(...missingSnippets(route, source, [
            'getLandingPageData(Astro)',
            'buildLandingSchema(lang, t, packages)',
            'type="application/ld+json"',
        ]));
    }

    return {
        status: details.length === 0 ? 'ok' : 'failed',
        area: 'structured data',
        message: details.length === 0
            ? 'Landing JSON-LD is generated from active package and visible FAQ data, with application-first course actions.'
            : 'Structured data is missing or can drift from active package, FAQ data or application-first course actions.',
        details,
    };
}

function reviewSegmentAnswerBlocks(): Finding {
    const landingPage = readIfExists(path.join('src', 'components', 'LandingPage.astro'));
    const segmentComponent = readIfExists(path.join('src', 'components', 'landing', 'SegmentLandingPage.astro'));
    const vivirPage = readIfExists(path.join('src', 'pages', 'es', 'espanol-para-vivir-en-espana.astro'));
    const profesionalesPage = readIfExists(path.join('src', 'pages', 'es', 'espanol-para-profesionales.astro'));
    const conversationPage = readIfExists(path.join('src', 'pages', 'es', 'clases-de-conversacion-en-espanol.astro'));
    const intentMap = readIfExists(path.join('docs', 'launch', 'SEO_INTENT_MAP.md'));
    const details = [
        ...missingSnippets(path.join('src', 'components', 'LandingPage.astro'), landingPage, [
            'id="rutas"',
            'Si ya sabes por qué necesitas español',
            '/es/espanol-para-vivir-en-espana',
            '/es/espanol-para-profesionales',
            '/es/clases-de-conversacion-en-espanol',
        ]),
        ...missingSnippets(path.join('src', 'components', 'landing', 'SegmentLandingPage.astro'), segmentComponent, [
            'interface AnswerItem',
            'interface ContextItem',
            'contexts:',
            'Contextos de uso',
            'contexts.items.map',
            'answers:',
            'Respuestas para decidir',
            'answers.items.map',
            'applicationSteps',
            'Después de solicitar plaza',
            'Primero encaje. Después plan.',
            'prueba automática ligera',
            'Sólo después de confirmar encaje',
        ]),
        ...missingSnippets(path.join('src', 'pages', 'es', 'espanol-para-vivir-en-espana.astro'), vivirPage, [
            'const answers = {',
            'contexts={{',
            "'@type': 'FAQPage'",
            '¿Qué es español para vivir en España?',
            '¿Qué incluye el curso?',
            'documento vivo de clase',
            'No vendemos un grupo como si existiera',
            'Madrid sirve para practicar small talk',
            'Barcelona abre conversación sobre trabajo internacional',
            'answers={answers}',
        ]),
        ...missingSnippets(path.join('src', 'pages', 'es', 'espanol-para-profesionales.astro'), profesionalesPage, [
            'const answers = {',
            'contexts={{',
            "'@type': 'FAQPage'",
            '¿Qué es español para profesionales?',
            '¿Qué se trabaja en las clases?',
            '¿Qué incluye el curso?',
            'soporte desde el campus',
            'reuniones, entrevistas, clientes, equipo',
            'Intervenir sin preparar cada frase',
            'La parte que ocurre fuera de la reunión',
            'answers={answers}',
        ]),
        ...missingSnippets(path.join('src', 'pages', 'es', 'clases-de-conversacion-en-espanol.astro'), conversationPage, [
            'const answers = {',
            'contexts={{',
            "'@type': 'FAQPage'",
            'Clases de conversación en español online',
            '¿Se corrigen errores o sólo se habla?',
            'No vendemos grupos garantizados',
            'Small talk',
            'Reparación',
            'pasar de español pasivo a español usable',
            'answers={answers}',
        ]),
        ...missingSnippets(path.join('docs', 'launch', 'SEO_INTENT_MAP.md'), intentMap, [
            'Las tres paginas de segmento del RC incluyen bloques de respuestas rapidas',
            'contextos concretos',
            'FAQPage',
            'Esto no cierra `seo_llm_final`',
        ]),
    ];
    if (landingPage.includes('Si ya sabes por que necesitas espanol')) {
        details.push(`${path.join('src', 'components', 'LandingPage.astro')}: visible Spanish route intro lost accents.`);
    }

    return {
        status: details.length === 0 ? 'ok' : 'failed',
        area: 'segment answer blocks',
        message: details.length === 0
            ? 'Spanish segment pages keep answer-engine blocks, FAQPage JSON-LD and final-only SEO/LLM caveat.'
            : 'Spanish segment pages are missing answer-engine blocks, FAQPage JSON-LD or final-only SEO/LLM documentation.',
        details,
    };
}

function reviewLlmSurface(): Finding {
    const llms = readIfExists(path.join('public', 'llms.txt'));
    const details = [
        ...missingSnippets(path.join('public', 'llms.txt'), llms, [
            '# Español Honesto',
            'https://espanolhonesto.com/es',
            'https://espanolhonesto.com/en',
            'https://espanolhonesto.com/ru',
            'https://espanolhonesto.com/sitemap-index.xml',
            '## Who It Is For',
            'Adults living in Spain or preparing to move to Spain',
            'Students around A2, B1 or B2',
            'Professionals who need Spanish for work',
            'Community is a direction of the project',
            'https://espanolhonesto.com/es/espanol-para-vivir-en-espana',
            'https://espanolhonesto.com/es/espanol-para-profesionales',
            'https://espanolhonesto.com/es/clases-de-conversacion-en-espanol',
            '## Teaching Team',
            'Alejandro: head Spanish teacher and UCM linguist',
            'Irene: Spanish teacher with Spanish, English, Czech, French and Spanish Sign Language',
            '## Current Public Course Packages',
            'Grupal Externo',
            '4 guided group conversation sessions per month',
            'It does not include private classes',
            'Mensual Estándar',
            'Híbrido Mensual',
            'Intensivo Bootcamp',
            '## How To Apply',
            'The primary public action is to apply for a place, not to buy immediately.',
            'https://espanolhonesto.com/es#contacto',
            'reviews fit, level, availability and expectations before recommending a plan',
            'Do not describe group conversation, community, payment or a human level test as guaranteed',
            '## How Assistants Should Describe Espanol Honesto',
            'live Spain through conversation, culture, judgement and real contact with the country',
            'culturally curious adults, often 30+ and A2/B1 or above',
            'Visitors should request a place first',
            'fit-based contact with Spain through guided conversation',
            'Do not describe it as a guaranteed public community, a Telegram channel, a guaranteed group or a cheap replacement for private classes',
            'https://espanolhonesto.com/es#incluye',
            'https://espanolhonesto.com/es#planes',
            '## Segment Page Source Notes',
            'Spanish for living in Spain uses Madrid, Oviedo, Toledo/Castilla-La Mancha and Barcelona',
            'Spanish for professionals covers meetings, clients, teams, interviews, presentations',
            'Spanish conversation classes covers A2/B1+ learners who understand Spanish but freeze when speaking',
            'not local in-person city pages',
            '## Do Not Use As Public Source Material',
            '/api',
            '/campus',
            '/demo',
            'Keystatic',
            'Legal owner/controller data may be updated before public launch',
        ]),
        ...forbiddenSnippets(path.join('public', 'llms.txt'), llms, [
            'essential',
            'premium',
            'student email',
            'service role',
            'Grupal Externo: 4 private classes per month',
            'buy immediately without review',
            'guaranteed human level test',
        ]),
    ];

    return {
        status: details.length === 0 ? 'ok' : 'failed',
        area: 'LLM public surface',
        message: details.length === 0
            ? 'llms.txt points assistants to public source material, current packages, application-first conversion and private-route boundaries.'
            : 'llms.txt is missing public-source guidance or contains stale/private hints.',
        details,
    };
}

function reviewMarketingPlanCoverage(): Finding {
    const marketingPlan = readIfExists(path.join('docs', 'launch', 'LAUNCH_MARKETING_PLAN.md'));
    const seoLlmRunbook = readIfExists(path.join('docs', 'launch', 'SEO_LLM_FINAL.md'));
    const intentMap = readIfExists(path.join('docs', 'launch', 'SEO_INTENT_MAP.md'));
    const llms = readIfExists(path.join('public', 'llms.txt'));
    const details = [
        ...missingSnippets(path.join('docs', 'launch', 'LAUNCH_MARKETING_PLAN.md'), marketingPlan, [
            'Espanol para entrar en Espana de verdad',
            'conversacion, cultura y criterio',
            'solicitar plaza',
            'Hibrido mensual',
            'Grupal externo',
            'Final-Only',
        ]),
        ...missingSnippets(path.join('docs', 'launch', 'SEO_LLM_FINAL.md'), seoLlmRunbook, [
            'docs/launch/LAUNCH_MARKETING_PLAN.md',
            'plan comercial canonico',
            'promesa, cliente principal, jerarquia de planes',
            'marketing plan parity',
        ]),
        ...missingSnippets(path.join('docs', 'launch', 'SEO_INTENT_MAP.md'), intentMap, [
            'docs/launch/LAUNCH_MARKETING_PLAN.md',
            'este mapa es solo la parte SEO/LLM',
        ]),
        ...missingSnippets(path.join('public', 'llms.txt'), llms, [
            'live Spain through conversation, culture, judgement',
            'Visitors should request a place first',
            'Do not describe it as a guaranteed public community',
        ]),
    ];

    return {
        status: details.length === 0 ? 'ok' : 'failed',
        area: 'marketing plan parity',
        message: details.length === 0
            ? 'SEO/LLM final workflow is explicitly tied to the canonical launch marketing plan and public assistant surface.'
            : 'SEO/LLM final workflow can drift from the canonical launch marketing plan.',
        details,
    };
}

function reviewFinalWorkflowCoverage(): Finding {
    const checklist = readIfExists(path.join('docs', 'launch', 'CHECKLIST.md'));
    const sequence = readIfExists(path.join('docs', 'launch', 'LAUNCH_SEQUENCE.md'));
    const manualEvidence = readIfExists(path.join('docs', 'launch', 'MANUAL_EVIDENCE.md'));
    const seoLlmRunbook = readIfExists(path.join('docs', 'launch', 'SEO_LLM_FINAL.md'));
    const readme = readIfExists('README.md');
    const details = [
        ...missingSnippets(path.join('docs', 'launch', 'CHECKLIST.md'), checklist, [
            'SEO/LLM final',
            'SEO tecnico',
            'Mapa LLM publico creado',
            'Search Console cuando este disponible',
            'docs/launch/SEO_LLM_FINAL.md',
        ]),
        ...missingSnippets(path.join('docs', 'launch', 'LAUNCH_SEQUENCE.md'), sequence, [
            'SEO para buscadores y LLMs queda como cierre final',
            'SEO/LLM final',
            'sitemap, robots, canonical/hreflang, structured data',
        ]),
        ...missingSnippets(path.join('docs', 'launch', 'MANUAL_EVIDENCE.md'), manualEvidence, [
            'SEO/LLM final',
            'outputs/launch-seo/<timestamp>/seo-llm-final-worksheet.md',
            'docs/launch/SEO_LLM_FINAL.md',
        ]),
        ...missingSnippets(path.join('docs', 'launch', 'SEO_LLM_FINAL.md'), seoLlmRunbook, [
            'Search Console',
            'Core Web Vitals',
            'Tipografia Rusa Premium',
            'familia oficial con soporte cirilico',
            'No guardar fuentes comerciales sin licencia',
            'Respuestas AEO/FAQ de segmentos',
            'Aprendizaje De Clientes Sin Telemetria Rica',
            'familias de consultas',
            'sourcePath',
            'FAQPage',
            'sin prometer grupos, reviews, Telegram ni prueba de nivel definitiva',
            'LLM Discoverability',
            'descripcion autocontenida para asistentes',
            'comunidad con encaje',
            'checkout inmediato',
            'No guardar en el repo',
            'campus, API, demo',
            'seo_llm_final',
        ]),
        ...missingSnippets(path.join('docs', 'launch', 'SEO_INTENT_MAP.md'), readIfExists(path.join('docs', 'launch', 'SEO_INTENT_MAP.md')), [
            'comunidad como direccion, no como promesa cerrada',
            'prueba automatica ligera',
            'Madrid, Oviedo, Toledo/Castilla-La Mancha y Barcelona',
        ]),
        ...missingSnippets('README.md', readme, [
            'pnpm launch:seo',
        ]),
    ];

    return {
        status: details.length === 0 ? 'ok' : 'failed',
        area: 'final SEO/LLM workflow',
        message: details.length === 0
            ? 'Final SEO/LLM remains explicitly final-only and has a dedicated audit/worksheet path.'
            : 'Final SEO/LLM workflow is not fully documented.',
        details,
    };
}

function renderMarkdown(report: SeoReport): string {
    const lines = [
        '# SEO And LLM Launch Audit',
        '',
        `- Status: ${report.status}`,
        `- Started: ${report.startedAt}`,
        `- Ended: ${report.endedAt}`,
        `- Output: ${report.outputDir}`,
        `- SEO/LLM worksheet: ${report.seoLlmWorksheetPath}`,
        '',
        '| Status | Area | Message |',
        '| --- | --- | --- |',
    ];

    appendFindingsTable(lines, report.findings);

    lines.push('');
    lines.push('## Scope');
    lines.push('');
    lines.push('This audit checks crawlability, private-route exclusion, metadata primitives, encoding sanity, structured data, segment answer blocks, llms.txt, marketing plan parity, Cyrillic typography final-only coverage and final SEO/LLM workflow coverage. It does not replace Search Console, live-domain inspection, final legal review, final copy review, premium font licensing, Core Web Vitals field data or Alin final signoff.');
    lines.push('');

    return `${lines.join('\n')}\n`;
}

function renderSeoLlmWorksheet(report: SeoReport): string {
    const lines = [
        '# SEO/LLM Final Worksheet',
        '',
        `- Status: ${report.status}`,
        `- Generated: ${report.endedAt}`,
        `- Output: ${report.outputDir}`,
        '- Stable runbook: docs/launch/SEO_LLM_FINAL.md',
        '',
        '## Rule',
        '',
        'Use this worksheet during final closure, after copy, legal pages, domains, payment mode and the premium Russian typography decision are stable. Follow `docs/launch/SEO_LLM_FINAL.md`. Do not paste Search Console tokens, analytics exports with private user data, secret URLs, customer data, dashboard screenshots with tokens, unlicensed font files, invoices or fiscal data.',
        '',
        '## Automated Coverage',
        '',
        '| Status | Area | Message |',
        '| --- | --- | --- |',
    ];

    appendFindingsTable(lines, report.findings);

    lines.push('');
    lines.push('## Final Manual Checks');
    lines.push('');
    lines.push('| Check | How To Verify | Evidence To Record |');
    lines.push('| --- | --- | --- |');
    lines.push('| domain canonical | Confirm production serves `https://espanolhonesto.com` consistently and redirects unwanted host variants. | `manual_note` with tested URLs and status codes. |');
    lines.push('| robots and sitemap | Open `/robots.txt`, `/sitemap-index.xml` and `/sitemap-public.xml`; confirm public pages are allowed and private/demo/API routes are absent. | URLs or redacted screenshots. |');
    lines.push('| canonical/hreflang | Inspect ES/EN/RU landing and key blog/legal pages for canonical and hreflang/x-default correctness. | `manual_note` with routes checked. |');
    lines.push('| legal index policy | Decide whether final legal pages should stay `noindex` or become indexable; ensure sitemap and robots match the decision. | Decision note with owner and date. |');
    lines.push('| snippets | Review final title/meta descriptions for ES/EN/RU landing, blog index and key public pages. | `manual_note` with route list and changes, if any. |');
    lines.push('| encoding and brand text | Confirm rendered public pages and campus entry points show `Español Honesto`, Spanish accents and Russian text without mojibake. | `manual_note` or screenshot references. |');
    lines.push('| premium Russian typography | Confirm `/ru` uses the official Cyrillic-capable family after purchase/licensing, or record that Alin accepts the current fallback for launch. Do not store unlicensed font files, invoices or fiscal data in evidence. | `manual_note` with route list, font decision, provider/family name if licensed and screenshot references if useful. |');
    lines.push('| structured data | Validate landing JSON-LD with current packages and final prices/copy. | Validator URL, screenshot or `manual_note`; no private data. |');
    lines.push('| segment AEO/FAQ | Review `/es/espanol-para-vivir-en-espana`, `/es/espanol-para-profesionales` and `/es/clases-de-conversacion-en-espanol` for self-contained answers, `FAQPage` JSON-LD and no promises about unavailable groups, reviews, Telegram or definitive level test. | `manual_note`, validator result or redacted screenshot. |');
    lines.push('| positioning fit | Confirm public snippets and `/llms.txt` describe the launch fit as adults/professionals 30+ A2/B1+ who want to live Spain through conversation, culture, judgement, contact and fit-based community. | `manual_note` with reviewed routes or prompt summary. |');
    lines.push('| marketing plan parity | Compare final snippets, `/llms.txt`, segment pages and assistant answers against `docs/launch/LAUNCH_MARKETING_PLAN.md`: promise, ideal learner, plan hierarchy, application-first CTA and postponed items. | `manual_note` listing checked sources and any fixes. |');
    lines.push('| application flow | Confirm public and assistant-facing copy says visitors should request a place first; payment, compatible group practice and human review only come after fit, level, goals and availability are reviewed. | `manual_note` with reviewed routes or prompt summary. |');
    lines.push('| false promise review | Confirm search/assistant-facing copy does not present cheap classes, active Telegram, guaranteed group, public community, immediate checkout or universal human level test as available. | `manual_note` listing checked sources and any fixes. |');
    lines.push('| llms.txt | Confirm `/llms.txt` reflects final public pages, packages, boundaries, legal caveat, application-first flow and community-with-fit positioning. | URL or `manual_note`. |');
    lines.push('| Search Console | If available, verify property, submit sitemap and inspect key URLs. | Dashboard reference or `manual_note`; no tokens. |');
    lines.push('| Core Web Vitals | Run PageSpeed/Lighthouse or Search Console CWV for landing pages after final deploy. | Score summary or dashboard reference. |');
    lines.push('| social previews | Check OG/Twitter preview for ES/EN/RU landing and representative blog post. | Redacted screenshot or `manual_note`. |');
    lines.push('| customer discovery loop | Review Search Console query families and aggregated application source paths/interests/preferred packages/levels/goals to understand which clients are finding the site without rich telemetry. | Aggregated `manual_note`; no names, emails, IPs, recordings or personal data exports. |');
    lines.push('| LLM discoverability | Ask an assistant/search-style review to use only public sources and confirm it does not cite campus/API/demo/private routes. | Prompt/result summary without private data. |');
    lines.push('');
    lines.push('## Completion');
    lines.push('');
    lines.push('Keep SEO/LLM final open until the final public domain, final legal content, final copy and premium Russian typography decision are stable. Mark it closed in `docs/launch/CHECKLIST.md` only when this worksheet has current non-secret evidence and `pnpm launch:seo`, `pnpm launch:verify` and `pnpm launch:status` have been rerun.');
    lines.push('');

    return `${lines.join('\n')}\n`;
}

function appendFindingsTable(lines: string[], findings: Finding[]): void {
    for (const finding of findings) {
        lines.push(`| ${finding.status} | ${escapeCell(finding.area)} | ${escapeCell(finding.message)} |`);
        if (finding.details?.length) {
            lines.push(`|  |  | ${escapeCell(finding.details.join(' / '))} |`);
        }
    }
}

function missingSnippets(file: string, content: string, snippets: string[]): string[] {
    return snippets
        .filter((snippet) => !content.includes(snippet))
        .map((snippet) => `${file}: missing ${snippet}.`);
}

function forbiddenSnippets(file: string, content: string, snippets: string[]): string[] {
    return snippets
        .filter((snippet) => content.toLowerCase().includes(snippet.toLowerCase()))
        .map((snippet) => `${file}: must not include ${snippet}.`);
}

function readIfExists(file: string): string {
    return existsSync(file) ? readFileSync(file, 'utf8') : '';
}

function collectLaunchCriticalSourceFiles(): string[] {
    const roots = [
        path.join('src', 'components'),
        path.join('src', 'layouts'),
        path.join('src', 'pages'),
        path.join('src', 'i18n'),
        'public',
    ];
    const extensions = new Set(['.astro', '.ts', '.tsx', '.jsx', '.js', '.md', '.mdoc', '.txt']);
    const files: string[] = [];

    const walk = (directory: string) => {
        if (!existsSync(directory)) return;
        for (const entry of readdirSync(directory, { withFileTypes: true })) {
            const filePath = path.join(directory, entry.name);
            if (entry.isDirectory()) {
                walk(filePath);
                continue;
            }
            if (entry.isFile() && extensions.has(path.extname(entry.name))) {
                files.push(filePath);
            }
        }
    };

    roots.forEach(walk);
    return files;
}

function hasLikelyMojibake(value: string): boolean {
    return [
        /\u00C3[\u0080-\u00BF\u2018-\u201D]?/,
        /\u00C2[\u0080-\u00BF\u00BF\u00A1]?/,
        /\u00E2(?:\u20AC[\u0080-\u00BF]?|[\u201E\u201C\u201D\u2019])/,
        /\u00D0[\u0080-\u00BF\u0400-\u04FF]?/,
        /\u00D1(?:[\u0080-\u00BF\u0400-\u04FF]|\u20AC)/,
        /\uFFFD/,
    ].some((pattern) => pattern.test(value));
}

function stamp(date: Date): string {
    return date.toISOString().replace(/[:.]/g, '-');
}

function escapeCell(value: string): string {
    return value.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}
