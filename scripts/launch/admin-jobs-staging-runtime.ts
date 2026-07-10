import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parse } from 'dotenv';
import { chromium } from 'playwright';

type ReportStatus = 'OK' | 'WARNING' | 'FAILED';

interface RuntimeReport {
    schemaVersion: 1;
    startedAt: string;
    endedAt: string;
    status: ReportStatus;
    outputDir: string;
    baseUrl: string;
    envFile: string;
    loginReachedAdmin: boolean;
    jobsPageReached: boolean;
    apiStatus: number | null;
    recoveryControlsVisible: boolean;
    tableOrEmptyStateVisible: boolean;
    aggregateVisibleRowCount: number;
    finalPath: string;
    visibleAuthError: string;
    loginFormFilled: boolean;
    mutationsPerformed: 'none';
    notes: string[];
    redaction: string[];
}

const startedAt = new Date();
const args = process.argv.slice(2);
const DEFAULT_WORKER_STAGING_URL = 'https://espanolhonesto-staging.alindev95.workers.dev';
const baseUrl = readArg('--base-url')
    ?? process.env.CLOUDFLARE_WORKERS_STAGING_URL
    ?? process.env.CLOUDFLARE_STAGING_URL
    ?? DEFAULT_WORKER_STAGING_URL;
const envFile = readArg('--env-file') ?? '.env.test';
const headed = args.includes('--headed');
const outputDir = path.join(process.cwd(), 'outputs', 'admin-jobs-staging-runtime', stamp(startedAt));
mkdirSync(outputDir, { recursive: true });

const report: RuntimeReport = {
    schemaVersion: 1,
    startedAt: startedAt.toISOString(),
    endedAt: '',
    status: 'FAILED',
    outputDir,
    baseUrl,
    envFile,
    loginReachedAdmin: false,
    jobsPageReached: false,
    apiStatus: null,
    recoveryControlsVisible: false,
    tableOrEmptyStateVisible: false,
    aggregateVisibleRowCount: 0,
    finalPath: '',
    visibleAuthError: '',
    loginFormFilled: false,
    mutationsPerformed: 'none',
    notes: [],
    redaction: [
        'No admin password, Supabase key, cookie, row data, student names, email addresses, job errors or screenshots are written.',
        'The script records only route reachability, aggregate row count, API status and whether recovery controls are visible.',
        'The script does not click process, retry or cancel buttons.',
    ],
};

await main();

async function main(): Promise<void> {
    const env = readEnvFile(envFile);
    const email = process.env.TEST_ADMIN_EMAIL ?? env.TEST_ADMIN_EMAIL;
    const password = process.env.TEST_ADMIN_PASSWORD ?? env.TEST_ADMIN_PASSWORD;

    if (!email || !password) {
        report.notes.push('Missing TEST_ADMIN_EMAIL or TEST_ADMIN_PASSWORD in the selected source.');
        finish('FAILED');
        return;
    }

    const browser = await chromium.launch({ headless: !headed, slowMo: headed ? 40 : 0 });
    const page = await browser.newPage();
    const apiStatuses: number[] = [];
    page.on('response', (response) => {
        if (response.url().includes('/api/admin/fulfillment-jobs')) {
            apiStatuses.push(response.status());
        }
    });

    try {
        await page.goto(`${baseUrl}/es/login`, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => undefined);
        await page.waitForTimeout(500);

        const emailInput = page.locator('input[name="email"]');
        const passwordInput = page.locator('input[name="password"]');
        await emailInput.fill(email);
        await passwordInput.fill(password);
        report.loginFormFilled = Boolean(await emailInput.inputValue()) && Boolean(await passwordInput.inputValue());

        await Promise.all([
            page.waitForURL(/\/campus\/admin|\/campus/, { timeout: 30000 }).catch(() => undefined),
            page.click('button[type="submit"]'),
        ]);
        await page.waitForLoadState('domcontentloaded', { timeout: 30000 }).catch(() => undefined);
        report.finalPath = new URL(page.url()).pathname;

        report.loginReachedAdmin = page.url().includes('/campus/admin');
        if (!report.loginReachedAdmin) {
            report.visibleAuthError = await readVisibleAuthError(page);
            report.notes.push(`Admin login did not reach the admin area; final path was ${report.finalPath || 'unknown'}.`);
            if (report.visibleAuthError) {
                report.notes.push(`Visible auth error: ${report.visibleAuthError}`);
            }
            report.notes.push('No private admin content was inspected.');
            finish('FAILED');
            return;
        }

        await page.goto(`${baseUrl}/es/campus/admin/jobs`, { waitUntil: 'domcontentloaded', timeout: 30000 });
        report.jobsPageReached = page.url().includes('/campus/admin/jobs');
        await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => undefined);
        report.apiStatus = apiStatuses.at(-1) ?? null;

        const processButton = page.getByRole('button', { name: /Procesar pendientes/i });
        const retryButtons = page.getByRole('button', { name: /Reintentar/i });
        const cancelButtons = page.getByRole('button', { name: /Cancelar/i });
        const table = page.getByLabel(/Tabla de jobs de cumplimiento/i);
        const emptyState = page.getByText(/No hay jobs para este filtro/i);

        report.recoveryControlsVisible = await processButton.isVisible({ timeout: 10000 }).catch(() => false);
        const tableVisible = await table.isVisible({ timeout: 10000 }).catch(() => false);
        const emptyVisible = await emptyState.isVisible({ timeout: 3000 }).catch(() => false);
        report.tableOrEmptyStateVisible = tableVisible || emptyVisible;
        report.aggregateVisibleRowCount = await page.locator('tbody tr').count().catch(() => 0);

        const retryCount = await retryButtons.count().catch(() => 0);
        const cancelCount = await cancelButtons.count().catch(() => 0);
        report.notes.push(`Read-only controls present: process_due=${String(report.recoveryControlsVisible)}, retryButtons=${retryCount}, cancelButtons=${cancelCount}.`);
        report.notes.push('No job action buttons were clicked; no job rows, names, emails, errors or screenshots were stored.');

        finish(report.jobsPageReached
            && report.apiStatus === 200
            && report.recoveryControlsVisible
            && report.tableOrEmptyStateVisible
            ? 'OK'
            : 'WARNING');
    } catch (error) {
        report.notes.push(`Browser check failed before completion: ${error instanceof Error ? error.message : 'unknown error'}`);
        finish('FAILED');
    } finally {
        await browser.close();
    }
}

