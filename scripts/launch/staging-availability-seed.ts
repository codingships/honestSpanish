import * as dotenv from 'dotenv';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
    parseFacts,
    renderAvailabilityApplySql,
    renderAvailabilityPreflightSql,
    renderAvailabilityVerifySql,
    sha256,
    STAGING_AVAILABILITY_APPROVAL,
    STAGING_AVAILABILITY_APPROVAL_ENV,
    STAGING_AVAILABILITY_DB_URL_ENV,
    STAGING_AVAILABILITY_SLOTS,
    STAGING_AVAILABILITY_TARGET,
    validateAvailabilityPostflight,
    validateAvailabilityPreflight,
    validateAvailabilityRolledBackPostflight,
    validateStagingAvailabilityDatabaseUrl,
} from './staging-availability-shared';
import {
    classifyAvailabilityWriteAttempt,
    type AvailabilityWriteOutcome,
} from './availability-write-recovery-shared';

type Check = { status: 'ok' | 'warning' | 'failed'; name: string; message: string; details?: string[] };

const startedAt = new Date();
const outputDir = path.join(process.cwd(), 'outputs', 'launch-staging-availability', stamp(startedAt));
mkdirSync(outputDir, { recursive: true });

const executeRequested = process.argv.includes('--execute-approved');
const preflightRequested = process.argv.includes('--preflight-readonly');
const mode = executeRequested ? 'execute-approved' : preflightRequested ? 'preflight-readonly' : 'plan';
const approvalMatched = process.env[STAGING_AVAILABILITY_APPROVAL_ENV] === STAGING_AVAILABILITY_APPROVAL;
const checks: Check[] = [];
let writeInvoked = false;
let externalWritePerformed: boolean | null = false;
let writeOutcome: AvailabilityWriteOutcome = 'not_attempted';

const preflightPath = path.join(outputDir, 'preflight.sql');
const applyPath = path.join(outputDir, 'apply.sql');
const verifyPath = path.join(outputDir, 'verify.sql');
writeFileSync(preflightPath, renderAvailabilityPreflightSql(), 'utf8');
writeFileSync(applyPath, renderAvailabilityApplySql(), 'utf8');
writeFileSync(verifyPath, renderAvailabilityVerifySql(), 'utf8');

checks.push(validateLocalPosture());

