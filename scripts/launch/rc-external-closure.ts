import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

type CheckStatus = 'ok' | 'warning' | 'failed';
type ReportStatus = 'OK' | 'WARNING' | 'FAILED';

interface SourceSummary {
    status?: string;
    outputDir?: string;
    endedAt?: string;
}

interface ManualEvidenceCheck {
    id?: string;
    status?: string;
}

interface ManualEvidenceFile {
    checks?: ManualEvidenceCheck[];
}

interface ExternalAction {
    id: string;
    status: CheckStatus;
    owner: string;
    target: string;
    permission: string;
    preflight: string;
    action: string;
    evidence: string;
    recordEvidence: string;
    verify: string;
    sourcePath: string | null;
    supportPath: string | null;
    approvalPath: string | null;
}

interface CheckResult {
    status: CheckStatus;
    name: string;
    message: string;
    details?: string[];
}

interface RcExternalClosureReport {
    schemaVersion: 1;
    startedAt: string;
    endedAt: string;
    status: ReportStatus;
    outputDir: string;
    closurePackPath: string;
    approvalRequestPath: string;
    nextApprovalPath: string;
    actions: ExternalAction[];
    checks: CheckResult[];
}

const startedAt = new Date();
const outputDir = path.join(process.cwd(), 'outputs', 'launch-rc-external-closure', stamp(startedAt));
const closurePackPath = path.join(outputDir, 'rc-external-closure-pack.md');
const approvalRequestPath = path.join(outputDir, 'approval-request.md');
const nextApprovalPath = path.join(outputDir, 'next-approval.md');
mkdirSync(outputDir, { recursive: true });

const stagingDatabaseRollout = latestJson<SourceSummary>('launch-staging-database-rollout', 'summary.json');
const operationsExternalClosure = latestJson<SourceSummary>('launch-operations-external-closure', 'summary.json');
const noRealPaymentsRemediation = latestJson<SourceSummary>('launch-staging-no-real-payments-remediation', 'summary.json');
const noRealPaymentsClosure = latestJson<SourceSummary>('launch-no-real-payments', 'summary.json');
const noRealPaymentsApproval = latestEvidenceFile('launch-staging-no-real-payments-remediation', 'approval-request.md');
const noRealPaymentsRemediationPack = latestEvidenceFile('launch-staging-no-real-payments-remediation', 'staging-no-real-payments-remediation-pack.md');
const noRealPaymentsBuildManifest = latestEvidenceFile('launch-staging-no-real-payments-remediation', 'pages-staging-build-manifest.json');
const rcStagingPackage = latestEvidenceFile('launch-worktree', 'rc-staging-package.md');
const rcStagingPackageFiles = latestEvidenceFile('launch-worktree', 'rc-staging-package-files.txt');
const rcStagingRuntimeDiff = latestEvidenceFile('launch-worktree', 'rc-staging-runtime-diff.patch');
const rcStagingRuntimeManifest = latestEvidenceFile('launch-worktree', 'rc-staging-runtime-manifest.json');
const stagingDatabaseApproval = latestEvidenceFile('launch-staging-database-rollout', 'approval-request.md');
const stagingDatabasePlan = latestEvidenceFile('launch-staging-database-rollout', 'rollout-plan.md');
const stagingDatabaseManifest = latestEvidenceFile('launch-staging-database-rollout', 'staging-migration-manifest.json');
const operationsExternalApproval = latestEvidenceFile('launch-operations-external-closure', 'approval-request.md');
const operationsExternalPack = latestEvidenceFile('launch-operations-external-closure', 'operations-external-closure-pack.md');
const operationsExternalManifest = latestEvidenceFile('launch-operations-external-closure', 'operations-external-evidence-manifest.json');
const manualEvidencePath = path.join(process.cwd(), 'docs', 'launch', 'MANUAL_EVIDENCE.local.json');
const manualEvidence = readManualEvidence(manualEvidencePath);
const databaseReadinessEvidence = manualEvidence?.checks?.find((check) => check.id === 'database_readiness') ?? null;
const operationsExternalEvidence = manualEvidence?.checks?.find((check) => check.id === 'operations_external') ?? null;

