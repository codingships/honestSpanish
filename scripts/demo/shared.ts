import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const DEFAULT_STAGING_BASE_URL = 'https://staging.espanolhonesto.com';
export const DEFAULT_LOCAL_BASE_URL = 'http://localhost:4321';

export type DemoMode = 'safe' | 'interactive' | 'full' | 'local';
export type DemoViewport = 'desktop';

export type SectionId =
    | 'public'
    | 'student'
    | 'teacher'
    | 'admin'
    | 'payments'
    | 'emails'
    | 'google'
    | 'recovery';

export type StepStatus = 'ok' | 'warning' | 'failed' | 'skipped';

export type SensitiveGate = 'stripe' | 'email' | 'google' | 'jobs' | 'class';

export interface DemoConfig {
    mode: DemoMode;
    baseUrl: string;
    startPath: string;
    viewport: DemoViewport;
    slowMoMs: number;
    stepTimeoutMs: number;
    smoke: boolean;
    maxSteps: number | null;
    respectCurrentState: boolean;
}

export interface DemoUsers {
    student: DemoUser;
    teacher: DemoUser;
    admin: DemoUser;
}

export interface DemoUser {
    email: string;
    password: string;
    name: string;
}

export interface StepOutcome {
    status?: StepStatus;
    message?: string;
    details?: string[];
    links?: string[];
}

export interface StepResult {
    id: string;
    section: SectionId;
    title: string;
    status: StepStatus;
    message: string;
    details: string[];
    url: string;
    screenshot?: string;
    startedAt: string;
    endedAt: string;
    durationMs: number;
}

export interface DemoNote {
    stepId: string;
    section: SectionId;
    title: string;
    note: string;
    url: string;
    screenshot?: string;
    createdAt: string;
}

export interface DemoError {
    stepId?: string;
    section?: SectionId;
    title?: string;
    message: string;
    url?: string;
    createdAt: string;
}

export interface DemoActivityEvent {
    at: string;
    type: string;
    level: 'info' | 'warning' | 'error';
    message: string;
    stepId?: string;
    section?: SectionId;
    url?: string;
    details?: string[];
}

export interface DemoRunSummary {
    schemaVersion: 1;
    startedAt: string;
    endedAt: string;
    mode: DemoMode;
    baseUrl: string;
    outputDir: string;
    results: StepResult[];
    notes: DemoNote[];
    skippedSections: SectionId[];
    errors: DemoError[];
    activity: DemoActivityEvent[];
    sectionStatus: Record<SectionId, StepStatus>;
}

export const SECTION_LABELS: Record<SectionId, string> = {
    public: 'Web publica',
    student: 'Alumno',
    teacher: 'Profesor',
    admin: 'Admin',
    payments: 'Pagos',
    emails: 'Emails',
    google: 'Google / Drive / Meet',
    recovery: 'Recuperacion operativa',
};

export const SECTION_ORDER: SectionId[] = [
    'public',
    'student',
    'teacher',
    'admin',
    'payments',
    'emails',
    'google',
    'recovery',
];

export const GATE_ENV: Record<SensitiveGate, string> = {
    stripe: 'DEMO_ALLOW_STRIPE_CHECKOUT',
    email: 'DEMO_ALLOW_EMAIL_SEND',
    google: 'DEMO_ALLOW_GOOGLE_JOBS',
    jobs: 'DEMO_ALLOW_GOOGLE_JOBS',
    class: 'DEMO_ALLOW_GOOGLE_JOBS',
};

export function parseArgs(argv: string[]): Record<string, string | boolean> {
    const parsed: Record<string, string | boolean> = {};

    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index];
        if (!arg.startsWith('--')) continue;

        const trimmed = arg.slice(2);
        const equalsIndex = trimmed.indexOf('=');
        if (equalsIndex >= 0) {
            parsed[trimmed.slice(0, equalsIndex)] = trimmed.slice(equalsIndex + 1);
            continue;
        }

        const next = argv[index + 1];
        if (next && !next.startsWith('--')) {
            parsed[trimmed] = next;
            index += 1;
        } else {
            parsed[trimmed] = true;
        }
    }

    return parsed;
}

