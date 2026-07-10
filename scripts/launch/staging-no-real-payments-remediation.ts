import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

type CheckStatus = 'ok' | 'warning' | 'failed';

interface CheckResult {
    status: CheckStatus;
    name: string;
    message: string;
    details?: string[];
}

interface RemediationReport {
    schemaVersion: 1;
    startedAt: string;
    endedAt: string;
    status: 'OK' | 'WARNING' | 'FAILED';
    outputDir: string;
    projectName: string;
    deployedUrl: string;
    remediationPackPath: string;
    buildPackageManifestPath: string;
    approvalRequestPath: string;
    manualEvidenceDryRunPath: string;
    checks: CheckResult[];
}

interface BuildPackageManifest {
    schemaVersion: 1;
    generatedAt: string;
    projectName: string;
    pagesBuildOutputDir: string;
    buildCommand: string;
    buildOutputExists: boolean;
    readyForStagingDeployPackage: boolean;
    guardSnippets: Array<{
        label: string;
        snippet: string;
        found: boolean;
        matchedFiles: string[];
    }>;
    matchedFiles: Array<{
        path: string;
        sha256: string;
        bytes: number;
        snippets: string[];
    }>;
    pagesPackage: {
        wranglerJsonPath: string;
        wranglerJsonExists: boolean;
        serverEntryPath: string;
        serverEntryExists: boolean;
        clientAssetsPath: string;
        clientAssetsExists: boolean;
        assetsBinding: string | null;
        assetsDirectory: string | null;
        checkoutEnabledDefault: string | null;
        nodejsCompat: boolean;
        fileCount: number;
        totalBytes: number;
        maxFileBytes: number;
        largestFilePath: string | null;
        withinPagesFileCountLimit: boolean;
        withinPagesFileSizeLimit: boolean;
    };
    scanned: {
        files: number;
        bytes: number;
    };
    requiredPostDeployProof: string;
    nextSteps: string[];
    evidenceRules: string[];
    forbiddenScope: string[];
}

const startedAt = new Date();
const outputDir = path.join(process.cwd(), 'outputs', 'launch-staging-no-real-payments-remediation', stamp(startedAt));
mkdirSync(outputDir, { recursive: true });

const DEFAULT_WORKER_STAGING_URL = 'https://espanolhonesto-staging.alindev95.workers.dev';
const projectName = readArgValue('--worker-name') ?? readArgValue('--project-name') ?? 'espanolhonesto-staging';
const deployedUrl = normalizeBaseUrl(
    readArgValue('--deployed-url')
        ?? process.env.CLOUDFLARE_WORKERS_STAGING_URL
        ?? process.env.CLOUDFLARE_STAGING_URL
        ?? DEFAULT_WORKER_STAGING_URL,
);
const remediationPackPath = path.join(outputDir, 'staging-no-real-payments-remediation-pack.md');
const buildPackageManifestPath = path.join(outputDir, 'worker-staging-build-manifest.json');
const approvalRequestPath = path.join(outputDir, 'approval-request.md');
const manualEvidenceDryRunPath = path.join(outputDir, 'manual-evidence-dry-run.txt');
const deployedCheckoutProbe = await checkDeployedCheckoutProbe(deployedUrl);

const checks: CheckResult[] = [
    checkLocalPagesConfig(),
    checkLocalDeploymentGap(),
    checkLocalBuildPackageGuard(buildPackageManifestPath),
    deployedCheckoutProbe,
    runWranglerWorkerReadOnly('wrangler_worker_deployments_status', ['pnpm', 'exec', 'wrangler', 'deployments', 'status', '--env', 'staging', '--json'], ['version_id', 'created_on']),
    runWranglerWorkerReadOnly('wrangler_worker_deployments_list', ['pnpm', 'exec', 'wrangler', 'deployments', 'list', '--env', 'staging', '--json'], ['version_id', 'created_on']),
    markExternalWriteRequired(deployedCheckoutProbe.status === 'ok'),
];

const failed = checks.filter((check) => check.status === 'failed');
const warnings = checks.filter((check) => check.status === 'warning');
const status = failed.length > 0 ? 'FAILED' : warnings.length > 0 ? 'WARNING' : 'OK';

const report: RemediationReport = {
    schemaVersion: 1,
    startedAt: startedAt.toISOString(),
    endedAt: new Date().toISOString(),
    status,
    outputDir,
    projectName,
    deployedUrl,
    remediationPackPath,
    buildPackageManifestPath,
    approvalRequestPath,
    manualEvidenceDryRunPath,
    checks,
};

