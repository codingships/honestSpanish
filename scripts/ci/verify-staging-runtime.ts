import { readFileSync, writeFileSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import {
    STAGING_FULFILLMENT_ORIGIN,
    STAGING_WEB_ORIGIN,
    assertStagingRollbackContract,
    assertExpectedStagingRuntimeInput,
    captureStagingRollbackBaseline,
    extractRollbackBindingNamesFromVersionView,
    verifyDeployedStagingRuntime,
    verifyStagingRollbackRuntime,
} from '../smoke/deployed-runtime-safety';

const maxAttempts = (() => {
    const configured = process.env.STAGING_RUNTIME_MAX_ATTEMPTS?.trim();
    if (!configured) return 6;
    const parsed = Number(configured);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 6) {
        throw new Error('STAGING_RUNTIME_MAX_ATTEMPTS must be an integer from 1 to 6.');
    }
    return parsed;
})();
const retryDelayMs = 5_000;
const versionIdPattern = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/iu;
const modeFlags = ['--preflight', '--capture-baseline', '--verify-rollback'] as const;
const valueFlags = [
    '--web-version-id',
    '--fulfillment-version-id',
    '--web-bindings-file',
    '--fulfillment-bindings-file',
    '--output',
    '--contract',
] as const;

function requireValue(name: string): string {
    const value = process.env[name]?.trim() ?? '';
    if (!value) throw new Error(`Staging runtime verification requires ${name}.`);
    return value;
}

function exactStagingOrigin(
    envName: 'STAGING_WEB_URL' | 'STAGING_FULFILLMENT_URL',
    expected: string,
): string {
    const configured = (process.env[envName] ?? expected).trim().replace(/\/$/u, '');
    if (configured !== expected) throw new Error(`${envName} must equal the canonical staging origin.`);
    return configured;
}

function exactVersionId(name: 'STAGING_EXPECTED_WEB_VERSION_ID' | 'STAGING_EXPECTED_FULFILLMENT_VERSION_ID'): string {
    const versionId = requireValue(name);
    if (!versionIdPattern.test(versionId)) {
        throw new Error(`${name} must be an exact Cloudflare Worker version ID.`);
    }
    return versionId;
}

function flagValue(name: string): string {
    const index = process.argv.indexOf(name);
    const value = index >= 0 ? process.argv[index + 1]?.trim() : '';
    if (!value || value.startsWith('--')) throw new Error(`${name} requires a value.`);
    return value;
}

function validatedCliOptions(args: string[]): Set<string> {
    const modes = new Set<string>(modeFlags);
    const values = new Set<string>(valueFlags);
    const provided = new Set<string>();
    const normalizedArgs = args[0] === '--' ? args.slice(1) : args;

    for (let index = 0; index < normalizedArgs.length; index += 1) {
        const argument = normalizedArgs[index]!;
        if (!modes.has(argument) && !values.has(argument)) {
            throw new Error(`Unknown staging runtime verification argument: ${argument}`);
        }
        if (provided.has(argument)) {
            throw new Error(`Staging runtime verification argument was duplicated: ${argument}`);
        }
        provided.add(argument);
        if (values.has(argument)) {
            const value = normalizedArgs[index + 1]?.trim() ?? '';
            if (!value || value.startsWith('--')) throw new Error(`${argument} requires a value.`);
            index += 1;
        }
    }

    const selectedModes = modeFlags.filter((flag) => provided.has(flag));
    if (selectedModes.length > 1) {
        throw new Error('Choose exactly one staging runtime verification mode.');
    }
    const expected = new Set<string>(
        provided.has('--preflight')
            ? ['--preflight']
            : provided.has('--capture-baseline')
                ? [
                    '--capture-baseline',
                    '--web-version-id',
                    '--fulfillment-version-id',
                    '--web-bindings-file',
                    '--fulfillment-bindings-file',
                    '--output',
                ]
                : provided.has('--verify-rollback')
                    ? ['--verify-rollback', '--contract']
                    : [],
    );
    if (
        provided.size !== expected.size
        || [...expected].some((flag) => !provided.has(flag))
    ) {
        throw new Error('Staging runtime verification arguments do not match the selected mode.');
    }
    return provided;
}

function exactVersionArgument(name: '--web-version-id' | '--fulfillment-version-id'): string {
    const versionId = flagValue(name);
    if (!versionIdPattern.test(versionId)) throw new Error(`${name} must be an exact Cloudflare Worker version ID.`);
    return versionId;
}

function readJsonFile(path: string, label: string): unknown {
    try {
        return JSON.parse(readFileSync(path, 'utf8')) as unknown;
    } catch {
        throw new Error(`${label} must be a readable JSON file.`);
    }
}

function readBindingNames(
    path: string,
    label: string,
    expectedVersionId: string,
    role: 'web' | 'fulfillment',
): string[] {
    const parsed = readJsonFile(path, label);
    return extractRollbackBindingNamesFromVersionView(parsed, expectedVersionId, role);
}

