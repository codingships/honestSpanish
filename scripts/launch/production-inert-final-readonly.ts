import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { config as loadDotenv, parse as parseDotenv } from 'dotenv';
import {
    buildDatabaseToolProcessEnvironment,
    sanitizeOutput,
    stableJson,
    type DatabaseConnectionEnvironment,
} from './production-fixture-cleanup-shared';
import {
    createProductionInertFinalAttemptSummary,
    createProductionInertFinalReceipt,
    parseProductionInertFinalArgs,
    parseProductionInertFinalReadback,
    PRODUCTION_INERT_FINAL_DB_URL_ENV,
    PRODUCTION_INERT_FINAL_ATTEMPT_FILE,
    PRODUCTION_INERT_FINAL_OUTPUT_FILE,
    productionInertDatabaseStateSha256,
    renderProductionInertFinalReadbackSql,
    sha256ProductionInertFinal,
    validateProductionInertFinalReadback,
    validateProductionInertFinalReceipt,
    validateProductionInertFinalDatabaseUrl,
    validateProductionInertSourceChain,
    type LoadedReceipt,
    type ProductionInertFinalReceipt,
    type ProductionInertSourceChain,
} from './production-inert-final-readonly-shared';
import { SUPABASE_ACCESS_TOKEN_ENV, verifyLiveProductionAuthInert } from './supabase-auth-config-shared';
import type { FinalAuthPolicyReceipt } from './supabase-production-auth-cleanup-shared';

const root = process.cwd();
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;

void main().catch((error: unknown) => {
    console.error(`[launch:production-inert-final-readonly] ${safeError(error)}`);
    process.exitCode = 1;
});

async function main(): Promise<void> {
    const args = parseProductionInertFinalArgs(process.argv.slice(2));
    const startedAt = new Date();
    const outputDir = path.join(
        root,
        'outputs',
        'launch-production-inert-final-readonly',
        startedAt.toISOString().replace(/[:.]/gu, '-'),
    );
    mkdirSync(outputDir, { recursive: true });

    if (args.mode === 'plan') {
        writePlan(outputDir, startedAt);
        console.log('[launch:production-inert-final-readonly] Status: PLAN_ONLY_NO_NETWORK');
        console.log(`[launch:production-inert-final-readonly] Plan: ${path.join(outputDir, 'plan.json')}`);
        return;
    }

    writeAttemptSummary(outputDir, createProductionInertFinalAttemptSummary({
        status: 'CAPTURE_IN_PROGRESS',
        startedAt,
    }));

    try {
        await captureProductionInertFinal(args, outputDir, startedAt);
    } catch (error) {
        writeAttemptSummary(outputDir, createProductionInertFinalAttemptSummary({
            status: 'CAPTURE_FAILED',
            startedAt,
            finishedAt: new Date(),
            failureCategory: classifySafeFailure(error),
        }));
        throw error;
    }
}

