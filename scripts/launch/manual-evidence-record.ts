import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

type ManualStatus = 'pass' | 'accepted_risk' | 'pending' | 'blocked';

interface EvidenceItem {
    type?: string;
    value?: string;
    note?: string;
}

interface ManualCheck {
    id?: string;
    status?: ManualStatus;
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
    launchDecision?: 'blocked' | 'ready_with_accepted_risks' | 'ready';
    checks?: ManualCheck[];
}

const allowedStatuses = new Set<ManualStatus>(['pass', 'accepted_risk', 'pending', 'blocked']);
const allowedEvidenceTypes = new Set([
    'url',
    'path',
    'screenshot',
    'command_output',
    'dashboard',
    'document',
    'manual_note',
]);

const args = process.argv.slice(2);
const write = args.includes('--write');
const id = readArg('--id');
const status = readArg('--status') as ManualStatus | null;
const evidenceFile = path.resolve(process.cwd(), readArg('--evidence-file') || path.join('docs', 'launch', 'MANUAL_EVIDENCE.local.json'));
const now = new Date().toISOString();

main();

function main(): void {
    if (args.includes('--help') || !id || !status) {
        printUsage();
        process.exit(id && status ? 0 : 1);
    }

    if (!allowedStatuses.has(status)) {
        fail(`Unsupported --status "${status}". Use one of: ${Array.from(allowedStatuses).join(', ')}.`);
    }

    const file = readManualEvidenceFile(evidenceFile);
    if (file.schemaVersion !== 1 || !Array.isArray(file.checks)) {
        fail(`${displayPath(evidenceFile)} must be a schemaVersion 1 manual evidence file with a checks array.`);
    }

    const index = file.checks.findIndex((check) => check.id === id);
    if (index < 0) {
        fail(`Unknown check id "${id}" in ${displayPath(evidenceFile)}.`);
    }

    const current = file.checks[index];
    const summary = readArg('--summary');
    const environment = readArg('--environment') ?? current.environment;
    const owner = readArg('--owner') ?? current.owner ?? 'Alin';
    const verifiedAt = readArg('--verified-at') ?? now;
    const evidence = parseEvidenceArgs();

    if ((status === 'pass' || status === 'accepted_risk') && !summary) {
        fail('--summary is required when marking a check as pass or accepted_risk.');
    }
    if ((status === 'pass' || status === 'accepted_risk') && evidence.length === 0) {
        fail('At least one --evidence type=value item is required when marking a check as pass or accepted_risk.');
    }
    if (status === 'accepted_risk') {
        requireArg('--risk-accepted-by');
        requireArg('--risk-rationale');
        requireArg('--rollback-plan');
    }

    const nextCheck: ManualCheck = {
        ...current,
        status,
        owner,
        verifiedAt,
        environment,
        summary: summary ?? current.summary,
        evidence: evidence.length > 0 ? evidence : current.evidence,
    };

    if (status === 'accepted_risk') {
        nextCheck.riskAcceptedBy = readArg('--risk-accepted-by')!;
        nextCheck.riskRationale = readArg('--risk-rationale')!;
        nextCheck.rollbackPlan = readArg('--rollback-plan')!;
    } else {
        delete nextCheck.riskAcceptedBy;
        delete nextCheck.riskRationale;
        delete nextCheck.rollbackPlan;
    }

    scanForSecretLikeValues(nextCheck);

    const nextFile: ManualEvidenceFile = {
        ...file,
        updatedAt: now,
        checks: file.checks.map((check, checkIndex) => (checkIndex === index ? nextCheck : check)),
    };
    nextFile.launchDecision = deriveLaunchDecision(nextFile);

    const rendered = `${JSON.stringify(nextFile, null, 2)}\n`;
    if (write) {
        writeFileSync(evidenceFile, rendered, 'utf8');
        console.log(`[launch:manual-evidence:record] Updated ${displayPath(evidenceFile)} check ${id}.`);
        console.log(`[launch:manual-evidence:record] launchDecision is now ${nextFile.launchDecision}.`);
        console.log('[launch:manual-evidence:record] Next: pnpm launch:manual-evidence, then pnpm launch:phase1 or pnpm launch:status as appropriate.');
    } else {
        console.log('[launch:manual-evidence:record] Dry run. Add --write to update the local ignored evidence file.');
        console.log(`[launch:manual-evidence:record] Would update ${displayPath(evidenceFile)} check ${id}:`);
        console.log(JSON.stringify(nextCheck, null, 2));
        console.log(`[launch:manual-evidence:record] launchDecision would become ${nextFile.launchDecision}.`);
    }
}

