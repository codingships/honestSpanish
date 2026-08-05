import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseMixedJsonOutput } from './verify-cloudflare-identity';
import {
    FULFILLMENT_VERSION_SECRET_NAMES,
    WEB_VERSION_SECRET_NAMES,
} from './write-cloudflare-version-secrets';

export const STAGING_WORKERS = {
    fulfillment: 'espanol-honesto-fulfillment-staging',
    web: 'espanolhonesto-staging',
} as const;

export type StagingWorkerName = typeof STAGING_WORKERS[keyof typeof STAGING_WORKERS];

export interface ActiveStagingVersion {
    percentage: 100;
    versionId: string;
    worker: StagingWorkerName;
}

export interface StagingVersionOwnership {
    message: string;
    tag: string;
    versionId: string;
    worker: StagingWorkerName;
}

export interface StagingVersionSelector {
    message: string;
    tag: string;
    worker: StagingWorkerName;
}

export interface StagingVersionBinding {
    name: string;
    type: string;
}

export interface StagingVersionBindingInventory {
    bindings: StagingVersionBinding[];
    worker: StagingWorkerName;
}

type StagingVersionBindingContract = StagingVersionBinding & {
    environment?: string;
    queue_name?: string;
    service?: string;
    text?: string;
};

const WEB_VERSION_PLAIN_TEXT_BINDINGS = [
    ['CHECKOUT_ENABLED', 'true'],
    ['CHECKOUT_ENABLED_OVERRIDE', 'true'],
    ['EMAIL_DAILY_RECIPIENT_LIMIT', '10'],
    ['EMAIL_DELIVERY_MODE', 'allowlist'],
    ['EMAIL_MONTHLY_RECIPIENT_LIMIT', '100'],
    ['FULFILLMENT_WORKER_URL', 'https://espanol-honesto-fulfillment-staging.alindev95.workers.dev'],
    ['NODE_ENV', 'production'],
    ['PUBLIC_APP_ENV', 'staging'],
    ['PUBLIC_SITE_URL', 'https://staging.espanolhonesto.com'],
    ['PUBLIC_TURNSTILE_SITE_KEY', '1x00000000000000000000AA'],
    ['SENTRY_ENVIRONMENT', 'staging'],
    ['SUPABASE_EXPECTED_PROJECT_REF', 'mzjyvmlxfpzdfdjzxxyj'],
    ['WEB_RUNTIME_MODE', 'active'],
    ['WORKER_IDENTITY', 'espanolhonesto-staging'],
] as const satisfies readonly (readonly [string, string])[];

const FULFILLMENT_VERSION_PLAIN_TEXT_BINDINGS = [
    ['CHECKOUT_ENABLED', 'true'],
    ['CHECKOUT_ENABLED_OVERRIDE', 'true'],
    ['EMAIL_DAILY_RECIPIENT_LIMIT', '10'],
    ['EMAIL_DELIVERY_MODE', 'allowlist'],
    ['EMAIL_MONTHLY_RECIPIENT_LIMIT', '100'],
    ['FULFILLMENT_RUNTIME_MODE', 'active'],
    ['NODE_ENV', 'production'],
    ['PUBLIC_APP_ENV', 'staging'],
    ['PUBLIC_SITE_URL', 'https://staging.espanolhonesto.com'],
    ['SUPABASE_EXPECTED_PROJECT_REF', 'mzjyvmlxfpzdfdjzxxyj'],
    ['WORKER_IDENTITY', 'espanol-honesto-fulfillment-staging'],
] as const satisfies readonly (readonly [string, string])[];

const WEB_VERSION_STRUCTURAL_BINDINGS = [
    ['ASSETS', 'assets'],
    ['CF_VERSION_METADATA', 'version_metadata'],
] as const satisfies readonly (readonly [string, string])[];

const FULFILLMENT_VERSION_STRUCTURAL_BINDINGS = [
    ['CF_VERSION_METADATA', 'version_metadata'],
] as const satisfies readonly (readonly [string, string])[];