function finish(status: ReportStatus): void {
    report.status = status;
    report.endedAt = new Date().toISOString();
    writeReport();
    console.log(`[launch:admin-jobs-staging-runtime] Status: ${status}`);
    console.log(`[launch:admin-jobs-staging-runtime] Summary: ${path.join(outputDir, 'summary.md')}`);
    if (status === 'FAILED') process.exitCode = 1;
}

function writeReport(): void {
    writeFileSync(path.join(outputDir, 'summary.json'), JSON.stringify(report, null, 2), 'utf8');
    const lines = [
        '# Admin Jobs Staging Runtime Read-Only Evidence',
        '',
        `- Status: ${report.status}`,
        `- Started: ${report.startedAt}`,
        `- Ended: ${report.endedAt}`,
        `- Base URL: ${report.baseUrl}`,
        `- Env file: ${report.envFile}`,
        `- Output: ${report.outputDir}`,
        '',
        '## Scope',
        '',
        'Read-only browser check of the staging admin jobs page. It does not click retry, cancel or process actions, does not call internal authenticated Worker routes, does not send email and does not store row data or screenshots.',
        '',
        '## Result',
        '',
        `- Login reached admin area: ${String(report.loginReachedAdmin)}`,
        `- Jobs page URL reached: ${String(report.jobsPageReached)}`,
        `- API status observed: ${report.apiStatus ?? 'not_observed'}`,
        `- Recovery controls visible: ${String(report.recoveryControlsVisible)}`,
        `- Table or empty state visible: ${String(report.tableOrEmptyStateVisible)}`,
        `- Aggregate visible row count: ${report.aggregateVisibleRowCount}`,
        `- Final path after login: ${report.finalPath || 'not_observed'}`,
        `- Visible auth error: ${report.visibleAuthError || 'none'}`,
        `- Login form filled: ${String(report.loginFormFilled)}`,
        `- Mutations performed: ${report.mutationsPerformed}`,
        '',
        '## Notes',
        '',
        ...report.notes.map((note) => `- ${note}`),
        '',
        '## Redaction',
        '',
        ...report.redaction.map((note) => `- ${note}`),
        '',
    ];
    writeFileSync(path.join(outputDir, 'summary.md'), lines.join('\n'), 'utf8');
}

function readEnvFile(file: string): Record<string, string> {
    const absolute = path.resolve(process.cwd(), file);
    if (!existsSync(absolute)) return {};
    return parse(readFileSync(absolute, 'utf8'));
}

async function readVisibleAuthError(page: import('playwright').Page): Promise<string> {
    const raw = await page
        .locator('.bg-red-100, [role="alert"], text=/invalid|incorrect|error|confirm|not authorized|unauthorized|credenciales|contraseña|correo/i')
        .first()
        .textContent({ timeout: 2000 })
        .catch(() => '');

    return raw
        .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email]')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 240);
}

function readArg(name: string): string | null {
    const index = args.indexOf(name);
    return index >= 0 ? args[index + 1] ?? null : null;
}

function stamp(date: Date): string {
    return date.toISOString().replace(/[:.]/g, '-');
}
