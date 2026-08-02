import { collection, config, fields } from '@keystatic/core';

const languages = {
    es: 'Español',
    en: 'English',
    ru: 'Русский',
} as const;

type BlogLanguage = keyof typeof languages;

function createBlogCollection(lang: BlogLanguage) {
    return collection({
        label: `Blog · ${languages[lang]}`,
        slugField: 'title',
        path: `src/content/blog/${lang}/*`,
        entryLayout: 'content',
        format: { contentField: 'content' },
        columns: ['title', 'publishedAt', 'draft'],
        schema: {
            title: fields.slug({
                name: {
                    label: 'Título',
                    validation: { isRequired: true },
                },
            }),
            description: fields.text({
                label: 'Descripción corta (SEO)',
                description: 'Se muestra en buscadores, índices y tarjetas.',
                validation: { isRequired: true, length: { min: 10, max: 160 } },
                multiline: true,
            }),
            publishedAt: fields.date({
                label: 'Fecha de publicación',
                validation: { isRequired: true },
            }),
            updatedAt: fields.date({
                label: 'Última actualización',
                description: 'Déjalo vacío hasta que exista un cambio editorial material.',
            }),
            draft: fields.checkbox({
                label: 'Borrador: no publicar',
                defaultValue: true,
                description: 'Desmárcalo solo cuando traducciones, enlaces y oferta estén revisados.',
            }),
            author: fields.select({
                label: 'Autor',
                options: [
                    { label: 'Alejandro', value: 'alejandro' },
                    { label: 'Alin', value: 'alin' },
                    { label: 'Equipo Español Honesto', value: 'equipo' },
                ],
                defaultValue: 'equipo',
            }),
            category: fields.select({
                label: 'Categoría',
                options: [
                    { label: 'Aprendizaje', value: 'aprendizaje' },
                    { label: 'Niveles', value: 'niveles' },
                    { label: 'Expatriados', value: 'expatriados' },
                    { label: 'Cultura', value: 'cultura' },
                    { label: 'Método', value: 'metodo' },
                ],
                defaultValue: 'aprendizaje',
            }),
            tags: fields.array(
                fields.text({
                    label: 'Etiqueta',
                    validation: { isRequired: true, length: { min: 1, max: 40 } },
                }),
                {
                    label: 'Etiquetas',
                    itemLabel: (props) => props.value,
                    validation: { length: { max: 8 } },
                },
            ),
            image: fields.image({
                label: 'Imagen principal',
                directory: 'src/assets/blog',
                publicPath: '../../../assets/blog/',
            }),
            imageAlt: fields.text({
                label: 'Texto alternativo de la imagen',
                description: 'Describe la imagen; no repitas el título del artículo.',
                validation: { length: { max: 160 } },
            }),
            lang: fields.select({
                label: 'Idioma',
                options: [{ label: languages[lang], value: lang }],
                defaultValue: lang,
            }),
            translationKey: fields.text({
                label: 'Clave de traducción',
                description: 'La misma clave enlaza las versiones ES, EN y RU.',
                validation: {
                    length: { max: 80 },
                    pattern: {
                        regex: /^[a-z0-9]+(?:-[a-z0-9]+)*$/u,
                        message: 'Usa minúsculas, números y guiones, por ejemplo: vivir-en-espana.',
                    },
                },
            }),
            relatedTranslationKeys: fields.array(
                fields.text({
                    label: 'Clave relacionada',
                    validation: {
                        isRequired: true,
                        pattern: {
                            regex: /^[a-z0-9]+(?:-[a-z0-9]+)*$/u,
                            message: 'Usa una translationKey existente.',
                        },
                    },
                }),
                {
                    label: 'Artículos relacionados',
                    description: 'Orden editorial; usa de una a tres claves con traducción publicada en este idioma.',
                    itemLabel: (props) => props.value,
                    validation: { length: { max: 3 } },
                },
            ),
            ctaText: fields.text({
                label: 'Texto del CTA',
                description: 'Mensaje localizado que conecta el artículo con la oferta.',
                validation: { length: { max: 120 } },
            }),
            ctaLink: fields.text({
                label: 'Destino del CTA',
                description: 'Ruta interna iniciada por / o URL HTTPS.',
                validation: {
                    length: { max: 300 },
                    pattern: {
                        regex: /^(?:\/(?!\/)(?!(?:es|en|ru)(?:\/|$))[^?#\\]*|https:\/\/\S+)$/u,
                        message: 'Usa una ruta interna sin idioma/query/fragmento o una URL HTTPS.',
                    },
                },
            }),
            content: fields.markdoc({
                label: 'Contenido del artículo',
                extension: 'md',
                options: {
                    image: {
                        directory: 'src/assets/blog/inline',
                        publicPath: '../../../assets/blog/inline/',
                    },
                },
            }),
        },
    });
}

export default config({
    // El editor local escribe en la rama/worktree activa. Publicar sigue pasando por Git y CI.
    storage: { kind: 'local' },
    ui: {
        brand: { name: 'Español Honesto · Blog' },
        navigation: {
            Contenido: ['blogEs', 'blogEn', 'blogRu'],
        },
    },
    collections: {
        blogEs: createBlogCollection('es'),
        blogEn: createBlogCollection('en'),
        blogRu: createBlogCollection('ru'),
    },
});
