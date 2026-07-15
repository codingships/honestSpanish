import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
    classifyStripeWebhookCutoverEvidence,
    type StripeReadonlySummaryLike,
} from './stripe-webhook-cutover-shared';

type CheckStatus = 'ok' | 'warning' | 'failed';
type PackageStatus = 'OK' | 'WARNING' | 'FAILED';
type StripeCutoverStatus =
    | 'READY_FOR_FINAL_REVIEW'
    | 'READY_FOR_STRIPE_DASHBOARD_APPROVAL'
    | 'MISSING_STRIPE_READONLY_EVIDENCE'
    | 'BLOCKED_BY_STRIPE_READONLY_FAILURE';

interface Check {
    status: CheckStatus;
    name: string;
    message: string;
    details: string[];
}

interface Report {
    schemaVersion: 1;
    startedAt: string;
    endedAt: string;
    status: PackageStatus;
    stripeCutoverStatus: StripeCutoverStatus;
    outputDir: string;
    latestStripeReadonlySummary: string | null;
    stripeMode: string;
    currentEndpointHosts: string[];
    expectedWebhookHosts: string[];
    recommendedWebhookUrls: string[];
    currentEnabledEvents: string[];
    checks: Check[];
    packagePath: string;
    manifestPath: string;
    approvalRequestPath: string;
    verificationChecklistPath: string;
    rollbackPlanPath: string;
    manualEvidenceDryRunPath: string;
    summaryPath: string;
}

interface RenderedArtifacts {
    packageMarkdown: string;
    manifest: string;
    approvalRequest: string;
    verificationChecklist: string;
    rollbackPlan: string;
    manualEvidenceDryRun: string;
    summary: string;
}

const startedAt = new Date();
const outputDir = path.join(process.cwd(), 'outputs', 'launch-stripe-webhook-cutover-pack', stamp(startedAt));
mkdirSync(outputDir, { recursive: true });

const latestStripeReadonlySummary = latestGeneratedPath('launch-stripe-readonly-evidence', 'summary.json');
const stripeSummary = readJsonIfExists<StripeReadonlySummaryLike>(latestStripeReadonlySummary);
const stripeEvidenceClassification = classifyStripeWebhookCutoverEvidence(stripeSummary);
const stripeWebhookCheck = stripeSummary?.checks?.find((check) => check.name === 'stripe_webhook_endpoints_readonly');
const stripeAccountCheck = stripeSummary?.checks?.find((check) => check.name === 'stripe_account_readonly');
const environmentCheck = stripeSummary?.checks?.find((check) => check.name === 'environment_shape');
const stripeMode = stripeSummary?.stripeMode ?? 'unknown';
const currentEndpointHosts = detailList(stripeWebhookCheck?.details, 'unexpected_enabled_webhook_hosts');
const matchingEndpointHosts = detailList(stripeWebhookCheck?.details, 'matching_enabled_webhook_hosts');
const expectedWebhookHosts = detailList(stripeWebhookCheck?.details, 'expected_webhook_hosts');
const currentEnabledEvents = detailList(stripeWebhookCheck?.details, 'enabled_1_events');
const currentEndpointId = detailValue(stripeWebhookCheck?.details, 'enabled_1_id') || 'current enabled endpoint';
const currentAccountIdSha256 = detailValue(stripeAccountCheck?.details, 'account_id_sha256') || 'missing';
const currentEndpointIdSha256 = detailValue(stripeWebhookCheck?.details, 'enabled_1_id_sha256') || 'missing';
const currentEndpointUrl = detailValue(stripeWebhookCheck?.details, 'enabled_1_url') || 'current enabled webhook URL';
const recommendedWebhookUrls = expectedWebhookHosts
    .filter((host) => host !== 'none')
    .map((host) => `https://${host}/api/stripe-webhook`);

const checks: Check[] = [
    validatePackageScript(),
    validateReadonlyEvidence(),
];

let report = createReport(checks);
let rendered = renderArtifacts(report);
checks.push(validateGeneratedArtifactPosture(rendered));
report = createReport(checks);
rendered = renderArtifacts(report);

