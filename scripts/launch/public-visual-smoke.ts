import dotenv from 'dotenv';
import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { type Browser, type Page } from 'playwright';
import { launchChromiumForLaunch } from './playwright-browser';

interface PublicTarget {
    name: string;
    path: string;
    expectedTexts: string[];
}

interface ViewportTarget {
    name: string;
    width: number;
    height: number;
}

interface VisualResult {
    targetName: string;
    viewportName: string;
    url: string;
    finalUrl: string;
    status: 'ok' | 'failed';
    httpStatus: number;
    screenshotPath: string;
    errors: string[];
    details: {
        missingExpectedTexts: string[];
        mojibakeMarkers: string[];
        staleTextFound: boolean;
        privateLinks: string[];
        ctaCount: number;
        documentWidth: number;
        viewportWidth: number;
    };
}

interface PublicVisualSummary {
    schemaVersion: 1;
    startedAt: string;
    endedAt: string;
    status: 'OK' | 'BLOCKED';
    baseUrl: string;
    browserLabel: string;
    outputDir: string;
    results: VisualResult[];
}

const startedAt = new Date();
if (!existsSync('package.json')) {
    throw new Error('Run this script from the repository root.');
}

dotenv.config({ path: '.env', quiet: true });
dotenv.config({ path: '.env.test', override: true, quiet: true });

const outputDir = path.join(process.cwd(), 'outputs', 'launch-public-visual', stamp(startedAt));
mkdirSync(outputDir, { recursive: true });

const port = Number(process.env.LAUNCH_PUBLIC_VISUAL_PORT || 4391);
const baseUrl = process.env.LAUNCH_PUBLIC_VISUAL_BASE_URL || `http://127.0.0.1:${port}`;
const shouldStartServer = !process.env.LAUNCH_PUBLIC_VISUAL_BASE_URL;
const serverLogPath = path.join(outputDir, 'dev-server.log');

const viewports: ViewportTarget[] = [
    { name: 'desktop', width: 1280, height: 720 },
    { name: 'mobile', width: 390, height: 844 },
];

const targets: PublicTarget[] = [
    {
        name: 'home es',
        path: '/es',
        expectedTexts: [
            'Español Honesto',
            'Qué incluye el curso',
            'Si ya sabes por qué necesitas español',
            'Comunidad con encaje, no grupos de relleno',
            'No vendemos una comunidad artificial',
            'SOLICITAR PLAZA',
            'Español para vivir en España',
            'Español para profesionales',
            'Clases de conversación en español',
        ],
    },
    {
        name: 'living in Spain landing es',
        path: '/es/espanol-para-vivir-en-espana',
        expectedTexts: [
            'VIVIR',
            'ESPAÑA',
            'SOLICITAR PLAZA',
            'Madrid sirve para practicar small talk',
            'Barcelona abre conversación sobre trabajo internacional',
            'Primero encaje. Después plan.',
        ],
    },
    {
        name: 'professionals landing es',
        path: '/es/espanol-para-profesionales',
        expectedTexts: [
            'ESPAÑOL',
            'PROFESIONALES',
            'SOLICITAR PLAZA',
            'Intervenir sin preparar cada frase',
            'La parte que ocurre fuera de la reunión',
            'Primero encaje. Después plan.',
        ],
    },
    {
        name: 'conversation landing es',
        path: '/es/clases-de-conversacion-en-espanol',
        expectedTexts: [
            'HABLAR',
            'CONGELARTE',
            'SOLICITAR PLAZA',
            'Entrar y salir de conversaciones cotidianas',
            'Seguir hablando cuando falta una palabra',
            'Primero encaje. Después plan.',
        ],
    },
];

let server: ChildProcessWithoutNullStreams | null = null;
let browser: Browser | null = null;

try {
    if (shouldStartServer) {
        server = startDevServer(port, serverLogPath);
        await waitForServer(baseUrl);
    }

    const launch = await launchChromiumForLaunch();
    browser = launch.browser;
    const results: VisualResult[] = [];

    for (const viewport of viewports) {
        const context = await browser.newContext({
            viewport: { width: viewport.width, height: viewport.height },
        });
        const page = await context.newPage();

        try {
            for (const target of targets) {
                results.push(await auditVisualPage(page, target, viewport));
            }
        } finally {
            await context.close().catch(() => undefined);
        }
    }

    const failed = results.filter((result) => result.status === 'failed');
    const summary: PublicVisualSummary = {
        schemaVersion: 1,
        startedAt: startedAt.toISOString(),
        endedAt: new Date().toISOString(),
        status: failed.length > 0 ? 'BLOCKED' : 'OK',
        baseUrl,
        browserLabel: launch.label,
        outputDir,
        results,
    };

    writeFileSync(path.join(outputDir, 'summary.json'), JSON.stringify(summary, null, 2), 'utf8');
    writeFileSync(path.join(outputDir, 'summary.md'), renderMarkdown(summary), 'utf8');

    console.log(`[launch:public-visual] Status: ${summary.status}`);
    console.log(`[launch:public-visual] Failed pages: ${failed.length}`);
    console.log(`[launch:public-visual] Browser: ${summary.browserLabel}`);
    console.log(`[launch:public-visual] Summary: ${path.join(outputDir, 'summary.md')}`);

    if (failed.length > 0) process.exitCode = 1;
} finally {
    await browser?.close().catch(() => undefined);
    if (server) {
        await stopServer(server);
    }
}

