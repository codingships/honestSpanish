import { type ChildProcess, spawn } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import lighthouse, {
    desktopConfig,
    generateReport,
    type Flags as LighthouseFlags,
} from 'lighthouse/core/index.js';
import { chromium } from 'playwright';
import { configurePlaywrightEnvironment } from '../../tests/e2e/environment-guard';
import {
    type LighthouseResult,
    summarizeLighthouse,
    writeLighthouseSummary,
} from './summarize-lighthouse';

export type AuditConfiguration = {
    baseOrigin: string;
    floors: {
        accessibilityWorst: number;
        bestPracticesMedian: number;
        clsWorst: number;
        consoleErrorsWorst: number;
        lcpMedianMs: number;
        performanceMedian: number;
        tbtMedianMs: number;
    };
    localServer: boolean;
    outputDirectory: string;
    profile: 'mobile' | 'desktop';
    routes: string[];
    runCount: number;
    scope: 'smoke' | 'full';
    seoIsInformational: boolean;
    settings: {
        chromeFlags: string[];
        maxWaitForLoadMs: number;
        onlyCategories: string[];
    };
};

const require = createRequire(import.meta.url);
const configuration = require(resolve('lighthouse.config.cjs')) as AuditConfiguration;
const lighthousePackagePath = require.resolve('lighthouse/package.json');
const runtimeProbe = 'http://localhost:4321/api/e2e-runtime/environment';

type AuditBrowser = {
    kill: () => void;
    port: number;
};

type ChromeLauncher = {
    launch: (options: {
        chromeFlags: string[];
        chromePath: string;
        envVars: NodeJS.ProcessEnv;
        logLevel: 'error';
    }) => Promise<AuditBrowser>;
};

function safeOutputDirectory(path: string): string {
    const root = resolve('test-results', 'lighthouse');
    const output = resolve(path);
    if (output !== join(root, configuration.profile)) {
        throw new Error('Lighthouse output must be the exact profile directory under test-results/lighthouse.');
    }
    return output;
}

function boundedLog(current: string, chunk: Buffer): string {
    return `${current}${chunk.toString('utf8')}`.slice(-20_000);
}

function sanitizedEnvironment(): NodeJS.ProcessEnv {
    const environment = { ...process.env };
    configurePlaywrightEnvironment(environment);
    environment.ASTRO_TELEMETRY_DISABLED = '1';
    environment.CHROME_PATH = process.env.CHROME_PATH?.trim() || chromium.executablePath();
    return environment;
}

async function waitForServer(child: ChildProcess, logs: () => string): Promise<void> {
    const deadline = Date.now() + 120_000;
    while (Date.now() < deadline) {
        if (child.exitCode !== null) {
            throw new Error(`Isolated public server exited before readiness.\n${logs()}`);
        }
        try {
            const response = await fetch(runtimeProbe, { signal: AbortSignal.timeout(2_000) });
            if (response.ok) return;
        } catch {
            // The server is still compiling. The bounded readiness window owns retries.
        }
        await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
    }
    throw new Error(`Isolated public server did not become ready within 120 seconds.\n${logs()}`);
}

async function startIsolatedServer(environment: NodeJS.ProcessEnv): Promise<ChildProcess> {
    let logs = '';
    const child = spawn(process.execPath, ['tests/e2e/start-server.mjs'], {
        cwd: process.cwd(),
        env: { ...environment, E2E_SERVER_MODE: 'built' },
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
    });
    child.stdout?.on('data', (chunk: Buffer) => { logs = boundedLog(logs, chunk); });
    child.stderr?.on('data', (chunk: Buffer) => { logs = boundedLog(logs, chunk); });
    await waitForServer(child, () => logs);
    return child;
}

async function stopServer(child: ChildProcess | null): Promise<void> {
    if (!child || child.exitCode !== null || child.killed) return;
    child.kill('SIGTERM');
    await Promise.race([
        new Promise<void>((resolveExit) => child.on('exit', () => resolveExit())),
        new Promise<void>((resolveTimeout) => setTimeout(resolveTimeout, 5_000)),
    ]);
}

