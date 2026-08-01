import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ui } from '../../src/i18n/translations';

const read = (file: string) => readFileSync(file, 'utf8');

const landing = read('src/components/LandingPage.astro');
const segmentLanding = read('src/components/landing/SegmentLandingPage.astro');
const pricing = read('src/components/PricingSection.tsx');
const baseLayout = read('src/layouts/BaseLayout.astro');
const rootPage = read('src/pages/index.astro');
const blogIndex = read('src/pages/[lang]/blog/index.astro');
const blogLayout = read('src/layouts/BlogLayout.astro');
const campusDashboard = read('src/pages/[lang]/campus/index.astro');
const campusAccount = read('src/pages/[lang]/campus/account.astro');
const sitemap = read('src/lib/public-sitemap.ts');
const llms = read('public/llms.txt');
const spanishSegmentLandings = [
    'src/pages/es/espanol-para-vivir-en-espana.astro',
    'src/pages/es/espanol-para-profesionales.astro',
    'src/pages/es/clases-de-conversacion-en-espanol.astro',
].map(read);
const terms = read('src/pages/[lang]/legal/terminos.astro');

describe('public product surface', () => {
    it('keeps the three-person teaching team, including Irene and each portrait', () => {
        expect(ui.es.team.headline).toBe('TRES PROFESORES. UNA IDEA.');
        expect(ui.es.team.members.map((member) => member.name)).toEqual(['ALEJANDRO', 'ALIN']);

        expect(landing).toContain("name: 'IRENE'");
        expect(landing).toContain("languages: ['ES', 'EN', 'CS', 'FR', 'LSE']");
        expect(landing).toContain('const teamMembersWithIrene = [...teamMembers, ireneMemberByLang]');
        expect(landing).toContain('const teamImages = [avatarAlejandro, avatarAlin, avatarIrene]');
        expect(landing).toContain('{teamMembersWithIrene.map((member, index) =>');
        expect(landing).toContain('src={memberImage}');

        for (const portrait of [
            'src/assets/avatar_alejandro_team.png',
            'src/assets/avatar_alin_team.png',
            'src/assets/avatar_irene_team.png',
        ]) {
            expect(existsSync(portrait), portrait).toBe(true);
        }
    });

    it('publishes one target offer while the runtime gate remains authoritative', () => {
        for (const source of [landing, segmentLanding]) {
            expect(source).toContain("isCheckoutEnabled(Astro) ? 'checkout' : 'unavailable'");
            expect(source).toContain('checkoutMode={checkoutMode}');
        }
        expect(landing).toContain("title: checkoutMode === 'checkout'");
        expect(landing).toContain('Payment is not yet enabled while final launch checks are completed');
        expect(segmentLanding).toContain("body: checkoutMode === 'checkout'");
        expect(segmentLanding).toContain('el pago todavía no está habilitado');
        expect(landing).not.toContain('launch gates');
        expect(segmentLanding).not.toContain('gates de lanzamiento');
        expect(landing).not.toContain('while we connect real teacher and schedule inventory');
        expect(segmentLanding).not.toContain('hasta conectar el inventario real');

        expect(pricing).toContain("checkoutMode = 'unavailable'");
        expect(pricing).not.toContain('stripe_price_1m');
        expect(pricing).not.toContain('stripe_price_3m');
        expect(pricing).not.toContain('stripe_price_6m');
        expect(ui.es.pricing.applicationNote).toContain('plazas reales con profesor y horario');
        expect(ui.en.pricing.applicationNote).toMatch(/real places with a teacher and schedule/iu);
        expect(ui.ru.pricing.applicationNote).toContain('преподавателем');
        expect(ui.es.pricing.modal.viewAvailability).toBe('Ver plazas');
        expect(ui.en.pricing.modal.viewAvailability).toBe('View places');
        expect(ui.es.pricing.modal.renewalDisclosure).toContain('259 EUR al reservar');
        expect(ui.es.pricing.modal.renewalDisclosure).toContain('28 días después de la primera clase');
        expect(ui.es.pricing.modal.renewalDisclosure).toContain('autoservicio');
        expect(ui.es.pricing.modal.renewalDisclosure).toContain('máximo inclusivo de 28 días');
        expect(ui.es.pricing.modal.renewalDisclosure).toContain('soporte fuera de ese límite no la mueve automáticamente');
        expect(ui.en.pricing.modal.renewalDisclosure).toContain('when the place is reserved');
        expect(ui.en.pricing.modal.renewalDisclosure).toContain('28 days after the first class');
        expect(ui.en.pricing.modal.renewalDisclosure).toContain('self-service reschedule');
        expect(ui.en.pricing.modal.renewalDisclosure).toContain('inclusive maximum of 28 days');
        expect(ui.en.pricing.modal.renewalDisclosure).toContain('support change outside that limit does not move it automatically');
        expect(ui.ru.pricing.modal.renewalDisclosure).toContain('при бронировании места');
        expect(ui.ru.pricing.modal.renewalDisclosure).toContain('через 28 дней после первого занятия');
        expect(ui.ru.pricing.modal.renewalDisclosure).toContain('самостоятельный перенос');
        expect(ui.ru.pricing.modal.renewalDisclosure).toContain('через 28 дней включительно');
        expect(ui.ru.pricing.modal.renewalDisclosure).toContain('вне этого предела не сдвигает её автоматически');
        expect(landing).toContain('individual_4x50_28d');
        expect(landing).toContain('259 EUR');
        expect(landing).toContain('50 minutos');
        expect(landing).toContain('cada 28 días');
        expect(landing).toContain('antes de la segunda');
        expect(ui.es.hero.subtitle).toContain('entrar en España de verdad');
        expect(ui.es.hero.manifesto).toContain('Conversación, cultura y criterio');
        expect(ui.en.hero.subtitle).toContain('a real way into Spain');
        expect(ui.ru.hero.subtitle).toContain('по-настоящему войти в жизнь Испании');
    });

    it('does not render the retired catalogue or application-first purchase flow', () => {
        const retiredOfferFragments = [
            'Grupo compatible',
            'conversación grupal',
            'Híbrido',
            'bootcamp',
            'Intensivo',
            'SOLICITAR PLAZA',
        ];

        for (const source of spanishSegmentLandings) {
            for (const fragment of retiredOfferFragments) {
                expect(source).not.toContain(fragment);
            }
            expect(source).not.toMatch(/A2\/B1|nivel aproximado A2|nivel mínimo|empezar desde cero|gente con base/iu);
            expect(source).toMatch(/adapta|punto de partida/iu);
            expect(source).toContain('const pricingTranslations = ui.es.pricing');
            expect(source).toContain("ctaText: 'VER OFERTA'");
        }

        expect(JSON.stringify(ui.es.pricing.plans)).toContain('individual_4x50_28d');
        expect(JSON.stringify(ui.es.pricing.plans)).not.toMatch(/group|hybrid|bootcamp|standard/i);
        expect(terms).not.toMatch(/1, 3 y 6|30, 40 o 50|3 o 6 meses/);
        expect(terms).not.toMatch(/1, 3 and 6|30, 40 or 50|3 or 6-month/);
        expect(terms).toContain('La primera cuota de 259 EUR se cobra al reservar la plaza e incluye cuatro clases individuales de 50 minutos');
        expect(terms).toContain('The initial EUR 259 charge is collected when the place is reserved and includes four individual 50-minute classes');
        for (const source of [blogIndex, blogLayout, campusDashboard, campusAccount]) {
            expect(source).not.toMatch(/Solicitar plaza|Apply for a place|Оставить заявку/u);
        }
        expect(blogIndex).toContain('href={`/${lang}/#planes`}');
        expect(blogLayout).toContain("return '/' + lang + '/#planes'");
        expect(campusDashboard).toContain("planStatus === 'unavailable' ? retryHref : `/${lang}/#planes`");
        expect(campusDashboard).toContain('href={`/${lang}/#planes`}');
        expect(campusDashboard).not.toMatch(/Coordinamos disponibilidad manualmente|We coordinate availability manually|Мы согласуем время вручную/u);
        expect(campusDashboard).not.toMatch(/coordinar la primera clase|coordinate the first class|согласования первого занятия/u);
        expect(campusDashboard).toContain("teacherPending: 'El profesor se muestra desde la plaza elegida'");
        expect(campusDashboard).toContain("schedulePending: 'Your dates are shown with the place you choose'");
        expect(campusAccount).toContain('href={`/${lang}/#planes`}');
        expect(campusAccount).not.toMatch(/findCheckoutApproval|stripe_price_[136]m|priceTotalsCents/u);
        expect(llms).toContain('four individual online classes of 50 minutes');
        expect(llms).toContain('EUR 259 per 28-day cycle');
        expect(llms).toContain('days 0, 7, 14 and 21');
        expect(llms).toContain('Initial acquisition is in English for adults who live, work or plan to move to Spain');
        expect(llms).toContain('Russian is limited to a measured pilot');
        expect(llms).not.toMatch(/Grupal Externo|Mensual Estándar|Híbrido Mensual|Intensivo Bootcamp|application-only at launch/iu);
    });

    it('keeps robots and the public sitemap limited to indexable public routes', () => {
        const robots = read('public/robots.txt');

        expect(robots).toContain('User-agent: *');
        expect(robots).toContain('Allow: /');
        expect(robots).toContain('Sitemap: https://espanolhonesto.com/sitemap.xml');
        for (const privatePath of [
            '/api/',
            '/es/campus',
            '/en/campus',
            '/ru/campus',
            '/es/login',
            '/en/login',
            '/ru/login',
            '/demo',
            '/keystatic/',
        ]) {
            expect(robots).toContain(`Disallow: ${privatePath}`);
        }

        expect(sitemap).toContain('PUBLIC_LANGS');
        expect(sitemap).toContain("{ paths: { es: '/', en: '/', ru: '/' } }");
        expect(sitemap).toContain("{ paths: { es: '/blog', en: '/blog', ru: '/blog' } }");
        expect(sitemap).toContain('/espanol-para-vivir-en-espana');
        expect(sitemap).toContain('/espanol-para-profesionales');
        expect(sitemap).toContain('/clases-de-conversacion-en-espanol');
        expect(sitemap).toContain('hreflang="x-default"');
        expect(sitemap).toContain('getPublishedBlogGroups');

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
            expect(sitemap).not.toContain(privateFragment);
        }
    });

    it('keeps draft posts out of every generated public blog surface', () => {
        expect(read('src/content.config.ts')).toContain('draft: z.boolean().default(false)');
        expect(read('src/lib/blog-routes.ts')).toContain('return entry.data.draft !== true');

        for (const publicSurface of [
            'src/pages/[lang]/blog/index.astro',
            'src/pages/[lang]/blog/[slug].astro',
            'src/pages/[lang]/blog/rss.xml.ts',
            'src/pages/og/[slug].png.ts',
        ]) {
            expect(read(publicSurface), publicSurface).toContain('isPublishedBlogPost');
        }
        expect(read('src/lib/public-sitemap.ts')).toContain('getPublishedBlogGroups');
    });

    it('keeps canonical, hreflang and noindex protections on shared and private routes', () => {
        expect(rootPage).toContain("return Astro.redirect('/en', 301)");
        expect(baseLayout).toContain('const canonicalUrl = publicUrl(pageLang, canonicalRoute)');
        expect(baseLayout).toContain('<link rel="canonical" href={canonicalUrl} />');
        expect(baseLayout).toContain("const xDefaultLang = enabledAlternateLangs.has('en') ? 'en' : undefined");
        for (const language of ['es', 'en', 'ru', 'x-default']) {
            expect(baseLayout).toContain(`hreflang="${language}"`);
        }
        expect(baseLayout).toContain(
            "const shouldNoindex = noindex || appEnvironment === 'staging'",
        );
        expect(baseLayout).toContain(
            '{shouldNoindex && <meta name="robots" content="noindex, nofollow" />}',
        );

        for (const privateRoute of [
            'src/layouts/CampusLayout.astro',
            'src/pages/[lang]/login.astro',
            'src/pages/[lang]/reset-password.astro',
            'src/pages/[lang]/success.astro',
            'src/pages/[lang]/cancel.astro',
            'src/pages/[lang]/adult-confirmation.astro',
        ]) {
            expect(read(privateRoute), privateRoute).toContain('noindex={true}');
        }

        for (const demoRoute of ['src/pages/demo.astro', 'src/pages/[lang]/demo.astro']) {
            const source = read(demoRoute);
            expect(source).toContain('Astro.response.status = 404');
            expect(source).toContain("x-robots-tag', 'noindex, nofollow'");
            expect(source).toContain('name="robots" content="noindex, nofollow"');
        }
    });
});