function startDevServer(port: number, logPath: string): ChildProcessWithoutNullStreams {
    const child = spawn(corepackCommand(), ['pnpm', 'exec', 'astro', 'dev', '--host', '127.0.0.1', '--port', String(port)], {
        cwd: process.cwd(),
        env: {
            ...process.env,
            DEMO_GUIDE_ENABLED: 'false',
            DEMO_GUIDE_LOGIN_ENABLED: 'false',
            E2E_DISABLE_EXTERNAL_INTEGRATIONS: 'true',
        },
        shell: process.platform === 'win32',
    });
    const chunks: string[] = [];
    const append = (chunk: Buffer): void => {
        chunks.push(chunk.toString());
        writeFileSync(logPath, chunks.join(''), 'utf8');
    };
    child.stdout.on('data', append);
    child.stderr.on('data', append);
    return child;
}

async function waitForServer(url: string): Promise<void> {
    const timeoutAt = Date.now() + 120_000;
    let lastError = '';
    const readinessUrl = new URL('/es', url).toString();

    while (Date.now() < timeoutAt) {
        try {
            const response = await fetch(readinessUrl, { redirect: 'follow' });
            const body = await response.text();
            if (
                response.status >= 200
                && response.status < 400
                && body.includes('<body')
                && body.includes('Español Honesto')
            ) return;
            lastError = `HTTP ${response.status}, body=${body.length} bytes`;
        } catch (error) {
            lastError = error instanceof Error ? error.message : String(error);
        }
        await sleep(500);
    }

    throw new Error(`Timed out waiting for ${url}. Last error: ${lastError}`);
}

async function auditVisualPage(page: Page, target: PublicTarget, viewport: ViewportTarget): Promise<VisualResult> {
    let lastResult: VisualResult | null = null;

    for (let attempt = 1; attempt <= 3; attempt += 1) {
        const result = await auditVisualPageOnce(page, target, viewport);
        const transientBlankRender = result.httpStatus >= 200
            && result.httpStatus < 400
            && result.details.missingExpectedTexts.length === target.expectedTexts.length
            && result.details.ctaCount === 0;
        const viteOverlay = result.errors.some((error) => error.includes('Vite error overlay'));
        if (!viteOverlay && !transientBlankRender) return result;

        lastResult = result;
        if (attempt < 3) {
            await sleep(2_500);
            await page.reload({ waitUntil: 'domcontentloaded', timeout: 30_000 }).catch(() => undefined);
        }
    }

    return {
        ...lastResult!,
        errors: [
            ...lastResult!.errors,
            'Transient blank render or Vite error overlay persisted after 3 public visual retries.',
        ],
    };
}

