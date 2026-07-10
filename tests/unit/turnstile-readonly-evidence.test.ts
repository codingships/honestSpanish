import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync('scripts/launch/turnstile-readonly-evidence.ts', 'utf8');
const closureSource = readFileSync('scripts/launch/turnstile-domain-closure-pack.ts', 'utf8');
const packageJson = readFileSync('package.json', 'utf8');
const manualEvidenceDoc = readFileSync('docs/launch/MANUAL_EVIDENCE.md', 'utf8');
const manualRunbook = readFileSync('docs/launch/MANUAL_EVIDENCE_RUNBOOK.md', 'utf8');

describe('Turnstile launch evidence', () => {
    it('keeps runtime read-only evidence scoped to siteverify and optional widget listing', () => {
        for (const snippet of [
            'siteverify_fake_token_rejection',
            'turnstile_widgets_readonly',
            'cloudflare_api_token_readonly',
            'expected_domains',
            'PUBLIC_TURNSTILE_SITE_KEY',
            'TURNSTILE_SECRET_KEY',
            'CLOUDFLARE_ACCOUNT_ID',
            'CLOUDFLARE_API_TOKEN',
            'does not create, update, rotate, delete, deploy, tail logs, change hostnames, retrieve secret values, or write Supabase',
        ]) {
            expect(source).toContain(snippet);
        }

        expect(source).toContain("method: 'GET'");
        expect(source).toContain("method: 'POST'");
        expect(source).not.toContain("method: 'PUT'");
        expect(source).not.toContain("method: 'PATCH'");
        expect(source).not.toContain("method: 'DELETE'");
    });

    it('prepares only a local domain closure package before Cloudflare dashboard changes', () => {
        for (const snippet of [
            'launch-turnstile-domain-closure-pack',
            'READY_FOR_CLOUDFLARE_DASHBOARD_REVIEW',
            'turnstile-domain-closure-manifest.json',
            'approval-request.md',
            'dashboard-evidence-checklist.md',
            'verification-checklist.md',
            'rollback-plan.md',
            'manual-evidence-dry-run.txt',
            'does not call Cloudflare',
            'does not create, update or delete Turnstile widgets',
            'does not change DNS, Workers, Pages, WAF, secrets or domains',
            'Exact Approval Sentence For Dashboard Review',
            'dashboard evidence',
            'rollback',
        ]) {
            expect(closureSource).toContain(snippet);
        }

        expect(closureSource).not.toContain('fetch(');
        expect(closureSource).not.toContain('wrangler');
        expect(closureSource).not.toContain("method: 'PUT'");
        expect(closureSource).not.toContain("method: 'PATCH'");
        expect(closureSource).not.toContain("method: 'DELETE'");
    });

    it('is wired into package commands and manual launch evidence docs', () => {
        expect(packageJson).toContain('"launch:turnstile-readonly": "tsx scripts/launch/turnstile-readonly-evidence.ts"');
        expect(packageJson).toContain('"launch:turnstile-domain-closure-pack": "tsx scripts/launch/turnstile-domain-closure-pack.ts"');
        expect(manualEvidenceDoc).toContain('pnpm launch:turnstile-domain-closure-pack');
        expect(manualEvidenceDoc).toContain('outputs/launch-turnstile-domain-closure-pack/<timestamp>/turnstile-domain-closure-manifest.json');
        expect(manualRunbook).toContain('pnpm launch:turnstile-domain-closure-pack');
        expect(manualRunbook).toContain('outputs/launch-turnstile-domain-closure-pack/<timestamp>/verification-checklist.md');
    });
});
