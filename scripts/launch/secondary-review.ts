import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

interface PrimarySummary {
    status: string;
    outputDir: string;
    results: Array<{
        name: string;
        status: 'ok' | 'warning' | 'failed';
        message: string;
        details?: string[];
    }>;
}

interface Finding {
    status: 'ok' | 'warning' | 'failed';
    area: string;
    message: string;
    details?: string[];
}

interface SecondaryReviewReport {
    schemaVersion: 1;
    startedAt: string;
    endedAt: string;
    status: string;
    primaryEvidenceDir: string | null;
    findings: Finding[];
}

interface ChecklistItem {
    section: string;
    checked: boolean;
    line: string;
}

interface ManualEvidenceSummary {
    status: 'OK' | 'WARNING' | 'FAILED';
    outputDir: string;
    evidenceFile: string;
    manualEvidenceIndexPath?: string;
    nextActionsPath?: string;
    phaseOneWorksheetPath?: string;
    phaseOneClosurePackPath?: string;
    manualEvidencePhaseSummary?: unknown[];
    manualEvidenceByPhase?: Partial<Record<ManualEvidencePhase, unknown[]>>;
    findings: Finding[];
}

interface CleanupSummary {
    status: 'OK' | 'WARNING' | 'FAILED';
    agentToolingInventoryPath?: string;
    agentToolingDecisionWorksheetPath?: string;
}

interface ContentSummary {
    status: 'OK' | 'WARNING' | 'BLOCKED';
    contentReviewWorksheetPath?: string;
}

interface AccessibilitySummary {
    status: 'OK' | 'BLOCKED';
    accessibilityManualWorksheetPath?: string;
}

interface LegalSummary {
    status: 'OK' | 'WARNING' | 'FAILED';
    legalClosureWorksheetPath?: string;
}

interface SecuritySummary {
    status: 'OK' | 'WARNING' | 'FAILED';
    securityExternalWorksheetPath?: string;
}

interface PaymentsSummary {
    status: 'OK' | 'WARNING' | 'FAILED';
    paymentsStagingWorksheetPath?: string;
}

interface OperationsSummary {
    status: 'OK' | 'WARNING' | 'FAILED';
    operationsReadinessWorksheetPath?: string;
    databaseReadinessWorksheetPath?: string;
}

interface FinalReadinessSummary {
    status: 'OK' | 'WARNING' | 'FAILED';
    integrationReadinessWorksheetPath?: string;
    finalSmokeWorksheetPath?: string;
}

interface SeoSummary {
    status: 'OK' | 'WARNING' | 'FAILED';
    seoLlmWorksheetPath?: string;
}

interface StatusSummary {
    status: string;
    finalClosurePackPath?: string;
    sources: Array<{
        label: string;
        status: string;
        path: string | null;
    }>;
    currentEvidence?: Array<{
        label: string;
        status: string;
        path: string | null;
        role: string;
    }>;
    phaseOneFocus?: Array<{
        id?: string;
        status?: string;
        supportCommand?: string;
        evidenceMinimum?: string;
        nextStep?: string;
    }>;
    manualEvidencePhaseSummary?: unknown[];
    manualEvidenceByPhase?: Partial<Record<ManualEvidencePhase, unknown[]>>;
}

interface GateEvidenceIndex {
    primarySummaryPath?: string | null;
    phaseOneSummaryPath?: string | null;
    manualEvidenceSummaryPath?: string | null;
}

type ManualEvidencePhase = 'phase_1_now' | 'phase_2_release_candidate' | 'phase_3_final';

const requiredManualCheckIds = [
    'cleanup_agents_decision',
    'legal_owner_controller',
    'legal_human_review',
    'accessibility_manual',
    'security_external',
    'payments_staging',
    'operations_external',
    'content_review',
    'database_readiness',
    'integration_readiness',
    'seo_llm_final',
    'final_smoke',
];

const requiredPhaseOneManualCheckIds = [
    'cleanup_agents_decision',
    'accessibility_manual',
    'security_external',
    'operations_external',
    'content_review',
    'database_readiness',
];

const requiredManualEvidencePhaseHeadings = [
    'Fase 1: Ordenar Ahora',
    'Fase 2: Release Candidate',
    'Fase 3: Cierre Final',
];

const requiredManualEvidencePhases: ManualEvidencePhase[] = [
    'phase_1_now',
    'phase_2_release_candidate',
    'phase_3_final',
];

const startedAt = new Date();
const findings: Finding[] = [];
const gateEvidenceIndex = readGateEvidenceIndex(findings);
const latestPrimaryDir = findLatestPrimaryDir();

if (!latestPrimaryDir) {
    findings.push({
        status: 'failed',
        area: 'primary evidence',
        message: 'No launch verification summary found. Run pnpm launch:verify first.',
    });
} else {
    const summary = JSON.parse(readFileSync(path.join(latestPrimaryDir, 'summary.json'), 'utf8')) as PrimarySummary;
    reviewPrimarySummary(summary, findings);
}

reviewChecklist(findings);
reviewCleanupEvidence(findings);
reviewLegalEvidence(findings);
reviewContentEvidence(findings);
reviewAccessibilityEvidence(findings);
reviewSecurityEvidence(findings);
reviewPaymentsEvidence(findings);
reviewOperationsEvidence(findings);
reviewFinalReadinessEvidence(findings);
reviewSeoEvidence(findings);
reviewManualEvidenceAudit(findings);
reviewLaunchStatusDashboard(findings);

const failed = findings.filter((finding) => finding.status === 'failed');
const warnings = findings.filter((finding) => finding.status === 'warning');
const status = failed.length > 0
    ? 'BLOCKED'
    : warnings.length > 0
        ? 'READY_WITH_ACCEPTED_RISKS_REQUIRES_HUMAN_SIGNOFF'
        : 'READY_CANDIDATE_FOR_HUMAN_SIGNOFF';

const outputDir = path.join(process.cwd(), 'outputs', 'launch-secondary-review', stamp(startedAt));
mkdirSync(outputDir, { recursive: true });

const report: SecondaryReviewReport = {
    schemaVersion: 1,
    startedAt: startedAt.toISOString(),
    endedAt: new Date().toISOString(),
    status,
    primaryEvidenceDir: latestPrimaryDir,
    findings,
};

writeFileSync(path.join(outputDir, 'secondary-review.json'), JSON.stringify(report, null, 2), 'utf8');
writeFileSync(path.join(outputDir, 'secondary-review.md'), renderMarkdown(report), 'utf8');

console.log(`[launch:secondary-review] Status: ${status}`);
console.log(`[launch:secondary-review] Failed: ${failed.length}`);
console.log(`[launch:secondary-review] Warnings: ${warnings.length}`);
console.log(`[launch:secondary-review] Report: ${path.join(outputDir, 'secondary-review.md')}`);

if (failed.length > 0) process.exit(1);

function reviewPrimarySummary(summary: PrimarySummary, target: Finding[]): void {
    const failed = summary.results.filter((result) => result.status === 'failed');
    const warnings = summary.results.filter((result) => result.status === 'warning');

    target.push({
        status: failed.length === 0 ? 'ok' : 'failed',
        area: 'primary evidence',
        message: failed.length === 0
            ? 'Primary launch verification has no failed gates.'
            : 'Primary launch verification has failed gates.',
        details: failed.map((result) => `${result.name}: ${result.message}`),
    });

    target.push({
        status: warnings.length === 0 ? 'ok' : 'warning',
        area: 'primary warnings',
        message: warnings.length === 0
            ? 'Primary launch verification has no warnings.'
            : 'Primary launch verification has warnings requiring explicit review.',
        details: warnings.map((result) => `${result.name}: ${result.message}${result.details?.length ? ` (${result.details.join(', ')})` : ''}`),
    });

    target.push({
        status: summary.status === 'BLOCKED' ? 'failed' : 'ok',
        area: 'primary status',
        message: `Primary status is ${summary.status}.`,
        details: [summary.outputDir],
    });
}

function reviewChecklist(target: Finding[]): void {
    const checklistPath = path.join(process.cwd(), 'docs', 'launch', 'CHECKLIST.md');
    if (!existsSync(checklistPath)) {
        target.push({
            status: 'failed',
            area: 'launch checklist',
            message: 'docs/launch/CHECKLIST.md is missing.',
        });
        return;
    }

    const checklist = readFileSync(checklistPath, 'utf8');
    const blockers = sectionLines(checklist, '## Go/No-Go Blockers')
        .filter((line) => line.trim().startsWith('- [ ]'));
    const secondaryReviewOpen = sectionLines(checklist, '## Revision Secundaria')
        .filter((line) => line.trim().startsWith('- [ ]'));
    const items = parseChecklistItems(checklist);

    target.push({
        status: blockers.length === 0 ? 'ok' : 'failed',
        area: 'go/no-go blockers',
        message: blockers.length === 0
            ? 'No unchecked Go/No-Go blockers remain in CHECKLIST.md.'
            : 'Unchecked Go/No-Go blockers remain in CHECKLIST.md.',
        details: blockers.map((line) => line.trim()),
    });

    target.push({
        status: secondaryReviewOpen.length === 0 ? 'ok' : 'failed',
        area: 'secondary review checklist',
        message: secondaryReviewOpen.length === 0
            ? 'Secondary review checklist is complete.'
            : 'Secondary review checklist still has unchecked items.',
        details: secondaryReviewOpen.map((line) => line.trim()),
    });

    reviewLatestPrimaryReference(checklist, target);
    reviewLatestPhaseOneReference(checklist, target);
    reviewLatestManualEvidenceReference(checklist, target);
    reviewEvidencePaths(checklist, target);
    reviewCheckedEvidence(items, target);
    reviewDynamicGoNoGoEvidenceReferences(checklist, target);
    reviewLaunchGovernance(checklist, target);
}

