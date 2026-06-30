import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

type FindingStatus = 'ok' | 'warning' | 'failed';
type SequenceStatus = 'OK' | 'WARNING' | 'FAILED';

interface Finding {
    status: FindingStatus;
    area: string;
    message: string;
    details?: string[];
}

interface SequenceReport {
    schemaVersion: 1;
    startedAt: string;
    endedAt: string;
    status: SequenceStatus;
    findings: Finding[];
    outputDir: string;
}

const startedAt = new Date();
const outputDir = path.join(process.cwd(), 'outputs', 'launch-sequence', stamp(startedAt));
mkdirSync(outputDir, { recursive: true });

const sequencePath = path.join('docs', 'launch', 'LAUNCH_SEQUENCE.md');
const finalClosurePath = path.join('docs', 'launch', 'FINAL_CLOSURE.md');
const postLaunchBacklogPath = path.join('docs', 'launch', 'POST_LAUNCH_BACKLOG.md');
const sequenceDoc = readIfExists(sequencePath);
const finalClosureDoc = readIfExists(finalClosurePath);
const postLaunchBacklogDoc = readIfExists(postLaunchBacklogPath);
const findings: Finding[] = [
    checkSequenceDocument(),
    checkFinalOnlyBlockers(),
    checkPostLaunchBacklog(),
    checkFinalClosureRunbook(),
    checkManualEvidenceMapping(),
    checkSoftLaunchWithoutPayments(),
    checkCrossReferences(),
];

const failed = findings.filter((finding) => finding.status === 'failed');
const warnings = findings.filter((finding) => finding.status === 'warning');
const status: SequenceStatus = failed.length > 0 ? 'FAILED' : warnings.length > 0 ? 'WARNING' : 'OK';
const report: SequenceReport = {
    schemaVersion: 1,
    startedAt: startedAt.toISOString(),
    endedAt: new Date().toISOString(),
    status,
    findings,
    outputDir,
};

writeFileSync(path.join(outputDir, 'summary.json'), JSON.stringify(report, null, 2), 'utf8');
writeFileSync(path.join(outputDir, 'summary.md'), renderMarkdown(report), 'utf8');

console.log(`[launch:sequence] Status: ${status}`);
console.log(`[launch:sequence] Failed: ${failed.length}`);
console.log(`[launch:sequence] Warnings: ${warnings.length}`);
console.log(`[launch:sequence] Summary: ${path.join(outputDir, 'summary.md')}`);

if (failed.length > 0) process.exit(1);

function checkSequenceDocument(): Finding {
    const details: string[] = [];

    if (!sequenceDoc) {
        return {
            status: 'failed',
            area: 'launch sequence document',
            message: 'docs/launch/LAUNCH_SEQUENCE.md is missing.',
            details: [sequencePath],
        };
    }

    const requiredSections = [
        '# Launch Sequence',
        '## Decisiones actuales',
        '## Fase 1: ordenar ahora',
        '## Fase 2: release candidate',
        '## Fase 3: cierre final',
        '## Evidencia manual por momento',
        '## Urgente vs final-only',
    ];

    for (const section of requiredSections) {
        if (!sequenceDoc.includes(section)) {
            details.push(`${sequencePath} missing section "${section}".`);
        }
    }

    return {
        status: details.length === 0 ? 'ok' : 'failed',
        area: 'launch sequence document',
        message: details.length === 0
            ? 'Launch sequence document exists with current decisions, phases, evidence mapping and urgency split.'
            : 'Launch sequence document is missing required sections.',
        details,
    };
}

function checkFinalOnlyBlockers(): Finding {
    const requiredSnippets = [
        'Los datos reales legales los completara Alin manualmente al final',
        'Stripe se mantiene en modo prueba por ahora',
        'Todas las API keys se rotaran antes del lanzamiento real',
        'La demo queda en segundo plano',
        'docs/launch/FINAL_CLOSURE.md',
        'Antes de declarar `READY`, deben pasar `pnpm launch:gate`',
        'Congelar copy publico, paquetes, dominio, modo de pagos',
        'Rotar claves solo despues de congelar copy, legal, pagos y dominio definitivos',
        'No hace falta cerrar ahora:',
        'Datos reales del titular/controlador legal',
        'Stripe live',
        'Smoke final de produccion',
        'No debe quedar para despues del launch:',
    ];
    const missing = requiredSnippets.filter((snippet) => !sequenceDoc.includes(snippet));

    return {
        status: missing.length === 0 ? 'ok' : 'failed',
        area: 'final-only blocker policy',
        message: missing.length === 0
            ? 'Final-only blockers are explicit while READY remains gated by legal, Stripe/keys if applicable, and final smoke.'
            : 'Final-only blocker policy is incomplete or ambiguous.',
        details: missing.map((snippet) => `${sequencePath} missing "${snippet}".`),
    };
}

