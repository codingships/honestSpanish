import path from 'node:path';
import { appendFile, writeFile } from 'node:fs/promises';
import dotenv from 'dotenv';
import { chromium, type Browser, type Locator, type Page } from 'playwright';
import {
    clearOverlayAction,
    consumeOverlayAction,
    installOverlay,
    showOverlay,
    waitForOverlayAction,
    type OverlayAction,
} from './overlay';
import { DEMO_STEPS, type DemoRuntimeContext, type DemoStep } from './steps';
import {
    GATE_ENV,
    SECTION_LABELS,
    computeSectionStatus,
    createRunDirectory,
    readDemoConfig,
    readDemoUsers,
    relativeToRun,
    slug,
    writeRunArtifacts,
    type DemoActivityEvent,
    type DemoConfig,
    type DemoError,
    type DemoNote,
    type DemoRunSummary,
    type DemoUsers,
    type SectionId,
    type SensitiveGate,
    type StepOutcome,
    type StepResult,
    type StepStatus,
} from './shared';

dotenv.config({ path: '.env', quiet: true });
dotenv.config({ path: '.env.test', override: true, quiet: true });

class DemoFinishedError extends Error {
    constructor() {
        super('Demo finalizada desde el overlay.');
    }
}

interface RuntimeState {
    browser: Browser;
    page: Page;
    config: DemoConfig;
    users: DemoUsers;
    outputDir: string;
    activityNdjsonPath: string;
    activityLogPath: string;
    startedAt: Date;
    currentStep: DemoStep | null;
    currentIndex: number;
    stepCount: number;
    results: StepResult[];
    notes: DemoNote[];
    skippedSections: Set<SectionId>;
    errors: DemoError[];
    activity: DemoActivityEvent[];
    activityWriteQueue: Promise<void>;
    pendingAutoNext: boolean;
    currentRole: 'student' | 'teacher' | 'admin' | null;
}

const config = readDemoConfig(process.argv.slice(2));
const users = readDemoUsers();
const startedAt = new Date();
const outputDir = await createRunDirectory(startedAt);
const activityNdjsonPath = path.join(outputDir, 'activity.ndjson');
const activityLogPath = path.join(outputDir, 'activity.log');
const steps = config.maxSteps ? DEMO_STEPS.slice(0, config.maxSteps) : DEMO_STEPS;

console.log(`[demo] Modo: ${config.mode}`);
console.log(`[demo] Base URL: ${config.baseUrl}`);
console.log(`[demo] Inicio: ${config.startPath}`);
console.log(`[demo] Ventana: ${config.viewport}`);
console.log(`[demo] Salida: ${outputDir}`);
if (config.smoke) console.log('[demo] Smoke activo: los pasos avanzan automaticamente.');

const browser = await chromium.launch({
    headless: false,
    slowMo: config.slowMoMs,
});

const browserContext = await browser.newContext({
    viewport: { width: 1440, height: 960 },
    deviceScaleFactor: 1,
});
const page = await browserContext.newPage();
page.setDefaultTimeout(config.stepTimeoutMs);
page.setDefaultNavigationTimeout(config.stepTimeoutMs);
await installOverlay(page);

const state: RuntimeState = {
    browser,
    page,
    config,
    users,
    outputDir,
    activityNdjsonPath,
    activityLogPath,
    startedAt,
    currentStep: null,
    currentIndex: 0,
    stepCount: steps.length,
    results: [],
    notes: [],
    skippedSections: new Set<SectionId>(),
    errors: [],
    activity: [],
    activityWriteQueue: Promise.resolve(),
    pendingAutoNext: false,
    currentRole: null,
};
await writeCurrentRunPointer(state, 'running');
setupPageActivityListeners(state);
await prepareStartPage(state);

const ctx = createRuntimeContext(state);

try {
    await runDemo(state, ctx, steps);
} catch (error) {
    if (!(error instanceof DemoFinishedError)) {
        const message = error instanceof Error ? error.message : String(error);
        state.errors.push({
            message,
            url: safePageUrl(state.page),
            createdAt: new Date().toISOString(),
        });
        console.error(`[demo] Error: ${message}`);
    }
} finally {
    const summary = await finalizeRun(state);
    await state.browser.close().catch(() => undefined);
    await writeCurrentRunPointer(state, 'complete').catch(() => undefined);
    console.log(`[demo] Informe Markdown: ${path.join(summary.outputDir, 'report.md')}`);
    console.log(`[demo] Informe HTML: ${path.join(summary.outputDir, 'report.html')}`);
}