function secretBindings(names: readonly string[]): StagingVersionBinding[] {
    return names.map((name) => ({ name, type: 'secret_text' }));
}

function nonSecretBindings(
    entries: readonly (readonly [string, string])[],
): StagingVersionBinding[] {
    return entries.map(([name, type]) => ({ name, type }));
}

function plainTextBindings(
    entries: readonly (readonly [string, string])[],
): StagingVersionBindingContract[] {
    return entries.map(([name, text]) => ({ name, text, type: 'plain_text' }));
}

export const EXPECTED_STAGING_VERSION_BINDINGS = {
    [STAGING_WORKERS.fulfillment]: [
        ...secretBindings(FULFILLMENT_VERSION_SECRET_NAMES),
        ...nonSecretBindings(FULFILLMENT_VERSION_STRUCTURAL_BINDINGS),
        ...plainTextBindings(FULFILLMENT_VERSION_PLAIN_TEXT_BINDINGS),
        {
            name: 'FULFILLMENT_QUEUE',
            queue_name: 'espanol-honesto-fulfillment-staging-queue',
            type: 'queue',
        },
    ],
    [STAGING_WORKERS.web]: [
        ...secretBindings(WEB_VERSION_SECRET_NAMES),
        ...nonSecretBindings(WEB_VERSION_STRUCTURAL_BINDINGS),
        ...plainTextBindings(WEB_VERSION_PLAIN_TEXT_BINDINGS),
        {
            environment: 'production',
            name: 'FULFILLMENT_SERVICE',
            service: STAGING_WORKERS.fulfillment,
            type: 'service',
        },
    ],
} as const satisfies Record<StagingWorkerName, readonly StagingVersionBindingContract[]>;

const versionIdPattern = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/iu;
const commitShaPattern = /^[0-9a-f]{40}$/u;
const stagingWorkerNames = new Set<string>(Object.values(STAGING_WORKERS));

function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function stagingWorkerName(value: string): StagingWorkerName {
    if (!stagingWorkerNames.has(value)) {
        throw new Error('Worker must be one of the two canonical staging Workers.');
    }
    return value as StagingWorkerName;
}

function versionId(value: unknown): string {
    if (typeof value !== 'string' || !versionIdPattern.test(value)) {
        throw new Error('Cloudflare returned an invalid Worker version ID.');
    }
    return value;
}

function percentage(value: unknown): number {
    if (
        (typeof value !== 'number' && typeof value !== 'string')
        || (typeof value === 'string' && value.trim() === '')
    ) {
        throw new Error('Cloudflare returned an invalid deployment percentage.');
    }
    const normalized = Number(value);
    if (!Number.isFinite(normalized) || normalized < 0 || normalized > 100) {
        throw new Error('Cloudflare returned an invalid deployment percentage.');
    }
    return normalized;
}

function validateOwnershipSelector(expected: StagingVersionSelector): StagingVersionSelector {
    const worker = stagingWorkerName(expected.worker);
    if (!commitShaPattern.test(expected.tag)) {
        throw new Error('Expected Worker version tag must be a full lowercase Git commit SHA.');
    }
    if (expected.message.trim() === '') {
        throw new Error('Expected Worker version message must not be empty.');
    }
    return {
        message: expected.message,
        tag: expected.tag,
        worker,
    };
}

export function activeStagingVersion(
    source: string,
    expectedWorker: string,
): ActiveStagingVersion {
    const worker = stagingWorkerName(expectedWorker);
    const deployment = parseMixedJsonOutput(source);
    if (!isRecord(deployment) || !Array.isArray(deployment.versions)) {
        throw new Error('Wrangler deployment status must contain a versions array.');
    }

    const versions = deployment.versions.map((entry) => {
        if (!isRecord(entry)) throw new Error('Wrangler deployment status contains a malformed version.');
        return {
            percentage: percentage(entry.percentage),
            versionId: versionId(entry.version_id),
        };
    });
    const active = versions.filter((entry) => entry.percentage > 0);
    if (active.length !== 1 || active[0]?.percentage !== 100) {
        throw new Error('Staging must have exactly one active Worker version at 100 percent.');
    }

    return {
        percentage: 100,
        versionId: active[0].versionId,
        worker,
    };
}

