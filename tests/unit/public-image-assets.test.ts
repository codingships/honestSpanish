import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const assetBudgets = {
    'src/assets/hero-480.webp': 60 * 1024,
    'src/assets/hero-768.webp': 110 * 1024,
    'src/assets/hero-1024.webp': 165 * 1024,
    'src/assets/madrid-atmosphere-480.webp': 60 * 1024,
    'src/assets/madrid-atmosphere-768.webp': 135 * 1024,
    'src/assets/madrid-atmosphere-1024.webp': 230 * 1024,
    'src/assets/home-photography/valencia-480.webp': 60 * 1024,
    'src/assets/home-photography/valencia-768.webp': 110 * 1024,
    'src/assets/home-photography/valencia-1024.webp': 165 * 1024,
    'src/assets/home-photography/bilbao-480.webp': 60 * 1024,
    'src/assets/home-photography/bilbao-768.webp': 110 * 1024,
    'src/assets/home-photography/bilbao-1024.webp': 165 * 1024,
    'src/assets/home-photography/sevilla-480.webp': 60 * 1024,
    'src/assets/home-photography/sevilla-768.webp': 110 * 1024,
    'src/assets/home-photography/sevilla-1024.webp': 165 * 1024,
    'src/assets/home-photography/oviedo-480.webp': 60 * 1024,
    'src/assets/home-photography/oviedo-768.webp': 110 * 1024,
    'src/assets/home-photography/oviedo-1024.webp': 165 * 1024,
    'src/assets/home-photography/plaza-mayor-768.webp': 60 * 1024,
    'src/assets/home-photography/plaza-mayor-1280.webp': 135 * 1024,
    'src/assets/home-photography/plaza-mayor-1920.webp': 230 * 1024,
    'src/assets/avatar-alejandro-team-320.webp': 10 * 1024,
    'src/assets/avatar-alejandro-team-480.webp': 18 * 1024,
    'src/assets/avatar-alejandro-team-640.webp': 30 * 1024,
    'src/assets/avatar-alin-team-320.webp': 14 * 1024,
    'src/assets/avatar-alin-team-480.webp': 26 * 1024,
    'src/assets/avatar-alin-team-640.webp': 44 * 1024,
    'src/assets/avatar-irene-team-320.webp': 24 * 1024,
    'src/assets/avatar-irene-team-480.webp': 48 * 1024,
    'src/assets/avatar-irene-team-640.webp': 76 * 1024,
    'src/assets/noise-texture-400.jpg': 30 * 1024,
    'public/favicon-64.png': 8 * 1024,
    'public/apple-touch-icon.png': 24 * 1024,
} as const;

function imageFormat(path: string): 'jpeg' | 'png' | 'webp' | null {
    const bytes = readFileSync(resolve(path));
    if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpeg';
    if (bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
        return 'png';
    }
    if (bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP') {
        return 'webp';
    }
    return null;
}

