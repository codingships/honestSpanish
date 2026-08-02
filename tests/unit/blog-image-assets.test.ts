import {
    existsSync,
    readFileSync,
    readdirSync,
    statSync,
} from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const MAX_BLOG_OVERRIDE_BYTES = 200 * 1024;
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.avif']);

function imageFiles(directory: string): string[] {
    if (!existsSync(directory)) return [];

    return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
        const path = join(directory, entry.name);
        return entry.isDirectory()
            ? imageFiles(path)
            : IMAGE_EXTENSIONS.has(extname(entry.name).toLowerCase()) ? [path] : [];
    });
}

function detectedFormat(bytes: Buffer): string | null {
    if (bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
        return '.png';
    }
    if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return '.jpg';
    if (bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP') {
        return '.webp';
    }
    if (
        bytes.subarray(4, 8).toString('ascii') === 'ftyp'
        && ['avif', 'avis'].includes(bytes.subarray(8, 12).toString('ascii'))
    ) return '.avif';
    return null;
}

describe('blog image asset contract', () => {
    it('keeps future image overrides small and honest about their media type', () => {
        const files = imageFiles(resolve('src/assets/blog'));

        for (const file of files) {
            const extension = extname(file).toLowerCase();
            const expectedFormat = extension === '.jpeg' ? '.jpg' : extension;
            expect(statSync(file).size, file).toBeLessThanOrEqual(MAX_BLOG_OVERRIDE_BYTES);
            expect(detectedFormat(readFileSync(file)), file).toBe(expectedFormat);
        }
    });

    it('does not ship a second public copy or the obsolete copy script', () => {
        expect(imageFiles(resolve('public/images/blog'))).toEqual([]);
        expect(existsSync(resolve('scripts/copy-blog-images.js'))).toBe(false);
    });

    it('generates both responsive widths with revalidatable cache semantics', () => {
        const source = readFileSync(resolve('src/pages/og/[slug].png.ts'), 'utf8');
        const renderer = readFileSync(resolve('src/lib/og-image-renderer.ts'), 'utf8');
        expect(source).toContain("params: { slug: slug + '-600' }");
        expect(source).toContain('outputWidth: 600 as const');
        expect(source).toContain('outputWidth: 1200 as const');
        expect(renderer).toContain("fitTo: { mode: 'width', value: outputWidth }");
        expect(renderer).toContain('unbounded-cyrillic-700-normal.woff');
        expect(source).toContain("'es-blog': { title: 'Nuestro Blog'");
        expect(source).toContain("'en-blog': { title: 'Our Blog'");
        expect(source).toContain("'ru-blog': { title: 'Наш блог'");
        expect(source).toContain('OG image key collides with responsive variant');
        expect(source).toContain('public, max-age=86400, stale-while-revalidate=604800');
        expect(source).not.toContain('max-age=31536000, immutable');
    });
});