writeFileSync(path.join(outputDir, 'summary.json'), JSON.stringify(report, null, 2), 'utf8');
writeFileSync(path.join(outputDir, 'summary.md'), renderSummary(report), 'utf8');
writeFileSync(remediationPackPath, renderRemediationPack(report), 'utf8');
writeFileSync(approvalRequestPath, renderApprovalRequest(report), 'utf8');
writeFileSync(manualEvidenceDryRunPath, renderManualEvidenceDryRun(report), 'utf8');

console.log(`[launch:staging-no-real-payments-remediation] Status: ${status}`);
console.log(`[launch:staging-no-real-payments-remediation] Failed: ${failed.length}`);
console.log(`[launch:staging-no-real-payments-remediation] Warnings: ${warnings.length}`);
console.log(`[launch:staging-no-real-payments-remediation] Summary: ${path.join(outputDir, 'summary.md')}`);
console.log(`[launch:staging-no-real-payments-remediation] Remediation pack: ${remediationPackPath}`);
console.log(`[launch:staging-no-real-payments-remediation] Build package manifest: ${buildPackageManifestPath}`);
console.log(`[launch:staging-no-real-payments-remediation] Approval request: ${approvalRequestPath}`);
console.log(`[launch:staging-no-real-payments-remediation] Manual evidence dry run: ${manualEvidenceDryRunPath}`);

if (failed.length > 0) process.exit(1);

function checkLocalPagesConfig(): CheckResult {
    const configPath = 'wrangler.toml';
    if (!existsSync(configPath)) {
        return {
            status: 'failed',
            name: 'local_worker_config',
            message: 'Root wrangler.toml is missing.',
            details: [`path=${configPath}`],
        };
    }

    const source = readFileSync(configPath, 'utf8');
    const missing = [
        'name = "espanolhonesto"',
        'keep_vars = true',
        '[env.staging]',
        'name = "espanolhonesto-staging"',
        '[env.production]',
        'CHECKOUT_ENABLED = "false"',
    ].filter((snippet) => !source.includes(snippet));

    return {
        status: missing.length === 0 ? 'ok' : 'failed',
        name: 'local_worker_config',
        message: missing.length === 0
            ? 'Local Worker config defines staging/production and explicitly defaults checkout to disabled.'
            : 'Local Worker config does not define the expected staging/production fail-closed deployment posture.',
        details: [
            `path=${configPath}`,
            ...(missing.length > 0 ? [`missing=${missing.join(', ')}`] : []),
        ],
    };
}

function checkLocalDeploymentGap(): CheckResult {
    const relevantFiles = [
        'src/pages/api/create-checkout.ts',
        'src/lib/runtime-env.ts',
        'wrangler.toml',
    ];
    const head = runGit(['rev-parse', '--short', 'HEAD']);
    const diff = runGit(['diff', '--name-only', '--', ...relevantFiles]);
    const checkoutAtHead = runGit(['show', 'HEAD:src/pages/api/create-checkout.ts']);
    const wranglerAtHead = runGit(['show', 'HEAD:wrangler.toml']);

    if (!head.ok || !diff.ok || !checkoutAtHead.ok || !wranglerAtHead.ok) {
        return {
            status: 'warning',
            name: 'local_deployment_gap',
            message: 'Could not compare local no-real-payments safeguards with the deployed Git source.',
            details: [
                `head=${head.stdout.trim() || 'unknown'}`,
                head.stderr.trim() ? `git_error=${redactOutput(head.stderr.trim())}` : 'git_error=missing',
            ],
        };
    }

    const changedFiles = diff.stdout
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);
    const headMissing = [
        ["src/pages/api/create-checkout.ts", "readRuntimeEnv('CHECKOUT_ENABLED'"],
        ['src/pages/api/create-checkout.ts', 'Checkout is disabled'],
        ['src/pages/api/create-checkout.ts', 'status: 403'],
        ['wrangler.toml', 'CHECKOUT_ENABLED = "false"'],
    ].filter(([file, snippet]) => {
        const source = file === 'wrangler.toml' ? wranglerAtHead.stdout : checkoutAtHead.stdout;
        return !source.includes(snippet);
    });

    const hasGap = changedFiles.length > 0 || headMissing.length > 0;

    return {
        status: hasGap ? 'warning' : 'ok',
        name: 'local_deployment_gap',
        message: hasGap
            ? 'The local no-real-payments safeguards are not fully represented in the current Git source; staging will not include working-tree-only fixes until they are committed and redeployed.'
            : 'The current Git source includes the no-real-payments checkout guard and Worker default.',
        details: [
            `head=${head.stdout.trim()}`,
            `git_diff=git diff --name-only -- ${relevantFiles.join(' ')}`,
            changedFiles.length > 0
                ? `working_tree_changes=${changedFiles.join(', ')}`
                : 'working_tree_changes=none',
            ...(headMissing.length > 0
                ? [`head_missing=${headMissing.map(([file, snippet]) => `${file}:${snippet}`).join(' | ')}`]
                : ['head_missing=none']),
        ],
    };
}

