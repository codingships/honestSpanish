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
        const stagingSnippet = '"deploy": "wrangler deploy --env staging"';
        const productionSnippet = '"deploy:production": "wrangler deploy --env production"';

        expect(audit.split(stagingSnippet)).toHaveLength(3);
        expect(audit.split(productionSnippet)).toHaveLength(3);
        expect(audit).not.toContain('"deploy": "wrangler deploy"');
    });

    it('preserves the fulfillment runtime evidence required by final readiness', () => {
        const checklist = read('docs/launch/CHECKLIST.md');

        expect(checklist).toContain(
            'Cloudflare Fulfillment Worker con `FULFILLMENT_WORKER_URL`, `PUBLIC_SITE_URL`, `INTERNAL_JOB_SECRET` y `CRON_SECRET`',
        );
        expect(checklist).toContain('espanolhonesto-staging` ejecuta `64679ce4-5dab-4f8b-b4a8-cf24931caaf9');
        expect(checklist).toContain('espanol-honesto-fulfillment-staging` ejecuta `9be2ea8f-427d-4834-b7fb-311c5d1e4c50');
    });
});