export function verifyStagingVersionOwnership(
    source: string,
    expected: StagingVersionOwnership,
): StagingVersionOwnership {
    const selector = validateOwnershipSelector(expected);
    const expectedVersionId = versionId(expected.versionId);

    const version = parseMixedJsonOutput(source);
    if (!isRecord(version)) throw new Error('Wrangler version view must return an object.');
    if (versionId(version.id) !== expectedVersionId) {
        throw new Error('Active Worker version does not match the expected version ID.');
    }
    if (!isRecord(version.annotations)) {
        throw new Error('Active Worker version is missing ownership annotations.');
    }
    if (version.annotations['workers/tag'] !== selector.tag) {
        throw new Error('Active Worker version is not tagged with the requested commit.');
    }
    if (version.annotations['workers/message'] !== selector.message) {
        throw new Error('Active Worker version is not owned by this deployment run.');
    }

    return {
        message: selector.message,
        tag: selector.tag,
        versionId: expectedVersionId,
        worker: selector.worker,
    };
}

export function findStagingVersionByOwnership(
    source: string,
    expected: StagingVersionSelector,
): StagingVersionOwnership {
    const selector = validateOwnershipSelector(expected);
    const versions = parseMixedJsonOutput(source);
    if (!Array.isArray(versions)) {
        throw new Error('Wrangler versions list must return an array.');
    }

    const matches = versions.filter((entry) => (
        isRecord(entry)
        && isRecord(entry.annotations)
        && entry.annotations['workers/tag'] === selector.tag
        && entry.annotations['workers/message'] === selector.message
    ));
    if (matches.length !== 1) {
        throw new Error('Wrangler versions list must contain exactly one version owned by this deployment run.');
    }

    return {
        message: selector.message,
        tag: selector.tag,
        versionId: versionId(matches[0]?.id),
        worker: selector.worker,
    };
}

function bindingKey(binding: StagingVersionBinding): string {
    return `${binding.name}\u0000${binding.type}`;
}

function sortedBindings(bindings: readonly StagingVersionBinding[]): StagingVersionBinding[] {
    return [...bindings].sort((left, right) => bindingKey(left).localeCompare(bindingKey(right)));
}

function assertBindingSemantics(
    actual: Record<string, unknown>,
    expected: StagingVersionBindingContract,
): void {
    if (expected.type === 'plain_text' && actual.text !== expected.text) {
        throw new Error(`Worker binding ${expected.name} does not have the exact staging plain-text value.`);
    }
    if (
        expected.type === 'service'
        && (
            actual.service !== expected.service
            || actual.environment !== expected.environment
            || Object.prototype.hasOwnProperty.call(actual, 'entrypoint')
        )
    ) {
        throw new Error(`Worker binding ${expected.name} does not target the exact staging service.`);
    }
    if (expected.type === 'queue' && actual.queue_name !== expected.queue_name) {
        throw new Error(`Worker binding ${expected.name} does not target the exact staging queue.`);
    }
}

