import AxeBuilder from '@axe-core/playwright';
import { type Browser, type Page } from 'playwright';
import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
    ADULT_CONFIRMATION_PATH,
    classifyAuthLanding,
    describeStudentAdultGate,
    type AccessibilityAuthRole,
} from './accessibility-auth-policy';
import { launchChromiumForLaunch } from './playwright-browser';
import {
    assertStagingOrLocalBrowserBaseUrl,
    loadStagingBrowserEnvironment,
} from '../staging-browser-environment';

interface PageTarget {
    name: string;
    path: string;
    expectedPathIncludes?: string;
}

interface AuthenticatedPageTarget extends PageTarget {
    role: AccessibilityAuthRole;
}

type PageCoverage = 'route-audited' | 'adult-gate-audited' | 'not-audited';

interface PageResult {
    name: string;
    url: string;
    finalUrl: string;
    status: 'ok' | 'failed';
    coverage: PageCoverage;
    scope: string;
    protectedRoutes?: string[];
    violations: Array<{
        id: string;
        impact: string | null;
        help: string;
        nodes: string[];
    }>;
    errors: string[];
}

const startedAt = new Date();
if (!existsSync('package.json')) {
    throw new Error('Run this script from the repository root.');
}

loadStagingBrowserEnvironment();

const outputDir = path.join(process.cwd(), 'outputs', 'launch-accessibility', stamp(startedAt));
mkdirSync(outputDir, { recursive: true });

const port = Number(process.env.LAUNCH_ACCESSIBILITY_PORT || 4387);
const baseUrl = assertStagingOrLocalBrowserBaseUrl(
    process.env.LAUNCH_ACCESSIBILITY_BASE_URL || `http://127.0.0.1:${port}`,
    'LAUNCH_ACCESSIBILITY_BASE_URL',
);
const shouldStartServer = !process.env.LAUNCH_ACCESSIBILITY_BASE_URL;
const targets: PageTarget[] = [
    { name: 'home es', path: '/es' },
    { name: 'home en', path: '/en' },
    { name: 'home ru', path: '/ru' },
    { name: 'living in Spain landing es', path: '/es/espanol-para-vivir-en-espana' },
    { name: 'professionals landing es', path: '/es/espanol-para-profesionales' },
    { name: 'conversation landing es', path: '/es/clases-de-conversacion-en-espanol' },
    { name: 'login es', path: '/es/login' },
    { name: 'login en', path: '/en/login' },
    { name: 'login ru', path: '/ru/login' },
    { name: 'legal notice es', path: '/es/legal/aviso-legal' },
    { name: 'privacy es', path: '/es/legal/privacidad' },
    { name: 'terms es', path: '/es/legal/terminos' },
    { name: 'terms en', path: '/en/legal/terminos' },
    { name: 'terms ru', path: '/ru/legal/terminos' },
    { name: 'cookies es', path: '/es/legal/cookies' },
    { name: 'blog index es', path: '/es/blog' },
    { name: 'blog index en', path: '/en/blog' },
    { name: 'blog index ru', path: '/ru/blog' },
    { name: 'blog article es', path: '/es/blog/cuanto-tiempo-hablar-espanol-fluido' },
    { name: 'blog article en', path: '/en/blog/how-long-to-speak-spanish-fluently' },
    { name: 'blog article ru', path: '/ru/blog/how-long-to-speak-spanish-fluently' },
    { name: 'campus unauth redirect', path: '/es/campus', expectedPathIncludes: '/es/login' },
];
const authenticatedTargets: AuthenticatedPageTarget[] = [
    { role: 'student', name: 'student dashboard', path: '/es/campus', expectedPathIncludes: '/es/campus' },
    { role: 'student', name: 'student classes', path: '/es/campus/classes', expectedPathIncludes: '/es/campus/classes' },
    { role: 'student', name: 'student support', path: '/es/campus/support', expectedPathIncludes: '/es/campus/support' },
    { role: 'teacher', name: 'teacher dashboard', path: '/es/campus/teacher', expectedPathIncludes: '/es/campus/teacher' },
    { role: 'teacher', name: 'teacher calendar', path: '/es/campus/teacher/calendar', expectedPathIncludes: '/es/campus/teacher/calendar' },
    { role: 'admin', name: 'admin dashboard', path: '/es/campus/admin', expectedPathIncludes: '/es/campus/admin' },
    { role: 'admin', name: 'admin jobs', path: '/es/campus/admin/jobs', expectedPathIncludes: '/es/campus/admin/jobs' },
];