export function readDemoConfig(argv: string[]): DemoConfig {
    const args = parseArgs(argv);
    const mode = normalizeMode(stringArg(args.mode) || process.env.DEMO_MODE || 'safe');
    const defaultBaseUrl = mode === 'local' ? DEFAULT_LOCAL_BASE_URL : DEFAULT_STAGING_BASE_URL;
    const baseUrl = normalizeBaseUrl(stringArg(args['base-url']) || process.env.DEMO_BASE_URL || defaultBaseUrl);
    const startPath = stringArg(args['start-path']) || process.env.DEMO_START_PATH || '/es';
    const viewport = normalizeViewport(stringArg(args.viewport) || process.env.DEMO_VIEWPORT || 'desktop');
    const slowMoMs = readInteger(stringArg(args.slowmo) || process.env.DEMO_SLOWMO_MS, 75);
    const stepTimeoutMs = readInteger(stringArg(args.timeout) || process.env.DEMO_STEP_TIMEOUT_MS, 18_000);
    const smoke = Boolean(args.smoke) || process.env.DEMO_SMOKE === 'true';
    const maxSteps = readOptionalInteger(stringArg(args['max-steps']) || process.env.DEMO_MAX_STEPS);
    const respectCurrentState = !Boolean(args['reset-on-step']) && process.env.DEMO_RESET_ON_STEP !== 'true';

    return {
        mode,
        baseUrl,
        startPath,
        viewport,
        slowMoMs,
        stepTimeoutMs,
        smoke,
        maxSteps,
        respectCurrentState,
    };
}

export function readDemoUsers(): DemoUsers {
    return {
        student: {
            email: process.env.TEST_STUDENT_EMAIL || '',
            password: process.env.TEST_STUDENT_PASSWORD || '',
            name: 'Test Student',
        },
        teacher: {
            email: process.env.TEST_TEACHER_EMAIL || '',
            password: process.env.TEST_TEACHER_PASSWORD || '',
            name: 'Test Teacher',
        },
        admin: {
            email: process.env.TEST_ADMIN_EMAIL || '',
            password: process.env.TEST_ADMIN_PASSWORD || '',
            name: 'Test Admin',
        },
    };
}

export function timestampForPath(date = new Date()): string {
    return date.toISOString().replace(/[:.]/g, '-');
}

export async function createRunDirectory(startedAt = new Date()): Promise<string> {
    const outputDir = path.join(process.cwd(), 'outputs', 'demo-runs', timestampForPath(startedAt));
    await mkdir(outputDir, { recursive: true });
    await mkdir(path.join(outputDir, 'screenshots'), { recursive: true });
    return outputDir;
}

export function relativeToRun(outputDir: string, filePath: string): string {
    return path.relative(outputDir, filePath).replace(/\\/g, '/');
}

export function slug(value: string): string {
    return value
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 80) || 'item';
}

export function computeSectionStatus(results: StepResult[]): Record<SectionId, StepStatus> {
    const sectionStatus = Object.fromEntries(
        SECTION_ORDER.map((section) => [section, 'skipped']),
    ) as Record<SectionId, StepStatus>;

    for (const section of SECTION_ORDER) {
        const sectionResults = results.filter((result) => result.section === section);
        if (sectionResults.length === 0 || sectionResults.every((result) => result.status === 'skipped')) {
            sectionStatus[section] = 'skipped';
        } else if (sectionResults.some((result) => result.status === 'failed')) {
            sectionStatus[section] = 'failed';
        } else if (sectionResults.some((result) => result.status === 'warning' || result.status === 'skipped')) {
            sectionStatus[section] = 'warning';
        } else {
            sectionStatus[section] = 'ok';
        }
    }

    return sectionStatus;
}

export async function writeRunArtifacts(summary: DemoRunSummary): Promise<void> {
    await writeFile(path.join(summary.outputDir, 'run.json'), JSON.stringify(summary, null, 2), 'utf8');
    await writeFile(path.join(summary.outputDir, 'activity.json'), JSON.stringify(summary.activity ?? [], null, 2), 'utf8');
    await writeFile(path.join(summary.outputDir, 'activity.md'), renderActivityMarkdown(summary.activity ?? []), 'utf8');
    await writeFile(path.join(summary.outputDir, 'report.md'), renderMarkdownReport(summary), 'utf8');
    await writeFile(path.join(summary.outputDir, 'report.html'), renderHtmlReport(summary), 'utf8');
}

export async function findLatestRunDirectory(): Promise<string | null> {
    const root = path.join(process.cwd(), 'outputs', 'demo-runs');
    if (!existsSync(root)) return null;

    const entries = await readdir(root, { withFileTypes: true });
    const directories = entries
        .filter((entry) => entry.isDirectory())
        .map((entry) => path.join(root, entry.name))
        .sort((a, b) => b.localeCompare(a));

    return directories[0] ?? null;
}

export async function readRunSummary(outputDir: string): Promise<DemoRunSummary | null> {
    const jsonPath = path.join(outputDir, 'run.json');
    if (!existsSync(jsonPath)) return null;

    return JSON.parse(await readFile(jsonPath, 'utf8')) as DemoRunSummary;
}

