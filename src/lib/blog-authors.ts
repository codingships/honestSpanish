export type BlogAuthorId = 'alejandro' | 'alin' | 'equipo';

type BlogAuthor = {
    name: string;
    schemaType: 'Person' | 'Organization';
};

const AUTHORS: Record<BlogAuthorId, BlogAuthor> = {
    alejandro: { name: 'Alejandro', schemaType: 'Person' },
    alin: { name: 'Alin', schemaType: 'Person' },
    equipo: { name: 'Equipo Español Honesto', schemaType: 'Organization' },
};

export function getBlogAuthor(authorId: BlogAuthorId): BlogAuthor {
    return AUTHORS[authorId];
}

export function getBlogAuthorSchema(authorId: BlogAuthorId): {
    '@type': BlogAuthor['schemaType'];
    name: string;
} {
    const author = getBlogAuthor(authorId);
    return {
        '@type': author.schemaType,
        name: author.name,
    };
}