let server: ChildProcessWithoutNullStreams | null = null;
let browser: Browser | null = null;
let browserLabel = 'unknown';
const serverLogPath = path.join(outputDir, 'dev-server.log');

try {
    if (shouldStartServer) {
        server = startDevServer(port, serverLogPath);
        await waitForServer(baseUrl);
    }

    const launch = await launchChromiumForLaunch();
    browser = launch.browser;
    browserLabel = launch.label;
    const context = await browser.newContext();
    const page = await context.newPage();
    const results: PageResult[] = [];

    for (const target of targets) {
        results.push(await auditPage(page, target));
    }
    await context.close();

    await auditAuthenticatedCampus(browser, results);

    const failed = results.filter((result) => result.status === 'failed');
    const accessibilityManualWorksheetPath = path.join(outputDir, 'accessibility-manual-worksheet.md');
    const summary = {
        schemaVersion: 2,
        startedAt: startedAt.toISOString(),
        endedAt: new Date().toISOString(),
        status: failed.length > 0 ? 'BLOCKED' : 'OK',
        baseUrl,
        browserLabel,
        accessibilityManualWorksheetPath,
        outputDir,
        results,
    };

    writeFileSync(path.join(outputDir, 'summary.json'), JSON.stringify(summary, null, 2), 'utf8');
    writeFileSync(path.join(outputDir, 'summary.md'), renderMarkdown(summary), 'utf8');
    writeFileSync(accessibilityManualWorksheetPath, renderAccessibilityManualWorksheet(summary), 'utf8');

    console.log(`[launch:accessibility] Status: ${summary.status}`);
    console.log(`[launch:accessibility] Failed pages: ${failed.length}`);
    console.log(`[launch:accessibility] Browser: ${summary.browserLabel}`);
    console.log(`[launch:accessibility] Summary: ${path.join(outputDir, 'summary.md')}`);
    console.log(`[launch:accessibility] Manual worksheet: ${accessibilityManualWorksheetPath}`);

    if (failed.length > 0) process.exitCode = 1;
} finally {
    await browser?.close().catch(() => undefined);
    if (server) {
        await stopServer(server);
    }
}

