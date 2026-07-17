import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

type CheckStatus = 'ok' | 'warning' | 'failed';
type QueueStatus = 'WARNING' | 'FAILED';
type QueueItemStatus =
    | 'completed'
    | 'human_input_required'
    | 'requires_exact_approval'
    | 'reference_only'
    | 'must_wait';
type FinalGateId =
    | 'legal_owner_controller'
    | 'legal_human_review'
    | 'integration_readiness'
    | 'seo_llm_final'
    | 'final_smoke';

interface Check {
    status: CheckStatus;
    name: string;
    message: string;
    details: string[];
}

interface QueueItem {
    id: string;
    title: string;
    category: 'pending_gate' | 'completed_history';
    kind: 'external_write_approval' | 'human_final_input' | 'read_only_reference' | 'completed_history';
    target: string;
    status: QueueItemStatus;
    approvalPath: string | null;
    supportPaths: string[];
    rollbackPath: string | null;
    allowedScope: string;
    forbiddenScope: string[];
    finalBlockers: FinalGateId[];
    waitReason?: string;
    prerequisiteItemIds?: string[];
}

interface CriticalPathStep {
    id: string;
    title: string;
    phase: string;
    itemIds: string[];
    prerequisites: string[];
    blocks: FinalGateId[];
    closeWhen: string;
    stopIf: string[];
}