async function runDemo(
    state: RuntimeState,
    ctx: DemoRuntimeContext,
    steps: DemoStep[],
): Promise<void> {
    let startImmediately = false;

    for (let index = 0; index < steps.length; index += 1) {
        const step = steps[index];
        state.currentStep = step;
        state.currentIndex = index + 1;

        if (state.skippedSections.has(step.section)) {
            state.results.push(createSkippedResult(state, step, 'Seccion saltada por el presentador.'));
            continue;
        }

        if (!isStepAllowed(step, state.config.mode)) {
            state.results.push(createSkippedResult(state, step, `No aplica en modo ${state.config.mode}.`));
            continue;
        }

        if (!state.config.smoke && !startImmediately) {
            const startAction = await waitForStepStart(state, step);
            if (startAction === 'finish') throw new DemoFinishedError();
            if (startAction === 'skip_section') {
                state.skippedSections.add(step.section);
                state.results.push(createSkippedResult(state, step, 'Seccion saltada por el presentador.'));
                continue;
            }
        }
        startImmediately = false;

        const startedAt = new Date();
        let outcome: StepOutcome | void;
        let status: StepStatus = 'ok';
        let message = 'Paso completado.';
        let details: string[] = [];

        trackActivity(state, 'step_start', 'info', `Ejecutando: ${step.title}`);
        await refreshOverlay(state, 'Ejecutando paso...', false, true);

        try {
            outcome = await runWithTimeout(step.run(ctx), state.config.stepTimeoutMs);
            status = outcome?.status ?? 'ok';
            message = outcome?.message ?? message;
            details = outcome?.details ?? [];
            trackActivity(state, 'step_end', status === 'failed' ? 'error' : status === 'warning' ? 'warning' : 'info', message, details);
            await refreshOverlay(state, message);
        } catch (error) {
            if (error instanceof DemoFinishedError) throw error;
            status = 'failed';
            message = error instanceof Error ? error.message : String(error);
            state.errors.push({
                stepId: step.id,
                section: step.section,
                title: step.title,
                message,
                url: safePageUrl(state.page),
                createdAt: new Date().toISOString(),
            });
            trackActivity(state, 'step_error', 'error', message);
            await refreshOverlay(state, `Error: ${message}`);
        }

        await handleActionQueuedDuringRun(state);

        const screenshot = await takeScreenshot(state, `${step.id}-${status}`);
        const endedAt = new Date();
        state.results.push({
            id: step.id,
            section: step.section,
            title: step.title,
            status,
            message,
            details,
            url: safePageUrl(state.page),
            screenshot,
            startedAt: startedAt.toISOString(),
            endedAt: endedAt.toISOString(),
            durationMs: endedAt.getTime() - startedAt.getTime(),
        });

        if (!state.config.smoke && index < steps.length - 1) {
            if (state.pendingAutoNext) {
                state.pendingAutoNext = false;
                startImmediately = true;
                continue;
            }

            const nextAction = await waitAfterStep(state, message);
            if (nextAction === 'finish') throw new DemoFinishedError();
            if (nextAction === 'skip_section') {
                state.skippedSections.add(step.section);
            }
            startImmediately = nextAction === 'next' || nextAction === 'skip_section';
        }
    }
}