function findLatestPrimaryDir(): string | null {
    const root = path.join(process.cwd(), 'outputs', 'launch-verification');
    if (!existsSync(root)) return null;

    const directories = readdirSync(root, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => path.join(root, entry.name))
        .filter((directory) => existsSync(path.join(directory, 'summary.json')))
        .sort((a, b) => b.localeCompare(a));

    return directories[0] ?? null;
}

function reviewManualEvidenceAudit(target: Finding[]): void {
    const latestManualEvidenceDir = findLatestEvidenceDir('launch-manual-evidence', 'summary.json');

    if (!latestManualEvidenceDir) {
        target.push({
            status: 'failed',
            area: 'manual launch evidence',
            message: 'No manual launch evidence audit found. Run pnpm launch:manual-evidence after filling docs/launch/MANUAL_EVIDENCE.local.json.',
        });
        return;
    }

    const summaryPath = path.join(latestManualEvidenceDir, 'summary.json');
    const summary = JSON.parse(readFileSync(summaryPath, 'utf8')) as ManualEvidenceSummary;
    const relevantFindings = summary.findings
        .filter((finding) => finding.status !== 'ok')
        .map((finding) => `${finding.area}: ${finding.message}${finding.details?.length ? ` (${finding.details.join(', ')})` : ''}`);

    target.push({
        status: summary.status === 'FAILED' ? 'failed' : summary.status === 'WARNING' ? 'warning' : 'ok',
        area: 'manual launch evidence',
        message: summary.status === 'OK'
            ? 'Manual launch evidence audit is OK.'
            : summary.status === 'WARNING'
                ? 'Manual launch evidence audit has accepted-risk warnings.'
                : 'Manual launch evidence audit failed.',
        details: [
            path.relative(process.cwd(), summaryPath).replace(/\\/g, '/'),
            `Evidence file: ${summary.evidenceFile}`,
            ...relevantFindings,
        ],
    });

    const nextActionsPath = summary.nextActionsPath;
    target.push({
        status: nextActionsPath && existsSync(nextActionsPath) ? 'ok' : 'failed',
        area: 'manual evidence next actions',
        message: nextActionsPath && existsSync(nextActionsPath)
            ? 'Manual launch evidence audit exposes an actionable next-actions.md file.'
            : 'Manual launch evidence audit is missing an actionable next-actions.md file.',
        details: nextActionsPath ? [toMarkdownPath(path.relative(process.cwd(), nextActionsPath))] : ['nextActionsPath is missing from summary.json'],
    });

    if (nextActionsPath && existsSync(nextActionsPath)) {
        reviewManualEvidencePhasePlan(summary, nextActionsPath, target);
    }

    reviewManualEvidenceSummaryPhaseCoverage(summary, target);
    reviewManualEvidenceIndex(summary.manualEvidenceIndexPath, target);
    reviewPhaseOneWorksheet(summary.phaseOneWorksheetPath, target);
    reviewPhaseOneClosurePack(summary.phaseOneClosurePackPath, target);
    reviewManualEvidencePrivacyScan(summary, target);
}

function reviewCleanupEvidence(target: Finding[]): void {
    const latestCleanupDir = findLatestEvidenceDir('launch-cleanup', 'summary.json');

    if (!latestCleanupDir) {
        target.push({
            status: 'failed',
            area: 'cleanup evidence',
            message: 'No launch cleanup audit found. Run pnpm launch:cleanup or pnpm launch:verify.',
        });
        return;
    }

    const summaryPath = path.join(latestCleanupDir, 'summary.json');
    const summary = JSON.parse(readFileSync(summaryPath, 'utf8')) as CleanupSummary;
    const inventoryPath = summary.agentToolingInventoryPath;
    const decisionWorksheetPath = summary.agentToolingDecisionWorksheetPath;
    const missing: string[] = [];

    if (summary.status !== 'OK') {
        missing.push(`launch cleanup status is ${summary.status}.`);
    }
    if (!inventoryPath || !existsSync(inventoryPath)) {
        missing.push('agentToolingInventoryPath is missing or does not exist.');
    } else {
        const inventory = readFileSync(inventoryPath, 'utf8');
        for (const snippet of [
            'Agent Tooling Inventory',
            '.agent/',
            '.agents/',
            'Decision Options',
            'cleanup_agents_decision',
        ]) {
            if (!inventory.includes(snippet)) {
                missing.push(`agent tooling inventory missing ${snippet}.`);
            }
        }
    }

    reviewWorksheetSnippets(
        decisionWorksheetPath,
        [
            'Agent Tooling Decision Worksheet',
            'cleanup_agents_decision',
            'Keep in repo',
            'Move outside repo',
            'Delete after backup',
            '.agent/',
            '.agents/',
            'Safe Evidence To Record',
            'Keep In Repo Snippet',
            'Move Outside Repo Snippet',
            'Delete After Backup Snippet',
            'Local Evidence Shape',
        ],
        'agent tooling decision worksheet',
        missing
    );

    target.push({
        status: missing.length === 0 ? 'ok' : 'failed',
        area: 'cleanup evidence',
        message: missing.length === 0
            ? 'Launch cleanup audit exposes a non-destructive agent tooling inventory and decision worksheet for the pending cleanup decision.'
            : 'Launch cleanup evidence is incomplete.',
        details: missing.length > 0
            ? [toMarkdownPath(path.relative(process.cwd(), summaryPath)), ...missing]
            : [
                toMarkdownPath(path.relative(process.cwd(), summaryPath)),
                inventoryPath ? toMarkdownPath(path.relative(process.cwd(), inventoryPath)) : '',
                decisionWorksheetPath ? toMarkdownPath(path.relative(process.cwd(), decisionWorksheetPath)) : '',
            ].filter(Boolean),
    });
}

function reviewLegalEvidence(target: Finding[]): void {
    const latestLegalDir = findLatestEvidenceDir('launch-legal', 'summary.json');

    if (!latestLegalDir) {
        target.push({
            status: 'failed',
            area: 'legal evidence',
            message: 'No launch legal audit found. Run pnpm launch:legal or pnpm launch:verify.',
        });
        return;
    }

    const summaryPath = path.join(latestLegalDir, 'summary.json');
    const summary = JSON.parse(readFileSync(summaryPath, 'utf8')) as LegalSummary;
    const missing: string[] = [];

    if (!['OK', 'WARNING', 'FAILED'].includes(summary.status)) {
        missing.push(`launch legal status is invalid: ${String(summary.status)}.`);
    }

    reviewWorksheetSnippets(
        summary.legalClosureWorksheetPath,
        [
            'Legal Closure Worksheet',
            'legal_owner_controller',
            'legal_human_review',
            'LEGAL_INPUTS_REQUIRED.md',
            'owner/controller placeholders',
            'Privacy',
            'Cookies',
            'Terms',
            'Subprocessors',
            'Risk acceptance',
        ],
        'legal closure worksheet',
        missing
    );

    target.push({
        status: missing.length === 0 ? 'ok' : 'failed',
        area: 'legal evidence',
        message: missing.length === 0
            ? 'Launch legal audit exposes a human worksheet for legal_owner_controller and legal_human_review.'
            : 'Launch legal evidence is incomplete.',
        details: missing.length > 0
            ? [toMarkdownPath(path.relative(process.cwd(), summaryPath)), ...missing]
            : [
                toMarkdownPath(path.relative(process.cwd(), summaryPath)),
                summary.legalClosureWorksheetPath
                    ? toMarkdownPath(path.relative(process.cwd(), summary.legalClosureWorksheetPath))
                    : '',
            ].filter(Boolean),
    });
}

function reviewContentEvidence(target: Finding[]): void {
    const latestContentDir = findLatestEvidenceDir('launch-content', 'summary.json');

    if (!latestContentDir) {
        target.push({
            status: 'failed',
            area: 'content evidence',
            message: 'No launch content audit found. Run pnpm launch:content or pnpm launch:verify.',
        });
        return;
    }

    const summaryPath = path.join(latestContentDir, 'summary.json');
    const summary = JSON.parse(readFileSync(summaryPath, 'utf8')) as ContentSummary;
    const worksheetPath = summary.contentReviewWorksheetPath;
    const missing: string[] = [];

    if (summary.status !== 'OK') {
        missing.push(`launch content status is ${summary.status}.`);
    }
    if (!worksheetPath || !existsSync(worksheetPath)) {
        missing.push('contentReviewWorksheetPath is missing or does not exist.');
    } else {
        const worksheet = readFileSync(worksheetPath, 'utf8');
        for (const snippet of [
            'Content Review Worksheet',
            'Public And Auth Routes',
            'Campus And Product Surfaces',
            'Transactional email previews',
            'content_review',
            '/es/',
            '/en/',
            '/ru/',
        ]) {
            if (!worksheet.includes(snippet)) {
                missing.push(`content review worksheet missing ${snippet}.`);
            }
        }
    }

    target.push({
        status: missing.length === 0 ? 'ok' : 'failed',
        area: 'content evidence',
        message: missing.length === 0
            ? 'Launch content audit exposes a human content review worksheet for ES/EN/RU copy, prices, emails and states.'
            : 'Launch content evidence is incomplete.',
        details: missing.length > 0
            ? [toMarkdownPath(path.relative(process.cwd(), summaryPath)), ...missing]
            : [
                toMarkdownPath(path.relative(process.cwd(), summaryPath)),
                worksheetPath ? toMarkdownPath(path.relative(process.cwd(), worksheetPath)) : '',
            ].filter(Boolean),
    });
}

