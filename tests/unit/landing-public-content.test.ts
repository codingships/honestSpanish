import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const landingSource = readFileSync('src/components/LandingPage.astro', 'utf8');
const pricingSource = readFileSync('src/components/PricingSection.tsx', 'utf8');
const leadCaptureSource = readFileSync('src/components/LeadCaptureForm.tsx', 'utf8');
const translationsSource = readFileSync('src/i18n/translations.ts', 'utf8');
const blogLayoutSource = readFileSync('src/layouts/BlogLayout.astro', 'utf8');
const blogIndexSource = readFileSync('src/pages/[lang]/blog/index.astro', 'utf8');
const segmentLandingSource = readFileSync('src/components/landing/SegmentLandingPage.astro', 'utf8');
const tableOfContentsSource = readFileSync('src/components/blog/TableOfContents.astro', 'utf8');
const segmentLivingSource = readFileSync('src/pages/es/espanol-para-vivir-en-espana.astro', 'utf8');
const segmentProfessionalSource = readFileSync('src/pages/es/espanol-para-profesionales.astro', 'utf8');
const segmentConversationSource = readFileSync('src/pages/es/clases-de-conversacion-en-espanol.astro', 'utf8');
const backlog = readFileSync('docs/launch/POST_LAUNCH_BACKLOG.md', 'utf8');
const conversionArchitecture = readFileSync('docs/launch/CONVERSION_ARCHITECTURE.md', 'utf8');
const productsDoc = readFileSync('docs/launch/PRODUCTS.md', 'utf8');
const checklist = readFileSync('docs/launch/CHECKLIST.md', 'utf8');
const levelCheck = readFileSync('docs/launch/LEVEL_CHECK.md', 'utf8');
const finalClosure = readFileSync('docs/launch/FINAL_CLOSURE.md', 'utf8');
const launchMarketingPlan = readFileSync('docs/launch/LAUNCH_MARKETING_PLAN.md', 'utf8');
const contentAuditSource = readFileSync('scripts/launch/content-audit.ts', 'utf8');
const paymentsAuditSource = readFileSync('scripts/launch/payments-audit.ts', 'utf8');

