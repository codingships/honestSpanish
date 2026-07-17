import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync('scripts/launch/sentry-readonly-evidence.ts', 'utf8');
const triageSource = readFileSync('scripts/launch/sentry-triage-pack.ts', 'utf8');
const packageJson = readFileSync('package.json', 'utf8');
const envExample = readFileSync('.env.example', 'utf8');
const environmentDoc = readFileSync('docs/launch/ENVIRONMENT.md', 'utf8');
const manualRunbook = readFileSync('docs/launch/MANUAL_EVIDENCE_RUNBOOK.md', 'utf8');

describe('Sentry read-only launch evidence', () => {
    it('uses only aggregate read-only Sentry endpoints and redacts sensitive event data', () => {
        for (const snippet of [
            '/api/0/organizations/',
            '/projects/',
            '/issues/',
            'derived_from_dsn',
            'Issue titles are not written',
            'No Sentry auth token',
            'summary.json',
            'summary.md',
            'per_page',
            'raw event payloads',
            'SENTRY_MAX_UNRESOLVED_ISSUES',
            '--max-unresolved-issues',
            'sentry_unresolved_issue_threshold',
            'Selected Sentry environment has unresolved issues above allowed threshold.',
            'summary.sample.length < limit',
            'Returned issue rows below are bounded by --limit',
            'sentry_project_privacy_and_release_readonly',
            'sentry_alert_configuration_readonly',
            '/workflows/',
            '/rules/',
            'project_security_token_persisted=false',
            'notification_target_ids_persisted=false',
        ]) {
            expect(source).toContain(snippet);
        }

        expect(source).not.toContain('/events/');
        expect(source).not.toContain('include-entries');
        expect(source).not.toContain('issue-events');
        expect(source).not.toContain('event-detail');
    });

    it('is wired into launch commands and documents deterministic org/project settings', () => {
        expect(packageJson).toContain('"launch:sentry-readonly": "tsx scripts/launch/sentry-readonly-evidence.ts"');
        expect(packageJson).toContain('"launch:sentry-triage-pack": "tsx scripts/launch/sentry-triage-pack.ts"');
        expect(envExample).toContain('SENTRY_ORG=your_sentry_org_slug');
        expect(envExample).toContain('SENTRY_PROJECT=your_sentry_project_slug');
        expect(envExample).toContain('SENTRY_MAX_UNRESOLVED_ISSUES=0');
        expect(environmentDoc).toContain('SENTRY_ORG');
        expect(environmentDoc).toContain('SENTRY_PROJECT');
        expect(environmentDoc).toContain('SENTRY_MAX_UNRESOLVED_ISSUES');
        expect(environmentDoc).toContain('pnpm launch:sentry-readonly');
        expect(manualRunbook).toContain('pnpm launch:sentry-triage-pack');
    });

    it('prepares only a local triage package from read-only evidence before Sentry dashboard changes', () => {
        for (const snippet of [
            'launch-sentry-triage-pack',
            'READY_FOR_SENTRY_DASHBOARD_TRIAGE',
            'sentry-triage-manifest.json',
            'approval-request.md',
            'triage-checklist.md',
            'alert-ownership-checklist.md',
            'manual-evidence-dry-run-accepted-risk.txt',
            'manual-evidence-dry-run-pass.txt',
            'does not call Sentry',
            'does not resolve, ignore, archive or delete Sentry issues',
            'does not create or change alert rules',
            'does not fetch event details, stack traces or raw payloads',
            'Exact Approval Sentence For Dashboard Triage',
            'accepted risk',
            'rollback',
        ]) {
            expect(triageSource).toContain(snippet);
        }

        expect(triageSource).not.toContain('fetch(');
        expect(triageSource).not.toContain('/events/');
        expect(triageSource).not.toContain('sentryGet');
        expect(triageSource).not.toContain('SENTRY_AUTH_TOKEN');
    });
});
