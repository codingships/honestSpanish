import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(path, 'utf8').replace(/\r\n/g, '\n');

const fontCss = read('src/styles/fonts.css');
const globalCss = read('src/styles/global.css');
const fontNotice = read('public/fonts/NOTICE.txt');
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
        expect(astroConfig).toContain('assetsInlineLimit: 0');
        expect(astroConfig).toContain('resources: ["\'self\'"]');
    });

    it('keeps equivalent display roles across Latin and Russian typography', () => {
        expect(fontCss).toContain("@fontsource/boldonse/400.css");
        expect(fontCss).toContain("@fontsource/unbounded/700.css");
        expect(fontCss).toContain("@fontsource-variable/inter/wght.css");
        expect(fontCss).toContain("font-family: 'Boldonese Cyrillic'");
        expect(fontCss).toContain("/fonts/BoldoneseCyrillic-Regular.woff2?v=91");
        expect(fontCss).not.toContain('unicode-range');
        expect(fontCss).toContain(":root:lang(ru)");
        expect(fontCss).toContain("--font-eh-display: 'Boldonese Cyrillic', 'Unbounded', 'Boldonse', sans-serif");
        expect(fontCss).toContain("--font-eh-brand-display: 'Boldonese Cyrillic', 'Unbounded', 'Boldonse', sans-serif");
        expect(fontCss).toContain("--font-eh-wordmark: 'Boldonse', 'Unbounded', sans-serif");
        expect(fontCss).not.toMatch(/:root:lang\(ru\)\s+\.font-display\s*\{/);
        expect(fontCss).not.toContain('letter-spacing');
        expect(fontCss).not.toContain('line-height');
        expect(fontCss).not.toContain('!important');
        expect(globalCss).not.toContain(':root:lang(ru) .font-brand-display');
        expect(globalCss).not.toContain(':root:lang(ru) .hero-headline');
        expect(globalCss).not.toContain(':root:lang(ru) .brand-display-stack');
        expect(globalCss).not.toMatch(
            /:root:lang\(ru\)[^{]*\{[^}]*(?:letter-spacing|line-height|overflow-wrap|word-break)/s,
        );
        expect(fontCss).toContain("--font-eh-body: 'Inter Variable', Arial, sans-serif");
        expect(existsSync('public/fonts/BoldoneseCyrillic-Regular.woff2')).toBe(true);
        expect(existsSync('public/fonts/NOTICE.txt')).toBe(true);
        expect(existsSync('public/fonts/licenses/Boldonse-OFL.txt')).toBe(true);
        expect(existsSync('public/fonts/licenses/Onest-OFL.txt')).toBe(true);
        expect(fontNotice).toContain('Version: v9.1');

        const fontHash = createHash('sha256')
            .update(readFileSync('public/fonts/BoldoneseCyrillic-Regular.woff2'))
            .digest('hex');
        expect(fontHash).toBe('4fca33b1a2401423e9d9aa0b354fc408ff0506001a5b3244aeb2dbdc06e03608');
    });

    it('routes Tailwind typography through the locale-aware tokens', () => {
        expect(tailwindConfig).toContain("display: ['var(--font-eh-display)']");
        expect(tailwindConfig).toContain("'brand-display': ['var(--font-eh-brand-display)']");
        expect(tailwindConfig).toContain("wordmark: ['var(--font-eh-wordmark)']");
        expect(tailwindConfig).toContain("sans: ['var(--font-eh-body)']");
    });

    it('keeps the hero middle word in italic for every public locale', () => {
        const hero = read('src/components/landing/HeroSection.astro');
        expect(hero).toContain('italic inline-block py-[0.06em]');
        expect(hero).toContain('hero-headline font-brand-display');
        expect(hero).toContain('font-display text-3xl lg:font-brand-display lg:text-4xl');
    });
});
