import { defineConfig, sessionDrivers } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';
import react from '@astrojs/react';
import tailwind from '@astrojs/tailwind';
import keystatic from '@keystatic/astro';

import markdoc from '@astrojs/markdoc';

import sentry from '@sentry/astro';
import { loadEnv } from 'vite';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const e2eRuntimeRoot = new URL('./tests/e2e/runtime/', import.meta.url);
const localRuntimeEnvRoot = path.join(tmpdir(), 'espanol-honesto', 'staging-env');
const e2eRuntimeIsolated = process.env.E2E_RUNTIME_ISOLATED === 'true';
const configuredLocalRuntimeEnv = process.env.ESPANOL_RUNTIME_ENV_DIR;
const e2eSsrOptimizedDependencies = [
    '@marsidev/react-turnstile',
    '@supabase/ssr',
    '@supabase/supabase-js',
    'react',
    'react/jsx-dev-runtime',
    'react/jsx-runtime',
    'react-dom',
    'react-dom/server',
];
if (!e2eRuntimeIsolated && !process.env.CLOUDFLARE_ENV) {
    // Astro 6/@astrojs-cloudflare selects Wrangler environments with
    // CLOUDFLARE_ENV. Local commands must fail safe to staging.
    process.env.CLOUDFLARE_ENV = 'staging';
}
if (
    !e2eRuntimeIsolated
    && process.env.CI !== 'true'
    && (
        !configuredLocalRuntimeEnv
        || path.resolve(configuredLocalRuntimeEnv) !== localRuntimeEnvRoot
    )
) {
    throw new Error('[env] Direct Astro commands are unsupported; use pnpm run dev or pnpm run build.');
}
if (
    !e2eRuntimeIsolated &&
    process.env.CI !== 'true' &&
    process.env.CLOUDFLARE_ENV === 'staging' &&
    !existsSync(new URL('./.dev.vars.staging', import.meta.url))
) {
    throw new Error('[env] Local staging refused: run pnpm env:staging:sync to create the allowlisted .dev.vars.staging file.');
}
const envDirectory = e2eRuntimeIsolated || process.env.CI === 'true'
    ? fileURLToPath(e2eRuntimeRoot)
    : localRuntimeEnvRoot;
const envMode = e2eRuntimeIsolated
    ? 'test'
    : process.env.CLOUDFLARE_ENV || process.env.NODE_ENV || 'staging';
const env = loadEnv(envMode, envDirectory, '');
const cloudflareTarget = process.env.CLOUDFLARE_ENV;
const expectedAppEnvironmentByTarget = {
    staging: 'staging',
};
const expectedAppEnvironment = expectedAppEnvironmentByTarget[cloudflareTarget];
if (!e2eRuntimeIsolated) {
    if (!expectedAppEnvironment) {
        throw new Error(`[env] Refused unknown Cloudflare target: ${cloudflareTarget || '<missing>'}`);
    }
    if (env.PUBLIC_APP_ENV?.trim().toLowerCase() !== expectedAppEnvironment) {
        throw new Error(
            `[env] Refused ${cloudflareTarget}: PUBLIC_APP_ENV must be exactly ${expectedAppEnvironment}.`,
        );
    }
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
const sentryUploadAllowed = env.SENTRY_UPLOAD_SOURCEMAPS === 'true';
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

function trustedHttpsOrigin(value, hostnameSuffix) {
    if (!value) return null;

    try {
        const url = new URL(value);
        const hostname = url.hostname.toLowerCase();
        if (
            url.protocol !== 'https:' ||
            (hostname !== hostnameSuffix && !hostname.endsWith(`.${hostnameSuffix}`))
        ) {
            return null;
        }
        return url.origin;
    } catch {
        return null;
    }
}

const supabaseCspOrigin = trustedHttpsOrigin(env.PUBLIC_SUPABASE_URL, 'supabase.co');
const sentryCspOrigin = trustedHttpsOrigin(sentryDsn, 'sentry.io');
const cspConnectResources = [
    "'self'",
    'https://challenges.cloudflare.com',
    ...(supabaseCspOrigin
        ? [supabaseCspOrigin, supabaseCspOrigin.replace(/^https:/u, 'wss:')]
        : []),
    ...(sentryCspOrigin ? [sentryCspOrigin] : []),
];

// https://astro.build/config
export default defineConfig({
    site: 'https://espanolhonesto.com',
    output: 'server',
    markdown: {
        // Shiki emits inline styles that cannot satisfy Astro's hash-based CSP.
        syntaxHighlight: 'prism',
    },
    security: {
        csp: {
            algorithm: 'SHA-256',
            directives: [
                "default-src 'self'",
                "base-uri 'none'",
                "object-src 'none'",
                "form-action 'self'",
                "img-src 'self' data:",
                `connect-src ${cspConnectResources.join(' ')}`,
                "font-src 'self'",
                "frame-src 'self' https://challenges.cloudflare.com",
                "manifest-src 'self'",
                "media-src 'none'",
                "worker-src 'self'",
                'upgrade-insecure-requests',
            ],
            scriptDirective: {
                resources: ["'self'", 'https://challenges.cloudflare.com'],
            },
            styleDirective: {
                resources: ["'self'"],
            },
        },
    },
    // The application uses Supabase cookies and never Astro sessions. An
    // in-memory no-op-sized driver avoids auto-provisioning a Cloudflare KV
    // namespace that the runtime would not use.
    session: {
        driver: sessionDrivers.lruCache({ max: 32 }),
    },
    devToolbar: {
        enabled: false,
    },
    vite: {
        envDir: envDirectory,
        ...(process.env.ESPANOL_RUNTIME_ENV_DIR ? {
            cacheDir: path.join(process.cwd(), 'node_modules', '.vite-staging'),
        } : {}),
        ...(e2eRuntimeIsolated ? {
            envDir: fileURLToPath(e2eRuntimeRoot),
            cacheDir: path.join(process.cwd(), 'node_modules', '.vite-e2e'),
            environments: {
                ssr: {
                    optimizeDeps: {
                        include: e2eSsrOptimizedDependencies,
                    },
                    dev: {
                        preTransformRequests: true,
                        warmup: [
                            './src/components/PublicHomePage.astro',
                            './src/components/LandingPage.astro',
                            './src/components/PricingSection.tsx',
                            './src/components/LeadCaptureForm.tsx',
                        ],
                    },
                },
            },
        } : {}),
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
        imageService: 'passthrough',
        prerenderEnvironment: 'node',
        ...(e2eRuntimeIsolated ? {
            configPath: './tests/e2e/runtime/wrangler.toml',
            persistState: false,
            remoteBindings: false,
        } : {}),
    }),
    integrations: [...(e2eRuntimeIsolated ? [e2eRuntimeProcessGuard] : []), react(), markdoc(), ...(keystaticEnabled ? [keystatic()] : []), tailwind({
        applyBaseStyles: false,
    }),
    ...(sentryIntegrationEnabled ? [sentry({
        org: env.SENTRY_ORG,
        project: env.SENTRY_PROJECT,
        authToken: env.SENTRY_AUTH_TOKEN,
        telemetry: false,
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