function startDevServer(port: number, logPath: string): ChildProcessWithoutNullStreams {
    const pnpmDevCommand = ['pnpm', 'dev', '--', '--host', '127.0.0.1', '--port', String(port)];
    if (process.platform === 'win32') pnpmDevCommand[0] = 'pnpm.cmd';

    const child = spawn(pnpmDevCommand[0], pnpmDevCommand.slice(1), {
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
    let consecutiveReadyResponses = 0;
    const readinessUrl = new URL('/es', url).toString();

    while (Date.now() < timeoutAt) {
        try {
            const response = await fetch(readinessUrl, { redirect: 'follow' });
            const body = await response.text();
            const hasCompleteDocument = /<html\b[^>]*\blang=(?:"es"|'es')/iu.test(body)
                && /<title>[^<]+<\/title>/iu.test(body)
                && body.includes('<body');
            if (response.status >= 200 && response.status < 400 && hasCompleteDocument) {
                consecutiveReadyResponses += 1;
                if (consecutiveReadyResponses >= 2) return;
            } else {
                consecutiveReadyResponses = 0;
                lastError = `HTTP ${response.status}, completeDocument=${hasCompleteDocument}, body=${body.length} bytes`;
            }
        } catch (error) {
            consecutiveReadyResponses = 0;
            lastError = error instanceof Error ? error.message : String(error);
        }
        await sleep(750);
    }

    throw new Error(`Timed out waiting for ${readinessUrl}. Last error: ${lastError}`);
}

async function auditPage(page: Page, target: PageTarget): Promise<PageResult> {
    let lastResult: PageResult | null = null;

    for (let attempt = 1; attempt <= 3; attempt += 1) {
        const result = await auditPageOnce(page, target);
        if (!hasViteErrorOverlay(result)) return result;

        lastResult = result;
        if (attempt < 3) {
            await sleep(2_500);
        }
    }

    return {
        ...lastResult!,
        errors: [
            ...lastResult!.errors,
            'Vite error overlay persisted after 3 accessibility retries.',
        ],
    };
}

async function auditPageOnce(page: Page, target: PageTarget): Promise<PageResult> {
    const url = `${baseUrl}${target.path}`;
    const errors: string[] = [];

    try {
        const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
        await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => undefined);
        const finalUrl = page.url();
        const status = response?.status() ?? 0;

        if (status >= 400) {
            errors.push(`HTTP status ${status}.`);
        }
        const reachedExpectedPath = !target.expectedPathIncludes
            || new URL(finalUrl).pathname.includes(target.expectedPathIncludes);
        if (!reachedExpectedPath) {
            errors.push(`Expected final path to include ${target.expectedPathIncludes}, got ${new URL(finalUrl).pathname}.`);
        }

        const accessibility = await new AxeBuilder({ page })
            .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
            .analyze();

        const violations = accessibility.violations.map((violation) => ({
            id: violation.id,
            impact: violation.impact,
            help: violation.help,
            nodes: violation.nodes.slice(0, 5).map((node) => node.target.join(' ')),
        }));

        return {
            name: target.name,
            url,
            finalUrl,
            status: errors.length === 0 && violations.length === 0 ? 'ok' : 'failed',
            coverage: status < 400 && reachedExpectedPath ? 'route-audited' : 'not-audited',
            scope: status < 400 && reachedExpectedPath
                ? 'Axe completed against the expected route surface.'
                : 'The expected route surface was not reached, so its content was not audited.',
            violations,
            errors,
        };
    } catch (error) {
        return {
            name: target.name,
            url,
            finalUrl: page.url(),
            status: 'failed',
            coverage: 'not-audited',
            scope: 'The automated accessibility scan did not complete for this route.',
            violations: [],
            errors: [error instanceof Error ? error.message : String(error)],
        };
    }
}

function hasViteErrorOverlay(result: PageResult): boolean {
    return result.violations.some((violation) =>
        violation.nodes.some((node) => node.includes('vite-error-overlay'))
    );
}

async function auditAuthenticatedCampus(browser: Browser, results: PageResult[]): Promise<void> {
    for (const role of ['student', 'teacher', 'admin'] as AccessibilityAuthRole[]) {
        const roleTargets = authenticatedTargets.filter((target) => target.role === role);
        const credentials = getCredentials(role);

        if (!credentials) {
            for (const target of roleTargets) {
                results.push({
                    name: target.name,
                    url: `${baseUrl}${target.path}`,
                    finalUrl: '',
                    status: 'failed',
                    coverage: 'not-audited',
                    scope: 'No authenticated route content was audited because the role credentials were unavailable.',
                    violations: [],
                    errors: [`Missing ${role} test credentials in .env.test or environment.`],
                });
            }
            continue;
        }

        let lastError: unknown = null;
        let audited = false;

        for (let attempt = 1; attempt <= 2; attempt += 1) {
            const context = await browser.newContext();
            const page = await context.newPage();

            try {
                const landing = await loginAs(page, role, credentials);
                if (landing === 'adult-gate') {
                    const protectedRoutes = roleTargets.map((target) => target.path);
                    const gateResult = await auditPage(page, {
                        name: 'student 18+ confirmation gate (student route content not audited)',
                        path: ADULT_CONFIRMATION_PATH,
                        expectedPathIncludes: ADULT_CONFIRMATION_PATH,
                    });
                    results.push({
                        ...gateResult,
                        coverage: gateResult.coverage === 'route-audited'
                            ? 'adult-gate-audited'
                            : 'not-audited',
                        scope: gateResult.coverage === 'route-audited'
                            ? describeStudentAdultGate(protectedRoutes)
                            : 'The student reached the 18+ gate, but its accessibility scan did not complete; protected student route content was not audited.',
                        protectedRoutes,
                    });
                    audited = true;
                    break;
                }
                for (const target of roleTargets) {
                    results.push(await auditPage(page, target));
                }
                audited = true;
                break;
            } catch (error) {
                lastError = error;
                if (attempt < 2) {
                    await sleep(1_000);
                }
            } finally {
                await context.close().catch(() => undefined);
            }
        }

        if (!audited) {
            for (const target of roleTargets) {
                results.push({
                    name: target.name,
                    url: `${baseUrl}${target.path}`,
                    finalUrl: '',
                    status: 'failed',
                    coverage: 'not-audited',
                    scope: 'No authenticated route content was audited because authentication or role routing failed.',
                    violations: [],
                    errors: [`Could not authenticate ${role} test user or load role dashboard after 2 attempts: ${safeError(lastError)}`],
                });
            }
        }
    }
}

async function loginAs(
    page: Page,
    role: AccessibilityAuthRole,
    credentials: { email: string; password: string },
): Promise<'role-surface' | 'adult-gate'> {
    await page.goto(`${baseUrl}/es/login`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => undefined);

    const emailInput = page.locator('input[type="email"]').first();
    const passwordInput = page.locator('input[type="password"]').first();
    const submitButton = page.locator('form button[type="submit"]').first();

    await emailInput.waitFor({ state: 'visible', timeout: 15_000 });
    await passwordInput.waitFor({ state: 'visible', timeout: 15_000 });
    await submitButton.waitFor({ state: 'visible', timeout: 15_000 });
    await page.waitForFunction(() => {
        const button = document.querySelector('form button[type="submit"]') as HTMLButtonElement | null;
        return Boolean(button && !button.disabled);
    }, undefined, { timeout: 15_000 });

    await emailInput.fill(credentials.email);
    await passwordInput.fill(credentials.password);

    await Promise.all([
        page.waitForURL((url) => {
            const landing = classifyAuthLanding(role, url.pathname);
            return landing.kind !== 'unexpected'
                || url.pathname === ADULT_CONFIRMATION_PATH
                || (url.pathname === '/es/login' && url.searchParams.has('error'));
        }, { timeout: 30_000 }),
        submitButton.click(),
    ]);
    await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => undefined);

    const landing = classifyAuthLanding(role, new URL(page.url()).pathname);
    if (landing.kind === 'unexpected') {
        const visibleError = await page.locator('.bg-red-100, [role="alert"]').first().textContent({ timeout: 1_000 }).catch(() => '');
        throw new Error(`Expected ${role} login to reach ${landing.expectedPath}, got ${new URL(page.url()).pathname}.${visibleError ? ` Visible error: ${visibleError}` : ''}`);
    }

    return landing.kind;
}

