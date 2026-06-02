import { defineConfig } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';
import react from '@astrojs/react';
import tailwind from '@astrojs/tailwind';
import sitemap from '@astrojs/sitemap';
import keystatic from '@keystatic/astro';

import markdoc from '@astrojs/markdoc';

import sentry from '@sentry/astro';
import { loadEnv } from 'vite';

const env = loadEnv(process.env.NODE_ENV || 'production', process.cwd(), '');
const sentrySourcemapsEnabled = Boolean(env.SENTRY_AUTH_TOKEN && env.SENTRY_ORG && env.SENTRY_PROJECT);
const sentryDsn = env.PUBLIC_SENTRY_DSN || env.SENTRY_DSN || '';

// https://astro.build/config
export default defineConfig({
    site: 'https://espanolhonesto.com',
    output: 'server',
    vite: {
        define: {
            __SENTRY_DSN__: JSON.stringify(sentryDsn),
        },
    },
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
        org: env.SENTRY_ORG,
        project: env.SENTRY_PROJECT,
        authToken: env.SENTRY_AUTH_TOKEN,
        sourcemaps: {
            disable: !sentrySourcemapsEnabled,
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