async function captureProductionInertFinal(
    args: ReturnType<typeof parseProductionInertFinalArgs>,
    outputDir: string,
    startedAt: Date,
): Promise<void> {

    const chain: ProductionInertSourceChain = {
        rollout: loadJsonReceipt(args.rolloutReceiptPath, 'production rollout receipt'),
        authPolicy: loadJsonReceipt<FinalAuthPolicyReceipt>(args.authPolicyReceiptPath, 'Auth policy receipt'),
        availability: loadJsonReceipt(args.availabilityReceiptPath, 'production availability receipt'),
    };
    const chainErrors = validateProductionInertSourceChain(chain, startedAt);
    if (chainErrors.length > 0) {
        throw new Error(`Source receipt chain is invalid: ${chainErrors.join(' ')}`);
    }

    loadDotenv({ path: path.join(root, '.env'), override: false, quiet: true });
    const testEmailEnv = readTestEmailEnv();
    const databaseUrl = process.env[PRODUCTION_INERT_FINAL_DB_URL_ENV]?.trim()
        || process.env.SUPABASE_DB_URL?.trim()
        || '';
    if (!databaseUrl) {
        throw new Error(`${PRODUCTION_INERT_FINAL_DB_URL_ENV} (or SUPABASE_DB_URL) is required for capture.`);
    }
    const managementToken = process.env[SUPABASE_ACCESS_TOKEN_ENV]?.trim() ?? '';
    if (!managementToken) throw new Error(`${SUPABASE_ACCESS_TOKEN_ENV} is required for capture.`);
    const expectedAdminEmail = requiredExpectedEmail(
        'TEST_ADMIN_EMAIL',
        process.env.TEST_ADMIN_EMAIL ?? testEmailEnv.TEST_ADMIN_EMAIL,
    );
    const expectedTeacherEmail = requiredExpectedEmail(
        'TEST_TEACHER_EMAIL',
        process.env.TEST_TEACHER_EMAIL ?? testEmailEnv.TEST_TEACHER_EMAIL,
    );
    if (expectedAdminEmail === expectedTeacherEmail) {
        throw new Error('TEST_ADMIN_EMAIL and TEST_TEACHER_EMAIL must be distinct.');
    }
    const connection = validateProductionInertFinalDatabaseUrl(databaseUrl);
    const sql = renderProductionInertFinalReadbackSql();
    const expectedPreservedSetSha256 = chain.authPolicy.value.preservedSetSha256;
    const expectedPreservedRoleBindingSha256 = chain.authPolicy.value.preservedRoleBindingSha256;

    const firstReadback = runDatabaseReadback(connection, sql, expectedAdminEmail, expectedTeacherEmail);
    const firstErrors = validateProductionInertFinalReadback(
        firstReadback,
        expectedPreservedSetSha256,
        expectedPreservedRoleBindingSha256,
    );
    if (firstErrors.length > 0) throw new Error(`First database readback failed: ${firstErrors.join(' ')}`);

    // This exact Management API GET is deliberately sequenced between the two independent DB reads.
    await verifyLiveProductionAuthInert(managementToken);

    const secondReadback = runDatabaseReadback(connection, sql, expectedAdminEmail, expectedTeacherEmail);
    const secondErrors = validateProductionInertFinalReadback(
        secondReadback,
        expectedPreservedSetSha256,
        expectedPreservedRoleBindingSha256,
    );
    if (secondErrors.length > 0) throw new Error(`Second database readback failed: ${secondErrors.join(' ')}`);
    if (productionInertDatabaseStateSha256(firstReadback)
        !== productionInertDatabaseStateSha256(secondReadback)) {
        throw new Error('The two production database readbacks are not stable.');
    }

    const receipt = createProductionInertFinalReceipt({
        chain,
        firstReadback,
        secondReadback,
        observedAt: new Date(),
    });
    const receiptErrors = validateProductionInertFinalReceipt(receipt, new Date(receipt.observedAt));
    if (receiptErrors.length > 0) throw new Error(`Final receipt self-validation failed: ${receiptErrors.join(' ')}`);
    writeReceiptAndSummary(outputDir, receipt, startedAt, new Date());

    console.log('[launch:production-inert-final-readonly] Status: PRODUCTION_INERT_FINAL_READONLY_VERIFIED');
    console.log('[launch:production-inert-final-readonly] External writes: false');
    console.log(`[launch:production-inert-final-readonly] Receipt: ${path.join(outputDir, PRODUCTION_INERT_FINAL_OUTPUT_FILE)}`);
}

function runDatabaseReadback(
    connection: DatabaseConnectionEnvironment,
    sql: string,
    expectedAdminEmail: string,
    expectedTeacherEmail: string,
) {
    const result = spawnSync('psql', [
        '-X',
        '-w',
        '-q',
        '-A',
        '-t',
        '-F',
        '\t',
        '-v',
        'ON_ERROR_STOP=1',
        '-v',
        `expected_admin_email=${expectedAdminEmail}`,
        '-v',
        `expected_teacher_email=${expectedTeacherEmail}`,
        '-f',
        '-',
    ], {
        env: buildDatabaseToolProcessEnvironment(connection, {
            PGOPTIONS: '-c default_transaction_read_only=on -c statement_timeout=30000 -c lock_timeout=5000',
        }),
        input: sql,
        encoding: 'utf8',
        timeout: 45_000,
        windowsHide: true,
    });
    const status = typeof result.status === 'number' ? result.status : null;
    if (result.error || status !== 0) {
        const detail = sanitizeOutput(String(result.stderr ?? result.error ?? 'psql failed'));
        throw new Error(`Read-only psql exited with status ${status ?? 'unknown'}: ${detail}`);
    }
    let rawOutput = String(result.stdout ?? '');
    const readback = parseProductionInertFinalReadback(rawOutput);
    rawOutput = '';
    return readback;
}

