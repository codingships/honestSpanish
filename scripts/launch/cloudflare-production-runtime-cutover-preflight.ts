import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

type CheckStatus = 'ok' | 'warning' | 'failed';

interface Target {
    accountId: string;
    accountLabel: string;
    productionWorker: string;
    stagingWorker: string;
    pagesProject: string;
    customDomains: string[];
}

interface CaptureConfig {
    id: string;
    label: string;
    args: string[];
    expectJson?: boolean;
    allowFailure?: boolean;
    timeoutMs?: number;
    skip?: boolean;
    skipReason?: string;
}

interface Capture {
    id: string;
    label: string;
    command: string;
    exitCode: number | null;
    status: CheckStatus;
    message: string;
    outputPath: string;
    stdoutSha256: string;
    stderrSha256: string;
    parsedJson: unknown | null;
    summary: Record<string, unknown>;
}

interface Check {
    status: CheckStatus;
    name: string;
    message: string;
    details: string[];
}

interface MatrixEntry {
    name: string;
    target: string;
    required: string;
    kind: string;
    phase: string;
    purpose: string;
    sensitivity: string;
    valuePolicy: string;
    inWranglerToml: boolean;
    inLocalEnv: boolean;
    observedProductionWorker: string;
}

interface Report {
    schemaVersion: 1;
    generatedAt: string;
    status: 'OK' | 'WARNING' | 'FAILED';
    outputDir: string;
    remoteWritePerformed: false;
    externalScope: string;
    targetAccountId: string;
    targetWorker: string;
    checkoutEnabledFalseInConfig: boolean;
    dryRunAfterBuildLooksSuccessful: boolean;
    dryRunMentionsCheckoutFalse: boolean;
    dryRunMentionsNoCustomDomains: boolean;
    productionSecretListSucceeded: boolean;
    productionSecretListOutputShape: string;
    stagingSecretListShape: string;
    distExistedBefore: boolean;
    distRemovedAfterDryRun: boolean;
    distCleanupMessage: string;
    captures: Array<{ path: string; name: string; exitCode: number | null; status: CheckStatus }>;
    checks: Check[];
    variableMatrixPath: string;
    variableMatrixJsonPath: string;
    summaryPath: string;
    manifestPath: string;
    phase2AstroWorkerNamesToLoad: string[];
    fulfillmentOnlyNamesNotForAstroWorker: string[];
}

const target: Target = {
    accountId: 'd1a22bcf6477ff2ff31d2bfb83084e44',
    accountLabel: "Alindev95@gmail.com's Account",
    productionWorker: 'espanolhonesto',
    stagingWorker: 'espanolhonesto-staging',
    pagesProject: 'espanolhonesto',
    customDomains: ['espanolhonesto.com', 'www.espanolhonesto.com'],
};

const startedAt = new Date();
const outputDir = path.join(process.cwd(), 'outputs', 'launch-cloudflare-production-runtime-cutover-preflight', stamp(startedAt));
const distPath = path.resolve(process.cwd(), 'dist');
const distExistedBefore = existsSync(distPath);

mkdirSync(outputDir, { recursive: true });

const captures: Capture[] = [];
captures.push(runCapture({
    id: 'wrangler-version',
    label: 'Wrangler version',
    args: pnpmArgs('exec', 'wrangler', '--version'),
    timeoutMs: 45_000,
}));
captures.push(runCapture({
    id: 'wrangler-whoami',
    label: 'Wrangler auth/account',
    args: pnpmArgs('exec', 'wrangler', 'whoami', '--json'),
    expectJson: true,
    timeoutMs: 45_000,
}));
captures.push(runCapture({
    id: 'wrangler-secret-list-production',
    label: 'Production Worker secret-name list',
    args: pnpmArgs('exec', 'wrangler', 'secret', 'list', '--name', target.productionWorker, '--format', 'json'),
    expectJson: true,
    allowFailure: true,
    timeoutMs: 45_000,
}));
captures.push(runCapture({
    id: 'wrangler-secret-list-staging',
    label: 'Staging Worker secret-name list',
    args: pnpmArgs('exec', 'wrangler', 'secret', 'list', '--name', target.stagingWorker, '--format', 'json'),
    expectJson: true,
    allowFailure: true,
    timeoutMs: 45_000,
}));
captures.push(runCapture({
    id: 'pnpm-build',
    label: 'Explicit local production release build',
    args: pnpmArgs('run', 'build:production:release'),
    timeoutMs: 240_000,
}));

const buildCapture = captureById('pnpm-build');
captures.push(runCapture({
    id: 'wrangler-deploy-production-dry-run-after-build',
    label: 'Wrangler production deploy dry-run after build',
    args: pnpmArgs('exec', 'wrangler', 'deploy', '--config', 'dist/server/wrangler.json', '--dry-run'),
    timeoutMs: 180_000,
    skip: buildCapture?.exitCode !== 0,
    skipReason: 'Skipped because the local build did not complete successfully.',
}));

const cleanupCapture = cleanupDistAfterDryRun();
captures.push(cleanupCapture);

