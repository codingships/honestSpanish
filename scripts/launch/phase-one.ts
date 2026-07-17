import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

type PhaseOneStatus = 'BLOCKED' | 'READY_WITH_ACCEPTED_RISKS' | 'PHASE_1_READY';

interface StepResult {
    name: string;
    exitCode: number | null;
    status: 'ok' | 'failed';
    logPath: string;
    evidencePath: string | null;
}

interface ManualPhaseCheck {
    id: string;
    area: string;
    status: 'failed' | 'warning';
    message: string;
    details?: string[];
}

interface ManualEvidenceSummary {
    status: 'OK' | 'WARNING' | 'FAILED';
    outputDir: string;
    manualEvidenceIndexPath?: string;
    nextActionsPath?: string;
    phaseOneWorksheetPath?: string;
    phaseOneClosurePackPath?: string;
    manualEvidenceByPhase?: {
        phase_1_now?: ManualPhaseCheck[];
    };
}

interface StatusSummary {
    status: string;
    outputDir: string;
}

interface StrictQaFinding {
    errorId?: string;
    status?: string;
    severity?: string;
    type?: string;
    surface?: string;
    summary?: string;
    fix?: string;
}

interface StrictQaResults {
    findings?: StrictQaFinding[];
}

interface StrictQaTrackerOutput {
    file: string;
    data: StrictQaResults;
    endedAt: string;
}

interface PhaseOneReport {
    schemaVersion: 1;
    startedAt: string;
    endedAt: string;
    status: PhaseOneStatus;
    outputDir: string;
    statusSummaryPath: string | null;
    strictQaTrackerPath: string | null;
    steps: StepResult[];
    phaseOneOpenChecks: ManualPhaseCheck[];
    phaseOneArtifacts: {
        manualEvidenceIndexPath: string | null;
        nextActionsPath: string | null;
        phaseOneWorksheetPath: string | null;
        phaseOneClosurePackPath: string | null;
    };
}

const phaseOneSupportSteps = [
    { script: 'launch:cleanup', evidenceFolder: 'launch-cleanup' },
    { script: 'launch:worktree', evidenceFolder: 'launch-worktree' },
    { script: 'launch:content', evidenceFolder: 'launch-content' },
    { script: 'launch:accessibility', evidenceFolder: 'launch-accessibility' },
    { script: 'launch:operations', evidenceFolder: 'launch-operations' },
    { script: 'launch:operations-external-closure', evidenceFolder: 'launch-operations-external-closure' },
    { script: 'launch:staging-db-rollout', evidenceFolder: 'launch-staging-database-rollout' },
    { script: 'launch:supabase-security-rollout', evidenceFolder: 'launch-supabase-security-rollout' },
    { script: 'launch:security', evidenceFolder: 'launch-security' },
];

const startedAt = new Date();
const outputDir = path.join(process.cwd(), 'outputs', 'launch-phase-1', stamp(startedAt));
mkdirSync(outputDir, { recursive: true });

console.log(`[launch:phase1] Output: ${outputDir}`);

const steps: StepResult[] = [];
for (const step of phaseOneSupportSteps) {
    steps.push(runStep(step.script, step.evidenceFolder));
}
steps.push(runStep('launch:manual-evidence', 'launch-manual-evidence'));

writePhaseOneReport(buildPhaseOneReport(null));

steps.push(runStep('launch:status', 'launch-status'));
const statusSummary = readLatestStatusSummary();
const report = buildPhaseOneReport(statusSummary);
writePhaseOneReport(report);

console.log(`[launch:phase1] Status: ${report.status}`);
console.log(`[launch:phase1] Phase 1 open checks: ${report.phaseOneOpenChecks.length}`);
console.log(`[launch:phase1] Summary: ${path.join(outputDir, 'summary.md')}`);

if (report.status === 'BLOCKED') process.exit(1);

function runStep(script: string, evidenceFolder: string): StepResult {
    const logPath = path.join(outputDir, `${slug(script)}.log`);
    const command = pnpmCommand();
    const args = ['run', script];
    const result = spawnSync(command, args, {
        cwd: process.cwd(),
        encoding: 'utf8',
        shell: process.platform === 'win32',
        maxBuffer: 100 * 1024 * 1024,
    });

    writeFileSync(logPath, [
        `$ ${command} ${args.join(' ')}`,
        `exitCode=${result.status ?? 'null'}`,
        '',
        '--- stdout ---',
        result.stdout || '',
        '',
        '--- stderr ---',
        result.stderr || '',
        result.error ? `\n--- error ---\n${result.error.message}\n` : '',
    ].join('\n'), 'utf8');

    return {
        name: script,
        exitCode: result.status,
        status: result.status === 0 ? 'ok' : 'failed',
        logPath,
        evidencePath: latestSummaryPath(evidenceFolder),
    };
}