function reviewAccessibilityEvidence(target: Finding[]): void {
    const latestAccessibilityDir = findLatestEvidenceDir('launch-accessibility', 'summary.json');

    if (!latestAccessibilityDir) {
        target.push({
            status: 'failed',
            area: 'accessibility evidence',
            message: 'No launch accessibility smoke found. Run pnpm launch:accessibility or pnpm launch:verify.',
        });
        return;
    }

    const summaryPath = path.join(latestAccessibilityDir, 'summary.json');
    const summary = JSON.parse(readFileSync(summaryPath, 'utf8')) as AccessibilitySummary;
    const worksheetPath = summary.accessibilityManualWorksheetPath;
    const missing: string[] = [];

    if (summary.status !== 'OK') {
        missing.push(`launch accessibility status is ${summary.status}.`);
    }
    if (!worksheetPath || !existsSync(worksheetPath)) {
        missing.push('accessibilityManualWorksheetPath is missing or does not exist.');
    } else {
        const worksheet = readFileSync(worksheetPath, 'utf8');
        for (const snippet of [
            'Accessibility Manual Worksheet',
            'Keyboard only',
            'Visible focus',
            'Screen reader',
            'Zoom 200%',
            'Mobile real device',
            'Forms and errors',
            'accessibility_manual',
        ]) {
            if (!worksheet.includes(snippet)) {
                missing.push(`accessibility manual worksheet missing ${snippet}.`);
            }
        }
    }

    target.push({
        status: missing.length === 0 ? 'ok' : 'failed',
        area: 'accessibility evidence',
        message: missing.length === 0
            ? 'Launch accessibility smoke exposes a manual accessibility worksheet for keyboard, focus, screen reader, zoom, mobile and forms.'
            : 'Launch accessibility evidence is incomplete.',
        details: missing.length > 0
            ? [toMarkdownPath(path.relative(process.cwd(), summaryPath)), ...missing]
            : [
                toMarkdownPath(path.relative(process.cwd(), summaryPath)),
                worksheetPath ? toMarkdownPath(path.relative(process.cwd(), worksheetPath)) : '',
            ].filter(Boolean),
    });
}

function reviewSecurityEvidence(target: Finding[]): void {
    const latestSecurityDir = findLatestEvidenceDir('launch-security', 'summary.json');

    if (!latestSecurityDir) {
        target.push({
            status: 'failed',
            area: 'security evidence',
            message: 'No launch security audit found. Run pnpm launch:security or pnpm launch:verify.',
        });
        return;
    }

    const summaryPath = path.join(latestSecurityDir, 'summary.json');
    const summary = JSON.parse(readFileSync(summaryPath, 'utf8')) as SecuritySummary;
    const missing: string[] = [];

    if (summary.status !== 'OK') {
        missing.push(`launch security status is ${summary.status}.`);
    }

    reviewWorksheetSnippets(
        summary.securityExternalWorksheetPath,
        [
            'Security External Worksheet',
            'security_external',
            'Supabase RLS',
            'service role',
            'key rotation',
            'third-party permissions',
            'Cloudflare Turnstile/WAF',
            'Stripe security',
            'logs and alerts',
            'incident response',
        ],
        'security external worksheet',
        missing
    );

    target.push({
        status: missing.length === 0 ? 'ok' : 'failed',
        area: 'security evidence',
        message: missing.length === 0
            ? 'Launch security audit exposes a human worksheet for security_external.'
            : 'Launch security evidence is incomplete.',
        details: missing.length > 0
            ? [toMarkdownPath(path.relative(process.cwd(), summaryPath)), ...missing]
            : [
                toMarkdownPath(path.relative(process.cwd(), summaryPath)),
                summary.securityExternalWorksheetPath
                    ? toMarkdownPath(path.relative(process.cwd(), summary.securityExternalWorksheetPath))
                    : '',
            ].filter(Boolean),
    });
}

function reviewPaymentsEvidence(target: Finding[]): void {
    const latestPaymentsDir = findLatestEvidenceDir('launch-payments', 'summary.json');

    if (!latestPaymentsDir) {
        target.push({
            status: 'failed',
            area: 'payments evidence',
            message: 'No launch payments audit found. Run pnpm launch:payments or pnpm launch:verify.',
        });
        return;
    }

    const summaryPath = path.join(latestPaymentsDir, 'summary.json');
    const summary = JSON.parse(readFileSync(summaryPath, 'utf8')) as PaymentsSummary;
    const missing: string[] = [];

    if (summary.status !== 'OK') {
        missing.push(`launch payments status is ${summary.status}.`);
    }

    reviewWorksheetSnippets(
        summary.paymentsStagingWorksheetPath,
        [
            'Payments Staging Worksheet',
            'payments_staging',
            'Stripe test mode',
            'checkout',
            'webhook delivery',
            'subscriptions',
            'payments',
            'portal',
            'reconciliation',
            'failure/rollback',
        ],
        'payments staging worksheet',
        missing
    );

    target.push({
        status: missing.length === 0 ? 'ok' : 'failed',
        area: 'payments evidence',
        message: missing.length === 0
            ? 'Launch payments audit exposes a human worksheet for payments_staging.'
            : 'Launch payments evidence is incomplete.',
        details: missing.length > 0
            ? [toMarkdownPath(path.relative(process.cwd(), summaryPath)), ...missing]
            : [
                toMarkdownPath(path.relative(process.cwd(), summaryPath)),
                summary.paymentsStagingWorksheetPath
                    ? toMarkdownPath(path.relative(process.cwd(), summary.paymentsStagingWorksheetPath))
                    : '',
            ].filter(Boolean),
    });
}

function reviewOperationsEvidence(target: Finding[]): void {
    const latestOperationsDir = findLatestEvidenceDir('launch-operations', 'summary.json');

    if (!latestOperationsDir) {
        target.push({
            status: 'failed',
            area: 'operations evidence',
            message: 'No launch operations audit found. Run pnpm launch:operations or pnpm launch:verify.',
        });
        return;
    }

    const summaryPath = path.join(latestOperationsDir, 'summary.json');
    const summary = JSON.parse(readFileSync(summaryPath, 'utf8')) as OperationsSummary;
    const missing: string[] = [];

    if (summary.status !== 'OK') {
        missing.push(`launch operations status is ${summary.status}.`);
    }

    reviewWorksheetSnippets(
        summary.operationsReadinessWorksheetPath,
        [
            'Operations Readiness Worksheet',
            'operations_external',
            'Cloudflare fulfillment Worker',
            'fulfillment_jobs',
            'Google',
            'Resend',
            'cron',
            'backups',
            'rollback',
        ],
        'operations readiness worksheet',
        missing
    );

    reviewWorksheetSnippets(
        summary.databaseReadinessWorksheetPath,
        [
            'Database Readiness Worksheet',
            'database_readiness',
            'db/schema.sql',
            'supabase/migrations',
            'RLS',
            'backups',
            'admin_audit_log',
            'fulfillment_jobs',
            'staging assignments',
            'subscriptions',
        ],
        'database readiness worksheet',
        missing
    );

    target.push({
        status: missing.length === 0 ? 'ok' : 'failed',
        area: 'operations evidence',
        message: missing.length === 0
            ? 'Launch operations audit exposes human worksheets for operations_external and database_readiness.'
            : 'Launch operations evidence is incomplete.',
        details: missing.length > 0
            ? [toMarkdownPath(path.relative(process.cwd(), summaryPath)), ...missing]
            : [
                toMarkdownPath(path.relative(process.cwd(), summaryPath)),
                summary.operationsReadinessWorksheetPath
                    ? toMarkdownPath(path.relative(process.cwd(), summary.operationsReadinessWorksheetPath))
                    : '',
                summary.databaseReadinessWorksheetPath
                    ? toMarkdownPath(path.relative(process.cwd(), summary.databaseReadinessWorksheetPath))
                    : '',
            ].filter(Boolean),
    });
}