writeFileSync(report.packagePath, rendered.packageMarkdown, 'utf8');
writeFileSync(report.manifestPath, rendered.manifest, 'utf8');
writeFileSync(report.approvalRequestPath, rendered.approvalRequest, 'utf8');
writeFileSync(report.verificationChecklistPath, rendered.verificationChecklist, 'utf8');
writeFileSync(report.rollbackPlanPath, rendered.rollbackPlan, 'utf8');
writeFileSync(report.manualEvidenceDryRunPath, rendered.manualEvidenceDryRun, 'utf8');
writeFileSync(path.join(outputDir, 'summary.json'), JSON.stringify(report, null, 2), 'utf8');
writeFileSync(report.summaryPath, rendered.summary, 'utf8');

const failed = report.checks.filter((check) => check.status === 'failed');
const warnings = report.checks.filter((check) => check.status === 'warning');

console.log(`[launch:stripe-webhook-cutover-pack] Status: ${report.status}`);
console.log(`[launch:stripe-webhook-cutover-pack] Stripe cutover: ${report.stripeCutoverStatus}`);
console.log(`[launch:stripe-webhook-cutover-pack] Failed: ${failed.length}`);
console.log(`[launch:stripe-webhook-cutover-pack] Warnings: ${warnings.length}`);
console.log(`[launch:stripe-webhook-cutover-pack] Summary: ${report.summaryPath}`);
console.log(`[launch:stripe-webhook-cutover-pack] Package: ${report.packagePath}`);
console.log(`[launch:stripe-webhook-cutover-pack] Approval request: ${report.approvalRequestPath}`);
console.log(`[launch:stripe-webhook-cutover-pack] Verification checklist: ${report.verificationChecklistPath}`);
console.log(`[launch:stripe-webhook-cutover-pack] Rollback plan: ${report.rollbackPlanPath}`);

if (failed.length > 0) process.exit(1);

function createReport(reportChecks: Check[]): Report {
    const status = statusFor(reportChecks);
    const stripeCutoverStatus: StripeCutoverStatus = !latestStripeReadonlySummary
        ? 'MISSING_STRIPE_READONLY_EVIDENCE'
        : stripeEvidenceClassification.state === 'HOST_ONLY_DRIFT'
            ? 'READY_FOR_STRIPE_DASHBOARD_APPROVAL'
            : stripeEvidenceClassification.state === 'ALREADY_ON_EXPECTED_HOST'
                ? 'READY_FOR_FINAL_REVIEW'
                : 'BLOCKED_BY_STRIPE_READONLY_FAILURE';

    return {
        schemaVersion: 1,
        startedAt: startedAt.toISOString(),
        endedAt: new Date().toISOString(),
        status,
        stripeCutoverStatus,
        outputDir,
        latestStripeReadonlySummary: latestStripeReadonlySummary ? toPosix(path.relative(process.cwd(), latestStripeReadonlySummary)) : null,
        stripeMode,
        currentEndpointHosts: unique([...currentEndpointHosts, ...matchingEndpointHosts].filter((host) => host !== 'none')),
        expectedWebhookHosts,
        recommendedWebhookUrls,
        currentEnabledEvents,
        checks: reportChecks,
        packagePath: path.join(outputDir, 'stripe-webhook-cutover-pack.md'),
        manifestPath: path.join(outputDir, 'stripe-webhook-cutover-manifest.json'),
        approvalRequestPath: path.join(outputDir, 'approval-request.md'),
        verificationChecklistPath: path.join(outputDir, 'verification-checklist.md'),
        rollbackPlanPath: path.join(outputDir, 'rollback-plan.md'),
        manualEvidenceDryRunPath: path.join(outputDir, 'manual-evidence-dry-run.txt'),
        summaryPath: path.join(outputDir, 'summary.md'),
    };
}

function validatePackageScript(): Check {
    const packageJson = readJsonIfExists<{ packageManager?: string; scripts?: Record<string, string> }>('package.json');
    const missing: string[] = [];
    if (!packageJson) missing.push('package.json');
    if (packageJson?.packageManager !== 'pnpm@10.33.0') missing.push('packageManager=pnpm@10.33.0');
    if (packageJson?.scripts?.['launch:stripe-webhook-cutover-pack'] !== 'tsx scripts/launch/stripe-webhook-cutover-pack.ts') {
        missing.push('launch:stripe-webhook-cutover-pack=tsx scripts/launch/stripe-webhook-cutover-pack.ts');
    }

    return {
        status: missing.length === 0 ? 'ok' : 'failed',
        name: 'package_script_stripe_webhook_cutover_pack',
        message: missing.length === 0
            ? 'Package scripts expose the local-only Stripe webhook cutover pack and preserve pnpm policy.'
            : 'Package scripts are missing the Stripe webhook cutover pack or pnpm package manager contract.',
        details: missing.length === 0 ? ['launch:stripe-webhook-cutover-pack'] : missing.map((item) => `missing=${item}`),
    };
}

