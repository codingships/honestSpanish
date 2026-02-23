import { defineConfig } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';
import react from '@astrojs/react';
import tailwind from '@astrojs/tailwind';
import sitemap from '@astrojs/sitemap';
import sentry from '@sentry/astro';
import { loadEnv } from 'vite';

const env = loadEnv(process.env.NODE_ENV ?? 'development', process.cwd(), '');

// https://astro.build/config
export default defineConfig({
    site: 'https://espanolhonesto.com',
    output: 'server',
    adapter: cloudflare({
        platformProxy: {
            enabled: true
        }
    }),
    integrations: [
        sentry({
            dsn: env.PUBLIC_SENTRY_DSN,
            sourceMapsUploadOptions: {
                project: "javascript-astro", // Update with your Sentry Project Name
                org: "espanol-honesto", // Update with your Sentry Org Name
            },
        }),
        react(),
        tailwind({
            applyBaseStyles: false,
        }),
        sitemap({
            filter: (page) =>
                !page.includes('/campus/') &&
                !page.includes('/campus') &&
                !page.includes('/login') &&
                !page.includes('/logout') &&
                !page.includes('/success') &&
                !page.includes('/cancel') &&
                !page.includes('/api/'),
            i18n: {
                defaultLocale: 'es',
                locales: {
                    es: 'es-ES',
                    en: 'en-US',
                    ru: 'ru-RU',
                },
            },
        }),
    ],
    i18n: {
        defaultLocale: 'es',
        locales: ['es', 'en', 'ru'],
        routing: {
            prefixDefaultLocale: false
        }
    }
});