const actions: ExternalAction[] = [
    buildCloudflareCheckoutAction(noRealPaymentsRemediation, noRealPaymentsClosure, noRealPaymentsRemediationPack, noRealPaymentsApproval),
    buildSupabaseStagingAction(stagingDatabaseRollout, databaseReadinessEvidence, stagingDatabasePlan, stagingDatabaseApproval),
    buildOperationsEvidenceAction(operationsExternalClosure, operationsExternalEvidence, operationsExternalPack, operationsExternalApproval),
];
const checks = actions.map(actionToCheck);
const failed = checks.filter((check) => check.status === 'failed');
const warnings = checks.filter((check) => check.status === 'warning');
const status: ReportStatus = failed.length > 0 ? 'FAILED' : warnings.length > 0 ? 'WARNING' : 'OK';

const report: RcExternalClosureReport = {
    schemaVersion: 1,
    startedAt: startedAt.toISOString(),
    endedAt: new Date().toISOString(),
    status,
    outputDir,
    closurePackPath,
    approvalRequestPath,
    nextApprovalPath,
    actions,
    checks,
};

writeFileSync(path.join(outputDir, 'summary.json'), JSON.stringify(report, null, 2), 'utf8');
writeFileSync(path.join(outputDir, 'summary.md'), renderSummary(report), 'utf8');
writeFileSync(closurePackPath, renderClosurePack(report), 'utf8');
writeFileSync(approvalRequestPath, renderApprovalRequest(report), 'utf8');
writeFileSync(nextApprovalPath, renderNextApproval(report), 'utf8');

console.log(`[launch:rc-external-closure] Status: ${status}`);
console.log(`[launch:rc-external-closure] Failed: ${failed.length}`);
console.log(`[launch:rc-external-closure] Warnings: ${warnings.length}`);
console.log(`[launch:rc-external-closure] Summary: ${path.join(outputDir, 'summary.md')}`);
console.log(`[launch:rc-external-closure] Closure pack: ${closurePackPath}`);
console.log(`[launch:rc-external-closure] Approval request: ${approvalRequestPath}`);
console.log(`[launch:rc-external-closure] Next approval: ${nextApprovalPath}`);

if (failed.length > 0) process.exit(1);

function buildCloudflareCheckoutAction(
    source: { file: string; data: SourceSummary } | null,
    closure: { file: string; data: SourceSummary } | null,
    supportPath: string | null,
    approvalPath: string | null,
): ExternalAction {
    const sourceStatus = source?.data.status ?? 'missing';
    const closureStatus = closure?.data.status ?? 'missing';
    const isBlocked = sourceStatus === 'FAILED';
    const isVerified = closureStatus === 'OK' || sourceStatus === 'OK';

    return {
        id: 'cloudflare_pages_no_real_payments',
        status: isVerified ? 'ok' : isBlocked ? 'failed' : 'warning',
        owner: 'Alin/Codex after explicit external-write confirmation',
        target: 'Cloudflare Pages project espanol-honesto-staging',
        permission: 'Staging write approval required before changing Cloudflare Pages config or redeploying staging.',
        preflight: `Read-only confirm Cloudflare account, Pages project name and staging environment before any write; list variable names only, never values. Review ${rcStagingPackage ? toRelative(rcStagingPackage) : 'the latest rc-staging-package.md from launch:worktree'}, ${rcStagingPackageFiles ? toRelative(rcStagingPackageFiles) : 'the latest rc-staging-package-files.txt from launch:worktree'}, ${rcStagingRuntimeDiff ? toRelative(rcStagingRuntimeDiff) : 'the latest rc-staging-runtime-diff.patch from launch:worktree'}, ${rcStagingRuntimeManifest ? toRelative(rcStagingRuntimeManifest) : 'the latest rc-staging-runtime-manifest.json from launch:worktree'} and ${noRealPaymentsBuildManifest ? toRelative(noRealPaymentsBuildManifest) : 'the latest pages-staging-build-manifest.json from launch:staging-no-real-payments-remediation'} before relying on CHECKOUT_ENABLED=false.`,
        action: 'If the deployed source lacks the checkout guard, package and redeploy the current Pages code/config first; then set or verify non-secret variable CHECKOUT_ENABLED=false for the staging environment.',
        evidence: isVerified
            ? 'Latest no-real-payments evidence says the deployed checkout endpoint is blocked.'
            : 'Latest staging no-real-payments remediation shows staging checkout is not blocked or needs confirmation.',
        recordEvidence: 'Record non-secret evidence: Pages project, environment, CHECKOUT_ENABLED=false as a state claim, deployment timestamp and no-real-payments command output path.',
        verify: 'corepack pnpm launch:no-real-payments -- --deployed-url https://espanol-honesto-staging.pages.dev',
        sourcePath: closure?.file ?? source?.file ?? null,
        supportPath,
        approvalPath,
    };
}

