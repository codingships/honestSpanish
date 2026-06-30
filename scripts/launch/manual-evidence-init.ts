import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

interface EvidenceItem {
    type?: string;
    value?: string;
    note?: string;
}

interface ManualCheck {
    id?: string;
    status?: string;
    owner?: string;
    verifiedAt?: string;
    environment?: string;
    summary?: string;
    evidence?: EvidenceItem[];
    riskAcceptedBy?: string;
    riskRationale?: string;
    rollbackPlan?: string;
}

interface ManualEvidenceFile {
    schemaVersion?: number;
    updatedAt?: string;
    launchDecision?: string;
    checks?: ManualCheck[];
}

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const syncMissing = args.includes('--sync-missing');
const evidenceFile = path.resolve(process.cwd(), readArg('--evidence') || path.join('docs', 'launch', 'MANUAL_EVIDENCE.local.json'));
const exampleFile = path.resolve(process.cwd(), path.join('docs', 'launch', 'MANUAL_EVIDENCE.example.json'));
const now = new Date().toISOString();

const example = readJson(exampleFile, 'manual evidence example');
validateExample(example);
const template = refreshTemplateDates(example, now);

if (!existsSync(evidenceFile)) {
    if (!dryRun) {
        mkdirSync(path.dirname(evidenceFile), { recursive: true });
        writeJson(evidenceFile, template);
    }

    console.log(`[launch:manual-evidence:init] ${dryRun ? 'Would create' : 'Created'} ${displayPath(evidenceFile)}.`);
    console.log('[launch:manual-evidence:init] Next: fill non-secret evidence, then run pnpm launch:manual-evidence.');
    process.exit(0);
}

if (!syncMissing) {
    console.log(`[launch:manual-evidence:init] ${displayPath(evidenceFile)} already exists; no changes made.`);
    console.log('[launch:manual-evidence:init] Use --sync-missing to add checks introduced by a newer example without overwriting existing evidence.');
    process.exit(0);
}

const current = readJson(evidenceFile, 'manual evidence file');
if (!Array.isArray(current.checks)) {
    console.error(`[launch:manual-evidence:init] ${displayPath(evidenceFile)} has no checks array; refusing to modify it.`);
    process.exit(1);
}

const currentIds = new Set(current.checks.map((check) => check.id).filter(Boolean));
const missingChecks = (template.checks || []).filter((check) => check.id && !currentIds.has(check.id));

if (missingChecks.length === 0) {
    console.log(`[launch:manual-evidence:init] ${displayPath(evidenceFile)} already has every check from the example; no changes made.`);
    process.exit(0);
}

const merged: ManualEvidenceFile = {
    ...current,
    updatedAt: now,
    checks: [
        ...current.checks,
        ...missingChecks,
    ],
};

if (!dryRun) {
    writeJson(evidenceFile, merged);
}

console.log(`[launch:manual-evidence:init] ${dryRun ? 'Would add' : 'Added'} ${missingChecks.length} missing check(s) to ${displayPath(evidenceFile)}.`);
console.log(`[launch:manual-evidence:init] Added ids: ${missingChecks.map((check) => check.id).join(', ')}.`);
console.log('[launch:manual-evidence:init] Existing checks were left untouched.');

function readArg(name: string): string | null {
    const index = args.findIndex((arg) => arg === name);
    return index >= 0 ? args[index + 1] || null : null;
}

function readJson(file: string, label: string): ManualEvidenceFile {
    if (!existsSync(file)) {
        console.error(`[launch:manual-evidence:init] Missing ${label}: ${displayPath(file)}.`);
        process.exit(1);
    }

    try {
        return JSON.parse(readFileSync(file, 'utf8')) as ManualEvidenceFile;
    } catch (error) {
        console.error(`[launch:manual-evidence:init] Invalid JSON in ${label}: ${displayPath(file)}.`);
        console.error(error instanceof Error ? error.message : String(error));
        process.exit(1);
    }
}

function validateExample(file: ManualEvidenceFile): void {
    const problems: string[] = [];
    if (file.schemaVersion !== 1) problems.push('schemaVersion must be 1.');
    if (file.launchDecision !== 'blocked') problems.push('launchDecision must be blocked.');
    if (!Array.isArray(file.checks) || file.checks.length === 0) {
        problems.push('checks must be a non-empty array.');
    } else {
        const seen = new Set<string>();
        for (const check of file.checks) {
            if (!check.id) {
                problems.push('every check must have an id.');
                continue;
            }
            if (seen.has(check.id)) problems.push(`duplicate check id: ${check.id}.`);
            seen.add(check.id);
        }
    }

    if (problems.length > 0) {
        console.error('[launch:manual-evidence:init] Refusing to scaffold from an invalid example.');
        for (const problem of problems) console.error(`- ${problem}`);
        process.exit(1);
    }
}

function refreshTemplateDates(file: ManualEvidenceFile, timestamp: string): ManualEvidenceFile {
    return {
        ...file,
        updatedAt: timestamp,
        checks: file.checks?.map((check) => ({
            ...check,
            verifiedAt: timestamp,
        })),
    };
}

function writeJson(file: string, value: ManualEvidenceFile): void {
    writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function displayPath(file: string): string {
    return toPosixPath(path.relative(process.cwd(), file) || file);
}

function toPosixPath(file: string): string {
    return file.split(path.sep).join('/');
}
