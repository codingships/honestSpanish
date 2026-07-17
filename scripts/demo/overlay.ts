import type { Page } from 'playwright';

export type OverlayActionType =
    | 'next'
    | 'back'
    | 'pause'
    | 'skip_section'
    | 'problem'
    | 'screenshot'
    | 'finish';

export interface OverlayAction {
    type: OverlayActionType;
    note?: string;
}

export interface OverlayPayload {
    mode: string;
    section: string;
    title: string;
    what: string;
    validate: string;
    risk: string;
    stepIndex: number;
    stepCount: number;
    status?: string;
    paused?: boolean;
    confirm?: boolean;
    running?: boolean;
    activity?: Array<{ level: 'info' | 'warning' | 'error'; message: string }>;
}

const OVERLAY_SCRIPT = `
(() => {
    if (window.__ehDemoOverlayInstalled) return;
    window.__ehDemoOverlayInstalled = true;

    const editableTags = new Set(['INPUT', 'TEXTAREA', 'SELECT']);

    function setAction(type, note) {
        window.__ehDemoAction = { type, note, at: Date.now() };
        const overlay = document.getElementById('eh-demo-overlay');
        const status = overlay?.querySelector('.eh-demo-status');
        if (overlay?.classList.contains('eh-demo-running') && status && type === 'next') {
            status.textContent = 'Siguiente preparado; avanzara cuando termine la carga actual.';
        }
    }

    function button(label, action, variant) {
        const element = document.createElement('button');
        element.type = 'button';
        element.textContent = label;
        element.dataset.action = action;
        element.className = 'eh-demo-btn ' + (variant || '');
        return element;
    }

    function miniButton(label) {
        const element = document.createElement('button');
        element.type = 'button';
        element.textContent = label;
        element.className = 'eh-demo-mini-btn';
        return element;
    }

    function readSetting(key, fallback) {
        try {
            return window.localStorage.getItem(key) || fallback;
        } catch {
            return fallback;
        }
    }

    function writeSetting(key, value) {
        try {
            window.localStorage.setItem(key, value);
        } catch {
            // Ignore storage restrictions; the overlay still works for this page.
        }
    }

    function applyPanelPosition(overlay, position) {
        overlay.classList.remove('eh-demo-pos-right', 'eh-demo-pos-left', 'eh-demo-pos-top');
        overlay.classList.add('eh-demo-pos-' + position);
    }

    function applyCompactMode(overlay, compact) {
        overlay.classList.toggle('eh-demo-compact', compact);
    }

    function ensureStyle() {
        if (document.getElementById('eh-demo-overlay-style')) return;
        const style = document.createElement('style');
        style.id = 'eh-demo-overlay-style';
        style.textContent = \`
            #eh-demo-overlay, #eh-demo-overlay * {
                box-sizing: border-box;
                letter-spacing: 0;
            }
            #eh-demo-overlay {
                position: fixed;
                right: 18px;
                bottom: 18px;
                left: auto;
                top: auto;
                z-index: 2147483647;
                width: min(440px, calc(100vw - 36px));
                max-height: min(78vh, 720px);
                overflow: auto;
                padding: 16px;
                border: 2px solid #006064;
                background: #ffffff;
                color: #053f3f;
                box-shadow: 8px 8px 0 #006064;
                font-family: Arial, sans-serif;
                font-size: 14px;
                line-height: 1.35;
            }
            #eh-demo-overlay.eh-demo-pos-right {
                right: 18px;
                bottom: 18px;
                left: auto;
                top: auto;
            }
            #eh-demo-overlay.eh-demo-pos-left {
                left: 18px;
                bottom: 18px;
                right: auto;
                top: auto;
            }
            #eh-demo-overlay.eh-demo-pos-top {
                right: 18px;
                top: 18px;
                left: auto;
                bottom: auto;
            }
            #eh-demo-overlay.eh-demo-compact {
                width: min(360px, calc(100vw - 36px));
                max-height: min(56vh, 520px);
                padding: 12px;
            }
            #eh-demo-overlay.eh-demo-compact .eh-demo-row,
            #eh-demo-overlay.eh-demo-compact .eh-demo-activity {
                display: none;
            }
            #eh-demo-overlay.eh-demo-paused {
                border-color: #8a5a00;
                box-shadow: 8px 8px 0 #8a5a00;
            }
            #eh-demo-overlay.eh-demo-running {
                border-color: #007c89;
                box-shadow: 8px 8px 0 #007c89;
            }
            #eh-demo-overlay .eh-demo-topline {
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: 10px;
                margin-bottom: 10px;
                font-size: 11px;
                font-weight: 700;
                text-transform: uppercase;
                color: #006064;
            }
            #eh-demo-overlay .eh-demo-panel-tools {
                display: flex;
                flex-wrap: wrap;
                justify-content: flex-end;
                gap: 6px;
            }
            #eh-demo-overlay .eh-demo-badges {
                display: flex;
                flex-wrap: wrap;
                gap: 6px;
            }
            #eh-demo-overlay .eh-demo-badge {
                border: 1px solid #006064;
                padding: 2px 6px;
                background: #e0f7fa;
                color: #006064;
            }
            #eh-demo-overlay h2 {
                margin: 0 0 10px;
                font-size: 22px;
                line-height: 1.1;
                color: #006064;
            }
            #eh-demo-overlay .eh-demo-row {
                margin-top: 10px;
            }
            #eh-demo-overlay .eh-demo-label {
                display: block;
                margin-bottom: 3px;
                font-size: 11px;
                font-weight: 700;
                text-transform: uppercase;
                color: #006064;
            }
            #eh-demo-overlay .eh-demo-text {
                margin: 0;
                color: #164f4d;
            }
            #eh-demo-overlay .eh-demo-status {
                margin-top: 12px;
                padding: 8px;
                border: 1px solid #006064;
                background: #f3fbfa;
                font-size: 12px;
                font-weight: 700;
            }
            #eh-demo-overlay .eh-demo-controls {
                display: grid;
                grid-template-columns: repeat(3, minmax(0, 1fr));
                gap: 8px;
                margin-top: 14px;
            }
            #eh-demo-overlay .eh-demo-activity {
                margin-top: 12px;
                padding: 8px;
                border: 1px solid #00606433;
                background: #f8fbfb;
            }
            #eh-demo-overlay .eh-demo-activity-title {
                margin-bottom: 6px;
                font-size: 10px;
                font-weight: 700;
                text-transform: uppercase;
                color: #006064;
            }
            #eh-demo-overlay .eh-demo-activity-item {
                margin: 4px 0;
                font: 11px/1.25 Arial, sans-serif;
                color: #164f4d;
            }
            #eh-demo-overlay .eh-demo-activity-item.warning {
                color: #7a4f00;
            }
            #eh-demo-overlay .eh-demo-activity-item.error {
                color: #9b1c1c;
            }
            #eh-demo-overlay .eh-demo-btn {
                min-height: 34px;
                border: 1px solid #006064;
                background: #ffffff;
                color: #006064;
                padding: 7px 8px;
                font: 700 11px/1.15 Arial, sans-serif;
                text-transform: uppercase;
                cursor: pointer;
            }
            #eh-demo-overlay .eh-demo-btn:hover {
                background: #e0f7fa;
            }
            #eh-demo-overlay .eh-demo-primary {
                grid-column: span 3;
                background: #006064;
                color: #ffffff;
                font-size: 13px;
            }
            #eh-demo-overlay .eh-demo-primary:hover {
                background: #004d40;
            }
            #eh-demo-overlay .eh-demo-danger {
                border-color: #b42318;
                color: #b42318;
            }
            #eh-demo-overlay .eh-demo-confirm {
                border-color: #8a5a00;
                background: #fff3bf;
                color: #5f3f00;
            }
            #eh-demo-overlay .eh-demo-mini-btn {
                border: 1px solid #006064;
                background: #f3fbfa;
                color: #006064;
                padding: 3px 6px;
                font: 700 10px/1 Arial, sans-serif;
                text-transform: uppercase;
                cursor: pointer;
            }
            #eh-demo-overlay .eh-demo-mini-btn:hover {
                background: #e0f7fa;
            }
            @media (max-width: 560px) {
                #eh-demo-overlay,
                #eh-demo-overlay.eh-demo-pos-right,
                #eh-demo-overlay.eh-demo-pos-left,
                #eh-demo-overlay.eh-demo-pos-top {
                    right: 10px;
                    left: 10px;
                    bottom: 10px;
                    top: auto;
                    width: auto;
                    padding: 12px;
                }
                #eh-demo-overlay .eh-demo-controls {
                    grid-template-columns: repeat(2, minmax(0, 1fr));
                }
                #eh-demo-overlay .eh-demo-primary {
                    grid-column: span 2;
                }
            }
        \`;
        document.head.appendChild(style);
    }

    function textBlock(label, value) {
        const row = document.createElement('div');
        row.className = 'eh-demo-row';
        const labelElement = document.createElement('span');
        labelElement.className = 'eh-demo-label';
        labelElement.textContent = label;
        const text = document.createElement('p');
        text.className = 'eh-demo-text';
        text.textContent = value || '-';
        row.append(labelElement, text);
        return row;
    }

    function boot(payload) {
        ensureStyle();

        let overlay = document.getElementById('eh-demo-overlay');
        if (!overlay) {
            overlay = document.createElement('section');
            overlay.id = 'eh-demo-overlay';
            overlay.setAttribute('aria-live', 'polite');
            document.body.appendChild(overlay);
        }

        const panelPosition = readSetting('ehDemoOverlayPosition', 'right');
        const compact = readSetting('ehDemoOverlayCompact', '0') === '1';
        overlay.className = [
            'eh-demo-pos-' + panelPosition,
            compact ? 'eh-demo-compact' : '',
            payload.paused ? 'eh-demo-paused' : '',
            payload.running ? 'eh-demo-running' : '',
        ].filter(Boolean).join(' ');
        overlay.replaceChildren();

        const top = document.createElement('div');
        top.className = 'eh-demo-topline';
        const step = document.createElement('span');
        step.textContent = 'Paso ' + payload.stepIndex + ' de ' + payload.stepCount;
        const badges = document.createElement('div');
        badges.className = 'eh-demo-badges';
        const section = document.createElement('span');
        section.className = 'eh-demo-badge';
        section.textContent = payload.section;
        const mode = document.createElement('span');
        mode.className = 'eh-demo-badge';
        mode.textContent = payload.mode;
        badges.append(section, mode);
        const tools = document.createElement('div');
        tools.className = 'eh-demo-panel-tools';
        const move = miniButton('Mover');
        const compactButton = miniButton(compact ? 'Expandir' : 'Compacto');
        tools.append(move, compactButton);
        top.append(step, badges, tools);

        const title = document.createElement('h2');
        title.textContent = payload.title;

        const status = document.createElement('div');
        status.className = 'eh-demo-status';
        status.textContent = payload.paused
            ? 'Demo pausada. Pulsa Pausar otra vez para reanudar.'
            : payload.status || (payload.running ? 'Ejecutando. Si pulsas Siguiente, avanzara cuando termine.' : (payload.confirm ? 'Confirmacion requerida para continuar.' : 'Pulsa Siguiente para ejecutar este paso.'));

        const controls = document.createElement('div');
        controls.className = 'eh-demo-controls';
        controls.append(
            button('Anterior', 'back'),
            button(payload.paused ? 'Reanudar' : 'Pausar', 'pause'),
            button('Saltar seccion', 'skip_section'),
            button('Problema', 'problem', 'eh-demo-confirm'),
            button('Captura', 'screenshot'),
            button('Finalizar', 'finish', 'eh-demo-danger'),
            button(payload.running ? 'Siguiente al terminar' : (payload.confirm ? 'Confirmar y ejecutar' : 'Siguiente'), 'next', 'eh-demo-primary'),
        );

        const activity = document.createElement('div');
        activity.className = 'eh-demo-activity';
        const activityTitle = document.createElement('div');
        activityTitle.className = 'eh-demo-activity-title';
        activityTitle.textContent = 'Actividad reciente';
        activity.appendChild(activityTitle);
        (payload.activity || []).slice(-6).forEach((item) => {
            const row = document.createElement('div');
            row.className = 'eh-demo-activity-item ' + item.level;
            row.textContent = item.message;
            activity.appendChild(row);
        });
        if (!payload.activity || payload.activity.length === 0) {
            const row = document.createElement('div');
            row.className = 'eh-demo-activity-item';
            row.textContent = 'Sin eventos todavia.';
            activity.appendChild(row);
        }

        overlay.append(
            top,
            title,
            textBlock('Que se ensena', payload.what),
            textBlock('Validacion', payload.validate),
            textBlock('Riesgo', payload.risk),
            status,
            activity,
            controls,
        );

        controls.querySelectorAll('button[data-action]').forEach((control) => {
            control.addEventListener('click', () => {
                const action = control.dataset.action;
                if (action === 'problem') {
                    const note = window.prompt('Describe brevemente la incidencia:');
                    if (note && note.trim()) setAction(action, note.trim());
                    return;
                }
                setAction(action);
            });
        });

        move.addEventListener('click', () => {
            const positions = ['right', 'left', 'top'];
            const current = readSetting('ehDemoOverlayPosition', 'right');
            const next = positions[(positions.indexOf(current) + 1) % positions.length] || 'right';
            writeSetting('ehDemoOverlayPosition', next);
            applyPanelPosition(overlay, next);
        });

        compactButton.addEventListener('click', () => {
            const next = readSetting('ehDemoOverlayCompact', '0') === '1' ? '0' : '1';
            writeSetting('ehDemoOverlayCompact', next);
            applyCompactMode(overlay, next === '1');
            compactButton.textContent = next === '1' ? 'Expandir' : 'Compacto';
        });
    }

    window.__ehDemoBootOverlay = boot;
    window.__ehDemoConsumeAction = () => {
        const action = window.__ehDemoAction || null;
        window.__ehDemoAction = null;
        return action;
    };

    window.addEventListener('keydown', (event) => {
        const target = event.target;
        const overlay = document.getElementById('eh-demo-overlay');
        const isInsideOverlay = Boolean(target && overlay?.contains(target));
        const isDemoShortcut = isInsideOverlay || event.altKey;
        if (!isDemoShortcut) return;

        const isEditable = target && (editableTags.has(target.tagName) || target.isContentEditable);
        if (isEditable && event.key !== 'Escape') return;

        if (event.key === 'Enter') {
            event.preventDefault();
            setAction('next');
        } else if (event.key === ' ') {
            event.preventDefault();
            setAction('pause');
        } else if (event.key.toLowerCase() === 'b') {
            event.preventDefault();
            const note = window.prompt('Describe brevemente la incidencia:');
            if (note && note.trim()) setAction('problem', note.trim());
        } else if (event.key.toLowerCase() === 's') {
            event.preventDefault();
            setAction('skip_section');
        } else if (event.key === 'Escape') {
            event.preventDefault();
            setAction('finish');
        }
    }, true);
})();
`;