function reviewFinalReadinessEvidence(target: Finding[]): void {
    const latestFinalReadinessDir = findLatestEvidenceDir('launch-final-readiness', 'summary.json');

    if (!latestFinalReadinessDir) {
        target.push({
            status: 'failed',
            area: 'final readiness evidence',
            message: 'No launch final readiness audit found. Run pnpm launch:final-readiness or pnpm launch:verify.',
        });
        return;
    }

    const summaryPath = path.join(latestFinalReadinessDir, 'summary.json');
    const summary = JSON.parse(readFileSync(summaryPath, 'utf8')) as FinalReadinessSummary;
    const missing: string[] = [];

    if (summary.status !== 'OK') {
        missing.push(`launch final readiness status is ${summary.status}.`);
    }

    reviewWorksheetSnippets(
        summary.integrationReadinessWorksheetPath,
        [
            'Integration Readiness Worksheet',
            'integration_readiness',
            'Stripe live',
            'Google Drive',
            'Google Calendar/Meet',
            'Resend',
            'Turnstile',
            'reminder worker',
            'CRON_SECRET',
            'PUBLIC_SITE_URL',
            'final key rotation',
        ],
        'integration readiness worksheet',
        missing
    );

    reviewWorksheetSnippets(
        summary.finalSmokeWorksheetPath,
        [
            'Final Smoke Worksheet',
            'final_smoke',
            'registration',
            'checkout',
            'webhook',
            'Drive',
            'email',
            'booking',
            'Doc',
            'Calendar/Meet',
            'reminder',
            'cancellation',
            'retry',
            'production smoke',
        ],
        'final smoke worksheet',
        missing
    );

    target.push({
        status: missing.length === 0 ? 'ok' : 'failed',
        area: 'final readiness evidence',
        message: missing.length === 0
            ? 'Launch final readiness audit exposes human worksheets for integration_readiness and final_smoke.'
            : 'Launch final readiness evidence is incomplete.',
        details: missing.length > 0
            ? [toMarkdownPath(path.relative(process.cwd(), summaryPath)), ...missing]
            : [
                toMarkdownPath(path.relative(process.cwd(), summaryPath)),
                summary.integrationReadinessWorksheetPath
                    ? toMarkdownPath(path.relative(process.cwd(), summary.integrationReadinessWorksheetPath))
                    : '',
                summary.finalSmokeWorksheetPath
                    ? toMarkdownPath(path.relative(process.cwd(), summary.finalSmokeWorksheetPath))
                    : '',
            ].filter(Boolean),
    });
}

function reviewSeoEvidence(target: Finding[]): void {
    const latestSeoDir = findLatestEvidenceDir('launch-seo', 'summary.json');

    if (!latestSeoDir) {
        target.push({
            status: 'failed',
            area: 'seo/llm evidence',
            message: 'No launch SEO/LLM audit found. Run pnpm launch:seo or pnpm launch:verify.',
        });
        return;
    }

    const summaryPath = path.join(latestSeoDir, 'summary.json');
    const summary = JSON.parse(readFileSync(summaryPath, 'utf8')) as SeoSummary;
    const missing: string[] = [];

    if (summary.status !== 'OK') {
        missing.push(`launch SEO/LLM status is ${summary.status}.`);
    }

    reviewWorksheetSnippets(
        summary.seoLlmWorksheetPath,
        [
            'SEO/LLM Final Worksheet',
            'Final Manual Checks',
            'robots and sitemap',
            'canonical/hreflang',
            'Search Console',
            'Core Web Vitals',
            'LLM discoverability',
            'private/demo/API',
        ],
        'SEO/LLM final worksheet',
        missing
    );

    target.push({
        status: missing.length === 0 ? 'ok' : 'failed',
        area: 'seo/llm evidence',
        message: missing.length === 0
            ? 'Launch SEO/LLM audit exposes a final worksheet for seo_llm_final.'
            : 'Launch SEO/LLM evidence is incomplete.',
        details: missing.length > 0
            ? [toMarkdownPath(path.relative(process.cwd(), summaryPath)), ...missing]
            : [
                toMarkdownPath(path.relative(process.cwd(), summaryPath)),
                summary.seoLlmWorksheetPath
                    ? toMarkdownPath(path.relative(process.cwd(), summary.seoLlmWorksheetPath))
                    : '',
            ].filter(Boolean),
    });
}

function reviewLaunchStatusDashboard(target: Finding[]): void {
    if (gateEvidenceIndex) {
        const statusScript = readIfExists(path.join('scripts', 'launch', 'status.ts'));
        const gateScript = readIfExists(path.join('scripts', 'launch', 'gate.ts'));
        const missing: string[] = [];

        if (!statusScript.includes("'launch-gate'") || !statusScript.includes('summarizeGateSource')) {
            missing.push('scripts/launch/status.ts must include latest launch-gate source coverage.');
        }
        if (!statusScript.includes("'launch-rc'")
            || !statusScript.includes('summarizeReleaseCandidateGateSource')
            || !statusScript.includes('Release Candidate Gate')) {
            missing.push('scripts/launch/status.ts must include latest release-candidate gate source and Current Evidence coverage.');
        }
        if (!statusScript.includes('manualEvidenceByPhase')
            || !statusScript.includes('manualEvidencePhaseSummary')
            || !statusScript.includes('Manual Evidence Phase Summary')
            || !statusScript.includes('Open Manual Evidence By Phase')
            || !statusScript.includes('phase_1_now')
            || !statusScript.includes('phase_3_final')
            || !statusScript.includes('Phase 1 Focus')
            || !statusScript.includes('buildPhaseOneFocus')
            || !statusScript.includes('Do not use legal real data, Stripe live, final API key rotation or production smoke')) {
            missing.push('scripts/launch/status.ts must expose open manual evidence, Phase 1 Focus and phase summary by launch phase.');
        }
        if (!statusScript.includes('finalClosurePackPath')
            || !statusScript.includes('renderFinalClosurePack')
            || !statusScript.includes('final-closure-pack.md')
            || !statusScript.includes('Final Closure Pack')) {
            missing.push('scripts/launch/status.ts must generate the final-closure-pack.md used for final Go/No-Go review.');
        }
        if (!gateScript.includes('writeGateReport(buildGateReport(null))') || !gateScript.includes("results.push(runStep('launch:status'))")) {
            missing.push('scripts/launch/gate.ts must write gate evidence before launch:status runs.');
        }

        target.push({
            status: missing.length === 0 ? 'ok' : 'failed',
            area: 'launch status dashboard',
            message: missing.length === 0
                ? 'Gate-mode secondary review confirms launch:status coverage before the dashboard step runs.'
                : 'Gate-mode secondary review cannot prove launch:status will include the current gate run.',
            details: missing.length > 0 ? missing : [`Gate evidence index: ${gateEvidenceIndexPathLabel()}`],
        });
        return;
    }

    const latestStatusDir = findLatestEvidenceDir('launch-status', 'summary.json');
    const latestGateDir = findLatestEvidenceDir('launch-gate', 'summary.json');

    if (!latestStatusDir) {
        target.push({
            status: 'failed',
            area: 'launch status dashboard',
            message: 'No launch status dashboard found. Run pnpm launch:status after pnpm launch:gate.',
        });
        return;
    }

    if (!latestGateDir) {
        target.push({
            status: 'failed',
            area: 'launch status dashboard',
            message: 'No launch gate summary found for the launch status dashboard to reference.',
        });
        return;
    }

    const summaryPath = path.join(latestStatusDir, 'summary.json');
    const summary = JSON.parse(readFileSync(summaryPath, 'utf8')) as StatusSummary;
    const markdownPath = path.join(latestStatusDir, 'summary.md');
    const markdown = readIfExists(markdownPath);
    const gateSource = summary.sources.find((source) => source.label === 'launch gate');
    const latestGateSummary = toMarkdownPath(path.relative(process.cwd(), path.join(latestGateDir, 'summary.json')));
    const gateSourcePath = gateSource?.path ? normalizeEvidencePath(gateSource.path) : '';
    const details = [
        `Status summary: ${toMarkdownPath(path.relative(process.cwd(), summaryPath))}`,
        `Latest gate summary: ${latestGateSummary}`,
        gateSource ? `Gate source status: ${gateSource.status}` : 'Gate source: missing',
        gateSource ? `Gate source path: ${gateSourcePath}` : '',
    ].filter(Boolean);

    const hasLatestGate = gateSourcePath === normalizeEvidencePath(latestGateSummary);
    const gateSourceIsStale = Boolean(gateSource?.status.startsWith('STALE:'));
    const statusIncludesGateState = Boolean(gateSource?.status.startsWith(summary.status) || gateSourceIsStale);

    target.push({
        status: gateSource && hasLatestGate && statusIncludesGateState ? 'ok' : 'failed',
        area: 'launch status dashboard',
        message: gateSource && hasLatestGate && statusIncludesGateState
            ? gateSourceIsStale
                ? 'Latest launch status dashboard includes the latest launch:gate run as an explicit stale source.'
                : 'Latest launch status dashboard includes the latest launch:gate run as an explicit source.'
            : 'Latest launch status dashboard does not prove the latest launch:gate run is included.',
        details,
    });

    reviewLaunchStatusPhaseCoverage(summary, markdown, markdownPath, target);
    reviewLaunchStatusCurrentEvidence(summary, markdown, markdownPath, target);
    reviewLaunchStatusFinalClosurePack(summary, markdown, markdownPath, target);
}