if (executeRequested && !approvalMatched) {
    checks.push({ status: 'failed', name: 'approval_gate', message: 'Exact staging availability approval is missing.' });
} else if (mode !== 'plan') {
    dotenv.config({ path: path.join(process.cwd(), '.env.staging'), override: false });
    const databaseUrl = process.env[STAGING_AVAILABILITY_DB_URL_ENV] || process.env.SUPABASE_DB_URL;
    const target = validateStagingAvailabilityDatabaseUrl(databaseUrl);
    const teacherEmail = process.env.TEST_TEACHER_EMAIL?.trim();
    if (!target.valid || !target.connectionEnv || !teacherEmail) {
        checks.push({
            status: 'failed',
            name: 'secure_inputs',
            message: 'Exact staging database URL or TEST_TEACHER_EMAIL is unavailable.',
            details: [target.reason, `teacherEmailPresent=${String(Boolean(teacherEmail))}`],
        });
    } else {
        const preflight = runPsql('preflight', preflightPath, target.connectionEnv, teacherEmail, false);
        checks.push(preflight.check);
        if (preflight.check.status === 'ok') {
            const mismatches = validateAvailabilityPreflight(parseFacts(preflight.stdout));
            checks.push({
                status: mismatches.length === 0 ? 'ok' : 'failed',
                name: 'preflight_facts',
                message: mismatches.length === 0
                    ? 'Staging teacher, empty availability and both hardening migrations are proven.'
                    : 'Read-only preflight did not match the exact seed baseline.',
                details: mismatches,
            });
            if (executeRequested && mismatches.length === 0) {
                writeInvoked = true;
                externalWritePerformed = null;
                writeOutcome = 'ambiguous';
                const apply = runPsql('apply', applyPath, target.connectionEnv, teacherEmail, true);
                checks.push(apply.check.status === 'ok' ? apply.check : {
                    status: 'warning',
                    name: 'command_apply_unconfirmed',
                    message: 'Apply did not return success; mandatory read-only reconciliation follows.',
                    details: apply.check.details,
                });
                const verify = runPsql('verify', verifyPath, target.connectionEnv, teacherEmail, false);
                checks.push(verify.check);
                const postflightFacts = verify.check.status === 'ok' ? parseFacts(verify.stdout) : new Map<string, string>();
                const appliedMismatches = verify.check.status === 'ok'
                    ? validateAvailabilityPostflight(postflightFacts)
                    : ['readback command failed'];
                const rolledBackMismatches = verify.check.status === 'ok'
                    ? validateAvailabilityRolledBackPostflight(postflightFacts)
                    : ['readback command failed'];
                const classification = classifyAvailabilityWriteAttempt({
                    applyCommandSucceeded: apply.check.status === 'ok',
                    readbackCommandSucceeded: verify.check.status === 'ok',
                    appliedMismatches,
                    rolledBackMismatches,
                });
                writeOutcome = classification.outcome;
                externalWritePerformed = classification.externalWritePerformed;
                if (writeOutcome === 'applied_verified') {
                    checks.push({
                        status: 'ok',
                        name: 'write_reconciliation',
                        message: 'Read-only postflight proves the exact five persisted availability windows.',
                    });
                } else if (writeOutcome === 'rolled_back_verified') {
                    checks.push({
                        status: 'failed',
                        name: 'write_reconciliation',
                        message: 'Read-only postflight proves the attempted transaction left the empty baseline.',
                        details: appliedMismatches,
                    });
                } else {
                    checks.push({
                        status: 'failed',
                        name: 'write_reconciliation',
                        message: 'The attempted write is ambiguous; do not retry before a fresh read-only reconciliation.',
                        details: [...appliedMismatches, ...rolledBackMismatches],
                    });
                }
            }
        }
    }
} else {
    checks.push({
        status: 'ok',
        name: 'plan_mode_no_connection',
        message: 'Plan mode generated local artifacts without reading credentials or opening a connection.',
    });
}

const status = checks.some((check) => check.status === 'failed') ? 'FAILED' : 'OK';
const closure = writeOutcome === 'rolled_back_verified'
    ? 'ROLLED_BACK_VERIFIED'
    : writeOutcome === 'ambiguous'
        ? 'AMBIGUOUS_REQUIRES_READONLY_RECONCILIATION'
        : status === 'FAILED'
            ? 'BLOCKED'
            : writeOutcome === 'applied_verified'
                ? 'SEEDED_AND_VERIFIED'
        : mode === 'preflight-readonly'
            ? 'READONLY_PREFLIGHT_READY'
            : 'PLAN_ONLY_READY';
