import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (file: string) => readFileSync(file, 'utf8');

describe('launch audit regression guards', () => {
    it('keeps opaque runtime attestation inside the explicit server-only service-role boundary', () => {
        const audit = read('scripts/launch/security-audit.ts');

        expect(audit).toContain("path.join('src', 'lib', 'runtime-attestation.ts')");
        expect(audit).toContain("path.join('src', 'pages', 'api', 'internal', 'runtime-attestation.ts')");
        expect(audit).toContain("filesUnder(path.join('src', 'components'))");
        expect(audit).toContain('imports runtime-env from the component/client boundary');
    });

    it('requires environment-explicit fulfillment deploy commands in both operations checks', () => {
        const audit = read('scripts/launch/operations-audit.ts');
        const workflow = read('.github/workflows/ci.yml');
        const stagingSnippet = '"deploy": "wrangler deploy --env staging"';
        const productionSnippet = '"deploy:production": "wrangler deploy --env production --dry-run"';

        expect(audit.split(stagingSnippet)).toHaveLength(3);
        expect(audit.split(productionSnippet)).toHaveLength(3);
        expect(audit).not.toContain('"deploy": "wrangler deploy"');
        expect(workflow.indexOf('name: Deploy staging Cloudflare Fulfillment Worker')).toBeLessThan(
            workflow.indexOf('name: Deploy staging Cloudflare Worker'),
        );
    });

    it('preserves the fulfillment runtime evidence required by final readiness', () => {
        const checklist = read('docs/launch/CHECKLIST.md');
        const wrangler = read('wrangler.toml');

        expect(checklist).toContain(
            'Cloudflare Fulfillment Worker con service binding privado `FULFILLMENT_SERVICE`, `FULFILLMENT_WORKER_URL`, `PUBLIC_SITE_URL`, `INTERNAL_JOB_SECRET` y `CRON_SECRET`',
        );
        expect(checklist).toMatch(/`espanolhonesto-staging` ejecuta `[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}`/);
        expect(checklist).toMatch(/`espanol-honesto-fulfillment-staging` ejecuta `[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}`/);
        expect(wrangler).toContain('[[env.staging.services]]');
        expect(wrangler).toContain('service = "espanol-honesto-fulfillment-staging"');
        expect(wrangler).toContain('[[env.production.services]]');
        expect(wrangler).toContain('service = "espanol-honesto-fulfillment-production"');
        expect(wrangler).not.toContain('global_fetch_strictly_public');
    });
});