const wrangler = readIfExists('wrangler.toml');
const checkoutEnabledFalseInConfig = checkoutFalseCount(wrangler) >= 3;
const safeBaseWorkerNameConfigured = /^name\s*=\s*"espanolhonesto-env-required"/mu.test(wrangler);
const dryRunCapture = captureById('wrangler-deploy-production-dry-run-after-build');
const dryRunOutput = dryRunCapture ? captureText(dryRunCapture) : '';
const dryRunAfterBuildLooksSuccessful = Boolean(
    dryRunCapture?.exitCode === 0
    && /--dry-run: exiting now|--dry-run/iu.test(dryRunOutput),
);
const dryRunMentionsCheckoutFalse = /CHECKOUT_ENABLED[\s\S]{0,80}(?:false|"false")/iu.test(dryRunOutput);
const dryRunMentionsNoCustomDomains = target.customDomains.every((domain) => !dryRunOutput.includes(domain));
const productionSecretList = captureById('wrangler-secret-list-production');
const stagingSecretList = captureById('wrangler-secret-list-staging');
const productionSecretListOutputShape = secretListShape(productionSecretList);
const stagingSecretListShape = secretListShape(stagingSecretList);
const productionSecretListSucceeded = productionSecretList?.exitCode === 0;
const distRemovedAfterDryRun = !distExistedBefore && !existsSync(distPath);
const distCleanupMessage = cleanupCapture.message;
const matrix = buildVariableMatrix(productionSecretListOutputShape);
const variableMatrixPath = path.join(outputDir, 'cloudflare-production-worker-variable-matrix.md');
const variableMatrixJsonPath = path.join(outputDir, 'cloudflare-production-worker-variable-matrix.json');
const summaryPath = path.join(outputDir, 'summary.md');
const manifestPath = path.join(outputDir, 'manifest.json');
const checks = buildChecks(matrix);
const status = statusFor(checks);
const report: Report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    status,
    outputDir,
    remoteWritePerformed: false,
    externalScope: 'Cloudflare read-only whoami/secret-list plus Wrangler deploy dry-run; no deploy/upload/domain/DNS/secret write',
    targetAccountId: target.accountId,
    targetWorker: target.productionWorker,
    checkoutEnabledFalseInConfig,
    dryRunAfterBuildLooksSuccessful,
    dryRunMentionsCheckoutFalse,
    dryRunMentionsNoCustomDomains,
    productionSecretListSucceeded,
    productionSecretListOutputShape,
    stagingSecretListShape,
    distExistedBefore,
    distRemovedAfterDryRun,
    distCleanupMessage,
    captures: captures.map((capture) => ({
        path: capture.outputPath,
        name: capture.id,
        exitCode: capture.exitCode,
        status: capture.status,
    })),
    checks,
    variableMatrixPath,
    variableMatrixJsonPath,
    summaryPath,
    manifestPath,
    phase2AstroWorkerNamesToLoad: matrix
        .filter((entry) => entry.target === 'Astro Worker' && entry.phase.startsWith('phase 2'))
        .map((entry) => entry.name),
    fulfillmentOnlyNamesNotForAstroWorker: matrix
        .filter((entry) => entry.target === 'Fulfillment Worker only')
        .map((entry) => entry.name),
};