export async function installOverlay(page: Page): Promise<void> {
    await page.addInitScript({ content: OVERLAY_SCRIPT });
    await evaluateOverlayScript(page);
}

export async function showOverlay(page: Page, payload: OverlayPayload): Promise<void> {
    await evaluateOverlayScript(page);
    await page.evaluate((nextPayload) => {
        window.__ehDemoBootOverlay?.(nextPayload);
    }, payload);
}

export async function waitForOverlayAction(page: Page): Promise<OverlayAction> {
    for (;;) {
        if (page.isClosed()) return { type: 'finish' };
        const action = await page.evaluate(() => window.__ehDemoConsumeAction?.() ?? null).catch(() => null);
        if (action?.type) return action as OverlayAction;
        await page.waitForTimeout(150).catch(() => undefined);
    }
}

export async function consumeOverlayAction(page: Page): Promise<OverlayAction | null> {
    const action = await page.evaluate(() => window.__ehDemoConsumeAction?.() ?? null).catch(() => null);
    return action?.type ? action as OverlayAction : null;
}

export async function clearOverlayAction(page: Page): Promise<void> {
    await page.evaluate(() => {
        window.__ehDemoAction = undefined;
    }).catch(() => undefined);
}

async function evaluateOverlayScript(page: Page): Promise<void> {
    await page.evaluate(OVERLAY_SCRIPT).catch(async () => {
        await page.waitForLoadState('domcontentloaded', { timeout: 5_000 }).catch(() => undefined);
        await page.evaluate(OVERLAY_SCRIPT).catch(() => undefined);
    });
}

declare global {
    interface Window {
        __ehDemoOverlayInstalled?: boolean;
        __ehDemoBootOverlay?: (payload: OverlayPayload) => void;
        __ehDemoConsumeAction?: () => OverlayAction | null;
        __ehDemoAction?: OverlayAction & { at: number };
    }
}
