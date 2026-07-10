import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

type StepStatus = 'ok' | 'failed';
type ReleaseCandidateStatus =
    | 'RC_BLOCKED_BY_PHASE_1'
    | 'RC_BLOCKED_BY_RELEASE_CANDIDATE_CHECKS'
    | 'RC_READY_WITH_ACCEPTED_RISKS'
    | 'RC_READY_WITH_FINAL_BLOCKERS'
    | 'RC_READY_FOR_GO_NO_GO'
    | 'NO_EVIDENCE';

interface StepResult {
    name: string;
    exitCode: number | null;
    status: StepStatus;
    logPath: string;
}

interface ReleaseCandidateReadiness {
    status: ReleaseCandidateStatus;
    reason: string;
    phaseOneOpenChecks: string[];
    releaseCandidateOpenChecks: string[];
    finalOnlyOpenChecks: string[];
    strictQaOpenChecks: string[];
    acceptedRiskChecks?: string[];
    provenNow: string[];
    nextDecision: string;
}

interface StatusSummary {
    outputDir: string;
    releaseCandidateReadiness?: ReleaseCandidateReadiness;
}

interface ReleaseCandidateReport {
    schemaVersion: 1;
    startedAt: string;
    endedAt: string;
    status: ReleaseCandidateStatus;
    outputDir: string;
    stagingUrl: string;
    statusSummaryPath: string | null;
    steps: StepResult[];
    releaseCandidateReadiness: ReleaseCandidateReadiness | null;
}

const readyStatuses = new Set<ReleaseCandidateStatus>([
    'RC_READY_WITH_ACCEPTED_RISKS',
    'RC_READY_WITH_FINAL_BLOCKERS',
    'RC_READY_FOR_GO_NO_GO',
]);

const startedAt = new Date();
const outputDir = path.join(process.cwd(), 'outputs', 'launch-rc', stamp(startedAt));
mkdirSync(outputDir, { recursive: true });
const DEFAULT_WORKER_STAGING_URL = 'https://espanolhonesto-staging.alindev95.workers.dev';
const stagingUrl = readArgValue('--staging-url')
    ?? readArgValue('--staging-worker-url')
    ?? readArgValue('--staging-pages-url')
    ?? process.env.CLOUDFLARE_WORKERS_STAGING_URL
    ?? process.env.CLOUDFLARE_STAGING_URL
    ?? DEFAULT_WORKER_STAGING_URL;

console.log(`[launch:rc] Output: ${outputDir}`);

const steps: StepResult[] = [
    runStep('launch:phase1'),
    runStep('launch:functional-rc'),
    runStep('launch:payments'),
    runStep('launch:no-real-payments', ['--', '--deployed-url', stagingUrl]),
    runStep('launch:staging-no-real-payments-remediation', ['--', '--deployed-url', stagingUrl]),
    runStep('launch:rc-external-closure'),
    runStep('launch:status'),
];
const statusSummary = readLatestStatusSummary();
const report = buildReport(statusSummary);
writeReport(report);
// The first launch:status run is needed to compute RC readiness, but it runs
// before this RC summary exists. Run status once more after writing the report
// so the dashboard points at the RC that was just generated.
steps.push(runStep('launch:status', [], 'launch:status-post-rc'));
const postReportStatusSummary = readLatestStatusSummary();
const finalReport = buildReport(postReportStatusSummary);
writeReport(finalReport);

console.log(`[launch:rc] Status: ${finalReport.status}`);
console.log(`[launch:rc] Summary: ${path.join(outputDir, 'summary.md')}`);

if (!readyStatuses.has(finalReport.status)) {
    process.exit(1);
}

function runStep(script: string, extraArgs: string[] = [], stepName = script): StepResult {
    const logPath = path.join(outputDir, `${slug(stepName)}.log`);
    const command = corepackCommand();
    const args = ['pnpm', script, ...extraArgs];
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
        name: stepName,
        exitCode: result.status,
        status: result.status === 0 ? 'ok' : 'failed',
        logPath,
    };
}

function buildReport(statusSummary: { path: string; summary: StatusSummary } | null): ReleaseCandidateReport {
    const readiness = statusSummary?.summary.releaseCandidateReadiness ?? null;
    const status = deriveReleaseCandidateStatus(readiness);

    return {
        schemaVersion: 1,
        startedAt: startedAt.toISOString(),
        endedAt: new Date().toISOString(),
        status,
        outputDir,
        stagingUrl,
        statusSummaryPath: statusSummary?.path ?? null,
        steps,
        releaseCandidateReadiness: readiness,
    };
}