const cp = (...points: number[]) => String.fromCodePoint(...points);
const enye = cp(0x00F1);
const oAcute = cp(0x00F3);
const spanishHeroPromise = `entrar en Espa${enye}a de verdad`;
const spanishHeroManifesto = `Conversaci${oAcute}n, cultura y criterio`;
const russianHeroPromise = cp(
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

function hasLikelyMojibake(value: string) {
    return [
        /\u00C3[\u0080-\u00BF\u2018-\u201D]?/,
        /\u00C2[\u0080-\u00BF\u00BF\u00A1]?/,
        /\u00E2(?:\u20AC[\u0080-\u00BF]?|[\u201E\u201C\u201D\u2019])/,
        /\u00D0[\u0080-\u00BF\u0400-\u04FF]?/,
        /\u00D1(?:[\u0080-\u00BF\u0400-\u04FF]|\u20AC)/,
        /\uFFFD/,
    ].some((pattern) => pattern.test(value));
}

describe('landing public launch content', () => {
    it('keeps the public hero aligned with the launch marketing promise', () => {
        expect(launchMarketingPlan).toContain('Espanol para entrar en Espana de verdad');
        expect(launchMarketingPlan).toContain('conversacion, cultura y criterio');
        expect(translationsSource).toContain(spanishHeroPromise);
        expect(translationsSource).toContain(spanishHeroManifesto);
        expect(translationsSource).toContain('a real way into Spain');
        expect(translationsSource).toContain('Conversation, culture and judgement');
        expect(translationsSource).toContain(russianHeroPromise);
    });

    it('keeps launch-critical public copy free of mojibake markers', () => {
        const publicLaunchSources = [
            landingSource,
            pricingSource,
            leadCaptureSource,
            translationsSource,
            blogLayoutSource,
            blogIndexSource,
            segmentLandingSource,
            segmentLivingSource,
            segmentProfessionalSource,
            segmentConversationSource,
            readFileSync('public/llms.txt', 'utf8'),
        ];

        expect(publicLaunchSources.filter(hasLikelyMojibake)).toEqual([]);
    });

    it('keeps segment and blog routes keyboard-bypassable with named navigation landmarks', () => {
        expect(segmentLandingSource).toContain('href="#main-content"');
        expect(segmentLandingSource).toContain('<main id="main-content" tabindex="-1">');
        expect(segmentLandingSource).toContain('aria-label="Navegación principal"');

        for (const source of [blogIndexSource, blogLayoutSource]) {
            expect(source).toContain('href="#main-content"');
            expect(source).toContain('<main id="main-content" tabindex="-1">');
            expect(source).toContain('aria-label={accessibilityCopy.breadcrumb}');
            expect(source).toContain('aria-current="page"');
        }

        expect(tableOfContentsSource).toContain('aria-labelledby="blog-toc-heading"');
        expect(tableOfContentsSource).toContain('id="blog-toc-heading"');
    });

    it('keeps launch content audit as a second guard for the commercial promise', () => {
        expect(contentAuditSource).toContain('checkCommercialPositioningPromise');
        expect(contentAuditSource).toContain('commercial positioning promise');
        expect(contentAuditSource).toContain('Launch Marketing Plan, public hero and application CTA');
        expect(contentAuditSource).toContain('spanishHeroPromise');
        expect(contentAuditSource).toContain('spanishHeroManifesto');
        expect(contentAuditSource).toContain('russianHeroPromise');
        expect(contentAuditSource).toContain('String.fromCodePoint');
        expect(contentAuditSource).toContain('a real way into Spain');
    });

    it('keeps the course includes and audience sections on the public landing', () => {
        expect(landingSource).toContain("id=\"incluye\"");
        expect(landingSource).toContain('Qué incluye el curso');
        expect(landingSource).toContain('A quién va dirigido');
        expect(landingSource).toContain('What the course includes');
        expect(landingSource).toContain('Who it is for');
        expect(landingSource).toContain('Что входит в курс');
        expect(landingSource).toContain('Для кого это');
    });

    it('keeps class duration and plan-change copy aligned with the actual operation in every language', () => {
        expect(translationsSource).toContain('con duraciones de 30, 40 o 50 minutos');
        expect(translationsSource).toContain('with 30, 40 or 50-minute options');
        expect(translationsSource).toContain('продолжительностью 30, 40 или 50 минут');
        expect(translationsSource).not.toContain('Video call, one hour');
        expect(translationsSource).not.toContain('Видеозвонок, один час');

        expect(translationsSource).toContain('Pídenos el cambio antes de la renovación');
        expect(translationsSource).toContain('Ask us before renewal');
        expect(translationsSource).toContain('Сообщите нам об этом до продления');
        expect(translationsSource).not.toContain('You can upgrade or downgrade at any time');
    });

    it('uses the approved Irene portrait in the public team section', () => {
        expect(landingSource).toContain('const ireneMemberByLang');
        expect(landingSource).toContain("name: 'IRENE'");
        expect(landingSource).toContain("languages: ['ES', 'EN', 'CS', 'FR', 'LSE']");
        expect(landingSource).toContain("import avatarIrene from '../assets/avatar_irene.jpg'");
        expect(landingSource).toContain('const teamImages = [avatarAlejandro, avatarAlin, avatarIrene]');
        expect(landingSource).toContain('<Image');
        expect(landingSource).toContain('src={memberImage}');
        expect(landingSource).toContain('widths={[320, 480, 640]}');
        expect(landingSource).toContain('const fallbackInitials = member.name.slice(0, 2).toUpperCase()');
        expect(landingSource).not.toContain('const avatarIrenePlaceholder = avatarAlin');
        expect(backlog).not.toContain('Foto definitiva de Irene');
        expect(backlog).not.toContain('fallback neutro de iniciales');
    });

    it('keeps plan anchors aligned for navigation, schema and legacy links', () => {
        expect(landingSource).toContain('href="#planes"');
        expect(pricingSource).toContain('<section id="planes"');
        expect(pricingSource).toContain('aria-labelledby="plans-heading"');
        expect(pricingSource).toContain('<span id="pricing"');
        expect(pricingSource).toContain('id="plans-heading"');
    });

    it('keeps public plan CTAs application-only and leaves approved checkout inside campus', () => {
        expect(landingSource).toContain("const checkoutMode = 'application' as const");
        expect(segmentLandingSource).toContain("const checkoutMode = 'application' as const");
        expect(landingSource).not.toContain('isCheckoutEnabled');
        expect(landingSource).toContain('checkoutMode={checkoutMode}');
        expect(segmentLandingSource).toContain('checkoutMode={checkoutMode}');
        expect(pricingSource).toContain("checkoutMode?: 'application' | 'checkout'");
        expect(pricingSource).toContain("checkoutMode = 'application'");
        expect(pricingSource).toContain('requestApplication');
        expect(pricingSource).toContain('eh:preferred-package-selected');
        expect(pricingSource).toContain('eh_preferred_package');
        expect(pricingSource).toContain("checkoutMode === 'checkout' && checkoutReady");
        expect(pricingSource).toContain('copy.applicationNote');
        expect(translationsSource).toContain('La solicitud de plaza se revisa antes de activar compra o pago.');
        expect(translationsSource).toContain('Your application is reviewed before purchase or payment is enabled.');
        expect(translationsSource).toContain('Заявка рассматривается до включения покупки или оплаты.');
        expect(conversionArchitecture).toContain('Convertir visitantes cualificados en solicitudes de plaza revisables');
        for (const source of [pricingSource, translationsSource, segmentLivingSource, segmentProfessionalSource, segmentConversationSource]) {
            expect(source).not.toContain('No se pudo iniciar el checkout');
            expect(source).not.toContain('Continuar al pago');
            expect(source).not.toContain('Continue to payment');
            expect(source).not.toContain('Перейти к оплате');
            expect(source).not.toContain('después pago.');
        }
    });

    it('keeps no-real-payments launch mode covered by the payments audit', () => {
        expect(paymentsAuditSource).toContain('reviewNoRealPaymentsLaunchMode');
        expect(paymentsAuditSource).toContain('no-real-payments launch mode');
        expect(paymentsAuditSource).toContain('CHECKOUT_ENABLED=false');
        expect(paymentsAuditSource).toContain('Checkout is disabled');
        expect(paymentsAuditSource).toContain('public CTAs remain application-first');
        expect(productsDoc).toContain('Mantener `CHECKOUT_ENABLED=false` para operar sin cobros reales');
        expect(finalClosure).toContain('Rollback sin nuevos cobros');
    });

    it('does not hardcode the Spanish contact fallback for missing prices', () => {
        expect(pricingSource).toContain('hasPrice: false');
        expect(pricingSource).toContain('hasPrice: true');
        expect(pricingSource).toContain('priceDisplay.hasPrice');
        expect(pricingSource).not.toContain("return 'Consultar'");
        expect(pricingSource).not.toContain("priceDisplay !== 'Consultar'");
    });

    it('keeps group plans framed around compatibility instead of guaranteed community', () => {
        expect(translationsSource).toContain('grupo compatible');
        expect(translationsSource).toContain('compatible group');
        expect(pricingSource).toContain('Conversación grupal cuando haya compatibilidad');
        expect(pricingSource).toContain('Group conversation when compatible');
        expect(productsDoc).toContain('Sesiones grupales guiadas si hay grupo compatible');
        expect(productsDoc).toContain('Solo si hay compatibilidad de nivel, intereses y ritmo');
        expect(productsDoc).toContain('El plan `group` no incluye clases privadas');
        expect(productsDoc).toContain('No debe venderse como sustituto barato de una clase privada');
        expect(pricingSource).not.toContain('Sesiones grupales incluidas');
        expect(pricingSource).not.toContain('Group sessions included');
    });

    it('keeps community framed as fit-based contact instead of a guaranteed public community', () => {
        expect(landingSource).toContain('const communityDetails');
        expect(landingSource).toContain('id="comunidad"');
        expect(landingSource).toContain('Comunidad con encaje, no grupos de relleno');
        expect(landingSource).toContain('contacto con España');
        expect(landingSource).toContain('si hay compatibilidad real');
        expect(landingSource).toContain('No vendemos una comunidad artificial');
        expect(landingSource).not.toContain('Telegram');
        expect(landingSource).not.toContain('grupo garantizado');
        expect(conversionArchitecture).toContain('comunidad como criterio de encaje');
        expect(conversionArchitecture).toContain('No se usa como promesa de Telegram');
    });

    it('keeps the public application form useful for fit and level review', () => {
        expect(leadCaptureSource).toContain('name="currentLevel"');
        expect(leadCaptureSource).toContain('name="learningGoal"');
        expect(leadCaptureSource).toContain('name="availability"');
        expect(leadCaptureSource).toContain('preferredPackage');
        expect(leadCaptureSource).toContain('Plan de interes');
        expect(leadCaptureSource).toContain('sourcePath');
        expect(leadCaptureSource).toContain('role="alert"');
    });

    it('keeps the Spanish home linked to priority SEO segment pages', () => {
        expect(landingSource).toContain('const seoEntryRoutes');
        expect(landingSource).toContain('id="rutas"');
        expect(landingSource).toContain('/es/espanol-para-vivir-en-espana');
        expect(landingSource).toContain('/es/espanol-para-profesionales');
        expect(landingSource).toContain('/es/clases-de-conversacion-en-espanol');
        expect(landingSource).toContain('Clases de conversación en español');
        expect(landingSource).toContain('Si ya sabes por qué necesitas español');
        expect(landingSource).not.toContain('Si ya sabes por que necesitas espanol');
        expect(landingSource).toContain('Ver ruta');
    });

    it('keeps public conversion centered on reviewed applications before payment', () => {
        const segmentSource = readFileSync('src/components/landing/SegmentLandingPage.astro', 'utf8');

        expect(landingSource).toContain('Qué pasa después de solicitar plaza');
        expect(landingSource).toContain('No te mandamos directo a pagar');
        expect(landingSource).toContain('prueba automática ligera');
        expect(landingSource).toContain('Sólo después de confirmar encaje y disponibilidad');
        expect(conversionArchitecture).toContain('Solicitar plaza');
        expect(conversionArchitecture).toContain('Revisar plan de interes, nivel aproximado, objetivo, disponibilidad y pagina de origen');
        expect(conversionArchitecture).toContain('Comprar o activar pago solo cuando haya encaje');
        expect(conversionArchitecture).toContain('Pagos live antes del cierre final');
        expect(conversionArchitecture).toContain('Aprendizaje Sin Telemetria Rica');
        expect(conversionArchitecture).toContain('rutas que convierten');
        expect(segmentSource).toContain('Después de solicitar plaza');
        expect(segmentSource).toContain('Primero encaje. Después plan.');
        expect(segmentSource).toContain('prueba automática ligera');
        expect(segmentSource).toContain('Sólo después de confirmar encaje');
        expect(blogLayoutSource).toContain('blogCta');
        expect(blogLayoutSource).toContain("`/${lang}#contacto`");
        expect(blogLayoutSource).toContain('Solicitar plaza');
        expect(blogLayoutSource).not.toContain("`/${lang}/#planes`");
        expect(blogIndexSource).toContain('blogIndexCta');
        expect(blogIndexSource).toContain("href={`/${lang}#contacto`}");
        expect(blogIndexSource).toContain('Solicitar plaza');
        expect(conversionArchitecture).toContain('indice y posts enlazan al formulario de solicitud');
    });

    it('keeps level-test scope clear during the release candidate', () => {
        expect(conversionArchitecture).toContain('La solicitud de plaza no es una prueba de nivel definitiva');
        expect(conversionArchitecture).toContain('documento breve + video o audio de habla');
        expect(conversionArchitecture).toContain('docs/launch/LEVEL_CHECK.md');
        expect(checklist).toContain('Prueba de nivel definitiva decidida para RC');
        expect(checklist).toContain('docs/launch/LEVEL_CHECK.md');
        expect(backlog).toContain('solo recoge nivel aproximado y contexto de encaje');
        expect(backlog).toContain('seguir `docs/launch/LEVEL_CHECK.md`');
        expect(backlog).toContain('privacidad, consentimiento, retencion, canal de envio y rubricacion');
        expect(levelCheck).toContain('Estado: diagnostico ligero v1 implementado; prueba formal definitiva sigue fuera del RC');
        expect(levelCheck).toContain('Diagnostico Ligero V1 Implementado');
        expect(levelCheck).toContain('documento breve + video/audio de habla + rubrica manual');
        expect(levelCheck).toContain('No se presenta como certificado');
        expect(levelCheck).toContain('Periodo de retencion');
        expect(levelCheck).toContain('No guardar documentos, audios, videos, enlaces privados ni datos personales');
        expect(finalClosure).toContain('Decision De Prueba De Nivel');
        expect(finalClosure).toContain('docs/launch/LEVEL_CHECK.md');
        expect(finalClosure).toContain('privacidad/consentimiento/retencion/canal de envio');
        expect(finalClosure).toContain('pnpm launch:accessibility');
        expect(finalClosure).toContain('No usar documentos, audio o video de nivel en evidencias del repo');
    });

    it('keeps postponed marketing ideas out of the release candidate scope', () => {
        expect(checklist).toContain('Analitica/telemetria decidida para RC: pospuesta deliberadamente');
        expect(checklist).toContain('Reviews reales decididas para RC: pospuestas');
        expect(checklist).toContain('Canal publico de Telegram decidido para RC: pospuesto');
        expect(checklist).toContain('Backlog post-launch revisado para el alcance RC actual');
        expect(backlog).toContain('Telemetria de uso | Pospuesta');
        expect(backlog).toContain('Reviews/testimonios | Pospuesta');
        expect(backlog).toContain('Canal publico de Telegram | Pospuesta');
        expect(backlog).toContain('No activar telemetria sin revisar legal/cookies/consentimiento');
        expect(backlog).toContain('No publicar reviews sin fuente real y permiso');
        expect(backlog).toContain('No enlazar Telegram si no hay canal');
    });

    it('keeps launch content audit guarding public editor notes without blocking final-only legal placeholders', () => {
        expect(contentAuditSource).toContain('checkPublicSourceEditorNotes');
        expect(contentAuditSource).toContain('public source editor notes');
        expect(contentAuditSource).toContain('isFinalOnlyLegalSource');
        expect(contentAuditSource).toContain('hasPublicEditorMarker');
        expect(contentAuditSource).toContain('El redactor debe completar');
        expect(contentAuditSource).toContain('Sed ut perspiciatis');
        expect(contentAuditSource).toContain('public non-legal source editor notes');
        expect(contentAuditSource).toContain("normalized.startsWith('src/pages/[lang]/legal/')");
    });
});
