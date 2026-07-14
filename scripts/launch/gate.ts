import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

type GateRunStatus = 'BLOCKED' | 'READY_WITH_ACCEPTED_RISKS' | 'READY_CANDIDATE' | 'NO_EVIDENCE';

interface StepResult {
    name: string;
    exitCode: number | null;
    status: 'ok' | 'failed';
    logPath: string;
}

interface StatusSummary {
    status: GateRunStatus;
    blockers?: unknown[];
    warnings?: unknown[];
    openGoNoGo?: unknown[];
    urgencySummary?: StatusUrgencySummary[];
    manualEvidencePhaseSummary?: StatusPhaseSummary[];
}

interface EvidenceIndex {
    schemaVersion: 1;
    generatedAt: string;
    generatedBy: 'pnpm launch:gate';
    gateOutputDir: string;
    primarySummaryPath: string | null;
    phaseOneSummaryPath: string | null;
    manualEvidenceSummaryPath: string | null;
}

interface GateReport {
    schemaVersion: 1;
    startedAt: string;
    endedAt: string;
    status: GateRunStatus;
    outputDir: string;
    evidenceIndexPath: string;
    statusSummaryPath: string | null;
    steps: StepResult[];
}

interface PagesBuildOutputSnapshot {
    configuredPath: string;
    absolutePath: string;
    existedBeforeGate: boolean;
    isSafeWorkspaceChild: boolean;
}

interface StatusUrgencySummary {
    heading?: string;
    openCount?: number;
    failedCount?: number;
    warningCount?: number;
    checkIds?: string[];
    decisionRule?: string;
}

interface StatusPhaseSummary {
    heading?: string;
    category?: string;
    openCount?: number;
    failedCount?: number;
    warningCount?: number;
    checkIds?: string[];
}

const startedAt = new Date();
const outputDir = path.join(process.cwd(), 'outputs', 'launch-gate', stamp(startedAt));
mkdirSync(outputDir, { recursive: true });
const pagesBuildOutputSnapshot = capturePagesBuildOutputSnapshot();

console.log(`[launch:gate] Output: ${outputDir}`);

const results: StepResult[] = [];
results.push(runStep('launch:verify'));
removePagesBuildOutputGeneratedByVerify(pagesBuildOutputSnapshot);
results.push(runStep('launch:phase1'));
const evidenceIndexPath = writeEvidenceIndex();
results.push(runStep('launch:secondary-review', ['--', '--evidence-index', evidenceIndexPath]));
writeGateReport(buildGateReport(null));
results.push(runStep('launch:status'));
const statusSummary = readLatestStatusSummary();
const failedSteps = results.filter((result) => result.status === 'failed');
const report = buildGateReport(statusSummary);
writeGateReport(report, statusSummary?.summary ?? null);

console.log(`[launch:gate] Status: ${report.status}`);
console.log(`[launch:gate] Failed steps: ${failedSteps.length}`);
console.log(`[launch:gate] Status summary: ${report.statusSummaryPath ?? 'missing'}`);
console.log(`[launch:gate] Summary: ${path.join(outputDir, 'summary.md')}`);

if (report.status === 'BLOCKED' || report.status === 'NO_EVIDENCE') {
    process.exit(1);
}

function runStep(script: string, args: string[] = []): StepResult {
    const logPath = path.join(outputDir, `${slug(script)}.log`);
    const command = pnpmCommand();
    const commandArgs = [script, ...args];
    const result = spawnSync(command, commandArgs, {
        cwd: process.cwd(),
        encoding: 'utf8',
        shell: process.platform === 'win32',
        maxBuffer: 100 * 1024 * 1024,
    });
    const output = [
        `$ ${[command, ...commandArgs].join(' ')}`,
        `exitCode=${result.status ?? 'null'}`,
        '',
        '--- stdout ---',
        result.stdout || '',
        '',
        '--- stderr ---',
        result.stderr || '',
        result.error ? `\n--- error ---\n${result.error.message}\n` : '',
    ].join('\n');
    writeFileSync(logPath, output, 'utf8');

    return {
        name: script,
        exitCode: result.status,
        status: result.status === 0 ? 'ok' : 'failed',
        logPath,
    };
}

