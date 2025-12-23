# Estructura del Proyecto (Español Honesto)

Este proyecto es un sitio web estático generado con **Astro 5** y **React**, configurado para soporte multiidioma (i18n) y un blog basado en contenido (Markdown).

## Directorios Principales

### `/src` - Código Fuente
Es donde vive toda la lógica del sitio.

*   **`/components`**: Componentes reutilizables.
    *   `LandingPage.astro`: El componente maestro de la página de inicio (portado de React a Astro).
*   **`/content`**: Colecciones de contenido (Base de datos de archivos).
    *   `config.ts`: Esquema de validación (Zod) para el blog.
    *   `/blog`: Artículos en Markdown organizados por idioma (`es/`, `en/`, `ru/`).
*   **`/layouts`**: Plantillas maestras.
    *   `BaseLayout.astro`: Estructura HTML base (`<head>`, SEO, estilos globales).
    *   `BlogLayout.astro`: Plantilla específica para artículos (breadcrumbs, autor, relacionados).
*   **`/pages`**: Rutas del sitio (File-based routing).
    *   `/es`, `/en`, `/ru`: Páginas de inicio por idioma.
    *   `/[lang]/blog/index.astro`: Índice del blog (lista de posts).
    *   `/[lang]/blog/[slug].astro`: Página de detalle de cada post (ruta dinámica).
    *   `rss.xml.ts`: Generador del feed RSS.
*   **`/i18n`**: Internacionalización.
    *   `translations.ts`: Diccionario de textos (JSON grande con todas las traducciones).
    *   `utils.ts`: Funciones auxiliares (`useTranslations`, `getLocalizedPath`).
*   **`/styles`**: CSS global.

### `/public` - Archivos Estáticos
Archivos que se sirven tal cual, sin procesar.
*   `/images`: Imágenes del blog y assets.
*   `robots.txt`: Configuración para buscadores.
*   `favicon.svg`: Icono del sitio.

---

## Archivos de Configuración Clave

*   **`astro.config.mjs`**: Configuración de Astro (integraciones React, Tailwind, Sitemap, i18n).
*   **`tailwind.config.mjs`**: Configuración de estilos y diseño.
*   **`tsconfig.json`**: Configuración de TypeScript (strict mode, alias).
*   **`package.json`**: Dependencias del proyecto.

## Flujo de Datos
1.  **Home**: `src/pages/[lang]/index.astro` -> carga `LandingPage.astro` -> usa `i18n/translations.ts`.
2.  **Blog**: `src/content/blog/` (.md) -> validado por `content/config.ts` -> renderizado en `pages/[lang]/blog/[slug].astro` usando `BlogLayout.astro`.
