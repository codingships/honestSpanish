import rss from '@astrojs/rss';
import { getCollection } from 'astro:content';
import type { APIContext } from 'astro';

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

    // Filter posts by language based on slug (e.g., 'es/post-slug')
    const localizedPosts = posts.filter(post => post.slug.startsWith(`${lang}/`));

    return rss({
        title: 'Español Honesto Blog',
        description: 'Aprende español para vivir en España. Consejos reales, sin atajos.',
        site: context.site + `${lang}/blog`,
        items: localizedPosts.map((post) => {
            const slugParts = post.slug.split('/');
            const cleanSlug = slugParts.slice(1).join('/'); // Remove lang prefix
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
