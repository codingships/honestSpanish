import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

type CheckStatus = 'ok' | 'warning' | 'failed';
type QueueStatus = 'OK' | 'WARNING' | 'FAILED';
type QueueItemStatus = 'requires_exact_approval' | 'human_input_required' | 'reference_only' | 'must_wait' | 'missing_artifacts';

interface Check {
    status: CheckStatus;
    name: string;
    message: string;
    details: string[];
}

interface QueueItem {
    id: string;
    title: string;
    kind: 'external_write_approval' | 'human_final_input' | 'read_only_reference';
    target: string;
    status: QueueItemStatus;
    approvalPath: string | null;
    supportPaths: string[];
    rollbackPath: string | null;
    allowedScope: string;
    forbiddenScope: string[];
    finalBlockers: string[];
    waitReason?: string;
    prerequisiteItemIds?: string[];
}

interface CriticalPathStep {
    id: string;
    title: string;
    phase: string;
    itemIds: string[];
    prerequisites: string[];
    blocks: string[];
    closeWhen: string;
    stopIf: string[];
}

interface QueueReport {
    schemaVersion: 1;
    startedAt: string;
    endedAt: string;
    status: QueueStatus;
    approvalQueueStatus: 'ARTIFACTS_COMPLETE' | 'ARTIFACTS_COMPLETE_WITH_MUST_WAIT' | 'MISSING_ARTIFACTS';
    outputDir: string;
    checks: Check[];
    items: QueueItem[];
    criticalPath: CriticalPathStep[];
    queuePath: string;
    manifestPath: string;
    nextActionPath: string;
    executionBoardPath: string;
    summaryPath: string;
}

const startedAt = new Date();
const outputDir = path.join(process.cwd(), 'outputs', 'launch-final-approval-queue', stamp(startedAt));
mkdirSync(outputDir, { recursive: true });

const items = buildQueueItems();
const criticalPath = buildCriticalPath(items);
const checks: Check[] = [
    validateQueueArtifacts(items),
    validateGeneratedScope(items),
    validateCriticalPath(items, criticalPath),
];
let report = createReport(checks);
let rendered = renderAll(report);
checks.push(validateGeneratedArtifactPosture(rendered));
report = createReport(checks);
rendered = renderAll(report);

writeFileSync(report.queuePath, rendered.queueMarkdown, 'utf8');
writeFileSync(report.manifestPath, rendered.manifest, 'utf8');
writeFileSync(report.nextActionPath, rendered.nextActionCursor, 'utf8');
writeFileSync(report.executionBoardPath, rendered.executionBoard, 'utf8');
writeFileSync(report.summaryPath, rendered.summary, 'utf8');
writeFileSync(path.join(outputDir, 'summary.json'), JSON.stringify(report, null, 2), 'utf8');

const failed = report.checks.filter((check) => check.status === 'failed');
const warnings = report.checks.filter((check) => check.status === 'warning');

console.log(`[launch:final-approval-queue] Status: ${report.status}`);
console.log(`[launch:final-approval-queue] Approval queue: ${report.approvalQueueStatus}`);
console.log(`[launch:final-approval-queue] Failed: ${failed.length}`);
console.log(`[launch:final-approval-queue] Warnings: ${warnings.length}`);
console.log(`[launch:final-approval-queue] Summary: ${report.summaryPath}`);
console.log(`[launch:final-approval-queue] Queue: ${report.queuePath}`);
console.log(`[launch:final-approval-queue] Manifest: ${report.manifestPath}`);
console.log(`[launch:final-approval-queue] Next action: ${report.nextActionPath}`);
console.log(`[launch:final-approval-queue] Execution board: ${report.executionBoardPath}`);

if (failed.length > 0) process.exit(1);

