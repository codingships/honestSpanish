import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

type CheckStatus = 'ok' | 'warning' | 'failed';

interface CheckResult {
    status: CheckStatus;
    name: string;
    message: string;
    details?: string[];
}

interface NoRealPaymentsReport {
    schemaVersion: 1;
    startedAt: string;
    endedAt: string;
    status: 'OK' | 'WARNING' | 'FAILED';
    outputDir: string;
    closurePackPath: string;
    manualEvidenceDryRunPath: string;
    checks: CheckResult[];
}

const startedAt = new Date();
const outputDir = path.join(process.cwd(), 'outputs', 'launch-no-real-payments', stamp(startedAt));
mkdirSync(outputDir, { recursive: true });
const deployedUrl = readArgValue('--deployed-url');

const checks: CheckResult[] = [
    reviewStaticNoRealPaymentsMode(),
    runVitestGroup(),
    runPaymentsAudit(),
    checkLatestFunctionalRc(),
    await checkDeployedEnvironmentIfRequested(deployedUrl),
];

const failed = checks.filter((check) => check.status === 'failed');
const warnings = checks.filter((check) => check.status === 'warning');
const status = failed.length > 0 ? 'FAILED' : warnings.length > 0 ? 'WARNING' : 'OK';
const closurePackPath = path.join(outputDir, 'no-real-payments-closure-pack.md');
const manualEvidenceDryRunPath = path.join(outputDir, 'manual-evidence-dry-run.txt');

const report: NoRealPaymentsReport = {
    schemaVersion: 1,
    startedAt: startedAt.toISOString(),
    endedAt: new Date().toISOString(),
    status,
    outputDir,
    closurePackPath,
    manualEvidenceDryRunPath,
    checks,
};

writeFileSync(path.join(outputDir, 'summary.json'), JSON.stringify(report, null, 2), 'utf8');
writeFileSync(path.join(outputDir, 'summary.md'), renderSummary(report), 'utf8');
writeFileSync(closurePackPath, renderClosurePack(report), 'utf8');
writeFileSync(manualEvidenceDryRunPath, renderManualEvidenceDryRun(report), 'utf8');

console.log(`[launch:no-real-payments] Status: ${status}`);
console.log(`[launch:no-real-payments] Failed: ${failed.length}`);
console.log(`[launch:no-real-payments] Warnings: ${warnings.length}`);
console.log(`[launch:no-real-payments] Closure pack: ${closurePackPath}`);
console.log(`[launch:no-real-payments] Manual evidence dry run: ${manualEvidenceDryRunPath}`);

if (failed.length > 0) process.exit(1);

function reviewStaticNoRealPaymentsMode(): CheckResult {
    const files = new Map([
        ['.env.example', readIfExists('.env.example')],
        ['src/pages/api/create-checkout.ts', readIfExists('src/pages/api/create-checkout.ts')],
        ['src/components/LandingPage.astro', readIfExists('src/components/LandingPage.astro')],
        ['src/components/landing/SegmentLandingPage.astro', readIfExists('src/components/landing/SegmentLandingPage.astro')],
        ['src/components/PricingSection.tsx', readIfExists('src/components/PricingSection.tsx')],
        ['docs/launch/PRODUCTS.md', readIfExists('docs/launch/PRODUCTS.md')],
        ['docs/launch/LAUNCH_SEQUENCE.md', readIfExists('docs/launch/LAUNCH_SEQUENCE.md')],
        ['docs/launch/FINAL_CLOSURE.md', readIfExists('docs/launch/FINAL_CLOSURE.md')],
    ]);

    const required: Array<[string, string]> = [
        ['.env.example', 'CHECKOUT_ENABLED=false'],
        ['src/pages/api/create-checkout.ts', "readRuntimeEnv('CHECKOUT_ENABLED'"],
        ['src/pages/api/create-checkout.ts', 'Checkout is disabled'],
        ['src/pages/api/create-checkout.ts', 'status: 403'],
        ['src/components/LandingPage.astro', 'checkoutMode="application"'],
        ['src/components/landing/SegmentLandingPage.astro', 'checkoutMode="application"'],
        ['src/components/PricingSection.tsx', "checkoutMode = 'application'"],
        ['src/components/PricingSection.tsx', "checkoutMode === 'application'"],
        ['docs/launch/PRODUCTS.md', 'Mantener `CHECKOUT_ENABLED=false` para operar sin cobros reales'],
        ['docs/launch/LAUNCH_SEQUENCE.md', 'checkout debe quedar desactivado, oculto o bloqueado'],
        ['docs/launch/FINAL_CLOSURE.md', 'Checkout desactivado, oculto o bloqueado'],
    ];

    const missing = required
        .filter(([file, snippet]) => !files.get(file)?.includes(snippet))
        .map(([file, snippet]) => `${file}: missing ${snippet}`);

    return {
        status: missing.length === 0 ? 'ok' : 'failed',
        name: 'static_no_real_payments_mode',
        message: missing.length === 0
            ? 'Static code and docs keep public pricing application-first and checkout fail-closed by default.'
            : 'Static no-real-payments safeguards are incomplete.',
        details: missing,
    };
}