function deriveLaunchDecision(file: ManualEvidenceFile): NonNullable<ManualEvidenceFile['launchDecision']> {
    const statuses = file.checks
        ?.map((check) => check.status)
        .filter((status): status is ManualStatus => Boolean(status) && allowedStatuses.has(status)) ?? [];

    if (statuses.length === 0 || statuses.some((status) => status === 'pending' || status === 'blocked')) {
        return 'blocked';
    }

    if (statuses.some((status) => status === 'accepted_risk')) {
        return 'ready_with_accepted_risks';
    }

    return 'ready';
}

function readManualEvidenceFile(file: string): ManualEvidenceFile {
    if (!existsSync(file)) {
        fail(`Missing manual evidence file: ${displayPath(file)}. Run pnpm launch:manual-evidence:init first.`);
    }

    try {
        return JSON.parse(readFileSync(file, 'utf8')) as ManualEvidenceFile;
    } catch (error) {
        fail(`Invalid JSON in ${displayPath(file)}: ${error instanceof Error ? error.message : String(error)}`);
    }
}

function parseEvidenceArgs(): EvidenceItem[] {
    const rawValues = readRepeatedArg('--evidence');
    return rawValues.map((raw) => {
        const [main, note] = splitOnce(raw, '::');
        const [type, value] = splitOnce(main, '=');
        if (!type || !value) {
            fail(`Invalid --evidence "${raw}". Use type=value or type=value::note.`);
        }
        if (!allowedEvidenceTypes.has(type)) {
            fail(`Unsupported evidence type "${type}". Use one of: ${Array.from(allowedEvidenceTypes).join(', ')}.`);
        }
        return {
            type,
            value,
            ...(note ? { note } : {}),
        };
    });
}

function scanForSecretLikeValues(check: ManualCheck): void {
    const serialized = JSON.stringify(check);
    const patterns: Array<[RegExp, string]> = [
        [/sk_(live|test)_[A-Za-z0-9]/i, 'Stripe secret key'],
        [/whsec_[A-Za-z0-9]/i, 'Stripe webhook secret'],
        [/service[_-]?role/i, 'possible Supabase service role value'],
        [/-----BEGIN [A-Z ]*PRIVATE KEY-----/i, 'private key'],
        [/Bearer\s+[A-Za-z0-9._-]+/i, 'Bearer token'],
        [/[?&](token|secret|key|password)=/i, 'secret-like query parameter'],
        [/postgres(ql)?:\/\/[^/\s:@]+:[^@\s]+@/i, 'database URL with password'],
    ];

    const hit = patterns.find(([pattern]) => pattern.test(serialized));
    if (hit) {
        fail(`Refusing to record secret-like evidence (${hit[1]}). Store only redacted, non-secret references.`);
    }
}

function readArg(name: string): string | null {
    const index = args.findIndex((arg) => arg === name);
    return index >= 0 ? args[index + 1] || null : null;
}

function readRepeatedArg(name: string): string[] {
    const values: string[] = [];
    for (let index = 0; index < args.length; index += 1) {
        if (args[index] === name && args[index + 1]) {
            values.push(args[index + 1]);
            index += 1;
        }
    }
    return values;
}

function requireArg(name: string): void {
    if (!readArg(name)) fail(`${name} is required when --status accepted_risk is used.`);
}

function splitOnce(value: string, separator: string): [string, string] {
    const index = value.indexOf(separator);
    if (index < 0) return [value, ''];
    return [value.slice(0, index), value.slice(index + separator.length)];
}

function printUsage(): void {
    console.log([
        'Usage:',
        '  pnpm launch:manual-evidence:record -- --id cleanup_agents_decision --status pass --summary "Decision: keep .agent/.agents through launch." --evidence "manual_note=Decision recorded by Alin." --evidence "path=CLEANUP.md"',
        '',
        'By default this is a dry run. Add --write to update docs/launch/MANUAL_EVIDENCE.local.json.',
        'Evidence syntax: --evidence "type=value" or --evidence "type=value::note".',
        'Accepted risk also requires --risk-accepted-by, --risk-rationale and --rollback-plan.',
    ].join('\n'));
}

function fail(message: string): never {
    console.error(`[launch:manual-evidence:record] ${message}`);
    process.exit(1);
}

function displayPath(file: string): string {
    return toPosixPath(path.relative(process.cwd(), file) || file);
}

function toPosixPath(file: string): string {
    return file.split(path.sep).join('/');
}