async function waitForStepStart(
    state: RuntimeState,
    step: DemoStep,
): Promise<'next' | 'skip_section' | 'finish'> {
    let paused = false;
    trackActivity(state, 'step_ready', 'info', `Esperando inicio: ${step.title}`);
    await refreshOverlay(state);

    if (state.config.smoke) return 'next';
    if (state.pendingAutoNext && !step.sideEffect) {
        state.pendingAutoNext = false;
        await clearOverlayAction(state.page);
        await state.page.waitForTimeout(200).catch(() => undefined);
        return 'next';
    }

    state.pendingAutoNext = false;
    await clearOverlayAction(state.page);

    for (;;) {
        const action = await waitForOverlayAction(state.page);
        const result = await handleOverlayAction(state, action, paused);

        if (result === 'pause') {
            paused = !paused;
            await refreshOverlay(
                state,
                paused ? 'Demo pausada. Pulsa Pausar otra vez para reanudar.' : undefined,
                paused,
            );
            continue;
        }

        if (result === 'continue') {
            await refreshOverlay(state, paused ? 'Demo pausada.' : undefined, paused);
            continue;
        }

        if (result === 'finish') return 'finish';
        if (result === 'skip_section') return 'skip_section';
        if (result === 'next' && !paused) return 'next';

        await refreshOverlay(state, 'Demo pausada. Reanuda antes de avanzar.', paused);
    }
}

async function waitAfterStep(
    state: RuntimeState,
    statusMessage: string,
): Promise<'next' | 'skip_section' | 'finish'> {
    let paused = false;
    await refreshOverlay(state, statusMessage, paused);

    for (;;) {
        const action = await waitForOverlayAction(state.page);
        const result = await handleOverlayAction(state, action, paused);

        if (result === 'pause') {
            paused = !paused;
            await refreshOverlay(
                state,
                paused ? 'Demo pausada. Pulsa Pausar otra vez para reanudar.' : statusMessage,
                paused,
            );
            continue;
        }

        if (result === 'continue') {
            await refreshOverlay(state, paused ? 'Demo pausada.' : statusMessage, paused);
            continue;
        }

        if (result === 'finish') return 'finish';
        if (result === 'skip_section') return 'skip_section';
        if (result === 'next' && !paused) return 'next';

        await refreshOverlay(state, 'Demo pausada. Reanuda antes de avanzar.', paused);
    }
}

async function handleActionQueuedDuringRun(state: RuntimeState): Promise<void> {
    const action = await consumeOverlayAction(state.page);
    if (!action) return;
    trackActivity(state, 'overlay_action_queued', 'info', `Accion durante carga: ${action.type}`);

    switch (action.type) {
        case 'next':
            state.pendingAutoNext = true;
            return;
        case 'finish':
            throw new DemoFinishedError();
        case 'problem':
            await recordNote(state, action.note || 'Incidencia sin descripcion.');
            return;
        case 'screenshot':
            await takeScreenshot(state, `manual-${state.currentStep?.id ?? 'step'}-${Date.now()}`);
            return;
        case 'skip_section':
            if (state.currentStep) state.skippedSections.add(state.currentStep.section);
            return;
        case 'pause':
        case 'back':
            return;
    }
}

async function handleOverlayAction(
    state: RuntimeState,
    action: OverlayAction,
    _paused: boolean,
): Promise<'next' | 'pause' | 'skip_section' | 'finish' | 'continue'> {
    trackActivity(state, 'overlay_action', 'info', `Accion: ${action.type}`);
    switch (action.type) {
        case 'next':
            return 'next';
        case 'pause':
            return 'pause';
        case 'skip_section':
            return 'skip_section';
        case 'finish':
            return 'finish';
        case 'back':
            await state.page.goBack({ waitUntil: 'domcontentloaded', timeout: 8_000 }).catch(() => undefined);
            await refreshOverlay(state, 'Vuelta atras solicitada.');
            return 'continue';
        case 'problem':
            await recordNote(state, action.note || 'Incidencia sin descripcion.');
            await refreshOverlay(state, 'Incidencia registrada.');
            return 'continue';
        case 'screenshot':
            await takeScreenshot(state, `manual-${state.currentStep?.id ?? 'step'}-${Date.now()}`);
            await refreshOverlay(state, 'Captura guardada.');
            return 'continue';
    }
}

