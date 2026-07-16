import { spawnSync } from 'node:child_process';
import * as dotenv from 'dotenv';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
    PRODUCTION_AVAILABILITY_APPROVAL,
    PRODUCTION_AVAILABILITY_APPROVAL_ENV,
    PRODUCTION_AVAILABILITY_DB_URL_ENV,
    PRODUCTION_AVAILABILITY_INERT_CONFIRMATION,
    PRODUCTION_AVAILABILITY_INERT_CONFIRMATION_ENV,
    PRODUCTION_AVAILABILITY_SLOTS,
    PRODUCTION_AVAILABILITY_TARGET,
    asFinalAuthPolicyReceipt,
    normalizeProductionAvailabilityOutput,
    parseAvailabilityFacts,
    renderProductionAvailabilityApplySql,
    renderProductionAvailabilityPreflightSql,
    renderProductionAvailabilityVerifySql,
    sha256Availability,
    validateFinalAuthPolicyReceipt,
    validateProductionAvailabilityDatabaseUrl,
    validateProductionAvailabilityPostflight,
    validateProductionAvailabilityPreflight,
    validateProductionAvailabilityRolledBackPostflight,
    type ProductionAvailabilityIdentityIds,
} from './production-availability-shared';
import {
    classifyAvailabilityWriteAttempt,
    type AvailabilityWriteOutcome,
} from './availability-write-recovery-shared';

type Check = { status: 'ok' | 'warning' | 'failed'; name: string; message: string; details?: string[] };

const supportedArgs = new Set(['--preflight-readonly', '--execute-approved', '--auth-policy-receipt']);
const args = process.argv.slice(2);
for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (!supportedArgs.has(argument)) throw new Error(`Unsupported argument: ${argument}`);
    if (argument === '--auth-policy-receipt') index += 1;
}
const executeRequested = args.includes('--execute-approved');
const preflightRequested = args.includes('--preflight-readonly');
if (executeRequested && preflightRequested) throw new Error('Use only one execution mode.');
const receiptIndex = args.indexOf('--auth-policy-receipt');
const receiptPath = receiptIndex >= 0 ? args[receiptIndex + 1] : undefined;
const mode = executeRequested ? 'execute-approved' : preflightRequested ? 'preflight-readonly' : 'plan';

const startedAt = new Date();
const outputDir = path.join(process.cwd(), 'outputs', 'launch-production-availability', stamp(startedAt));
mkdirSync(outputDir, { recursive: true });
const checks: Check[] = [];
let writeInvoked = false;
let externalWritePerformed: boolean | null = false;
let writeOutcome: AvailabilityWriteOutcome = 'not_attempted';
let authPolicyReceiptSha256 = '';
let authPolicyReceipt: ReturnType<typeof asFinalAuthPolicyReceipt> = null;

const preflightPath = path.join(outputDir, 'preflight.sql');
const applyPath = path.join(outputDir, 'apply.sql');
const verifyPath = path.join(outputDir, 'verify.sql');
writeFileSync(preflightPath, renderProductionAvailabilityPreflightSql(), 'utf8');
writeFileSync(applyPath, renderProductionAvailabilityApplySql(), 'utf8');
writeFileSync(verifyPath, renderProductionAvailabilityVerifySql(), 'utf8');
checks.push(validateLocalPosture());