function reviewWorksheetSnippets(
    worksheetPath: string | undefined,
    snippets: string[],
    label: string,
    target: string[]
): void {
    if (!worksheetPath || !existsSync(worksheetPath)) {
        target.push(`${label} path is missing or does not exist.`);
        return;
    }

    const worksheet = readFileSync(worksheetPath, 'utf8');
    for (const snippet of snippets) {
        if (!worksheet.includes(snippet)) {
            target.push(`${label} missing ${snippet}.`);
        }
    }
}

function reviewManualEvidencePhasePlan(summary: ManualEvidenceSummary, nextActionsPath: string, target: Finding[]): void {
    const nextActions = readFileSync(nextActionsPath, 'utf8');
    const openManualCheckIds = openManualCheckIdsFromSummary(summary);
    const requiredOpenPhaseHeadings = requiredManualEvidencePhases
        .filter((phase) => openManualCheckIdsForPhase(summary, phase).length > 0)
        .map((phase) => phaseHeadingFor(phase));
    const missing = summary.status === 'OK'
        ? ['No manual evidence blockers'].filter((snippet) => !nextActions.includes(snippet))
        : [
            ...[
                'Blocking Checks By Phase',
                ...requiredOpenPhaseHeadings,
            ].filter((snippet) => !nextActions.includes(snippet)),
            ...openManualCheckIds.filter((id) => !nextActions.includes(id)),
        ];

    target.push({
        status: missing.length === 0 ? 'ok' : 'failed',
        area: 'phase-aware manual evidence plan',
        message: missing.length === 0
            ? summary.status === 'OK'
                ? 'Manual evidence next-actions.md confirms no manual blockers remain.'
                : 'Manual evidence next-actions.md groups every required open check by launch phase.'
            : 'Manual evidence next-actions.md does not match the current manual evidence status.',
        details: missing.length > 0
            ? missing
            : [toMarkdownPath(path.relative(process.cwd(), nextActionsPath))],
    });
}

function openManualCheckIdsForPhase(summary: ManualEvidenceSummary, phase: ManualEvidencePhase): string[] {
    const checks = summary.manualEvidenceByPhase?.[phase];
    if (!Array.isArray(checks)) return [];

    return checks
        .filter((item): item is { id: string } => Boolean(item) && typeof item === 'object' && 'id' in item && typeof item.id === 'string')
        .map((item) => item.id);
}

function phaseHeadingFor(phase: ManualEvidencePhase): string {
    switch (phase) {
        case 'phase_1_now':
            return 'Fase 1: Ordenar Ahora';
        case 'phase_2_release_candidate':
            return 'Fase 2: Release Candidate';
        case 'phase_3_final':
            return 'Fase 3: Cierre Final';
        default:
            return phase;
    }
}

function openManualCheckIdsFromSummary(summary: ManualEvidenceSummary): string[] {
    const ids = new Set<string>();
    const grouped = summary.manualEvidenceByPhase ?? {};

    for (const checks of Object.values(grouped)) {
        if (!Array.isArray(checks)) continue;
        for (const item of checks) {
            if (item && typeof item === 'object' && 'id' in item && typeof item.id === 'string') {
                ids.add(item.id);
            }
        }
    }

    if (ids.size > 0) return Array.from(ids);

    return requiredManualCheckIds.filter((id) => {
        return summary.findings.some((finding) => {
            const haystack = [finding.message, ...(finding.details ?? [])].join(' ');
            return finding.status === 'failed' && haystack.includes(id);
        });
    });
}

function reviewManualEvidenceSummaryPhaseCoverage(summary: ManualEvidenceSummary, target: Finding[]): void {
    const grouped = summary.manualEvidenceByPhase ?? {};
    const phaseSummary = summary.manualEvidencePhaseSummary ?? [];
    const missing: string[] = [];

    if (!Array.isArray(phaseSummary) || phaseSummary.length < requiredManualEvidencePhases.length) {
        missing.push('summary.json missing manualEvidencePhaseSummary for all required phases');
    }
    for (const phase of requiredManualEvidencePhases) {
        if (!Array.isArray(grouped[phase])) {
            missing.push(`summary.json missing manualEvidenceByPhase.${phase}`);
        }
    }

    if (summary.status !== 'OK') {
        const presentCheckIds = new Set<string>();
        for (const checks of Object.values(grouped)) {
            if (!Array.isArray(checks)) continue;
            for (const item of checks) {
                if (item && typeof item === 'object' && 'id' in item && typeof item.id === 'string') {
                    presentCheckIds.add(item.id);
                }
            }
        }
        for (const id of expectedOpenManualCheckIds(summary)) {
            if (!presentCheckIds.has(id)) {
                missing.push(`summary.json manualEvidenceByPhase missing open check ${id}`);
            }
        }
    }

    target.push({
        status: missing.length === 0 ? 'ok' : 'failed',
        area: 'manual evidence summary phase coverage',
        message: missing.length === 0
            ? 'Manual launch evidence summary exposes structured open checks by phase.'
            : 'Manual launch evidence summary is missing structured phase coverage.',
        details: missing,
    });
}

function expectedOpenManualCheckIds(summary: ManualEvidenceSummary): string[] {
    const expected = new Set<string>();
    for (const finding of summary.findings) {
        if (finding.status === 'ok') continue;

        const haystack = [
            finding.message,
            ...(finding.details ?? []),
        ].join(' ');

        for (const id of requiredManualCheckIds) {
            if (haystack.includes(id)) expected.add(id);
        }
    }

    return Array.from(expected).sort();
}

function reviewManualEvidenceIndex(manualEvidenceIndexPath: string | undefined, target: Finding[]): void {
    if (!manualEvidenceIndexPath || !existsSync(manualEvidenceIndexPath)) {
        target.push({
            status: 'failed',
            area: 'manual evidence index',
            message: 'Manual launch evidence audit is missing a manual-evidence-index.md file.',
            details: manualEvidenceIndexPath
                ? [toMarkdownPath(path.relative(process.cwd(), manualEvidenceIndexPath))]
                : ['manualEvidenceIndexPath is missing from summary.json'],
        });
        return;
    }

    const index = readFileSync(manualEvidenceIndexPath, 'utf8');
    const missing = [
        ...[
            'Manual Evidence Index',
            'How To Use',
            'Command',
            'Worksheet',
            'Evidence Minimum',
            ...requiredManualEvidencePhaseHeadings,
        ].filter((snippet) => !index.includes(snippet)),
        ...requiredManualCheckIds.filter((id) => !index.includes(id)),
    ];

    target.push({
        status: missing.length === 0 ? 'ok' : 'failed',
        area: 'manual evidence index',
        message: missing.length === 0
            ? 'Manual launch evidence audit exposes a generated index mapping each required check to its phase, command, worksheet and evidence minimum.'
            : 'Manual launch evidence index is incomplete.',
        details: missing.length > 0
            ? missing
            : [toMarkdownPath(path.relative(process.cwd(), manualEvidenceIndexPath))],
    });
}

function reviewPhaseOneWorksheet(phaseOneWorksheetPath: string | undefined, target: Finding[]): void {
    if (!phaseOneWorksheetPath || !existsSync(phaseOneWorksheetPath)) {
        target.push({
            status: 'failed',
            area: 'phase 1 manual evidence worksheet',
            message: 'Manual launch evidence audit is missing a phase-1-worksheet.md file.',
            details: phaseOneWorksheetPath
                ? [toMarkdownPath(path.relative(process.cwd(), phaseOneWorksheetPath))]
                : ['phaseOneWorksheetPath is missing from summary.json'],
        });
        return;
    }

    const worksheet = readFileSync(phaseOneWorksheetPath, 'utf8');
    const missing = [
        ...['Phase 1 Manual Evidence Worksheet', 'Fase 1: Ordenar Ahora'].filter((snippet) => !worksheet.includes(snippet)),
        ...requiredPhaseOneManualCheckIds.filter((id) => !worksheet.includes(id)),
    ];

    target.push({
        status: missing.length === 0 ? 'ok' : 'failed',
        area: 'phase 1 manual evidence worksheet',
        message: missing.length === 0
            ? 'Manual launch evidence audit exposes an actionable Phase 1 worksheet.'
            : 'Manual launch evidence Phase 1 worksheet is incomplete.',
        details: missing.length > 0
            ? missing
            : [toMarkdownPath(path.relative(process.cwd(), phaseOneWorksheetPath))],
    });
}

function reviewPhaseOneClosurePack(phaseOneClosurePackPath: string | undefined, target: Finding[]): void {
    if (!phaseOneClosurePackPath || !existsSync(phaseOneClosurePackPath)) {
        target.push({
            status: 'failed',
            area: 'phase 1 closure pack',
            message: 'Manual launch evidence audit is missing a phase-1-closure-pack.md file.',
            details: phaseOneClosurePackPath
                ? [toMarkdownPath(path.relative(process.cwd(), phaseOneClosurePackPath))]
                : ['phaseOneClosurePackPath is missing from summary.json'],
        });
        return;
    }

    const closurePack = readFileSync(phaseOneClosurePackPath, 'utf8');
    const missing = [
        ...[
            'Phase 1 Closure Pack',
            'Close Phase 1 In This Order',
            'Evidence JSON Snippets',
            'Safety Rules',
            'Verification After Editing Local Evidence',
            'pnpm launch:manual-evidence',
            'pnpm launch:secondary-review',
            'pnpm launch:status',
        ].filter((snippet) => !closurePack.includes(snippet)),
        ...requiredPhaseOneManualCheckIds.filter((id) => !closurePack.includes(id)),
    ];

    target.push({
        status: missing.length === 0 ? 'ok' : 'failed',
        area: 'phase 1 closure pack',
        message: missing.length === 0
            ? 'Manual launch evidence audit exposes a generated Phase 1 closure pack with safe JSON snippets and verification commands.'
            : 'Manual launch evidence Phase 1 closure pack is incomplete.',
        details: missing.length > 0
            ? missing
            : [toMarkdownPath(path.relative(process.cwd(), phaseOneClosurePackPath))],
    });
}

