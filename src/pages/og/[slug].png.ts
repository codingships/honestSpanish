import satori from 'satori';
import { html } from 'satori-html';
import { Resvg } from '@resvg/resvg-js';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';
import { getBlogEntrySlug, isPublishedBlogPost } from '../../lib/blog-routes';

type OgPage = {
  title: string;
  category: string;
};

const staticPages: Record<string, OgPage> = {
  home: { title: 'Español Honesto', category: 'Academia' },
  contacto: { title: 'Contacto', category: 'Hablemos' },
  blog: { title: 'Nuestro Blog', category: 'Artículos' },
};

const fontDataPromise = readFile(path.join(
  process.cwd(),
  'node_modules',
  '@fontsource',
  'unbounded',
  'files',
  'unbounded-latin-700-normal.woff',
));

export const prerender = true;

export async function getStaticPaths() {
  const blogPosts = await getCollection('blog');
  const pagesBySlug = new Map<string, OgPage>(Object.entries(staticPages));

  for (const post of blogPosts.filter(isPublishedBlogPost).sort((a, b) => a.id.localeCompare(b.id))) {
    const slug = getBlogEntrySlug(post);
    if (!pagesBySlug.has(slug)) {
      pagesBySlug.set(slug, {
        title: post.data.title,
        category: post.data.category || 'Artículo',
      });
    }
  }

  return [...pagesBySlug].map(([slug, props]) => ({
    params: { slug },
    props,
  }));
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export const GET: APIRoute<OgPage> = async ({ props: { title, category } }) => {
  const fontData = await fontDataPromise;
  const safeTitle = escapeHtml(title);
  const safeCategory = escapeHtml(category);

  const markupString = `
    <div style="background-color: #006064; width: 100%; height: 100%; display: flex; flex-direction: column; justify-content: center; align-items: center; padding: 60px; font-family: 'Unbounded';">
      <div style="display: flex; justify-content: space-between; width: 100%; align-items: center; margin-bottom: 40px; color: #E0F7FA;">
        <span style="font-size: 32px; font-weight: bold;">Español Honesto</span>
        ${safeCategory ? `<span style="font-size: 24px; background: rgba(224, 247, 250, 0.2); padding: 8px 16px; border-radius: 9999px;">${safeCategory.toUpperCase()}</span>` : ''}
      </div>

      <div style="display: flex; background-color: #ffffff; padding: 60px; border-radius: 20px; width: 100%; flex-direction: column; justify-content: center; align-items: center; box-shadow: 0 10px 25px rgba(0,0,0,0.2);">
        <h1 style="color: #006064; font-size: 72px; font-weight: bold; text-align: center; line-height: 1.1; margin: 0;">
          ${safeTitle}
        </h1>
      </div>

      <div style="display: flex; margin-top: 40px; color: #E0F7FA; font-size: 28px;">
        espanolhonesto.com
      </div>
    </div>
  `;

  // @ts-expect-error - Satori expects a React-like VNode but satori-html output is compatible.
  const svg = await satori(html(markupString), {
    width: 1200,
    height: 630,
    fonts: [
      {
        name: 'Unbounded',
        data: fontData,
        weight: 700,
        style: 'normal',
      },
    ],
  });

  const resvg = new Resvg(svg, {
    fitTo: { mode: 'width', value: 1200 },
  });
  const pngData = resvg.render();
  const pngBuffer = pngData.asPng();

  // @ts-expect-error - Astro APIRoute return type may not perfectly match node Response stringency in CI.
  return new Response(pngBuffer, {
    status: 200,
    headers: {
      'Content-Type': 'image/png',
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  });
};