function buildQueueItems(): QueueItem[] {
    return [
        {
            id: 'supabase_processed_at_cleanup',
            title: 'Supabase processed_at DROP DEFAULT',
            kind: 'external_write_approval',
            target: 'Supabase staging mzjyvmlxfpzdfdjzxxyj first, then production vkkahxsybhbutszerawz only if staging passes',
            approvalPath: latestGeneratedPath('launch-supabase-processed-at-cleanup', 'approval-request.md'),
            supportPaths: existingOrExpected([
                latestGeneratedPath('launch-supabase-processed-at-cleanup', 'supabase-processed-at-cleanup-manifest.json'),
                latestGeneratedPath('launch-supabase-processed-at-cleanup', 'preflight.sql'),
                latestGeneratedPath('launch-supabase-processed-at-cleanup', 'post-apply-verification.sql'),
                latestGeneratedPath('launch-supabase-processed-at-cleanup', 'accepted-risk-package.md'),
                latestGeneratedPath('launch-supabase-processed-at-cleanup', 'strict-qa-accepted-risk-dry-run.txt'),
                latestGeneratedPath('supabase-processed-at-readonly-preflight', 'summary.md'),
                latestGeneratedPath('launch-supabase-processed-at-cleanup-runner', 'summary.md'),
                latestGeneratedPath('launch-supabase-processed-at-cleanup-runner', 'processed-at-cleanup-command-manifest.json'),
                latestGeneratedPath('launch-supabase-processed-at-cleanup-runner', 'processed-at-cleanup-execution-plan.md'),
                latestGeneratedPath('launch-supabase-processed-at-cleanup-runner', 'approval-gate.md'),
                'supabase/migrations/20260703211451_drop_processed_webhook_processed_at_default.sql',
            ]),
            rollbackPath: latestGeneratedPath('launch-supabase-processed-at-cleanup-runner', 'rollback-after-cleanup.md') ?? latestGeneratedPath('launch-supabase-processed-at-cleanup', 'rollback.sql'),
            allowedScope: 'Apply only migration 20260703211451_drop_processed_webhook_processed_at_default through the gated runner staging-first, verify read-only, then production-second if staging passes.',
            forbiddenScope: [
                'No db push broad sync',
                'No row/user/Auth/Storage/API-setting changes',
                'No service key or database URL evidence',
                'No Cloudflare, Stripe, Google, Resend, Sentry or DNS writes',
            ],
            finalBlockers: ['ERR-QA-SUPABASE-PROCESSED-AT-DEFAULT-149', 'integration_readiness', 'final_smoke'],
            status: 'missing_artifacts',
        },
        {
            id: 'cloudflare_worker_create',
            title: 'Cloudflare production Worker phase 1',
            kind: 'external_write_approval',
            target: 'Cloudflare account d1a22bcf6477ff2ff31d2bfb83084e44, Worker espanolhonesto',
            approvalPath: latestGeneratedPath('launch-cloudflare-production-runtime-cutover', 'approval-request-phase-1-worker.md'),
            supportPaths: existingOrExpected([
                latestGeneratedPath('launch-cloudflare-production-runtime-readonly', 'summary.md'),
                latestGeneratedPath('launch-cloudflare-production-runtime-cutover-preflight', 'summary.md'),
                latestGeneratedPath('launch-cloudflare-production-runtime-cutover-preflight', 'cloudflare-production-worker-variable-matrix.md'),
                latestGeneratedPath('launch-cloudflare-production-runtime-cutover', 'cloudflare-production-runtime-cutover-manifest.json'),
                latestGeneratedPath('launch-cloudflare-production-runtime-cutover', 'verification-checklist.md'),
                latestGeneratedPath('launch-cloudflare-production-worker-phase1', 'summary.md'),
                latestGeneratedPath('launch-cloudflare-production-worker-phase1', 'phase1-command-manifest.json'),
                latestGeneratedPath('launch-cloudflare-production-worker-phase1', 'phase1-execution-plan.md'),
                latestGeneratedPath('launch-cloudflare-production-worker-phase1', 'approval-gate.md'),
            ]),
            rollbackPath: latestGeneratedPath('launch-cloudflare-production-worker-phase1', 'rollback-after-phase1.md') ?? latestGeneratedPath('launch-cloudflare-production-runtime-cutover', 'rollback-plan.md'),
            allowedScope: 'Create/deploy the production Worker only through the gated phase-1 runner with CHECKOUT_ENABLED=false; no domain move.',
            forbiddenScope: [
                'No espanolhonesto.com/www domain move',
                'No DNS/route deletion',
                'No CHECKOUT_ENABLED=true',
                'No secret values in evidence',
            ],
            finalBlockers: ['integration_readiness', 'seo_llm_final', 'final_smoke'],
            status: 'missing_artifacts',
        },
        {
            id: 'cloudflare_worker_secrets',
            title: 'Cloudflare production Worker secret-name phase',
            kind: 'external_write_approval',
            target: 'Cloudflare Worker espanolhonesto production secret names',
            approvalPath: latestGeneratedPath('launch-cloudflare-production-runtime-cutover', 'approval-request-worker-secrets.md'),
            supportPaths: existingOrExpected([
                latestGeneratedPath('launch-cloudflare-production-runtime-readonly', 'summary.md'),
                latestGeneratedPath('launch-cloudflare-production-runtime-cutover-preflight', 'summary.md'),
                latestGeneratedPath('launch-cloudflare-production-runtime-cutover-preflight', 'cloudflare-production-worker-variable-matrix.md'),
                latestGeneratedPath('launch-cloudflare-production-runtime-cutover', 'cloudflare-production-runtime-cutover-manifest.json'),
                latestGeneratedPath('launch-cloudflare-production-runtime-cutover', 'verification-checklist.md'),
                latestGeneratedPath('launch-cloudflare-production-worker-secrets', 'summary.md'),
                latestGeneratedPath('launch-cloudflare-production-worker-secrets', 'cloudflare-worker-secrets-command-manifest.json'),
                latestGeneratedPath('launch-cloudflare-production-worker-secrets', 'cloudflare-worker-secrets-execution-plan.md'),
                latestGeneratedPath('launch-cloudflare-production-worker-secrets', 'approval-gate.md'),
            ]),
            rollbackPath: latestGeneratedPath('launch-cloudflare-production-worker-secrets', 'rollback-after-worker-secrets.md') ?? latestGeneratedPath('launch-cloudflare-production-runtime-cutover', 'rollback-plan.md'),
            allowedScope: 'Load and verify only required production Worker secret names after the Worker exists; store values only in Cloudflare.',
            forbiddenScope: [
                'No secret value output',
                'No Google service-account values on Pages runtime if boundary says fulfillment Worker only',
                'No domain move',
                'No checkout enablement or payment session',
            ],
            finalBlockers: ['integration_readiness', 'final_smoke'],
            waitReason: 'Blocked by Cloudflare production Worker phase 1: Worker espanolhonesto must exist before production secret-name loading and verification.',
            prerequisiteItemIds: ['cloudflare_worker_create'],
            status: 'missing_artifacts',
        },
        {
            id: 'cloudflare_fulfillment_secrets',
            title: 'Cloudflare production Fulfillment Worker config/secrets/email phase',
            kind: 'external_write_approval',
            target: 'Cloudflare Worker espanol-honesto-fulfillment-production',
            approvalPath: latestGeneratedPath('launch-cloudflare-production-runtime-cutover', 'approval-request-fulfillment-worker-secrets.md'),
            supportPaths: existingOrExpected([
                latestGeneratedPath('launch-cloudflare-production-runtime-cutover', 'cloudflare-production-runtime-cutover-manifest.json'),
                latestGeneratedPath('launch-cloudflare-production-runtime-cutover', 'verification-checklist.md'),
                latestGeneratedPath('launch-cloudflare-production-fulfillment-secrets', 'summary.md'),
                latestGeneratedPath('launch-cloudflare-production-fulfillment-secrets', 'command-manifest.json'),
                latestGeneratedPath('launch-cloudflare-production-fulfillment-secrets', 'execution-plan.md'),
                latestGeneratedPath('launch-cloudflare-production-fulfillment-secrets', 'approval-gate.md'),
            ]),
            rollbackPath: latestGeneratedPath('launch-cloudflare-production-runtime-cutover', 'rollback-plan.md'),
            allowedScope: 'Verify the explicit production config and load only allowlisted Supabase/Google/Resend/email secret names, then attest the direct Worker identity/version/Supabase ref without sending email or processing jobs.',
            forbiddenScope: [
                'No web Worker secret write',
                'No email send, Google mutation, job processing or Supabase write',
                'No domain/DNS/Pages change',
                'No secret value output',
            ],
            finalBlockers: ['integration_readiness', 'final_smoke'],
            waitReason: 'Fulfillment Worker production must exist from the approved production deployment before its separately gated config/secret/attestation phase.',
            status: 'missing_artifacts',
        },
        {
            id: 'cloudflare_domain_move',
            title: 'Cloudflare production domain move',
            kind: 'external_write_approval',
            target: 'espanolhonesto.com and www.espanolhonesto.com',
            approvalPath: latestGeneratedPath('launch-cloudflare-production-runtime-cutover', 'approval-request-domain-move.md'),
            supportPaths: existingOrExpected([
                latestGeneratedPath('launch-cloudflare-production-runtime-readonly', 'summary.md'),
                latestGeneratedPath('launch-cloudflare-production-runtime-cutover-preflight', 'summary.md'),
                latestGeneratedPath('launch-cloudflare-production-runtime-cutover-preflight', 'cloudflare-production-worker-variable-matrix.md'),
                latestGeneratedPath('launch-cloudflare-production-runtime-cutover', 'cloudflare-production-runtime-cutover-manifest.json'),
                latestGeneratedPath('launch-cloudflare-production-runtime-cutover', 'verification-checklist.md'),
                latestGeneratedPath('launch-live-domain-readonly-evidence', 'summary.md'),
            ]),
            rollbackPath: latestGeneratedPath('launch-cloudflare-production-runtime-cutover', 'rollback-plan.md'),
            allowedScope: 'Move custom domains only after direct Worker verification, secret-name verification and final approval.',
            forbiddenScope: [
                'No domain move during Worker-create phase',
                'No Pages deletion unless separately approved',
                'No DNS/zone changes outside the generated domain-move scope',
            ],
            finalBlockers: ['integration_readiness', 'seo_llm_final', 'final_smoke'],
            waitReason: 'Blocked by Worker shell, production secret-name verification and direct Worker URL probes; domain approval alone is not sufficient.',
            prerequisiteItemIds: ['cloudflare_worker_create', 'cloudflare_worker_secrets', 'cloudflare_fulfillment_secrets'],
            status: 'missing_artifacts',
        },
        {
            id: 'stripe_webhook_test_cutover',
            title: 'Stripe test-mode webhook host cutover',
            kind: 'external_write_approval',
            target: 'Stripe test-mode enabled webhook endpoint currently on old host',
            approvalPath: latestGeneratedPath('launch-stripe-webhook-cutover-pack', 'approval-request.md'),
            supportPaths: existingOrExpected([
                latestGeneratedPath('launch-stripe-webhook-cutover-pack', 'verification-checklist.md'),
                latestGeneratedPath('launch-stripe-webhook-cutover-runner', 'summary.md'),
                latestGeneratedPath('launch-stripe-webhook-cutover-runner', 'stripe-webhook-cutover-command-manifest.json'),
                latestGeneratedPath('launch-stripe-webhook-cutover-runner', 'stripe-webhook-cutover-execution-plan.md'),
                latestGeneratedPath('launch-stripe-webhook-cutover-runner', 'approval-gate.md'),
                latestGeneratedPath('launch-stripe-readonly-evidence', 'summary.md'),
            ]),
            rollbackPath: latestGeneratedPath('launch-stripe-webhook-cutover-runner', 'rollback-after-webhook-cutover.md')
                ?? latestGeneratedPath('launch-stripe-webhook-cutover-pack', 'rollback-plan.md'),
            allowedScope: 'Change only the enabled test-mode webhook endpoint URL to the selected launch host while preserving the generated event scope.',
            forbiddenScope: [
                'No Stripe live mode',
                'No product/price/customer/subscription changes',
                'No CHECKOUT_ENABLED change',
                'No Supabase/Cloudflare/Google/Resend/Sentry writes',
            ],
            finalBlockers: ['integration_readiness', 'final_smoke'],
            status: 'missing_artifacts',
        },
        {
            id: 'turnstile_domain_closure',
            title: 'Turnstile widget/domain closure',
            kind: 'external_write_approval',
            target: 'Cloudflare Turnstile widget for espanolhonesto.com, www and staging',
            approvalPath: latestGeneratedPath('launch-turnstile-domain-closure-pack', 'approval-request.md'),
            supportPaths: existingOrExpected([
                latestGeneratedPath('launch-turnstile-domain-closure-pack', 'dashboard-evidence-checklist.md'),
                latestGeneratedPath('launch-turnstile-domain-closure-pack', 'verification-checklist.md'),
                latestGeneratedPath('launch-turnstile-domain-closure-runner', 'summary.md'),
                latestGeneratedPath('launch-turnstile-domain-closure-runner', 'turnstile-domain-closure-command-manifest.json'),
                latestGeneratedPath('launch-turnstile-domain-closure-runner', 'turnstile-domain-closure-execution-plan.md'),
                latestGeneratedPath('launch-turnstile-domain-closure-runner', 'approval-gate.md'),
                latestGeneratedPath('launch-turnstile-readonly-evidence', 'summary.md'),
            ]),
            rollbackPath: latestGeneratedPath('launch-turnstile-domain-closure-runner', 'rollback-after-turnstile-domain-closure.md')
                ?? latestGeneratedPath('launch-turnstile-domain-closure-pack', 'rollback-plan.md'),
            allowedScope: 'Review or update only the Turnstile widget/domain allowlist needed for launch, with dashboard/API evidence recorded without secrets.',
            forbiddenScope: [
                'No DNS/domain move',
                'No Worker/Page deploy',
                'No key rotation unless separately approved',
                'No Stripe/Supabase/Google/Resend/Sentry writes',
            ],
            finalBlockers: ['integration_readiness', 'final_smoke'],
            status: 'missing_artifacts',
        },
        {
            id: 'sentry_issue_triage',
            title: 'Sentry unresolved issue triage',
            kind: 'external_write_approval',
            target: 'Sentry honestspanish/espanol-honesto-astro production issues',
            approvalPath: latestGeneratedPath('launch-sentry-triage-pack', 'approval-request.md'),
            supportPaths: existingOrExpected([
                latestGeneratedPath('launch-sentry-triage-pack', 'triage-checklist.md'),
                latestGeneratedPath('launch-sentry-triage-pack', 'alert-ownership-checklist.md'),
                latestGeneratedPath('launch-sentry-issue-triage-runner', 'summary.md'),
                latestGeneratedPath('launch-sentry-issue-triage-runner', 'sentry-issue-triage-command-manifest.json'),
                latestGeneratedPath('launch-sentry-issue-triage-runner', 'sentry-issue-triage-execution-plan.md'),
                latestGeneratedPath('launch-sentry-issue-triage-runner', 'approval-gate.md'),
                latestGeneratedPath('launch-sentry-readonly-evidence', 'summary.md'),
            ]),
            rollbackPath: latestGeneratedPath('launch-sentry-issue-triage-runner', 'rollback-after-sentry-issue-triage.md'),
            allowedScope: 'Triage only the listed Sentry short IDs or record explicit accepted risk with owner, monitor and rollback.',
            forbiddenScope: [
                'No alert-rule/project/DSN/token/sourcemap/release changes',
                'No event payload, stack trace, title or private user data in evidence',
                'No other provider writes',
            ],
            finalBlockers: ['integration_readiness', 'final_smoke'],
            status: 'missing_artifacts',
        },
        {
            id: 'staging_write_capable_smoke_rehearsal',
            title: 'Staging write-capable lifecycle smoke rehearsal',
            kind: 'external_write_approval',
            target: 'Staging SMOKE_BASE_URL=https://espanolhonesto-staging.alindev95.workers.dev only, guarded by SMOKE_EXTERNAL_WRITES_CONFIRMATION=writes-ok:espanolhonesto-staging.alindev95.workers.dev',
            approvalPath: latestGeneratedPath('launch-final-smoke-execution-pack', 'approval-request-staging-smoke.md'),
            supportPaths: existingOrExpected([
                latestGeneratedPath('launch-final-smoke-execution-pack', 'final-smoke-execution-manifest.json'),
                latestGeneratedPath('launch-final-smoke-execution-pack', 'staging-preflight-checklist.md'),
                latestGeneratedPath('launch-final-smoke-execution-pack', 'rollback-and-cleanup-plan.md'),
                latestGeneratedPath('launch-final-smoke-execution-pack', 'summary.md'),
                latestGeneratedPath('launch-staging-smoke-rehearsal-runner', 'summary.md'),
                latestGeneratedPath('launch-staging-smoke-rehearsal-runner', 'staging-smoke-command-manifest.json'),
                latestGeneratedPath('launch-staging-smoke-rehearsal-runner', 'staging-smoke-execution-plan.md'),
                latestGeneratedPath('launch-staging-smoke-rehearsal-runner', 'approval-gate.md'),
                latestGeneratedPath('launch-staging-billing-lifecycle', 'summary.json')
                    ?? path.join('outputs', 'launch-staging-billing-lifecycle', '<timestamp>', 'summary.json'),
            ]),
            rollbackPath: latestGeneratedPath('launch-staging-smoke-rehearsal-runner', 'rollback-after-staging-smoke.md') ?? latestGeneratedPath('launch-final-smoke-execution-pack', 'rollback-and-cleanup-plan.md'),
            allowedScope: 'After the separately gated canonical Stripe test lifecycle reports OK/complete and every read-only harness precondition revalidates it live, run staging rehearsal with exactly the three existing allowlisted role accounts; this creates zero Auth users, performs bounded cleanup and does not close final_smoke.',
            forbiddenScope: [
                'No production smoke or live-domain launch sign-off',
                'No secret/private payload evidence',
                'No Cloudflare write or checkout-gate change; CHECKOUT_ENABLED_OVERRIDE remains false throughout',
                'No Stripe live mode or real charge',
            ],
            finalBlockers: ['integration_readiness'],
            prerequisiteItemIds: [],
            status: 'missing_artifacts',
        },
        {
            id: 'final_write_capable_smoke',
            title: 'Production minimal manual smoke',
            kind: 'external_write_approval',
            target: 'Production final domain, minimal manual checklist only; the staging lifecycle harness is forbidden',
            approvalPath: latestGeneratedPath('launch-final-smoke-execution-pack', 'approval-request-final-smoke.md'),
            supportPaths: existingOrExpected([
                latestGeneratedPath('launch-final-smoke-execution-pack', 'final-smoke-execution-manifest.json'),
                latestGeneratedPath('launch-final-smoke-execution-pack', 'preflight-checklist.md'),
                latestGeneratedPath('launch-final-smoke-execution-pack', 'production-minimal-smoke-checklist.md'),
                latestGeneratedPath('launch-final-smoke-execution-pack', 'rollback-and-cleanup-plan.md'),
                latestGeneratedPath('launch-final-smoke-execution-pack', 'summary.md'),
            ]),
            rollbackPath: latestGeneratedPath('launch-final-smoke-execution-pack', 'rollback-and-cleanup-plan.md'),
            allowedScope: 'Run the minimal manual production checklist only after runtime/domain/payment/legal/provider posture is final; one owned live purchase at most requires its separate Stripe payment approval.',
            forbiddenScope: [
                'No execution of scripts/smoke/real-env-smoke.ts against production',
                'No secret/private payload evidence',
                'No broad provider writes outside the smoke manifest',
            ],
            finalBlockers: ['final_smoke'],
            waitReason: 'Blocked by runtime/domain/provider/legal/SEO prerequisites and the exact writes-ok host approval; do not run against production early.',
            prerequisiteItemIds: [
                'legal_final_inputs',
                'supabase_processed_at_cleanup',
                'cloudflare_domain_move',
                'stripe_webhook_test_cutover',
                'turnstile_domain_closure',
                'sentry_issue_triage',
                'seo_llm_live_domain_review',
            ],
            status: 'missing_artifacts',
        },
        {
            id: 'legal_final_inputs',
            title: 'Legal final values and human review',
            kind: 'human_final_input',
            target: 'Public legal pages and docs/launch/MANUAL_EVIDENCE.local.json',
            approvalPath: latestGeneratedPath('launch-legal-final-inputs', 'legal-final-inputs-package.md'),
            supportPaths: existingOrExpected([
                latestGeneratedPath('launch-legal-final-inputs', 'legal-final-inputs-manifest.json'),
                latestGeneratedPath('launch-legal', 'legal-closure-worksheet.md'),
                'docs/launch/LEGAL_INPUTS_REQUIRED.md',
            ]),
            rollbackPath: null,
            allowedScope: 'Fill real owner/controller/subprocessor/cookie values and record human legal review with non-secret evidence.',
            forbiddenScope: [
                'No invented legal values',
                'No identity documents or private advisor notes in repo evidence',
                'No accepted risk for missing owner/controller values',
            ],
            finalBlockers: ['legal_owner_controller', 'legal_human_review'],
            status: 'missing_artifacts',
        },
        {
            id: 'seo_llm_live_domain_review',
            title: 'SEO/LLM live-domain and Russian typography review',
            kind: 'read_only_reference',
            target: 'espanolhonesto.com, www.espanolhonesto.com and /ru rendering',
            approvalPath: latestGeneratedPath('launch-seo-llm-final-package', 'seo-llm-final-package.md'),
            supportPaths: existingOrExpected([
                latestGeneratedPath('launch-seo-llm-final-package', 'seo-llm-final-manifest.json'),
                latestGeneratedPath('launch-seo-llm-final-package', 'domain-parity-gap.md'),
                latestGeneratedPath('launch-live-domain-readonly-evidence', 'summary.md'),
                latestGeneratedPath('launch-seo', 'seo-llm-final-worksheet.md'),
                'docs/launch/SEO_LLM_FINAL.md',
            ]),
            rollbackPath: null,
            allowedScope: 'Review final live-domain parity, Search Console/CWV notes, llms.txt, sitemap/robots and Russian typography decision after final domain/copy/legal settle.',
            forbiddenScope: [
                'No Search Console token or analytics export in repo evidence',
                'No unlicensed font files or invoices in repo',
                'No DNS/domain writes outside Cloudflare domain-move approval',
            ],
            finalBlockers: ['seo_llm_final'],
            status: 'missing_artifacts',
        },
    ].map((item) => ({
        ...item,
        status: queueItemStatus(item),
    }));
}

