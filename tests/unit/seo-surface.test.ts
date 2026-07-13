import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const read = (file: string) => readFileSync(file, 'utf8');

const hasLikelyMojibake = (value: string) => [
    /\u00C3[\u0080-\u00BF\u2018-\u201D]?/,
    /\u00C2[\u0080-\u00BF\u00BF\u00A1]?/,
    /\u00E2(?:\u20AC[\u0080-\u00BF]?|[\u201E\u201C\u201D\u2019])/,
    /\u00D0[\u0080-\u00BF\u0400-\u04FF]?/,
    /\u00D1(?:[\u0080-\u00BF\u0400-\u04FF]|\u20AC)/,
    /\uFFFD/,
].some((pattern) => pattern.test(value));

describe('SEO and LLM public surface', () => {
    it('keeps robots.txt permissive for public pages and restrictive for private/demo routes', () => {
        const robots = read('public/robots.txt');

        expect(robots).toContain('User-agent: *');
        expect(robots).toContain('Allow: /');
        expect(robots).toContain('Sitemap: https://espanolhonesto.com/sitemap-index.xml');

        for (const privatePath of [
            '/api/',
            '/es/campus/',
            '/en/campus/',
            '/ru/campus/',
            '/es/login',
            '/en/login',
            '/ru/login',
            '/demo',
            '/es/demo',
            '/en/demo',
            '/ru/demo',
            '/keystatic/',
        ]) {
            expect(robots).toContain(`Disallow: ${privatePath}`);
        }

        for (const publicPath of ['/es', '/en', '/ru', '/es/blog', '/es/legal']) {
            expect(robots).not.toContain(`Disallow: ${publicPath}\n`);
        }
    });

    it('keeps llms.txt focused on public source material and current packages', () => {
        const llms = read('public/llms.txt');
        const intentMap = read('docs/launch/SEO_INTENT_MAP.md');

        expect(llms).toContain('# Español Honesto');
        expect(llms).toContain('https://espanolhonesto.com/es');
        expect(llms).toContain('https://espanolhonesto.com/sitemap-index.xml');
        expect(llms).toContain('## Who It Is For');
        expect(llms).toContain('Adults living in Spain or preparing to move to Spain, especially age 30+ and A2/B1 or above');
        expect(llms).toContain('Students around A2, B1 or B2');
        expect(llms).toContain('Professionals who need Spanish for work');
        expect(llms).toContain('Community is a direction of the project');
        expect(llms).toContain('https://espanolhonesto.com/es/espanol-para-vivir-en-espana');
        expect(llms).toContain('https://espanolhonesto.com/es/espanol-para-profesionales');
        expect(llms).toContain('https://espanolhonesto.com/es/clases-de-conversacion-en-espanol');
        expect(intentMap).toContain('/es/espanol-para-vivir-en-espana');
        expect(intentMap).toContain('/es/espanol-para-profesionales');
        expect(intentMap).toContain('/es/clases-de-conversacion-en-espanol');
        expect(intentMap).toContain('tres paginas SEO especificas');
        expect(intentMap).not.toContain('1-2 paginas SEO especificas');
        expect(intentMap).toContain('solicitar plaza');
        expect(intentMap).toContain('no promesa local presencial');
        expect(llms).toContain('## Teaching Team');
        expect(llms).toContain('Alejandro: head Spanish teacher and UCM linguist');
        expect(llms).toContain('Irene: Spanish teacher with Spanish, English, Czech, French and Spanish Sign Language');
        expect(llms).toContain('## Current Public Course Packages');
        expect(llms).toContain('Grupal Externo');
        expect(llms).toContain('4 guided group conversation sessions per month');
        expect(llms).toContain('It does not include private classes');
        expect(llms).not.toContain('Grupal Externo: 4 private classes per month');
        expect(llms).toContain('Mensual Estándar');
        expect(llms).toContain('Híbrido Mensual');
        expect(llms).toContain('compatible group conversation when available and two-teacher follow-up');
        expect(llms).toContain('Intensivo Bootcamp');
        expect(llms).toContain('For current prices, duration totals and availability');
        expect(llms).toContain('Do not quote a price from this file');
        expect(llms).toContain('only Mensual Estándar and Intensivo Bootcamp may proceed to an approved checkout');
        expect(llms).toContain('Grupal Externo and Híbrido Mensual accept applications but do not offer checkout');
        expect(llms).not.toMatch(/\b(?:50|145|150|345) EUR\/month/);
        expect(llms).toContain('## How To Apply');
        expect(llms).toContain('The primary public action is to apply for a place, not to buy immediately.');
        expect(llms).toContain('https://espanolhonesto.com/es#contacto');
        expect(llms).toContain('reviews fit, level, availability and expectations before recommending a plan');
        expect(llms).toContain('Do not describe group conversation, community, payment or a human level test as guaranteed');
        expect(llms).toContain('## How Assistants Should Describe Espanol Honesto');
        expect(llms).toContain('live Spain through conversation, culture, judgement and real contact with the country');
        expect(llms).toContain('culturally curious adults, often 30+ and A2/B1 or above');
        expect(llms).toContain('Visitors should request a place first');
        expect(llms).toContain('fit-based contact with Spain through guided conversation');
        expect(llms).toContain('Do not describe it as a guaranteed public community, a Telegram channel, a guaranteed group or a cheap replacement for private classes');
        expect(llms).toContain('https://espanolhonesto.com/es#incluye');
        expect(llms).toContain('https://espanolhonesto.com/es#planes');
        expect(llms).toContain('## Segment Page Source Notes');
        expect(llms).toContain('Spanish for living in Spain uses Madrid, Oviedo, Toledo/Castilla-La Mancha and Barcelona');
        expect(llms).toContain('Spanish for professionals covers meetings, clients, teams, interviews, presentations');
        expect(llms).toContain('Spanish conversation classes covers A2/B1+ learners who understand Spanish but freeze when speaking');
        expect(llms).toContain('not local in-person city pages');
        expect(llms).toContain('## Do Not Use As Public Source Material');

        for (const privateHint of ['/api', '/campus', 'Login', 'Demo URLs', 'Keystatic']) {
            expect(llms).toContain(privateHint);
        }

        expect(llms).not.toMatch(/\b(?:essential|premium)\b/i);
        expect(llms).not.toContain('buy immediately without review');
        expect(llms).not.toContain('guaranteed human level test');
        expect(llms).not.toMatch(/\b(?:is|offers|has)\s+(?:a\s+)?guaranteed public community at launch\b/i);
        expect(llms).not.toMatch(/\b(?:has|offers)\s+(?:an?\s+)?(?:active\s+)?Telegram channel\b/i);
    });

    it('keeps the public sitemap source limited to indexable public pages', () => {
        const sitemapSource = read('src/pages/sitemap-public.xml.ts');
        const astroConfig = read('astro.config.mjs');

        expect(sitemapSource).toContain("const LANGS = ['es', 'en', 'ru']");
        expect(sitemapSource).toContain("{ path: '/', changefreq: 'weekly', priority: '1.0' }");
        expect(sitemapSource).toContain("{ path: '/blog'");
        expect(sitemapSource).toContain("const ES_SEGMENT_PAGES");
        expect(sitemapSource).toContain('/espanol-para-vivir-en-espana');
        expect(sitemapSource).toContain('/espanol-para-profesionales');
        expect(sitemapSource).toContain('/clases-de-conversacion-en-espanol');
        expect(sitemapSource).toContain('hreflang="x-default"');
        expect(sitemapSource).toContain('getCollection');
        expect(astroConfig).toContain("page !== 'https://espanolhonesto.com/'");
        expect(astroConfig).toContain("!page.includes('/legal')");

        for (const privateFragment of [
            '/campus',
            '/login',
            '/legal',
            '/reset-password',
            '/success',
            '/cancel',
            '/demo',
            '/api',
            '/keystatic',
        ]) {
            expect(sitemapSource).not.toContain(privateFragment);
        }
    });

    it('keeps the live-domain probe aligned with current public sitemap and llms conventions', () => {
        const liveDomainProbe = read('scripts/launch/live-domain-readonly-evidence.ts');

        expect(liveDomainProbe).toContain('/sitemap-0.xml');
        expect(liveDomainProbe).toContain('sitemap-public.xml or sitemap-0.xml');
        expect(liveDomainProbe).toContain("body.includes('# Espa\\u00f1ol Honesto')");
        expect(liveDomainProbe).toContain("body.includes('# Espanol Honesto')");
        expect(liveDomainProbe).not.toContain("'# Espanol Honesto',");
    });

    it('keeps Keystatic out of production builds even when its flag is left enabled', () => {
        const astroConfig = read('astro.config.mjs');

        expect(astroConfig).toContain("env.KEYSTATIC_ENABLED === 'true' && process.env.NODE_ENV !== 'production'");
    });

    it('guards landing FAQ structured data for answer engines', () => {
        const landingSchema = read('src/lib/landing-schema.ts');
        const seoAudit = read('scripts/launch/seo-audit.ts');
        const seoFinal = read('docs/launch/SEO_LLM_FINAL.md');

        expect(landingSchema).toContain("'@type': 'FAQPage'");
        expect(landingSchema).toContain("'@type': 'ApplyAction'");
        expect(landingSchema).toContain('#contacto');
        expect(landingSchema).toContain("translate('faq.items')");
        expect(landingSchema).toContain('acceptedAnswer');
        expect(seoAudit).toContain('ApplyAction');
        expect(seoAudit).toContain('application-first course actions');
        expect(seoAudit).toContain('visible FAQ data');
        expect(seoAudit).toContain('faq.items');
        expect(seoAudit).toContain('acceptedAnswer');
        expect(seoFinal).toContain('ApplyAction');
        expect(seoFinal).toContain('solicitud de plaza, no a compra inmediata');
        expect(seoFinal).toContain('FAQPage` desde FAQ visible');
    });

    it('keeps encoding sanity in the SEO launch audit', () => {
        const seoAudit = read('scripts/launch/seo-audit.ts');

        expect(seoAudit).toContain('reviewEncodingSanity');
        expect(seoAudit).toContain('encoding sanity');
        expect(seoAudit).toContain('hasLikelyMojibake');
        expect(seoAudit).toContain('Launch-critical public source files');
    });

    it('keeps public landing, segment, blog, RSS, OG and LLM source text free of mojibake markers', () => {
        const publicSources = [
            'src/components/LandingPage.astro',
            'src/components/landing/SegmentLandingPage.astro',
            'src/pages/es/espanol-para-vivir-en-espana.astro',
            'src/pages/es/espanol-para-profesionales.astro',
            'src/pages/es/clases-de-conversacion-en-espanol.astro',
            'src/pages/[lang]/blog/index.astro',
            'src/layouts/BlogLayout.astro',
            'src/pages/[lang]/blog/rss.xml.ts',
            'src/pages/og/[slug].png.ts',
            'public/llms.txt',
        ];

        for (const file of publicSources) {
            expect(hasLikelyMojibake(read(file)), file).toBe(false);
        }

        expect(read('src/components/LandingPage.astro')).toContain('Espa\u00f1ol');
        expect(read('src/components/landing/SegmentLandingPage.astro')).toContain('Despu\u00e9s de solicitar plaza');
        expect(read('src/pages/es/espanol-para-vivir-en-espana.astro')).toContain('\u00bfQu\u00e9 pasa si no hay grupo compatible?');
        expect(read('src/pages/es/espanol-para-profesionales.astro')).toContain('\u00bfQu\u00e9 se trabaja en las clases?');
        expect(read('src/pages/es/clases-de-conversacion-en-espanol.astro')).toContain('Clases de conversaci\u00f3n en espa\u00f1ol online');
        expect(read('src/pages/[lang]/blog/index.astro')).toContain('Espa\u00f1a');
        expect(read('src/layouts/BlogLayout.astro')).toContain('Espa\u00f1ol Honesto');
        expect(read('src/pages/[lang]/blog/rss.xml.ts')).toContain('Aprende espa\u00f1ol');
        expect(read('src/pages/og/[slug].png.ts')).toContain('Art\u00edculos');
        expect(read('public/llms.txt')).toContain('# Espa\u00f1ol Honesto');
    });

    it('keeps customer discovery in the final SEO/LLM workflow without rich telemetry', () => {
        const seoAudit = read('scripts/launch/seo-audit.ts');
        const seoFinal = read('docs/launch/SEO_LLM_FINAL.md');
        const launchMarketingPlan = read('docs/launch/LAUNCH_MARKETING_PLAN.md');

        expect(seoFinal).toContain('Aprendizaje De Clientes Sin Telemetria Rica');
        expect(seoFinal).toContain('familias de consultas');
        expect(seoFinal).toContain('sourcePath');
        expect(seoFinal).toContain('No activar telemetria de producto/cookies');
        expect(seoFinal).toContain('descripcion autocontenida para asistentes');
        expect(seoFinal).toContain('comunidad con encaje');
        expect(seoFinal).toContain('checkout inmediato');
        expect(seoAudit).toContain('customer discovery loop');
        expect(seoAudit).toContain('aggregated application source paths');
        expect(seoAudit).toContain('positioning fit');
        expect(seoAudit).toContain('marketing plan parity');
        expect(seoAudit).toContain('docs/launch/LAUNCH_MARKETING_PLAN.md');
        expect(seoAudit).toContain('SEO/LLM final workflow is explicitly tied to the canonical launch marketing plan');
        expect(seoAudit).toContain('Compare final snippets, `/llms.txt`, segment pages and assistant answers');
        expect(seoFinal).toContain('Plan comercial canonico');
        expect(seoFinal).toContain('docs/launch/LAUNCH_MARKETING_PLAN.md');
        expect(seoFinal).toContain('promesa, cliente principal, jerarquia de planes');
        expect(launchMarketingPlan).toContain('Espanol para entrar en Espana de verdad');
        expect(launchMarketingPlan).toContain('Jerarquia recomendada');
        expect(seoAudit).toContain('adults/professionals 30+ A2/B1+');
        expect(seoAudit).toContain('request a place first');
        expect(seoAudit).toContain('active Telegram, guaranteed group, public community, immediate checkout or universal human level test');
        expect(read('docs/launch/SEO_INTENT_MAP.md')).toContain('comunidad como direccion, no como promesa cerrada');
        expect(read('docs/launch/SEO_INTENT_MAP.md')).toContain('Siguiente Expansion Recomendada');
        expect(read('docs/launch/SEO_INTENT_MAP.md')).toContain('No crear ahora paginas locales separadas');
        expect(read('docs/launch/SEO_INTENT_MAP.md')).toContain('Convierte a solicitud de plaza, no a compra inmediata');
        expect(read('docs/launch/CONVERSION_ARCHITECTURE.md')).toContain('prueba automatica ligera');
    });

    it('keeps Spanish segment pages useful for answer engines without overpromising', () => {
        const segmentComponent = read('src/components/landing/SegmentLandingPage.astro');
        const vivirPage = read('src/pages/es/espanol-para-vivir-en-espana.astro');
        const profesionalesPage = read('src/pages/es/espanol-para-profesionales.astro');
        const conversationPage = read('src/pages/es/clases-de-conversacion-en-espanol.astro');
        const intentMap = read('docs/launch/SEO_INTENT_MAP.md');
        const seoAudit = read('scripts/launch/seo-audit.ts');
        const seoFinal = read('docs/launch/SEO_LLM_FINAL.md');

        expect(segmentComponent).toContain('Respuestas para decidir');
        expect(segmentComponent).toContain('Contextos de uso');
        expect(segmentComponent).toContain('contexts.items.map');
        expect(segmentComponent).toContain('answers.items.map');
        expect(segmentComponent).toContain('applicationSteps');
        expect(segmentComponent).toContain('Después de solicitar plaza');
        expect(segmentComponent).toContain('Primero encaje. Después plan.');
        expect(seoAudit).toContain('reviewSegmentAnswerBlocks');
        expect(seoAudit).toContain('segment answer blocks');
        expect(seoAudit).toContain('Respuestas AEO/FAQ de segmentos');
        expect(seoFinal).toContain('Respuestas AEO/FAQ de segmentos');
        expect(seoFinal).toContain('sin prometer grupos, reviews, Telegram ni prueba de nivel definitiva');

        for (const page of [vivirPage, profesionalesPage, conversationPage]) {
            expect(page).toContain("const answers = {");
            expect(page).toContain('contexts={{');
            expect(page).toContain("'@type': 'FAQPage'");
            expect(page).toContain('acceptedAnswer');
            expect(page).toContain('SOLICITAR PLAZA');
        }

        expect(vivirPage).toContain('¿Qué pasa si no hay grupo compatible?');
        expect(vivirPage).toContain('¿Qué incluye el curso?');
        expect(vivirPage).toContain('documento vivo de clase');
        expect(vivirPage).toContain('No vendemos un grupo como si existiera');
        expect(vivirPage).toContain('Conversación, cultura y contacto real');
        expect(vivirPage).toContain('Madrid sirve para practicar small talk');
        expect(vivirPage).toContain('Barcelona abre conversación sobre trabajo internacional');
        expect(profesionalesPage).toContain('¿Qué se trabaja en las clases?');
        expect(profesionalesPage).toContain('¿Qué incluye el curso?');
        expect(profesionalesPage).toContain('soporte desde el campus');
        expect(profesionalesPage).toContain('reuniones, entrevistas, clientes, equipo');
        expect(profesionalesPage).toContain('Intervenir sin preparar cada frase');
        expect(profesionalesPage).toContain('La parte que ocurre fuera de la reunión');
        expect(conversationPage).toContain('Clases de conversación en español online');
        expect(conversationPage).toContain('¿Se corrigen errores o sólo se habla?');
        expect(conversationPage).toContain('No vendemos grupos garantizados');
        expect(conversationPage).toContain('Small talk');
        expect(conversationPage).toContain('Reparación');
        expect(conversationPage).toContain('pasar de español pasivo a español usable');
        expect(conversationPage).toContain('HABLAR');
        expect(conversationPage).toContain('CONGELARTE');
        expect(intentMap).toContain('FAQPage');
        expect(intentMap).toContain('contextos concretos');
        expect(intentMap).toContain('Esto no cierra `seo_llm_final`');
    });

    it('keeps draft blog posts out of public blog surfaces', () => {
        expect(read('src/content.config.ts')).toContain('draft: z.boolean().default(false)');
        expect(read('src/lib/blog-routes.ts')).toContain('isPublishedBlogPost');

        for (const file of [
            'src/pages/[lang]/blog/index.astro',
            'src/pages/[lang]/blog/[slug].astro',
            'src/pages/[lang]/blog/rss.xml.ts',
            'src/pages/sitemap-public.xml.ts',
            'src/pages/og/[slug].png.ts',
        ]) {
            expect(read(file)).toContain('isPublishedBlogPost');
        }

        for (const draftFile of [
            'src/content/blog/primer-post/index.mdoc',
            'src/content/blog/es/como-escribir-correo-formal-espanol-plantillas.md',
            'src/content/blog/es/cuando-usar-tu-usted-trabajo-espana.md',
            'src/content/blog/es/espanol-profesionales-guia-definitiva-trabajar-espana.md',
            'src/content/blog/es/sindrome-impostor-trabajando-espanol.md',
            'src/content/blog/es/vocabulario-reuniones-trabajo-espanol.md',
        ]) {
            expect(read(draftFile)).toContain('draft: true');
        }
    });

    it('keeps public blog surfaces connected to the application flow', () => {
        const blogLayout = read('src/layouts/BlogLayout.astro');
        const blogIndex = read('src/pages/[lang]/blog/index.astro');
        const conversionArchitecture = read('docs/launch/CONVERSION_ARCHITECTURE.md');

        expect(blogLayout).toContain('blogCta');
        expect(blogLayout).toContain("`/${lang}#contacto`");
        expect(blogLayout).toContain("`/${lang}${post.data.ctaLink}`");
        expect(blogLayout).toContain('Solicitar plaza');
        expect(blogLayout).toContain('Apply for a place');
        expect(blogLayout).toContain('Оставить заявку');
        expect(blogLayout).not.toContain("`/${lang}/#planes`");
        expect(blogIndex).toContain('blogIndexCta');
        expect(blogIndex).toContain("href={`/${lang}#contacto`}");
        expect(conversionArchitecture).toContain('indice y posts enlazan al formulario de solicitud');

        for (const professionalPost of [
            'src/content/blog/es/como-escribir-correo-formal-espanol-plantillas.md',
            'src/content/blog/es/cuando-usar-tu-usted-trabajo-espana.md',
            'src/content/blog/es/espanol-profesionales-guia-definitiva-trabajar-espana.md',
            'src/content/blog/es/sindrome-impostor-trabajando-espanol.md',
            'src/content/blog/es/vocabulario-reuniones-trabajo-espanol.md',
        ]) {
            expect(read(professionalPost)).toContain('ctaLink: "/espanol-para-profesionales"');
        }
    });

    it('keeps canonical, hreflang, OG and noindex primitives in the shared layout', () => {
        const layout = read('src/layouts/BaseLayout.astro');

        expect(layout).toContain("const siteUrl = 'https://espanolhonesto.com'");
        expect(layout).toContain('<link rel="canonical" href={canonicalUrl} />');
        expect(layout).toContain('hreflang="es"');
        expect(layout).toContain('hreflang="en"');
        expect(layout).toContain('hreflang="ru"');
        expect(layout).toContain('hreflang="x-default"');
        expect(layout).toContain('property="og:image"');
        expect(layout).toContain('name="robots" content="noindex, nofollow"');
        expect(layout).toContain('Content-Type\', \'text/html; charset=utf-8');
    });

    it('forces noindex metadata for staging HTML without changing public production indexing', () => {
        const layout = read('src/layouts/BaseLayout.astro');
        const legalLayout = read('src/layouts/LegalLayout.astro');
        const logout = read('src/pages/[lang]/logout.astro');

        expect(layout).toContain("const appEnvironment = (import.meta.env.PUBLIC_APP_ENV || '').trim().toLowerCase()");
        expect(layout).toContain("const shouldNoindex = noindex || appEnvironment === 'staging'");
        expect(layout).toContain('{shouldNoindex && <meta name="robots" content="noindex, nofollow" />}');
        expect(legalLayout).toContain("stagingNoindex ? 'noindex, nofollow' : 'noindex, follow'");
        expect(logout).toContain("=== 'staging'");
        expect(logout).toContain('{stagingNoindex && <meta name="robots" content="noindex, nofollow" />}');
    });

    it('keeps private and demo route noindex guards in place', () => {
        const privateSources = [
            read('src/layouts/CampusLayout.astro'),
            read('src/pages/[lang]/login.astro'),
            read('src/pages/[lang]/reset-password.astro'),
            read('src/pages/[lang]/success.astro'),
            read('src/pages/[lang]/cancel.astro'),
        ];

        for (const source of privateSources) {
            expect(source).toContain('noindex={true}');
        }

        for (const demoRoute of ['src/pages/demo.astro', 'src/pages/[lang]/demo.astro']) {
            const source = read(demoRoute);
            expect(source).toContain('Astro.response.status = 404');
            expect(source).toContain("x-robots-tag', 'noindex, nofollow'");
            expect(source).toContain('name="robots" content="noindex, nofollow"');
        }
    });
});