function buildPhaseOneReport(statusSummary: { path: string; summary: StatusSummary } | null): PhaseOneReport {
    const manualSummary = readLatestManualEvidenceSummary();
    const strictQaTracker = readLatestStrictQaResults();
    const strictQaOpenSecurityChecks = collectStrictQaOpenSecurityFindings(strictQaTracker?.data ?? null)
        .map(strictQaFindingToPhaseCheck);
    const supportFailures = steps
        .filter((step) => step.name !== 'launch:manual-evidence' && step.name !== 'launch:status')
        .filter((step) => step.status === 'failed');
    const phaseOneOpenChecks = mergePhaseOneChecks([
        ...(manualSummary?.manualEvidenceByPhase?.phase_1_now ?? []),
        ...strictQaOpenSecurityChecks,
    ]);
    const phaseOneFailedChecks = phaseOneOpenChecks.filter((check) => check.status === 'failed');
    const phaseOneWarningChecks = phaseOneOpenChecks.filter((check) => check.status === 'warning');
    const status: PhaseOneStatus = supportFailures.length > 0 || !manualSummary || phaseOneFailedChecks.length > 0
        ? 'BLOCKED'
        : phaseOneWarningChecks.length > 0
            ? 'READY_WITH_ACCEPTED_RISKS'
            : 'PHASE_1_READY';

    return {
        schemaVersion: 1,
        startedAt: startedAt.toISOString(),
        endedAt: new Date().toISOString(),
        status,
        outputDir,
        statusSummaryPath: statusSummary?.path ?? null,
        strictQaTrackerPath: strictQaTracker?.file ?? null,
        steps: [...steps],
        phaseOneOpenChecks,
        phaseOneArtifacts: {
            manualEvidenceIndexPath: manualSummary?.manualEvidenceIndexPath ?? null,
            nextActionsPath: manualSummary?.nextActionsPath ?? null,
            phaseOneWorksheetPath: manualSummary?.phaseOneWorksheetPath ?? null,
            phaseOneClosurePackPath: manualSummary?.phaseOneClosurePackPath ?? null,
        },
    };
}

function writePhaseOneReport(report: PhaseOneReport): void {
    writeFileSync(path.join(outputDir, 'summary.json'), JSON.stringify(report, null, 2), 'utf8');
    writeFileSync(path.join(outputDir, 'summary.md'), renderMarkdown(report), 'utf8');
}

function renderMarkdown(report: PhaseOneReport): string {
    const lines = [
        '# Phase 1 Launch Readiness',
        '',
        `- Status: ${report.status}`,
        `- Started: ${report.startedAt}`,
        `- Ended: ${report.endedAt}`,
        `- Output: ${report.outputDir}`,
        `- Status summary: ${report.statusSummaryPath ?? 'missing'}`,
        `- Strict QA tracker: ${toMarkdownPath(report.strictQaTrackerPath)}`,
        '',
        '## Scope',
        '',
        'This command prepares the immediate launch work only: cleanup decision, Git worktree hygiene, content review, manual accessibility, database readiness, staging database rollout planning, Supabase security rollout planning, external operations closure, external security, and canonical strict-QA security blockers. It does not touch real legal data, Stripe live, final API key rotation, production smoke or external Supabase writes.',
        '',
        '## Support Audits',
        '',
        '| Status | Step | Exit | Evidence | Log |',
        '| --- | --- | ---: | --- | --- |',
    ];

    for (const step of report.steps) {
        lines.push(`| ${step.status} | ${step.name} | ${step.exitCode ?? 'null'} | ${toMarkdownPath(step.evidencePath)} | ${toMarkdownPath(step.logPath)} |`);
    }

    lines.push('');
    lines.push('## Phase 1 Manual Checks');
    lines.push('');

    if (report.phaseOneOpenChecks.length === 0) {
        lines.push('No Phase 1 manual blockers remain.');
    } else {
        lines.push('| Status | Check | Area | Message |');
        lines.push('| --- | --- | --- | --- |');
        for (const check of report.phaseOneOpenChecks) {
            lines.push(`| ${check.status} | ${check.id} | ${check.area} | ${escapeCell(check.message)} |`);
            if (check.details?.length) {
                lines.push(`|  |  |  | ${escapeCell(check.details.join(' / '))} |`);
            }
        }
    }

    lines.push('');
    lines.push('## Phase 1 Artifacts');
    lines.push('');
    lines.push(`- Manual evidence index: ${toMarkdownPath(report.phaseOneArtifacts.manualEvidenceIndexPath)}`);
    lines.push(`- Next actions: ${toMarkdownPath(report.phaseOneArtifacts.nextActionsPath)}`);
    lines.push(`- Phase 1 worksheet: ${toMarkdownPath(report.phaseOneArtifacts.phaseOneWorksheetPath)}`);
    lines.push(`- Phase 1 closure pack: ${toMarkdownPath(report.phaseOneArtifacts.phaseOneClosurePackPath)}`);
    lines.push('');
    lines.push('## Next Actions');
    lines.push('');
    if (report.status === 'BLOCKED') {
        lines.push('- Open the Phase 1 closure pack, collect non-secret evidence for the open Phase 1 checks, update `docs/launch/MANUAL_EVIDENCE.local.json`, then rerun `pnpm launch:phase1`.');
        if (report.phaseOneOpenChecks.some((check) => /^SEC-\d+/i.test(check.id))) {
            lines.push('- For `SEC-*` blockers, use the latest `pnpm launch:supabase-security-rollout` artifacts and do not apply Supabase SQL until the exact staging-first external approval and post-apply read-only verification are complete.');
        }
    } else if (report.status === 'READY_WITH_ACCEPTED_RISKS') {
        lines.push('- Review accepted Phase 1 risks with Alin before freezing RC; Stripe/payment smoke remains final-only unless checkout is enabled.');
    } else {
        lines.push('- Phase 1 is clear. Freeze the release candidate next; keep `payments_staging`, legal, integrations and smoke for final closure unless checkout is enabled.');
    }
    lines.push('');
    lines.push('## Rule');
    lines.push('');
    lines.push('This command exits non-zero while Phase 1 support audits fail, Phase 1 manual evidence remains pending/blocked, or the canonical strict-QA tracker has open SEC-* findings. Final-only checks may still block the full Launch Gate even after Phase 1 is clear.');
    lines.push('');

    return `${lines.join('\n')}\n`;
}

