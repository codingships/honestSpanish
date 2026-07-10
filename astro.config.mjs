import { defineConfig } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';
import react from '@astrojs/react';
import tailwind from '@astrojs/tailwind';
import sitemap from '@astrojs/sitemap';
import keystatic from '@keystatic/astro';

import markdoc from '@astrojs/markdoc';

import sentry from '@sentry/astro';
import { loadEnv } from 'vite';
import { fileURLToPath } from 'node:url';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const e2eRuntimeRoot = new URL('./tests/e2e/runtime/', import.meta.url);
const e2eRuntimeIsolated = process.env.E2E_RUNTIME_ISOLATED === 'true';
if (!e2eRuntimeIsolated && !process.env.CLOUDFLARE_ENV) {
    // Astro 6/@astrojs-cloudflare selects Wrangler environments with
    // CLOUDFLARE_ENV. Local commands must fail safe to staging.
    process.env.CLOUDFLARE_ENV = 'staging';
}
if (
    !e2eRuntimeIsolated &&
    process.env.CI !== 'true' &&
    process.env.CLOUDFLARE_ENV === 'staging' &&
    !existsSync(new URL('./.dev.vars.staging', import.meta.url))
) {
    throw new Error('[env] Local staging refused: run pnpm env:staging:sync to create the allowlisted .dev.vars.staging file.');
}
const envDirectory = e2eRuntimeIsolated
    ? fileURLToPath(e2eRuntimeRoot)
    : process.env.ESPANOL_RUNTIME_ENV_DIR
        ? path.resolve(process.env.ESPANOL_RUNTIME_ENV_DIR)
        : process.cwd();
const envMode = e2eRuntimeIsolated
    ? 'test'
    : process.env.CLOUDFLARE_ENV || process.env.NODE_ENV || 'staging';