async function startAuditBrowser(environment: NodeJS.ProcessEnv): Promise<AuditBrowser> {
    const chromePath = environment.CHROME_PATH?.trim();
    if (!chromePath) throw new Error('The pinned Lighthouse browser path is missing.');

    // Lighthouse owns chrome-launcher. Resolve that exact dependency from the
    // pinned Lighthouse package rather than adding a second browser launcher.
    const lighthouseRequire = createRequire(lighthousePackagePath);
    const chromeLauncherPath = lighthouseRequire.resolve('chrome-launcher');
    const chromeLauncher = await import(pathToFileURL(chromeLauncherPath).href) as ChromeLauncher;
    return chromeLauncher.launch({
        chromeFlags: configuration.settings.chromeFlags,
        chromePath,
        envVars: environment,
        logLevel: 'error',
    });
}

function routeSlug(route: string): string {
    return route.replace(/^\/+|\/+$/gu, '').replace(/[^a-z0-9]+/giu, '-') || 'root';
}

function firstNodeSnippet(value: unknown, depth = 0): string | null {
    if (depth > 6 || value === null || typeof value !== 'object') return null;
    const record = value as Record<string, unknown>;
    if (record.type === 'node') {
        if (typeof record.snippet === 'string') return record.snippet.replace(/\s+/gu, ' ').slice(0, 240);
        if (typeof record.selector === 'string') return record.selector.slice(0, 240);
    }
    if (record.node && typeof record.node === 'object') {
        const node = record.node as Record<string, unknown>;
        if (typeof node.snippet === 'string') return node.snippet.replace(/\s+/gu, ' ').slice(0, 240);
        if (typeof node.selector === 'string') return node.selector.slice(0, 240);
    }
    for (const child of Object.values(record)) {
        const snippet = firstNodeSnippet(child, depth + 1);
        if (snippet) return snippet;
    }
    return null;
}

function lcpSubparts(value: unknown, depth = 0): Record<string, number> {
    if (depth > 8 || value === null || typeof value !== 'object') return {};
    const record = value as Record<string, unknown>;
    const own = typeof record.subpart === 'string' && typeof record.duration === 'number'
        ? { [record.subpart]: Math.round(record.duration) }
        : {};
    return Object.assign(
        own,
        ...Object.values(record).map((child) => lcpSubparts(child, depth + 1)),
    );
}

function writeRouteDiagnostic(route: string, report: LighthouseResult): void {
    const fcp = report.audits['first-contentful-paint']?.numericValue;
    const lcp = report.audits['largest-contentful-paint']?.numericValue;
    const ttfb = report.audits['server-response-time']?.numericValue;
    const lcpInsight = report.audits['lcp-breakdown-insight'];
    const element = firstNodeSnippet(lcpInsight?.details);
    const breakdown = lcpSubparts(lcpInsight?.details);
    process.stdout.write(
        `[lighthouse] diagnostic ${route} FCP=${String(Math.round(fcp ?? 0))}ms LCP=${String(Math.round(lcp ?? 0))}ms TTFB=${String(Math.round(ttfb ?? 0))}ms breakdown=${JSON.stringify(breakdown)} element=${JSON.stringify(element ?? 'unknown')}\n`,
    );
}

