import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const astroConfig = readFileSync('astro.config.mjs', 'utf8');
const sentryClientConfig = readFileSync('sentry.client.config.ts', 'utf8');
const sentryServerConfig = readFileSync('sentry.server.config.ts', 'utf8');
const envExample = readFileSync('.env.example', 'utf8');
const environmentDoc = readFileSync('docs/launch/ENVIRONMENT.md', 'utf8');

describe('Astro Sentry runtime boundary', () => {
    it('keeps local/dev capture opt-in and tags deployed environments explicitly', () => {
        for (const snippet of [
            "const localRuntime = process.env.NODE_ENV !== 'production';",
            'SENTRY_CAPTURE_LOCAL',
            'const sentryCaptureAllowed',
            "const sentryDsn = sentryCaptureAllowed ? env.PUBLIC_SENTRY_DSN || env.SENTRY_DSN || '' : '';",
            'const sentryEnvironment = env.SENTRY_ENVIRONMENT',
            '__SENTRY_ENVIRONMENT__: JSON.stringify(sentryEnvironment)',
        ]) {
            expect(astroConfig).toContain(snippet);
        }

        for (const config of [sentryClientConfig, sentryServerConfig]) {
            expect(config).toContain('declare const __SENTRY_ENVIRONMENT__: string;');
            expect(config).toContain('const environment = __SENTRY_ENVIRONMENT__;');
            expect(config).toContain('environment: environment || undefined');
        }

        expect(sentryServerConfig).toContain('defaultIntegrations: false');
        expect(sentryServerConfig).toContain('integrations: []');

        expect(envExample).toContain('SENTRY_CAPTURE_LOCAL=false');
        expect(envExample).toContain('SENTRY_ENVIRONMENT=');
        expect(environmentDoc).toContain('SENTRY_CAPTURE_LOCAL=false');
        expect(environmentDoc).toContain('local-<NODE_ENV>');
        expect(environmentDoc).toContain('evita que dev/QA local contamine Sentry production');
    });
});