function deriveReleaseCandidateStatus(readiness: ReleaseCandidateReadiness | null): ReleaseCandidateStatus {
    if (!readiness) return 'NO_EVIDENCE';

    const failedStatusStep = steps.find((step) => step.name.startsWith('launch:status') && step.status === 'failed');
    if (failedStatusStep) return 'NO_EVIDENCE';

    const failedPaymentStep = steps.find((step) => step.name === 'launch:payments' && step.status === 'failed');
    if (failedPaymentStep) return 'RC_BLOCKED_BY_RELEASE_CANDIDATE_CHECKS';

    const failedFunctionalStep = steps.find((step) => step.name === 'launch:functional-rc' && step.status === 'failed');
    if (failedFunctionalStep) return 'RC_BLOCKED_BY_RELEASE_CANDIDATE_CHECKS';

    const failedNoRealPaymentsStep = steps.find((step) => step.name === 'launch:no-real-payments' && step.status === 'failed');
    if (failedNoRealPaymentsStep) return 'RC_BLOCKED_BY_RELEASE_CANDIDATE_CHECKS';

    const failedPhaseOneStep = steps.find((step) => step.name === 'launch:phase1' && step.status === 'failed');
    if (failedPhaseOneStep && readyStatuses.has(readiness.status)) {
        return 'RC_BLOCKED_BY_PHASE_1';
    }

    return readiness.status;
}

function writeReport(report: ReleaseCandidateReport): void {
    writeFileSync(path.join(outputDir, 'summary.json'), JSON.stringify(report, null, 2), 'utf8');
    writeFileSync(path.join(outputDir, 'summary.md'), renderMarkdown(report), 'utf8');
}

function renderMarkdown(report: ReleaseCandidateReport): string {
    const readiness = report.releaseCandidateReadiness;
    const lines = [
        '# Release Candidate Gate',
        '',
        `- Status: ${report.status}`,
        `- Started: ${report.startedAt}`,
        `- Ended: ${report.endedAt}`,
        `- Staging URL: ${report.stagingUrl}`,
        `- Output: ${report.outputDir}`,
        `- Status summary: ${report.statusSummaryPath ?? 'missing'}`,
        '',
        '## Steps',
        '',
        '| Status | Step | Exit | Log |',
        '| --- | --- | ---: | --- |',
        ...report.steps.map((step) => `| ${step.status} | ${step.name} | ${step.exitCode ?? 'null'} | ${step.logPath} |`),
        '',
        '## RC Decision',
        '',
    ];

    if (!readiness) {
        lines.push('No release candidate readiness evidence was found. Run `pnpm launch:status` or `pnpm launch:gate` first.');
    } else {
        lines.push('| Field | Value |');
        lines.push('| --- | --- |');
        lines.push(`| Status | ${escapeCell(readiness.status)} |`);
        lines.push(`| Reason | ${escapeCell(readiness.reason)} |`);
        lines.push(`| Phase 1 Open | ${escapeCell(listValue(readiness.phaseOneOpenChecks))} |`);
        lines.push(`| RC Open | ${escapeCell(listValue(readiness.releaseCandidateOpenChecks))} |`);
        lines.push(`| Accepted Risks | ${escapeCell(listValue(readiness.acceptedRiskChecks ?? []))} |`);
        lines.push(`| Final-Only Open | ${escapeCell(listValue(readiness.finalOnlyOpenChecks))} |`);
        lines.push(`| Strict-QA Open | ${escapeCell(listValue(readiness.strictQaOpenChecks))} |`);
        lines.push(`| Next Decision | ${escapeCell(readiness.nextDecision)} |`);
        lines.push('');
        lines.push('Already proven for RC scope:');
        lines.push('');
        lines.push(...(readiness.provenNow.length > 0
            ? readiness.provenNow.map((item) => `- ${item}`)
            : ['- No RC evidence has been generated yet.']));
    }

    lines.push('');
    lines.push('## Rule');
    lines.push('');
    lines.push('This command evaluates release-candidate readiness only. It can pass with final-only blockers still open, but it must fail while Phase 1 or RC-specific checks remain pending. The full launch still requires `pnpm launch:gate`.');
    lines.push('');

    return `${lines.join('\n')}\n`;
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

function readArgValue(name: string): string | null {
    const index = process.argv.indexOf(name);
    if (index === -1) return null;
    return process.argv[index + 1] ?? null;
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

function corepackCommand(): string {
    return process.platform === 'win32' ? 'corepack.cmd' : 'corepack';
}

function stamp(date: Date): string {
    return date.toISOString().replace(/[:.]/g, '-');
}

function slug(value: string): string {
    return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'step';
}

function listValue(items: string[]): string {
    return items.length > 0 ? items.join(', ') : '-';
}

function escapeCell(value: string): string {
    return value.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}
