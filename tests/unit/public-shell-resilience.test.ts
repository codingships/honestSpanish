import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PUBLIC_SHELL_CACHE_CONTROL, applyHostedSecurityHeaders } from '../../src/lib/security-headers';

const homePages = [
    'src/pages/en/index.astro',
    'src/pages/es/index.astro',
    'src/pages/ru/index.astro',
];
const segmentPages = [
    'src/pages/es/espanol-para-vivir-en-espana.astro',
    'src/pages/es/espanol-para-profesionales.astro',
    'src/pages/es/clases-de-conversacion-en-espanol.astro',
];
const staticRenderSources = [
    ...segmentPages,
    'src/components/LandingPage.astro',
    'src/components/landing/SegmentLandingPage.astro',
    'src/lib/landing-data.ts',
];

const read = (path: string) => readFileSync(path, 'utf8');

describe('resilient public acquisition shell', () => {
    it('keeps segment landings prerendered from the static offer contract', () => {
        for (const path of segmentPages) {
            const source = read(path);
            expect(source, path).toContain('export const prerender = true');
            expect(source, path).toContain('getStaticLandingPackages()');
            expect(source, path).not.toMatch(/getLandingPageData|createSupabase|\.auth\.|isLoggedIn|isCheckoutEnabled/u);
        }

        for (const path of staticRenderSources) {
            expect(read(path), path).not.toMatch(/supabase-server|createSupabase|\.auth\.|isLoggedIn|isCheckoutEnabled\(Astro\)/u);
        }
    });

    it('renders managed homepages without a browser session and retains integrated fallback', () => {
        for (const path of homePages) {
            const source = read(path);
            expect(source, path).toContain('export const prerender = false');
            expect(source, path).toContain('<PublicHomePage');
            expect(source, path).not.toMatch(/createSupabase|\.auth\.|isLoggedIn|isCheckoutEnabled/u);
        }

        const home = read('src/components/PublicHomePage.astro');
        const loader = read('src/lib/cms-home-content-server.ts');
        expect(home).toContain('loadPublishedCmsHomeContent(lang)');
        expect(home).toContain('getDefaultCmsHomeContent(lang)');
        expect(home).toContain('PUBLIC_SHELL_CACHE_CONTROL');
        expect(home).not.toMatch(/\.auth\.|Cookie|Set-Cookie/u);
        expect(loader).toContain('return null');
        expect(loader).toContain('Published home lookup failed safely');
    });

    it('keeps the shell 200 and publicly revalidatable independently of availability failure', () => {
        const availabilityFailure = new Response('{"error":"temporary"}', {
            status: 503,
            headers: { 'Cache-Control': 'no-store' },
        });
        const shell = new Response('<!doctype html><title>Español Honesto</title>', { status: 200 });
        applyHostedSecurityHeaders(shell, { pathname: '/en', secureTransport: true });

        expect(availabilityFailure.status).toBe(503);
        expect(availabilityFailure.headers.get('Cache-Control')).toBe('no-store');
        expect(shell.status).toBe(200);
        expect(shell.headers.get('Cache-Control')).toBe(PUBLIC_SHELL_CACHE_CONTROL);
        expect(shell.headers.has('Set-Cookie')).toBe(false);
    });

    it('keeps both root redirect artifacts on the English acquisition route', () => {
        expect(read('src/pages/index.astro')).toContain("return Astro.redirect('/en', 301)");
        expect(read('public/_redirects')).toMatch(/^\/ \/en 301$/mu);
        expect(read('public/_redirects')).not.toMatch(/^\/ \/es 301$/mu);
    });
});
