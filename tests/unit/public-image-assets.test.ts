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
        const problems = readFileSync(resolve('src/components/landing/ProblemsSection.astro'), 'utf8');

        expect(hero).toContain('hero-480.webp');
        expect(hero).toContain('hero-768.webp');
        expect(hero).toContain('hero-1024.webp');
        expect(hero).toContain('fetchpriority="high"');
        expect(hero).toContain('sizes="(min-width: 1024px) 42vw, 100vw"');
        expect(hero).not.toContain("hero.png");

        expect(landing).toContain('madrid-atmosphere-480.webp');
        expect(landing).toContain('madrid-atmosphere-768.webp');
        expect(landing).toContain('madrid-atmosphere-1024.webp');
        expect(landing).toContain('avatar-alejandro-team-640.webp');
        expect(landing).toContain('avatar-alin-team-640.webp');
        expect(landing).toContain('avatar-irene-team-640.webp');
        expect(landing).not.toContain("from 'astro:assets'");
        expect(landing).not.toContain('_team.png');
        expect(landing).not.toContain('madrid_atmosphere.png');

        expect(problems).toContain('noise-texture-400.jpg');
        expect(problems).not.toContain('noise_texture.png');
    });

    it('declares the existing favicon from the standalone legal layout', () => {
        const legalLayout = readFileSync(resolve('src/layouts/LegalLayout.astro'), 'utf8');

        expect(legalLayout).toContain('href="/favicon-64.png"');
    });
});
