import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

export type EvidenceFindingStatus = 'ok' | 'warning' | 'failed';

export interface EvidenceFile<T> {
    file: string;
    data: T;
}

export interface AuditEvidenceSummary {
    status: string;
    outputDir: string;
    startedAt: string;
    endedAt: string;
}

export interface PrimaryResultEvidence {
    status: EvidenceFindingStatus;
    name?: string;
    message: string;
    details?: string[];
    evidence?: string;
}

export interface StandalonePrimaryEvidence {
    commandName: string;
    file: string;
    data: Pick<AuditEvidenceSummary, 'status' | 'endedAt'>;
}

export interface SecondaryFindingEvidence extends PrimaryResultEvidence {
    area?: string;
}

export interface StandaloneSecondaryEvidence extends StandalonePrimaryEvidence {
    secondaryArea: string;
}

export interface StagingSmokeEvidenceSummary extends AuditEvidenceSummary {
    closureStatus?: string;
    executeRequested?: boolean;
    externalWriteCommandStarted?: boolean;
}

export interface StagingSmokeEvidenceSelection<T extends StagingSmokeEvidenceSummary> {
    latestRun: EvidenceFile<T> | null;
    latestPlan: EvidenceFile<T> | null;
    latestExecutedSuccess: EvidenceFile<T> | null;
    preferred: EvidenceFile<T> | null;
}

export function readJsonEvidenceCandidates<T>(
    outputsRoot: string,
    folderName: string,
    fileName: string,
): Array<EvidenceFile<T>> {
    const root = path.join(outputsRoot, folderName);
    if (!existsSync(root)) return [];

    return readdirSync(root, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => path.join(root, entry.name, fileName))
        .filter((file) => existsSync(file))
        .sort((a, b) => path.dirname(b).localeCompare(path.dirname(a)))
        .flatMap((file) => {
            try {
                return [{ file, data: JSON.parse(readFileSync(file, 'utf8')) as T }];
            } catch {
                return [];
            }
        });
}

export function readLatestJsonOrMarkdownSummary<T extends AuditEvidenceSummary>(
    outputsRoot: string,
    folderName: string,
): EvidenceFile<T> | null {
    const root = path.join(outputsRoot, folderName);
    if (!existsSync(root)) return null;

    const directories = readdirSync(root, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => path.join(root, entry.name))
        .sort((a, b) => b.localeCompare(a));

    for (const directory of directories) {
        const jsonFile = path.join(directory, 'summary.json');
        if (existsSync(jsonFile)) {
            try {
                return {
                    file: jsonFile,
                    data: JSON.parse(readFileSync(jsonFile, 'utf8')) as T,
                };
            } catch {
                // A valid Markdown summary in the same run remains usable.
            }
        }

        const markdownFile = path.join(directory, 'summary.md');
        if (!existsSync(markdownFile)) continue;
        const parsed = parseMarkdownAuditSummary(readFileSync(markdownFile, 'utf8'), directory, markdownFile);
        if (parsed) return { file: markdownFile, data: parsed as T };
    }

    return null;
}

export function selectStagingSmokeEvidence<T extends StagingSmokeEvidenceSummary>(
    candidates: Array<EvidenceFile<T>>,
): StagingSmokeEvidenceSelection<T> {
    const latestRun = candidates[0] ?? null;
    const latestPlan = candidates.find((candidate) => candidate.data.executeRequested === false) ?? null;
    const latestExecutedSuccess = candidates.find((candidate) => (
        candidate.data.executeRequested === true
        && candidate.data.externalWriteCommandStarted === true
        && normalizeAuditStatus(candidate.data.status) === 'ok'
        && candidate.data.closureStatus !== 'BLOCKED_BY_GATE_OR_ARTIFACTS'
    )) ?? null;

    return {
        latestRun,
        latestPlan,
        latestExecutedSuccess,
        preferred: latestExecutedSuccess ?? latestRun,
    };
}