function reviewManualEvidencePrivacyScan(summary: ManualEvidenceSummary, target: Finding[]): void {
    const privacyScan = summary.findings.find((finding) => finding.area === 'manual evidence secret and placeholder scan');

    target.push({
        status: privacyScan?.status === 'ok' ? 'ok' : 'failed',
        area: 'manual evidence privacy scan',
        message: privacyScan?.status === 'ok'
            ? 'Manual launch evidence privacy scan is present and OK.'
            : 'Manual launch evidence privacy scan is missing or failed.',
        details: privacyScan
            ? [privacyScan.message, ...(privacyScan.details ?? [])]
            : ['Expected finding area: manual evidence secret and placeholder scan'],
    });
}

function reviewLaunchStatusPhaseCoverage(
    summary: StatusSummary,
    markdown: string,
    markdownPath: string,
    target: Finding[]
): void {
    const grouped = summary.manualEvidenceByPhase ?? {};
    const phaseSummary = summary.manualEvidencePhaseSummary ?? [];
    const missing: string[] = [];

    if (!Array.isArray(phaseSummary) || phaseSummary.length < requiredManualEvidencePhases.length) {
        missing.push('summary.json missing manualEvidencePhaseSummary for all required phases');
    }
    for (const phase of requiredManualEvidencePhases) {
        if (!Array.isArray(grouped[phase])) {
            missing.push(`summary.json missing manualEvidenceByPhase.${phase}`);
        }
    }
    if (!markdown.includes('Manual Evidence Phase Summary')) {
        missing.push('summary.md missing Manual Evidence Phase Summary section');
    }
    if (!markdown.includes('Open Manual Evidence By Phase')) {
        missing.push('summary.md missing Open Manual Evidence By Phase section');
    }
    if (!Array.isArray(summary.phaseOneFocus)) {
        missing.push('summary.json missing phaseOneFocus array');
    }
    if (!markdown.includes('## Phase 1 Focus')) {
        missing.push('summary.md missing Phase 1 Focus section');
    }
    if (!markdown.includes('Do not use legal real data, Stripe live, final API key rotation or production smoke')) {
        missing.push('summary.md missing Phase 1 final-only guardrail');
    }
    if (!markdown.includes('pnpm launch:phase1')) {
        missing.push('summary.md missing Phase 1 verification command');
    }
    for (const heading of requiredManualEvidencePhaseHeadings) {
        if (!markdown.includes(heading)) {
            missing.push(`summary.md missing ${heading}`);
        }
    }

    const phaseOneFocus = Array.isArray(summary.phaseOneFocus) ? summary.phaseOneFocus : [];
    for (const id of requiredPhaseOneManualCheckIds) {
        const item = phaseOneFocus.find((candidate) => candidate.id === id);
        if (!item) {
            missing.push(`phaseOneFocus missing ${id}`);
            continue;
        }
        if (!item.supportCommand) {
            missing.push(`phaseOneFocus.${id} missing supportCommand`);
        }
        if (!item.evidenceMinimum) {
            missing.push(`phaseOneFocus.${id} missing evidenceMinimum`);
        }
        if (!item.nextStep) {
            missing.push(`phaseOneFocus.${id} missing nextStep`);
        }
        if (!markdown.includes(id)) {
            missing.push(`summary.md missing Phase 1 Focus row ${id}`);
        }
    }

    const presentCheckIds = new Set<string>();
    for (const items of Object.values(grouped)) {
        if (!Array.isArray(items)) continue;
        for (const item of items) {
            if (item && typeof item === 'object' && 'id' in item && typeof item.id === 'string') {
                presentCheckIds.add(item.id);
            }
        }
    }
    for (const id of requiredManualCheckIds) {
        if (!presentCheckIds.has(id) && !markdown.includes(id)) {
            missing.push(`launch status missing manual check ${id}`);
        }
    }

    target.push({
        status: missing.length === 0 ? 'ok' : 'failed',
        area: 'phase-aware launch status dashboard',
        message: missing.length === 0
            ? 'Launch status dashboard exposes open manual evidence by phase.'
            : 'Launch status dashboard does not fully expose phase-aware manual evidence.',
        details: missing.length > 0
            ? missing
            : [toMarkdownPath(path.relative(process.cwd(), markdownPath))],
    });
}

function reviewLaunchStatusCurrentEvidence(
    summary: StatusSummary,
    markdown: string,
    markdownPath: string,
    target: Finding[]
): void {
    const requiredLabels = [
        'Primary Verification',
        'Phase 1 Readiness',
        'Manual Evidence Audit',
        'Secondary Review',
        'Legal Audit',
        'Release Candidate Gate',
        'Full Launch Gate',
        'Final Closure Pack',
    ];
    const currentEvidence = Array.isArray(summary.currentEvidence) ? summary.currentEvidence : [];
    const missing: string[] = [];

    if (!Array.isArray(summary.currentEvidence)) {
        missing.push('summary.json missing currentEvidence array');
    }
    if (!markdown.includes('## Current Evidence')) {
        missing.push('summary.md missing Current Evidence section');
    }
    if (!markdown.includes('freshness source for this dashboard')) {
        missing.push('summary.md missing Current Evidence freshness rule text');
    }

    for (const label of requiredLabels) {
        const item = currentEvidence.find((evidence) => evidence.label === label);
        if (!item) {
            missing.push(`currentEvidence missing ${label}`);
            continue;
        }
        if (!item.status) {
            missing.push(`currentEvidence.${label} missing status`);
        }
        if (!item.role) {
            missing.push(`currentEvidence.${label} missing role`);
        }
        if (!item.path && label === 'Release Candidate Gate' && item.status === 'missing') {
            continue;
        }
        if (!item.path) {
            missing.push(`currentEvidence.${label} missing path`);
        } else if (!existsSync(path.resolve(process.cwd(), item.path))) {
            missing.push(`currentEvidence.${label} path does not exist: ${toMarkdownPath(item.path)}`);
        }
        if (!markdown.includes(label)) {
            missing.push(`summary.md missing Current Evidence row ${label}`);
        }
    }

    target.push({
        status: missing.length === 0 ? 'ok' : 'failed',
        area: 'launch status current evidence',
        message: missing.length === 0
            ? 'Launch status dashboard exposes current evidence rows for freshness and review.'
            : 'Launch status dashboard does not fully expose current evidence rows.',
        details: missing.length > 0
            ? missing
            : [toMarkdownPath(path.relative(process.cwd(), markdownPath))],
    });
}

function reviewLaunchStatusFinalClosurePack(
    summary: StatusSummary,
    markdown: string,
    markdownPath: string,
    target: Finding[]
): void {
    const source = summary.sources.find((item) => item.label === 'final closure pack');
    const packPath = summary.finalClosurePackPath ?? source?.path ?? '';
    const missing: string[] = [];

    if (!summary.finalClosurePackPath) {
        missing.push('summary.json missing finalClosurePackPath');
    }
    if (!source) {
        missing.push('summary.json sources missing final closure pack');
    } else {
        if (source.status !== 'generated') {
            missing.push(`final closure pack source status is ${source.status}`);
        }
        if (!source.path) {
            missing.push('final closure pack source path is missing');
        }
    }
    if (!markdown.includes('Final Closure Pack')) {
        missing.push('summary.md missing Final Closure Pack reference');
    }
    if (!markdown.includes('final-closure-pack.md')) {
        missing.push('summary.md missing final-closure-pack.md path');
    }
    for (const snippet of [
        'Open Go/No-Go Breakdown',
        'command-level rows are derived blockers',
        'Final evidence checks',
        'Checklist command rows',
    ]) {
        if (!markdown.includes(snippet)) {
            missing.push(`summary.md missing ${snippet}`);
        }
    }

    const resolvedPackPath = packPath ? path.resolve(process.cwd(), packPath) : '';
    if (!packPath) {
        missing.push('final closure pack path is missing');
    } else if (!existsSync(resolvedPackPath)) {
        missing.push(`final closure pack path does not exist: ${toMarkdownPath(packPath)}`);
    } else {
        const pack = readFileSync(resolvedPackPath, 'utf8');
        for (const snippet of [
            '# Final Closure Pack',
            'Current Gate Snapshot',
            'Final-Only Checks',
            'Record Final Evidence',
            'pnpm launch:manual-evidence:record',
            'Accepted-risk dry run',
            '--status accepted_risk',
            '--risk-accepted-by',
            'Accepted-risk command: not generated for this check.',
            'Responsibilities And Cadence',
            'T-48h',
            'T-24h',
            'T-12h',
            'T-6h',
            'T-3h',
            'T-1h',
            'T-0',
            'Alin/Codex',
            'Ordered Closure',
            'Final Commands',
            'Evidence Safety',
            'docs/launch/MANUAL_EVIDENCE.local.json',
            'pnpm launch:gate',
            'pnpm launch:status',
        ]) {
            if (!pack.includes(snippet)) {
                missing.push(`final closure pack missing ${snippet}`);
            }
        }

        const finalChecks = summary.manualEvidenceByPhase?.phase_3_final;
        if (Array.isArray(finalChecks)) {
            for (const check of finalChecks) {
                if (check && typeof check === 'object' && 'id' in check && typeof check.id === 'string' && !pack.includes(check.id)) {
                    missing.push(`final closure pack missing final-only check ${check.id}`);
                }
            }
        } else {
            missing.push('summary.json missing manualEvidenceByPhase.phase_3_final for final closure pack cross-check');
        }
    }

    target.push({
        status: missing.length === 0 ? 'ok' : 'failed',
        area: 'launch status final closure pack',
        message: missing.length === 0
            ? 'Launch status dashboard exposes a generated final closure pack for final-only blockers.'
            : 'Launch status dashboard does not fully expose the generated final closure pack.',
        details: missing.length > 0
            ? missing
            : [toMarkdownPath(path.relative(process.cwd(), markdownPath)), toMarkdownPath(path.relative(process.cwd(), resolvedPackPath))],
    });
}

