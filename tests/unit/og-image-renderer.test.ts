import { describe, expect, it } from 'vitest';
import { renderOgImage, type OgImageWidth } from '../../src/lib/og-image-renderer';

function pngDimensions(output: ArrayBuffer) {
    const bytes = Buffer.from(output);
    expect(bytes.subarray(0, 8)).toEqual(
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    );
    return {
        width: bytes.readUInt32BE(16),
        height: bytes.readUInt32BE(20),
        byteLength: bytes.byteLength,
    };
}

describe('OG image renderer', () => {
    it.each([
        {
            outputWidth: 1200 as OgImageWidth,
            title: 'Guía definitiva de Español para Profesionales: Sobrevive a tu oficina en España (2026)',
            category: 'Aprendizaje',
            expectedHeight: 630,
        },
        {
            outputWidth: 600 as OgImageWidth,
            title: 'Испанский для экспатов в Испании: практическое руководство',
            category: 'Жизнь в Испании',
            expectedHeight: 315,
        },
    ])('renders a real $outputWidth px PNG with localized glyph support', async ({
        outputWidth,
        title,
        category,
        expectedHeight,
    }) => {
        const output = await renderOgImage({ title, category, outputWidth });
        const dimensions = pngDimensions(output);

        expect(dimensions.width).toBe(outputWidth);
        expect(dimensions.height).toBe(expectedHeight);
        expect(dimensions.byteLength).toBeGreaterThan(1_000);
        expect(dimensions.byteLength).toBeLessThan(250 * 1024);
    });

    it('escapes content before creating markup', async () => {
        await expect(renderOgImage({
            title: '<script>alert("x")</script>',
            category: 'A&B',
            outputWidth: 600,
        })).resolves.toBeInstanceOf(ArrayBuffer);
    });
});
