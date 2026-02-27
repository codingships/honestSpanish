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
        dsn: "https://5d4cf483a96afdd883e438654f6b4dfa@o4510912289701888.ingest.de.sentry.io/4510917714444368",
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