export function renderMarkdownReport(summary: DemoRunSummary): string {
    const lines: string[] = [];
    lines.push('# Demo interactiva');
    lines.push('');
    lines.push(`- Inicio: ${summary.startedAt}`);
    lines.push(`- Fin: ${summary.endedAt}`);
    lines.push(`- Modo: ${summary.mode}`);
    lines.push(`- Base URL: ${summary.baseUrl}`);
    lines.push('');
    lines.push('## Estado por seccion');
    lines.push('');
    lines.push('| Seccion | Estado |');
    lines.push('| --- | --- |');
    for (const section of SECTION_ORDER) {
        lines.push(`| ${SECTION_LABELS[section]} | ${summary.sectionStatus[section]} |`);
    }
    lines.push('');
    lines.push('## Pasos');
    lines.push('');
    lines.push('| Estado | Seccion | Paso | Mensaje | Captura |');
    lines.push('| --- | --- | --- | --- | --- |');
    for (const result of summary.results) {
        const screenshot = result.screenshot ? `[captura](${result.screenshot})` : '';
        lines.push(`| ${result.status} | ${SECTION_LABELS[result.section]} | ${escapeMarkdown(result.title)} | ${escapeMarkdown(result.message)} | ${screenshot} |`);
        if (result.details.length > 0) {
            lines.push(`|  |  |  | ${escapeMarkdown(result.details.join(' / '))} |  |`);
        }
    }

    if (summary.notes.length > 0) {
        lines.push('');
        lines.push('## Incidencias marcadas');
        lines.push('');
        for (const note of summary.notes) {
            const screenshot = note.screenshot ? ` ([captura](${note.screenshot}))` : '';
            lines.push(`- ${note.createdAt} - ${SECTION_LABELS[note.section]} / ${note.title}: ${note.note}${screenshot}`);
        }
    }

    if (summary.skippedSections.length > 0) {
        lines.push('');
        lines.push('## Secciones saltadas');
        lines.push('');
        for (const section of summary.skippedSections) {
            lines.push(`- ${SECTION_LABELS[section]}`);
        }
    }

    if (summary.errors.length > 0) {
        lines.push('');
        lines.push('## Errores Playwright');
        lines.push('');
        for (const error of summary.errors) {
            const prefix = error.title ? `${error.title}: ` : '';
            lines.push(`- ${error.createdAt} - ${prefix}${error.message}`);
        }
    }

    const activity = summary.activity ?? [];
    if (activity.length > 0) {
        lines.push('');
        lines.push('## Actividad');
        lines.push('');
        lines.push('| Hora | Nivel | Tipo | Paso | Mensaje |');
        lines.push('| --- | --- | --- | --- | --- |');
        for (const event of activity.slice(-250)) {
            lines.push(`| ${event.at} | ${event.level} | ${escapeMarkdown(event.type)} | ${escapeMarkdown(event.stepId || '')} | ${escapeMarkdown(event.message)} |`);
        }
    }

    return `${lines.join('\n')}\n`;
}