function checkLocalBuildPackageGuard(manifestPath: string): CheckResult {
    const manifest = buildLocalBuildPackageManifest();
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');

    if (!manifest.buildOutputExists) {
        return {
            status: 'warning',
            name: 'local_build_package_guard',
            message: 'No local Worker build output was found; build before using the staging deploy package.',
            details: [
                `manifest=${toPosix(path.relative(process.cwd(), manifestPath))}`,
                `buildOutput=${manifest.pagesBuildOutputDir}`,
                `buildCommand=${manifest.buildCommand}`,
            ],
        };
    }

    const missing = manifest.guardSnippets
        .filter((snippet) => !snippet.found)
        .map((snippet) => snippet.label);
    const packageFailures = [
        !manifest.pagesPackage.wranglerJsonExists ? 'dist/server/wrangler.json missing' : null,
        !manifest.pagesPackage.serverEntryExists ? 'dist/server/entry.mjs missing' : null,
        !manifest.pagesPackage.clientAssetsExists ? 'dist/client missing' : null,
        manifest.pagesPackage.assetsBinding !== 'ASSETS' ? 'ASSETS binding missing' : null,
        manifest.pagesPackage.checkoutEnabledDefault !== 'false' ? 'CHECKOUT_ENABLED default is not false in build config' : null,
        !manifest.pagesPackage.nodejsCompat ? 'nodejs_compat flag missing' : null,
        !manifest.pagesPackage.withinPagesFileCountLimit ? 'Static asset file count limit exceeded' : null,
        !manifest.pagesPackage.withinPagesFileSizeLimit ? 'Static asset file size limit exceeded' : null,
    ].filter((failure): failure is string => Boolean(failure));

    return {
        status: missing.length === 0 && packageFailures.length === 0 ? 'ok' : 'failed',
        name: 'local_build_package_guard',
        message: missing.length === 0 && packageFailures.length === 0
            ? 'Local Worker build output contains the checkout-disabled guard and deploy package basics needed for staging deploy.'
            : 'Local Worker build output does not contain the checkout-disabled guard or deploy package basics needed for staging deploy.',
        details: [
            `manifest=${toPosix(path.relative(process.cwd(), manifestPath))}`,
            `buildOutput=${manifest.pagesBuildOutputDir}`,
            `matchedFiles=${manifest.matchedFiles.map((file) => file.path).join(', ') || 'none'}`,
            `fileCount=${manifest.pagesPackage.fileCount}`,
            `maxFileBytes=${manifest.pagesPackage.maxFileBytes}`,
            `checkoutEnabledDefault=${manifest.pagesPackage.checkoutEnabledDefault ?? 'missing'}`,
            ...(missing.length > 0 ? [`missing=${missing.join(', ')}`] : []),
            ...(packageFailures.length > 0 ? [`packageFailures=${packageFailures.join(', ')}`] : []),
        ],
    };
}

