import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PUBLIC_SHELL_CACHE_CONTROL, applyHostedSecurityHeaders } from '../../src/lib/security-headers';

const publicPages = [
    'src/pages/en/index.astro',
    'src/pages/es/index.astro',
    'src/pages/ru/index.astro',
    'src/pages/es/espanol-para-vivir-en-espana.astro',
    'src/pages/es/espanol-para-profesionales.astro',
    'src/pages/es/clases-de-conversacion-en-espanol.astro',
];
const publicRenderSources = [
    ...publicPages,
    'src/components/LandingPage.astro',
    'src/components/landing/SegmentLandingPage.astro',
    'src/lib/landing-data.ts',
];

const read = (path: string) => readFileSync(path, 'utf8');

describe('resilient static public shell', () => {
    it('prerenders every home and segment landing from the static offer contract', () => {
        for (const path of publicPages) {
            const source = read(path);
            expect(source, path).toContain('export const prerender = true');
            expect(source, path).toContain('getStaticLandingPackages()');
            expect(source, path).not.toMatch(/getLandingPageData|createSupabase|\.auth\.|isLoggedIn|isCheckoutEnabled/u);
        }

        for (const path of publicRenderSources) {
            expect(read(path), path).not.toMatch(/supabase-server|createSupabase|\.auth\.|isLoggedIn|isCheckoutEnabled\(Astro\)/u);
        }
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
