import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
    PRODUCTION_QUEUE_APPROVAL_ENV,
    PRODUCTION_QUEUE_APPROVAL_SENTENCE,
    PRODUCTION_QUEUE_TARGET,
    classifyQueueInventory,
    queueRowsInPage,
    stripAnsi,
    validateProductionQueueConfig,
    type QueueInventory,
} from './cloudflare-production-queue-shared';

type CheckStatus = 'ok' | 'failed';
type ClosureStatus = 'PLAN_READY' | 'VERIFIED_EXISTING' | 'PROVISIONED' | 'BLOCKED' | 'PARTIAL_WRITE_STOP';

interface Check {
    status: CheckStatus;
    name: string;
    message: string;
    details: string[];
}

interface CommandSpec {
    id: string;
    args: string[];
    writesCloudflare: boolean;
}

interface CommandCapture extends CommandSpec {
    display: string;
    exitCode: number | null;
    status: CheckStatus;
    outputPath: string;
    stdout: string;
    stderr: string;
}

interface InventoryResult {
    status: CheckStatus;
    inventory: QueueInventory;
    combinedOutput: string;
    pagesRead: number;
}

const supportedArguments = new Set(['--execute-approved', '--verify-existing']);
const unsupportedArguments = process.argv.slice(2).filter((argument) => !supportedArguments.has(argument));
if (unsupportedArguments.length > 0) {
    throw new Error(`Unsupported argument(s): ${unsupportedArguments.join(', ')}`);
}

const executeRequested = process.argv.includes('--execute-approved');
const verifyExistingRequested = process.argv.includes('--verify-existing');
if (executeRequested && verifyExistingRequested) {
    throw new Error('--execute-approved and --verify-existing are mutually exclusive');
}
const startedAt = new Date();
const outputDir = path.join(
    process.cwd(),
    'outputs',
    'launch-cloudflare-production-queues',
    stamp(startedAt),
);
mkdirSync(outputDir, { recursive: true });

const checks: Check[] = [];
const captures: CommandCapture[] = [];
const createdQueues: string[] = [];
let remoteReadPerformed = false;
let externalWriteAttempted = false;
let externalWritePerformed = false;
let closureStatus: ClosureStatus = 'BLOCKED';

checks.push(validateLocalConfig());
checks.push(validateLocalAccountEnvironment());

if (checks.every((check) => check.status === 'ok')) {
    await runRemotePreflightAndMaybeProvision();
} else {
    checks.push(failed('local_preflight_gate', 'Local config/account validation failed; no Cloudflare command was run.', [
        'remoteReadPerformed=false',
        'externalWriteAttempted=false',
    ]));
}

const status = checks.some((check) => check.status === 'failed') ? 'FAILED' : 'OK';
if (status === 'OK' && verifyExistingRequested) closureStatus = 'VERIFIED_EXISTING';
else if (status === 'OK' && executeRequested) closureStatus = 'PROVISIONED';
else if (status === 'OK') closureStatus = 'PLAN_READY';
else if (externalWritePerformed) closureStatus = 'PARTIAL_WRITE_STOP';

const artifacts = {
    approvalGate: path.join(outputDir, 'approval-gate.md'),
    commandManifest: path.join(outputDir, 'command-manifest.json'),
    summaryJson: path.join(outputDir, 'summary.json'),
    summaryMarkdown: path.join(outputDir, 'summary.md'),
};

const report = {
    schemaVersion: 1,
    startedAt: startedAt.toISOString(),
    endedAt: new Date().toISOString(),
    status,
    closureStatus,
    target: PRODUCTION_QUEUE_TARGET,
    executeRequested,
    verifyExistingRequested,
    remoteReadPerformed,
    externalWriteAttempted,
    externalWritePerformed,
    approval: {
        environmentVariable: PRODUCTION_QUEUE_APPROVAL_ENV,
        exactSentence: PRODUCTION_QUEUE_APPROVAL_SENTENCE,
        requiredFlag: '--execute-approved',
    },
    createdQueues,
    checks,
    commands: captures.map((capture) => ({
        id: capture.id,
        display: capture.display,
        writesCloudflare: capture.writesCloudflare,
        status: capture.status,
        exitCode: capture.exitCode,
        outputPath: relative(capture.outputPath),
    })),
    forbiddenScope: [
        'Worker deploys or version changes',
        'manual Queue consumers',
        'Queue deletion, purge, pause or resume',
        'staging Queues or Workers',
        'any Queue other than the two exact production names',
        'secrets, DNS, domains, Pages, Supabase, Stripe, Google or Resend',
    ],
};