function validateReadonlyEvidence(): Check {
    if (!latestStripeReadonlySummary) {
        return {
            status: 'warning',
            name: 'stripe_readonly_evidence_available',
            message: 'No Stripe read-only summary is available yet.',
            details: ['run=pnpm --config.verify-deps-before-run=false launch:stripe-readonly'],
        };
    }

    if (!stripeSummary || stripeEvidenceClassification.state === 'BLOCKED') {
        return {
            status: 'failed',
            name: 'stripe_readonly_evidence_available',
            message: 'Latest Stripe read-only evidence is missing, invalid, or has failures beyond a strict host-only webhook drift.',
            details: [
                `latest=${toPosix(path.relative(process.cwd(), latestStripeReadonlySummary))}`,
                ...stripeEvidenceClassification.reasons,
            ],
        };
    }

    const details = [
        `latest=${toPosix(path.relative(process.cwd(), latestStripeReadonlySummary))}`,
        `stripe_mode=${stripeMode}`,
        `stripe_status=${stripeSummary.status ?? 'unknown'}`,
        `webhook_check=${stripeWebhookCheck?.status ?? 'missing'}`,
        `current_hosts=${unique([...currentEndpointHosts, ...matchingEndpointHosts].filter((host) => host !== 'none')).join('|') || 'none'}`,
        `expected_hosts=${expectedWebhookHosts.join('|') || 'none'}`,
        `events=${currentEnabledEvents.join('|') || 'unknown'}`,
        `webhook_secret_shape=${detailValue(environmentCheck?.details, 'webhook_secret') || 'unknown'}`,
    ];

    return {
        status: stripeEvidenceClassification.state === 'ALREADY_ON_EXPECTED_HOST' ? 'ok' : 'warning',
        name: 'stripe_readonly_evidence_available',
        message: stripeEvidenceClassification.state === 'ALREADY_ON_EXPECTED_HOST'
            ? 'Latest Stripe read-only evidence already shows an enabled webhook on an expected launch host.'
            : 'Latest Stripe read-only evidence proves the only failed condition is a strict host-only webhook drift.',
        details,
    };
}

