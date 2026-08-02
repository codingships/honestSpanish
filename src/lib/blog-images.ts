import type { CollectionEntry } from 'astro:content';
import { getBlogOgKey } from './blog-routes';

export type BlogImagePresentation = {
    src: string;
    srcSet?: string;
    alt: string;
    width: number;
    height: number;
    generated: boolean;
};

type BlogImageEntry = Pick<CollectionEntry<'blog'>, 'id' | 'data'>;

export function getBlogImagePresentation(entry: BlogImageEntry): BlogImagePresentation {
    const image = entry.data.image;
    if (image) {
        return {
            src: image.src,
            alt: entry.data.imageAlt || entry.data.title,
            width: image.width,
            height: image.height,
            generated: false,
        };
    }

    const basePath = '/og/' + getBlogOgKey(entry);
    return {
        src: basePath + '.png',
        srcSet: basePath + '-600.png 600w, ' + basePath + '.png 1200w',
        alt: '',
        width: 1200,
        height: 630,
        generated: true,
    };
}