function readLatestManualEvidenceSummary(): ManualEvidenceSummary | null {
    const latestDir = findLatestEvidenceDir('launch-manual-evidence', 'summary.json');
    if (!latestDir) return null;

    return JSON.parse(readFileSync(path.join(latestDir, 'summary.json'), 'utf8')) as ManualEvidenceSummary;
}

function readLatestStrictQaResults(): StrictQaTrackerOutput | null {
    const outputsRoot = path.join(process.cwd(), 'outputs');
    if (!existsSync(outputsRoot)) return null;

    const candidates = readdirSync(outputsRoot, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => path.join(outputsRoot, entry.name, 'strict-qa-v2', 'strict-qa-results.json'))
        .filter((file) => existsSync(file))
        .map((file) => ({
            file,
            mtimeMs: statSync(file).mtimeMs,
        }))
        .sort((a, b) => b.mtimeMs - a.mtimeMs);

    for (const candidate of candidates) {
        try {
            return {
                file: candidate.file,
                data: JSON.parse(readFileSync(candidate.file, 'utf8')) as StrictQaResults,
                endedAt: new Date(candidate.mtimeMs).toISOString(),
            };
        } catch {
            // Ignore corrupt historical tracker snapshots and try the next newest one.
        }
    }

    return null;
}

function collectStrictQaOpenSecurityFindings(results: StrictQaResults | null): StrictQaFinding[] {
    return (results?.findings ?? [])
        .filter((finding) => String(finding.status ?? '').toLowerCase() === 'open')
        .filter((finding) => /^SEC-\d+/i.test(String(finding.errorId ?? '')))
        .sort((a, b) => String(a.errorId ?? '').localeCompare(String(b.errorId ?? '')));
}

function strictQaFindingToPhaseCheck(finding: StrictQaFinding): ManualPhaseCheck {
    const errorId = finding.errorId ?? 'strict_qa_security';

    return {
        id: errorId,
        area: 'strict QA security',
        status: 'failed',
        message: `${errorId} remains open in the canonical Strict QA tracker: ${finding.summary ?? 'No summary recorded.'}`,
        details: [
            `severity=${finding.severity ?? 'unknown'}`,
            `type=${finding.type ?? 'unknown'}`,
            `surface=${finding.surface ?? 'unknown'}`,
            `fix=${finding.fix ?? 'No fix guidance recorded.'}`,
        ],
    };
}

function mergePhaseOneChecks(checks: ManualPhaseCheck[]): ManualPhaseCheck[] {
    const byId = new Map<string, ManualPhaseCheck>();
    for (const check of checks) {
        byId.set(check.id, check);
    }
    return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
}

function readLatestStatusSummary(): { path: string; summary: StatusSummary } | null {
    const latestDir = findLatestEvidenceDir('launch-status', 'summary.json');
    if (!latestDir) return null;

    const summaryPath = path.join(latestDir, 'summary.json');
    return {
        path: summaryPath,
        summary: JSON.parse(readFileSync(summaryPath, 'utf8')) as StatusSummary,
    };
}

function latestSummaryPath(evidenceFolder: string): string | null {
    const latestDir = findLatestEvidenceDir(evidenceFolder, 'summary.json');
    return latestDir ? path.join(latestDir, 'summary.md') : null;
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

function toMarkdownPath(file: string | null): string {
    return file ? path.relative(process.cwd(), file).replace(/\\/g, '/') : 'missing';
}

function pnpmCommand(): string {
    return process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
}

function stamp(date: Date): string {
    return date.toISOString().replace(/[:.]/g, '-');
}

function slug(value: string): string {
    return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'step';
}

function escapeCell(value: string): string {
    return value.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}