function buildLocalBuildPackageManifest(): BuildPackageManifest {
    const buildOutputDir = pagesBuildOutputDir();
    const absoluteBuildOutputDir = path.join(process.cwd(), buildOutputDir);
    const guardSnippets = [
        {
            label: 'checkout disabled response',
            snippet: 'Checkout is disabled',
            found: false,
            matchedFiles: [] as string[],
        },
        {
            label: 'checkout env flag',
            snippet: 'CHECKOUT_ENABLED',
            found: false,
            matchedFiles: [] as string[],
        },
    ];
    const matchedFiles = new Map<string, { path: string; sha256: string; bytes: number; snippets: string[] }>();
    let scannedFiles = 0;
    let scannedBytes = 0;
    const pagesPackage = inspectPagesBuildPackage(buildOutputDir);

    if (existsSync(absoluteBuildOutputDir)) {
        for (const filePath of listTextBuildFiles(absoluteBuildOutputDir)) {
            const relativePath = toPosix(path.relative(process.cwd(), filePath));
            const content = readFileSync(filePath, 'utf8');
            const bytes = Buffer.byteLength(content, 'utf8');
            scannedFiles += 1;
            scannedBytes += bytes;

            for (const guard of guardSnippets) {
                if (!content.includes(guard.snippet)) continue;
                guard.found = true;
                guard.matchedFiles.push(relativePath);

                const existing = matchedFiles.get(relativePath);
                if (existing) {
                    existing.snippets.push(guard.label);
                } else {
                    matchedFiles.set(relativePath, {
                        path: relativePath,
                        sha256: sha256(content),
                        bytes,
                        snippets: [guard.label],
                    });
                }
            }
        }
    }

    const buildOutputExists = existsSync(absoluteBuildOutputDir);
    const readyForStagingDeployPackage = buildOutputExists
        && guardSnippets.every((guard) => guard.found)
        && pagesPackage.wranglerJsonExists
        && pagesPackage.serverEntryExists
        && pagesPackage.clientAssetsExists
        && pagesPackage.assetsBinding === 'ASSETS'
        && pagesPackage.checkoutEnabledDefault === 'false'
        && pagesPackage.nodejsCompat
        && pagesPackage.withinPagesFileCountLimit
        && pagesPackage.withinPagesFileSizeLimit;

    return {
        schemaVersion: 1,
        generatedAt: new Date().toISOString(),
        projectName,
        pagesBuildOutputDir: buildOutputDir,
        buildCommand: 'corepack pnpm build',
        buildOutputExists,
        readyForStagingDeployPackage,
        guardSnippets,
        matchedFiles: Array.from(matchedFiles.values()).sort((a, b) => a.path.localeCompare(b.path)),
        pagesPackage,
        scanned: {
            files: scannedFiles,
            bytes: scannedBytes,
        },
        requiredPostDeployProof: `${deployedUrl}/api/create-checkout returns 403 with Checkout is disabled for an empty POST body.`,
        nextSteps: readyForStagingDeployPackage
            ? [
                'Review this manifest together with rc-staging-runtime-manifest.json and the remediation pack.',
                'Get explicit approval before deploying to the Cloudflare Astro Worker staging target.',
                `After deploy/config fix, run corepack pnpm launch:no-real-payments -- --deployed-url ${deployedUrl}.`,
            ]
            : [
                'Run corepack pnpm build and rerun corepack pnpm launch:staging-no-real-payments-remediation.',
                'Do not use a deploy package whose build output lacks the checkout-disabled guard.',
            ],
        evidenceRules: [
            'Record only paths, hashes, build timestamp and post-fix command output.',
            'Do not paste built JavaScript contents, secret values, environment values or private data into evidence.',
        ],
        forbiddenScope: [
            'Production Cloudflare Worker changes or deployments.',
            'CHECKOUT_ENABLED=true, Stripe live mode, live Price IDs or real checkout enablement.',
            'Supabase writes, legal real data, final secrets, domain/Search Console changes or production smoke.',
        ],
    };
}

function inspectPagesBuildPackage(buildOutputDir: string): BuildPackageManifest['pagesPackage'] {
    const absoluteBuildOutputDir = path.join(process.cwd(), buildOutputDir);
    const wranglerJsonPath = path.join(absoluteBuildOutputDir, 'server', 'wrangler.json');
    const serverEntryPath = path.join(absoluteBuildOutputDir, 'server', 'entry.mjs');
    const clientAssetsPath = path.join(absoluteBuildOutputDir, 'client');
    const wranglerJson = existsSync(wranglerJsonPath)
        ? parseJsonFileObject(wranglerJsonPath)
        : null;
    const stats = existsSync(absoluteBuildOutputDir)
        ? collectBuildPackageStats(absoluteBuildOutputDir)
        : { fileCount: 0, totalBytes: 0, maxFileBytes: 0, largestFilePath: null };
    const compatibilityFlags = Array.isArray(wranglerJson?.compatibility_flags)
        ? wranglerJson.compatibility_flags
        : [];
    const vars = isRecord(wranglerJson?.vars) ? wranglerJson.vars : {};
    const assets = isRecord(wranglerJson?.assets) ? wranglerJson.assets : {};

    return {
        wranglerJsonPath: toPosix(path.relative(process.cwd(), wranglerJsonPath)),
        wranglerJsonExists: existsSync(wranglerJsonPath),
        serverEntryPath: toPosix(path.relative(process.cwd(), serverEntryPath)),
        serverEntryExists: existsSync(serverEntryPath),
        clientAssetsPath: toPosix(path.relative(process.cwd(), clientAssetsPath)),
        clientAssetsExists: existsSync(clientAssetsPath),
        assetsBinding: typeof assets.binding === 'string' ? assets.binding : null,
        assetsDirectory: typeof assets.directory === 'string' ? assets.directory : null,
        checkoutEnabledDefault: typeof vars.CHECKOUT_ENABLED === 'string' ? vars.CHECKOUT_ENABLED : null,
        nodejsCompat: compatibilityFlags.includes('nodejs_compat'),
        fileCount: stats.fileCount,
        totalBytes: stats.totalBytes,
        maxFileBytes: stats.maxFileBytes,
        largestFilePath: stats.largestFilePath,
        withinPagesFileCountLimit: stats.fileCount <= 20000,
        withinPagesFileSizeLimit: stats.maxFileBytes <= 25 * 1024 * 1024,
    };
}