async function collectReports(
    outputDirectory: string,
    browser: AuditBrowser,
): Promise<LighthouseResult[]> {
    const reports: LighthouseResult[] = [];
    for (const route of configuration.routes) {
        const url = `${configuration.baseOrigin}${route}`;
        for (let run = 1; run <= configuration.runCount; run += 1) {
            const outputBase = join(outputDirectory, `${routeSlug(route)}-run-${String(run)}`);
            process.stdout.write(`[lighthouse] ${configuration.profile} ${route} run ${String(run)}/${String(configuration.runCount)}\n`);
            const flags: LighthouseFlags = {
                channel: 'node',
                logLevel: 'error',
                maxWaitForLoad: configuration.settings.maxWaitForLoadMs,
                onlyCategories: configuration.settings.onlyCategories,
                port: browser.port,
            };
            const result = await lighthouse(
                url,
                flags,
                configuration.profile === 'desktop' ? desktopConfig : undefined,
            );
            if (!result) throw new Error(`Lighthouse did not return a report for ${route}.`);

            const report = result.lhr as LighthouseResult;
            writeFileSync(`${outputBase}.report.json`, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
            writeFileSync(`${outputBase}.report.html`, generateReport(result.lhr, 'html'), 'utf8');
            if (result.lhr.runtimeError) {
                throw new Error(
                    `Lighthouse runtime error for ${route}: ${result.lhr.runtimeError.code} ${result.lhr.runtimeError.message}`,
                );
            }
            writeRouteDiagnostic(route, report);
            reports.push(report);
        }
    }
    return reports;
}

function required(value: number | null, label: string): number {
    if (value === null) throw new Error(`Lighthouse did not produce ${label}.`);
    return value;
}

export function validateLighthouseResults(
    reports: LighthouseResult[],
    config: AuditConfiguration = configuration,
): { failures: string[]; warnings: string[] } {
    const failures: string[] = [];
    const warnings: string[] = [];
    for (const route of summarizeLighthouse(reports)) {
        const path = new URL(route.url).pathname;
        const performance = route.categories.performance!;
        const accessibility = route.categories.accessibility!;
        const bestPractices = route.categories['best-practices']!;
        const seo = route.categories.seo!;
        const lcp = route.metrics.lcpMs!;
        const tbt = route.metrics.tbtMs!;
        const cls = route.metrics.cls!;
        const routeReports = reports.filter((report) => (report.finalUrl || report.requestedUrl) === route.url);
        const consoleWorst = Math.min(...routeReports.map((report) => (
            report.audits['errors-in-console']?.score ?? 0
        ) * 100));

        if (required(performance.median, `${path} performance`) < config.floors.performanceMedian) {
            failures.push(`${path}: median performance below ${String(config.floors.performanceMedian)}`);
        }
        if (required(accessibility.worst, `${path} accessibility`) < config.floors.accessibilityWorst) {
            failures.push(`${path}: worst accessibility below ${String(config.floors.accessibilityWorst)}`);
        }
        if (required(bestPractices.median, `${path} best practices`) < config.floors.bestPracticesMedian) {
            failures.push(`${path}: median best practices below ${String(config.floors.bestPracticesMedian)}`);
        }
        if (required(lcp.median, `${path} LCP`) > config.floors.lcpMedianMs) {
            failures.push(`${path}: median LCP above ${String(config.floors.lcpMedianMs)} ms`);
        }
        if (required(tbt.median, `${path} TBT`) > config.floors.tbtMedianMs) {
            failures.push(`${path}: median TBT above ${String(config.floors.tbtMedianMs)} ms`);
        }
        if (required(cls.worst, `${path} CLS`) > config.floors.clsWorst) {
            failures.push(`${path}: worst CLS above ${String(config.floors.clsWorst)}`);
        }
        if (consoleWorst < config.floors.consoleErrorsWorst) {
            failures.push(`${path}: console errors detected`);
        }
        if (config.seoIsInformational && required(seo.median, `${path} SEO`) < 90) {
            warnings.push(`${path}: SEO ${String(seo.median)} is informational because test/staging is noindex`);
        }
    }
    return { failures, warnings };
}

async function run(): Promise<void> {
    const outputDirectory = safeOutputDirectory(configuration.outputDirectory);
    rmSync(outputDirectory, { force: true, recursive: true });
    mkdirSync(outputDirectory, { recursive: true });
    const environment = sanitizedEnvironment();
    let server: ChildProcess | null = null;
    let browser: AuditBrowser | null = null;

    try {
        if (configuration.localServer) server = await startIsolatedServer(environment);
        browser = await startAuditBrowser(environment);
        const reports = await collectReports(outputDirectory, browser);
        const metadata = {
            baseOrigin: configuration.baseOrigin,
            chromePathSource: process.env.CHROME_PATH ? 'environment' : 'playwright-lockfile',
            generatedAt: new Date().toISOString(),
            profile: configuration.profile,
            runCount: configuration.runCount,
            runtime: configuration.localServer ? 'compiled-cloudflare-worker' : 'canonical-staging',
            scope: configuration.scope,
            sourceSha: process.env.GITHUB_SHA || 'local',
        };
        writeFileSync(join(outputDirectory, 'run-metadata.json'), `${JSON.stringify(metadata, null, 2)}\n`, 'utf8');
        writeLighthouseSummary(outputDirectory);
        const validation = validateLighthouseResults(reports);
        for (const warning of validation.warnings) process.stderr.write(`[lighthouse] warning: ${warning}\n`);
        if (validation.failures.length > 0) {
            throw new Error(`Lighthouse regression floors failed:\n- ${validation.failures.join('\n- ')}`);
        }
    } finally {
        browser?.kill();
        await stopServer(server);
    }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    run().catch((error: unknown) => {
        process.stderr.write(`${error instanceof Error ? error.stack || error.message : String(error)}\n`);
        process.exitCode = 1;
    });
}