function writeRollbackContract(path: string, contract: unknown): void {
    if (!isAbsolute(path)) throw new Error('--output must be an absolute path.');
    writeFileSync(path, `${JSON.stringify(contract, null, 2)}\n`, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
}

const cliOptions = validatedCliOptions(process.argv.slice(2));
const webOrigin = exactStagingOrigin('STAGING_WEB_URL', STAGING_WEB_ORIGIN);
const fulfillmentOrigin = exactStagingOrigin('STAGING_FULFILLMENT_URL', STAGING_FULFILLMENT_ORIGIN);
const roleEmails = [
    requireValue('TEST_STUDENT_EMAIL'),
    requireValue('TEST_TEACHER_EMAIL'),
    requireValue('TEST_ADMIN_EMAIL'),
];

function assertExpectedRuntimeSource(): void {
    assertExpectedStagingRuntimeInput({
        baseOrigin: webOrigin,
        env: process.env,
        fulfillmentOrigin,
        roleEmails,
    });
}

async function verifyStagingRuntimeOnce(
    expectedWebVersionId: string,
    expectedFulfillmentVersionId: string,
): Promise<void> {
    const verified = await verifyDeployedStagingRuntime({
        baseOrigin: webOrigin,
        env: process.env,
        expectedFulfillmentVersionId,
        expectedWebVersionId,
        fulfillmentOrigin,
        roleEmails,
    });
    if (
        verified.webVersionId !== expectedWebVersionId
        || verified.fulfillmentVersionId !== expectedFulfillmentVersionId
    ) {
        throw new Error('Staging runtime did not return the exact versions activated by this deployment.');
    }
}

async function verifyStagingRuntime(
    expectedWebVersionId: string,
    expectedFulfillmentVersionId: string,
): Promise<void> {
    let lastError: unknown;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        try {
            await verifyStagingRuntimeOnce(expectedWebVersionId, expectedFulfillmentVersionId);
            return;
        } catch (error) {
            lastError = error;
            if (attempt < maxAttempts) {
                console.warn(
                    `[verify-staging-runtime] Attempt ${attempt}/${maxAttempts} failed; retrying after propagation delay.`,
                );
                await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
            }
        }
    }

    throw lastError instanceof Error ? lastError : new Error('Staging runtime verification failed.');
}

async function verifyRollbackRuntime(contract: ReturnType<typeof assertStagingRollbackContract>): Promise<void> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        try {
            const verified = await verifyStagingRollbackRuntime({
                baseOrigin: webOrigin,
                contract,
                env: process.env,
                fulfillmentOrigin,
                roleEmails,
            });
            if (verified.webVersionId !== contract.web.workerVersionId
                || verified.fulfillmentVersionId !== contract.fulfillment.workerVersionId) {
                throw new Error('Rollback verification did not return the exact immutable baseline versions.');
            }
            return;
        } catch (error) {
            lastError = error;
            if (attempt < maxAttempts) {
                console.warn(
                    `[verify-staging-runtime] Rollback attempt ${attempt}/${maxAttempts} failed; `
                    + 'retrying after propagation delay.',
                );
                await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
            }
        }
    }
    throw lastError instanceof Error ? lastError : new Error('Staging rollback runtime verification failed.');
}

assertExpectedRuntimeSource();
const preflight = cliOptions.has('--preflight');
const captureBaseline = cliOptions.has('--capture-baseline');
const verifyRollback = cliOptions.has('--verify-rollback');
if (preflight) {
    console.log('[verify-staging-runtime] Complete expected staging runtime contract is present; values withheld.');
} else if (captureBaseline) {
    const expectedWebVersionId = exactVersionArgument('--web-version-id');
    const expectedFulfillmentVersionId = exactVersionArgument('--fulfillment-version-id');
    const contract = await captureStagingRollbackBaseline({
        baseOrigin: webOrigin,
        env: process.env,
        expectedFulfillmentVersionId,
        expectedWebVersionId,
        fulfillmentBindingNames: readBindingNames(
            flagValue('--fulfillment-bindings-file'),
            'Fulfillment baseline bindings',
            expectedFulfillmentVersionId,
            'fulfillment',
        ),
        fulfillmentOrigin,
        roleEmails,
        webBindingNames: readBindingNames(
            flagValue('--web-bindings-file'),
            'Web baseline bindings',
            expectedWebVersionId,
            'web',
        ),
    });
    writeRollbackContract(flagValue('--output'), contract);
    console.log(
        '[verify-staging-runtime] Immutable rollback baseline characterized and written without binding values.',
    );
} else if (verifyRollback) {
    const contract = assertStagingRollbackContract(
        readJsonFile(flagValue('--contract'), 'Staging rollback contract'),
    );
    await verifyRollbackRuntime(contract);
    console.log(
        '[verify-staging-runtime] Exact rollback versions, captured schemas and verification modes passed.',
    );
} else {
    await verifyStagingRuntime(
        exactVersionId('STAGING_EXPECTED_WEB_VERSION_ID'),
        exactVersionId('STAGING_EXPECTED_FULFILLMENT_VERSION_ID'),
    );
    console.log(
        '[verify-staging-runtime] Exact versions and complete HMAC runtime configuration verified; '
        + 'health, internal authorization and disabled checkout probes passed.',
    );
}
