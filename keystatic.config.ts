import { config, fields, collection } from '@keystatic/core';

export default config({
    storage: {
        // Cuando probamos en local, guarda en el disco duro. 
        // En producción (Cloudflare), guardará contra el repo de Github.
        kind: 'local',
    },
    collections: {
        blog: collection({
            label: 'Blog Posts',
            slugField: 'title',
            path: 'src/content/blog/*/',
            format: { contentField: 'content' },
            schema: {
                title: fields.slug({ name: { label: 'Título' } }),
                description: fields.text({
                    label: 'Descripción Corta (SEO)',
                    description: 'Aparecerá en las tarjetas de previsualización y en Google.',
                    validation: { length: { min: 10, max: 160 } }
                }),
                publishedAt: fields.date({
                    label: 'Fecha de Publicación',
                    validation: { isRequired: true }
                }),
                author: fields.select({
                    label: 'Autor',
                    options: [
                        { label: 'Alejandro', value: 'alejandro' },
                        { label: 'Alin', value: 'alin' },
                        { label: 'Equipo Español Honesto', value: 'equipo' }
                    ],
                    defaultValue: 'equipo'
                }),
                category: fields.select({
                    label: 'Categoría',
                    options: [
                        { label: 'Aprendizaje', value: 'aprendizaje' },
                        { label: 'Niveles', value: 'niveles' },
                        { label: 'Expatriados', value: 'expatriados' },
                        { label: 'Cultura', value: 'cultura' },
                        { label: 'Método', value: 'metodo' }
                    ],
                    defaultValue: 'aprendizaje'
                }),
                tags: fields.array(
                    fields.text({ label: 'Tag' }),
                    { label: 'Etiquetas', itemLabel: props => props.value }
                ),
                image: fields.image({
                    label: 'Imagen Principal',
                    directory: 'src/assets/blog',
                    publicPath: '../../assets/blog/'
                }),
                imageAlt: fields.text({ label: 'Texto Alternativo de la Imagen (Accesibilidad)' }),
                lang: fields.select({
                    label: 'Idioma',
                    options: [
                        { label: 'Español (es)', value: 'es' },
                        { label: 'Inglés (en)', value: 'en' },
                        { label: 'Ruso (ru)', value: 'ru' }
                    ],
                    defaultValue: 'es'
                }),
                translationKey: fields.text({
                    label: 'Clave de Traducción',
                    description: 'Usa la misma palabra clave (ej: "subjuntivo-tips") para vincular las versiones ES/EN/RU de este artículo.'
                }),
                content: fields.document({
                    label: 'Contenido del Artículo',
                    formatting: true,
                    dividers: true,
                    links: true,
                    images: {
                        directory: 'src/assets/blog/inline',
                        publicPath: '../../assets/blog/inline/'
                    }
                }),
            },
        }),
    },
});