const env = loadEnv(envMode, envDirectory, '');
const legalIdentitySource = readFileSync(new URL('./src/lib/legal-identity.ts', import.meta.url), 'utf8');
const legalIdentityIsExample = /LEGAL_IDENTITY_MODE\s*=\s*['"]example['"]/.test(legalIdentitySource);

if (env.PUBLIC_APP_ENV === 'production' && legalIdentityIsExample) {
    throw new Error('[legal-identity] Production build refused: replace example legal identity with verified public data.');
}
const e2eProcessKeys = [
    'PUBLIC_SUPABASE_URL',
    'PUBLIC_SUPABASE_ANON_KEY',
    'SUPABASE_SERVICE_ROLE_KEY',
    'PUBLIC_APP_ENV',
    'CHECKOUT_ENABLED',
    'E2E_DISABLE_EXTERNAL_INTEGRATIONS',
    'E2E_RUNTIME_ISOLATED',
    'E2E_TARGET_SUPABASE_REF',
];
const e2eProviderKeys = [
    'CRON_SECRET',
    'FULFILLMENT_WORKER_URL',
    'GOOGLE_ADMIN_EMAIL',
    'GOOGLE_DRIVE_ROOT_FOLDER_ID',
    'GOOGLE_SERVICE_ACCOUNT_EMAIL',
    'GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY',
    'GOOGLE_TEMPLATE_DOC_ID',
    'INTERNAL_JOB_SECRET',
    'INTERNAL_JOB_SERVICE_URL',
    'PUBLIC_SENTRY_DSN',
    'PUBLIC_STRIPE_PUBLISHABLE_KEY',
    'RESEND_API_KEY',
    'SENTRY_AUTH_TOKEN',
    'SENTRY_DSN',
    'STRIPE_SECRET_KEY',
    'STRIPE_WEBHOOK_SECRET',
];
const capturedE2eProcessEnv = Object.fromEntries(
    e2eProcessKeys.map((key) => [key, process.env[key]]),
);
const e2eRuntimeProcessGuard = {
    name: 'espanol-honesto:e2e-runtime-process-guard',
    hooks: {
        'astro:config:done': () => {
            if (!e2eRuntimeIsolated) return;

            for (const key of e2eProviderKeys) delete process.env[key];
            for (const [key, value] of Object.entries(capturedE2eProcessEnv)) {
                if (value) process.env[key] = value;
                else delete process.env[key];
            }
            process.env.CLOUDFLARE_INCLUDE_PROCESS_ENV = 'false';

            if (
                process.env.E2E_RUNTIME_ISOLATED !== 'true' ||
                process.env.E2E_DISABLE_EXTERNAL_INTEGRATIONS !== 'true' ||
                process.env.CHECKOUT_ENABLED !== 'false' ||
                !process.env.PUBLIC_SUPABASE_URL?.includes(process.env.E2E_TARGET_SUPABASE_REF || '__missing__')
            ) {
                throw new Error('[e2e-env] Astro runtime process guard refused an inconsistent environment');
            }
        },
    },
};
const externalIntegrationsDisabled =
    process.env.E2E_DISABLE_EXTERNAL_INTEGRATIONS === 'true' ||
    env.E2E_DISABLE_EXTERNAL_INTEGRATIONS === 'true';
const localRuntime = process.env.NODE_ENV !== 'production';
const sentryCaptureLocalAllowed =
    process.env.SENTRY_CAPTURE_LOCAL === 'true' ||
    env.SENTRY_CAPTURE_LOCAL === 'true';
const sentryCaptureAllowed = !externalIntegrationsDisabled && (!localRuntime || sentryCaptureLocalAllowed);
const sentryUploadAllowed = process.env.CI === 'true' || env.SENTRY_UPLOAD_SOURCEMAPS === 'true';
const sentrySourcemapsEnabled = Boolean(
    sentryUploadAllowed &&
    env.SENTRY_AUTH_TOKEN &&
    env.SENTRY_ORG &&
    env.SENTRY_PROJECT
);
const sentryDsn = sentryCaptureAllowed ? env.PUBLIC_SENTRY_DSN || env.SENTRY_DSN || '' : '';
const sentryEnvironment = env.SENTRY_ENVIRONMENT || (localRuntime ? `local-${process.env.NODE_ENV || 'development'}` : env.PUBLIC_APP_ENV || 'production');
const sentryIntegrationEnabled = Boolean((sentryDsn || sentrySourcemapsEnabled) && !externalIntegrationsDisabled);
const keystaticEnabled = env.KEYSTATIC_ENABLED === 'true' && process.env.NODE_ENV !== 'production';

// https://astro.build/config
export default defineConfig({
    site: 'https://espanolhonesto.com',
    output: 'server',
    devToolbar: {
        enabled: false,
    },
    vite: {
        envDir: envDirectory,
        ...(process.env.ESPANOL_RUNTIME_ENV_DIR ? {
            cacheDir: path.join(process.cwd(), 'node_modules', '.vite-staging'),
        } : {}),
        ...(e2eRuntimeIsolated ? { envDir: fileURLToPath(e2eRuntimeRoot) } : {}),
        define: {
            __SENTRY_DSN__: JSON.stringify(sentryDsn),
            __SENTRY_ENVIRONMENT__: JSON.stringify(sentryEnvironment),
            __E2E_RUNTIME_BUILD__: JSON.stringify(e2eRuntimeIsolated),
        },
        optimizeDeps: {
            include: sentryIntegrationEnabled ? ['@sentry/astro'] : [],
        },
        ssr: {
            optimizeDeps: {
                include: sentryIntegrationEnabled
                    ? ['@sentry/astro', '@sentry/astro/middleware']
                    : [],
                exclude: ['zod', 'resend'],
            },
        },
        server: {
            allowedHosts: ['.trycloudflare.com'],
        },
    },
    image: {
        service: {
            entrypoint: 'astro/assets/services/noop'
        }
    },
    adapter: cloudflare({
        prerenderEnvironment: 'node',
        ...(e2eRuntimeIsolated ? {
            configPath: './tests/e2e/runtime/wrangler.toml',
            persistState: false,
            remoteBindings: false,
        } : {}),
    }),
    integrations: [...(e2eRuntimeIsolated ? [e2eRuntimeProcessGuard] : []), react(), markdoc(), ...(keystaticEnabled ? [keystatic()] : []), tailwind({
        applyBaseStyles: false,
    }), sitemap({
        filter: (page) =>
            page !== 'https://espanolhonesto.com/' &&
            !page.includes('/campus/') &&
            !page.includes('/campus') &&
            !page.includes('/login') &&
            !page.includes('/logout') &&
            !page.includes('/success') &&
            !page.includes('/cancel') &&
            !page.includes('/legal') &&
            !page.includes('/demo') &&
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
    ...(sentryIntegrationEnabled ? [sentry({
        org: env.SENTRY_ORG,
        project: env.SENTRY_PROJECT,
        authToken: env.SENTRY_AUTH_TOKEN,
        sourcemaps: {
            disable: !sentrySourcemapsEnabled,
        },
    })] : [])
    ],
    i18n: {
        defaultLocale: 'es',
        locales: ['es', 'en', 'ru'],
        routing: {
            prefixDefaultLocale: true
        }
    }
});