describe('public landing image delivery', () => {
    it('keeps the measured responsive variants within their payload budgets', () => {
        for (const [path, maximumBytes] of Object.entries(assetBudgets)) {
            expect(statSync(resolve(path)).size, path).toBeLessThanOrEqual(maximumBytes);
            const expectedFormat = path.endsWith('.jpg')
                ? 'jpeg'
                : path.endsWith('.webp') ? 'webp' : 'png';
            expect(imageFormat(path), path).toBe(expectedFormat);
        }
    });

    it('serves responsive photos and never imports the multi-megabyte originals', () => {
        const hero = readFileSync(resolve('src/components/landing/HeroSection.astro'), 'utf8');
        const landing = readFileSync(resolve('src/components/LandingPage.astro'), 'utf8');
        const carousel = readFileSync(resolve('src/components/landing/SpainPhotoCarousel.astro'), 'utf8');
        const atmosphere = readFileSync(resolve('src/components/landing/AtmospherePhoto.astro'), 'utf8');
        const problems = readFileSync(resolve('src/components/landing/ProblemsSection.astro'), 'utf8');

        expect(hero).toContain('hero-480.webp');
        expect(hero).toContain('hero-768.webp');
        expect(hero).toContain('hero-1024.webp');
        expect(hero).toContain('fetchpriority="high"');
        expect(hero).toContain('sizes="(min-width: 1024px) 42vw, 100vw"');
        expect(hero).not.toContain("hero.png");

        expect(landing).toContain('<AtmospherePhoto imageAlt={accessibilityCopy.atmosphereAlt}');
        expect(landing).not.toContain('madrid-atmosphere-');
        for (const city of ['valencia', 'bilbao', 'sevilla', 'oviedo']) {
            for (const width of [480, 768, 1024]) {
                expect(carousel).toContain(`home-photography/${city}-${width}.webp`);
            }
        }
        for (const width of [768, 1280, 1920]) {
            expect(atmosphere).toContain(`home-photography/plaza-mayor-${width}.webp`);
        }
        expect(atmosphere).toContain('sizes="100vw"');
        expect(atmosphere).toContain('loading="lazy"');
        expect(landing).toContain('avatar-alejandro-team-640.webp');
        expect(landing).toContain('avatar-alin-team-640.webp');
        expect(landing).toContain('avatar-irene-team-640.webp');
        expect(landing).not.toContain("from 'astro:assets'");
        expect(landing).not.toContain('_team.png');
        expect(landing).not.toContain('madrid_atmosphere.png');

        expect(problems).toContain('noise-texture-400.jpg');
        expect(problems).not.toContain('noise_texture.png');
    });

    it('keeps the carousel opt-in on the home without changing segment-page heroes or frame heights', () => {
        const hero = readFileSync(resolve('src/components/landing/HeroSection.astro'), 'utf8');
        const landing = readFileSync(resolve('src/components/LandingPage.astro'), 'utf8');
        const segment = readFileSync(resolve('src/components/landing/SegmentLandingPage.astro'), 'utf8');
        const carousel = readFileSync(resolve('src/components/landing/SpainPhotoCarousel.astro'), 'utf8');
        const atmosphere = readFileSync(resolve('src/components/landing/AtmospherePhoto.astro'), 'utf8');

        expect(hero).toContain('photoCarousel?: boolean');
        expect(hero).toContain('photoCarousel = false');
        expect(hero).toMatch(/photoCarousel\s*\?\s*<SpainPhotoCarousel\s+lang=\{lang\}/u);
        expect(landing).toMatch(/<HeroSection\s[^>]*\bphotoCarousel\b/u);
        expect(segment).toContain('<HeroSection');
        expect(segment).not.toContain('photoCarousel');
        expect(carousel).toContain('h-48 md:h-64 lg:h-[40vh]');
        expect(atmosphere).toContain('h-64 md:h-96');
    });

    it('preserves the complete image frame with overlay dots instead of a separate toolbar', () => {
        const carousel = readFileSync(resolve('src/components/landing/SpainPhotoCarousel.astro'), 'utf8');

        expect(carousel).toContain('h-48 md:h-64 lg:h-[40vh]');
        expect(carousel).toMatch(/\.photo-viewport\s*\{[^}]*position:\s*absolute;\s*inset:\s*0;/u);
        expect(carousel).toMatch(/\.photo-controls\s*\{[^}]*position:\s*absolute;\s*inset:\s*0;/u);
        expect(carousel).toMatch(/\.photo-indicators\s*\{[^}]*position:\s*absolute;[^}]*bottom:/u);
        expect(carousel).toContain('data-photo-indicator={index}');
        expect(carousel).toContain("aria-current={index === 0 ? 'true' : 'false'}");
        expect(carousel).toContain('data-photo-toggle');
        expect(carousel).toContain('data-play-label={copy.play}');
        expect(carousel).toContain('data-pause-label={copy.pause}');
        expect(carousel).not.toContain('photo-toolbar');
        expect(carousel).not.toContain('data-photo-previous');
        expect(carousel).not.toContain('data-photo-next');
        expect(carousel).not.toContain('data-photo-city');
        expect(carousel).not.toContain('data-photo-count');
        expect(carousel).not.toMatch(/inset:\s*0\s+0\s+44px/u);
        expect(carousel).toContain('filter: grayscale(1)');
        expect(carousel).toContain('.photo-carousel:hover img');
        expect(carousel).not.toContain('@media (hover: none)');
    });

    it('keeps the Valencia market sign anchored to the left without moving the Bilbao crop', () => {
        const carousel = readFileSync(resolve('src/components/landing/SpainPhotoCarousel.astro'), 'utf8');
        const valenciaRule = carousel.match(/\[data-city="Valencia"\]\s+img\s*\{([^}]*)\}/u)?.[1];
        const bilbaoRule = carousel.match(/\[data-city="Bilbao"\]\s+img\s*\{([^}]*)\}/u)?.[1];

        expect(valenciaRule).toMatch(/object-position:\s*0%\s+75%;/u);
        expect(bilbaoRule).toMatch(/object-position:\s*50%\s+75%;/u);
    });

    it('describes the new Central Market photo in the first slide across all three languages', () => {
        const carousel = readFileSync(resolve('src/components/landing/SpainPhotoCarousel.astro'), 'utf8');
        const firstAlts = Array.from(carousel.matchAll(/\balts:\s*\[\s*([^\r\n]+)/gu), ([, alt]) => alt);

        expect(firstAlts).toHaveLength(3);
        expect(firstAlts[0]).toMatch(/Mercado Central.*Valencia/u);
        expect(firstAlts[1]).toMatch(/Central Market/u);
        expect(firstAlts[1]).toMatch(/Valencia/u);
        expect(firstAlts[2]).toMatch(/Центральн\p{L}*\s+рын\p{L}*/iu);
        expect(firstAlts[2]).toMatch(/Валенсии/u);
    });

    it('emits URLs only for the first slide and leaves later URLs inert until their requested turn', () => {
        const carousel = readFileSync(resolve('src/components/landing/SpainPhotoCarousel.astro'), 'utf8');

        expect(carousel).toMatch(/\bsrc=\{index === 0 \? slide\.images\[1\]\.src : undefined\}/u);
        expect(carousel).toMatch(/\bsrcset=\{index === 0 \? slide\.srcset : undefined\}/u);
        expect(carousel).toContain('data-src={index !== 0 ? slide.images[1].src : undefined}');
        expect(carousel).toContain('data-srcset={index !== 0 ? slide.srcset : undefined}');
        expect(carousel).toContain('fetchpriority={index === 0 ? \'high\' : \'low\'}');
        expect(carousel).toContain('loading="eager"');
        expect(carousel).toContain('decoding="async"');
        expect(carousel).toContain('sizes="(min-width: 1024px) 42vw, 100vw"');
        expect(carousel).toContain('hidden={index !== 0}');
        expect(carousel).toMatch(/data-photo-controls\s+hidden/u);
        expect(carousel).not.toContain('rel="preload"');
        expect(carousel).not.toContain('client:');
    });

    it('uses local photos and CSP-compatible processed scripts without inline event handlers or styles', () => {
        for (const path of [
            'src/components/landing/SpainPhotoCarousel.astro',
            'src/components/landing/AtmospherePhoto.astro',
        ]) {
            const component = readFileSync(resolve(path), 'utf8');
            const imageImports = Array.from(component.matchAll(/from\s+['"]([^'"]+\.(?:webp|png|jpe?g))['"]/gu));
            expect(imageImports.length, path).toBeGreaterThan(0);
            for (const [, imagePath] of imageImports) {
                expect(imagePath, path).toMatch(/^\.\.\/\.\.\/assets\/home-photography\/[a-z-]+-\d+\.webp$/u);
            }
            expect(component, path).not.toMatch(/\bstyle\s*=/u);
            expect(component, path).not.toMatch(/\bon(?:click|load|error|keydown)\s*=/u);
            expect(component, path).not.toContain('is:inline');
            expect(component, path).not.toContain('https://');
            expect(component, path).not.toContain('http://');
            expect(component, path).not.toContain('from \'astro:assets\'');
            expect(component, path).toContain('object-fit: cover');
            expect(component, path).toContain('@media (prefers-reduced-motion: reduce)');
        }
        const carousel = readFileSync(resolve('src/components/landing/SpainPhotoCarousel.astro'), 'utf8');
        expect(carousel).toContain('<script>');
        expect(carousel).toContain('initializePhotoCarousel');
        expect(carousel).toContain(':focus-within');
        expect(carousel).toContain('touch-action: pan-y pinch-zoom');
        expect(carousel).toContain('aria-live="off"');
        expect(carousel).toContain('aria-atomic="true"');
    });

    it('declares the existing favicon from the standalone legal layout', () => {
        const legalLayout = readFileSync(resolve('src/layouts/LegalLayout.astro'), 'utf8');

        expect(legalLayout).toContain('href="/favicon-64.png"');
    });
});
