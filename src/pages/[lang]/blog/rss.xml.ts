import rss from '@astrojs/rss';
import { getCollection, type CollectionEntry } from 'astro:content';
import type { APIContext } from 'astro';
import { getBlogAuthor } from '../../../lib/blog-authors';
import { getBlogEntryParts, isPublishedBlogPost } from '../../../lib/blog-routes';
import {
    isPublicLang,
    localizedPublicPath,
    publicUrl,
    type PublicLang,
} from '../../../lib/public-seo';

export const prerender = true;

const FEED_COPY: Record<PublicLang, { title: string; description: string }> = {
    es: {
        title: 'Blog de Español Honesto',
        description: 'Español real para vivir, trabajar y conversar en España.',
    },
    en: {
        title: 'Español Honesto Blog',
        description: 'Practical Spanish for living, working and taking part in conversations in Spain.',
    },
    ru: {
        title: 'Блог Español Honesto',
        description: 'Практический испанский для жизни, работы и общения в Испании.',
    },
};

export function getStaticPaths() {
    return ['es', 'en', 'ru'].map((lang) => ({ params: { lang } }));
}

export async function GET(context: APIContext) {
    const candidateLang = context.params.lang;
    if (!isPublicLang(candidateLang)) {
        return new Response('Not found', { status: 404 });
    }
    const lang = candidateLang;
    const posts = (await getCollection('blog'))
        .filter((post: CollectionEntry<'blog'>) => (
            isPublishedBlogPost(post) && getBlogEntryParts(post).lang === lang
        ))
        .sort((left: CollectionEntry<'blog'>, right: CollectionEntry<'blog'>) => (
            right.data.publishedAt.valueOf() - left.data.publishedAt.valueOf()
        ));
    const copy = FEED_COPY[lang];

    return rss({
        title: copy.title,
        description: copy.description,
        site: publicUrl(lang, '/blog'),
        items: posts.map((post: CollectionEntry<'blog'>) => {
            const { slug } = getBlogEntryParts(post);
            return {
                title: post.data.title,
                pubDate: post.data.publishedAt,
                description: post.data.description,
                link: localizedPublicPath(lang, '/blog/' + slug),
                author: getBlogAuthor(post.data.author).name,
            };
        }),
        customData: '<language>' + lang + '</language>',
    });
}