const approvalMatched = process.env[PRODUCTION_AVAILABILITY_APPROVAL_ENV] === PRODUCTION_AVAILABILITY_APPROVAL;
const inertConfirmed = process.env[PRODUCTION_AVAILABILITY_INERT_CONFIRMATION_ENV] === PRODUCTION_AVAILABILITY_INERT_CONFIRMATION;
if (executeRequested && (!approvalMatched || !inertConfirmed)) {
    checks.push(fail('approval_and_inert_gate', 'Exact production availability approval or inert confirmation is missing.', [
        `approvalMatched=${String(approvalMatched)}`,
        `inertConfirmed=${String(inertConfirmed)}`,
    ]));
} else if (mode !== 'plan') {
    const receiptCheck = validateReceipt(receiptPath);
    checks.push(receiptCheck);
    if (receiptCheck.status === 'ok') {
        dotenv.config({ path: path.join(process.cwd(), '.env'), override: false, quiet: true });
        const databaseUrl = process.env[PRODUCTION_AVAILABILITY_DB_URL_ENV] || process.env.SUPABASE_DB_URL;
        const target = validateProductionAvailabilityDatabaseUrl(databaseUrl);
        const teacherEmail = process.env.TEST_TEACHER_EMAIL?.trim();
        if (!target.valid || !target.connectionEnv || !teacherEmail) {
            checks.push(fail('secure_inputs', 'Exact production database URL or preserved TEST_TEACHER_EMAIL is unavailable.', [
                target.reason,
                `teacherEmailPresent=${String(Boolean(teacherEmail))}`,
            ]));
        } else {
            const preflight = runPsql('preflight', preflightPath, target.connectionEnv, teacherEmail, false);
            checks.push(preflight.check);
            if (preflight.check.status === 'ok') {
                const mismatches = validateProductionAvailabilityPreflight(
                    parseAvailabilityFacts(preflight.stdout),
                    authPolicyReceipt!.preservedSetSha256,
                );
                checks.push(mismatches.length === 0
                    ? ok('preflight_facts', 'Final Auth identities, exact live roles, exact teacher, empty schedule and overlap hardening are proven.', [])
                    : fail('preflight_facts', 'Read-only preflight does not match the exact production seed baseline.', mismatches));
                if (executeRequested && mismatches.length === 0 && !preflight.identityIds) {
                    checks.push(fail(
                        'identity_binding',
                        'The live preserved identities could not be bound to the approved receipt.',
                        ['identityIds=missing'],
                    ));
                }
                if (executeRequested && mismatches.length === 0 && preflight.identityIds) {
                    writeInvoked = true;
                    externalWritePerformed = null;
                    writeOutcome = 'ambiguous';
                    const apply = runPsql(
                        'apply',
                        applyPath,
                        target.connectionEnv,
                        teacherEmail,
                        true,
                        preflight.identityIds,
                    );
                    checks.push(apply.check.status === 'ok' ? apply.check : warning(
                        'command_apply_unconfirmed',
                        'Apply did not return success; mandatory read-only reconciliation follows.',
                        apply.check.details ?? [],
                    ));
                    const verify = runPsql('verify', verifyPath, target.connectionEnv, teacherEmail, false);
                    checks.push(verify.check);
                    const postflightFacts = verify.check.status === 'ok'
                        ? parseAvailabilityFacts(verify.stdout)
                        : new Map<string, string>();
                    const appliedMismatches = verify.check.status === 'ok'
                        ? validateProductionAvailabilityPostflight(
                            postflightFacts,
                            authPolicyReceipt!.preservedSetSha256,
                        )
                        : ['readback command failed'];
                    const rolledBackMismatches = verify.check.status === 'ok'
                        ? validateProductionAvailabilityRolledBackPostflight(
                            postflightFacts,
                            authPolicyReceipt!.preservedSetSha256,
                        )
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
                        checks.push(ok(
                            'write_reconciliation',
                            'Read-only postflight proves the exact identity-bound production schedule.',
                            [],
                        ));
                    } else if (writeOutcome === 'rolled_back_verified') {
                        checks.push(fail(
                            'write_reconciliation',
                            'Read-only postflight proves the attempted transaction left the empty baseline.',
                            appliedMismatches,
                        ));
                    } else {
                        checks.push(fail(
                            'write_reconciliation',
                            'The attempted production write is ambiguous; do not retry before a fresh read-only reconciliation.',
                            [...appliedMismatches, ...rolledBackMismatches],
                        ));
                    }
                }
            }
        }
    }
} else {
    checks.push(ok('plan_mode_no_connection', 'Plan mode generated local artifacts without reading credentials, receipts or opening a connection.', []));
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
    target: PRODUCTION_AVAILABILITY_TARGET,
    schedule: PRODUCTION_AVAILABILITY_SLOTS,
    startedAt: startedAt.toISOString(),
    endedAt: new Date().toISOString(),
    executeRequested,
    approvalMatched,
    inertConfirmed,
    authPolicyReceiptSha256: authPolicyReceiptSha256 || null,
    writeInvoked,
    writeOutcome,
    externalWritePerformed,
    externalProvidersTouched: false,
    checks,
};
writeFileSync(path.join(outputDir, 'summary.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
if (externalWritePerformed && status === 'OK') {
    writeFileSync(path.join(outputDir, 'production-availability-receipt.json'), `${JSON.stringify({
        schemaVersion: 1,
        status: 'SEEDED_AND_VERIFIED',
        targetProjectRef: PRODUCTION_AVAILABILITY_TARGET.projectRef,
        authPolicyReceiptSha256,
        schedule: PRODUCTION_AVAILABILITY_SLOTS,
        timezone: PRODUCTION_AVAILABILITY_TARGET.timezone,
        authUsersRemaining: 2,
        authSessionsRemaining: 0,
        authRefreshTokensRemaining: 0,
        rolloutMigrationsVerified: 25,
        externalProvidersTouched: false,
        verifiedAt: new Date().toISOString(),
    }, null, 2)}\n`, 'utf8');
}
writeFileSync(path.join(outputDir, 'approval-gate.md'), `${[
    '# Production availability approval gate',
    '',
    PRODUCTION_AVAILABILITY_APPROVAL,
    '',
    `- Required inert confirmation: \`${PRODUCTION_AVAILABILITY_INERT_CONFIRMATION_ENV}=${PRODUCTION_AVAILABILITY_INERT_CONFIRMATION}\`.`,
    '- Required receipt: executed `auth-policy-receipt.json`, exact target and closed state.',
    '- A receipt or database drift blocks every write.',
    '',
].join('\n')}\n`, 'utf8');
writeFileSync(path.join(outputDir, 'rollback.md'), `${[
    '# Production availability rollback',
    '',
    '- Plan/preflight need no rollback; a failed SQL statement rolls back the whole insert transaction.',
    '- After commit, deleting the five exact rows requires a new production approval and fresh read-only baseline.',
    '- Never alter Auth, Calendar, bookings, another teacher or staging from this package.',
    '',
].join('\n')}\n`, 'utf8');
writeFileSync(path.join(outputDir, 'summary.md'), `${[
    '# Production availability seed',
    '',
    `- Status: ${status}`,
    `- Closure: ${closure}`,
    `- Mode: ${mode}`,
    `- Target: ${PRODUCTION_AVAILABILITY_TARGET.projectRef}`,
    `- Write outcome: ${writeOutcome}`,
    `- External write performed: ${String(externalWritePerformed)}`,
    `- Auth policy receipt SHA-256: ${authPolicyReceiptSha256 || 'none'}`,
    '',
    '| Status | Check | Message |',
    '| --- | --- | --- |',
    ...checks.map((check) => `| ${check.status} | ${check.name} | ${escapeCell(check.message)} |`),
    '',
].join('\n')}\n`, 'utf8');

console.log(`[launch:production-availability] Status: ${status}`);
console.log(`[launch:production-availability] Closure: ${closure}`);
console.log(`[launch:production-availability] External write performed: ${String(externalWritePerformed)}`);
console.log(`[launch:production-availability] Summary: ${path.join(outputDir, 'summary.md')}`);
if (status === 'FAILED') process.exit(1);

function validateReceipt(filePath: string | undefined): Check {
    if (!filePath) return fail('auth_policy_receipt', 'An executed auth-policy receipt is required.', ['path=missing']);
    try {
        const source = readFileSync(path.resolve(filePath), 'utf8');
        const value: unknown = JSON.parse(source);
        const errors = validateFinalAuthPolicyReceipt(value);
        const parsed = asFinalAuthPolicyReceipt(value);
        if (errors.length === 0 && parsed) {
            authPolicyReceiptSha256 = sha256Availability(source);
            authPolicyReceipt = parsed;
        }
        return errors.length === 0
            ? ok('auth_policy_receipt', 'Exact executed Auth policy receipt permits post-finalization availability.', [
                `sha256=${authPolicyReceiptSha256}`,
            ])
            : fail('auth_policy_receipt', 'Auth policy receipt is invalid or incomplete.', errors);
    } catch {
        return fail('auth_policy_receipt', 'Auth policy receipt could not be parsed.', ['identityValuesPersisted=false']);
    }
}

function validateLocalPosture(): Check {
    const packageJson = JSON.parse(readFileSync(path.join(process.cwd(), 'package.json'), 'utf8')) as { scripts?: Record<string, string> };
    const sql = [preflightPath, applyPath, verifyPath].map((file) => readFileSync(file, 'utf8')).join('\n');
    const required = [
        'BEGIN READ ONLY',
        'Expected exact finalized two-profile Auth policy state',
        'teacher_availability_no_active_overlap',
        "'20260712112000'",
        "'20260712195500'",
    ];
    const missing = required.filter((snippet) => !sql.includes(snippet));
    if (packageJson.scripts?.['launch:production-availability'] !== 'tsx scripts/launch/production-availability-seed.ts') missing.push('package script');
    return missing.length === 0
        ? ok('local_exact_scope', `Exact production artifacts are present (apply sha256=${sha256Availability(readFileSync(applyPath, 'utf8'))}).`, [])
        : fail('local_exact_scope', 'Local production availability package is incomplete.', missing);
}

function runPsql(
    id: string,
    sqlPath: string,
    connectionEnv: NodeJS.ProcessEnv,
    teacherEmail: string,
    writes: boolean,
    identityIds?: ProductionAvailabilityIdentityIds,
): { check: Check; stdout: string; identityIds: ProductionAvailabilityIdentityIds | null } {
    const psqlArgs = [
        '-X', '-w', '-v', 'ON_ERROR_STOP=1', '-v', `expected_teacher_email=${teacherEmail}`,
    ];
    if (identityIds) {
        psqlArgs.push('-v', `expected_admin_id=${identityIds.adminId}`, '-v', `expected_teacher_id=${identityIds.teacherId}`);
    }
    psqlArgs.push('-A', '-t', '-F', '\t', '-f', sqlPath);
    const result = spawnSync('psql', psqlArgs, {
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
    const normalized = normalizeProductionAvailabilityOutput(result.stdout ?? '');
    const stdout = sanitize(normalized.output, teacherEmail, identityIds ?? normalized.identityIds ?? undefined);
    const stderr = sanitize(result.stderr ?? '', teacherEmail, identityIds ?? normalized.identityIds ?? undefined);
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
        identityIds: normalized.identityIds,
        check: result.status === 0 && !result.error
            ? ok(`command_${id}`, `${id} completed.`, [])
            : fail(`command_${id}`, `${id} failed.`, []),
    };
}

function sanitize(
    value: string,
    teacherEmail: string,
    identityIds?: ProductionAvailabilityIdentityIds,
): string {
    let sanitized = value
        .split(teacherEmail).join('[redacted-email]')
        .replace(/postgres(?:ql)?:\/\/[^\s]+/giu, 'postgresql://[redacted]');
    if (identityIds) {
        sanitized = sanitized
            .split(identityIds.adminId).join('[redacted-admin-id]')
            .split(identityIds.teacherId).join('[redacted-teacher-id]');
    }
    return sanitized;
}

function ok(name: string, message: string, details: string[]): Check {
    return { status: 'ok', name, message, details };
}

function fail(name: string, message: string, details: string[]): Check {
    return { status: 'failed', name, message, details };
}

function warning(name: string, message: string, details: string[]): Check {
    return { status: 'warning', name, message, details };
}

function escapeCell(value: string): string {
    return value.replace(/\|/gu, '\\|').replace(/\r?\n/gu, ' ');
}

function stamp(date: Date): string {
    return date.toISOString().replace(/[:.]/gu, '-');
}