function createRuntimeContext(state: RuntimeState): DemoRuntimeContext {
    return {
        get page() {
            return state.page;
        },
        get mode() {
            return state.config.mode;
        },
        async goto(pathOrUrl: string) {
            const url = buildUrl(state.config.baseUrl, pathOrUrl);
            if (shouldReuseCurrentPage(state, url)) {
                trackActivity(state, 'navigation_reuse', 'info', `Se conserva estado actual: ${safePageUrl(state.page)}`);
                await refreshOverlay(state);
                return;
            }

            trackActivity(state, 'navigation_start', 'info', `Navegando a ${url}`);
            await state.page.goto(url, { waitUntil: 'domcontentloaded', timeout: state.config.stepTimeoutMs });
            await state.page.waitForTimeout(250);
            trackActivity(state, 'navigation_end', 'info', `Pagina cargada: ${safePageUrl(state.page)}`);
            await refreshOverlay(state);
        },
        async refreshOverlay(status?: string) {
            await refreshOverlay(state, status);
        },
        async loginAs(role) {
            const targetPath = {
                student: '/es/campus',
                teacher: '/es/campus/teacher',
                admin: '/es/campus/admin',
            }[role];

            if (state.currentRole === role && !state.page.url().includes('/login')) {
                trackActivity(state, 'auth_skip', 'info', `Sesion ${role} ya activa.`);
                if (!state.page.url().includes(targetPath)) {
                    await this.goto(targetPath);
                }
                return {
                    status: 'ok',
                    message: `Sesion ${role} reutilizada.`,
                };
            }

            const user = state.users[role];
            if (!user.email || !user.password) {
                return {
                    status: 'failed',
                    message: `Faltan credenciales TEST_${role.toUpperCase()}_EMAIL/PASSWORD.`,
                };
            }

            trackActivity(state, 'auth_start', 'info', `Login ${role}`);
            if (state.currentRole || state.page.url().includes('/campus')) {
                await this.logout();
            }
            await this.goto('/es/login');
            await state.page.locator('input[type="email"]').waitFor({ state: 'visible', timeout: 10_000 });
            await state.page.fill('input[type="email"]', user.email);
            await state.page.fill('input[type="password"]', user.password);
            await Promise.all([
                state.page.waitForURL(/\/campus/, { timeout: 18_000 }).catch(() => undefined),
                state.page.click('button[type="submit"]'),
            ]);

            if (!state.page.url().includes(targetPath)) {
                await this.goto(targetPath);
            } else {
                await state.page.waitForLoadState('domcontentloaded').catch(() => undefined);
                await refreshOverlay(state, `${role} autenticado.`);
            }

            if (state.page.url().includes('/login')) {
                trackActivity(state, 'auth_failed', 'error', `Login ${role} no entro al campus.`);
                return {
                    status: 'failed',
                    message: `Login ${role} no entro al campus.`,
                };
            }

            state.currentRole = role;
            trackActivity(state, 'auth_success', 'info', `Login ${role} completado.`);
            return {
                status: 'ok',
                message: `Login ${role} completado.`,
            };
        },
        async logout() {
            trackActivity(state, 'auth_logout', 'info', 'Cerrando sesion actual si existe.');
            await state.page.goto(buildUrl(state.config.baseUrl, '/es/logout'), {
                waitUntil: 'domcontentloaded',
                timeout: 12_000,
            }).catch(() => undefined);
            await state.page.waitForTimeout(250).catch(() => undefined);
            state.currentRole = null;
            await refreshOverlay(state, 'Sesion anterior cerrada si existia.');
        },
        async visible(selectors, okMessage, warningMessage) {
            const found = await firstVisible(state.page, selectors, Math.min(8_000, state.config.stepTimeoutMs));
            if (found) {
                trackActivity(state, 'validation_ok', 'info', okMessage, [`Selector: ${found}`]);
                return { status: 'ok', message: okMessage, details: [`Selector: ${found}`] };
            }

            trackActivity(state, warningMessage ? 'validation_warning' : 'validation_failed', warningMessage ? 'warning' : 'error', warningMessage || `No se encontro contenido esperado: ${selectors.join(', ')}`);
            return {
                status: warningMessage ? 'warning' : 'failed',
                message: warningMessage || `No se encontro contenido esperado: ${selectors.join(', ')}`,
            };
        },
        async optionalVisible(selectors, okMessage, warningMessage) {
            const found = await firstVisible(state.page, selectors, Math.min(6_000, state.config.stepTimeoutMs));
            if (found) {
                trackActivity(state, 'validation_ok', 'info', okMessage, [`Selector: ${found}`]);
                return { status: 'ok', message: okMessage, details: [`Selector: ${found}`] };
            }

            trackActivity(state, 'validation_warning', 'warning', warningMessage);
            return { status: 'warning', message: warningMessage };
        },
        async scrollTo(selector) {
            await state.page.locator(selector).first().scrollIntoViewIfNeeded({ timeout: 5_000 }).catch(() => undefined);
            await state.page.waitForTimeout(250);
            await refreshOverlay(state);
        },
        async clickFirstVisible(selectors) {
            for (const selector of selectors) {
                const locator = state.page.locator(selector).first();
                if (await isVisible(locator, 2_000)) {
                    await locator.scrollIntoViewIfNeeded().catch(() => undefined);
                    await locator.click({ timeout: 5_000 }).catch(() => undefined);
                    await state.page.waitForTimeout(500);
                    trackActivity(state, 'click', 'info', `Click: ${selector}`);
                    await refreshOverlay(state, `Click: ${selector}`);
                    return true;
                }
            }
            return false;
        },
        async confirmSideEffect(gate, title, description) {
            if (state.config.mode === 'safe' || state.config.mode === 'local') {
                trackActivity(state, 'side_effect_skipped', 'info', `Omitido por modo ${state.config.mode}: ${gate}`);
                return false;
            }

            if (state.config.mode === 'full') {
                await refreshOverlay(state, `Modo full: ${title}`);
                return true;
            }

            const envName = GATE_ENV[gate];
            if (process.env[envName] !== 'true') {
                trackActivity(state, 'side_effect_blocked', 'warning', `${envName}=true requerido para ${gate}`);
                await refreshOverlay(state, `${envName}=true requerido para ejecutar esta accion.`);
                return false;
            }

            await refreshOverlay(state, `${title}. ${description}. Pulsa Siguiente para confirmar.`);
            if (state.config.smoke) return true;

            for (;;) {
                const action = await waitForOverlayAction(state.page);
                if (action.type === 'next') return true;
                if (action.type === 'finish') throw new DemoFinishedError();
                if (action.type === 'problem') {
                    await recordNote(state, action.note || 'Incidencia sin descripcion.');
                    await refreshOverlay(state, 'Incidencia registrada. Confirma o finaliza.');
                }
                if (action.type === 'screenshot') {
                    await takeScreenshot(state, `manual-${state.currentStep?.id ?? 'side-effect'}-${Date.now()}`);
                    await refreshOverlay(state, 'Captura guardada. Confirma o finaliza.');
                }
                if (action.type === 'skip_section' || action.type === 'back' || action.type === 'pause') {
                    await refreshOverlay(state, 'Accion sensible omitida.');
                    return false;
                }
            }
        },
        async screenshot(label) {
            return takeScreenshot(state, label);
        },
    };
}