function validateGeneratedArtifactPosture(renderedArtifacts: RenderedArtifacts): Check {
    const combined = Object.values(renderedArtifacts).join('\n');
    const forbiddenSecretPatterns = [
        /sk_(live|test)_[A-Za-z0-9]{20,}/,
        /pk_(live|test)_[A-Za-z0-9]{20,}/,
        /whsec_[A-Za-z0-9]{20,}/,
        /\bacct_[A-Za-z0-9]{12,}\b/,
        /\bwe_[A-Za-z0-9]{16,}\b/,
        /(postgres|postgresql):\/\/[^\s"']+:[^\s"']+@/,
    ];
    const offenders = forbiddenSecretPatterns.filter((pattern) => pattern.test(combined));
    const requiredSafetyText = [
        'does not call Stripe',
        'does not create, update, disable or delete Stripe webhook endpoints',
        'does not change products, prices, customers, subscriptions, checkout enablement or Stripe live mode',
        'webhook signing secret',
        'exact approval',
        'rollback',
    ];
    const missing = requiredSafetyText.filter((snippet) => !combined.includes(snippet));

    return {
        status: offenders.length === 0 && missing.length === 0 ? 'ok' : 'failed',
        name: 'generated_artifact_secret_and_scope_posture',
        message: offenders.length === 0 && missing.length === 0
            ? 'Generated Stripe cutover artifacts contain scope gates and no obvious secret values.'
            : 'Generated Stripe cutover artifacts are missing safety text or appear to include secret-like values.',
        details: [
            ...offenders.map((pattern) => `secretPattern=${pattern}`),
            ...missing.map((snippet) => `missing=${snippet}`),
        ],
    };
}

function renderArtifacts(report: Report): RenderedArtifacts {
    const packageMarkdown = renderPackage(report);
    const approvalRequest = renderApprovalRequest(report);
    const verificationChecklist = renderVerificationChecklist(report);
    const rollbackPlan = renderRollbackPlan(report);
    const manualEvidenceDryRun = renderManualEvidenceDryRun(report);
    const summary = renderSummary(report);
    const manifest = renderManifest(report, { packageMarkdown, approvalRequest, verificationChecklist, rollbackPlan, manualEvidenceDryRun, summary });

    return { packageMarkdown, manifest, approvalRequest, verificationChecklist, rollbackPlan, manualEvidenceDryRun, summary };
}

function renderPackage(report: Report): string {
    return `${[
        '# Stripe Webhook Cutover Pack',
        '',
        `- Generated: ${report.endedAt}`,
        `- Status: ${report.status}`,
        `- Stripe cutover status: ${report.stripeCutoverStatus}`,
        `- Latest Stripe read-only summary: ${report.latestStripeReadonlySummary ?? 'missing'}`,
        `- Stripe mode: ${report.stripeMode}`,
        '',
        'This package is local-only. It does not call Stripe, does not create, update, disable or delete Stripe webhook endpoints, does not change products, prices, customers, subscriptions, checkout enablement or Stripe live mode, and does not store webhook signing secret values.',
        '',
        '## Current Evidence',
        '',
        `- Current enabled webhook hosts: ${report.currentEndpointHosts.join(', ') || 'none'}`,
        `- Expected launch hosts: ${report.expectedWebhookHosts.join(', ') || 'none'}`,
        `- Recommended webhook URLs: ${report.recommendedWebhookUrls.join(', ') || 'none'}`,
        `- Enabled event set from latest read-only evidence: ${report.currentEnabledEvents.join(', ') || 'unknown'}`,
        '',
        '## Required Next Step',
        '',
        report.stripeCutoverStatus === 'READY_FOR_STRIPE_DASHBOARD_APPROVAL'
            ? '- Use `approval-request.md` to approve one exact Stripe dashboard webhook endpoint action after confirming the target host and mode.'
            : '- No Stripe dashboard webhook host action is currently proposed by this pack.',
        '',
        '## Before And After Ledger',
        '',
        'Before this package:',
        '',
        '- Stripe read-only evidence could warn on an unexpected enabled webhook host, but there was no dedicated approval/rollback artifact for correcting that host.',
        '',
        'After this package:',
        '',
        '- The single GET-only approval-preparation flow, verification checklist, rollback plan and manual evidence dry run are generated from latest local read-only evidence.',
        '- No Stripe object, product, price, customer, subscription, checkout setting, live-mode value, Supabase row, secret or code behavior changed.',
        '',
        'Cost/benefit:',
        '',
        '- Benefit: reduces risk of an over-broad Stripe dashboard change and makes the webhook host warning reversible and auditable.',
        '- Cost: one additional local support script/output folder to maintain.',
        '',
        'Rollback:',
        '',
        '- Remove the package script, this generator, generated output and test/runbook references. No Stripe rollback is required because this package performs no external write.',
        '',
    ].join('\n')}\n`;
}

function renderApprovalRequest(report: Report): string {
    const eventScope = report.currentEnabledEvents.join('|') || 'same event list shown in the latest Stripe dashboard preflight';
    const stagingUrl = 'https://staging.espanolhonesto.com/api/stripe-webhook';

    return `${[
        '# Stripe Webhook Cutover Approval Request',
        '',
        'This is not approval by itself. The runner must first prepare exactly one executable approval sentence from a live GET-only endpoint read.',
        'The exact approval scope is limited to one Stripe test-mode webhook endpoint host change.',
        '',
        '## Preflight',
        '',
        `- Latest read-only evidence: ${report.latestStripeReadonlySummary ?? 'missing'}`,
        `- Stripe mode: ${report.stripeMode}`,
        `- Current endpoint: ${currentEndpointUrl} (${currentEndpointId})`,
        `- Account id SHA-256: ${currentAccountIdSha256}`,
        `- Endpoint id SHA-256: ${currentEndpointIdSha256}`,
        `- Current hosts: ${report.currentEndpointHosts.join(', ') || 'none'}`,
        `- Event scope: ${eventScope}`,
        '',
        '## Single Executable Approval Flow',
        '',
        `1. Supply \`STRIPE_SECRET_KEY\`, \`STRIPE_EXPECTED_ACCOUNT_ID\`, the full \`STRIPE_WEBHOOK_ENDPOINT_ID\` and \`STRIPE_WEBHOOK_TARGET_URL=${stagingUrl}\` outside repository files.`,
        '2. Run the GET-only preparation: `pnpm --config.verify-deps-before-run=false launch:stripe-webhook-cutover-runner -- --prepare-approval`.',
        '3. Review the one exact sentence written to `approval-gate.md`. It identifies the account and endpoint only by SHA-256 and contains no full ids.',
        '4. Only after the human approves that exact sentence, supply it through `STRIPE_WEBHOOK_CUTOVER_APPROVAL` outside repository files and run `pnpm --config.verify-deps-before-run=false launch:stripe-webhook-cutover-runner -- --execute-approved`.',
        '',
        '## Forbidden Scope',
        '',
        '- Do not switch to Stripe live mode.',
        '- Do not enable real checkout or edit `CHECKOUT_ENABLED`.',
        '- Do not create or edit products, prices, customers, subscriptions, invoices, tax settings, bank/payout settings or fraud rules.',
        '- Do not copy the webhook signing secret into repository files, `.codex-ops`, outputs or chat.',
        '- Do not touch Cloudflare, Supabase, Google, Resend, Sentry or DNS as part of this approval.',
        '',
    ].join('\n')}\n`;
}

function renderVerificationChecklist(report: Report): string {
    return `${[
        '# Stripe Webhook Cutover Verification Checklist',
        '',
        '- Confirm the dashboard target is the intended Stripe account and mode before any write.',
        '- Confirm the target URL is exactly one launch URL ending in `/api/stripe-webhook`.',
        '- Confirm the event list is the intended checkout/subscription/payment event set.',
        '- Confirm no webhook signing secret value is copied into repo artifacts.',
        '- After the dashboard change, run `pnpm --config.verify-deps-before-run=false launch:stripe-readonly`.',
        '- Expected result: `stripe_webhook_endpoints_readonly` is OK, at least one enabled endpoint host matches an expected launch host, and no unexpected enabled endpoint host remains unless explicitly accepted as risk.',
        '- Record non-secret evidence: summary path, Stripe mode, endpoint id prefix, host, owner and date.',
        '',
        `Latest source evidence: ${report.latestStripeReadonlySummary ?? 'missing'}`,
        '',
    ].join('\n')}\n`;
}

function renderRollbackPlan(report: Report): string {
    return `${[
        '# Stripe Webhook Cutover Rollback Plan',
        '',
        'Rollback applies only if an approved Stripe dashboard change is made later. This package itself performs no external write.',
        '',
        '## Rollback Steps',
        '',
        `- Restore the prior enabled endpoint host if it was edited: ${report.currentEndpointHosts.join(', ') || 'unknown prior host'}.`,
        '- Or disable the newly created/edited endpoint and re-enable the prior endpoint if a separate endpoint was created.',
        '- Rerun `pnpm --config.verify-deps-before-run=false launch:stripe-readonly`.',
        '- If checkout was exercised during verification, reconcile Supabase `payments`, `subscriptions` and `processed_webhook_events` with non-secret evidence only.',
        '',
        '## Stop Conditions',
        '',
        '- Stop if the Stripe dashboard account or mode does not match the approval sentence.',
        '- Stop if the target host is not already serving the intended runtime.',
        '- Stop if the dashboard asks for or reveals a webhook signing secret; do not copy it into any artifact.',
        '- Stop if the required action would change products, prices, customers, subscriptions, live mode or checkout enablement.',
        '',
    ].join('\n')}\n`;
}

function renderManualEvidenceDryRun(report: Report): string {
    const packagePath = `../../${toPosix(path.relative(process.cwd(), report.packagePath))}`;
    const manifestPath = `../../${toPosix(path.relative(process.cwd(), report.manifestPath))}`;
    const verificationPath = `../../${toPosix(path.relative(process.cwd(), report.verificationChecklistPath))}`;

    return `${[
        'pnpm launch:manual-evidence:record --',
        '  --id integration_readiness',
        '  --status pass',
        '  --summary "Stripe webhook launch-host evidence reviewed as part of final integration readiness."',
        '  --environment production',
        '  --owner Alin',
        `  --evidence "command_output=${packagePath}::Stripe webhook cutover package reviewed"`,
        `  --evidence "command_output=${manifestPath}::Stripe webhook cutover manifest reviewed"`,
        `  --evidence "command_output=${verificationPath}::Stripe webhook verification checklist completed"`,
        '  --evidence "manual_note=Replace with concrete non-secret result: Stripe mode, endpoint id prefix, exact host, event set, verification summary path, owner/date and whether dashboard change or accepted risk was used."',
        '',
        '# Add --write only after replacing the placeholder note with real non-secret evidence.',
        '',
    ].join(' \\\n')}`;
}

function renderSummary(report: Report): string {
    const lines = [
        '# Stripe Webhook Cutover Pack Summary',
        '',
        `- Status: ${report.status}`,
        `- Stripe cutover status: ${report.stripeCutoverStatus}`,
        `- Latest Stripe read-only summary: ${report.latestStripeReadonlySummary ?? 'missing'}`,
        `- Package: ${toPosix(path.relative(process.cwd(), report.packagePath))}`,
        `- Approval request: ${toPosix(path.relative(process.cwd(), report.approvalRequestPath))}`,
        `- Verification checklist: ${toPosix(path.relative(process.cwd(), report.verificationChecklistPath))}`,
        `- Rollback plan: ${toPosix(path.relative(process.cwd(), report.rollbackPlanPath))}`,
        '',
        'This package is local-only. It does not call Stripe, does not create, update, disable or delete Stripe webhook endpoints, does not change products, prices, customers, subscriptions, checkout enablement or Stripe live mode, and does not store webhook signing secret values.',
        '',
        '| Status | Check | Message | Details |',
        '| --- | --- | --- | --- |',
    ];

    for (const check of report.checks) {
        lines.push(`| ${check.status} | ${check.name} | ${escapeCell(check.message)} | ${escapeCell(check.details.join(' / '))} |`);
    }

    lines.push('');
    return `${lines.join('\n')}\n`;
}

function renderManifest(report: Report, renderedFiles: Omit<RenderedArtifacts, 'manifest'>): string {
    return `${JSON.stringify({
        schemaVersion: 1,
        generatedAt: report.endedAt,
        status: report.status,
        stripeCutoverStatus: report.stripeCutoverStatus,
        latestStripeReadonlySummary: report.latestStripeReadonlySummary,
        stripeMode: report.stripeMode,
        currentEndpointHosts: report.currentEndpointHosts,
        expectedWebhookHosts: report.expectedWebhookHosts,
        recommendedWebhookUrls: report.recommendedWebhookUrls,
        currentEnabledEvents: report.currentEnabledEvents,
        currentEndpointId,
        currentAccountIdSha256,
        currentEndpointIdSha256,
        currentEndpointUrl,
        doesNotCallStripe: true,
        doesNotWriteExternalServices: true,
        doesNotStoreWebhookSigningSecret: true,
        forbiddenScope: [
            'Stripe live mode',
            'products/prices/customers/subscriptions/invoices',
            'checkout enablement',
            'webhook signing secret values',
            'Supabase/Cloudflare/Google/Resend/Sentry writes',
        ],
        files: {
            package: fileMeta(report.packagePath, renderedFiles.packageMarkdown),
            approvalRequest: fileMeta(report.approvalRequestPath, renderedFiles.approvalRequest),
            verificationChecklist: fileMeta(report.verificationChecklistPath, renderedFiles.verificationChecklist),
            rollbackPlan: fileMeta(report.rollbackPlanPath, renderedFiles.rollbackPlan),
            manualEvidenceDryRun: fileMeta(report.manualEvidenceDryRunPath, renderedFiles.manualEvidenceDryRun),
            summary: fileMeta(report.summaryPath, renderedFiles.summary),
        },
        checks: report.checks,
    }, null, 2)}\n`;
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

function readJsonIfExists<T>(file: string | null): T | null {
    if (!file || !existsSync(file)) return null;
    try {
        return JSON.parse(readFileSync(file, 'utf8')) as T;
    } catch {
        return null;
    }
}

function detailValue(details: string[] | undefined, key: string): string {
    const prefix = `${key}=`;
    return details?.find((detail) => detail.startsWith(prefix))?.slice(prefix.length).trim() ?? '';
}

function detailList(details: string[] | undefined, key: string): string[] {
    const value = detailValue(details, key);
    if (!value) return [];
    return unique(value.split('|').map((item) => item.trim()).filter(Boolean));
}

function unique(values: string[]): string[] {
    return [...new Set(values)].sort();
}

function fileMeta(filePath: string, contents: string) {
    return {
        path: toPosix(path.relative(process.cwd(), filePath)),
        sha256: createHash('sha256').update(contents).digest('hex'),
        bytes: Buffer.byteLength(contents, 'utf8'),
    };
}

function statusFor(checkList: Check[]): PackageStatus {
    if (checkList.some((check) => check.status === 'failed')) return 'FAILED';
    if (checkList.some((check) => check.status === 'warning')) return 'WARNING';
    return 'OK';
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
