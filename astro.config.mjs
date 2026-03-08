import { defineConfig } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';
import react from '@astrojs/react';
import tailwind from '@astrojs/tailwind';
import sitemap from '@astrojs/sitemap';
import keystatic from '@keystatic/astro';

import markdoc from '@astrojs/markdoc';

import sentry from '@sentry/astro';

// https://astro.build/config
export default defineConfig({
    site: 'https://espanolhonesto.com',
    output: 'server',
    image: {
        service: {
            entrypoint: 'astro/assets/services/noop'
        }
    },
    adapter: cloudflare({
        platformProxy: {
            enabled: true
        }
    }),
    integrations: [react(), markdoc(), keystatic(), tailwind({
        applyBaseStyles: false,
    }), sitemap({
        filter: (page) =>
            !page.includes('/campus/') &&
            !page.includes('/campus') &&
            !page.includes('/login') &&
            !page.includes('/logout') &&
            !page.includes('/success') &&
            !page.includes('/cancel') &&
            !page.includes('/keystatic') &&
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
    sentry({
        dsn: import.meta.env.SENTRY_DSN,
        sourceMapsUploadOptions: {
            project: "pruebas",
            authToken: process.env.SENTRY_AUTH_TOKEN,
        },
    })
    ],
    i18n: {
        defaultLocale: 'es',
        locales: ['es', 'en', 'ru'],
        routing: {
            prefixDefaultLocale: false
        }
    }
});