function findLatestEvidenceDir(folderName: string, summaryFileName: string): string | null {
    const root = path.join(process.cwd(), 'outputs', folderName);
    if (!existsSync(root)) return null;

    const directories = readdirSync(root, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => path.join(root, entry.name))
        .filter((directory) => existsSync(path.join(directory, summaryFileName)))
        .sort((a, b) => b.localeCompare(a));

    return directories[0] ?? null;
}

function sectionLines(markdown: string, heading: string): string[] {
    const lines = markdown.split(/\r?\n/);
    const start = lines.findIndex((line) => line.trim() === heading);
    if (start < 0) return [];

    const result: string[] = [];
    for (let index = start + 1; index < lines.length; index += 1) {
        const line = lines[index];
        if (line.startsWith('## ') && line.trim() !== heading) break;
        result.push(line);
    }

    return result;
}

function parseChecklistItems(markdown: string): ChecklistItem[] {
    const items: ChecklistItem[] = [];
    let currentSection = '';

    for (const line of markdown.split(/\r?\n/)) {
        const heading = line.match(/^##\s+(.+)$/);
        if (heading) {
            currentSection = heading[1].trim();
            continue;
        }

        const item = line.match(/^\s*-\s+\[( |x|X)\]\s+(.+)$/);
        if (item) {
            items.push({
                section: currentSection || 'root',
                checked: item[1].toLowerCase() === 'x',
                line: line.trim(),
            });
        }
    }

    return items;
}

function reviewLatestPrimaryReference(checklist: string, target: Finding[]): void {
    if (!latestPrimaryDir) return;

    const latestSummary = toMarkdownPath(path.relative(process.cwd(), path.join(latestPrimaryDir, 'summary.md')));
    const checklistHasLatest = checklist.includes(latestSummary);
    const gateIndexHasLatest = evidenceIndexReferences('primarySummaryPath', latestSummary);
    const statusDashboardHasLatest = statusDashboardReferences('primary verification', latestSummary);
    target.push({
        status: checklistHasLatest || gateIndexHasLatest || statusDashboardHasLatest ? 'ok' : 'warning',
        area: 'checklist evidence freshness',
        message: checklistHasLatest
            ? 'CHECKLIST.md references the latest primary launch verification evidence.'
            : gateIndexHasLatest
                ? 'Gate evidence index references the latest primary launch verification evidence.'
                : statusDashboardHasLatest
                    ? 'Launch status dashboard references the latest primary launch verification evidence.'
                    : 'No current checklist, gate evidence index or launch status dashboard references the latest primary launch verification summary.',
        details: gateEvidenceIndex
            ? [latestSummary, `Gate evidence index: ${gateEvidenceIndexPathLabel()}`]
            : [latestSummary, `Launch status dashboard: ${latestStatusSummaryPathLabel()}`],
    });
}

function reviewLatestPhaseOneReference(checklist: string, target: Finding[]): void {
    const latestPhaseOneDir = findLatestEvidenceDir('launch-phase-1', 'summary.json');
    if (!latestPhaseOneDir) return;

    const latestSummary = toMarkdownPath(path.relative(process.cwd(), path.join(latestPhaseOneDir, 'summary.md')));
    const checklistHasLatest = checklist.includes(latestSummary);
    const gateIndexHasLatest = evidenceIndexReferences('phaseOneSummaryPath', latestSummary);
    const statusDashboardHasLatest = statusDashboardReferences('phase 1 gate', latestSummary);
    target.push({
        status: checklistHasLatest || gateIndexHasLatest || statusDashboardHasLatest ? 'ok' : 'warning',
        area: 'phase 1 evidence freshness',
        message: checklistHasLatest
            ? 'CHECKLIST.md references the latest Phase 1 launch readiness evidence.'
            : gateIndexHasLatest
                ? 'Gate evidence index references the latest Phase 1 launch readiness evidence.'
                : statusDashboardHasLatest
                    ? 'Launch status dashboard references the latest Phase 1 launch readiness evidence.'
                    : 'No current checklist, gate evidence index or launch status dashboard references the latest Phase 1 launch readiness evidence.',
        details: gateEvidenceIndex
            ? [latestSummary, `Gate evidence index: ${gateEvidenceIndexPathLabel()}`]
            : [latestSummary, `Launch status dashboard: ${latestStatusSummaryPathLabel()}`],
    });
}

function reviewLatestManualEvidenceReference(checklist: string, target: Finding[]): void {
    const latestManualEvidenceDir = findLatestEvidenceDir('launch-manual-evidence', 'summary.json');
    if (!latestManualEvidenceDir) return;

    const latestSummary = toMarkdownPath(path.relative(process.cwd(), path.join(latestManualEvidenceDir, 'summary.md')));
    const checklistHasLatest = checklist.includes(latestSummary);
    const gateIndexHasLatest = evidenceIndexReferences('manualEvidenceSummaryPath', latestSummary);
    const statusDashboardHasLatest = statusDashboardReferences('manual evidence', latestSummary);
    target.push({
        status: checklistHasLatest || gateIndexHasLatest || statusDashboardHasLatest ? 'ok' : 'warning',
        area: 'manual evidence freshness',
        message: checklistHasLatest
            ? 'CHECKLIST.md references the latest manual launch evidence audit.'
            : gateIndexHasLatest
                ? 'Gate evidence index references the latest manual launch evidence audit.'
                : statusDashboardHasLatest
                    ? 'Launch status dashboard references the latest manual launch evidence audit.'
                    : 'No current checklist, gate evidence index or launch status dashboard references the latest manual launch evidence audit.',
        details: gateEvidenceIndex
            ? [latestSummary, `Gate evidence index: ${gateEvidenceIndexPathLabel()}`]
            : [latestSummary, `Launch status dashboard: ${latestStatusSummaryPathLabel()}`],
    });
}

function readGateEvidenceIndex(target: Finding[]): (GateEvidenceIndex & { path: string }) | null {
    const evidenceIndexArg = process.argv.findIndex((arg) => arg === '--evidence-index');
    if (evidenceIndexArg < 0) return null;

    const evidenceIndexPath = process.argv[evidenceIndexArg + 1];
    if (!evidenceIndexPath) {
        target.push({
            status: 'failed',
            area: 'gate evidence index',
            message: '--evidence-index was provided without a file path.',
        });
        return null;
    }

    const resolvedPath = path.resolve(process.cwd(), evidenceIndexPath);
    if (!existsSync(resolvedPath)) {
        target.push({
            status: 'failed',
            area: 'gate evidence index',
            message: 'Gate evidence index file does not exist.',
            details: [resolvedPath],
        });
        return null;
    }

    try {
        const parsed = JSON.parse(readFileSync(resolvedPath, 'utf8')) as GateEvidenceIndex;
        return { ...parsed, path: resolvedPath };
    } catch (error) {
        target.push({
            status: 'failed',
            area: 'gate evidence index',
            message: 'Gate evidence index file is not valid JSON.',
            details: [error instanceof Error ? error.message : String(error)],
        });
        return null;
    }
}

function readIfExists(file: string): string {
    return existsSync(file) ? readFileSync(file, 'utf8') : '';
}

function evidenceIndexReferences(
    field: 'primarySummaryPath' | 'phaseOneSummaryPath' | 'manualEvidenceSummaryPath',
    expectedPath: string
): boolean {
    if (!gateEvidenceIndex) return false;
    const actualPath = gateEvidenceIndex[field];
    if (!actualPath) return false;
    return evidencePathsMatch(actualPath, expectedPath);
}

function gateEvidenceIndexPathLabel(): string {
    return gateEvidenceIndex ? toMarkdownPath(path.relative(process.cwd(), gateEvidenceIndex.path)) : 'missing';
}

function statusDashboardReferences(sourceLabel: string, expectedPath: string): boolean {
    const latestStatusDir = findLatestEvidenceDir('launch-status', 'summary.json');
    if (!latestStatusDir) return false;

    const summaryPath = path.join(latestStatusDir, 'summary.json');
    try {
        const summary = JSON.parse(readFileSync(summaryPath, 'utf8')) as StatusSummary;
        const source = summary.sources.find((item) => item.label === sourceLabel);
        return Boolean(source?.path && evidencePathsMatch(source.path, expectedPath));
    } catch {
        return false;
    }
}

function latestStatusSummaryPathLabel(): string {
    const latestStatusDir = findLatestEvidenceDir('launch-status', 'summary.json');
    if (!latestStatusDir) return 'missing';
    return toMarkdownPath(path.relative(process.cwd(), path.join(latestStatusDir, 'summary.json')));
}

function evidencePathsMatch(actualPath: string, expectedPath: string): boolean {
    return normalizeSummaryEvidencePath(actualPath) === normalizeSummaryEvidencePath(expectedPath);
}

function normalizeEvidencePath(value: string): string {
    const normalized = toMarkdownPath(value);
    const cwd = toMarkdownPath(process.cwd());
    return normalized.startsWith(`${cwd}/`) ? normalized.slice(cwd.length + 1) : normalized;
}

function normalizeSummaryEvidencePath(value: string): string {
    return normalizeEvidencePath(value).replace(/\/summary\.(?:md|json)$/i, '/summary');
}

function reviewEvidencePaths(checklist: string, target: Finding[]): void {
    const referencedPaths = Array.from(checklist.matchAll(/`([^`]+)`/g))
        .map((match) => match[1])
        .filter((value) => !value.includes('<') && !value.includes('>'))
        .filter((value) => /^outputs[\\/]|^docs[\\/]|^src[\\/]|^db[\\/]|^supabase[\\/]|^scripts[\\/]|^apps[\\/]|^workers[\\/]|^\.github[\\/]|^package\.json$/.test(value))
        .map((value) => value.replace(/\//g, path.sep));
    const missing = Array.from(new Set(referencedPaths))
        .filter((file) => !existsSync(path.resolve(process.cwd(), file)));

    target.push({
        status: missing.length === 0 ? 'ok' : 'warning',
        area: 'referenced evidence files',
        message: missing.length === 0
            ? 'All concrete checklist evidence paths exist locally.'
            : 'Some concrete checklist evidence paths do not exist locally.',
        details: missing.slice(0, 25),
    });
}

function reviewCheckedEvidence(items: ChecklistItem[], target: Finding[]): void {
    const requireEvidenceSections = new Set(['Go/No-Go Blockers', 'Revision Secundaria']);
    const checkedWithoutEvidence = items
        .filter((item) => item.checked)
        .filter((item) => !hasEvidence(item.line))
        .filter((item) => requireEvidenceSections.has(item.section));
    const checkedWithWeakEvidence = items
        .filter((item) => item.checked)
        .filter((item) => !hasEvidence(item.line))
        .filter((item) => !requireEvidenceSections.has(item.section));

    target.push({
        status: checkedWithoutEvidence.length === 0 ? 'ok' : 'failed',
        area: 'checked blocker evidence',
        message: checkedWithoutEvidence.length === 0
            ? 'Checked Go/No-Go and secondary-review items include explicit evidence, a validated Current Evidence reference, or decision text.'
            : 'Checked Go/No-Go or secondary-review items lack explicit evidence.',
        details: checkedWithoutEvidence.map((item) => `${item.section}: ${item.line}`),
    });

    target.push({
        status: checkedWithWeakEvidence.length === 0 ? 'ok' : 'warning',
        area: 'checked non-blocker evidence',
        message: checkedWithWeakEvidence.length === 0
            ? 'Checked non-blocker items include explicit evidence, a validated Current Evidence reference, or decision text.'
            : 'Some checked non-blocker items lack explicit evidence or decision text.',
        details: checkedWithWeakEvidence.slice(0, 30).map((item) => `${item.section}: ${item.line}`),
    });
}

function reviewDynamicGoNoGoEvidenceReferences(checklist: string, target: Finding[]): void {
    const dynamicCommands = [
        'pnpm launch:gate',
        'pnpm launch:verify',
        'pnpm launch:manual-evidence',
        'pnpm launch:secondary-review',
        'pnpm launch:legal',
    ];
    const timestampedOutputPattern = /outputs[\\/]launch-[^\\/]+[\\/]\d{4}-\d{2}-\d{2}T/i;
    const staleOpenCommandRows = sectionLines(checklist, '## Go/No-Go Blockers')
        .map((line) => line.trim())
        .filter((line) => line.startsWith('- [ ]'))
        .filter((line) => dynamicCommands.some((command) => line.includes(command)))
        .filter((line) => timestampedOutputPattern.test(line));

    target.push({
        status: staleOpenCommandRows.length === 0 ? 'ok' : 'failed',
        area: 'dynamic evidence references',
        message: staleOpenCommandRows.length === 0
            ? 'Open dynamic Go/No-Go command blockers use Current Evidence instead of copied timestamped output paths.'
            : 'Open dynamic Go/No-Go command blockers contain copied timestamped output paths; use launch:status Current Evidence instead.',
        details: staleOpenCommandRows,
    });
}

function reviewLaunchGovernance(checklist: string, target: Finding[]): void {
    const governance = sectionLines(checklist, '## Ownership And Cadence').join('\n');
    const requiredPhrases = [
        'Launch tier:',
        'Target basis:',
        'Final decision owner:',
        'Review cadence:',
        'Rollback source:',
        'docs/launch/RUNBOOK.md',
        '| Blocker area | Owner | Target | Evidence |',
    ];
    const requiredRows = [
        'Gate automation',
        'Manual evidence file',
        'Cleanup decision',
        'Legal',
        'Accessibility manual',
        'Security external',
        'Payments staging',
        'Operations external',
        'Content review',
        'Database readiness',
        'Integrations readiness',
        'Final smoke',
    ];
    const missing = [
        ...requiredPhrases.filter((phrase) => !governance.includes(phrase)),
        ...requiredRows.filter((row) => !governance.includes(`| ${row} |`)),
    ];

    target.push({
        status: governance.trim().length > 0 && missing.length === 0 ? 'ok' : 'failed',
        area: 'launch ownership and cadence',
        message: governance.trim().length > 0 && missing.length === 0
            ? 'Launch checklist defines owner, target, cadence and rollback references for Go/No-Go blockers.'
            : 'Launch checklist is missing owner, target, cadence or rollback metadata.',
        details: missing,
    });
}

function hasEvidence(line: string): boolean {
    const lower = line.toLowerCase();
    return lower.includes('evidencia:')
        || hasCurrentEvidenceReference(line)
        || lower.includes('decision')
        || lower.includes('decidida')
        || lower.includes('confirmado')
        || lower.includes('verificado')
        || lower.includes('configurado')
        || lower.includes('creado')
        || lower.includes('pasa.')
        || lower.includes('eliminado')
        || lower.includes('ignorado')
        || /`outputs[\\/]/.test(line)
        || /`docs[\\/]/.test(line)
        || /`supabase[\\/]/.test(line)
        || /`db[\\/]/.test(line)
        || /`src[\\/]/.test(line)
        || /`scripts[\\/]/.test(line)
        || /`apps[\\/]/.test(line)
        || /`workers[\\/]/.test(line)
        || /`\.github[\\/]/.test(line)
        || /`package\.json`/.test(line);
}

function hasCurrentEvidenceReference(line: string): boolean {
    const lower = line.toLowerCase();
    const currentEvidenceRows = [
        'primary verification',
        'phase 1 readiness',
        'manual evidence audit',
        'secondary review',
        'legal audit',
        'release candidate gate',
        'full launch gate',
    ];

    return lower.includes('evidencia')
        && lower.includes('pnpm launch:status')
        && lower.includes('current evidence')
        && currentEvidenceRows.some((row) => lower.includes(row));
}

function renderMarkdown(report: SecondaryReviewReport): string {
    const lines = [
        '# Launch Secondary Review',
        '',
        `- Status: ${report.status}`,
        `- Started: ${report.startedAt}`,
        `- Ended: ${report.endedAt}`,
        `- Primary evidence: ${report.primaryEvidenceDir || 'missing'}`,
        '',
        '| Status | Area | Message |',
        '| --- | --- | --- |',
    ];

    for (const finding of report.findings) {
        lines.push(`| ${finding.status} | ${escapeCell(finding.area)} | ${escapeCell(finding.message)} |`);
        if (finding.details?.length) {
            lines.push(`|  |  | ${escapeCell(finding.details.join(' / '))} |`);
        }
    }

    lines.push('');
    lines.push('## Rule');
    lines.push('');
    lines.push('This secondary review is intentionally stricter than the primary verifier. It blocks launch while Go/No-Go or secondary-review checklist items remain unchecked, even if automated commands pass.');
    lines.push('');

    return `${lines.join('\n')}\n`;
}

function stamp(date: Date): string {
    return date.toISOString().replace(/[:.]/g, '-');
}

function escapeCell(value: string): string {
    return value.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

function toMarkdownPath(filePath: string): string {
    return filePath.replace(/\\/g, '/');
}