writeFileSync(variableMatrixJsonPath, `${JSON.stringify(matrix, null, 2)}\n`, 'utf8');
writeFileSync(variableMatrixPath, renderVariableMatrix(matrix), 'utf8');
writeFileSync(summaryPath, renderSummary(report), 'utf8');
writeFileSync(path.join(outputDir, 'summary.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
writeFileSync(manifestPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

const failed = checks.filter((check) => check.status === 'failed');
const warnings = checks.filter((check) => check.status === 'warning');

console.log(`[launch:cloudflare-production-runtime-cutover-preflight] Status: ${status}`);
console.log(`[launch:cloudflare-production-runtime-cutover-preflight] Failed: ${failed.length}`);
console.log(`[launch:cloudflare-production-runtime-cutover-preflight] Warnings: ${warnings.length}`);
console.log(`[launch:cloudflare-production-runtime-cutover-preflight] Summary: ${summaryPath}`);
console.log(`[launch:cloudflare-production-runtime-cutover-preflight] Variable matrix: ${variableMatrixPath}`);

if (failed.length > 0) process.exit(1);

function runCapture(config: CaptureConfig): Capture {
    const outputPath = path.join(outputDir, `${config.id}.txt`);
    const command = renderCommand(config.args);
    const commandSafe = commandScopeAllows(command);

    if (config.skip || !commandSafe) {
        const statusForSkipped: CheckStatus = commandSafe ? 'warning' : 'failed';
        const message = commandSafe ? config.skipReason ?? 'Skipped.' : 'Command scope guard blocked execution before it could run.';
        const content = [
            `# ${config.label}`,
            '',
            `command=${command}`,
            'exitCode=skipped',
            `status=${statusForSkipped}`,
            '',
            '# reason',
            message,
            '',
        ].join('\n');
        writeFileSync(outputPath, content, 'utf8');
        return {
            id: config.id,
            label: config.label,
            command,
            exitCode: null,
            status: statusForSkipped,
            message,
            outputPath,
            stdoutSha256: sha256(''),
            stderrSha256: sha256(message),
            parsedJson: null,
            summary: {},
        };
    }

    const result = spawnSync(corepackCommand(), config.args, {
        env: {
            ...process.env,
            CI: 'true',
            WRANGLER_SEND_METRICS: 'false',
        },
        encoding: 'utf8',
        timeout: config.timeoutMs ?? 60_000,
        windowsHide: true,
        shell: process.platform === 'win32',
    });
    const stdout = sanitizeOutput(typeof result.stdout === 'string' ? result.stdout : String(result.stdout ?? ''));
    const stderr = sanitizeOutput(typeof result.stderr === 'string' ? result.stderr : String(result.stderr ?? ''));
    const exitCode = typeof result.status === 'number' ? result.status : null;
    const parsedJson = config.expectJson && exitCode === 0 ? parseJsonFromWrangler(stdout) : null;
    const parseFailed = config.expectJson && exitCode === 0 && parsedJson === null;
    const unexpectedFailure = exitCode !== 0 && !config.allowFailure;
    const statusForCapture: CheckStatus = result.error || parseFailed || unexpectedFailure ? 'failed' : exitCode === 0 ? 'ok' : 'warning';
    const message = captureMessage(config, exitCode, parsedJson, stderr, result.error);

    writeFileSync(outputPath, [
        `# ${config.label}`,
        '',
        `command=${command}`,
        `exitCode=${exitCode ?? 'unknown'}`,
        `status=${statusForCapture}`,
        '',
        '# stdout',
        stdout,
        '',
        '# stderr',
        stderr,
        '',
    ].join('\n'), 'utf8');

    return {
        id: config.id,
        label: config.label,
        command,
        exitCode,
        status: statusForCapture,
        message,
        outputPath,
        stdoutSha256: sha256(stdout),
        stderrSha256: sha256(stderr),
        parsedJson,
        summary: summarizeCapture(config.id, parsedJson, stdout, stderr, exitCode),
    };
}

function cleanupDistAfterDryRun(): Capture {
    const outputPath = path.join(outputDir, 'dist-cleanup-after-dry-run.txt');
    const command = 'node guarded rmSync(dist) if dist did not exist before this preflight';
    const details: string[] = [
        `distPath=${distPath}`,
        `distExistedBefore=${distExistedBefore}`,
    ];

    try {
        if (distExistedBefore) {
            details.push('action=kept_existing_dist');
            return writeSyntheticCapture('dist-cleanup-after-dry-run', 'Guarded dist cleanup after dry-run', command, 'warning', 'dist existed before this preflight, so it was not removed automatically.', details, outputPath);
        }

        if (!existsSync(distPath)) {
            details.push('action=no_dist_to_remove');
            return writeSyntheticCapture('dist-cleanup-after-dry-run', 'Guarded dist cleanup after dry-run', command, 'ok', 'dist is absent after dry-run.', details, outputPath);
        }

        const workspaceRoot = path.resolve(process.cwd());
        if (!distPath.startsWith(`${workspaceRoot}${path.sep}`) || path.basename(distPath) !== 'dist') {
            details.push('action=blocked_by_path_guard');
            return writeSyntheticCapture('dist-cleanup-after-dry-run', 'Guarded dist cleanup after dry-run', command, 'failed', 'Path guard blocked dist cleanup.', details, outputPath);
        }

        rmSync(distPath, { recursive: true, force: true });
        details.push('action=removed_generated_dist');
        details.push(`distPresentAfterCleanup=${existsSync(distPath)}`);
        return writeSyntheticCapture('dist-cleanup-after-dry-run', 'Guarded dist cleanup after dry-run', command, existsSync(distPath) ? 'failed' : 'ok', existsSync(distPath) ? 'dist still exists after cleanup.' : 'Generated dist was removed after dry-run.', details, outputPath);
    } catch (error) {
        details.push(`error=${safeErrorMessage(error as Error)}`);
        return writeSyntheticCapture('dist-cleanup-after-dry-run', 'Guarded dist cleanup after dry-run', command, 'failed', 'dist cleanup failed.', details, outputPath);
    }
}

function writeSyntheticCapture(
    id: string,
    label: string,
    command: string,
    status: CheckStatus,
    message: string,
    details: string[],
    outputPath: string,
): Capture {
    const text = details.join('\n');
    writeFileSync(outputPath, [
        `# ${label}`,
        '',
        `command=${command}`,
        'exitCode=0',
        `status=${status}`,
        '',
        '# details',
        text,
        '',
    ].join('\n'), 'utf8');

    return {
        id,
        label,
        command,
        exitCode: status === 'failed' ? 1 : 0,
        status,
        message,
        outputPath,
        stdoutSha256: sha256(text),
        stderrSha256: sha256(status === 'failed' ? message : ''),
        parsedJson: null,
        summary: Object.fromEntries(details.map((detail) => {
            const [key, ...rest] = detail.split('=');
            return [key, rest.join('=')];
        })),
    };
}

function buildChecks(matrix: MatrixEntry[]): Check[] {
    const whoami = captureById('wrangler-whoami');
    const authSummary = whoami?.summary as { loggedIn?: boolean; targetAccountFound?: boolean; email?: string; accountName?: string } | undefined;
    const commandScopeOk = captures.every((capture) => commandScopeAllows(capture.command));
    const generatedOutputSecretPosture = validateGeneratedOutputPosture();
    const requiredMatrixNames = [
        'CHECKOUT_ENABLED',
        'PUBLIC_SITE_URL',
        'SUPABASE_SERVICE_ROLE_KEY',
        'SUPABASE_EXPECTED_PROJECT_REF',
        'STRIPE_SECRET_KEY',
        'STRIPE_WEBHOOK_SECRET',
        'STRIPE_EXPECTED_ACCOUNT_ID',
        'STRIPE_PORTAL_CONFIGURATION_ID',
        'PUBLIC_STRIPE_PUBLISHABLE_KEY',
        'TURNSTILE_SECRET_KEY',
        'LEVEL_CHECK_TOKEN_SECRET',
        'RESEND_API_KEY',
        'ADMIN_EMAIL',
        'FULFILLMENT_WORKER_URL',
        'INTERNAL_JOB_SECRET',
        'CRON_SECRET',
        'GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY',
    ];
    const missingMatrixNames = requiredMatrixNames.filter((name) => !matrix.some((entry) => entry.name === name));

    return [
        {
            status: commandScopeOk ? 'ok' : 'failed',
            name: 'command_scope_no_external_write',
            message: commandScopeOk
                ? 'Configured commands are read/list/version, local build, guarded cleanup or Wrangler deploy --dry-run only.'
                : 'A command is outside the allowed no-write preflight scope.',
            details: captures.map((capture) => `${capture.id}=${capture.command}`),
        },
        {
            status: authSummary?.loggedIn && authSummary.targetAccountFound ? 'ok' : 'failed',
            name: 'cloudflare_account_auth',
            message: authSummary?.loggedIn && authSummary.targetAccountFound
                ? 'Wrangler is logged into the intended Cloudflare account.'
                : 'Wrangler did not prove access to the intended Cloudflare account.',
            details: [
                `email=${authSummary?.email ?? 'unknown'}`,
                `account=${authSummary?.accountName ?? 'missing'}`,
                `targetAccountId=${target.accountId}`,
            ],
        },
        {
            status: checkoutEnabledFalseInConfig ? 'ok' : 'failed',
            name: 'checkout_disabled_config',
            message: checkoutEnabledFalseInConfig
                ? 'wrangler.toml keeps CHECKOUT_ENABLED=false in base, staging and production.'
                : 'wrangler.toml does not prove fail-closed checkout in all runtime sections.',
            details: [`checkoutFalseCount=${checkoutFalseCount(wrangler)}`, 'required=base,staging,production'],
        },
        {
            status: safeBaseWorkerNameConfigured ? 'ok' : 'failed',
            name: 'safe_base_worker_name',
            message: safeBaseWorkerNameConfigured
                ? 'A deploy without --env targets the non-production env-required Worker name, never production.'
                : 'Top-level Wrangler name is not the safe non-production env-required name.',
            details: ['requiredBaseName=espanolhonesto-env-required', 'productionName=espanolhonesto'],
        },
        {
            status: buildCapture?.exitCode === 0 ? 'ok' : 'failed',
            name: 'local_build_passed',
            message: buildCapture?.exitCode === 0 ? 'Explicit production release build completed before dry-run.' : 'Explicit production release build failed or was not executed.',
            details: [`capture=${toRelative(buildCapture?.outputPath ?? '')}`, `exitCode=${buildCapture?.exitCode ?? 'unknown'}`],
        },
        {
            status: dryRunAfterBuildLooksSuccessful ? 'ok' : 'failed',
            name: 'wrangler_production_dry_run_passed',
            message: dryRunAfterBuildLooksSuccessful
                ? 'Wrangler production deploy dry-run completed and exited before upload/deploy.'
                : 'Wrangler production deploy dry-run did not complete successfully.',
            details: [
                `capture=${toRelative(dryRunCapture?.outputPath ?? '')}`,
                `exitCode=${dryRunCapture?.exitCode ?? 'unknown'}`,
                'requiredCommand=corepack pnpm --config.verify-deps-before-run=false exec wrangler deploy --config dist/server/wrangler.json --dry-run',
            ],
        },
        {
            status: dryRunMentionsCheckoutFalse ? 'ok' : 'failed',
            name: 'dry_run_checkout_disabled',
            message: dryRunMentionsCheckoutFalse
                ? 'Dry-run output exposes CHECKOUT_ENABLED as false.'
                : 'Dry-run output does not prove CHECKOUT_ENABLED=false.',
            details: [`capture=${toRelative(dryRunCapture?.outputPath ?? '')}`],
        },
        {
            status: dryRunMentionsNoCustomDomains ? 'ok' : 'failed',
            name: 'dry_run_no_custom_domain_attachment',
            message: dryRunMentionsNoCustomDomains
                ? 'Dry-run output does not show espanolhonesto.com/www domain attachment.'
                : 'Dry-run output mentions a production custom domain; stop before any deploy.',
            details: target.customDomains.map((domain) => `absent=${domain}`),
        },
        {
            status: productionSecretListOutputShape === 'worker_missing' || productionSecretListOutputShape.startsWith('names') ? 'warning' : 'failed',
            name: 'production_secret_list_shape_expected',
            message: productionSecretListOutputShape === 'worker_missing'
                ? 'Production Worker is still missing before phase 1, so production Worker secrets cannot exist yet.'
                : productionSecretListOutputShape.startsWith('names')
                    ? 'Production Worker secret names are listable by name only.'
                    : 'Production Worker secret-name probe returned an unexpected shape.',
            details: [`shape=${productionSecretListOutputShape}`, `capture=${toRelative(productionSecretList?.outputPath ?? '')}`],
        },
        {
            status: stagingSecretListShape === 'empty_list' || stagingSecretListShape.startsWith('names') ? 'ok' : 'warning',
            name: 'staging_secret_list_shape_expected',
            message: stagingSecretListShape === 'empty_list'
                ? 'Staging Worker secret list returned an empty list; this is captured as posture, not a write.'
                : stagingSecretListShape.startsWith('names')
                    ? 'Staging Worker secret names are listable by name only.'
                    : 'Staging Worker secret-name probe did not return the expected list shape.',
            details: [`shape=${stagingSecretListShape}`, `capture=${toRelative(stagingSecretList?.outputPath ?? '')}`],
        },
        {
            status: distExistedBefore ? 'warning' : distRemovedAfterDryRun ? 'ok' : 'failed',
            name: 'dist_cleanup_posture',
            message: distExistedBefore
                ? 'dist existed before this preflight and was kept to avoid deleting user-owned artifacts.'
                : distRemovedAfterDryRun
                    ? 'Generated dist was removed after build/dry-run.'
                    : 'dist still exists after a preflight that created it.',
            details: [
                `distExistedBefore=${distExistedBefore}`,
                `distRemovedAfterDryRun=${distRemovedAfterDryRun}`,
                `cleanup=${toRelative(cleanupCapture.outputPath)}`,
            ],
        },
        {
            status: missingMatrixNames.length === 0 ? 'ok' : 'failed',
            name: 'production_variable_matrix_complete',
            message: missingMatrixNames.length === 0
                ? 'Variable matrix covers web Worker, fulfillment-only Google boundary, checkout posture and secret-name phase.'
                : 'Variable matrix is missing required launch runtime names.',
            details: missingMatrixNames.length === 0
                ? [`matrix=${toRelative(variableMatrixPath)}`, 'Google service account keys remain fulfillment-only']
                : missingMatrixNames.map((name) => `missing=${name}`),
        },
        generatedOutputSecretPosture,
    ];
}

function buildVariableMatrix(productionWorkerShape: string): MatrixEntry[] {
    const localEnvNames = readLocalEnvNames();
    const wranglerVarNames = readWranglerVarNames();
    const observedProductionWorker = productionWorkerShape === 'worker_missing'
        ? 'worker_missing_before_phase_1'
        : productionWorkerShape;

    const entries = [
        ['NODE_ENV', 'Astro Worker', 'yes', 'plain var', 'phase 1 deploy config', 'Runtime mode', 'non-secret', 'production'],
        ['CHECKOUT_ENABLED', 'Astro Worker', 'yes', 'plain var', 'phase 1 deploy config', 'Fail-closed checkout guard', 'non-secret', 'false until explicit checkout decision'],
        ['PUBLIC_SITE_URL', 'Astro Worker', 'yes', 'plain var', 'phase 2 worker vars', 'Canonical site URL, redirects, support links and SEO/runtime URL generation', 'non-secret', 'https://espanolhonesto.com after domain/cutover decision'],
        ['PUBLIC_APP_ENV', 'Astro Worker', 'yes', 'plain var', 'phase 2 worker vars', 'Environment banner/Sentry environment separation', 'non-secret', 'production'],
        ['PUBLIC_SUPABASE_URL', 'Astro Worker', 'yes', 'plain var', 'phase 2 worker vars', 'Supabase client/server URL', 'non-secret endpoint', 'production project vkkahxsybhbutszerawz'],
        ['SUPABASE_EXPECTED_PROJECT_REF', 'Astro Worker and Fulfillment Worker', 'yes', 'plain var', 'phase 1 deploy config', 'Fail-closed Supabase project isolation', 'non-secret project ref', 'vkkahxsybhbutszerawz'],
        ['PUBLIC_SUPABASE_ANON_KEY', 'Astro Worker', 'yes', 'plain var/public key', 'phase 2 worker vars', 'Supabase browser/server anon client', 'public but environment-specific', 'production anon key'],
        ['SUPABASE_SERVICE_ROLE_KEY', 'Astro Worker', 'yes', 'secret', 'phase 2 worker secrets', 'Admin API routes, CRM/server writes and privileged server actions', 'secret', 'production service-role key'],
        ['STRIPE_SECRET_KEY', 'Astro Worker', 'yes if checkout/webhook tested', 'secret', 'phase 2 worker secrets', 'Stripe checkout/session/portal/server actions', 'secret', 'Stripe test mode until final decision'],
        ['STRIPE_WEBHOOK_SECRET', 'Astro Worker', 'yes for webhook smoke', 'secret', 'phase 2 worker secrets', 'Verify Stripe webhook signatures', 'secret', 'matching Stripe test webhook endpoint'],
        ['STRIPE_EXPECTED_ACCOUNT_ID', 'Astro Worker', 'yes for Stripe operations', 'plain var', 'phase 2 worker vars', 'Fail-closed Stripe account isolation', 'non-secret account id', 'exact production acct_ id'],
        ['STRIPE_PORTAL_CONFIGURATION_ID', 'Astro Worker', 'yes for customer portal', 'plain var', 'phase 2 worker vars', 'Pinned launch-safe Customer Portal configuration', 'non-secret config id', 'production bpc_ id with plan changes disabled and cancel-at-period-end'],
        ['PUBLIC_STRIPE_PUBLISHABLE_KEY', 'Astro Worker', 'yes if checkout tested', 'plain var/public key', 'phase 2 worker vars', 'Client Stripe initialization/public config', 'public but mode-specific', 'Stripe test publishable key until final decision'],
        ['STRIPE_EXPECTED_WEBHOOK_HOSTS', 'Audit/local/CI, optional Worker', 'recommended', 'plain var', 'phase 2 worker vars or CI', 'Read-only Stripe audit host guard', 'non-secret', 'espanolhonesto.com,www.espanolhonesto.com plus staging if needed'],
        ['PUBLIC_TURNSTILE_SITE_KEY', 'Astro Worker', 'yes', 'plain var/public key', 'phase 2 worker vars', 'Public forms Turnstile widgets', 'public', 'production widget site key'],
        ['TURNSTILE_SECRET_KEY', 'Astro Worker', 'yes', 'secret', 'phase 2 worker secrets', 'Turnstile server verification and fallback lead email token secret', 'secret', 'production Turnstile secret'],
        ['LEVEL_CHECK_TOKEN_SECRET', 'Astro Worker', 'recommended', 'secret', 'phase 2 worker secrets', 'Dedicated HMAC secret for lead level-check email tokens; avoids coupling tokens to Turnstile secret', 'secret', 'new production-only random value'],
        ['RESEND_API_KEY', 'Astro Worker', 'yes for lead/support/admin emails', 'secret', 'phase 2 worker secrets', 'Direct Resend sends from subscribe/support/email preview routes', 'secret', 'production Resend key, quota-aware'],
        ['EMAIL_FROM', 'Astro Worker', 'recommended', 'plain var', 'phase 2 worker vars', 'Canonical sender address; runtime falls back to RESEND_FROM_EMAIL', 'non-secret', 'approved sender on the production domain'],
        ['RESEND_FROM_EMAIL', 'Astro Worker', 'yes if EMAIL_FROM absent', 'plain var', 'phase 2 worker vars', 'Fallback sender address', 'non-secret', 'existing verified sender'],
        ['ADMIN_EMAIL', 'Astro Worker', 'recommended', 'plain var', 'phase 2 worker vars', 'Lead/support internal notification recipient fallback', 'personal data but not secret', 'launch admin mailbox'],
        ['SUPPORT_ALERT_EMAIL', 'Astro Worker', 'optional', 'plain var', 'phase 2 worker vars', 'Override support alert recipient', 'personal data but not secret', 'support mailbox if different from admin'],
        ['FULFILLMENT_WORKER_URL', 'Astro Worker', 'yes for Google/fulfillment bridge', 'plain var', 'phase 2 worker vars', 'Calls Cloudflare Fulfillment Worker for Drive/Docs/Calendar/Resend jobs', 'internal endpoint, do not advertise', 'production fulfillment worker URL'],
        ['INTERNAL_JOB_SECRET', 'Astro Worker and Fulfillment Worker', 'yes for fulfillment bridge', 'secret', 'phase 2 worker secrets', 'Bearer auth shared by Astro Worker and Fulfillment Worker per environment', 'secret', 'same production value on both Workers, different from staging'],
        ['CRON_SECRET', 'Astro Worker', 'yes for cron routes', 'secret', 'phase 2 worker secrets', 'Protect process-fulfillment and send-reminders cron routes', 'secret', 'production-only random value, different from INTERNAL_JOB_SECRET'],
        ['PUBLIC_SENTRY_DSN', 'Astro Worker', 'recommended', 'plain var/public DSN', 'phase 2 worker vars', 'Client/server Sentry event routing', 'public DSN but environment-specific', 'production DSN'],
        ['SENTRY_AUTH_TOKEN', 'CI/local, not normal request path', 'optional for sourcemaps/read-only tooling', 'secret', 'CI/deploy secret or phase 2 only if needed', 'Sentry source-map upload/read-only audit, not needed for basic runtime capture', 'secret', 'production Sentry token, never browser'],
        ['SENTRY_ORG', 'CI/local', 'optional', 'plain var', 'CI/deploy var', 'Deterministic Sentry read-only tooling/source-map target', 'non-secret', 'honestspanish'],
        ['SENTRY_PROJECT', 'CI/local', 'optional', 'plain var', 'CI/deploy var', 'Deterministic Sentry read-only tooling/source-map target', 'non-secret', 'espanol-honesto-astro'],
        ['SENTRY_CAPTURE_LOCAL', 'Astro Worker/local', 'optional', 'plain var', 'phase 2 worker vars or local only', 'Avoid local pollution', 'non-secret', 'false unless deliberate'],
        ['SENTRY_ENVIRONMENT', 'Astro Worker', 'optional', 'plain var', 'phase 2 worker vars', 'Override Sentry environment label', 'non-secret', 'production'],
        ['GOOGLE_SERVICE_ACCOUNT_EMAIL', 'Fulfillment Worker only', 'yes on Fulfillment Worker', 'identifier/secret-adjacent', 'fulfillment worker production vars', 'Google domain-wide delegation service account', 'secret-adjacent', 'do not put on Astro Worker unless architecture changes'],
        ['GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY', 'Fulfillment Worker only', 'yes on Fulfillment Worker', 'secret', 'fulfillment worker production secrets', 'Google API auth', 'secret', 'do not put on Astro Worker'],
        ['GOOGLE_ADMIN_EMAIL', 'Fulfillment Worker only', 'yes on Fulfillment Worker', 'plain var', 'fulfillment worker production vars', 'Impersonated calendar/admin user', 'personal data, non-secret', 'launch Google admin account'],
        ['GOOGLE_DRIVE_ROOT_FOLDER_ID', 'Fulfillment Worker only', 'yes on Fulfillment Worker', 'plain var', 'fulfillment worker production vars', 'Drive root for materials', 'internal id', 'production root folder'],
        ['GOOGLE_TEMPLATE_DOC_ID', 'Fulfillment Worker only', 'yes on Fulfillment Worker', 'plain var', 'fulfillment worker production vars', 'Google Doc template', 'internal id', 'production template doc'],
    ];

    return entries.map(([name, entryTarget, required, kind, phase, purpose, sensitivity, valuePolicy]) => ({
        name,
        target: entryTarget,
        required,
        kind,
        phase,
        purpose,
        sensitivity,
        valuePolicy,
        inWranglerToml: wranglerVarNames.has(name),
        inLocalEnv: localEnvNames.has(name),
        observedProductionWorker,
    }));
}

function renderVariableMatrix(matrix: MatrixEntry[]): string {
    const lines = [
        '# Cloudflare Production Worker Variable Matrix',
        '',
        'Generated from local runtime env readers, launch docs, latest preflight commands, `.env` names and current `wrangler.toml`. Values are intentionally not stored.',
        '',
        `- Production Worker observed state: \`${productionSecretListOutputShape}\`.`,
        '- Phase 1 deploy config currently provides only `NODE_ENV=production` and `CHECKOUT_ENABLED=false` from `wrangler.toml`.',
        '- Google service-account variables belong to the Fulfillment Worker, not the Astro Worker, under the current runtime boundary.',
        '- This file stores names and posture only. It must not contain API keys, private keys, webhook secrets or token values.',
        '',
        '| Name | Target | Required | Kind | Phase | In wrangler.toml | In local env name set | Value policy |',
        '| --- | --- | --- | --- | --- | --- | --- | --- |',
        ...matrix.map((entry) => `| \`${entry.name}\` | ${entry.target} | ${entry.required} | ${entry.kind} | ${entry.phase} | ${entry.inWranglerToml} | ${entry.inLocalEnv} | ${escapeCell(entry.valuePolicy)} |`),
        '',
        '## Phase 2 Astro Worker Names To Load After Phase 1',
        '',
        ...matrix
            .filter((entry) => entry.target === 'Astro Worker' && entry.phase.startsWith('phase 2'))
            .map((entry) => `- \`${entry.name}\` (${entry.kind})`),
        '',
        '## Names Not To Move Into Astro Worker Under Current Boundary',
        '',
        ...matrix
            .filter((entry) => entry.target === 'Fulfillment Worker only')
            .map((entry) => `- \`${entry.name}\``),
        '',
    ];

    return `${lines.join('\n')}\n`;
}

function renderSummary(report: Report): string {
    const lines = [
        '# Cloudflare Production Runtime Preflight Refresh',
        '',
        `- Status: ${report.status}`,
        `- Generated: ${report.generatedAt}`,
        '- Scope: local build and Wrangler production deploy dry-run plus read-only account/secret-list checks.',
        `- Remote write performed: ${report.remoteWritePerformed ? 'true' : 'false'}.`,
        `- Target account: ${report.targetAccountId}`,
        `- Target Worker: ${report.targetWorker}`,
        `- CHECKOUT_ENABLED=false in config: ${boolLabel(report.checkoutEnabledFalseInConfig)}`,
        `- Dry-run after build looked successful: ${boolLabel(report.dryRunAfterBuildLooksSuccessful)}`,
        `- Dry-run mentions CHECKOUT_ENABLED=false: ${boolLabel(report.dryRunMentionsCheckoutFalse)}`,
        `- Dry-run avoids custom domains: ${boolLabel(report.dryRunMentionsNoCustomDomains)}`,
        `- Production secret-list shape: ${report.productionSecretListOutputShape}`,
        `- Staging secret-list shape: ${report.stagingSecretListShape}`,
        `- dist existed before preflight: ${boolLabel(report.distExistedBefore)}`,
        `- dist removed after dry-run: ${boolLabel(report.distRemovedAfterDryRun)}`,
        `- Variable matrix: ${toRelative(report.variableMatrixPath)}`,
        `- Manifest: ${toRelative(report.manifestPath)}`,
        '',
        'This preflight does not write to Cloudflare, does not deploy, does not upload, does not move domains, does not change DNS and does not write secrets. Astro 6 selects production during the build; the preflight then runs `wrangler deploy --config dist/server/wrangler.json --dry-run` against that resolved package and keeps `CHECKOUT_ENABLED=false` as the required state claim.',
        '',
        '## Checks',
        '',
        '| Status | Check | Message | Details |',
        '| --- | --- | --- | --- |',
        ...report.checks.map((check) => `| ${check.status} | ${check.name} | ${escapeCell(check.message)} | ${escapeCell(check.details.join(' / '))} |`),
        '',
        '## Captures',
        '',
        '| Capture | Path | Exit Code | Status |',
        '| --- | --- | ---: | --- |',
        ...report.captures.map((capture) => `| ${capture.name} | ${escapeCell(capture.path)} | ${capture.exitCode ?? 'n/a'} | ${capture.status} |`),
        '',
    ];

    return `${lines.join('\n')}\n`;
}

function validateGeneratedOutputPosture(): Check {
    const combined = captures
        .map((capture) => readFileSync(capture.outputPath, 'utf8'))
        .join('\n');
    const forbiddenSecretPatterns = [
        new RegExp('-----BEGIN ' + 'PRIVATE KEY-----'),
        /sk_(live|test)_[A-Za-z0-9]{20,}/,
        /whsec_[A-Za-z0-9]{20,}/,
        /sb_secret_[A-Za-z0-9_-]{20,}/,
        /AIza[0-9A-Za-z_-]{30,}/,
        /(?<![A-Za-z0-9_])re_[A-Za-z0-9_]{20,}/,
        /(postgres|postgresql):\/\/[^\s"']+:[^\s"']+@/iu,
        /Bearer\s+[A-Za-z0-9._-]{20,}/i,
    ];
    const offenders = forbiddenSecretPatterns.filter((pattern) => pattern.test(combined));

    return {
        status: offenders.length === 0 ? 'ok' : 'failed',
        name: 'generated_output_secret_posture',
        message: offenders.length === 0
            ? 'Generated command artifacts contain no obvious secret values.'
            : 'Generated command artifacts appear to contain secret-like values.',
        details: offenders.map((pattern) => `secretPattern=${pattern}`).concat([
            'secret list probes store names only as returned by Wrangler',
            'stdout/stderr are sanitized for common token/key patterns before writing',
        ]),
    };
}

function summarizeCapture(
    id: string,
    parsedJson: unknown,
    stdout: string,
    stderr: string,
    exitCode: number | null,
): Record<string, unknown> {
    switch (id) {
        case 'wrangler-version':
            return { version: stdout.trim().split(/\s+/u).at(-1) ?? stdout.trim() };
        case 'wrangler-whoami':
            return summarizeWhoami(parsedJson);
        case 'wrangler-secret-list-production':
        case 'wrangler-secret-list-staging':
            return summarizeSecrets(parsedJson, stderr, exitCode);
        case 'wrangler-deploy-production-dry-run-after-build':
            return {
                dryRunExit: exitCode,
                mentionsCheckoutFalse: /CHECKOUT_ENABLED[\s\S]{0,80}(?:false|"false")/iu.test(stdout + stderr),
                mentionsCustomDomains: target.customDomains.some((domain) => (stdout + stderr).includes(domain)),
            };
        default:
            return {};
    }
}

function summarizeWhoami(value: unknown): Record<string, unknown> {
    const object = asRecord(value);
    const accounts = asArray(object.accounts);
    const targetAccount = accounts
        .map(asRecord)
        .find((account) => stringValue(account.id) === target.accountId);
    return {
        loggedIn: Boolean(object.loggedIn),
        authType: stringValue(object.authType),
        email: stringValue(object.email),
        accountName: stringValue(targetAccount?.name),
        targetAccountFound: Boolean(targetAccount),
        accountCount: accounts.length,
    };
}

function summarizeSecrets(value: unknown, stderr: string, exitCode: number | null): Record<string, unknown> {
    const secrets = asArray(value).map(asRecord);
    const names = exitCode === 0
        ? secrets.map((secret) => stringValue(secret.name)).filter(Boolean).sort()
        : [];
    return {
        count: names.length,
        names,
        notFound: isCloudflareScriptNotFound(stderr),
        errorPreview: exitCode === 0 ? null : compactText(stderr),
    };
}

function secretListShape(capture: Capture | undefined): string {
    if (!capture) return 'missing_capture';
    const summary = capture.summary as { names?: string[]; notFound?: boolean; errorPreview?: string };
    const names = summary.names ?? [];
    if (capture.exitCode === 0 && names.length === 0) return 'empty_list';
    if (capture.exitCode === 0) return `names:${names.length}`;
    if (summary.notFound) return 'worker_missing';
    return 'unexpected_failure';
}

function captureById(id: string): Capture | undefined {
    return captures.find((capture) => capture.id === id);
}

function captureText(capture: Capture): string {
    return readFileSync(capture.outputPath, 'utf8');
}

function pnpmArgs(...args: string[]): string[] {
    return ['pnpm', '--config.verify-deps-before-run=false', ...args];
}

function renderCommand(args: string[]): string {
    return `corepack ${args.join(' ')}`;
}

function commandScopeAllows(command: string): boolean {
    if (/corepack\s+pnpm\s+run\s+deploy/iu.test(command)) return false;
    if (/\bwrangler\s+deploy\b/iu.test(command) && !/\s--dry-run(?:\s|$)/iu.test(command)) return false;
    const forbiddenPatterns = [
        /\bwrangler\s+delete\b/iu,
        /\bwrangler\s+secret\s+put\b/iu,
        /\bwrangler\s+secret\s+delete\b/iu,
        /\bwrangler\s+pages\s+deploy\b/iu,
        /\bwrangler\s+pages\s+project\s+create\b/iu,
        /\bwrangler\s+rollback\b/iu,
        /\bwrangler\s+route\b/iu,
        /\bwrangler\s+zone\b/iu,
        /\bwrangler\s+dns\b/iu,
        /\bCHECKOUT_ENABLED=true\b/iu,
    ];
    return !forbiddenPatterns.some((pattern) => pattern.test(command));
}

function captureMessage(
    config: CaptureConfig,
    exitCode: number | null,
    parsedJson: unknown,
    stderr: string,
    error: Error | undefined,
): string {
    if (error) return safeErrorMessage(error);
    if (config.expectJson && exitCode === 0 && parsedJson === null) return 'Command exited 0 but JSON output could not be parsed.';
    if (exitCode === 0) return 'Command completed.';
    if (config.allowFailure) return compactText(stderr) || `Command exited ${exitCode ?? 'unknown'}; captured as warning.`;
    return compactText(stderr) || `Command exited ${exitCode ?? 'unknown'}.`;
}

function parseJsonFromWrangler(output: string): unknown | null {
    const candidate = extractJsonValue(stripAnsi(output));
    if (!candidate) return null;
    try {
        return JSON.parse(candidate);
    } catch {
        return null;
    }
}

function extractJsonValue(value: string): string | null {
    const objectStart = value.indexOf('{');
    const arrayStart = value.indexOf('[');
    const starts = [objectStart, arrayStart].filter((index) => index >= 0);
    const start = starts.length > 0 ? Math.min(...starts) : -1;
    if (start < 0) return null;
    const opener = value[start];
    const closer = opener === '[' ? ']' : '}';
    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let index = start; index < value.length; index += 1) {
        const char = value[index];
        if (inString) {
            if (escaped) {
                escaped = false;
            } else if (char === '\\') {
                escaped = true;
            } else if (char === '"') {
                inString = false;
            }
            continue;
        }

        if (char === '"') {
            inString = true;
            continue;
        }

        if (char === opener) depth += 1;
        if (char === closer) depth -= 1;
        if (depth === 0) return value.slice(start, index + 1);
    }

    return value.slice(start).trim();
}

function readLocalEnvNames(): Set<string> {
    const names = new Set<string>();
    for (const file of ['.env', '.env.local', '.env.production', '.dev.vars']) {
        const content = readIfExists(file);
        for (const line of content.split(/\r?\n/u)) {
            const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/u);
            if (match) names.add(match[1]);
        }
    }
    return names;
}

function readWranglerVarNames(): Set<string> {
    const names = new Set<string>();
    for (const match of wrangler.matchAll(/^\s*([A-Z][A-Z0-9_]*)\s*=/gmu)) {
        names.add(match[1]);
    }
    return names;
}

function checkoutFalseCount(value: string): number {
    return [...value.matchAll(/CHECKOUT_ENABLED\s*=\s*"false"/g)].length;
}

function readIfExists(file: string): string {
    return existsSync(file) ? readFileSync(file, 'utf8') : '';
}

function statusFor(checkList: Check[]): Report['status'] {
    if (checkList.some((check) => check.status === 'failed')) return 'FAILED';
    if (checkList.some((check) => check.status === 'warning')) return 'WARNING';
    return 'OK';
}

function asArray(value: unknown): unknown[] {
    return Array.isArray(value) ? value : value === null || typeof value === 'undefined' ? [] : [value];
}

function asRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function stringValue(value: unknown): string {
    return typeof value === 'string' ? value : typeof value === 'number' || typeof value === 'boolean' ? String(value) : '';
}

function corepackCommand(): string {
    return 'corepack';
}

function sanitizeOutput(value: string): string {
    return stripAnsi(value)
        .replace(/-----BEGIN [A-Z ]+PRIVATE KEY-----[\s\S]*?-----END [A-Z ]+PRIVATE KEY-----/g, '[redacted-private-key]')
        .replace(/sk_(live|test)_[A-Za-z0-9]{20,}/g, 'sk_$1_[redacted]')
        .replace(/whsec_[A-Za-z0-9]{20,}/g, 'whsec_[redacted]')
        .replace(/sb_secret_[A-Za-z0-9_-]{20,}/g, 'sb_secret_[redacted]')
        .replace(/AIza[0-9A-Za-z_-]{30,}/g, 'AIza[redacted]')
        .replace(/(?<![A-Za-z0-9_])re_[A-Za-z0-9_]{20,}/g, 're_[redacted]')
        .replace(/(postgres|postgresql):\/\/[^\s"']+:[^\s"']+@/giu, '$1://[redacted-user]:[redacted-password]@')
        .replace(/Bearer\s+[A-Za-z0-9._-]{20,}/gi, 'Bearer [redacted]');
}

function stripAnsi(value: string): string {
    const escape = String.fromCharCode(27);
    return value.replace(new RegExp(`${escape}\\[[0-?]*[ -/]*[@-~]`, 'g'), '');
}

function safeErrorMessage(error: Error): string {
    return sanitizeOutput(error.message).replace(/\r?\n/g, ' ').slice(0, 500);
}

function compactText(value: string): string {
    return value.replace(/\s+/g, ' ').trim().slice(0, 500);
}

function isCloudflareScriptNotFound(stderr: string): boolean {
    return /code:\s*10007|workers\.api\.error\.script_not_found|script_not_found|not found/iu.test(stderr);
}

function sha256(value: string): string {
    return createHash('sha256').update(value).digest('hex');
}

function stamp(date: Date): string {
    return date.toISOString().replace(/[:.]/g, '-');
}

function toRelative(filePath: string): string {
    if (!filePath) return '';
    return path.relative(process.cwd(), filePath).split(path.sep).join('/');
}

function escapeCell(value: string): string {
    return value.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

function boolLabel(value: boolean): 'True' | 'False' {
    return value ? 'True' : 'False';
}