function collectBuildPackageStats(root: string): {
    fileCount: number;
    totalBytes: number;
    maxFileBytes: number;
    largestFilePath: string | null;
} {
    let fileCount = 0;
    let totalBytes = 0;
    let maxFileBytes = 0;
    let largestFilePath: string | null = null;
    const stack = [root];

    while (stack.length > 0) {
        const current = stack.pop();
        if (!current) continue;
        for (const entry of readdirSync(current, { withFileTypes: true })) {
            const fullPath = path.join(current, entry.name);
            if (entry.isDirectory()) {
                stack.push(fullPath);
                continue;
            }
            if (!entry.isFile()) continue;

            const stats = statSync(fullPath);
            fileCount += 1;
            totalBytes += stats.size;
            if (stats.size > maxFileBytes) {
                maxFileBytes = stats.size;
                largestFilePath = toPosix(path.relative(process.cwd(), fullPath));
            }
        }
    }

    return { fileCount, totalBytes, maxFileBytes, largestFilePath };
}

function parseJsonFileObject(filePath: string): Record<string, unknown> | null {
    try {
        const parsed = JSON.parse(readFileSync(filePath, 'utf8'));
        return isRecord(parsed) ? parsed : null;
    } catch {
        return null;
    }
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function pagesBuildOutputDir(): string {
    if (!existsSync('wrangler.toml')) return 'dist';
    const config = readFileSync('wrangler.toml', 'utf8');
    const match = config.match(/pages_build_output_dir\s*=\s*"([^"]+)"/);
    return match?.[1] ?? 'dist';
}

function listTextBuildFiles(root: string): string[] {
    const output: string[] = [];
    const allowed = new Set(['.js', '.mjs', '.cjs', '.json', '.html', '.txt']);
    const stack = [root];

    while (stack.length > 0) {
        const current = stack.pop();
        if (!current) continue;
        for (const entry of readdirSync(current, { withFileTypes: true })) {
            const fullPath = path.join(current, entry.name);
            if (entry.isDirectory()) {
                stack.push(fullPath);
                continue;
            }

            if (!entry.isFile()) continue;
            if (!allowed.has(path.extname(entry.name))) continue;
            const stats = statSync(fullPath);
            if (stats.size > 5 * 1024 * 1024) continue;
            output.push(fullPath);
        }
    }

    return output.sort((a, b) => a.localeCompare(b));
}

async function checkDeployedCheckoutProbe(baseUrl: string): Promise<CheckResult> {
    const url = `${baseUrl}/api/create-checkout`;
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
        const enabledLike = response.status === 400 && payload?.error === 'priceId is required';

        return {
            status: disabled ? 'ok' : 'failed',
            name: 'deployed_checkout_probe',
            message: disabled
                ? 'Staging deployed checkout endpoint is blocked for no-real-payments mode.'
                : enabledLike
                    ? 'Staging deployed checkout endpoint is not blocked: it behaves like checkout is enabled.'
                    : 'Staging deployed checkout endpoint returned an unexpected response.',
            details: [
                `url=${url}`,
                `status=${response.status}`,
                `error=${typeof payload?.error === 'string' ? payload.error : 'missing'}`,
                'safe_probe=POST empty JSON body; no price, cookie, customer, Supabase write or Stripe session.',
            ],
        };
    } catch (error) {
        return {
            status: 'failed',
            name: 'deployed_checkout_probe',
            message: 'Could not probe staging deployed checkout endpoint.',
            details: [`url=${url}`, errorMessage(error)],
        };
    }
}