export function assertStagingVersionBindingInventory(
    source: string,
    expectedWorker: string,
): StagingVersionBindingInventory {
    const worker = stagingWorkerName(expectedWorker);
    const version = parseMixedJsonOutput(source);
    if (!isRecord(version) || !isRecord(version.resources) || !Array.isArray(version.resources.bindings)) {
        throw new Error('Wrangler version view must contain a resources.bindings array.');
    }

    const seenNames = new Set<string>();
    const rawBindings = version.resources.bindings.map((entry) => {
        if (
            !isRecord(entry)
            || typeof entry.name !== 'string'
            || entry.name.trim() === ''
            || entry.name !== entry.name.trim()
            || typeof entry.type !== 'string'
            || entry.type.trim() === ''
            || entry.type !== entry.type.trim()
        ) {
            throw new Error('Wrangler version view contains a malformed binding.');
        }
        if (seenNames.has(entry.name)) {
            throw new Error('Wrangler version view contains a duplicate binding name.');
        }
        seenNames.add(entry.name);
        return entry;
    });

    const bindings = rawBindings.map((entry) => ({ name: entry.name as string, type: entry.type as string }));

    const contract: readonly StagingVersionBindingContract[] = EXPECTED_STAGING_VERSION_BINDINGS[worker];
    const actual = sortedBindings(bindings);
    const expected = sortedBindings(contract);
    if (
        actual.length !== expected.length
        || actual.some((binding, index) => bindingKey(binding) !== bindingKey(expected[index]!))
    ) {
        throw new Error(`Worker binding inventory does not exactly match the ${worker} staging contract.`);
    }

    const expectedByName = new Map<string, StagingVersionBindingContract>(
        contract.map((binding) => [binding.name, binding]),
    );
    for (const binding of rawBindings) {
        assertBindingSemantics(binding, expectedByName.get(binding.name as string)!);
    }

    return { bindings: actual, worker };
}

type CliOptions = Record<string, string>;

function parseOptions(args: string[], allowed: readonly string[]): CliOptions {
    const allowedOptions = new Set(allowed);
    const options: CliOptions = {};

    for (let index = 0; index < args.length; index += 1) {
        const argument = args[index];
        if (!allowedOptions.has(argument)) throw new Error('Unknown command-line argument.');
        if (options[argument] !== undefined) throw new Error('Command-line argument was provided more than once.');

        const value = args[index + 1];
        if (!value || value.startsWith('--')) throw new Error('A command-line argument value is missing.');
        options[argument] = value;
        index += 1;
    }

    for (const argument of allowed) {
        if (options[argument] === undefined) throw new Error('A required command-line argument is missing.');
    }
    return options;
}

function inputSource(file: string): string {
    try {
        return readFileSync(file, 'utf8');
    } catch {
        throw new Error('Unable to read the Wrangler state input file.');
    }
}

export function runCloudflareStagingStateCli(args: string[]): void {
    const [command, ...optionArgs] = args;
    if (command === 'active') {
        const options = parseOptions(optionArgs, ['--input', '--worker']);
        const active = activeStagingVersion(
            inputSource(options['--input']),
            options['--worker'],
        );
        console.log(active.versionId);
        return;
    }

    if (command === 'assert-owned') {
        const options = parseOptions(optionArgs, [
            '--input',
            '--worker',
            '--version-id',
            '--tag',
            '--message',
        ]);
        verifyStagingVersionOwnership(inputSource(options['--input']), {
            message: options['--message'],
            tag: options['--tag'],
            versionId: options['--version-id'],
            worker: stagingWorkerName(options['--worker']),
        });
        console.log('Cloudflare staging version ownership verification passed.');
        return;
    }

    if (command === 'find-owned') {
        const options = parseOptions(optionArgs, [
            '--input',
            '--worker',
            '--tag',
            '--message',
        ]);
        const owned = findStagingVersionByOwnership(inputSource(options['--input']), {
            message: options['--message'],
            tag: options['--tag'],
            worker: stagingWorkerName(options['--worker']),
        });
        console.log(owned.versionId);
        return;
    }

    if (command === 'assert-bindings') {
        const options = parseOptions(optionArgs, ['--input', '--worker']);
        assertStagingVersionBindingInventory(
            inputSource(options['--input']),
            options['--worker'],
        );
        console.log('Cloudflare staging binding inventory verification passed.');
        return;
    }

    throw new Error('Use the active, find-owned, assert-owned or assert-bindings command.');
}

const invokedScriptPath = process.argv[1];
if (invokedScriptPath && import.meta.url === pathToFileURL(path.resolve(invokedScriptPath)).href) {
    try {
        runCloudflareStagingStateCli(process.argv.slice(2));
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Cloudflare staging state verification failed.';
        console.error(`[cloudflare-staging-state] ${message}`);
        process.exitCode = 1;
    }
}