function buildSupabaseStagingAction(
    source: { file: string; data: SourceSummary } | null,
    manualEvidenceCheck: ManualEvidenceCheck | null,
    supportPath: string | null,
    approvalPath: string | null,
): ExternalAction {
    const sourceStatus = source?.data.status ?? 'missing';
    const manualEvidencePassed = isPassingManualEvidence(manualEvidenceCheck);

    return {
        id: 'supabase_staging_schema_rollout',
        status: manualEvidencePassed ? 'ok' : sourceStatus === 'OK' ? 'warning' : 'failed',
        owner: 'Alin/Codex after explicit Supabase staging write confirmation',
        target: 'Supabase project espanol-staging (mzjyvmlxfpzdfdjzxxyj)',
        permission: 'Supabase staging write approval required; production Supabase is explicitly excluded from this RC pack.',
        preflight: `Read-only confirm project id, project name, migration drift and exact migration list before applying anything. Review ${stagingDatabaseManifest ? toRelative(stagingDatabaseManifest) : 'the latest staging-migration-manifest.json from launch:staging-db-rollout'} before approval so hashes, target and forbidden scope match the rollout plan.`,
        action: 'Apply or verify the prepared staging migration sequence, then rerun the hosted schema check and staging data-flow checks. Production remains separate and later.',
        evidence: manualEvidencePassed
            ? 'Manual evidence marks database_readiness pass after staging migrations, hosted schema check and staging data-flow verification.'
            : sourceStatus === 'OK'
            ? 'A local rollout pack exists for the required staging migrations.'
            : 'No current OK staging database rollout pack was found.',
        recordEvidence: 'Record non-secret evidence: project id/name, migration versions applied or already present, hosted schema check output path and staging-only data-flow result.',
        verify: 'corepack pnpm launch:staging-db-rollout && corepack pnpm launch:operations && corepack pnpm launch:phase1',
        sourcePath: manualEvidencePassed ? manualEvidencePath : source?.file ?? null,
        supportPath,
        approvalPath,
    };
}

function buildOperationsEvidenceAction(
    source: { file: string; data: SourceSummary } | null,
    manualEvidenceCheck: ManualEvidenceCheck | null,
    supportPath: string | null,
    approvalPath: string | null,
): ExternalAction {
    const sourceStatus = source?.data.status ?? 'missing';
    const manualEvidencePassed = isPassingManualEvidence(manualEvidenceCheck);

    return {
        id: 'operations_external_evidence',
        status: manualEvidencePassed ? 'ok' : sourceStatus === 'OK' ? 'ok' : sourceStatus === 'WARNING' ? 'warning' : 'failed',
        owner: 'Alin/Codex with read-only dashboard evidence or explicit accepted RC substitute',
        target: 'Cloudflare fulfillment Worker staging, Resend staging, Admin Jobs staging UI/runtime',
        permission: 'Read-only evidence is preferred; staging write approval is required only before sending a test email, triggering a job or changing config.',
        preflight: `Confirm staging resources by name, inspect dashboards/log visibility only, and avoid screenshots or payloads containing personal data. Review ${operationsExternalManifest ? toRelative(operationsExternalManifest) : 'the latest operations-external-evidence-manifest.json from launch:operations-external-closure'} before recording evidence so read-only targets and side-effect gates stay explicit.`,
        action: 'Confirm Cloudflare Workers Logs/observability visibility, Resend staging delivery/suppression visibility, and Admin Jobs recovery evidence without storing secrets or private data; Admin Jobs staging UI/runtime should be reviewed after database_readiness closes, or explicitly accepted as a scoped RC substitute while staging DB remains unavailable. Cron config, staging deployment and secret-name evidence are covered by the staging preflight.',
        evidence: manualEvidencePassed
            ? 'Manual evidence marks operations_external pass after current staging operations evidence review.'
            : sourceStatus === 'WARNING'
            ? 'Operations closure pack has support evidence but still names manual external evidence required.'
            : sourceStatus === 'OK'
                ? 'Operations external closure pack is OK.'
                : 'Operations external closure pack is missing or failed.',
        recordEvidence: 'Record non-secret evidence: resource names, environment, timestamp, visible status, dashboard/log presence and local output paths.',
        verify: 'corepack pnpm launch:operations-external-closure && corepack pnpm launch:manual-evidence && corepack pnpm launch:phase1',
        sourcePath: manualEvidencePassed ? manualEvidencePath : source?.file ?? null,
        supportPath,
        approvalPath,
    };
}

