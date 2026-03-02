import satori from 'satori';
import { html } from 'satori-html';
import { Resvg, initWasm } from '@resvg/resvg-wasm';
import type { APIRoute } from 'astro';

// Resvg WebAssembly Initialization Cache
let wasmInitialized = false;

export const GET: APIRoute = async ({ params }) => {
  const { slug } = params;

  // Basic static dictionary for on-demand generation parameters mapping
  const staticPages: Record<string, { title: string; category: string }> = {
    'home': { title: 'Español Honesto', category: 'Academia' },
    'contacto': { title: 'Contacto', category: 'Hablemos' },
    'blog': { title: 'Nuestro Blog', category: 'Artículos' },
  };

  const pageData = staticPages[slug as string] || { title: 'Español Honesto', category: 'Academia' };
  const { title, category } = pageData;

  // Initialize WASM for Resvg if not already done
  if (!wasmInitialized) {
    try {
      const wasmUrl = 'https://unpkg.com/@resvg/resvg-wasm@2.4.1/index_bg.wasm';
      await initWasm(fetch(wasmUrl));
      wasmInitialized = true;
    } catch (e) {
      console.error('Failed to initialize Resvg WASM:', e);
    }
  }

  // Descargamos tu fuente (Unbounded) en formato WOFF
  const fontData = await fetch(
    'https://cdn.jsdelivr.net/fontsource/fonts/unbounded@latest/latin-700-normal.woff'
  ).then((res) => res.arrayBuffer());

  // Diseño HTML usando tus colores
  const markupString = `
    <div style="background-color: #006064; width: 100%; height: 100%; display: flex; flex-direction: column; justify-content: center; align-items: center; padding: 60px; font-family: 'Unbounded';">
      
      <!-- Cabecera -->
      <div style="display: flex; justify-content: space-between; width: 100%; align-items: center; margin-bottom: 40px; color: #E0F7FA;">
        <span style="font-size: 32px; font-weight: bold;">Español Honesto</span>
        ${category ? `<span style="font-size: 24px; background: rgba(224, 247, 250, 0.2); padding: 8px 16px; border-radius: 9999px;">${category.toUpperCase()}</span>` : ''}
      </div>

      <!-- Main card / Título -->
      <div style="display: flex; background-color: #ffffff; padding: 60px; border-radius: 20px; width: 100%; flex-direction: column; justify-content: center; align-items: center; box-shadow: 0 10px 25px rgba(0,0,0,0.2);">
        <h1 style="color: #006064; font-size: 72px; font-weight: bold; text-align: center; line-height: 1.1; margin: 0;">
          ${title}
        </h1>
      </div>

      <!-- Pie -->
      <div style="display: flex; margin-top: 40px; color: #E0F7FA; font-size: 28px;">
        espanolhonesto.com
      </div>
    </div>
  `;

  // 1. Satori convierte el HTML en SVG
  // @ts-expect-error
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

  // 2. Resvg convierte ese SVG en un Buffer PNG perfecto
  const resvg = new Resvg(svg, {
    fitTo: { mode: 'width', value: 1200 },
  });
  const pngData = resvg.render();
  const pngBuffer = pngData.asPng();

  // 3. Devolvemos la imagen al navegador/build
  // @ts-expect-error
  return new Response(pngBuffer, {
    status: 200,
    headers: {
      'Content-Type': 'image/png',
      // Caché fuerte para que la subida vuele
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  });
};