interface QueueReport {
    schemaVersion: 2;
    startedAt: string;
    endedAt: string;
    status: QueueStatus;
    approvalQueueStatus: 'FIVE_FINAL_GATES_PENDING' | 'INVALID_QUEUE';
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

const FINAL_GATE_IDS: FinalGateId[] = [
    'legal_owner_controller',
    'legal_human_review',
    'integration_readiness',
    'seo_llm_final',
    'final_smoke',
];

const startedAt = new Date();
const outputDir = path.join(process.cwd(), 'outputs', 'launch-final-approval-queue', stamp(startedAt));
mkdirSync(outputDir, { recursive: true });

const items = buildQueueItems();
const criticalPath = buildCriticalPath(items);
const checks: Check[] = [
    validateQueueArtifacts(items),
    validateFinalGateSet(items),
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
    const finalClosure = path.join(process.cwd(), 'docs', 'launch', 'FINAL_CLOSURE.md');
    const legalInputs = path.join(process.cwd(), 'docs', 'launch', 'LEGAL_INPUTS_REQUIRED.md');
    const legalRunbook = path.join(process.cwd(), 'docs', 'launch', 'MANUAL_EVIDENCE_RUNBOOK.md');
    const seoRunbook = path.join(process.cwd(), 'docs', 'launch', 'SEO_LLM_FINAL.md');
    const runbook = path.join(process.cwd(), 'docs', 'launch', 'RUNBOOK.md');

    return [
        {
            id: 'history_supabase_production_closure',
            title: 'Supabase production closure (history)',
            category: 'completed_history',
            kind: 'completed_history',
            target: 'Supabase production vkkahxsybhbutszerawz',
            status: 'completed',
            approvalPath: null,
            supportPaths: existingGeneratedPaths([
                ['launch-supabase-production-rollout-runner', 'summary.json'],
                ['launch-supabase-production-auth-cleanup', 'summary.json'],
                ['launch-production-inert-final-readonly', 'production-inert-final-receipt.json'],
            ]),
            rollbackPath: null,
            allowedScope: 'Historical evidence only: production rollout, Auth reduction, five availability rows and the final DB/Auth read-only closure remain closed.',
            forbiddenScope: [
                'Do not repeat rollout, Auth reduction or availability writes because a renewable readback expired',
                'Do not treat this history entry as approval for any Supabase write',
            ],
            finalBlockers: [],
        },
        {
            id: 'history_cloudflare_production_bootstrap',
            title: 'Cloudflare production bootstrap C-D-E (history)',
            category: 'completed_history',
            kind: 'completed_history',
            target: 'Cloudflare account d1a22bcf6477ff2ff31d2bfb83084e44, Workers espanolhonesto and espanol-honesto-fulfillment-production',
            status: 'completed',
            approvalPath: null,
            supportPaths: existingGeneratedPaths([
                ['launch-cloudflare-production-cde-lifecycle', 'summary.json'],
                ['launch-cloudflare-production-runtime-readonly', 'summary.json'],
            ]),
            rollbackPath: null,
            allowedScope: 'Historical evidence only: both production Workers exist in bootstrap-inert HMAC-only posture.',
            forbiddenScope: [
                'Do not replay C-D-E, deploy or rewrite secrets because a GET-only attestation expired',
                'Do not activate checkout, signup, email, Cron, Queues, DNS or domains from this queue',
            ],
            finalBlockers: [],
        },
        {
            id: 'history_stripe_test_closure',
            title: 'Stripe test cutover (history)',
            category: 'completed_history',
            kind: 'completed_history',
            target: 'Stripe test-mode webhook and canonical staging billing lifecycle',
            status: 'completed',
            approvalPath: null,
            supportPaths: existingGeneratedPaths([
                ['launch-stripe-webhook-cutover-runner', 'summary.json'],
                ['launch-staging-billing-lifecycle', 'summary.json'],
            ]),
            rollbackPath: null,
            allowedScope: 'Historical evidence only: the test-mode webhook cutover and staging billing lifecycle are closed.',
            forbiddenScope: [
                'Do not repeat Stripe test cutover as a release-candidate prerequisite',
                'No Stripe live-mode, product, price, customer, subscription or real-charge write',
            ],
            finalBlockers: [],
        },
        {
            id: 'history_staging_smoke_and_rollback',
            title: 'Staging full smoke and rollback drill (history)',
            category: 'completed_history',
            kind: 'completed_history',
            target: 'Staging lifecycle smoke and Cloudflare fulfillment rollback drill',
            status: 'completed',
            approvalPath: null,
            supportPaths: existingGeneratedPaths([
                ['launch-staging-smoke-rehearsal-runner', 'summary.json'],
                ['launch-cloudflare-staging-fulfillment-rollback-drill', 'summary.json'],
            ]),
            rollbackPath: null,
            allowedScope: 'Historical evidence only: the full staging rehearsal and rollback drill are closed.',
            forbiddenScope: [
                'Do not repeat staging writes or the rollback drill merely to refresh status evidence',
                'Repeat only after material integration drift and a new exact authorization outside this queue',
            ],
            finalBlockers: [],
        },
        {
            id: 'legal_owner_controller',
            title: 'Real legal owner/controller data',
            category: 'pending_gate',
            kind: 'human_final_input',
            target: 'Public legal identity and controller details',
            status: 'human_input_required',
            approvalPath: legalInputs,
            supportPaths: existingPaths([legalInputs, finalClosure]),
            rollbackPath: null,
            allowedScope: 'Replace example legal identity/controller data with the real launch values supplied by Alin; keep private identity evidence outside the repository.',
            forbiddenScope: [
                'No invented legal values',
                'No identity documents, tax records or private advisor notes in repository evidence',
            ],
            finalBlockers: ['legal_owner_controller'],
        },
        {
            id: 'legal_human_review',
            title: 'Human legal review',
            category: 'pending_gate',
            kind: 'human_final_input',
            target: 'Final public legal pages after real owner/controller data is applied',
            status: 'must_wait',
            approvalPath: legalRunbook,
            supportPaths: existingPaths([legalRunbook, finalClosure]),
            rollbackPath: null,
            allowedScope: 'Record the reviewer, date, scope and non-secret conclusion only after the real public legal text is final.',
            forbiddenScope: [
                'No self-certification before the real legal values are present',
                'No private legal advice or personal documents in evidence',
            ],
            finalBlockers: ['legal_human_review'],
            waitReason: 'Wait for legal_owner_controller; reviewing placeholder identity data does not close this gate.',
            prerequisiteItemIds: ['legal_owner_controller'],
        },
        {
            id: 'integration_readiness',
            title: 'Final integration readiness and inert activation/rollback plan',
            category: 'pending_gate',
            kind: 'external_write_approval',
            target: 'Production launch boundaries tied to LAUNCH_SHA; the current technical RC is RC_BASE_SHA',
            status: 'requires_exact_approval',
            approvalPath: finalClosure,
            supportPaths: existingPaths([finalClosure, runbook]),
            rollbackPath: finalClosure,
            allowedScope: 'Prepare and review the exact final activation and rollback sequence. RC_BASE_SHA is the canonical technical base; LAUNCH_SHA is its later reviewed descendant containing final legal/SEO inputs. Before this gate can pass it must harden the fulfillment-secrets runner, close Auth production redirects/admin-teacher access, catalog sync, active-state evidence, traffic gating, domain cutover and checkout close/open with resource-bound rollback. This queue performs no activation.',
            forbiddenScope: [
                'No checkout, signup, email, Cron, Queue, DNS, domain or Stripe Live activation from this command',
                'No Supabase rollout/Auth/availability replay and no Cloudflare bootstrap C-D-E replay',
                'Do not mark integration_readiness complete while any final write lacks lock/checkpoint, ambiguity reconciliation, exact target or rollback',
                'No secret values in generated evidence',
            ],
            finalBlockers: ['integration_readiness'],
        },
        {
            id: 'seo_llm_final',
            title: 'Final SEO/LLM and live-domain review',
            category: 'pending_gate',
            kind: 'read_only_reference',
            target: 'LAUNCH_SHA on espanolhonesto.com and www.espanolhonesto.com, including /ru rendering',
            status: 'must_wait',
            approvalPath: seoRunbook,
            supportPaths: existingPaths([seoRunbook, finalClosure]),
            rollbackPath: null,
            allowedScope: 'Review final copy, canonical/hreflang, JSON-LD, sitemap, robots, llms.txt, live-domain parity and the licensed Cyrillic typography decision after LAUNCH_SHA is fixed.',
            forbiddenScope: [
                'No Search Console token, analytics export, font invoice or unlicensed font file in evidence',
                'No DNS/domain write from this read-only review item',
            ],
            finalBlockers: ['seo_llm_final'],
            waitReason: 'Wait for final legal/copy inputs and the LAUNCH_SHA derived from RC_BASE_SHA.',
            prerequisiteItemIds: ['legal_owner_controller', 'legal_human_review', 'integration_readiness'],
        },
        {
            id: 'final_smoke',
            title: 'Minimal final production smoke',
            category: 'pending_gate',
            kind: 'external_write_approval',
            target: 'Final production domain and one separately approved owned live purchase at most',
            status: 'must_wait',
            approvalPath: latestGeneratedPath('launch-final-smoke-execution-pack', 'approval-request-final-smoke.md') ?? finalClosure,
            supportPaths: existingPaths([
                latestGeneratedPath('launch-final-smoke-execution-pack', 'production-minimal-smoke-checklist.md'),
                latestGeneratedPath('launch-final-smoke-execution-pack', 'rollback-and-cleanup-plan.md'),
                finalClosure,
            ]),
            rollbackPath: latestGeneratedPath('launch-final-smoke-execution-pack', 'rollback-and-cleanup-plan.md') ?? finalClosure,
            allowedScope: 'Run only the minimal manual production checklist against the exact LAUNCH_SHA after all other final gates close; any real payment requires its own exact approval.',
            forbiddenScope: [
                'No scripts/smoke/real-env-smoke.ts execution against production',
                'No broad provider writes, secret/private payload evidence or more than the separately approved owned purchase',
            ],
            finalBlockers: ['final_smoke'],
            waitReason: 'Last gate: wait for legal_owner_controller, legal_human_review, integration_readiness and seo_llm_final.',
            prerequisiteItemIds: [
                'legal_owner_controller',
                'legal_human_review',
                'integration_readiness',
                'seo_llm_final',
            ],
        },
    ];
}

function buildCriticalPath(queueItems: QueueItem[]): CriticalPathStep[] {
    const requireItem = (id: FinalGateId) => {
        if (!queueItems.some((item) => item.id === id && item.category === 'pending_gate')) {
            throw new Error(`Critical path references unknown final gate: ${id}`);
        }
        return id;
    };

    return [
        {
            id: 'final_legal_identity',
            title: 'Apply real legal owner/controller data',
            phase: 'Final inputs; checkout remains disabled',
            itemIds: [requireItem('legal_owner_controller')],
            prerequisites: ['RC_BASE_SHA is the canonical, clean and validated technical base', 'Alin supplies the real launch identity/controller values'],
            blocks: ['legal_owner_controller'],
            closeWhen: 'Example identity/controller values are replaced by the real public launch values without storing private documents.',
            stopIf: ['Any required legal value is unknown', 'The proposed evidence includes private identity or tax documents'],
        },
        {
            id: 'final_legal_review',
            title: 'Record human legal review',
            phase: 'After real legal inputs',
            itemIds: [requireItem('legal_human_review')],
            prerequisites: ['legal_owner_controller is closed', 'The exact public legal pages are frozen for review'],
            blocks: ['legal_human_review'],
            closeWhen: 'Human review records reviewer, date, scope and non-secret conclusion for the final public text.',
            stopIf: ['The reviewed text still contains placeholders', 'Review evidence would expose private legal advice'],
        },
        {
            id: 'final_integration_readiness',
            title: 'Freeze LAUNCH_SHA and the exact activation/rollback sequence',
            phase: 'Still inert; before activation',
            itemIds: [requireItem('integration_readiness')],
            prerequisites: ['LAUNCH_SHA is a clean reviewed descendant of RC_BASE_SHA', 'Final credentials and provider configuration can be verified without exposing values'],
            blocks: ['integration_readiness'],
            closeWhen: 'All final boundaries have exact resource-bound activation, verification, ambiguity-stop and rollback instructions tied to LAUNCH_SHA.',
            stopIf: ['Any step relies on replaying completed Supabase/Cloudflare/staging work', 'Checkout, signup, email, Cron, Queues, DNS, domains or Stripe Live would be activated by this queue'],
        },
        {
            id: 'final_seo_llm_review',
            title: 'Close final SEO/LLM review',
            phase: 'After LAUNCH_SHA and final public copy',
            itemIds: [requireItem('seo_llm_final')],
            prerequisites: ['legal_owner_controller and legal_human_review are closed', 'LAUNCH_SHA and final public URLs are known'],
            blocks: ['seo_llm_final'],
            closeWhen: 'Final technical SEO, LLM discovery, live-domain parity and Cyrillic typography evidence are recorded without secrets.',
            stopIf: ['The live page is not LAUNCH_SHA', 'Evidence would contain tokens, private analytics or unlicensed assets'],
        },
        {
            id: 'final_minimal_smoke',
            title: 'Run the minimal final production smoke',
            phase: 'Last launch-window gate',
            itemIds: [requireItem('final_smoke')],
            prerequisites: ['The other four final gates are closed', 'The exact host, LAUNCH_SHA, write scope and rollback are approved separately'],
            blocks: ['final_smoke'],
            closeWhen: 'The minimal production checklist and at most one separately approved owned purchase prove the final system without broad writes.',
            stopIf: ['The deployed build is not LAUNCH_SHA', 'The exact write approval or rollback posture is missing or ambiguous'],
        },
    ];
}

function createReport(reportChecks: Check[]): QueueReport {
    const hasFailedCheck = reportChecks.some((check) => check.status === 'failed');
    return {
        schemaVersion: 2,
        startedAt: startedAt.toISOString(),
        endedAt: new Date().toISOString(),
        status: hasFailedCheck ? 'FAILED' : 'WARNING',
        approvalQueueStatus: hasFailedCheck ? 'INVALID_QUEUE' : 'FIVE_FINAL_GATES_PENDING',
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
    const pending = queueItems.filter((item) => item.category === 'pending_gate');
    const missing = pending.flatMap((item) => [item.approvalPath, ...item.supportPaths, item.rollbackPath]
        .filter((candidate): candidate is string => Boolean(candidate))
        .filter((file) => !existsSync(file))
        .map((file) => `${item.id}:${toRelative(file)}`));
    const externalWithoutApproval = pending
        .filter((item) => item.kind === 'external_write_approval' && !item.approvalPath)
        .map((item) => `${item.id}:approvalPath`);
    const failures = [...externalWithoutApproval, ...missing];

    return {
        status: failures.length === 0 ? 'ok' : 'failed',
        name: 'pending_gate_artifacts_exist',
        message: failures.length === 0 ? 'Every pending final gate has its local review artifacts.' : 'A pending final gate is missing a local review artifact.',
        details: failures.length === 0 ? [`pending_gates=${pending.length}`] : failures,
    };
}

function validateFinalGateSet(queueItems: QueueItem[]): Check {
    const pendingIds = queueItems.filter((item) => item.category === 'pending_gate').map((item) => item.id).sort();
    const expectedIds = [...FINAL_GATE_IDS].sort();
    const duplicateIds = pendingIds.filter((id, index) => pendingIds.indexOf(id) !== index);
    const missing = expectedIds.filter((id) => !pendingIds.includes(id));
    const unexpected = pendingIds.filter((id) => !expectedIds.includes(id as FinalGateId));
    const invalidHistory = queueItems
        .filter((item) => item.category === 'completed_history')
        .filter((item) => item.status !== 'completed' || item.finalBlockers.length > 0)
        .map((item) => item.id);
    const valid = duplicateIds.length === 0 && missing.length === 0 && unexpected.length === 0 && invalidHistory.length === 0;

    return {
        status: valid ? 'ok' : 'failed',
        name: 'canonical_five_final_gates',
        message: valid ? 'Only the five agreed final gates remain pending; completed work is history-only.' : 'The pending gate set has drifted from the canonical five.',
        details: [
            `pending=${pendingIds.join('|')}`,
            `missing=${missing.join('|') || 'none'}`,
            `unexpected=${unexpected.join('|') || 'none'}`,
            `duplicates=${duplicateIds.join('|') || 'none'}`,
            `invalid_history=${invalidHistory.join('|') || 'none'}`,
        ],
    };
}

function validateGeneratedScope(queueItems: QueueItem[]): Check {
    const pending = queueItems.filter((item) => item.category === 'pending_gate');
    const missingForbidden = pending.filter((item) => item.forbiddenScope.length === 0).map((item) => item.id);
    const externalCount = pending.filter((item) => item.kind === 'external_write_approval').length;

    return {
        status: externalCount > 0 && missingForbidden.length === 0 ? 'warning' : 'failed',
        name: 'approval_boundary_posture',
        message: externalCount > 0 && missingForbidden.length === 0
            ? 'External-write final gates remain warning by design and every pending gate has explicit forbidden scope.'
            : 'The final gate queue is missing an approval boundary.',
        details: [`external_write_gates=${externalCount}`, `missing_forbidden_scope=${missingForbidden.join('|') || 'none'}`, 'this_file_is_not_permission'],
    };
}

function validateCriticalPath(queueItems: QueueItem[], steps: CriticalPathStep[]): Check {
    const pendingIds = new Set(queueItems.filter((item) => item.category === 'pending_gate').map((item) => item.id));
    const referenced = steps.flatMap((step) => step.itemIds);
    const unknown = referenced.filter((id) => !pendingIds.has(id));
    const missing = [...pendingIds].filter((id) => !referenced.includes(id));
    const duplicates = referenced.filter((id, index) => referenced.indexOf(id) !== index);
    const missingStops = steps.filter((step) => step.stopIf.length === 0).map((step) => step.id);
    const valid = unknown.length === 0 && missing.length === 0 && duplicates.length === 0 && missingStops.length === 0;

    return {
        status: valid ? 'ok' : 'failed',
        name: 'critical_path_dependency_coverage',
        message: valid ? 'The critical path covers each canonical final gate exactly once and includes stop rules.' : 'The critical path has missing, duplicate or unknown final gates.',
        details: [
            `steps=${steps.length}`,
            `unknown=${unknown.join('|') || 'none'}`,
            `missing=${missing.join('|') || 'none'}`,
            `duplicates=${duplicates.join('|') || 'none'}`,
            `steps_without_stop_rules=${missingStops.join('|') || 'none'}`,
        ],
    };
}

interface Rendered {
    queueMarkdown: string;
    manifest: string;
    nextActionCursor: string;
    executionBoard: string;
    summary: string;
}

function renderAll(queueReport: QueueReport): Rendered {
    const queueMarkdown = renderQueueMarkdown(queueReport);
    const nextActionCursor = renderNextActionCursor(queueReport);
    const executionBoard = renderExecutionBoard(queueReport);
    const manifest = `${JSON.stringify({
        schemaVersion: queueReport.schemaVersion,
        startedAt: queueReport.startedAt,
        endedAt: queueReport.endedAt,
        status: queueReport.status,
        approvalQueueStatus: queueReport.approvalQueueStatus,
        generatedBy: 'launch:final-approval-queue',
        localOnly: true,
        noExternalCalls: true,
        noSecretValuesStored: true,
        rcBaseShaMeaning: 'canonical technical release candidate integrated before final legal/SEO inputs',
        launchShaMeaning: 'reviewed descendant of RC_BASE_SHA containing final launch inputs',
        canonicalPendingGateIds: FINAL_GATE_IDS,
        queuePath: toRelative(queueReport.queuePath),
        summaryPath: toRelative(queueReport.summaryPath),
        nextActionPath: toRelative(queueReport.nextActionPath),
        executionBoardPath: toRelative(queueReport.executionBoardPath),
        criticalPath: queueReport.criticalPath,
        items: queueReport.items.map((item) => ({
            ...item,
            approvalPath: toRelativeOrNull(item.approvalPath),
            supportPaths: item.supportPaths.map(toRelative),
            rollbackPath: toRelativeOrNull(item.rollbackPath),
            files: filesForItem(item),
        })),
        checks: queueReport.checks,
    }, null, 2)}\n`;
    const summary = renderSummary(queueReport);
    return { queueMarkdown, manifest, nextActionCursor, executionBoard, summary };
}

function renderQueueMarkdown(queueReport: QueueReport): string {
    const pending = queueReport.items.filter((item) => item.category === 'pending_gate');
    const history = queueReport.items.filter((item) => item.category === 'completed_history');
    const lines = [
        '# Final Approval Queue',
        '',
        'Generated by `pnpm launch:final-approval-queue` from local launch artifacts.',
        '',
        ...safetyPreamble(),
        '',
        '## SHA Contract',
        '',
        '- `RC_BASE_SHA`: canonical, clean and validated technical base integrated before final legal/SEO values.',
        '- `LAUNCH_SHA`: later reviewed descendant of `RC_BASE_SHA` containing the final legal/SEO launch inputs.',
        '- No activation is authorized or performed by this queue.',
        '',
        '## Pending Final Gates',
        '',
        'Exactly these five gates remain pending.',
        '',
        '| Gate | Status | Wait Reason | Target | Review / Approval | Blocks |',
        '| --- | --- | --- | --- | --- | --- |',
        ...pending.map((item) => `| ${escapeCell(item.title)} | ${item.status} | ${escapeCell(item.waitReason ?? '-')} | ${escapeCell(item.target)} | ${escapeCell(toRelativeOrDash(item.approvalPath))} | ${item.finalBlockers.join(', ')} |`),
        '',
        '## Completed History — Do Not Reopen',
        '',
        '| Closure | Status | Target | Meaning |',
        '| --- | --- | --- | --- |',
        ...history.map((item) => `| ${escapeCell(item.title)} | ${item.status} | ${escapeCell(item.target)} | ${escapeCell(item.allowedScope)} |`),
        '',
        'A renewable evidence TTL may require a read-only reattestation immediately before an approved write. It never authorizes replaying Supabase rollout/Auth/availability, Cloudflare bootstrap C-D-E, Stripe test cutover, staging smoke or the rollback drill.',
        '',
        '## Critical Path',
        '',
        '| Step | Phase | Queue Items | Prerequisites | Blocks | Close When | Stop If |',
        '| --- | --- | --- | --- | --- | --- | --- |',
        ...queueReport.criticalPath.map((step) => `| ${escapeCell(step.title)} | ${escapeCell(step.phase)} | ${escapeCell(step.itemIds.join(', '))} | ${escapeCell(step.prerequisites.join('<br>'))} | ${step.blocks.join(', ')} | ${escapeCell(step.closeWhen)} | ${escapeCell(step.stopIf.join('<br>'))} |`),
        '',
        '## Pending Gate Boundaries',
        '',
    ];

    for (const item of pending) {
        lines.push(
            `### ${item.title}`,
            '',
            `- Target: ${item.target}`,
            `- Allowed scope: ${item.allowedScope}`,
            `- Approval/review path: ${toRelativeOrDash(item.approvalPath)}`,
            `- Rollback path: ${toRelativeOrDash(item.rollbackPath)}`,
            ...(item.waitReason ? [`- Wait reason: ${item.waitReason}`, `- Prerequisite items: ${(item.prerequisiteItemIds ?? []).join(', ') || '-'}`] : []),
            '- Forbidden scope:',
            ...item.forbiddenScope.map((scope) => `  - ${scope}`),
            '',
        );
    }

    lines.push(
        '## Checks',
        '',
        '| Status | Check | Message | Details |',
        '| --- | --- | --- | --- |',
        ...queueReport.checks.map((check) => `| ${check.status} | ${check.name} | ${escapeCell(check.message)} | ${escapeCell(check.details.join(' / '))} |`),
        '',
    );
    return `${lines.join('\n')}\n`;
}

function renderNextActionCursor(queueReport: QueueReport): string {
    return `${[
        '# Final Approval Next Action Cursor',
        '',
        'Generated by `pnpm launch:final-approval-queue` from local launch artifacts.',
        '',
        ...safetyPreamble(),
        '',
        '## Current Position',
        '',
        '- `RC_BASE_SHA` is the technical release candidate to integrate and preserve.',
        '- `LAUNCH_SHA` will be a reviewed descendant after real legal and final SEO inputs are applied.',
        '- Supabase production closure, Cloudflare production bootstrap C-D-E, Stripe test cutover, staging full smoke and the rollback drill are completed history. Do not reopen them.',
        '',
        '## Next Pending Gate',
        '',
        '- Gate: `legal_owner_controller`',
        '- Owner: Alin supplies the real public identity/controller values at the final window.',
        '- Until then: keep example values explicit, keep production inert and do not claim legal review is complete.',
        '',
        '## Remaining Order',
        '',
        '1. `legal_owner_controller`',
        '2. `legal_human_review`',
        '3. `integration_readiness` — freeze `LAUNCH_SHA` and exact activation/rollback instructions; this queue still performs no activation.',
        '4. `seo_llm_final`',
        '5. `final_smoke` — last gate, with its own exact approval.',
        '',
        '## Source Paths',
        '',
        `- Queue: ${toRelative(queueReport.queuePath)}`,
        `- Manifest: ${toRelative(queueReport.manifestPath)}`,
        `- Execution Board: ${toRelative(queueReport.executionBoardPath)}`,
        `- Summary: ${toRelative(queueReport.summaryPath)}`,
        '',
    ].join('\n')}\n`;
}

function renderExecutionBoard(queueReport: QueueReport): string {
    return `${[
        '# Final Window Execution Board',
        '',
        'Generated by `pnpm launch:final-approval-queue` from local launch artifacts.',
        '',
        ...safetyPreamble(),
        '',
        '## Safe Now: Local Only',
        '',
        '```bash',
        'pnpm launch:status',
        'pnpm launch:final-approval-queue',
        'pnpm typecheck',
        'pnpm secrets:check',
        'git diff --check',
        '```',
        '',
        '## Read-Only Refresh Before An Approved External Write',
        '',
        'Renew only the Cloudflare production GET readback and the Supabase production read-only DB/Auth attestation required by the current exact gate. A readback mismatch or unavailable result stops the sequence; it does not authorize a repair or replay.',
        '',
        '## Final Execution Modes',
        '',
        '| Step | Mode | Queue Items | Stop If |',
        '| --- | --- | --- | --- |',
        ...queueReport.criticalPath.map((step) => `| ${escapeCell(step.title)} | ${executionMode(step.id)} | ${step.itemIds.join(', ')} | ${escapeCell(step.stopIf.join('<br>'))} |`),
        '',
        '## Mode Legend',
        '',
        '- `human_input_required`: waits for Alin-owned real values or review.',
        '- `plan_only_no_activation`: prepares exact resource-bound steps but performs no provider write or activation.',
        '- `read_only_review`: records final public/live evidence without changing services.',
        '- `must_wait_for_exact_approval`: last-gate write-capable check; no execution without a separate exact approval.',
        '- `completed`: historical closure; do not reopen it because evidence TTL expired.',
        '',
    ].join('\n')}\n`;
}

function renderSummary(queueReport: QueueReport): string {
    const pending = queueReport.items.filter((item) => item.category === 'pending_gate');
    const history = queueReport.items.filter((item) => item.category === 'completed_history');
    return `${[
        '# Final Approval Queue Summary',
        '',
        `- Status: ${queueReport.status}`,
        `- Approval Queue Status: ${queueReport.approvalQueueStatus}`,
        `- Pending final gates: ${pending.length}`,
        `- Completed history entries: ${history.length}`,
        `- Pending IDs: ${pending.map((item) => item.id).join(', ')}`,
        `- Queue: ${toRelative(queueReport.queuePath)}`,
        `- Manifest: ${toRelative(queueReport.manifestPath)}`,
        `- Next Action Cursor: ${toRelative(queueReport.nextActionPath)}`,
        `- Execution Board: ${toRelative(queueReport.executionBoardPath)}`,
        '',
        ...safetyPreamble(),
        '',
        '## SHA Contract',
        '',
        '- RC_BASE_SHA = canonical technical base.',
        '- LAUNCH_SHA = reviewed descendant with final legal/SEO inputs.',
        '',
        '## Pending Final Gates',
        '',
        '| Gate | Status | Blocks |',
        '| --- | --- | --- |',
        ...pending.map((item) => `| ${item.id} | ${item.status} | ${item.finalBlockers.join(', ')} |`),
        '',
        '## Completed History',
        '',
        '| Closure | Status |',
        '| --- | --- |',
        ...history.map((item) => `| ${item.id} | ${item.status} |`),
        '',
    ].join('\n')}\n`;
}

function executionMode(stepId: string): string {
    switch (stepId) {
        case 'final_legal_identity':
        case 'final_legal_review':
            return 'human_input_required';
        case 'final_integration_readiness':
            return 'plan_only_no_activation';
        case 'final_seo_llm_review':
            return 'read_only_review';
        case 'final_minimal_smoke':
            return 'must_wait_for_exact_approval';
        default:
            return 'unknown';
    }
}

function safetyPreamble(): string[] {
    return [
        'This queue is not approval.',
        'No external services are called or changed by this command.',
        'No secret values are stored here.',
        'Use the linked approval request for the exact scope.',
        'Items marked `completed` are history-only and must not be reopened by evidence expiry.',
        'Items marked `must_wait` are blocked by prerequisites even when local artifacts exist.',
        'Items marked `requires_exact_approval` still need explicit resource/action approval before any write.',
        'Items marked `human_input_required` need human-owned final values or review.',
    ];
}

function validateGeneratedArtifactPosture(rendered: Rendered): Check {
    const combined = `${rendered.queueMarkdown}\n${rendered.manifest}\n${rendered.nextActionCursor}\n${rendered.executionBoard}\n${rendered.summary}`;
    const required = [
        'This queue is not approval.',
        'No external services are called or changed by this command.',
        'No secret values are stored here.',
        'Use the linked approval request for the exact scope.',
        'Items marked `completed` are history-only and must not be reopened by evidence expiry.',
        'RC_BASE_SHA',
        'LAUNCH_SHA',
        ...FINAL_GATE_IDS,
    ];
    const missing = required.filter((snippet) => !combined.includes(snippet));
    const secretLike = /(sk_live_|sk_test_|whsec_[A-Za-z0-9]{12,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|postgres(?:ql)?:\/\/[^@\s]+:[^@\s]+@)/.test(combined);

    return {
        status: missing.length === 0 && !secretLike ? 'ok' : 'failed',
        name: 'generated_artifact_secret_and_scope_posture',
        message: missing.length === 0 && !secretLike ? 'Generated queue artifacts preserve final-gate and secret-safety boundaries.' : 'Generated queue artifacts are missing safety text or contain a secret-like value.',
        details: [...missing.map((snippet) => `missing=${snippet}`), `secret_like=${secretLike}`],
    };
}

function filesForItem(item: QueueItem) {
    return [item.approvalPath, ...item.supportPaths, item.rollbackPath]
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

function existingGeneratedPaths(entries: Array<[string, string]>): string[] {
    return existingPaths(entries.map(([folder, file]) => latestGeneratedPath(folder, file)));
}

function existingPaths(values: Array<string | null>): string[] {
    return values.filter((value): value is string => Boolean(value) && existsSync(value));
}

function latestGeneratedPath(folderName: string, fileName: string): string | null {
    const root = path.join(process.cwd(), 'outputs', folderName);
    if (!existsSync(root)) return null;
    return readdirSync(root, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => path.join(root, entry.name, fileName))
        .filter((candidate) => existsSync(candidate))
        .sort()
        .reverse()[0] ?? null;
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
