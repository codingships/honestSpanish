import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const assetBudgets = {
    'src/assets/hero-480.jpg': 100 * 1024,
    'src/assets/hero-768.jpg': 200 * 1024,
    'src/assets/hero-1024.jpg': 320 * 1024,
    'src/assets/madrid-atmosphere-480.jpg': 100 * 1024,
    'src/assets/madrid-atmosphere-768.jpg': 220 * 1024,
    'src/assets/madrid-atmosphere-1024.jpg': 380 * 1024,
    'src/assets/noise-texture-400.jpg': 30 * 1024,
    'public/favicon-64.png': 8 * 1024,
    'public/apple-touch-icon.png': 24 * 1024,
} as const;

function imageFormat(path: string): 'jpeg' | 'png' | null {
    const bytes = readFileSync(resolve(path));
    if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpeg';
    if (bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
        return 'png';
    }
    return null;
}

describe('public landing image delivery', () => {
    it('keeps the measured responsive variants within their payload budgets', () => {
        for (const [path, maximumBytes] of Object.entries(assetBudgets)) {
            expect(statSync(resolve(path)).size, path).toBeLessThanOrEqual(maximumBytes);
            expect(imageFormat(path), path).toBe(path.endsWith('.jpg') ? 'jpeg' : 'png');
        }
    });

    it('serves responsive photos and never imports the multi-megabyte originals', () => {
        const hero = readFileSync(resolve('src/components/landing/HeroSection.astro'), 'utf8');
        const landing = readFileSync(resolve('src/components/LandingPage.astro'), 'utf8');
        const problems = readFileSync(resolve('src/components/landing/ProblemsSection.astro'), 'utf8');

        expect(hero).toContain('hero-480.jpg');
        expect(hero).toContain('hero-768.jpg');
        expect(hero).toContain('hero-1024.jpg');
        expect(hero).toContain('fetchpriority="high"');
        expect(hero).toContain('sizes="(min-width: 1024px) 42vw, 100vw"');
        expect(hero).not.toContain("hero.png");

        expect(landing).toContain('madrid-atmosphere-480.jpg');
        expect(landing).toContain('madrid-atmosphere-768.jpg');
        expect(landing).toContain('madrid-atmosphere-1024.jpg');
        expect(landing).not.toContain('madrid_atmosphere.png');

        expect(problems).toContain('noise-texture-400.jpg');
        expect(problems).not.toContain('noise_texture.png');
    });
});