function createReport(reportChecks: Check[]): QueueReport {
    const hasMissing = items.some((item) => item.status === 'missing_artifacts');
    const hasMustWait = items.some((item) => item.status === 'must_wait');
    const hasFailedCheck = reportChecks.some((check) => check.status === 'failed');
    const status: QueueStatus = hasFailedCheck ? 'FAILED' : 'WARNING';

    return {
        schemaVersion: 1,
        startedAt: startedAt.toISOString(),
        endedAt: new Date().toISOString(),
        status,
        approvalQueueStatus: hasMissing ? 'MISSING_ARTIFACTS' : hasMustWait ? 'ARTIFACTS_COMPLETE_WITH_MUST_WAIT' : 'ARTIFACTS_COMPLETE',
        outputDir,
        checks: reportChecks,
        items,
        criticalPath,
        queuePath: path.join(outputDir, 'final-approval-queue.md'),
        manifestPath: path.join(outputDir, 'final-approval-queue-manifest.json'),
        nextActionPath: path.join(outputDir, 'final-approval-next-action.md'),
        executionBoardPath: path.join(outputDir, 'final-window-execution-board.md'),
        summaryPath: path.join(outputDir, 'summary.md'),
    };
}

function validateQueueArtifacts(queueItems: QueueItem[]): Check {
    const missing = queueItems.flatMap((item) => {
        const required = [
            item.approvalPath,
            ...item.supportPaths,
            item.rollbackPath,
        ].filter((candidate): candidate is string => Boolean(candidate));
        if (!item.approvalPath && item.kind === 'external_write_approval') {
            return [`${item.id}:approvalPath`];
        }
        return required.filter((file) => !existsSync(file)).map((file) => `${item.id}:${toPosix(path.relative(process.cwd(), file))}`);
    });

    return {
        status: missing.length === 0 ? 'ok' : 'failed',
        name: 'queue_artifacts_exist',
        message: missing.length === 0
            ? 'Every concrete approval queue source artifact exists.'
            : 'One or more concrete approval queue source artifacts are missing.',
        details: missing.length === 0 ? [`items=${queueItems.length}`] : missing,
    };
}

