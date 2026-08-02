import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
    ADMIN_EMAIL_PREVIEW_FRAME_PATH,
    ADMIN_EMAIL_PREVIEW_CACHE_CONTROL,
    ADMIN_EMAIL_PREVIEW_CSP,
    API_CACHE_CONTROL,
    PUBLIC_BOOKABLE_SLOTS_CACHE_CONTROL,
    PUBLIC_SHELL_CACHE_CONTROL,
    CSP_HEADER_BASELINE,
    HOSTED_SECURITY_HEADERS,
    HSTS_HEADER,
    PRIVATE_PAGE_CACHE_CONTROL,
    applyHostedSecurityHeaders,
    cacheControlForPath,
    mergeCspHeader,
    normalizeRoutePathname,
} from '../../src/lib/security-headers';

describe('hosted response security headers', () => {
    it('keeps the Pages/static-asset fallback aligned with the SSR baseline', () => {
        const pagesHeaders = readFileSync('public/_headers', 'utf8');
        const sections = pagesHeaders
            .split(/\r?\n(?=\/)/u)
            .map((section) => section.trim())
            .filter(Boolean);

        expect(sections).toHaveLength(15);
        expect(sections[0]).toMatch(/^\/\*\r?\n/u);
        expect(sections[1]).toMatch(/^\/api\/\*\r?\n/u);
        expect(sections[2]).toMatch(/^\/og\/\*\r?\n/u);

        for (const [name, value] of Object.entries(HOSTED_SECURITY_HEADERS)) {
            expect(sections[0]).toContain(`${name}: ${value}`);
        }
        expect(sections[0]).toContain(`Strict-Transport-Security: ${HSTS_HEADER}`);
        expect(Number.parseInt(HSTS_HEADER.match(/max-age=(\d+)/u)?.[1] ?? '0', 10)).toBeGreaterThanOrEqual(31536000);
        expect(sections[0]).toContain(`Content-Security-Policy: ${CSP_HEADER_BASELINE}`);
        expect(sections[0]).not.toContain("'unsafe-inline'");
        expect(sections[0]).not.toContain('Cache-Control:');
        expect(sections[1]).toContain(`Cache-Control: ${API_CACHE_CONTROL}`);
        expect(sections[1].match(/Cache-Control:/gu)).toHaveLength(1);
        expect(sections[2]).toContain('Cache-Control: public, max-age=86400, stale-while-revalidate=604800');
        expect(sections[2].match(/Cache-Control:/gu)).toHaveLength(1);
        for (const section of sections.slice(3)) {
            expect(section).toContain(`Cache-Control: ${PUBLIC_SHELL_CACHE_CONTROL}`);
        }
    });

    it('merges the non-meta baseline without discarding Astro script and style hashes', () => {
        const existing = "default-src 'self'; script-src 'self' 'sha256-example'; style-src 'self' 'sha256-style'; BASE-URI *";
        const merged = mergeCspHeader(existing);

        expect(merged).toContain("script-src 'self' 'sha256-example'");
        expect(merged).toContain("style-src 'self' 'sha256-style'");
        expect(merged).toContain("base-uri 'none'");
        expect(merged).not.toMatch(/base-uri\s+\*/iu);
        expect(merged.match(/base-uri/giu)).toHaveLength(1);
        expect(merged).toContain("frame-ancestors 'none'");
    });

    it('keeps only successful public availability cacheable among APIs and session-aware pages', () => {
        expect(cacheControlForPath('/api/account/update-profile')).toBe(API_CACHE_CONTROL);
        expect(cacheControlForPath('/api/bookable-slots')).toBe(PUBLIC_BOOKABLE_SLOTS_CACHE_CONTROL);
        expect(cacheControlForPath('/es/campus/account')).toBe(PRIVATE_PAGE_CACHE_CONTROL);
        expect(cacheControlForPath('/en/reset-password')).toBe(PRIVATE_PAGE_CACHE_CONTROL);
        expect(cacheControlForPath('/ru/diagnostico')).toBe(PRIVATE_PAGE_CACHE_CONTROL);
        expect(cacheControlForPath('/es')).toBe(PUBLIC_SHELL_CACHE_CONTROL);
        expect(cacheControlForPath('/es/')).toBe(PUBLIC_SHELL_CACHE_CONTROL);
        expect(cacheControlForPath('/en/')).toBe(PUBLIC_SHELL_CACHE_CONTROL);
        expect(cacheControlForPath('/es/espanol-para-profesionales')).toBe(PUBLIC_SHELL_CACHE_CONTROL);
        expect(cacheControlForPath('/es/espanol-para-profesionales/')).toBe(PUBLIC_SHELL_CACHE_CONTROL);
        expect(cacheControlForPath('/es/blog/example')).toBeNull();
        expect(cacheControlForPath('/es//login')).toBe(PRIVATE_PAGE_CACHE_CONTROL);
        expect(cacheControlForPath('//es/login')).toBe(PRIVATE_PAGE_CACHE_CONTROL);
        expect(cacheControlForPath('/es/login/extra')).toBeNull();
        expect(cacheControlForPath('/es/%63ampus')).toBe(PRIVATE_PAGE_CACHE_CONTROL);
        expect(cacheControlForPath('/es/%2563ampus')).toBeNull();
    });

    it('allows a micro-cache only for successful public availability responses', () => {
        const success = new Response('{"slots":[]}', { status: 200 });
        applyHostedSecurityHeaders(success, {
            pathname: '/api/bookable-slots',
            secureTransport: true,
        });
        expect(success.headers.get('Cache-Control')).toBe(PUBLIC_BOOKABLE_SLOTS_CACHE_CONTROL);

        const failure = new Response('{"error":"temporary"}', {
            status: 503,
            headers: { 'Cache-Control': PUBLIC_BOOKABLE_SLOTS_CACHE_CONTROL },
        });
        applyHostedSecurityHeaders(failure, {
            pathname: '/api/bookable-slots',
            secureTransport: true,
        });
        expect(failure.headers.get('Cache-Control')).toBe(API_CACHE_CONTROL);
    });

    it('normalizes encoded route segments exactly once like Astro', () => {
        expect(normalizeRoutePathname('/es/%63ampus/admin')).toBe('/es/campus/admin');
        expect(normalizeRoutePathname('/%61pi/account')).toBe('/api/account');
        expect(normalizeRoutePathname('/es/%2563ampus')).toBe('/es/%63ampus');
        expect(normalizeRoutePathname('/es/%C0%AF')).toBe('/es/%C0%AF');
        expect(normalizeRoutePathname('/es//login')).toBe('/es/login');
        expect(normalizeRoutePathname('//es/login')).toBe('/es/login');
    });

    it('keeps CSP on HTTP responses while limiting HSTS to HTTPS', () => {
        const response = new Response('ok');
        applyHostedSecurityHeaders(response, {
            pathname: '/es/blog/example',
            secureTransport: false,
        });

        expect(response.headers.get('Content-Security-Policy')).toContain("frame-ancestors 'none'");
        expect(response.headers.has('Strict-Transport-Security')).toBe(false);
    });

    it('normalizes request paths exactly once when applying cache headers', () => {
        const encodedCampus = new Response('ok');
        applyHostedSecurityHeaders(encodedCampus, {
            pathname: '/es/%63ampus',
            secureTransport: true,
        });
        expect(encodedCampus.headers.get('Cache-Control')).toBe(PRIVATE_PAGE_CACHE_CONTROL);

        const doubleEncodedCampus = new Response('ok');
        applyHostedSecurityHeaders(doubleEncodedCampus, {
            pathname: '/es/%2563ampus',
            secureTransport: true,
        });
        expect(doubleEncodedCampus.headers.has('Cache-Control')).toBe(false);
    });

    it('allows only the authenticated email preview endpoint to be framed by the same origin', () => {
        const response = new Response('<html></html>', {
            headers: {
                'Content-Security-Policy': "default-src 'self'; connect-src 'self'; frame-src 'self'; worker-src 'self'",
            },
        });
        applyHostedSecurityHeaders(response, {
            pathname: ADMIN_EMAIL_PREVIEW_FRAME_PATH,
            secureTransport: true,
        });

        expect(response.headers.get('X-Frame-Options')).toBe('SAMEORIGIN');
        expect(response.headers.get('Content-Security-Policy')).toContain("frame-ancestors 'self'");
        expect(response.headers.get('Content-Security-Policy')).toContain("style-src 'unsafe-inline'");
        expect(response.headers.get('Content-Security-Policy')).toContain("script-src 'none'");
        expect(response.headers.get('Content-Security-Policy')).toContain("connect-src 'none'");
        expect(response.headers.get('Content-Security-Policy')).toContain("frame-src 'none'");
        expect(response.headers.get('Content-Security-Policy')).toContain("worker-src 'none'");
        expect(response.headers.get('Content-Security-Policy')).not.toContain("connect-src 'self'");
        expect(response.headers.get('Content-Security-Policy')).not.toContain("frame-src 'self'");
        expect(response.headers.get('Content-Security-Policy')).not.toContain("worker-src 'self'");
        expect(response.headers.get('Content-Security-Policy')).toContain("form-action 'none'");
        expect(response.headers.get('Content-Security-Policy')).toMatch(/(?:^|; )sandbox(?:;|$)/u);
        expect(response.headers.get('Content-Security-Policy')).toBe(ADMIN_EMAIL_PREVIEW_CSP);
        expect(response.headers.get('Cache-Control')).toBe(ADMIN_EMAIL_PREVIEW_CACHE_CONTROL);
        expect(response.headers.get('Referrer-Policy')).toBe('no-referrer');
    });
});