export function renderHtmlReport(summary: DemoRunSummary): string {
    const stepRows = summary.results.map((result) => `
        <tr>
            <td><span class="status ${result.status}">${result.status}</span></td>
            <td>${escapeHtml(SECTION_LABELS[result.section])}</td>
            <td>${escapeHtml(result.title)}</td>
            <td>${escapeHtml(result.message)}${result.details.length ? `<div class="details">${escapeHtml(result.details.join(' / '))}</div>` : ''}</td>
            <td>${result.screenshot ? `<a href="${escapeHtml(result.screenshot)}">captura</a>` : ''}</td>
        </tr>
    `).join('');

    const sectionRows = SECTION_ORDER.map((section) => `
        <tr>
            <td>${escapeHtml(SECTION_LABELS[section])}</td>
            <td><span class="status ${summary.sectionStatus[section]}">${summary.sectionStatus[section]}</span></td>
        </tr>
    `).join('');

    const notes = summary.notes.length > 0
        ? summary.notes.map((note) => `<li><strong>${escapeHtml(SECTION_LABELS[note.section])} / ${escapeHtml(note.title)}</strong>: ${escapeHtml(note.note)}${note.screenshot ? ` <a href="${escapeHtml(note.screenshot)}">captura</a>` : ''}</li>`).join('')
        : '<li>Sin incidencias marcadas.</li>';

    const errors = summary.errors.length > 0
        ? summary.errors.map((error) => `<li>${escapeHtml(error.title ? `${error.title}: ${error.message}` : error.message)}</li>`).join('')
        : '<li>Sin errores registrados.</li>';
    const activityRows = (summary.activity ?? []).slice(-250).map((event) => `
        <tr>
            <td>${escapeHtml(event.at)}</td>
            <td><span class="status ${event.level === 'error' ? 'failed' : event.level === 'warning' ? 'warning' : 'ok'}">${escapeHtml(event.level)}</span></td>
            <td>${escapeHtml(event.type)}</td>
            <td>${escapeHtml(event.stepId || '')}</td>
            <td>${escapeHtml(event.message)}${event.details?.length ? `<div class="details">${escapeHtml(event.details.join(' / '))}</div>` : ''}</td>
        </tr>
    `).join('');

    return `<!doctype html>
<html lang="es">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Demo interactiva - ${escapeHtml(summary.startedAt)}</title>
    <style>
        body { margin: 0; font-family: Arial, sans-serif; color: #123; background: #f7faf9; }
        main { max-width: 1120px; margin: 0 auto; padding: 32px 20px 64px; }
        h1, h2 { color: #006064; }
        .meta { display: grid; gap: 6px; margin-bottom: 24px; font-size: 14px; }
        table { width: 100%; border-collapse: collapse; background: #fff; margin: 12px 0 28px; }
        th, td { border: 1px solid #c8d8d6; padding: 10px; text-align: left; vertical-align: top; }
        th { background: #006064; color: #fff; }
        .status { display: inline-block; min-width: 68px; padding: 3px 8px; border-radius: 999px; font-size: 12px; font-weight: 700; text-align: center; text-transform: uppercase; }
        .ok { background: #d8f3dc; color: #116530; }
        .warning { background: #fff3bf; color: #7a4f00; }
        .failed { background: #ffd6d6; color: #9b1c1c; }
        .skipped { background: #e9ecef; color: #495057; }
        .details { margin-top: 6px; color: #51615f; font-size: 13px; }
        a { color: #006064; font-weight: 700; }
    </style>
</head>
<body>
    <main>
        <h1>Demo interactiva</h1>
        <div class="meta">
            <div><strong>Inicio:</strong> ${escapeHtml(summary.startedAt)}</div>
            <div><strong>Fin:</strong> ${escapeHtml(summary.endedAt)}</div>
            <div><strong>Modo:</strong> ${escapeHtml(summary.mode)}</div>
            <div><strong>Base URL:</strong> ${escapeHtml(summary.baseUrl)}</div>
        </div>

        <h2>Estado por seccion</h2>
        <table>
            <thead><tr><th>Seccion</th><th>Estado</th></tr></thead>
            <tbody>${sectionRows}</tbody>
        </table>

        <h2>Pasos</h2>
        <table>
            <thead><tr><th>Estado</th><th>Seccion</th><th>Paso</th><th>Mensaje</th><th>Captura</th></tr></thead>
            <tbody>${stepRows}</tbody>
        </table>

        <h2>Incidencias marcadas</h2>
        <ul>${notes}</ul>

        <h2>Errores Playwright</h2>
        <ul>${errors}</ul>

        <h2>Actividad</h2>
        <table>
            <thead><tr><th>Hora</th><th>Nivel</th><th>Tipo</th><th>Paso</th><th>Mensaje</th></tr></thead>
            <tbody>${activityRows || '<tr><td colspan="5">Sin actividad registrada.</td></tr>'}</tbody>
        </table>
    </main>
</body>
</html>`;
}

export function renderActivityMarkdown(activity: DemoActivityEvent[]): string {
    const lines = ['# Actividad de demo', '', '| Hora | Nivel | Tipo | Paso | URL | Mensaje |', '| --- | --- | --- | --- | --- | --- |'];
    for (const event of activity) {
        lines.push(`| ${event.at} | ${event.level} | ${escapeMarkdown(event.type)} | ${escapeMarkdown(event.stepId || '')} | ${escapeMarkdown(event.url || '')} | ${escapeMarkdown(event.message)} |`);
    }
    return `${lines.join('\n')}\n`;
}

function normalizeMode(value: string): DemoMode {
    if (['safe', 'interactive', 'full', 'local'].includes(value)) {
        return value as DemoMode;
    }

    throw new Error(`DEMO_MODE invalido: ${value}. Usa safe, interactive, full o local.`);
}

function normalizeViewport(value: string): DemoViewport {
    if (value === 'desktop') {
        return value as DemoViewport;
    }

    throw new Error(`DEMO_VIEWPORT invalido: ${value}. Usa desktop.`);
}

function normalizeBaseUrl(value: string): string {
    return value.replace(/\/+$/, '');
}

function readInteger(value: string | undefined, fallback: number): number {
    if (!value) return fallback;
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function readOptionalInteger(value: string | undefined): number | null {
    if (!value) return null;
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function stringArg(value: string | boolean | undefined): string | undefined {
    return typeof value === 'string' ? value : undefined;
}

function escapeMarkdown(value: string): string {
    return value.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

function escapeHtml(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}
