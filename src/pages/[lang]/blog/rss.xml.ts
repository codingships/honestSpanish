import rss from '@astrojs/rss';
import { getCollection, type CollectionEntry } from 'astro:content';
import type { APIContext } from 'astro';
import { getBlogEntryParts, isPublishedBlogPost } from '../../../lib/blog-routes';

export const prerender = true;

export async function getStaticPaths() {
    return [
        { params: { lang: 'es' } },
        { params: { lang: 'en' } },
        { params: { lang: 'ru' } },
    ];
}

export async function GET(context: APIContext) {
    const lang = context.params.lang as 'es' | 'en' | 'ru';
    const posts = await getCollection('blog');

    const localizedPosts = posts.filter((post: CollectionEntry<'blog'>) => (
        isPublishedBlogPost(post) && getBlogEntryParts(post).lang === lang
    ));

    return rss({
        title: 'Español Honesto Blog',
        description: 'Aprende español para vivir en España. Consejos reales, sin atajos.',
        site: context.site + `${lang}/blog`,
        items: localizedPosts.map((post: CollectionEntry<'blog'>) => {
            const { slug: cleanSlug } = getBlogEntryParts(post);
            return {
                title: post.data.title,
                pubDate: post.data.publishedAt,
                description: post.data.description,
                link: `/${lang}/blog/${cleanSlug}/`,
                author: post.data.author === 'alejandro' ? 'Alejandro' : 'Alin',
            };
        }),
        customData: `<language>${lang}</language>`,
    });
}