async function auditVisualPageOnce(page: Page, target: PublicTarget, viewport: ViewportTarget): Promise<VisualResult> {
    const url = new URL(target.path, baseUrl).toString();
    const screenshotPath = path.join(outputDir, `${viewport.name}-${slug(target.name)}.png`);
    const errors: string[] = [];
    let httpStatus = 0;

    try {
        const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
        await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => undefined);
        httpStatus = response?.status() ?? 0;

        if (httpStatus >= 400 || httpStatus === 0) {
            errors.push(`HTTP status ${httpStatus}.`);
        }

        const details = await page.evaluate((expectedTexts) => {
            const bodyText = document.body?.innerText || '';
            const mojibakeMarkers = ['Ã', 'Â', '�', 'Ð'].filter((marker) => bodyText.includes(marker));
            const staleText = 'Si ya sabes por que necesitas espanol';
            const privateLinkPattern = /(^|\/)(api|campus|demo)(\/|$)/i;
            const privateLinks = Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href]'))
                .map((anchor) => anchor.getAttribute('href') || '')
                .filter(Boolean)
                .filter((href) => {
                    try {
                        const parsed = new URL(href, window.location.href);
                        return privateLinkPattern.test(parsed.pathname);
                    } catch {
                        return privateLinkPattern.test(href);
                    }
                });
            const actionableText = Array.from(document.querySelectorAll('a, button'))
                .map((element) => element.textContent || '')
                .filter((text) => /solicitar plaza/i.test(text));
            const documentWidth = Math.max(
                document.documentElement.scrollWidth,
                document.body?.scrollWidth || 0,
            );
            const viewportWidth = window.innerWidth;

            return {
                missingExpectedTexts: expectedTexts.filter((text) => !bodyText.includes(text)),
                mojibakeMarkers,
                staleTextFound: bodyText.includes(staleText),
                privateLinks: Array.from(new Set(privateLinks)),
                ctaCount: actionableText.length,
                documentWidth,
                viewportWidth,
                hasViteOverlay: Boolean(document.querySelector('vite-error-overlay')),
            };
        }, target.expectedTexts);

        if (details.missingExpectedTexts.length > 0) {
            errors.push(`Missing expected text: ${details.missingExpectedTexts.join(' / ')}.`);
        }
        if (details.mojibakeMarkers.length > 0) {
            errors.push(`Mojibake markers found: ${details.mojibakeMarkers.join(', ')}.`);
        }
        if (details.staleTextFound) {
            errors.push('Stale unaccented public copy found.');
        }
        if (details.privateLinks.length > 0) {
            errors.push(`Public page links to private/demo/API route: ${details.privateLinks.join(', ')}.`);
        }
        if (details.ctaCount === 0) {
            errors.push('No visible solicitar plaza CTA found.');
        }
        if (details.documentWidth > details.viewportWidth + 1) {
            errors.push(`Horizontal overflow: document ${details.documentWidth}px, viewport ${details.viewportWidth}px.`);
        }
        if (details.hasViteOverlay) {
            errors.push('Vite error overlay detected.');
        }

        await page.screenshot({ path: screenshotPath, fullPage: true });

        return {
            targetName: target.name,
            viewportName: viewport.name,
            url,
            finalUrl: page.url(),
            status: errors.length === 0 ? 'ok' : 'failed',
            httpStatus,
            screenshotPath,
            errors,
            details,
        };
    } catch (error) {
        return {
            targetName: target.name,
            viewportName: viewport.name,
            url,
            finalUrl: page.url(),
            status: 'failed',
            httpStatus,
            screenshotPath,
            errors: [error instanceof Error ? error.message : String(error)],
            details: {
                missingExpectedTexts: target.expectedTexts,
                mojibakeMarkers: [],
                staleTextFound: false,
                privateLinks: [],
                ctaCount: 0,
                documentWidth: 0,
                viewportWidth: viewport.width,
            },
        };
    }
}

async function stopServer(child: ChildProcessWithoutNullStreams): Promise<void> {
    if (child.killed || child.exitCode !== null) return;

    if (process.platform === 'win32' && child.pid) {
        spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
        return;
    }

    child.kill();
    await Promise.race([
        new Promise<void>((resolve) => child.once('exit', () => resolve())),
        sleep(5_000),
    ]);

    if (!child.killed && child.exitCode === null) {
        child.kill('SIGKILL');
    }
}

function renderMarkdown(summary: PublicVisualSummary): string {
    const lines = [
        '# Public Visual Launch Smoke',
        '',
        `- Status: ${summary.status}`,
        `- Started: ${summary.startedAt}`,
        `- Ended: ${summary.endedAt}`,
        `- Base URL: ${summary.baseUrl}`,
        `- Browser: ${summary.browserLabel}`,
        `- Output: ${summary.outputDir}`,
        '',
        '| Status | Viewport | Page | HTTP | Screenshot | Issues |',
        '| --- | --- | --- | --- | --- | --- |',
    ];

    for (const result of summary.results) {
        lines.push([
            `| ${result.status}`,
            escapeCell(result.viewportName),
            escapeCell(result.targetName),
            String(result.httpStatus),
            escapeCell(result.screenshotPath),
            `${escapeCell(result.errors.join(' / ') || 'None')} |`,
        ].join(' | '));
    }

    lines.push('');
    lines.push('## Scope');
    lines.push('');
    lines.push('This smoke checks the public Spanish launch surface on desktop and mobile: render status, expected positioning copy, mojibake markers, stale unaccented copy, horizontal overflow, private/demo/API links, and the solicitar plaza CTA. It does not replace final SEO/LLM review after copy, legal, domain and payment mode are frozen.');
    lines.push('');

    return `${lines.join('\n')}\n`;
}

function stamp(date: Date): string {
    return date.toISOString().replace(/[:.]/g, '-');
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function slug(value: string): string {
    return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'page';
}

function escapeCell(value: string): string {
    return value.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

function corepackCommand(): string {
    return process.platform === 'win32' ? 'corepack.cmd' : 'corepack';
}