function getCredentials(role: AccessibilityAuthRole): { email: string; password: string } | null {
    const prefix = role.toUpperCase();
    const email = process.env[`TEST_${prefix}_EMAIL`];
    const password = process.env[`TEST_${prefix}_PASSWORD`];
    if (!email || !password) return null;
    return { email, password };
}

function safeError(error: unknown): string {
    const message = error instanceof Error ? error.message : String(error);
    return message
        .replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, '[redacted-email]')
        .replace(/password=[^&\s]+/gi, 'password=[redacted]');
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

function renderMarkdown(summary: {
    status: string;
    startedAt: string;
    endedAt: string;
    baseUrl: string;
    browserLabel: string;
    accessibilityManualWorksheetPath: string;
    outputDir: string;
    results: PageResult[];
}): string {
    const lines = [
        '# Launch Accessibility Smoke',
        '',
        `- Status: ${summary.status}`,
        `- Started: ${summary.startedAt}`,
        `- Ended: ${summary.endedAt}`,
        `- Base URL: ${summary.baseUrl}`,
        `- Browser: ${summary.browserLabel}`,
        `- Output: ${summary.outputDir}`,
        `- Manual worksheet: ${summary.accessibilityManualWorksheetPath}`,
        '',
        '| Status | Coverage | Page | Final URL | Scope / issues |',
        '| --- | --- | --- | --- | --- |',
    ];

    for (const result of summary.results) {
        const issues = [
            ...result.errors,
            ...result.violations.map((violation) => `${violation.id} (${violation.impact || 'unknown'}): ${violation.help}`),
        ];
        lines.push(`| ${result.status} | ${result.coverage} | ${escapeCell(result.name)} | ${escapeCell(result.finalUrl)} | ${escapeCell([result.scope, ...issues].join(' / '))} |`);
        for (const violation of result.violations) {
            if (violation.nodes.length > 0) {
                lines.push(`|  |  |  |  | ${escapeCell(`${violation.id} nodes: ${violation.nodes.join(', ')}`)} |`);
            }
        }
    }

    lines.push('');
    lines.push('## Scope');
    lines.push('');
    lines.push('This is a launch smoke check for obvious WCAG 2 A/AA regressions on public pages, login, legal pages, unauthenticated campus redirect, and authenticated campus access. Teacher and admin routes are always audited directly. Student routes are audited directly when the test account has a persisted adult attestation; otherwise the authenticated 18+ gate is audited and the report explicitly marks student route content as not audited. It does not replace a manual accessibility review.');
    const adultGate = summary.results.find((result) => result.coverage === 'adult-gate-audited');
    if (adultGate) {
        lines.push('');
        lines.push(`Student gate evidence: ${adultGate.scope}`);
    }
    lines.push('');

    return `${lines.join('\n')}\n`;
}

