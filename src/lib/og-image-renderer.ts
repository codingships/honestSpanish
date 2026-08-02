import { Resvg } from '@resvg/resvg-js';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import satori from 'satori';
import { html } from 'satori-html';

export type OgImageWidth = 600 | 1200;

const fontDataPromise = Promise.all([
    readFile(path.join(
        process.cwd(),
        'node_modules',
        '@fontsource',
        'unbounded',
        'files',
        'unbounded-latin-700-normal.woff',
    )),
    readFile(path.join(
        process.cwd(),
        'node_modules',
        '@fontsource',
        'unbounded',
        'files',
        'unbounded-cyrillic-700-normal.woff',
    )),
]);

function escapeHtml(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

export async function renderOgImage({
    title,
    category,
    outputWidth,
}: {
    title: string;
    category: string;
    outputWidth: OgImageWidth;
}): Promise<ArrayBuffer> {
    const [latinFontData, cyrillicFontData] = await fontDataPromise;
    const safeTitle = escapeHtml(title);
    const safeCategory = escapeHtml(category);
    const titleFontSize = title.length > 72
        ? 48
        : title.length > 56
            ? 56
            : title.length > 40 ? 64 : 72;
    const fontFamily = /[\u0400-\u04ff]/u.test(title + category)
        ? "'Unbounded Cyrillic', 'Unbounded Latin'"
        : "'Unbounded Latin', 'Unbounded Cyrillic'";

    const markupString = `
      <div style="background-color: #006064; width: 100%; height: 100%; display: flex; flex-direction: column; justify-content: center; align-items: center; padding: 60px; font-family: ${fontFamily};">
        <div style="display: flex; justify-content: space-between; width: 100%; align-items: center; margin-bottom: 40px; color: #E0F7FA;">
          <span style="font-size: 32px; font-weight: bold;">Español Honesto</span>
          ${safeCategory ? `<span style="font-size: 24px; background: rgba(224, 247, 250, 0.2); padding: 8px 16px; border-radius: 9999px;">${safeCategory.toUpperCase()}</span>` : ''}
        </div>

        <div style="display: flex; background-color: #ffffff; padding: 60px; border-radius: 20px; width: 100%; flex-direction: column; justify-content: center; align-items: center; box-shadow: 0 10px 25px rgba(0,0,0,0.2);">
          <h1 style="color: #006064; font-size: ${titleFontSize}px; font-weight: bold; text-align: center; line-height: 1.1; margin: 0;">
            ${safeTitle}
          </h1>
        </div>

        <div style="display: flex; margin-top: 40px; color: #E0F7FA; font-size: 28px;">
          espanolhonesto.com
        </div>
      </div>
    `;

    const satoriMarkup = html(markupString) as unknown as Parameters<typeof satori>[0];
    const svg = await satori(satoriMarkup, {
        width: 1200,
        height: 630,
        fonts: [
            {
                name: 'Unbounded Latin',
                data: latinFontData,
                weight: 700,
                style: 'normal',
            },
            {
                name: 'Unbounded Cyrillic',
                data: cyrillicFontData,
                weight: 700,
                style: 'normal',
            },
        ],
    });

    const pngData = new Resvg(svg, {
        fitTo: { mode: 'width', value: outputWidth },
    }).render().asPng();

    return Uint8Array.from(pngData).buffer;
}