function writeEvidenceIndex(): string {
    const primaryDir = findLatestEvidenceDir('launch-verification', 'summary.json');
    const phaseOneDir = findLatestEvidenceDir('launch-phase-1', 'summary.json');
    const manualEvidenceDir = findLatestEvidenceDir('launch-manual-evidence', 'summary.json');
    const evidenceIndex: EvidenceIndex = {
        schemaVersion: 1,
        generatedAt: new Date().toISOString(),
        generatedBy: 'pnpm launch:gate',
        gateOutputDir: outputDir,
        primarySummaryPath: primaryDir ? relativePath(path.join(primaryDir, 'summary.md')) : null,
        phaseOneSummaryPath: phaseOneDir ? relativePath(path.join(phaseOneDir, 'summary.md')) : null,
        manualEvidenceSummaryPath: manualEvidenceDir ? relativePath(path.join(manualEvidenceDir, 'summary.md')) : null,
    };
    const jsonPath = path.join(outputDir, 'evidence-index.json');
    writeFileSync(jsonPath, JSON.stringify(evidenceIndex, null, 2), 'utf8');
    writeFileSync(path.join(outputDir, 'evidence-index.md'), renderEvidenceIndex(evidenceIndex), 'utf8');
    return jsonPath;
}

function deriveGateStatus(failedSteps: StepResult[], statusSummary: StatusSummary | null): GateRunStatus {
    if (!statusSummary) return 'NO_EVIDENCE';
    if (failedSteps.length > 0 || statusSummary.status === 'BLOCKED' || statusSummary.status === 'NO_EVIDENCE') {
        return 'BLOCKED';
    }
    return statusSummary.status;
}

function buildGateReport(statusSummary: { path: string; summary: StatusSummary } | null): GateReport {
    const failedStepsForReport = results.filter((result) => result.status === 'failed');
    const status = statusSummary
        ? deriveGateStatus(failedStepsForReport, statusSummary.summary)
        : failedStepsForReport.length > 0 ? 'BLOCKED' : 'READY_CANDIDATE';

    return {
        schemaVersion: 1,
        startedAt: startedAt.toISOString(),
        endedAt: new Date().toISOString(),
        status,
        outputDir,
        evidenceIndexPath,
        statusSummaryPath: statusSummary?.path ?? null,
        steps: [...results],
    };
}