async function prepareStartPage(state: RuntimeState): Promise<void> {
    if (!state.config.startPath) return;

    const startUrl = buildUrl(state.config.baseUrl, state.config.startPath);
    trackActivity(state, 'demo_start_page', 'info', `Abriendo web normal: ${startUrl}`);
    await state.page.goto(startUrl, {
        waitUntil: 'domcontentloaded',
        timeout: state.config.stepTimeoutMs,
    }).catch((error) => {
        trackActivity(
            state,
            'demo_start_page_warning',
            'warning',
            `No se pudo abrir la pagina inicial: ${error instanceof Error ? error.message : String(error)}`,
        );
    });
    await state.page.waitForTimeout(250).catch(() => undefined);
}

async function refreshOverlay(
    state: RuntimeState,
    status?: string,
    paused = false,
    running = false,
): Promise<void> {
    const step = state.currentStep;
    if (!step) return;

    await showOverlay(state.page, {
        mode: state.config.mode,
        section: SECTION_LABELS[step.section],
        title: step.title,
        what: step.what,
        validate: step.validate,
        risk: step.risk,
        stepIndex: state.currentIndex,
        stepCount: state.stepCount,
        status,
        paused,
        running,
        activity: state.activity.slice(-6).map((event) => ({
            level: event.level,
            message: `${event.type}: ${event.message}`,
        })),
    }).catch(() => undefined);
}

