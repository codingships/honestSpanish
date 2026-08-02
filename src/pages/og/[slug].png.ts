import type { APIRoute } from 'astro';
import { getCollection, type CollectionEntry } from 'astro:content';
import { getBlogCategoryLabel, getBlogOgKey, isPublishedBlogPost } from '../../lib/blog-routes';
import { renderOgImage, type OgImageWidth } from '../../lib/og-image-renderer';

type OgPage = {
  title: string;
  category: string;
  outputWidth: OgImageWidth;
};

type OgContent = Omit<OgPage, 'outputWidth'>;

const staticPages: Record<string, OgContent> = {
  home: { title: 'Español Honesto', category: 'Academia' },
  contacto: { title: 'Contacto', category: 'Hablemos' },
  'es-blog': { title: 'Nuestro Blog', category: 'Artículos' },
  'en-blog': { title: 'Our Blog', category: 'Articles' },
  'ru-blog': { title: 'Наш блог', category: 'Статьи' },
};

export const prerender = true;

export async function getStaticPaths() {
  const blogPosts: CollectionEntry<'blog'>[] = await getCollection('blog');
  const pagesBySlug = new Map<string, OgContent>(Object.entries(staticPages));

  for (const post of blogPosts
    .filter(isPublishedBlogPost)
    .sort((left: CollectionEntry<'blog'>, right: CollectionEntry<'blog'>) => left.id.localeCompare(right.id))) {
    const ogKey = getBlogOgKey(post);
    if (pagesBySlug.has(ogKey)) throw new Error('Duplicate OG image key: ' + ogKey);
    pagesBySlug.set(ogKey, {
      title: post.data.title,
      category: getBlogCategoryLabel(post.data.lang, post.data.category),
    });
  }

  for (const slug of pagesBySlug.keys()) {
    if (pagesBySlug.has(slug + '-600')) {
      throw new Error('OG image key collides with responsive variant: ' + slug);
    }
  }

  return [...pagesBySlug].flatMap(([slug, content]) => ([
    {
      params: { slug },
      props: { ...content, outputWidth: 1200 as const },
    },
    {
      params: { slug: slug + '-600' },
      props: { ...content, outputWidth: 600 as const },
    },
  ]));
}

export const GET: APIRoute<OgPage> = async ({ props: { title, category, outputWidth } }) => {
  const responseBody = await renderOgImage({ title, category, outputWidth });

  return new Response(responseBody, {
    status: 200,
    headers: {
      'Content-Type': 'image/png',
      'Cache-Control': 'public, max-age=86400, stale-while-revalidate=604800',
    },
  });
};
