import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(path, 'utf8').replace(/\r\n/g, '\n');

const fontCss = read('src/styles/fonts.css');
const baseLayout = read('src/layouts/BaseLayout.astro');
const legalLayout = read('src/layouts/LegalLayout.astro');
const notFoundPage = read('src/pages/404.astro');
const tailwindConfig = read('tailwind.config.js');
const astroConfig = read('astro.config.mjs');

describe('self-hosted multilingual typography', () => {
    it('does not depend on third-party font origins', () => {
        for (const source of [baseLayout, legalLayout, notFoundPage, astroConfig]) {
            expect(source).not.toContain('fonts.googleapis.com');
            expect(source).not.toContain('fonts.gstatic.com');
            expect(source).not.toContain('cdnjs.cloudflare.com');
        }
        for (const source of [baseLayout, legalLayout, notFoundPage]) {
            expect(source).toContain("styles/fonts.css");
        }
        expect(astroConfig).toContain("\"font-src 'self'\"");
        expect(astroConfig).toContain('resources: ["\'self\'"]');
    });

    it('keeps the Latin identity and selects complete Cyrillic families explicitly', () => {
        expect(fontCss).toContain("@fontsource/boldonse/400.css");
        expect(fontCss).toContain("@fontsource/unbounded/700.css");
        expect(fontCss).toContain("@fontsource-variable/inter/wght.css");
        expect(fontCss).toContain(":root:lang(ru)");
        expect(fontCss).toContain("--font-eh-display: 'Unbounded'");
        expect(fontCss).toContain("--font-eh-body: 'Inter Variable', Arial, sans-serif");
    });

    it('routes Tailwind typography through the locale-aware tokens', () => {
        expect(tailwindConfig).toContain("display: ['var(--font-eh-display)']");
        expect(tailwindConfig).toContain("sans: ['var(--font-eh-body)']");
    });
});