function runVitestGroup(): CheckResult {
    const tests = [
        'tests/api/create-checkout.test.ts',
        'tests/e2e/checkout.public.spec.ts',
        'tests/unit/functional-rc-runbook.test.ts',
    ];
    const missing = tests.filter((testFile) => !existsSync(testFile));
    const logPath = path.join(outputDir, 'no-real-payments-tests.log');

    if (missing.length > 0) {
        writeFileSync(logPath, [`Missing tests:`, ...missing, ''].join('\n'), 'utf8');
        return {
            status: 'failed',
            name: 'no_real_payments_tests',
            message: 'No-real-payments test files are missing.',
            details: missing,
        };
    }

    const args = ['pnpm', 'exec', 'vitest', 'run', '--coverage=false', '--reporter=dot', ...tests];
    const result = spawnSync(corepackCommand(), args, {
        cwd: process.cwd(),
        encoding: 'utf8',
        shell: process.platform === 'win32',
        maxBuffer: 20 * 1024 * 1024,
    });

    writeFileSync(logPath, [
        `$ ${corepackCommand()} ${args.join(' ')}`,
        `exitCode=${result.status ?? 'null'}`,
        '',
        result.stdout ?? '',
        result.stderr ?? '',
        result.error ? `\nerror=${result.error.message}` : '',
    ].join('\n'), 'utf8');

    return {
        status: result.status === 0 ? 'ok' : 'failed',
        name: 'no_real_payments_tests',
        message: result.status === 0
            ? 'No-real-payments tests pass: checkout fail-closed and public package CTAs go to application flow.'
            : 'No-real-payments tests failed.',
        details: [
            `log=${toPosix(path.relative(process.cwd(), logPath))}`,
            `exitCode=${result.status ?? 'null'}`,
        ],
    };
}

function runPaymentsAudit(): CheckResult {
    const logPath = path.join(outputDir, 'launch-payments.log');
    const args = ['pnpm', 'launch:payments'];
    const result = spawnSync(corepackCommand(), args, {
        cwd: process.cwd(),
        encoding: 'utf8',
        shell: process.platform === 'win32',
        maxBuffer: 20 * 1024 * 1024,
    });

    writeFileSync(logPath, [
        `$ ${corepackCommand()} ${args.join(' ')}`,
        `exitCode=${result.status ?? 'null'}`,
        '',
        result.stdout ?? '',
        result.stderr ?? '',
        result.error ? `\nerror=${result.error.message}` : '',
    ].join('\n'), 'utf8');

    const latestPaymentsSummary = latestFile('launch-payments', 'summary.md');

    return {
        status: result.status === 0 ? 'ok' : 'failed',
        name: 'payments_static_audit',
        message: result.status === 0
            ? 'Payments audit passes, including no-real-payments launch mode safeguards.'
            : 'Payments audit failed.',
        details: [
            `log=${toPosix(path.relative(process.cwd(), logPath))}`,
            latestPaymentsSummary ? `summary=${toPosix(path.relative(process.cwd(), latestPaymentsSummary))}` : 'summary=missing',
            `exitCode=${result.status ?? 'null'}`,
        ],
    };
}