function actionToCheck(action: ExternalAction): CheckResult {
    return {
        status: action.status,
        name: action.id,
        message: action.status === 'ok'
            ? 'External closure item is already verified by the latest local evidence.'
            : action.status === 'warning'
                ? 'External closure item is prepared but still needs explicit evidence or approval.'
                : 'External closure item is not ready for RC freeze.',
        details: [
            `target=${action.target}`,
            `owner=${action.owner}`,
            `permission=${action.permission}`,
            `verify=${action.verify}`,
            `source=${toRelative(action.sourcePath) || 'missing'}`,
            `support=${toRelative(action.supportPath) || 'missing'}`,
            `specificApproval=${toRelative(action.approvalPath) || 'this consolidated request'}`,
        ],
    };
}

function renderSummary(report: RcExternalClosureReport): string {
    const lines = [
        '# RC External Closure Summary',
        '',
        `- Status: ${report.status}`,
        `- Started: ${report.startedAt}`,
        `- Ended: ${report.endedAt}`,
        `- Output: ${report.outputDir}`,
        `- Closure pack: ${toRelative(report.closurePackPath)}`,
        `- Approval request: ${toRelative(report.approvalRequestPath)}`,
        `- Next approval: ${toRelative(report.nextApprovalPath)}`,
        '',
        'This command is local-only. It reads the latest launch evidence and writes a consolidated RC closure pack. It does not deploy, change Cloudflare variables, apply Supabase migrations, send email, call Stripe, update manual evidence or write secrets.',
        '',
        '## Checks',
        '',
        '| Status | Check | Message | Details |',
        '| --- | --- | --- | --- |',
    ];

    for (const check of report.checks) {
        lines.push(`| ${check.status} | ${check.name} | ${escapeCell(check.message)} | ${escapeCell((check.details ?? []).join(' / '))} |`);
    }

    lines.push('');
    return `${lines.join('\n')}\n`;
}