async function recordNote(state: RuntimeState, note: string): Promise<void> {
    const step = state.currentStep;
    const screenshot = await takeScreenshot(state, `problem-${step?.id ?? 'step'}-${Date.now()}`);
    state.notes.push({
        stepId: step?.id ?? 'unknown',
        section: step?.section ?? 'public',
        title: step?.title ?? 'Paso desconocido',
        note,
        url: safePageUrl(state.page),
        screenshot,
        createdAt: new Date().toISOString(),
    });
    trackActivity(state, 'note', 'warning', note);
}

async function takeScreenshot(state: RuntimeState, label: string): Promise<string | undefined> {
    const fileName = `${slug(label)}.png`;
    const filePath = path.join(state.outputDir, 'screenshots', fileName);
    let saved = false;
    await state.page.screenshot({ path: filePath, fullPage: false }).then(() => {
        saved = true;
    }).catch((error) => {
        state.errors.push({
            stepId: state.currentStep?.id,
            section: state.currentStep?.section,
            title: state.currentStep?.title,
            message: `No se pudo guardar captura: ${error instanceof Error ? error.message : String(error)}`,
            url: safePageUrl(state.page),
            createdAt: new Date().toISOString(),
        });
    });
    if (saved) trackActivity(state, 'screenshot', 'info', `Captura guardada: ${fileName}`);
    return saved ? relativeToRun(state.outputDir, filePath) : undefined;
}

function createSkippedResult(
    state: RuntimeState,
    step: DemoStep,
    message: string,
): StepResult {
    const now = new Date().toISOString();
    return {
        id: step.id,
        section: step.section,
        title: step.title,
        status: 'skipped',
        message,
        details: [],
        url: safePageUrl(state.page),
        startedAt: now,
        endedAt: now,
        durationMs: 0,
    };
}

async function finalizeRun(state: RuntimeState): Promise<DemoRunSummary> {
    await state.activityWriteQueue.catch(() => undefined);

    const endedAt = new Date();
    const summary: DemoRunSummary = {
        schemaVersion: 1,
        startedAt: state.startedAt.toISOString(),
        endedAt: endedAt.toISOString(),
        mode: state.config.mode,
        baseUrl: state.config.baseUrl,
        outputDir: state.outputDir,
        results: state.results,
        notes: state.notes,
        skippedSections: Array.from(state.skippedSections),
        errors: state.errors,
        activity: state.activity,
        sectionStatus: computeSectionStatus(state.results),
    };

    await writeRunArtifacts(summary);
    return summary;
}

function isStepAllowed(step: DemoStep, mode: string): boolean {
    return !step.modes || step.modes.includes(mode as never);
}

function setupPageActivityListeners(state: RuntimeState): void {
    state.page.on('framenavigated', (frame) => {
        if (frame === state.page.mainFrame()) {
            trackActivity(state, 'frame_navigated', 'info', frame.url());
        }
    });

    state.page.on('console', (message) => {
        if (!['error', 'warning'].includes(message.type())) return;
        const text = message.text().slice(0, 300);
        const isReactWarning = text.startsWith('Warning:');
        const isResourceWarning = text.startsWith('Failed to load resource:');
        const isAstroAuditNoise = text.includes('Astro') && text.includes("audit's match function");
        const isSilentConsoleMetric = text.includes('font-size:0;color:transparent');
        trackActivity(
            state,
            isReactWarning || isResourceWarning || isAstroAuditNoise || isSilentConsoleMetric ? 'console_warning' : `console_${message.type()}`,
            message.type() === 'error' && !isReactWarning && !isResourceWarning && !isAstroAuditNoise && !isSilentConsoleMetric ? 'error' : 'warning',
            text,
        );
    });

    state.page.on('pageerror', (error) => {
        trackActivity(state, 'page_error', 'error', error.message.slice(0, 500));
    });

    state.page.on('requestfailed', (request) => {
        const failure = request.failure();
        const isAuthLogout = request.url().includes('/auth/v1/logout');
        const url = request.url();
        const isLocalDevAsset = url.startsWith(state.config.baseUrl)
            && (
                url.includes('/@fs/')
                || url.includes('/@id/')
                || url.includes('/src/components/')
                || url.includes('/node_modules/.vite/')
            );
        const isExternalAsset = !url.startsWith(state.config.baseUrl)
            && ['font', 'image', 'stylesheet', 'media'].includes(request.resourceType());
        trackActivity(
            state,
            isAuthLogout ? 'auth_logout_request_failed' : isLocalDevAsset || isExternalAsset ? 'asset_request_failed' : 'request_failed',
            isAuthLogout || isLocalDevAsset || isExternalAsset ? 'warning' : 'error',
            `${request.method()} ${url}`,
            [failure?.errorText || 'request failed'],
        );
    });

    state.page.on('response', (response) => {
        const status = response.status();
        if (status < 400) return;

        const url = response.url();
        const isUseful = url.includes('/api/') || response.request().resourceType() === 'document';
        if (!isUseful) return;

        trackActivity(
            state,
            'http_error',
            status >= 500 ? 'error' : 'warning',
            `${status} ${response.request().method()} ${url}`,
        );
    });
}