const report = {
    schemaVersion: 1,
    status,
    closure,
    mode,
    startedAt: startedAt.toISOString(),
    endedAt: new Date().toISOString(),
    target: STAGING_AVAILABILITY_TARGET,
    schedule: STAGING_AVAILABILITY_SLOTS,
    executeRequested,
    approvalMatched,
    writeInvoked,
    writeOutcome,
    externalWritePerformed,
    checks,
};
writeFileSync(path.join(outputDir, 'summary.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
writeFileSync(path.join(outputDir, 'approval-gate.md'), `${[
    '# Staging availability approval gate',
    '',
    STAGING_AVAILABILITY_APPROVAL,
    '',
    '- Exact target: Supabase staging `mzjyvmlxfpzdfdjzxxyj`.',
    '- Exact schedule: Monday-Friday 09:00-18:00, interpreted by the application as Europe/Madrid.',
    '- Production, bookings, Google Calendar and email are excluded.',
    '',
].join('\n')}\n`, 'utf8');
writeFileSync(path.join(outputDir, 'rollback.md'), `${[
    '# Staging availability rollback',
    '',
    '- Plan/preflight need no rollback.',
    '- A failed SQL statement rolls back the whole insert transaction.',
    '- After commit, delete only the five active rows for the exact staging teacher with days 1-5 and times 09:00-18:00, under a separate approval, then verify zero matching rows.',
    '- Never delete availability in production from this package.',
    '',
].join('\n')}\n`, 'utf8');
writeFileSync(path.join(outputDir, 'summary.md'), `${[
    '# Staging availability seed',
    '',
    `- Status: ${status}`,
    `- Closure: ${closure}`,
    `- Mode: ${mode}`,
    `- Target: ${STAGING_AVAILABILITY_TARGET.projectRef}`,
    `- Write outcome: ${writeOutcome}`,
    `- External write performed: ${String(externalWritePerformed)}`,
    '',
    '| Status | Check | Message |',
    '| --- | --- | --- |',
    ...checks.map((check) => `| ${check.status} | ${check.name} | ${escapeCell(check.message)} |`),
    '',
].join('\n')}\n`, 'utf8');

console.log(`[launch:staging-availability] Status: ${status}`);
console.log(`[launch:staging-availability] Closure: ${closure}`);
console.log(`[launch:staging-availability] External write performed: ${String(externalWritePerformed)}`);
console.log(`[launch:staging-availability] Summary: ${path.join(outputDir, 'summary.md')}`);
if (status === 'FAILED') process.exit(1);

function validateLocalPosture(): Check {
    const packageJson = JSON.parse(readFileSync(path.join(process.cwd(), 'package.json'), 'utf8')) as {
        scripts?: Record<string, string>;
    };
    const expectedScript = 'tsx scripts/launch/staging-availability-seed.ts';
    const sql = [preflightPath, applyPath, verifyPath].map((file) => readFileSync(file, 'utf8')).join('\n');
    const required = [
        'BEGIN READ ONLY',
        'Expected zero existing availability rows',
        'teacher_availability_no_active_overlap',
        "'20260712114000'",
        "'20260712114500'",
    ];
    const missing = required.filter((snippet) => !sql.includes(snippet));
    if (packageJson.scripts?.['launch:staging-availability'] !== expectedScript) missing.push('package script');
    return {
        status: missing.length === 0 ? 'ok' : 'failed',
        name: 'local_exact_scope',
        message: missing.length === 0
            ? `Exact plan artifacts are present (apply sha256=${sha256(readFileSync(applyPath, 'utf8'))}).`
            : 'Local seed package is incomplete.',
        details: missing,
    };
}

function runPsql(
    id: string,
    sqlPath: string,
    connectionEnv: NodeJS.ProcessEnv,
    teacherEmail: string,
    writes: boolean,
): { check: Check; stdout: string } {
    const result = spawnSync('psql', [
        '-X', '-w', '-v', 'ON_ERROR_STOP=1', '-v', `expected_teacher_email=${teacherEmail}`,
        '-A', '-t', '-F', '\t', '-f', sqlPath,
    ], {
        cwd: process.cwd(),
        env: {
            ...process.env,
            ...connectionEnv,
            PGSSLMODE: 'require',
            PGCONNECT_TIMEOUT: '10',
            PGOPTIONS: writes
                ? '-c statement_timeout=30000 -c lock_timeout=5000'
                : '-c default_transaction_read_only=on -c statement_timeout=15000 -c lock_timeout=5000',
        },
        encoding: 'utf8',
        timeout: writes ? 60_000 : 30_000,
        windowsHide: true,
    });
    const stdout = sanitize(result.stdout ?? '', teacherEmail);
    const stderr = sanitize(result.stderr ?? '', teacherEmail);
    writeFileSync(path.join(outputDir, `${id}.txt`), `${[
        `operation=${id}`,
        `writesSupabase=${String(writes)}`,
        `exitCode=${String(result.status)}`,
        '',
        '## stdout',
        stdout || '(empty)',
        '',
        '## stderr',
        stderr || '(empty)',
        '',
    ].join('\n')}\n`, 'utf8');
    return {
        stdout,
        check: {
            status: result.status === 0 && !result.error ? 'ok' : 'failed',
            name: `command_${id}`,
            message: result.status === 0 && !result.error ? `${id} completed.` : `${id} failed.`,
        },
    };
}

function sanitize(value: string, teacherEmail: string): string {
    return value
        .split(teacherEmail).join('[redacted-email]')
        .replace(/postgres(?:ql)?:\/\/[^\s]+/giu, 'postgresql://[redacted]');
}

function escapeCell(value: string): string {
    return value.replace(/\|/gu, '\\|').replace(/\r?\n/gu, ' ');
}

function stamp(date: Date): string {
    return date.toISOString().replace(/[:.]/gu, '-');
}