function checkLatestFunctionalRc(): CheckResult {
    const summaryPath = latestFile('launch-functional-rc', 'summary.md');
    if (!summaryPath) {
        return {
            status: 'warning',
            name: 'functional_rc_context',
            message: 'No functional RC summary found; run corepack pnpm launch:functional-rc for broader no-real-payments functional evidence.',
        };
    }

    const summary = readFileSync(summaryPath, 'utf8');
    const ok = summary.includes('Status: OK') && summary.includes('No-Real-Payments Safety');

    return {
        status: ok ? 'ok' : 'warning',
        name: 'functional_rc_context',
        message: ok
            ? 'Latest functional RC summary includes no-real-payments safety.'
            : 'Latest functional RC summary does not clearly include no-real-payments safety.',
        details: [`summary=${toPosix(path.relative(process.cwd(), summaryPath))}`],
    };
}

async function checkDeployedEnvironmentIfRequested(baseUrl: string | null): Promise<CheckResult> {
    if (baseUrl) {
        return checkDeployedCheckoutFailsClosed(baseUrl);
    }

    return {
        status: 'warning',
        name: 'deployed_environment_confirmation',
        message: 'The intended deployed environment still needs a human/non-secret confirmation that CHECKOUT_ENABLED is false or checkout is otherwise blocked.',
        details: [
            'This local command proves code, tests and docs, not Cloudflare Pages deployed variables.',
            'Run with --deployed-url <base-url> to POST an empty safe probe to /api/create-checkout and require the early 403 disabled response.',
            'Do not record secret values; record only environment, timestamp and checkout posture.',
        ],
    };
}

async function checkDeployedCheckoutFailsClosed(baseUrl: string): Promise<CheckResult> {
    const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
    const url = `${normalizedBaseUrl}/api/create-checkout`;

    try {
        const response = await fetchWithTimeout(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: '{}',
            redirect: 'manual',
        });
        const text = await response.text();
        const payload = parseJsonObject(text);
        const disabled = response.status === 403 && payload?.error === 'Checkout is disabled';

        return {
            status: disabled ? 'ok' : 'failed',
            name: 'deployed_environment_confirmation',
            message: disabled
                ? 'Deployed checkout endpoint fails closed before Supabase or Stripe.'
                : 'Deployed checkout endpoint did not return the expected early disabled response.',
            details: [
                `url=${url}`,
                `status=${response.status}`,
                `error=${typeof payload?.error === 'string' ? payload.error : 'missing'}`,
                'probe=POST empty JSON body; if checkout were enabled, local code would return 400 before Supabase or Stripe because priceId is missing.',
            ],
        };
    } catch (error) {
        return {
            status: 'failed',
            name: 'deployed_environment_confirmation',
            message: 'Could not verify deployed checkout fail-closed posture.',
            details: [`url=${url}`, errorMessage(error)],
        };
    }
}

function renderSummary(report: NoRealPaymentsReport): string {
    const lines = [
        '# No-Real-Payments Launch Check',
        '',
        `- Status: ${report.status}`,
        `- Started: ${report.startedAt}`,
        `- Ended: ${report.endedAt}`,
        `- Output: ${report.outputDir}`,
        `- Closure pack: ${toPosix(path.relative(process.cwd(), report.closurePackPath))}`,
        '',
        '## Scope',
        '',
        'This command verifies local code, tests and documentation for operating without real payments. With `--deployed-url`, it also sends a safe empty-body probe to `/api/create-checkout` and requires the early 403 disabled response. It does not contact Stripe, does not create Checkout Sessions, does not read deployed secrets and does not update manual evidence.',
        '',
        '## Checks',
        '',
        '| Status | Check | Message | Details |',
        '| --- | --- | --- | --- |',
    ];

    for (const check of report.checks) {
        lines.push(`| ${check.status} | ${check.name} | ${escapeCell(check.message)} | ${escapeCell((check.details ?? []).join(' / '))} |`);
    }

    lines.push('');
    return `${lines.join('\n')}\n`;
}