function validateGeneratedScope(queueItems: QueueItem[]): Check {
    const hasExternal = queueItems.some((item) => item.kind === 'external_write_approval');
    const missingForbidden = queueItems.filter((item) => item.forbiddenScope.length === 0).map((item) => item.id);

    return {
        status: hasExternal && missingForbidden.length === 0 ? 'warning' : 'failed',
        name: 'approval_boundary_posture',
        message: hasExternal && missingForbidden.length === 0
            ? 'The queue contains external-write approval items and explicit forbidden scopes; it is warning by design until final approvals are reviewed.'
            : 'The queue is missing approval boundaries.',
        details: [
            `external_write_items=${queueItems.filter((item) => item.kind === 'external_write_approval').length}`,
            `missing_forbidden_scope=${missingForbidden.join('|') || 'none'}`,
            'this_file_is_not_permission',
        ],
    };
}

function validateCriticalPath(queueItems: QueueItem[], steps: CriticalPathStep[]): Check {
    const knownIds = new Set(queueItems.map((item) => item.id));
    const referencedIds = steps.flatMap((step) => step.itemIds);
    const unknown = referencedIds.filter((id) => !knownIds.has(id));
    const unknownPrerequisites = queueItems
        .flatMap((item) => item.prerequisiteItemIds ?? [])
        .filter((id) => !knownIds.has(id));
    const missingItemCoverage = queueItems
        .filter((item) => item.kind === 'external_write_approval')
        .filter((item) => !referencedIds.includes(item.id))
        .map((item) => item.id);
    const missingStopRules = steps.filter((step) => step.stopIf.length === 0).map((step) => step.id);

    return {
        status: unknown.length === 0 && unknownPrerequisites.length === 0 && missingItemCoverage.length === 0 && missingStopRules.length === 0 ? 'ok' : 'failed',
        name: 'critical_path_dependency_coverage',
        message: unknown.length === 0 && unknownPrerequisites.length === 0 && missingItemCoverage.length === 0 && missingStopRules.length === 0
            ? 'Critical path covers every external-write approval item and includes stop rules.'
            : 'Critical path is missing approval coverage or stop rules.',
        details: [
            `steps=${steps.length}`,
            `unknown_item_ids=${unknown.join('|') || 'none'}`,
            `unknown_prerequisite_ids=${unknownPrerequisites.join('|') || 'none'}`,
            `external_items_not_in_path=${missingItemCoverage.join('|') || 'none'}`,
            `steps_without_stop_rules=${missingStopRules.join('|') || 'none'}`,
        ],
    };
}