function renderClosurePack(report: RcExternalClosureReport): string {
    const lines = [
        '# RC External Closure Pack',
        '',
        `- Status: ${report.status}`,
        `- Generated: ${report.endedAt}`,
        '',
        '## Purpose',
        '',
        'This is the single control sheet for the remaining no-real-payments RC external closures. It turns the current blockers into exact targets, allowed actions and post-fix verification commands.',
        '',
        '## RC Freeze Preconditions',
        '',
        'Do not freeze or redeploy the release candidate while `database_readiness`, `operations_external` or `no_real_payments_staging` remain open.',
        '',
        'Closing one action in this pack does not close the others. After the selected staging action is complete, rerun the matching verification command, then rerun `corepack pnpm launch:phase1`, `corepack pnpm launch:rc` and `corepack pnpm launch:status` before treating the RC as frozen.',
        '',
        'For `no_real_payments_staging`, staging must prove checkout is blocked with `403 Checkout is disabled`, not `400 priceId is required`. A local-only guard or uncommitted working-tree change is not enough evidence.',
        '',
        '## Next Approval',
        '',
        `Use ${toRelative(report.nextApprovalPath)} when you want a single-resource approval request instead of approving every open action in this pack at once.`,
        '',
        '## External Actions',
        '',
        '| Status | Action | Target | Permission | Preflight | What To Do | Evidence To Record | Verify With | Support Pack | Specific Approval | Source |',
        '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
    ];

    for (const action of report.actions) {
        lines.push(`| ${action.status} | ${action.id} | ${escapeCell(action.target)} | ${escapeCell(action.permission)} | ${escapeCell(action.preflight)} | ${escapeCell(action.action)} | ${escapeCell(action.recordEvidence)} | ${escapeCell(action.verify)} | ${escapeCell(toRelative(action.supportPath) || 'missing')} | ${escapeCell(toRelative(action.approvalPath) || 'this consolidated request')} | ${escapeCell(toRelative(action.sourcePath) || 'missing')} |`);
    }

    lines.push(
        '',
        '## Approval Scopes',
        '',
        '- Cloudflare Pages staging checkout block can be approved on its own; use its specific approval request when available.',
        '- Supabase staging schema rollout can be approved on its own; use its specific approval request when available.',
        '- Operations external evidence is read-only by default; use its specific approval request when available and ask separately before sending a staging test email, triggering a job or changing config.',
        '- One approval must not be treated as approval for the other scopes.',
        '',
        '## Forbidden From This Pack',
        '',
        '- Production Supabase writes or migrations.',
        '- Production Cloudflare changes or deployments.',
        '- Stripe live mode, real checkout enablement or payment acceptance.',
        '- Real legal owner/controller data, final secrets, domain/Search Console changes or production smoke.',
        '',
        '## Evidence Rules',
        '',
        '- Get explicit confirmation before any external write, even for staging.',
        '- Store only aggregate non-secret evidence: resource name, environment, timestamp, result and local output path.',
        '- Do not store API keys, private keys, webhook secrets, database URLs, bearer tokens, private rows, email payloads or screenshots with personal data.',
        '',
        '## Suggested Order',
        '',
        '1. Cloudflare Pages staging checkout block: close `cloudflare_pages_no_real_payments`, then rerun `corepack pnpm launch:no-real-payments -- --deployed-url https://espanol-honesto-staging.pages.dev`.',
        '2. Supabase staging schema: close `supabase_staging_schema_rollout`, then rerun hosted schema verification and staging flows.',
        '3. Operations evidence: close `operations_external_evidence`, then record non-secret manual evidence and rerun `corepack pnpm launch:phase1`.',
        '4. Freeze RC with `corepack pnpm launch:rc` only after Phase 1 and RC-specific checks are clear.',
        '',
    );

    return `${lines.join('\n')}\n`;
}

function renderNextApproval(report: RcExternalClosureReport): string {
    const nextAction = firstOpenAction(report.actions);
    const lines = [
        '# Next Recommended External Approval',
        '',
        'This file is not permission by itself. It narrows the consolidated RC external closure pack to one next approval so scopes do not blur together.',
        '',
    ];

    if (!nextAction) {
        lines.push(
            'No external approval is currently needed according to the latest RC external closure pack.',
            '',
            `Full pack: ${toRelative(report.closurePackPath)}`,
            '',
        );
        return `${lines.join('\n')}\n`;
    }

    lines.push(
        `- Recommended action: ${nextAction.id}`,
        `- Current status: ${nextAction.status}`,
        `- Target: ${nextAction.target}`,
        `- Permission needed: ${nextAction.permission}`,
        `- Support pack: ${toRelative(nextAction.supportPath) || 'missing'}`,
        `- Specific approval request: ${toRelative(nextAction.approvalPath) || 'this file'}`,
        `- Full RC external closure pack: ${toRelative(report.closurePackPath)}`,
        '',
        '## Why This First',
        '',
        nextAction.status === 'failed'
            ? 'This is the first failed RC external item. Closing it removes the most concrete blocker before moving to warnings or manual evidence refreshes.'
            : 'There are no failed RC external items; this is the first remaining warning that still needs explicit evidence or approval.',
        '',
        '## Exact Scope To Ask For',
        '',
        `Ask for approval only for: ${nextAction.target}.`,
        '',
        `Preflight: ${nextAction.preflight}`,
        '',
        `Action after approval: ${nextAction.action}`,
        '',
        `Evidence to record: ${nextAction.recordEvidence}`,
        '',
        `Post-check: ${nextAction.verify}`,
        '',
        '## Execution Checklist After Approval',
        '',
        ...nextApprovalExecutionChecklist(nextAction),
        '',
        '## Stop Conditions',
        '',
        ...nextApprovalStopConditions(nextAction),
        '',
        '## Approval Text',
        '',
        'Use this text verbatim or edit only the resource name/action you want to approve:',
        '',
        '```text',
        `I approve the staging-only action ${nextAction.id} for ${nextAction.target}.`,
        `Codex may perform the read-only preflight described here, then perform only this action: ${nextAction.action}`,
        `Codex may record only non-secret evidence described here: ${nextAction.recordEvidence}`,
        'This approval excludes production resources, Stripe live mode, real checkout enablement, legal real data, final secrets, domain/Search Console changes and production smoke.',
        '```',
        '',
        '## Not Included',
        '',
        '- Other RC external actions from the consolidated pack.',
        '- Production Supabase writes or migrations.',
        '- Production Cloudflare changes or deployments.',
        '- Stripe live mode, real checkout enablement or payment acceptance.',
        '- Legal real data, final secrets, domain/Search Console changes or production smoke.',
        '',
        'After this action is verified, rerun `corepack pnpm launch:rc-external-closure` and use the newly generated next approval file for the next resource.',
        '',
    );

    return `${lines.join('\n')}\n`;
}