function runWranglerWorkerReadOnly(name: string, args: string[], expectedSnippets: string[]): CheckResult {
    const logPath = path.join(outputDir, `${name}.log`);
    const result = spawnSync(corepackCommand(), args, {
        cwd: process.cwd(),
        encoding: 'utf8',
        shell: process.platform === 'win32',
        maxBuffer: 20 * 1024 * 1024,
    });
    const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
    const missing = expectedSnippets.filter((snippet) => !output.includes(snippet));

    writeFileSync(logPath, [
        `$ ${corepackCommand()} ${args.join(' ')}`,
        `exitCode=${result.status ?? 'null'}`,
        '',
        redactOutput(output),
        result.error ? `\nerror=${result.error.message}` : '',
    ].join('\n'), 'utf8');

    return {
        status: result.status === 0 && missing.length === 0 ? 'ok' : 'warning',
        name,
        message: result.status === 0 && missing.length === 0
            ? 'Wrangler Worker read-only command returned expected deployment evidence.'
            : 'Wrangler Worker read-only command did not return all expected evidence.',
        details: [
            `log=${toPosix(path.relative(process.cwd(), logPath))}`,
            `exitCode=${result.status ?? 'null'}`,
            ...(missing.length > 0 ? [`missing=${missing.join(', ')}`] : []),
        ],
    };
}

function runGit(args: string[]): { ok: boolean; stdout: string; stderr: string } {
    const result = spawnSync('git', args, {
        cwd: process.cwd(),
        encoding: 'utf8',
        shell: process.platform === 'win32',
        maxBuffer: 5 * 1024 * 1024,
    });

    return {
        ok: result.status === 0,
        stdout: result.stdout ?? '',
        stderr: `${result.stderr ?? ''}${result.error ? `\n${result.error.message}` : ''}`,
    };
}

function markExternalWriteRequired(deployedCheckoutBlocked: boolean): CheckResult {
    if (deployedCheckoutBlocked) {
        return {
            status: 'ok',
            name: 'external_write_required',
            message: 'No additional Cloudflare write is required by this check; staging checkout is already blocked.',
            details: [
                'Target resource checked: Cloudflare Worker espanolhonesto-staging.',
                `Post-fix proof: corepack pnpm launch:no-real-payments -- --deployed-url ${deployedUrl} returns OK.`,
            ],
        };
    }

    return {
        status: 'warning',
        name: 'external_write_required',
        message: 'Closing staging no-real-payments requires an explicit Cloudflare Worker staging write or redeploy confirmation.',
        details: [
            'Target resource: Cloudflare Worker espanolhonesto-staging.',
            'Preferred fix: if local_deployment_gap is warning, package/redeploy current code/config to staging first; then set or verify CHECKOUT_ENABLED=false.',
            `Post-fix proof: corepack pnpm launch:no-real-payments -- --deployed-url ${deployedUrl} returns OK.`,
        ],
    };
}

