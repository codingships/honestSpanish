import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const astroConfig = readFileSync('astro.config.mjs', 'utf8');
const sentryClientConfig = readFileSync('sentry.client.config.ts', 'utf8');
const sentryServerConfig = readFileSync('sentry.server.config.ts', 'utf8');
const stagingReleaseBuild = readFileSync('scripts/dev/build-staging-release.ts', 'utf8');
const envExample = readFileSync('.env.example', 'utf8');
const environmentDoc = readFileSync('docs/ENVIRONMENTS.md', 'utf8');

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
        expect(astroConfig).toContain('telemetry: false');
        expect(astroConfig).toContain("const sentryUploadAllowed = env.SENTRY_UPLOAD_SOURCEMAPS === 'true';");
        expect(astroConfig).not.toContain("process.env.CI === 'true' || env.SENTRY_UPLOAD_SOURCEMAPS");

        expect(envExample).toContain('SENTRY_CAPTURE_LOCAL=false');
        expect(envExample).toContain('SENTRY_UPLOAD_SOURCEMAPS=false');
        expect(envExample).toContain('SENTRY_ENVIRONMENT=');
        expect(environmentDoc).toContain('SENTRY_CAPTURE_LOCAL=false');
        expect(environmentDoc).toContain('SENTRY_ENVIRONMENT');
        expect(environmentDoc).toContain('No local telemetry is sent to Sentry');
    });

    it('keeps the staging build read-only with respect to Sentry', () => {
        expect(stagingReleaseBuild).toContain('PUBLIC_SENTRY_DSN must be configured explicitly for staging');
        expect(stagingReleaseBuild).toContain('PUBLIC_SENTRY_DSN must identify the exact Academy Sentry project');
        expect(stagingReleaseBuild).toContain('o4510912289701888.ingest.de.sentry.io');
        expect(stagingReleaseBuild).toContain('/4510917714444368');
        expect(stagingReleaseBuild).toContain("process.env.SENTRY_UPLOAD_SOURCEMAPS === 'true'");
        expect(stagingReleaseBuild).toContain("process.env.SENTRY_UPLOAD_SOURCEMAPS = 'false'");
        expect(stagingReleaseBuild).not.toContain('SENTRY_AUTH_TOKEN');
        expect(stagingReleaseBuild).not.toContain('fetch(');
    });
});