function validateGeneratedArtifactPosture(rendered: Rendered): Check {
    const combined = `${rendered.queueMarkdown}\n${rendered.manifest}\n${rendered.nextActionCursor}\n${rendered.executionBoard}\n${rendered.summary}`;
    const required = [
        'This queue is not approval.',
        'No secret values are stored here.',
        'No external services are called or changed by this command.',
        'Use the linked approval request for the exact scope.',
        'Items marked `must_wait` are blocked by prerequisites even when all local artifacts exist.',
        'Items marked `requires_exact_approval` still need explicit resource/action approval before any write.',
        'Items marked `human_input_required` need human-owned final values or review.',
    ];
    const missing = required.filter((snippet) => !combined.includes(snippet));
    const secretLike = /(sk_live_|sk_test_|whsec_[A-Za-z0-9]{12,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|postgres(?:ql)?:\/\/[^@\s]+:[^@\s]+@)/.test(combined);

    return {
        status: missing.length === 0 && !secretLike ? 'ok' : 'failed',
        name: 'generated_artifact_secret_and_scope_posture',
        message: missing.length === 0 && !secretLike
            ? 'Generated approval queue artifacts contain scope gates and no obvious secret values.'
            : 'Generated approval queue artifacts are missing safety text or appear to include secret-like values.',
        details: [
            ...missing.map((snippet) => `missing=${snippet}`),
            `secret_like=${secretLike}`,
        ],
    };
}

function buildCriticalPath(queueItems: QueueItem[]): CriticalPathStep[] {
    const requireItem = (id: string) => {
        if (!queueItems.some((item) => item.id === id)) {
            throw new Error(`Critical path references unknown queue item: ${id}`);
        }
        return id;
    };

    return [
        {
            id: 'final_inputs_freeze',
            title: 'Freeze final inputs and legal values',
            phase: 'T-48h to T-24h',
            itemIds: [requireItem('legal_final_inputs')],
            prerequisites: [
                'Final public copy, package posture and launch mode are stable',
                'Real owner/controller values are available from Alin',
            ],
            blocks: ['ERR-LEGAL-001', 'legal_owner_controller', 'legal_human_review', 'launch:legal', 'launch:verify'],
            closeWhen: 'Real legal values are applied, human legal review is recorded and launch:legal passes.',
            stopIf: [
                'Owner/controller values are still placeholders',
                'The reviewer scope/date cannot be recorded without private notes',
            ],
        },
        {
            id: 'supabase_p3_decision',
            title: 'Resolve Supabase processed_at drift',
            phase: 'Before integration smoke',
            itemIds: [requireItem('supabase_processed_at_cleanup')],
            prerequisites: [
                'Generated cleanup package and read-only preflight are reviewed',
                'Exact staging-first approval exists or Alin accepts the P3 drift as risk',
            ],
            blocks: ['ERR-QA-SUPABASE-PROCESSED-AT-DEFAULT-149', 'integration_readiness', 'final_smoke'],
            closeWhen: 'Migration 20260703211451 is applied/verified staging-first then production, or the exact drift is accepted as launch risk.',
            stopIf: [
                'Supabase CLI/db push proposes any migration outside 20260703211451',
                'Read-only verification shows webhook processing state is not clean',
            ],
        },
        {
            id: 'cloudflare_worker_shell',
            title: 'Create production Worker without domains',
            phase: 'Cloudflare phase 1',
            itemIds: [requireItem('cloudflare_worker_create')],
            prerequisites: [
                'Phase-1 Cloudflare approval sentence is exact',
                'Wrangler dry-run shows CHECKOUT_ENABLED=false and no custom-domain attachment',
            ],
            blocks: ['integration_readiness', 'seo_llm_final', 'final_smoke'],
            closeWhen: 'Worker espanolhonesto exists in the named account, checkout remains disabled and secret names can be listed without values.',
            stopIf: [
                'Wrangler tries to attach espanolhonesto.com or www.espanolhonesto.com',
                'The target account or Worker name differs from the approval request',
            ],
        },
        {
            id: 'cloudflare_secrets_and_direct_probe',
            title: 'Load web/fulfillment secrets and attest direct Worker URLs',
            phase: 'Cloudflare phases 2-4',
            itemIds: [requireItem('cloudflare_worker_secrets'), requireItem('cloudflare_fulfillment_secrets')],
            prerequisites: [
                'Production Worker exists from phase 1',
                'Secure source for values is available outside repo evidence',
            ],
            blocks: ['integration_readiness', 'final_smoke'],
            closeWhen: 'Required web and fulfillment names are present and both direct workers.dev attestations prove exact identity, version and production Supabase ref.',
            stopIf: [
                'A secret value appears in terminal, logs, screenshots or output files',
                'Direct Worker URL serves blank, old Pages content or checkout-enabled output',
            ],
        },
        {
            id: 'provider_dashboard_closure',
            title: 'Close provider dashboard decisions',
            phase: 'Before domain move or smoke',
            itemIds: [
                requireItem('stripe_webhook_test_cutover'),
                requireItem('turnstile_domain_closure'),
                requireItem('sentry_issue_triage'),
            ],
            prerequisites: [
                'Selected launch host/payment posture is final enough for test-mode webhook evidence',
                'Turnstile widget/domain and Sentry issue decisions are reviewed without secrets/private payloads',
            ],
            blocks: ['integration_readiness', 'final_smoke'],
            closeWhen: 'Stripe test webhook host, Turnstile domain allowlist and Sentry issue posture are verified or explicitly accepted as risk.',
            stopIf: [
                'Stripe live mode, product/price/customer/subscription changes or CHECKOUT_ENABLED=true appear in scope',
                'Sentry evidence would expose private event payloads',
            ],
        },
        {
            id: 'cloudflare_domain_move',
            title: 'Move production domains after direct proof',
            phase: 'Cloudflare phase 4',
            itemIds: [requireItem('cloudflare_domain_move')],
            prerequisites: [
                'Worker shell, secret-name verification and direct Worker URL probes have passed',
                'Separate domain-move approval sentence is exact',
            ],
            blocks: ['integration_readiness', 'seo_llm_final', 'final_smoke'],
            closeWhen: 'espanolhonesto.com and www.espanolhonesto.com serve the modern Worker build and live-domain read-only evidence passes or has scoped accepted risk.',
            stopIf: [
                'The domain move approval also asks to delete Pages or activate real payments',
                'Post-move live domain serves old, blank, wrong-account or checkout-enabled output',
            ],
        },
        {
            id: 'seo_llm_final_review',
            title: 'Close SEO/LLM and Russian typography',
            phase: 'After domain/copy/legal settle',
            itemIds: [requireItem('seo_llm_live_domain_review')],
            prerequisites: [
                'Live domains serve the modern build',
                'Legal pages, payment posture and Russian font/fallback decision are final',
            ],
            blocks: ['seo_llm_final', 'final_smoke'],
            closeWhen: 'Live-domain, sitemap, robots, canonical/hreflang, JSON-LD, llms.txt, Search Console/CWV or accepted-risk, and Cyrillic typography evidence are recorded.',
            stopIf: [
                'Live-domain parity still shows old Pages/incomplete modern routes without accepted risk',
                'Evidence would store Search Console tokens, analytics exports, font invoices or unlicensed font files',
            ],
        },
        {
            id: 'staging_write_smoke_rehearsal',
            title: 'Run staging write-capable lifecycle smoke rehearsal',
            phase: 'Before final launch window',
            itemIds: [requireItem('staging_write_capable_smoke_rehearsal')],
            prerequisites: [
                'Exact staging writes-ok approval exists for espanolhonesto-staging.alindev95.workers.dev',
                'Stripe test mode and smoke credential source are confirmed',
                'Canonical outputs/launch-staging-billing-lifecycle/<timestamp>/summary.json is OK/complete for the exact Checkout and its terminal state passes live revalidation',
            ],
            blocks: ['integration_readiness'],
            closeWhen: 'Canonical billing lifecycle plus Checkout/webhook, Drive, email, booking, Doc, Calendar/Meet, reminder, cancellation, retry and UX/logistics evidence are recorded redacted for staging.',
            stopIf: [
                'SMOKE_BASE_URL is not staging or does not exactly match writes-ok approval',
                'The smoke would use Stripe live mode, activate real payments or change Cloudflare/DNS/domains',
            ],
        },
        {
            id: 'final_write_smoke',
            title: 'Run final write-capable lifecycle smoke',
            phase: 'T-3h to T-0',
            itemIds: [requireItem('final_write_capable_smoke')],
            prerequisites: [
                'Runtime/domain/provider/legal/SEO prerequisites are closed or explicitly risk-accepted',
                'Exact SMOKE_EXTERNAL_WRITES_CONFIRMATION=writes-ok:<host> approval exists for the target host',
            ],
            blocks: ['final_smoke'],
            closeWhen: 'Registration, checkout/no-checkout, webhook, Drive, email, booking, Doc, Calendar/Meet, reminder, cancellation and retry smoke evidence is recorded redacted.',
            stopIf: [
                'SMOKE_BASE_URL host does not exactly match the writes-ok approval',
                'The smoke would store secrets, payment payloads, private Drive links or student private data in repo evidence',
            ],
        },
    ];
}

interface Rendered {
    queueMarkdown: string;
    manifest: string;
    nextActionCursor: string;
    executionBoard: string;
    summary: string;
}

function renderAll(report: QueueReport): Rendered {
    const queueMarkdown = renderQueueMarkdown(report);
    const nextActionCursor = renderNextActionCursor(report);
    const executionBoard = renderExecutionBoard(report);
    const manifest = `${JSON.stringify({
        schemaVersion: report.schemaVersion,
        startedAt: report.startedAt,
        endedAt: report.endedAt,
        status: report.status,
        approvalQueueStatus: report.approvalQueueStatus,
        generatedBy: 'launch:final-approval-queue',
        localOnly: true,
        noExternalCalls: true,
        noSecretValuesStored: true,
        queuePath: toPosix(path.relative(process.cwd(), report.queuePath)),
        summaryPath: toPosix(path.relative(process.cwd(), report.summaryPath)),
        nextActionPath: toPosix(path.relative(process.cwd(), report.nextActionPath)),
        executionBoardPath: toPosix(path.relative(process.cwd(), report.executionBoardPath)),
        criticalPath: report.criticalPath,
        items: report.items.map((item) => ({
            ...item,
            approvalPath: toRelativeOrNull(item.approvalPath),
            supportPaths: item.supportPaths.map(toRelative),
            rollbackPath: toRelativeOrNull(item.rollbackPath),
            files: filesForItem(item),
        })),
        checks: report.checks,
    }, null, 2)}\n`;
    const summary = renderSummary(report);
    return { queueMarkdown, manifest, nextActionCursor, executionBoard, summary };
}

function renderQueueMarkdown(report: QueueReport): string {
    const lines = [
        '# Final Approval Queue',
        '',
        'Generated by `pnpm launch:final-approval-queue` from the latest local launch artifacts.',
        '',
        'This queue is not approval. It is a local navigation aid for final-window review.',
        '',
        '- No external services are called or changed by this command.',
        '- No secret values are stored here.',
        '- Use the linked approval request for the exact scope.',
        '- If an approval request and a dashboard disagree, stop and regenerate the specific package before writing.',
        '- Items marked `must_wait` are blocked by prerequisites even when all local artifacts exist.',
        '- Items marked `requires_exact_approval` still need explicit resource/action approval before any write.',
        '- Items marked `human_input_required` need human-owned final values or review.',
        '',
        `- Status: ${report.status}`,
        `- Approval Queue Status: ${report.approvalQueueStatus}`,
        `- Generated: ${report.endedAt}`,
        '',
        '## Queue',
        '',
        '| Item | Kind | Status | Wait Reason | Target | Approval / Review | Support | Rollback | Blocks |',
        '| --- | --- | --- | --- | --- | --- | --- | --- | --- |',
        ...report.items.map((item) => [
            escapeCell(item.title),
            item.kind,
            item.status,
            escapeCell(item.waitReason ?? '-'),
            escapeCell(item.target),
            escapeCell(toRelativeOrDash(item.approvalPath)),
            escapeCell(item.supportPaths.map(toRelative).join('<br>') || '-'),
            escapeCell(toRelativeOrDash(item.rollbackPath)),
            escapeCell(item.finalBlockers.join(', ')),
        ].join(' | ')).map((row) => `| ${row} |`),
        '',
        '## Critical Path',
        '',
        'This is the dependency order for final-window execution. It is not approval and does not replace the linked request files.',
        '',
        '| Step | Phase | Queue Items | Prerequisites | Blocks | Close When | Stop If |',
        '| --- | --- | --- | --- | --- | --- | --- |',
        ...report.criticalPath.map((step) => `| ${escapeCell(step.title)} | ${escapeCell(step.phase)} | ${escapeCell(step.itemIds.join(', '))} | ${escapeCell(step.prerequisites.join('<br>') || '-')} | ${escapeCell(step.blocks.join(', ') || '-')} | ${escapeCell(step.closeWhen)} | ${escapeCell(step.stopIf.join('<br>') || '-')} |`),
        '',
        '## Boundaries',
        '',
    ];

    for (const item of report.items) {
        lines.push(
            `### ${item.title}`,
            '',
            `- Target: ${item.target}`,
            `- Allowed scope: ${item.allowedScope}`,
            `- Approval/review path: ${toRelativeOrDash(item.approvalPath)}`,
            `- Rollback path: ${toRelativeOrDash(item.rollbackPath)}`,
            ...(item.waitReason ? [
                `- Wait reason: ${item.waitReason}`,
                `- Prerequisite items: ${(item.prerequisiteItemIds ?? []).join(', ') || '-'}`,
            ] : []),
            '- Forbidden scope:',
            ...item.forbiddenScope.map((scope) => `  - ${scope}`),
            ''
        );
    }

    lines.push(
        '## Review Order',
        '',
        '1. Review legal final inputs and payment posture before write-capable smoke.',
        '2. Resolve the standalone Supabase processed_at blocker or record the exact accepted risk.',
        '3. Create/verify Cloudflare production runtime before any domain move.',
        '4. Close Stripe webhook, Turnstile widget/domain and Sentry issue decisions before integration_readiness.',
        '5. Re-run live-domain SEO/LLM evidence after the modern runtime serves espanolhonesto.com/www.',
        '6. Run final smoke only after the exact SMOKE_BASE_URL host approval exists.',
        '',
        '## Checks',
        '',
        '| Status | Check | Message | Details |',
        '| --- | --- | --- | --- |',
        ...report.checks.map((check) => `| ${check.status} | ${check.name} | ${escapeCell(check.message)} | ${escapeCell(check.details.join(' / '))} |`),
        ''
    );

    return `${lines.join('\n')}\n`;
}

function renderNextActionCursor(report: QueueReport): string {
    const item = (id: string) => report.items.find((candidate) => candidate.id === id) ?? null;
    const step = (id: string) => report.criticalPath.find((candidate) => candidate.id === id) ?? null;
    const legal = item('legal_final_inputs');
    const legalStep = step('final_inputs_freeze');
    const supabase = item('supabase_processed_at_cleanup');
    const supabaseStep = step('supabase_p3_decision');
    const cloudflareWorker = item('cloudflare_worker_create');
    const cloudflareWorkerStep = step('cloudflare_worker_shell');
    const cloudflareSecrets = item('cloudflare_worker_secrets');
    const cloudflareFulfillmentSecrets = item('cloudflare_fulfillment_secrets');
    const cloudflareDomain = item('cloudflare_domain_move');
    const finalSmoke = item('final_write_capable_smoke');

    const lines = [
        '# Final Approval Next Action Cursor',
        '',
        'Generated by `pnpm launch:final-approval-queue` from the latest local launch artifacts.',
        '',
        'This file is not approval. It narrows the final-window navigation so scopes do not blur together.',
        '',
        '- No external services are called or changed by this command.',
        '- No secret values are stored here.',
        '- Use the linked approval request for the exact scope before any write.',
        '- If a linked approval request and a dashboard disagree, stop and regenerate the specific package before writing.',
        '- Items marked `must_wait` are blocked by prerequisites even when all local artifacts exist.',
        '- Items marked `requires_exact_approval` still need explicit resource/action approval before any write.',
        '- Items marked `human_input_required` need human-owned final values or review.',
        '',
        '## First Human-Only Action',
        '',
        cursorItemBlock({
            item: legal,
            step: legalStep,
            fallbackTitle: 'Legal final values and human review',
            why: 'This clears legal_owner_controller, legal_human_review, launch:legal and then the primary verifier. It still waits for real Alin-provided values; do not invent legal data.',
        }),
        '',
        '## First Non-Legal Operational Action',
        '',
        '- Legal remains final-only by project decision; do not invent legal values or treat this local cursor as a reason to fill them early.',
        '- The first non-legal blocker that can move before final smoke is the Supabase processed_at decision below.',
        '',
        '## First Standalone Strict-QA Decision',
        '',
        cursorItemBlock({
            item: supabase,
            step: supabaseStep,
            fallbackTitle: 'Supabase processed_at DROP DEFAULT',
            why: 'This is the only standalone Strict-QA blocker in launch:status and must be applied/verified or explicitly accepted before final integration smoke.',
        }),
        '',
        '## First Cloudflare Production Runtime Action',
        '',
        cursorItemBlock({
            item: cloudflareWorker,
            step: cloudflareWorkerStep,
            fallbackTitle: 'Cloudflare production Worker phase 1',
            why: 'This creates the production Worker shell without moving domains. It must happen before Worker secret-name verification, direct Worker probes and the domain move.',
        }),
        '',
        '## Must Wait',
        '',
        mustWaitLine(cloudflareSecrets, 'Cloudflare production Worker secret-name phase', 'wait until the production Worker exists; never print or store secret values.'),
        mustWaitLine(cloudflareFulfillmentSecrets, 'Cloudflare production Fulfillment Worker config/secrets/email phase', 'wait until the exact Worker exists; never send email or process jobs in the secret phase.'),
        mustWaitLine(cloudflareDomain, 'Cloudflare production domain move', 'wait until web and fulfillment secret-name verification plus identity/version/Supabase attestations have passed with separate domain approval.'),
        mustWaitLine(finalSmoke, 'Final write-capable lifecycle smoke', 'wait until runtime/domain/provider/legal/SEO prerequisites are closed or risk-accepted and the exact writes-ok host approval exists.'),
        '',
        '## Source Paths',
        '',
        `- Queue: ${toRelative(report.queuePath)}`,
        `- Manifest: ${toRelative(report.manifestPath)}`,
        `- Execution Board: ${toRelative(report.executionBoardPath)}`,
        `- Summary: ${toRelative(report.summaryPath)}`,
        '',
    ];

    return `${lines.join('\n')}\n`;
}

function renderExecutionBoard(report: QueueReport): string {
    const lines = [
        '# Final Window Execution Board',
        '',
        'Generated by `pnpm launch:final-approval-queue` from the latest local launch artifacts.',
        '',
        'This board is not approval. It translates the final approval queue into operator modes so local checks, read-only refreshes and write approvals do not blur together.',
        '',
        '- No external services are called or changed by this command.',
        '- No secret values are stored here.',
        '- Use the linked approval request for the exact scope before any write.',
        '- If this board and a provider dashboard disagree, stop and regenerate the specific package before writing.',
        '',
        '## Safe Now: Local Only',
        '',
        'These commands are local hygiene/support checks. They do not grant permission to touch external services.',
        '',
        '```bash',
        'corepack pnpm --config.verify-deps-before-run=false launch:status',
        'corepack pnpm --config.verify-deps-before-run=false launch:final-approval-queue',
        'corepack pnpm --config.verify-deps-before-run=false typecheck',
        'corepack pnpm --config.verify-deps-before-run=false secrets:check',
        'git diff --check',
        '```',
        '',
        '## Safe With Care: Read-Only Refresh',
        '',
        'These commands may call provider APIs or public domains, but they are designed as read-only evidence refreshes. Stop if a tool asks to create, update, delete, deploy, rotate, send, charge or move anything.',
        '',
        '```bash',
        'corepack pnpm --config.verify-deps-before-run=false launch:stripe-readonly',
        'corepack pnpm --config.verify-deps-before-run=false launch:turnstile-readonly',
        'corepack pnpm --config.verify-deps-before-run=false launch:sentry-readonly',
        'corepack pnpm --config.verify-deps-before-run=false launch:google-readonly',
        'corepack pnpm --config.verify-deps-before-run=false launch:resend-readonly',
        'corepack pnpm --config.verify-deps-before-run=false launch:supabase-processed-at-readonly-preflight',
        'corepack pnpm --config.verify-deps-before-run=false launch:supabase-processed-at-cleanup-runner',
        'corepack pnpm --config.verify-deps-before-run=false launch:cloudflare-production-runtime-readonly',
        'corepack pnpm --config.verify-deps-before-run=false launch:cloudflare-production-runtime-cutover-preflight',
        'corepack pnpm --config.verify-deps-before-run=false launch:cloudflare-production-worker-phase1',
        'corepack pnpm --config.verify-deps-before-run=false launch:cloudflare-production-worker-secrets',
        'corepack pnpm --config.verify-deps-before-run=false launch:cloudflare-production-fulfillment-secrets',
        'corepack pnpm --config.verify-deps-before-run=false launch:live-domain-readonly -- --base-url https://espanolhonesto.com --host-variant https://www.espanolhonesto.com',
        '```',
        '',
        '## Final Execution Modes',
        '',
        '| Step | Mode | Queue Items | Approval / Review | Evidence To Inspect First | Stop If |',
        '| --- | --- | --- | --- | --- | --- |',
        ...report.criticalPath.map((step) => executionBoardRow(step, report.items)),
        '',
        '## Mode Legend',
        '',
        '- `safe_now_local_only`: local command or evidence regeneration only; no provider or production write.',
        '- `read_only_refresh`: provider or live-domain read-only probe; no create/update/delete/deploy/send/charge/move.',
        '- `human_input_required`: waits for Alin-provided final values or human review; never invent missing values.',
        '- `requires_exact_approval`: can write only after the linked approval request matches the intended account/project/resource and scope exactly.',
        '- `must_wait`: blocked by earlier steps even if its approval artifact exists.',
        '',
        '## Source Paths',
        '',
        `- Queue: ${toRelative(report.queuePath)}`,
        `- Manifest: ${toRelative(report.manifestPath)}`,
        `- Next Action Cursor: ${toRelative(report.nextActionPath)}`,
        `- Summary: ${toRelative(report.summaryPath)}`,
        '',
    ];

    return `${lines.join('\n')}\n`;
}

function executionBoardRow(step: CriticalPathStep, items: QueueItem[]): string {
    const stepItems = step.itemIds
        .map((id) => items.find((item) => item.id === id))
        .filter((item): item is QueueItem => Boolean(item));
    const approval = stepItems
        .map((item) => toRelativeOrDash(item.approvalPath))
        .join('<br>') || '-';
    const support = stepItems
        .flatMap((item) => item.supportPaths)
        .map(toRelative)
        .join('<br>') || '-';

    return `| ${escapeCell(step.title)} | ${executionMode(step.id)} | ${escapeCell(step.itemIds.join(', '))} | ${escapeCell(approval)} | ${escapeCell(support)} | ${escapeCell(step.stopIf.join('<br>') || '-')} |`;
}

function executionMode(stepId: string): string {
    switch (stepId) {
        case 'final_inputs_freeze':
            return 'human_input_required';
        case 'supabase_p3_decision':
        case 'cloudflare_worker_shell':
        case 'provider_dashboard_closure':
            return 'requires_exact_approval';
        case 'seo_llm_final_review':
            return 'read_only_refresh';
        case 'cloudflare_secrets_and_direct_probe':
        case 'cloudflare_domain_move':
        case 'final_write_smoke':
            return 'must_wait';
        default:
            return 'safe_now_local_only';
    }
}

function cursorItemBlock({
    item,
    step,
    fallbackTitle,
    why,
}: {
    item: QueueItem | null;
    step: CriticalPathStep | null;
    fallbackTitle: string;
    why: string;
}): string {
    const title = item?.title ?? step?.title ?? fallbackTitle;
    const approval = toRelativeOrDash(item?.approvalPath ?? null);
    const support = item?.supportPaths.map(toRelative).join(', ') || '-';
    const rollback = toRelativeOrDash(item?.rollbackPath ?? null);
    const stopIf = step?.stopIf.join(' / ') || item?.forbiddenScope.join(' / ') || '-';

    return [
        `- Item: ${title}`,
        `- Status: ${item?.status ?? 'missing_artifacts'}`,
        `- Approval/review path: ${approval}`,
        `- Support evidence: ${support}`,
        `- Rollback path: ${rollback}`,
        `- Blocks: ${(step?.blocks ?? item?.finalBlockers ?? []).join(', ') || '-'}`,
        `- Why now: ${why}`,
        `- Stop if: ${stopIf}`,
    ].join('\n');
}

function renderSummary(report: QueueReport): string {
    const external = report.items.filter((item) => item.kind === 'external_write_approval');
    const missing = report.items.filter((item) => item.status === 'missing_artifacts');
    const mustWait = report.items.filter((item) => item.status === 'must_wait');
    const lines = [
        '# Final Approval Queue Summary',
        '',
        `- Status: ${report.status}`,
        `- Approval Queue Status: ${report.approvalQueueStatus}`,
        `- External approval items: ${external.length}`,
        `- Missing artifact items: ${missing.length}`,
        `- Must-wait items: ${mustWait.length}`,
        `- Queue: ${toRelative(report.queuePath)}`,
        `- Manifest: ${toRelative(report.manifestPath)}`,
        `- Next Action Cursor: ${toRelative(report.nextActionPath)}`,
        `- Execution Board: ${toRelative(report.executionBoardPath)}`,
        '',
        'This queue is not approval. No external services are called or changed by this command. No secret values are stored here. Use the linked approval request for the exact scope. Items marked `must_wait` are blocked by prerequisites even when all local artifacts exist. Items marked `requires_exact_approval` still need explicit resource/action approval before any write. Items marked `human_input_required` need human-owned final values or review.',
        '',
        '## Items',
        '',
        '| Item | Status | Wait Reason | Approval / Review | Blocks |',
        '| --- | --- | --- | --- | --- |',
        ...report.items.map((item) => `| ${escapeCell(item.title)} | ${item.status} | ${escapeCell(item.waitReason ?? '-')} | ${escapeCell(toRelativeOrDash(item.approvalPath))} | ${escapeCell(item.finalBlockers.join(', '))} |`),
        '',
        '## Critical Path',
        '',
        '| Step | Phase | Queue Items | Close When |',
        '| --- | --- | --- | --- |',
        ...report.criticalPath.map((step) => `| ${escapeCell(step.title)} | ${escapeCell(step.phase)} | ${escapeCell(step.itemIds.join(', '))} | ${escapeCell(step.closeWhen)} |`),
        '',
        '## Checks',
        '',
        '| Status | Check | Message |',
        '| --- | --- | --- |',
        ...report.checks.map((check) => `| ${check.status} | ${check.name} | ${escapeCell(check.message)} |`),
        '',
    ];

    return `${lines.join('\n')}\n`;
}

function queueItemStatus(item: QueueItem): QueueItemStatus {
    const required = [
        item.approvalPath,
        ...item.supportPaths,
        item.rollbackPath,
    ].filter((candidate): candidate is string => Boolean(candidate));

    if (item.kind === 'external_write_approval' && !item.approvalPath) return 'missing_artifacts';
    if (required.some((file) => !existsSync(file))) return 'missing_artifacts';
    if (item.waitReason) return 'must_wait';
    if (item.kind === 'read_only_reference') return 'reference_only';
    if (item.kind === 'human_final_input') return 'human_input_required';
    return 'requires_exact_approval';
}

function mustWaitLine(item: QueueItem | null, fallbackTitle: string, fallbackReason: string): string {
    const title = item?.title ?? fallbackTitle;
    const status = item?.status ?? 'missing_artifacts';
    const reason = item?.waitReason ?? fallbackReason;
    const prerequisites = item?.prerequisiteItemIds?.join(', ') || '-';
    return `- ${title}: status=${status}; reason=${reason}; prerequisites=${prerequisites}`;
}

function filesForItem(item: QueueItem) {
    return [
        item.approvalPath,
        ...item.supportPaths,
        item.rollbackPath,
    ]
        .filter((candidate): candidate is string => Boolean(candidate))
        .filter((file) => existsSync(file))
        .map((file) => {
            const contents = readFileSync(file, 'utf8');
            return {
                path: toRelative(file),
                sha256: createHash('sha256').update(contents).digest('hex'),
                bytes: Buffer.byteLength(contents, 'utf8'),
            };
        });
}

function existingOrExpected(values: Array<string | null>): string[] {
    return values.filter((value): value is string => Boolean(value));
}

function latestGeneratedPath(folderName: string, fileName: string): string | null {
    const root = path.join(process.cwd(), 'outputs', folderName);
    if (!existsSync(root)) return null;

    const candidates = readdirSync(root, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => path.join(root, entry.name, fileName))
        .filter((candidate) => existsSync(candidate))
        .sort()
        .reverse();

    return candidates[0] ?? null;
}

function toRelative(filePath: string): string {
    return toPosix(path.relative(process.cwd(), filePath));
}

function toRelativeOrNull(filePath: string | null): string | null {
    return filePath ? toRelative(filePath) : null;
}

function toRelativeOrDash(filePath: string | null): string {
    return filePath ? toRelative(filePath) : '-';
}

function stamp(date: Date): string {
    return date.toISOString().replace(/[:.]/g, '-');
}

function toPosix(filePath: string): string {
    return filePath.split(path.sep).join('/');
}

function escapeCell(value: string): string {
    return value.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}