export function applyFreshStandalonePrimaryEvidence(
    primaryResults: PrimaryResultEvidence[],
    primaryEndedAt: string,
    standaloneEvidence: StandalonePrimaryEvidence[],
): PrimaryResultEvidence[] {
    return primaryResults.map((result) => {
        const replacement = standaloneEvidence.find((evidence) => (
            evidence.commandName === result.name
            && isLaterTimestamp(evidence.data.endedAt, primaryEndedAt)
        ));
        if (!replacement) return result;

        const replacementStatus = normalizeAuditStatus(replacement.data.status);
        if (!replacementStatus) return result;

        return {
            ...result,
            status: replacementStatus,
            message: `${replacement.commandName} is superseded by the newer standalone audit (${replacement.data.status}).`,
            details: [
                `primaryEndedAt=${primaryEndedAt}`,
                `standaloneEndedAt=${replacement.data.endedAt}`,
                `standaloneStatus=${replacement.data.status}`,
            ],
            evidence: replacement.file,
        };
    });
}

export function applyFreshStandaloneSecondaryEvidence(
    secondaryFindings: SecondaryFindingEvidence[],
    secondaryEndedAt: string,
    standaloneEvidence: StandaloneSecondaryEvidence[],
): SecondaryFindingEvidence[] {
    return secondaryFindings.map((finding) => {
        const replacement = standaloneEvidence.find((evidence) => (
            evidence.secondaryArea === finding.area
            && isLaterTimestamp(evidence.data.endedAt, secondaryEndedAt)
        ));
        if (!replacement) return finding;

        const replacementStatus = normalizeAuditStatus(replacement.data.status);
        if (!replacementStatus) return finding;

        return {
            ...finding,
            status: replacementStatus,
            message: `${finding.area ?? replacement.commandName} is superseded by the newer standalone audit (${replacement.data.status}).`,
            details: [
                `secondaryEndedAt=${secondaryEndedAt}`,
                `standaloneEndedAt=${replacement.data.endedAt}`,
                `standaloneStatus=${replacement.data.status}`,
            ],
            evidence: replacement.file,
        };
    });
}

export function summarizePrimaryResults(results: PrimaryResultEvidence[]): string {
    if (results.some((result) => result.status === 'failed')) return 'BLOCKED';
    if (results.some((result) => result.status === 'warning')) return 'WARNING';
    return 'OK';
}

function parseMarkdownAuditSummary(
    markdown: string,
    outputDir: string,
    markdownFile: string,
): AuditEvidenceSummary | null {
    const status = markdown.match(/^\s*-\s*Status:\s*(.+?)\s*$/mi)?.[1]?.trim();
    if (!status) return null;

    const directoryTimestamp = path.basename(outputDir);
    const parsedTimestamp = Date.parse(directoryTimestamp.replace(/-(\d{3})Z$/, '.$1Z'));
    const fallbackTimestamp = new Date(statSync(markdownFile).mtimeMs).toISOString();
    const timestamp = Number.isFinite(parsedTimestamp)
        ? new Date(parsedTimestamp).toISOString()
        : fallbackTimestamp;

    return {
        status,
        outputDir,
        startedAt: timestamp,
        endedAt: timestamp,
    };
}

function isLaterTimestamp(candidate: string, baseline: string): boolean {
    const candidateTime = Date.parse(candidate);
    const baselineTime = Date.parse(baseline);
    return Number.isFinite(candidateTime) && Number.isFinite(baselineTime) && candidateTime > baselineTime;
}

function normalizeAuditStatus(status: string): EvidenceFindingStatus | null {
    const normalized = status.trim().toUpperCase();
    if (/FAILED|BLOCKED|NO_EVIDENCE/.test(normalized)) return 'failed';
    if (/WARNING|ACCEPTED_RISK/.test(normalized)) return 'warning';
    if (/^OK$|READY|PASSED|SUCCESS/.test(normalized)) return 'ok';
    return null;
}