function renderClosurePack(report: NoRealPaymentsReport): string {
    const lines = [
        '# No-Real-Payments Closure Pack',
        '',
        `- Status: ${report.status}`,
        `- Generated: ${report.endedAt}`,
        '',
        '## What Is Proven Locally',
        '',
        '- Public landing pricing uses application-first CTAs.',
        '- `/api/create-checkout` fails closed with 403 before Supabase or Stripe unless `CHECKOUT_ENABLED=true`.',
        '- Payment static audit passes.',
        '- No-real-payments tests pass.',
        '',
        '## Still Manual Before Recording `payments_staging` As Closed For No-Real-Payments',
        '',
        '- Confirm the intended deployed environment has `CHECKOUT_ENABLED=false`, or checkout is otherwise blocked/hidden for users. Prefer `corepack pnpm launch:no-real-payments -- --deployed-url <base-url>` when the environment is reachable.',
        '- Confirm Alin intentionally wants no real payments before final Stripe closure.',
        '- Keep Stripe live, live Price IDs, webhook live, Customer Portal live and real payment smoke as final-only.',
        '',
        '## Evidence Rules',
        '',
        '- Do not paste Stripe keys, webhook secrets, API responses, customer data or dashboard URLs with tokens.',
        '- Record only environment, timestamp, checkout posture and local output paths.',
        '',
        '## Checks',
        '',
        '| Status | Check | Message | Details |',
        '| --- | --- | --- | --- |',
    ];

    for (const check of report.checks) {
        lines.push(`| ${check.status} | ${check.name} | ${escapeCell(check.message)} | ${escapeCell((check.details ?? []).join(' / '))} |`);
    }

    lines.push('');
    return `${lines.join('\n')}\n`;
}

function renderManualEvidenceDryRun(report: NoRealPaymentsReport): string {
    const latestPaymentsSummary = latestFile('launch-payments', 'summary.md');
    const latestFunctionalRcSummary = latestFile('launch-functional-rc', 'summary.md');
    const paymentsSummary = latestPaymentsSummary
        ? `../../${toPosix(path.relative(process.cwd(), latestPaymentsSummary))}`
        : '../../outputs/launch-payments/<timestamp>/summary.md';
    const functionalSummary = latestFunctionalRcSummary
        ? `../../${toPosix(path.relative(process.cwd(), latestFunctionalRcSummary))}`
        : '../../outputs/launch-functional-rc/<timestamp>/summary.md';
    const closurePack = `../../${toPosix(path.relative(process.cwd(), report.closurePackPath))}`;

    return [
        'corepack pnpm launch:manual-evidence:record --',
        '  --id payments_staging',
        '  --status pass',
        '  --summary "No-real-payments launch mode confirmed for RC: public pricing remains application-first, checkout API fails closed unless CHECKOUT_ENABLED=true, and Stripe live/payment smoke remain final-only."',
        '  --environment "staging/no-real-payments"',
        '  --owner Alin',
        `  --evidence "command_output=${paymentsSummary}::payments static audit including no-real-payments mode"`,
        `  --evidence "command_output=${functionalSummary}::functional RC no-real-payments safety"`,
        `  --evidence "command_output=${closurePack}::no-real-payments closure checklist"`,
        '  --evidence "manual_note=Replace with concrete non-secret result: intended deployed environment checked on <date>; CHECKOUT_ENABLED=false or checkout blocked/hidden; Alin confirms no real payments before final Stripe closure."',
        '',
        '# Add --write only after reviewing the dry run output and replacing the placeholder manual_note.',
        '',
    ].join(' \\\n');
}

async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
        return await fetch(url, {
            ...init,
            signal: controller.signal,
        });
    } finally {
        clearTimeout(timeout);
    }
}

function parseJsonObject(value: string): Record<string, unknown> | null {
    try {
        const parsed = JSON.parse(value);
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
    } catch {
        return null;
    }
}

function normalizeBaseUrl(value: string): string {
    return value.replace(/\/+$/g, '');
}

function readArgValue(name: string): string | null {
    const index = process.argv.indexOf(name);
    if (index === -1) return null;
    return process.argv[index + 1] ?? null;
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? `error=${error.message}` : 'error=unknown';
}

function latestFile(outputType: string, fileName: string): string | null {
    const root = path.join(process.cwd(), 'outputs', outputType);
    if (!existsSync(root)) return null;

    const directories = readdirSync(root, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => path.join(root, entry.name))
        .sort((a, b) => b.localeCompare(a));

    for (const directory of directories) {
        const candidate = path.join(directory, fileName);
        if (existsSync(candidate)) return candidate;
    }

    return null;
}

function readIfExists(file: string): string {
    return existsSync(file) ? readFileSync(file, 'utf8') : '';
}

function corepackCommand(): string {
    return process.platform === 'win32' ? 'corepack.cmd' : 'corepack';
}

function stamp(date: Date): string {
    return date.toISOString().replace(/[:.]/g, '-');
}

function toPosix(filePath: string): string {
    return filePath.split(path.sep).join('/');
}

function escapeCell(value: string): string {
    return value.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}