function trackActivity(
    state: RuntimeState,
    type: string,
    level: DemoActivityEvent['level'],
    message: string,
    details: string[] = [],
): void {
    const step = state.currentStep;
    const event: DemoActivityEvent = {
        at: new Date().toISOString(),
        type,
        level,
        message,
        stepId: step?.id,
        section: step?.section,
        url: safePageUrl(state.page),
        details,
    };
    state.activity.push(event);
    state.activityWriteQueue = state.activityWriteQueue
        .then(() => appendLiveActivity(state, event))
        .catch(() => undefined);

    if (state.activity.length > 1_000) {
        state.activity.splice(0, state.activity.length - 1_000);
    }
}

async function appendLiveActivity(state: RuntimeState, event: DemoActivityEvent): Promise<void> {
    const line = `[${event.at}] ${event.level.toUpperCase()} ${event.type}${event.stepId ? ` ${event.stepId}` : ''}: ${event.message}`;
    await Promise.all([
        appendFile(state.activityNdjsonPath, `${JSON.stringify(event)}\n`, 'utf8'),
        appendFile(state.activityLogPath, `${line}\n`, 'utf8'),
    ]);
}

async function writeCurrentRunPointer(state: RuntimeState, status: 'running' | 'complete'): Promise<void> {
    const currentPath = path.join(process.cwd(), 'outputs', 'demo-runs', 'current.json');
    await writeFile(currentPath, JSON.stringify({
        status,
        outputDir: state.outputDir,
        activityLogPath: state.activityLogPath,
        activityNdjsonPath: state.activityNdjsonPath,
        startedAt: state.startedAt.toISOString(),
        updatedAt: new Date().toISOString(),
    }, null, 2), 'utf8');
}

function buildUrl(baseUrl: string, pathOrUrl: string): string {
    if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl;
    return new URL(pathOrUrl, `${baseUrl}/`).toString();
}

function shouldReuseCurrentPage(state: RuntimeState, targetUrl: string): boolean {
    if (!state.config.respectCurrentState) return false;

    let current: URL;
    let target: URL;
    try {
        current = new URL(safePageUrl(state.page));
        target = new URL(targetUrl);
    } catch {
        return false;
    }

    if (current.protocol !== target.protocol || current.host !== target.host) return false;
    if (current.pathname !== target.pathname || current.search !== target.search) return false;
    if (target.hash && current.hash !== target.hash) return false;

    return true;
}

async function firstVisible(page: Page, selectors: string[], timeout: number): Promise<string | null> {
    const deadline = Date.now() + timeout;

    while (Date.now() < deadline) {
        if (page.isClosed()) return null;
        for (const selector of selectors) {
            const locator = page.locator(selector).first();
            if (await locator.isVisible().catch(() => false)) return selector;
        }

        await page.waitForTimeout(250).catch(() => undefined);
    }

    return null;
}

async function isVisible(locator: Locator, timeout: number): Promise<boolean> {
    return locator.waitFor({ state: 'visible', timeout }).then(() => true).catch(() => false);
}

function safePageUrl(page: Page): string {
    try {
        return page.url();
    } catch {
        return '';
    }
}

async function runWithTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => {
            reject(new Error(`Timeout de paso superado (${timeoutMs} ms).`));
        }, timeoutMs);
    });

    try {
        return await Promise.race([promise, timeoutPromise]);
    } finally {
        if (timeoutId) clearTimeout(timeoutId);
    }
}