function writeGateReport(report: GateReport, statusSummary: StatusSummary | null = null): void {
    writeFileSync(path.join(outputDir, 'summary.json'), JSON.stringify(report, null, 2), 'utf8');
    writeFileSync(path.join(outputDir, 'summary.md'), renderMarkdown(report, statusSummary), 'utf8');
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

function renderMarkdown(report: GateReport, statusSummary: StatusSummary | null): string {
    const lines = [
        '# Launch Gate Run',
        '',
        `- Status: ${report.status}`,
        `- Started: ${report.startedAt}`,
        `- Ended: ${report.endedAt}`,
        `- Output: ${report.outputDir}`,
        `- Evidence index: ${report.evidenceIndexPath}`,
        `- Status summary: ${report.statusSummaryPath ?? 'missing'}`,
        '',
        '| Status | Step | Exit | Log |',
        '| --- | --- | --- | --- |',
    ];

    for (const step of report.steps) {
        lines.push(`| ${step.status} | ${step.name} | ${step.exitCode ?? 'null'} | ${step.logPath} |`);
    }

    if (statusSummary) {
        lines.push('');
        lines.push('## Consolidated Status');
        lines.push('');
        lines.push(`- Status: ${statusSummary.status}`);
        lines.push(`- Blockers: ${statusSummary.blockers?.length ?? 0}`);
        lines.push(`- Warnings: ${statusSummary.warnings?.length ?? 0}`);
        lines.push(`- Open Go/No-Go: ${statusSummary.openGoNoGo?.length ?? 0}`);
        renderUrgencySummary(lines, statusSummary);
    }

    lines.push('');
    lines.push('## Rule');
    lines.push('');
    lines.push('This command runs the Launch Gate sequence in order: primary verification, Phase 1 readiness, secondary review, then consolidated status. Phase 1 includes the manual evidence audit. It exits non-zero unless the full sequence is unblocked.');
    lines.push('');

    return `${lines.join('\n')}\n`;
}

function renderUrgencySummary(lines: string[], statusSummary: StatusSummary): void {
    const urgencyRows = statusSummary.urgencySummary ?? [];
    if (urgencyRows.length > 0) {
        lines.push('');
        lines.push('## Urgency Summary');
        lines.push('');
        lines.push('| Priority | Open | Failed | Warnings | Checks | Rule |');
        lines.push('| --- | ---: | ---: | ---: | --- | --- |');
        for (const row of urgencyRows) {
            lines.push(`| ${escapeCell(row.heading ?? 'Unknown')} | ${row.openCount ?? 0} | ${row.failedCount ?? 0} | ${row.warningCount ?? 0} | ${escapeCell((row.checkIds ?? []).join(', ') || '-')} | ${escapeCell(row.decisionRule ?? '')} |`);
        }
        return;
    }

    const phaseRows = statusSummary.manualEvidencePhaseSummary ?? [];
    if (phaseRows.length === 0) return;

    lines.push('');
    lines.push('## Manual Evidence Phase Summary');
    lines.push('');
    lines.push('| Phase | Category | Open | Failed | Warnings | Checks |');
    lines.push('| --- | --- | ---: | ---: | ---: | --- |');
    for (const row of phaseRows) {
        lines.push(`| ${escapeCell(row.heading ?? 'Unknown')} | ${escapeCell(row.category ?? '')} | ${row.openCount ?? 0} | ${row.failedCount ?? 0} | ${row.warningCount ?? 0} | ${escapeCell((row.checkIds ?? []).join(', ') || '-')} |`);
    }
}

function renderEvidenceIndex(evidenceIndex: EvidenceIndex): string {
    return [
        '# Launch Gate Evidence Index',
        '',
        `- Generated: ${evidenceIndex.generatedAt}`,
        `- Generated by: ${evidenceIndex.generatedBy}`,
        `- Gate output: ${evidenceIndex.gateOutputDir}`,
        `- Primary summary: ${evidenceIndex.primarySummaryPath ?? 'missing'}`,
        `- Phase 1 summary: ${evidenceIndex.phaseOneSummaryPath ?? 'missing'}`,
        `- Manual evidence summary: ${evidenceIndex.manualEvidenceSummaryPath ?? 'missing'}`,
        '',
    ].join('\n');
}

function capturePagesBuildOutputSnapshot(): PagesBuildOutputSnapshot {
    const configuredPath = pagesBuildOutputDir();
    const absolutePath = path.resolve(process.cwd(), configuredPath);
    const workspaceRoot = path.resolve(process.cwd());
    const relative = path.relative(workspaceRoot, absolutePath);
    const isSafeWorkspaceChild = relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);

    return {
        configuredPath,
        absolutePath,
        existedBeforeGate: existsSync(absolutePath),
        isSafeWorkspaceChild,
    };
}

function removePagesBuildOutputGeneratedByVerify(snapshot: PagesBuildOutputSnapshot): void {
    if (snapshot.existedBeforeGate) {
        console.log(`[launch:gate] Keeping pre-existing Pages build output: ${snapshot.configuredPath}`);
        return;
    }

    if (!snapshot.isSafeWorkspaceChild) {
        console.log(`[launch:gate] Skipping Pages build cleanup outside workspace: ${snapshot.configuredPath}`);
        return;
    }

    if (!existsSync(snapshot.absolutePath)) return;

    rmSync(snapshot.absolutePath, { recursive: true, force: true });
    console.log(`[launch:gate] Removed Pages build output generated by launch:verify before phase1 cleanup: ${snapshot.configuredPath}`);
}

function pagesBuildOutputDir(): string {
    const wrangler = readIfExists('wrangler.toml');
    const match = wrangler.match(/pages_build_output_dir\s*=\s*"([^"]+)"/);
    return match?.[1] ?? 'dist';
}

function readIfExists(file: string): string {
    return existsSync(file) ? readFileSync(file, 'utf8') : '';
}

function relativePath(file: string): string {
    return path.relative(process.cwd(), file).replace(/\\/g, '/');
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