function renderApprovalRequest(report: RcExternalClosureReport): string {
    const openActions = report.actions.filter((action) => action.status !== 'ok');
    const lines = [
        '# External Write Approval Request',
        '',
        'Use this text when asking for explicit permission to touch staging services. This file is not permission by itself.',
        '',
    ];

    if (openActions.length === 0) {
        lines.push('No external write approval is currently needed according to the latest RC external closure pack.', '');
        return `${lines.join('\n')}\n`;
    }

    lines.push('I need explicit confirmation for these staging-only actions:', '');
    for (const action of openActions) {
        lines.push(`- ${action.id}: ${action.target}`);
        lines.push(`  - Permission needed: ${action.permission}`);
        lines.push(`  - Preflight: ${action.preflight}`);
        lines.push(`  - Action: ${action.action}`);
        lines.push(`  - Evidence to record: ${action.recordEvidence}`);
        lines.push(`  - Post-check: ${action.verify}`);
        if (action.supportPath) lines.push(`  - Support pack: ${toRelative(action.supportPath)}`);
        if (action.approvalPath) lines.push(`  - Specific approval request: ${toRelative(action.approvalPath)}`);
    }

    lines.push(
        '',
        'Confirm only the exact action/resource you want performed. One approval must not be treated as approval for the other scopes.',
        '',
        'This approval does not freeze RC. RC freeze still requires `database_readiness`, `operations_external` and `no_real_payments_staging` to be clear, followed by `corepack pnpm launch:phase1`, `corepack pnpm launch:rc` and `corepack pnpm launch:status`.',
        '',
        'Forbidden from this approval: production Supabase writes, production Cloudflare changes, Stripe live mode, real checkout enablement, legal real data, final secrets, domain/Search Console changes and production smoke.',
        '',
    );

    return `${lines.join('\n')}\n`;
}

function firstOpenAction(actions: ExternalAction[]): ExternalAction | null {
    return actions.find((action) => action.status === 'failed')
        ?? actions.find((action) => action.status === 'warning')
        ?? null;
}

function nextApprovalExecutionChecklist(action: ExternalAction): string[] {
    if (action.id === 'cloudflare_pages_no_real_payments') {
        return [
            '1. Review the latest `rc-staging-package.md`, `rc-staging-package-files.txt`, `rc-staging-runtime-diff.patch`, `rc-staging-runtime-manifest.json`, `pages-staging-build-manifest.json` and specific Cloudflare approval request linked above.',
            '2. Confirm the Cloudflare account, Pages project and environment serving the staging URL before any write.',
            '3. If `Current HEAD guard ready` is `no`, package and deploy the listed runtime slice before relying on `CHECKOUT_ENABLED=false`.',
            '4. If using local build output, require `pages-staging-build-manifest.json` to show `readyForStagingDeployPackage=true`.',
            '5. Set or verify only the non-secret `CHECKOUT_ENABLED=false` state for the staging environment after the guard is deployed.',
            '6. Run the post-check command and confirm `/api/create-checkout` returns `403` with `Checkout is disabled`.',
            '7. Rerun `corepack pnpm launch:rc-external-closure` and `corepack pnpm launch:status` so the dashboard points to fresh evidence.',
        ];
    }

    if (action.id === 'supabase_staging_schema_rollout') {
        return [
            '1. Review the linked rollout plan, `staging-migration-manifest.json` and approval request.',
            '2. Confirm the Supabase project id/name in read-only mode before any write.',
            '3. Apply or verify only the staging migration sequence named by the rollout plan.',
            '4. Run the post-check command and record only non-secret schema/migration evidence.',
            '5. Rerun `corepack pnpm launch:rc-external-closure` and `corepack pnpm launch:status`.',
        ];
    }

    return [
        '1. Review the linked support pack, `operations-external-evidence-manifest.json` and approval request.',
        '2. Confirm the named staging resources before recording evidence.',
        '3. Prefer read-only dashboard/log evidence; ask separately before any email, job mutation or config change.',
        '4. Run the post-check command and record only non-secret evidence.',
        '5. Rerun `corepack pnpm launch:rc-external-closure` and `corepack pnpm launch:status`.',
    ];
}