function readTestEmailEnv(): Partial<Record<'TEST_ADMIN_EMAIL' | 'TEST_TEACHER_EMAIL', string>> {
    const file = path.join(root, '.env.test');
    if (!existsSync(file)) return {};
    const parsed = parseDotenv(readFileSync(file));
    return {
        TEST_ADMIN_EMAIL: parsed.TEST_ADMIN_EMAIL,
        TEST_TEACHER_EMAIL: parsed.TEST_TEACHER_EMAIL,
    };
}

function requiredExpectedEmail(
    name: 'TEST_ADMIN_EMAIL' | 'TEST_TEACHER_EMAIL',
    rawValue: string | undefined,
): string {
    const value = rawValue?.trim().toLowerCase() ?? '';
    if (!emailPattern.test(value)) throw new Error(`${name} is required for capture and must be a valid email.`);
    return value;
}

function loadJsonReceipt<T = unknown>(filePath: string | null, label: string): LoadedReceipt<T> {
    if (!filePath) throw new Error(`Explicit ${label} path is required.`);
    const absolutePath = path.resolve(filePath);
    if (!existsSync(absolutePath)) throw new Error(`${label} file does not exist.`);
    let bytes: Buffer;
    let value: T;
    try {
        bytes = readFileSync(absolutePath);
        value = JSON.parse(bytes.toString('utf8')) as T;
    } catch {
        throw new Error(`${label} is not valid JSON.`);
    }
    return { value, sha256: sha256ProductionInertFinal(bytes) };
}

function writePlan(outputDir: string, startedAt: Date): void {
    writeFileSync(path.join(outputDir, 'plan.json'), stableJson({
        schemaVersion: 1,
        status: 'PLAN_ONLY_NO_NETWORK',
        mode: 'plan',
        targetEnvironment: 'production',
        requiredExplicitReceiptPaths: [
            '--rollout-receipt',
            '--auth-policy-receipt',
            '--availability-receipt',
        ],
        captureFlag: '--capture-readonly',
        sequence: [
            'validate_exact_receipt_chain_and_targets',
            'production_database_read_only_readback_1',
            'supabase_management_api_get_auth_inert',
            'production_database_read_only_readback_2',
            'verify_stable_aggregate_state_and_emit_fresh_receipt',
        ],
        stableDatabaseReadbacksRequired: 2,
        requiredSecureInputs: [
            PRODUCTION_INERT_FINAL_DB_URL_ENV,
            SUPABASE_ACCESS_TOKEN_ENV,
            'TEST_ADMIN_EMAIL',
            'TEST_TEACHER_EMAIL',
        ],
        receiptFreshnessMinutes: 15,
        rawIdentitiesPersisted: false,
        externalWritePerformed: false,
        networkPerformed: false,
        generatedAt: startedAt.toISOString(),
    }), 'utf8');
}

function writeReceiptAndSummary(
    outputDir: string,
    receipt: ProductionInertFinalReceipt,
    startedAt: Date,
    finishedAt: Date,
): void {
    writeFileSync(path.join(outputDir, PRODUCTION_INERT_FINAL_OUTPUT_FILE), stableJson(receipt), 'utf8');
    writeAttemptSummary(outputDir, createProductionInertFinalAttemptSummary({
        status: receipt.status,
        startedAt,
        finishedAt,
        receipt,
    }));
}

function writeAttemptSummary(
    outputDir: string,
    summary: ReturnType<typeof createProductionInertFinalAttemptSummary>,
): void {
    writeFileSync(path.join(outputDir, PRODUCTION_INERT_FINAL_ATTEMPT_FILE), stableJson(summary), 'utf8');
}

function classifySafeFailure(error: unknown): string {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('Source receipt chain')) return 'SOURCE_CHAIN_INVALID';
    if (message.includes('is required for capture')) return 'REQUIRED_CREDENTIAL_MISSING';
    if (message.includes('database target')) return 'DATABASE_TARGET_REJECTED';
    if (message.includes('database readback') || message.includes('psql')) return 'DATABASE_READBACK_FAILED';
    if (message.includes('Auth') || message.includes('Management API')) return 'AUTH_READBACK_FAILED';
    if (message.includes('receipt')) return 'RECEIPT_VALIDATION_FAILED';
    return 'CAPTURE_FAILED_SAFE';
}

function safeError(error: unknown): string {
    const message = error instanceof Error ? error.message : String(error);
    return sanitizeOutput(message)
        .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/giu, '[redacted-uuid]')
        .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/giu, '[redacted-email]')
        .replace(/(?:sbp_|sb_secret_|eyJ)[A-Za-z0-9._~-]+/giu, '[redacted-secret]');
}