function checkPostLaunchBacklog(): Finding {
    if (!postLaunchBacklogDoc) {
        return {
            status: 'failed',
            area: 'post-launch backlog policy',
            message: 'docs/launch/POST_LAUNCH_BACKLOG.md is missing.',
            details: [postLaunchBacklogPath],
        };
    }

    const requiredSnippets = [
        'Este documento no desbloquea el Launch Gate',
        'Reviews/testimonios',
        'Canal publico de Telegram',
        'Telemetria de uso',
        'Prueba de nivel definitiva',
        'La solicitud de plaza no es una prueba de nivel definitiva',
        'Stripe live',
        'Rotacion final de claves',
        'SEO/LLM final',
        'No activar telemetria sin revisar legal/cookies/consentimiento',
        'No publicar reviews sin fuente real y permiso',
        'No enlazar Telegram si no hay canal y politica minima de moderacion',
        'Si una tarea de este backlog entra al lanzamiento, actualizar `docs/launch/CHECKLIST.md`',
    ];
    const missing = requiredSnippets.filter((snippet) => !postLaunchBacklogDoc.includes(snippet));

    return {
        status: missing.length === 0 ? 'ok' : 'failed',
        area: 'post-launch backlog policy',
        message: missing.length === 0
            ? 'Deferred marketing, telemetry, level-test and final-only tasks are explicit and cannot silently unlock the Launch Gate.'
            : 'Post-launch backlog policy is incomplete or could be confused with launch readiness.',
        details: missing.map((snippet) => `${postLaunchBacklogPath} missing "${snippet}".`),
    };
}

function checkFinalClosureRunbook(): Finding {
    if (!finalClosureDoc) {
        return {
            status: 'failed',
            area: 'final closure runbook',
            message: 'docs/launch/FINAL_CLOSURE.md is missing.',
            details: [finalClosurePath],
        };
    }

    const requiredSnippets = [
        '# Final Closure Runbook',
        'Criterio De Entrada',
        'Responsables Y Cadencia',
        'T-48h',
        'T-24h',
        'T-12h',
        'T-6h',
        'T-3h',
        'T-1h',
        'T-0',
        'Alin/Codex',
        'Decision De Prueba De Nivel',
        'docs/launch/LEVEL_CHECK.md',
        'privacidad/consentimiento/retencion/canal de envio',
        'pnpm launch:accessibility',
        'Congelar Decision De Pagos',
        'Completar Legal Real',
        'Backup/Export Final De Supabase',
        'Rotacion Final De Claves',
        'Validar Integraciones Production',
        'Cerrar SEO/LLM Final',
        'Smoke Final',
        'Gate Final Y Revision Secundaria',
        'legal_owner_controller',
        'legal_human_review',
        'payments_staging',
        'integration_readiness',
        'seo_llm_final',
        'final_smoke',
        'pnpm launch:gate',
        'pnpm launch:secondary-review',
    ];
    const missing = requiredSnippets.filter((snippet) => !finalClosureDoc.includes(snippet));

    return {
        status: missing.length === 0 ? 'ok' : 'failed',
        area: 'final closure runbook',
        message: missing.length === 0
            ? 'Final closure runbook covers payment decision, legal, backup, key rotation, integrations, SEO/LLM, final smoke and final gate review.'
            : 'Final closure runbook is missing required final Go/No-Go coverage.',
        details: missing.map((snippet) => `${finalClosurePath} missing "${snippet}".`),
    };
}

function checkManualEvidenceMapping(): Finding {
    const requiredChecks = [
        'cleanup_agents_decision',
        'content_review',
        'accessibility_manual',
        'security_external',
        'operations_external',
        'database_readiness',
        'payments_staging',
        'legal_owner_controller',
        'legal_human_review',
        'integration_readiness',
        'seo_llm_final',
        'final_smoke',
    ];
    const details = requiredChecks
        .filter((checkId) => !sequenceDoc.includes(`\`${checkId}\``))
        .map((checkId) => `${sequencePath} missing manual evidence mapping for ${checkId}.`);

    return {
        status: details.length === 0 ? 'ok' : 'failed',
        area: 'manual evidence phase mapping',
        message: details.length === 0
            ? 'All required manual evidence checks are assigned to an intended launch phase.'
            : 'Manual evidence checks are not fully mapped to launch phases.',
        details,
    };
}