function renderSummary(report: RemediationReport): string {
    const lines = [
        '# Staging No-Real-Payments Remediation',
        '',
        `- Status: ${report.status}`,
        `- Started: ${report.startedAt}`,
        `- Ended: ${report.endedAt}`,
        `- Project: ${report.projectName}`,
        `- Deployed URL: ${report.deployedUrl}`,
        `- Output: ${report.outputDir}`,
        `- Remediation pack: ${toPosix(path.relative(process.cwd(), report.remediationPackPath))}`,
        `- Build package manifest: ${toPosix(path.relative(process.cwd(), report.buildPackageManifestPath))}`,
        `- Approval request: ${toPosix(path.relative(process.cwd(), report.approvalRequestPath))}`,
        `- Manual evidence dry run: ${toPosix(path.relative(process.cwd(), report.manualEvidenceDryRunPath))}`,
        '',
        '## Scope',
        '',
        'This command is read-only for Cloudflare. It probes the staging checkout endpoint, reads local Worker config, lists Worker deployments, and writes a remediation pack. It does not deploy, change variables, delete deployments, write secrets, call Stripe or update manual evidence.',
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

function renderApprovalRequest(report: RemediationReport): string {
    const remediationPack = toPosix(path.relative(process.cwd(), report.remediationPackPath));
    const buildPackageManifest = toPosix(path.relative(process.cwd(), report.buildPackageManifestPath));
    const checksToRecord = [
        'Cloudflare account and Worker name.',
        'Target environment that serves the staging URL.',
        'CHECKOUT_ENABLED=false as a state claim, not a secret value.',
        'Deployment id/timestamp or dashboard confirmation after change.',
        `Post-fix output from corepack pnpm launch:no-real-payments -- --deployed-url ${report.deployedUrl}.`,
    ];

    return `${[
        '# Cloudflare Worker Staging No-Real-Payments Approval Request',
        '',
        'Use this text when asking for explicit permission to touch Cloudflare Worker staging. This file is not permission by itself.',
        '',
        'Requested scope:',
        '',
        `- Target: Cloudflare Worker \`${report.projectName}\`.`,
        `- Staging URL: \`${report.deployedUrl}\`.`,
        '- Environment: staging/preview deployment serving that URL only.',
        '- Production Worker, custom production domain, Stripe live and real checkout enablement are excluded.',
        '',
        'Read-only preflight before any write:',
        '',
        `- Review \`${remediationPack}\`.`,
        `- Review \`${buildPackageManifest}\` and confirm \`readyForStagingDeployPackage=true\` before using a build output as deploy source.`,
        '- Confirm the Cloudflare account and Worker are correct.',
        '- Confirm which Worker environment/deployment serves the staging URL.',
        '- Confirm the deployment contains the committed no-real-payments guard; working-tree-only changes are not present in Cloudflare.',
        '- If `local_deployment_gap` is warning, do not rely on a variable-only fix; first package, commit or otherwise deploy the exact guard/config changes that read `CHECKOUT_ENABLED`.',
        '- List variable names only; do not record secret values.',
        '- Confirm the desired end state is checkout disabled: `/api/create-checkout` returns `403` with `Checkout is disabled` before Supabase or Stripe.',
        '',
        'Allowed staging action after explicit approval:',
        '',
        '- Set or verify non-secret variable `CHECKOUT_ENABLED=false` only when the running deployment already contains the committed checkout guard that reads `CHECKOUT_ENABLED`.',
        '- If the guard/config is working-tree-only or missing from the deployed source, package and redeploy current code/config to the staging Worker before treating the variable as evidence.',
        '- Do not set `CHECKOUT_ENABLED=true`, add live Price IDs, enable Stripe live or change production Worker as part of this approval.',
        '',
        'Evidence to record after review:',
        '',
        ...checksToRecord.map((item) => `- ${item}`),
        '',
        'Post-check:',
        '',
        '```bash',
        `corepack pnpm launch:no-real-payments -- --deployed-url ${report.deployedUrl}`,
        'corepack pnpm launch:rc-external-closure',
        'corepack pnpm launch:rc',
        '```',
        '',
        'Forbidden from this approval:',
        '',
        '- Production Cloudflare Worker changes or deployments.',
        '- Stripe live mode, real checkout enablement or payment acceptance.',
        '- Secret reads/writes beyond variable-name review; never store secret values.',
        '- Supabase writes, legal real data, final secrets, domain/Search Console changes or production smoke.',
        '',
    ].join('\n')}\n`;
}

function renderManualEvidenceDryRun(report: RemediationReport): string {
    const summaryPath = relativeToLaunchDocs(path.join(report.outputDir, 'summary.md'));
    const remediationPack = relativeToLaunchDocs(report.remediationPackPath);
    const buildPackageManifest = relativeToLaunchDocs(report.buildPackageManifestPath);
    const approvalRequest = relativeToLaunchDocs(report.approvalRequestPath);
    const postFixCommand = `corepack pnpm launch:no-real-payments -- --deployed-url ${report.deployedUrl}`;
    const commandLines = [
        'corepack pnpm launch:manual-evidence:record --',
        '  --id payments_staging',
        '  --status pass',
        '  --summary "No-real-payments staging mode verified for RC: Cloudflare Worker staging returns 403 Checkout is disabled before Supabase or Stripe, public CTAs remain application-first, and Stripe live/payment smoke remain final-only."',
        '  --environment "Cloudflare Worker staging, no-real-payments mode"',
        '  --owner Alin',
        `  --evidence "command_output=${summaryPath}::staging no-real-payments remediation pack reviewed"`,
        `  --evidence "command_output=${remediationPack}::Cloudflare Worker staging remediation scope reviewed"`,
        `  --evidence "command_output=${buildPackageManifest}::Worker staging build package manifest includes checkout-disabled guard"`,
        `  --evidence "command_output=${approvalRequest}::approval scope limited to Cloudflare Worker staging checkout-disabled state"`,
        `  --evidence "manual_note=Replace with concrete non-secret result after running: ${postFixCommand}. Expected: deployed checkout probe returns 403 Checkout is disabled; no Stripe session, Supabase write, production Worker change or CHECKOUT_ENABLED=true."`,
    ];

    return `${[
        '# Manual Evidence Dry Run: Staging No-Real-Payments',
        '',
        'Use this only after the Cloudflare Worker staging fix is complete and the post-fix deployed probe passes. The command is intentionally a dry run until `--write` is added.',
        '',
        commandLines.join(' \\\n'),
        '',
        '# Add --write only after replacing the manual_note with concrete non-secret evidence from the passing post-fix probe.',
        '',
    ].join('\n')}`;
}

function renderRemediationPack(report: RemediationReport): string {
    const probe = report.checks.find((check) => check.name === 'deployed_checkout_probe');
    const lines = [
        '# Staging No-Real-Payments Remediation Pack',
        '',
        `- Generated: ${report.endedAt}`,
        `- Cloudflare Worker: ${report.projectName}`,
        `- Staging URL: ${report.deployedUrl}`,
        `- Probe result: ${probe?.status ?? 'missing'} - ${probe?.message ?? 'missing'}`,
        `- Build package manifest: ${toPosix(path.relative(process.cwd(), report.buildPackageManifestPath))}`,
        '',
        '## Problem',
        '',
        'The current no-real-payments RC requires the deployed checkout endpoint to fail closed with `403` and `Checkout is disabled`. If the deployed endpoint returns `400 priceId is required`, it is processing checkout as enabled or is running older code/config.',
        '',
        'If `local_deployment_gap` warns, the local working tree contains checkout/config changes that Cloudflare cannot serve until they are committed and redeployed to the staging Worker.',
        '',
        '## Read-Only Evidence',
        '',
    ];

    for (const check of report.checks) {
        lines.push(`- ${check.status}: ${check.name} - ${check.message}`);
        for (const detail of check.details ?? []) {
            lines.push(`  - ${detail}`);
        }
    }

    lines.push(
        '',
        '## Remediation Options',
        '',
        '1. If `local_deployment_gap` reports working-tree-only checkout/config changes, commit or otherwise package those exact changes before redeploying staging.',
        '2. Redeploy current code/config to `espanolhonesto-staging`; root `wrangler.toml` now explicitly defaults `CHECKOUT_ENABLED = "false"` for Worker config.',
        '3. In Cloudflare dashboard, set or verify non-secret variable `CHECKOUT_ENABLED=false` for the Worker/environment that serves staging. This is sufficient evidence only after the deployed code contains the checkout guard that reads it.',
        '4. If deploying a local build output, review `worker-staging-build-manifest.json` first and require `readyForStagingDeployPackage=true`.',
        '5. Do not enable Stripe live or add live Price IDs while this check fails.',
        '',
        '## Post-Fix Verification',
        '',
        'Run:',
        '',
        '```bash',
        `corepack pnpm launch:no-real-payments -- --deployed-url ${report.deployedUrl}`,
        'corepack pnpm launch:rc',
        '```',
        '',
        'Expected:',
        '',
        '- `launch:no-real-payments` returns `OK` or has no deployed-environment failure.',
        '- `/api/create-checkout` returns `403` with `Checkout is disabled`.',
        '- `launch:rc` may still block on `database_readiness` or `operations_external`, but not on no-real-payments safeguards.',
        '',
        '## External Write Gate',
        '',
        'Before making the Cloudflare change, state the exact target and action: Cloudflare Worker `espanolhonesto-staging`, redeploy packaged current code/config to staging and/or set/update non-secret variable `CHECKOUT_ENABLED=false`. If the deployed source lacks the checkout guard, a variable-only change is not enough. Do not touch production Worker or Stripe live as part of this fix.',
        '',
    );

    return `${lines.join('\n')}\n`;
}

async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
        return await fetch(url, { ...init, signal: controller.signal });
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

function readArgValue(name: string): string | null {
    const index = process.argv.indexOf(name);
    if (index === -1) return null;
    return process.argv[index + 1] ?? null;
}

function normalizeBaseUrl(value: string): string {
    return value.replace(/\/+$/g, '');
}

function redactOutput(value: string): string {
    return value
        .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[redacted-email]')
        .replace(/Bearer\s+[A-Za-z0-9._~-]+/g, 'Bearer [redacted]');
}

function sha256(value: string): string {
    return createHash('sha256').update(value).digest('hex');
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

function relativeToLaunchDocs(filePath: string): string {
    return toPosix(path.relative(path.join(process.cwd(), 'docs', 'launch'), filePath));
}

function escapeCell(value: string): string {
    return value.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? `error=${error.message}` : 'error=unknown';
}