writeFileSync(artifacts.approvalGate, renderApprovalGate(), 'utf8');
writeFileSync(artifacts.commandManifest, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
writeFileSync(artifacts.summaryJson, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
writeFileSync(artifacts.summaryMarkdown, renderSummary(report), 'utf8');

console.log(`[launch:cloudflare-production-queues] Status: ${status}`);
console.log(`[launch:cloudflare-production-queues] Closure: ${closureStatus}`);
console.log(`[launch:cloudflare-production-queues] Remote read performed: ${String(remoteReadPerformed)}`);
console.log(`[launch:cloudflare-production-queues] External write attempted: ${String(externalWriteAttempted)}`);
console.log(`[launch:cloudflare-production-queues] External write performed: ${String(externalWritePerformed)}`);
console.log(`[launch:cloudflare-production-queues] Summary: ${artifacts.summaryMarkdown}`);

if (status === 'FAILED') process.exit(1);

async function runRemotePreflightAndMaybeProvision(): Promise<void> {
    const whoami = runCommand(readCommand('cloudflare-whoami', ['whoami', '--json']));
    captures.push(whoami);
    remoteReadPerformed = true;
    checks.push(commandCheck(whoami));
    if (whoami.status === 'failed') return;

    const accountMatches = stripAnsi(whoami.stdout).includes(PRODUCTION_QUEUE_TARGET.accountId);
    checks.push(accountMatches
        ? ok('exact_cloudflare_account', 'Wrangler authentication includes the exact approved Cloudflare account.', [
            `accountId=${PRODUCTION_QUEUE_TARGET.accountId}`,
        ])
        : failed('exact_cloudflare_account', 'Wrangler authentication does not prove the exact approved account.', [
            `expectedAccountId=${PRODUCTION_QUEUE_TARGET.accountId}`,
            'externalWriteAttempted=false',
        ]));
    if (!accountMatches) return;

    const before = readQueueInventory('queues-before');
    checks.push(inventoryCommandCheck('queue_inventory_before', before));
    if (before.status === 'failed') return;

    if (verifyExistingRequested) {
        const exactExistingState = before.inventory.queueCount === 1
            && before.inventory.deadLetterQueueCount === 1;
        checks.push(exactExistingState
            ? ok('exact_existing_inventory_gate', 'Both exact production Queue resources exist once.', [
                `queue=${PRODUCTION_QUEUE_TARGET.queue}:present_once`,
                `dlq=${PRODUCTION_QUEUE_TARGET.deadLetterQueue}:present_once`,
                `pagesRead=${before.pagesRead}`,
            ])
            : failed('exact_existing_inventory_gate', 'Read-only verification requires exactly one production Queue and one DLQ.', [
                `queueCount=${before.inventory.queueCount}`,
                `dlqCount=${before.inventory.deadLetterQueueCount}`,
                'externalWriteAttempted=false',
            ]));
        if (!exactExistingState) return;

        const queueInfo = runCommand(readCommand('production-queue-info-verify-existing', [
            'queues',
            'info',
            PRODUCTION_QUEUE_TARGET.queue,
        ]));
        const dlqInfo = runCommand(readCommand('production-dlq-info-verify-existing', [
            'queues',
            'info',
            PRODUCTION_QUEUE_TARGET.deadLetterQueue,
        ]));
        captures.push(queueInfo, dlqInfo);
        checks.push(commandCheck(queueInfo), commandCheck(dlqInfo));
        if (queueInfo.status === 'failed' || dlqInfo.status === 'failed') return;

        closureStatus = 'VERIFIED_EXISTING';
        checks.push(ok('verify_existing_read_only', 'Existing production Queue resources were verified without writes.', [
            'verifyExistingRequested=true',
            'remoteReadPerformed=true',
            'externalWriteAttempted=false',
            'externalWritePerformed=false',
        ]));
        return;
    }

    const clear = before.inventory.clearForProvision
        && before.inventory.queueCount === 0
        && before.inventory.deadLetterQueueCount === 0;
    checks.push(clear
        ? ok('exact_name_collision_gate', 'Neither exact production Queue name exists before provisioning.', [
            `queue=${PRODUCTION_QUEUE_TARGET.queue}:absent`,
            `dlq=${PRODUCTION_QUEUE_TARGET.deadLetterQueue}:absent`,
            `pagesRead=${before.pagesRead}`,
        ])
        : failed('exact_name_collision_gate', 'At least one exact production Queue name already exists; provisioning stops before writes.', [
            `queueCount=${before.inventory.queueCount}`,
            `dlqCount=${before.inventory.deadLetterQueueCount}`,
            'manualReviewRequired=true',
            'externalWriteAttempted=false',
        ]));
    if (!clear) return;

    if (!executeRequested) {
        closureStatus = 'PLAN_READY';
        checks.push(ok('plan_mode_read_only', 'Plan mode completed Cloudflare identity and full Queue inventory reads only.', [
            'executeRequested=false',
            'remoteReadPerformed=true',
            'externalWriteAttempted=false',
            `futureGate=${PRODUCTION_QUEUE_APPROVAL_ENV}`,
        ]));
        return;
    }

    const approvalMatches = process.env[PRODUCTION_QUEUE_APPROVAL_ENV]?.trim() === PRODUCTION_QUEUE_APPROVAL_SENTENCE;
    checks.push(approvalMatches
        ? ok('exact_approval_gate', 'Exact approval sentence and execute flag match the two-Queue scope.', [
            `approvalEnv=${PRODUCTION_QUEUE_APPROVAL_ENV}`,
            'flag=--execute-approved',
        ])
        : failed('exact_approval_gate', 'Exact approval sentence is missing or mismatched; no write may start.', [
            `approvalEnv=${PRODUCTION_QUEUE_APPROVAL_ENV}`,
            'externalWriteAttempted=false',
        ]));
    if (!approvalMatches) return;

    externalWriteAttempted = true;
    const createDlq = runCommand(writeCommand('create-production-dlq', [
        'queues',
        'create',
        PRODUCTION_QUEUE_TARGET.deadLetterQueue,
    ]));
    captures.push(createDlq);
    checks.push(commandCheck(createDlq));
    if (createDlq.status === 'failed') return;
    externalWritePerformed = true;
    createdQueues.push(PRODUCTION_QUEUE_TARGET.deadLetterQueue);

    const dlqInfo = runCommand(readCommand('production-dlq-info-after-create', [
        'queues',
        'info',
        PRODUCTION_QUEUE_TARGET.deadLetterQueue,
    ]));
    captures.push(dlqInfo);
    checks.push(commandCheck(dlqInfo));
    if (dlqInfo.status === 'failed') return;

    const between = readQueueInventory('queues-after-dlq');
    checks.push(inventoryCommandCheck('queue_inventory_after_dlq', between));
    if (between.status === 'failed') return;
    const exactIntermediateState = between.inventory.deadLetterQueueCount === 1
        && between.inventory.queueCount === 0;
    checks.push(exactIntermediateState
        ? ok('dlq_first_verified', 'The DLQ exists exactly once and the primary Queue is still absent.', [
            `dlq=${PRODUCTION_QUEUE_TARGET.deadLetterQueue}`,
            'creationOrder=DLQ_FIRST',
        ])
        : failed('dlq_first_verified', 'Post-DLQ state is unexpected; primary Queue creation is blocked.', [
            `queueCount=${between.inventory.queueCount}`,
            `dlqCount=${between.inventory.deadLetterQueueCount}`,
            'partialWrite=true',
        ]));
    if (!exactIntermediateState) return;

    const createQueue = runCommand(writeCommand('create-production-queue', [
        'queues',
        'create',
        PRODUCTION_QUEUE_TARGET.queue,
    ]));
    captures.push(createQueue);
    checks.push(commandCheck(createQueue));
    if (createQueue.status === 'failed') return;
    createdQueues.push(PRODUCTION_QUEUE_TARGET.queue);

    const queueInfo = runCommand(readCommand('production-queue-info-after-create', [
        'queues',
        'info',
        PRODUCTION_QUEUE_TARGET.queue,
    ]));
    const finalDlqInfo = runCommand(readCommand('production-dlq-info-final', [
        'queues',
        'info',
        PRODUCTION_QUEUE_TARGET.deadLetterQueue,
    ]));
    captures.push(queueInfo, finalDlqInfo);
    checks.push(commandCheck(queueInfo), commandCheck(finalDlqInfo));
    if (queueInfo.status === 'failed' || finalDlqInfo.status === 'failed') return;

    const after = readQueueInventory('queues-after-both');
    checks.push(inventoryCommandCheck('queue_inventory_after_both', after));
    if (after.status === 'failed') return;
    const exactFinalState = after.inventory.queueCount === 1
        && after.inventory.deadLetterQueueCount === 1
        && createdQueues.join('|') === `${PRODUCTION_QUEUE_TARGET.deadLetterQueue}|${PRODUCTION_QUEUE_TARGET.queue}`;
    checks.push(exactFinalState
        ? ok('two_queue_post_write_verification', 'Both exact Queue resources exist once, in the approved creation order.', [
            `created=${createdQueues.join(' -> ')}`,
            'WorkerDeployPerformed=false',
            'ManualConsumerAdded=false',
        ])
        : failed('two_queue_post_write_verification', 'The final Queue inventory/order is not exact; stop without further writes.', [
            `queueCount=${after.inventory.queueCount}`,
            `dlqCount=${after.inventory.deadLetterQueueCount}`,
            `created=${createdQueues.join(' -> ') || '<none>'}`,
        ]));
}

function readQueueInventory(idPrefix: string): InventoryResult {
    const outputs: string[] = [];
    let pagesRead = 0;
    for (let page = 1; page <= 500; page += 1) {
        const capture = runCommand(readCommand(`${idPrefix}-page-${page}`, [
            'queues',
            'list',
            '--page',
            String(page),
        ]));
        captures.push(capture);
        remoteReadPerformed = true;
        pagesRead = page;
        if (capture.status === 'failed') {
            return {
                status: 'failed',
                inventory: classifyQueueInventory(outputs.join('\n')),
                combinedOutput: outputs.join('\n'),
                pagesRead,
            };
        }
        outputs.push(capture.stdout, capture.stderr);
        if (queueRowsInPage(capture.stdout) === 0) {
            const combinedOutput = outputs.join('\n');
            return {
                status: 'ok',
                inventory: classifyQueueInventory(combinedOutput),
                combinedOutput,
                pagesRead,
            };
        }
    }

    return {
        status: 'failed',
        inventory: classifyQueueInventory(outputs.join('\n')),
        combinedOutput: outputs.join('\n'),
        pagesRead,
    };
}

function validateLocalConfig(): Check {
    const config = PRODUCTION_QUEUE_TARGET.config;
    if (!existsSync(config)) {
        return failed('production_queue_config', 'Fulfillment Wrangler config is missing.', [`file=${config}`]);
    }
    const validation = validateProductionQueueConfig(readFileSync(config, 'utf8'));
    return validation.valid
        ? ok('production_queue_config', 'Only env.production active contains the exact Queue producer/consumer and retry posture.', [
            `file=${config}`,
            `queue=${PRODUCTION_QUEUE_TARGET.queue}`,
            `dlq=${PRODUCTION_QUEUE_TARGET.deadLetterQueue}`,
            'max_batch_size=1',
            'max_batch_timeout=1',
            'max_concurrency=1',
            'max_retries=5',
            'retry_delay=30',
            'production_bootstrap_queue_bindings=0',
        ])
        : failed('production_queue_config', 'Fulfillment production Queue config is missing or leaks into bootstrap/non-production scope.', validation.errors);
}

function validateLocalAccountEnvironment(): Check {
    const configured = process.env.CLOUDFLARE_ACCOUNT_ID?.trim();
    const valid = !configured || configured === PRODUCTION_QUEUE_TARGET.accountId;
    return valid
        ? ok('local_account_environment', 'Local account override is absent or matches the exact production account.', [
            `expected=${PRODUCTION_QUEUE_TARGET.accountId}`,
        ])
        : failed('local_account_environment', 'CLOUDFLARE_ACCOUNT_ID points at a different account; no remote command may run.', [
            `expected=${PRODUCTION_QUEUE_TARGET.accountId}`,
            'configuredAccountIdMismatch=true',
        ]);
}

function readCommand(id: string, args: string[]): CommandSpec {
    return { id, args, writesCloudflare: false };
}

function writeCommand(id: string, args: string[]): CommandSpec {
    return { id, args, writesCloudflare: true };
}

function runCommand(spec: CommandSpec): CommandCapture {
    assertCommandScope(spec);
    const wranglerArgs = [...spec.args, '--install-skills=false'];
    const display = `corepack pnpm --config.verify-deps-before-run=false exec wrangler ${wranglerArgs.join(' ')}`;
    const result = spawnSync(process.platform === 'win32' ? 'corepack.cmd' : 'corepack', [
        'pnpm',
        '--config.verify-deps-before-run=false',
        'exec',
        'wrangler',
        ...wranglerArgs,
    ], {
        cwd: process.cwd(),
        encoding: 'utf8',
        env: {
            ...process.env,
            CLOUDFLARE_ACCOUNT_ID: PRODUCTION_QUEUE_TARGET.accountId,
        },
        timeout: 90_000,
        windowsHide: true,
        shell: process.platform === 'win32',
    });
    const status: CheckStatus = result.status === 0 && !result.error ? 'ok' : 'failed';
    const outputPath = path.join(outputDir, `${spec.id}.txt`);
    writeFileSync(outputPath, [
        `command=${display}`,
        `writesCloudflare=${String(spec.writesCloudflare)}`,
        `exitCode=${String(result.status)}`,
        `status=${status}`,
        '',
        '# stdout',
        sanitize(result.stdout ?? ''),
        '',
        '# stderr',
        sanitize(result.stderr ?? ''),
    ].join('\n'), 'utf8');
    return {
        ...spec,
        display,
        exitCode: result.status,
        status,
        outputPath,
        stdout: result.stdout ?? '',
        stderr: result.stderr ?? '',
    };
}

function assertCommandScope(spec: CommandSpec): void {
    const [group, action, name] = spec.args;
    const allowedRead = (
        group === 'whoami'
        && action === '--json'
    ) || (
        group === 'queues'
        && action === 'list'
        && spec.args[2] === '--page'
        && /^\d+$/u.test(spec.args[3] ?? '')
    ) || (
        group === 'queues'
        && action === 'info'
        && (name === PRODUCTION_QUEUE_TARGET.queue || name === PRODUCTION_QUEUE_TARGET.deadLetterQueue)
    );
    const allowedWrite = group === 'queues'
        && action === 'create'
        && (name === PRODUCTION_QUEUE_TARGET.queue || name === PRODUCTION_QUEUE_TARGET.deadLetterQueue)
        && spec.args.length === 3;

    if (spec.writesCloudflare ? !allowedWrite : !allowedRead) {
        throw new Error(`Command scope rejected: ${spec.id}`);
    }
}

function commandCheck(capture: CommandCapture): Check {
    return capture.status === 'ok'
        ? ok(`command_${capture.id}`, 'Allowlisted Wrangler command completed.', [
            `writesCloudflare=${String(capture.writesCloudflare)}`,
            `capture=${relative(capture.outputPath)}`,
        ])
        : failed(`command_${capture.id}`, 'Allowlisted Wrangler command failed or timed out.', [
            `writesCloudflare=${String(capture.writesCloudflare)}`,
            `capture=${relative(capture.outputPath)}`,
        ]);
}

function inventoryCommandCheck(name: string, result: InventoryResult): Check {
    return result.status === 'ok'
        ? ok(name, 'All Queue inventory pages were read successfully.', [
            `pagesRead=${result.pagesRead}`,
            `queueCount=${result.inventory.queueCount}`,
            `dlqCount=${result.inventory.deadLetterQueueCount}`,
        ])
        : failed(name, 'Queue inventory pagination failed or exceeded the 10,000-Queue account limit.', [
            `pagesRead=${result.pagesRead}`,
            'externalWriteBlocked=true',
        ]);
}

function sanitize(value: string): string {
    const privateKeyHeader = ['-----BEGIN', '[A-Z ]+', 'PRIVATE', 'KEY-----'].join(' ');
    const privateKeyFooter = ['-----END', '[A-Z ]+', 'PRIVATE', 'KEY-----'].join(' ');
    const privateKeyBlock = new RegExp(`${privateKeyHeader}[\\s\\S]*?${privateKeyFooter}`, 'gu');
    return stripAnsi(value)
        .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/giu, '[redacted-email]')
        .replace(/Bearer\s+[A-Za-z0-9._-]{12,}/giu, 'Bearer [redacted]')
        .replace(privateKeyBlock, '[redacted-private-key]')
        .replace(/\b(?:token|secret|password)\s*[=:]\s*\S+/giu, '[redacted-sensitive-value]');
}

function renderApprovalGate(): string {
    return `${[
        '# Cloudflare Production Queue Provision Approval Gate',
        '',
        'This file is not approval.',
        '',
        `- Exact account: \`${PRODUCTION_QUEUE_TARGET.accountId}\`.`,
        `- First resource: \`${PRODUCTION_QUEUE_TARGET.deadLetterQueue}\`.`,
        `- Second resource: \`${PRODUCTION_QUEUE_TARGET.queue}\`.`,
        `- Required flag: \`--execute-approved\`.`,
        '- Read-only post-provision verification flag: `--verify-existing` (mutually exclusive with execution).',
        `- Required environment variable: \`${PRODUCTION_QUEUE_APPROVAL_ENV}\`.`,
        '',
        '## Exact Approval Sentence',
        '',
        PRODUCTION_QUEUE_APPROVAL_SENTENCE,
        '',
        '## Safety Boundary',
        '',
        '- Plan mode performs only Wrangler identity and Queue inventory reads.',
        '- `--verify-existing` performs identity, full inventory and exact Queue info reads; it requires both exact resources once and never enters the create branch.',
        '- Any pre-existing exact target name blocks creation and requires manual review.',
        '- Execution creates the DLQ first, verifies it, then creates the primary Queue and verifies both.',
        '- No cleanup is automatic after a partial write; stop and request separate authority.',
        '- No Worker deploy, consumer mutation, secret operation, staging change or third Queue operation is allowlisted.',
        '',
    ].join('\n')}\n`;
}

function renderSummary(value: typeof report): string {
    return `${[
        '# Cloudflare Production Queues Summary',
        '',
        `- Status: ${value.status}`,
        `- Closure: ${value.closureStatus}`,
        `- Exact account: ${value.target.accountId}`,
        `- Queue: ${value.target.queue}`,
        `- DLQ: ${value.target.deadLetterQueue}`,
        `- Execute requested: ${String(value.executeRequested)}`,
        `- Verify existing requested: ${String(value.verifyExistingRequested)}`,
        `- Remote read performed: ${String(value.remoteReadPerformed)}`,
        `- External write attempted: ${String(value.externalWriteAttempted)}`,
        `- External write performed: ${String(value.externalWritePerformed)}`,
        `- Created resources: ${value.createdQueues.join(' -> ') || '<none>'}`,
        '',
        '| Status | Check | Message | Details |',
        '| --- | --- | --- | --- |',
        ...value.checks.map((check) => `| ${check.status} | ${check.name} | ${escapeCell(check.message)} | ${escapeCell(check.details.join(' / '))} |`),
        '',
    ].join('\n')}\n`;
}

function ok(name: string, message: string, details: string[]): Check {
    return { status: 'ok', name, message, details };
}

function failed(name: string, message: string, details: string[]): Check {
    return { status: 'failed', name, message, details };
}

function relative(filePath: string): string {
    return path.relative(process.cwd(), filePath).split(path.sep).join('/');
}

function stamp(date: Date): string {
    return date.toISOString().replace(/[:.]/gu, '-');
}

function escapeCell(value: string): string {
    return value.replace(/\|/gu, '\\|').replace(/\r?\n/gu, ' ');
}