function nextApprovalStopConditions(action: ExternalAction): string[] {
    const common = [
        '- Stop if the resource is not clearly the staging resource named in this file.',
        '- Stop if the requested action expands to production, Stripe live, real checkout enablement, legal real data, final secrets, domain/Search Console or production smoke.',
        '- Stop if a dashboard or command would expose secret values, private rows, tokens, private URLs or personal data in evidence.',
    ];

    if (action.id === 'cloudflare_pages_no_real_payments') {
        return [
            ...common,
            '- Stop if the deployment source does not contain the checkout guard and you are only changing `CHECKOUT_ENABLED`; a variable-only change is not enough evidence.',
            '- Stop if using local build output and `pages-staging-build-manifest.json` is missing or does not show `readyForStagingDeployPackage=true`.',
            '- Stop if the intended value is `CHECKOUT_ENABLED=true` or if live Stripe Price IDs are part of the action.',
            '- Stop if the post-check still returns `400 priceId is required`; rerun the staging remediation command instead of marking the action closed.',
        ];
    }

    if (action.id === 'supabase_staging_schema_rollout') {
        return [
            ...common,
            '- Stop if the target project is not `espanol-staging (mzjyvmlxfpzdfdjzxxyj)`.',
            '- Stop if `staging-migration-manifest.json` is missing or does not match the rollout plan migration order and hashes.',
            '- Stop if a dry run or dashboard review wants migrations outside the staged rollout plan.',
            '- Stop if production Supabase is needed; this next approval explicitly excludes production.',
        ];
    }

    return [
        ...common,
        '- Stop before sending a staging test email, triggering a job, processing a queue item or changing config unless that side effect has its own explicit approval.',
        '- Stop if the available evidence is only historical and does not prove current Workers Logs/observability, Resend staging or Admin Jobs visibility.',
    ];
}

function latestJson<T>(folderName: string, fileName: string): { file: string; data: T } | null {
    const directory = latestEvidenceDir(folderName, fileName);
    if (!directory) return null;

    const file = path.join(directory, fileName);
    return {
        file,
        data: JSON.parse(readFileSync(file, 'utf8')) as T,
    };
}

function readManualEvidence(file: string): ManualEvidenceFile | null {
    if (!existsSync(file)) return null;

    try {
        return JSON.parse(readFileSync(file, 'utf8')) as ManualEvidenceFile;
    } catch {
        return null;
    }
}

function isPassingManualEvidence(check: ManualEvidenceCheck | null): boolean {
    return check?.status === 'pass' || check?.status === 'accepted_risk';
}

function latestEvidenceFile(folderName: string, fileName: string): string | null {
    const directory = latestEvidenceDir(folderName, fileName);
    return directory ? path.join(directory, fileName) : null;
}

function latestEvidenceDir(folderName: string, summaryFileName: string): string | null {
    const root = path.join(process.cwd(), 'outputs', folderName);
    if (!existsSync(root)) return null;

    const directories = readdirSync(root, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => path.join(root, entry.name))
        .filter((directory) => existsSync(path.join(directory, summaryFileName)))
        .sort((a, b) => b.localeCompare(a));

    return directories[0] ?? null;
}

function stamp(date: Date): string {
    return date.toISOString().replace(/[:.]/g, '-');
}

function toRelative(filePath: string | null): string {
    if (!filePath) return '';
    return path.relative(process.cwd(), filePath).split(path.sep).join('/');
}

function escapeCell(value: string): string {
    return value.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}