function renderAccessibilityManualWorksheet(summary: {
    status: string;
    startedAt: string;
    endedAt: string;
    baseUrl: string;
    outputDir: string;
    results: PageResult[];
}): string {
    const lines = [
        '# Accessibility Manual Worksheet',
        '',
        `- Automated smoke status: ${summary.status}`,
        `- Generated: ${summary.endedAt}`,
        `- Base URL: ${summary.baseUrl}`,
        `- Output: ${summary.outputDir}`,
        '',
        'This worksheet is generated by `pnpm launch:accessibility`. It is not a source-of-truth status document. Use it to perform the manual accessibility pass, then update `docs/launch/MANUAL_EVIDENCE.local.json` under `accessibility_manual`.',
        '',
        '## Rules',
        '',
        '- Do not paste private user data, credentials, tokens, payment data or screenshots with sensitive content.',
        '- Use the automated smoke summary as supporting evidence only; it does not replace manual keyboard, focus, screen reader, zoom and real mobile checks.',
        '- Record reviewer, date, environment, browser/device, routes covered, failures fixed and accepted risks.',
        '',
        '## Automated Scope',
        '',
        '| Result | Coverage | Page | Final URL | Scope |',
        '| --- | --- | --- | --- | --- |',
    ];

    for (const result of summary.results) {
        lines.push(`| ${result.status} | ${result.coverage} | ${escapeCell(result.name)} | ${escapeCell(result.finalUrl || result.url)} | ${escapeCell(result.scope)} |`);
    }

    lines.push('');
    lines.push('## Manual Checks');
    lines.push('');
    lines.push('| Check | Minimum coverage | Evidence to record |');
    lines.push('| --- | --- | --- |');
    for (const check of [
        {
            name: 'Keyboard only',
            coverage: 'Tab, Shift+Tab, Enter, Space and Escape on public nav, login, lead capture, pricing CTA, campus nav and critical forms.',
            evidence: 'Manual note with routes and any traps, skipped controls or unreachable actions.',
        },
        {
            name: 'Visible focus',
            coverage: 'Focus indicator is visible at 100% and 200% zoom on nav links, buttons, fields, modals, campus actions and admin controls.',
            evidence: 'Redacted screenshot or manual note for representative public/campus/admin surfaces.',
        },
        {
            name: 'Screen reader',
            coverage: 'Login/register, checkout entry, lead capture, dashboard, classes, support and error messages read with useful labels.',
            evidence: 'Manual note with screen reader/browser pair and issues found or fixed.',
        },
        {
            name: 'Zoom 200%',
            coverage: 'Home, pricing, login, legal, campus dashboard and classes remain readable without horizontal clipping or hidden controls.',
            evidence: 'Screenshot or manual note with viewport and browser.',
        },
        {
            name: 'Mobile real device',
            coverage: 'Public nav, forms, pricing, login, dashboard, classes and support on a real phone or equivalent device session.',
            evidence: 'Device/browser note and redacted screenshots if useful.',
        },
        {
            name: 'Forms and errors',
            coverage: 'Auth, lead capture, booking/session actions and admin forms expose labels, validation, loading and error states.',
            evidence: 'Manual note with forms tested and any unresolved risk.',
        },
    ]) {
        lines.push(`| ${check.name} | ${check.coverage} | ${check.evidence} |`);
    }

    lines.push('');
    lines.push('## Evidence To Record');
    lines.push('');
    lines.push('- `manual_note`: reviewer, date, environment, device/browser/screen reader and route coverage.');
    lines.push('- `screenshot`: redacted focus, zoom or mobile screenshots.');
    lines.push('- `command_output`: `../../outputs/launch-accessibility/<timestamp>/summary.md` as supporting evidence.');
    lines.push('- For unresolved issues, use `accepted_risk` only with `riskAcceptedBy`, `riskRationale` and `rollbackPlan`.');
    lines.push('');

    return `${lines.join('\n')}\n`;
}

function stamp(date: Date): string {
    return date.toISOString().replace(/[:.]/g, '-');
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function escapeCell(value: string): string {
    return value.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}