function checkSoftLaunchWithoutPayments(): Finding {
    const productsDoc = readIfExists(path.join('docs', 'launch', 'PRODUCTS.md'));
    const runbookDoc = readIfExists(path.join('docs', 'launch', 'RUNBOOK.md'));
    const details: string[] = [];

    if (!sequenceDoc.includes('checkout debe quedar desactivado, oculto o bloqueado')) {
        details.push(`${sequencePath} must state checkout is disabled/hidden/blocked for public launch without real payments.`);
    }
    if (!productsDoc.includes('Mientras Stripe siga en modo prueba, no aceptar pagos reales')) {
        details.push('docs/launch/PRODUCTS.md must state Stripe test mode cannot accept real payments.');
    }
    if (!runbookDoc.includes('### Launch sin pagos reales')) {
        details.push('docs/launch/RUNBOOK.md must include the no-real-payments launch procedure.');
    }

    return {
        status: details.length === 0 ? 'ok' : 'failed',
        area: 'soft launch without payments',
        message: details.length === 0
            ? 'Soft launch without real payments is documented as a deliberate, evidenced configuration decision.'
            : 'Soft launch without real payments is under-documented.',
        details,
    };
}

function checkCrossReferences(): Finding {
    const references: Array<{ file: string; snippets: string[] }> = [
        {
            file: 'README.md',
            snippets: ['docs/launch/LAUNCH_SEQUENCE.md', 'bloqueos final-only'],
        },
        {
            file: path.join('docs', 'launch', 'CHECKLIST.md'),
            snippets: ['docs/launch/LAUNCH_SEQUENCE.md', 'docs/launch/FINAL_CLOSURE.md', 'final-only blockers'],
        },
        {
            file: path.join('docs', 'launch', 'MANUAL_EVIDENCE.md'),
            snippets: ['docs/launch/LAUNCH_SEQUENCE.md', 'docs/launch/FINAL_CLOSURE.md', 'siguen bloqueando `READY`'],
        },
        {
            file: path.join('docs', 'launch', 'MANUAL_EVIDENCE_RUNBOOK.md'),
            snippets: ['docs/launch/LAUNCH_SEQUENCE.md', 'docs/launch/FINAL_CLOSURE.md', 'legal/Stripe/keys/smoke final'],
        },
    ];
    const details = references.flatMap(({ file, snippets }) => {
        const content = readIfExists(file);
        return snippets
            .filter((snippet) => !content.includes(snippet))
            .map((snippet) => `${file} missing "${snippet}".`);
    });

    return {
        status: details.length === 0 ? 'ok' : 'failed',
        area: 'launch sequence cross references',
        message: details.length === 0
            ? 'README, checklist and manual evidence docs point to the launch sequence.'
            : 'Launch sequence is not cross-referenced from all operational docs.',
        details,
    };
}

function renderMarkdown(report: SequenceReport): string {
    const lines = [
        '# Launch Sequence Audit',
        '',
        `- Status: ${report.status}`,
        `- Started: ${report.startedAt}`,
        `- Ended: ${report.endedAt}`,
        `- Output: ${report.outputDir}`,
        '',
        '| Status | Area | Message |',
        '| --- | --- | --- |',
    ];

    for (const finding of report.findings) {
        lines.push(`| ${finding.status} | ${finding.area} | ${escapeTable(finding.message)} |`);
        for (const detail of finding.details ?? []) {
            lines.push(`|  |  | ${escapeTable(detail)} |`);
        }
    }

    lines.push(
        '',
        '## Rule',
        '',
        'This audit proves the launch sequence is explicit and referenced. It does not replace real legal review, payment smoke, external dashboard evidence or the final Launch Gate.'
    );

    return `${lines.join('\n')}\n`;
}

function readIfExists(filePath: string): string {
    return existsSync(filePath) ? readFileSync(filePath, 'utf8') : '';
}

function stamp(date: Date): string {
    return date.toISOString().replace(/[:.]/g, '-');
}

function escapeTable(value: string): string {
    return value.replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>');
}
