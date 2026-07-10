import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

type CheckStatus = 'ok' | 'warning' | 'failed';
type ReportStatus = 'OK' | 'WARNING' | 'FAILED';
type FinalSmokeClosureStatus =
    | 'READY_FOR_FINAL_SMOKE_APPROVAL'
    | 'WAITING_ON_FINAL_PREREQUISITES'
    | 'BLOCKED_BY_PACKAGE_ERRORS';
type StagingSmokeClosureStatus =
    | 'READY_FOR_STAGING_SMOKE_APPROVAL'
    | 'BLOCKED_BY_PACKAGE_ERRORS';

interface SmokePackCheck {
    status: CheckStatus;
    name: string;
    message: string;
    details: string[];
}

interface FinalSmokeExecutionReport {
    schemaVersion: 1;
    startedAt: string;
    endedAt: string;
    status: ReportStatus;
    finalSmokeClosureStatus: FinalSmokeClosureStatus;
    stagingSmokeClosureStatus: StagingSmokeClosureStatus;
    outputDir: string;
    latestFinalReadinessSummaryPath: string | null;
    latestFinalSmokeWorksheetPath: string | null;
    latestLaunchStatusSummaryPath: string | null;
    finalPrerequisiteBlockers: string[];
    checks: SmokePackCheck[];
    manifestPath: string;
    approvalRequestPath: string;
    stagingApprovalRequestPath: string;
    stagingCheckoutGateApprovalPath: string;
    preflightChecklistPath: string;
    stagingPreflightChecklistPath: string;
    productionMinimalChecklistPath: string;
    rollbackPlanPath: string;
    manualEvidenceDryRunPath: string;
    summaryPath: string;
}

interface RenderedArtifacts {
    manifest: string;
    approvalRequest: string;
    stagingApprovalRequest: string;
    stagingCheckoutGateApproval: string;
    preflightChecklist: string;
    stagingPreflightChecklist: string;
    productionMinimalChecklist: string;
    rollbackPlan: string;
    manualEvidenceDryRun: string;
    summary: string;
}

const smokeScriptPath = path.join('scripts', 'smoke', 'real-env-smoke.ts');
const smokeSafetyTestPath = path.join('tests', 'unit', 'real-env-smoke-safety.test.ts');
const finalReadinessScriptPath = path.join('scripts', 'launch', 'final-readiness-audit.ts');
const statusScriptPath = path.join('scripts', 'launch', 'status.ts');
const manualEvidencePath = path.join('docs', 'launch', 'MANUAL_EVIDENCE.md');
const manualRunbookPath = path.join('docs', 'launch', 'MANUAL_EVIDENCE_RUNBOOK.md');
const manualExamplePath = path.join('docs', 'launch', 'MANUAL_EVIDENCE.example.json');
const operationsRunbookTestPath = path.join('tests', 'unit', 'operations-runbook.test.ts');
const exactStagingSmokeApprovalSentence = 'Apruebo ejecutar un smoke rehearsal de staging con writes externos contra `SMOKE_BASE_URL=https://espanolhonesto-staging.alindev95.workers.dev`, con `SMOKE_EXTERNAL_WRITES_CONFIRMATION=writes-ok:espanolhonesto-staging.alindev95.workers.dev`, usando exclusivamente las cuentas allowlisted existentes de alumno, admin y profesor, con Stripe test mode y evidencia de Checkout/webhooks reales ya prevalidada read-only, permitiendo unicamente writes de smoke necesarios en Supabase staging, Stripe test, Google, Resend y Admin Jobs, sin crear usuarios Auth, sin necesitar acceso al buzon del alumno, sin imprimir secretos, sin guardar datos privados en evidencia, sin resetear contrasenas, sin fabricar eventos Stripe, sin activar pagos reales, sin cambiar Cloudflare/DNS/dominios y con cleanup automatico de CRM, jobs, sesiones y artefactos temporales. El cambio temporal del gate requiere ademas su aprobacion Cloudflare separada y exacta; el runner aprobado sera responsable de restaurarlo y verificarlo en `false` dentro de `finally`. No autorizo ningun otro cambio externo.';
const exactStagingCheckoutGateApprovalSentence = 'Apruebo que el runner cambie temporalmente solo `CHECKOUT_ENABLED_OVERRIDE` del Cloudflare Worker staging `espanolhonesto-staging` de `false` a `true` para completar y verificar el Checkout Stripe test aprobado y que, dentro de `finally`, lo devuelva a `false` y verifique el rollback incluso si el smoke o la activacion fallan; antes del primer write debe atestiguar el runtime cerrado, la cuenta `d1a22bcf6477ff2ff31d2bfb83084e44` y el Worker exactos. No autorizo deploy de codigo, cambios de rutas, dominios, DNS, otros secrets/vars, Workers production, Stripe live, Supabase, Google, Resend ni ningun otro write externo.';

const startedAt = new Date();
const outputDir = path.join(process.cwd(), 'outputs', 'launch-final-smoke-execution-pack', stamp(startedAt));
mkdirSync(outputDir, { recursive: true });

const latestFinalReadinessSummaryPath = latestGeneratedPath('launch-final-readiness', 'summary.md');
const latestFinalSmokeWorksheetPath = latestGeneratedPath('launch-final-readiness', 'final-smoke-worksheet.md');
const latestLaunchStatusSummaryPath = latestGeneratedPath('launch-status', 'summary.json');
const latestLaunchStatus = readJsonIfExists<{
    status?: string;
    releaseCandidateReadiness?: {
        finalOnlyOpenChecks?: string[];
        strictQaOpenChecks?: string[];
    };
}>(latestLaunchStatusSummaryPath);
const finalPrerequisiteBlockers = collectFinalPrerequisiteBlockers(latestLaunchStatus);

const checks: SmokePackCheck[] = [
    validatePackageScript(),
    validateSmokeHarnessSafety(),
    validateSmokeCoverage(),
    validateSmokeSafetyTest(),
    validateFinalReadinessWorksheet(),
    validateFinalPrerequisites(),
    validateDocsAndStatusWiring(),
];

let report = createReport(checks);
let rendered = renderArtifacts(report);
checks.push(validateGeneratedArtifactPosture(rendered));
report = createReport(checks);
rendered = renderArtifacts(report);

writeFileSync(report.manifestPath, rendered.manifest, 'utf8');
writeFileSync(report.approvalRequestPath, rendered.approvalRequest, 'utf8');
writeFileSync(report.stagingApprovalRequestPath, rendered.stagingApprovalRequest, 'utf8');
writeFileSync(report.stagingCheckoutGateApprovalPath, rendered.stagingCheckoutGateApproval, 'utf8');
writeFileSync(report.preflightChecklistPath, rendered.preflightChecklist, 'utf8');
writeFileSync(report.stagingPreflightChecklistPath, rendered.stagingPreflightChecklist, 'utf8');
writeFileSync(report.productionMinimalChecklistPath, rendered.productionMinimalChecklist, 'utf8');
writeFileSync(report.rollbackPlanPath, rendered.rollbackPlan, 'utf8');
writeFileSync(report.manualEvidenceDryRunPath, rendered.manualEvidenceDryRun, 'utf8');
writeFileSync(path.join(outputDir, 'summary.json'), JSON.stringify(report, null, 2), 'utf8');
writeFileSync(report.summaryPath, rendered.summary, 'utf8');

const failed = report.checks.filter((check) => check.status === 'failed');
const warnings = report.checks.filter((check) => check.status === 'warning');

console.log(`[launch:final-smoke-execution-pack] Status: ${report.status}`);
console.log(`[launch:final-smoke-execution-pack] Closure: ${report.finalSmokeClosureStatus}`);
console.log(`[launch:final-smoke-execution-pack] Staging closure: ${report.stagingSmokeClosureStatus}`);
console.log(`[launch:final-smoke-execution-pack] Failed: ${failed.length}`);
console.log(`[launch:final-smoke-execution-pack] Warnings: ${warnings.length}`);
console.log(`[launch:final-smoke-execution-pack] Summary: ${report.summaryPath}`);
console.log(`[launch:final-smoke-execution-pack] Manifest: ${report.manifestPath}`);
console.log(`[launch:final-smoke-execution-pack] Approval request: ${report.approvalRequestPath}`);
console.log(`[launch:final-smoke-execution-pack] Preflight checklist: ${report.preflightChecklistPath}`);
console.log(`[launch:final-smoke-execution-pack] Rollback plan: ${report.rollbackPlanPath}`);

if (failed.length > 0) process.exit(1);

function createReport(reportChecks: SmokePackCheck[]): FinalSmokeExecutionReport {
    const reportStatus = statusFor(reportChecks);

    return {
        schemaVersion: 1,
        startedAt: startedAt.toISOString(),
        endedAt: new Date().toISOString(),
        status: reportStatus,
        finalSmokeClosureStatus: reportStatus === 'FAILED'
            ? 'BLOCKED_BY_PACKAGE_ERRORS'
            : finalPrerequisiteBlockers.length > 0
                ? 'WAITING_ON_FINAL_PREREQUISITES'
                : 'READY_FOR_FINAL_SMOKE_APPROVAL',
        stagingSmokeClosureStatus: reportStatus === 'FAILED'
            ? 'BLOCKED_BY_PACKAGE_ERRORS'
            : 'READY_FOR_STAGING_SMOKE_APPROVAL',
        outputDir,
        latestFinalReadinessSummaryPath,
        latestFinalSmokeWorksheetPath,
        latestLaunchStatusSummaryPath,
        finalPrerequisiteBlockers,
        checks: reportChecks,
        manifestPath: path.join(outputDir, 'final-smoke-execution-manifest.json'),
        approvalRequestPath: path.join(outputDir, 'approval-request-final-smoke.md'),
        stagingApprovalRequestPath: path.join(outputDir, 'approval-request-staging-smoke.md'),
        stagingCheckoutGateApprovalPath: path.join(outputDir, 'approval-request-staging-checkout-gate.md'),
        preflightChecklistPath: path.join(outputDir, 'preflight-checklist.md'),
        stagingPreflightChecklistPath: path.join(outputDir, 'staging-preflight-checklist.md'),
        productionMinimalChecklistPath: path.join(outputDir, 'production-minimal-smoke-checklist.md'),
        rollbackPlanPath: path.join(outputDir, 'rollback-and-cleanup-plan.md'),
        manualEvidenceDryRunPath: path.join(outputDir, 'manual-evidence-dry-run.txt'),
        summaryPath: path.join(outputDir, 'summary.md'),
    };
}

function validatePackageScript(): SmokePackCheck {
    const packagePath = 'package.json';
    if (!existsSync(packagePath)) {
        return {
            status: 'failed',
            name: 'package_script_final_smoke_pack',
            message: 'package.json is missing.',
            details: [packagePath],
        };
    }

    const packageJson = JSON.parse(readFileSync(packagePath, 'utf8')) as {
        packageManager?: string;
        scripts?: Record<string, string>;
    };
    const missing: string[] = [];
    if (packageJson.packageManager !== 'pnpm@10.33.0') missing.push('packageManager=pnpm@10.33.0');
    if (packageJson.scripts?.['launch:final-smoke-execution-pack'] !== 'tsx scripts/launch/final-smoke-execution-pack.ts') {
        missing.push('launch:final-smoke-execution-pack=tsx scripts/launch/final-smoke-execution-pack.ts');
    }

    return {
        status: missing.length === 0 ? 'ok' : 'failed',
        name: 'package_script_final_smoke_pack',
        message: missing.length === 0
            ? 'Package scripts expose the local-only final smoke execution pack and preserve pnpm policy.'
            : 'Package scripts are missing the final smoke execution pack or pnpm package manager contract.',
        details: missing.length === 0 ? ['launch:final-smoke-execution-pack'] : missing.map((item) => `missing=${item}`),
    };
}

function validateSmokeHarnessSafety(): SmokePackCheck {
    const source = readIfExists(smokeScriptPath);
    if (!source) {
        return {
            status: 'failed',
            name: 'real_env_smoke_safety_gate',
            message: 'The real environment smoke harness is missing.',
            details: [smokeScriptPath],
        };
    }

    const required = [
        "requireEnv('SMOKE_BASE_URL')",
        "requireEnv('SMOKE_EXTERNAL_WRITES_CONFIRMATION')",
        "requireEnv('SMOKE_ADMIN_EMAIL')",
        "requireEnv('SMOKE_ADMIN_PASSWORD')",
        "requireEnv('SMOKE_TEACHER_EMAIL')",
        "requireEnv('SMOKE_TEACHER_PASSWORD')",
        "requireEnv('SMOKE_STUDENT_EMAIL')",
        "requireEnv('SMOKE_STUDENT_PASSWORD')",
        "requireEnv('EMAIL_RECIPIENT_ALLOWLIST')",
        "requireEnv('STAGING_CHECKOUT_GATE_CONFIRMATION')",
        'writes-ok:${parsedUrl.host}',
        'SMOKE_BASE_URL must be an origin only',
        'This staging-only smoke reuses the three existing allowlisted role accounts',
        'runReadOnlyPreflight',
        '--preflight-only',
        'externalWritesStarted: false',
        'authUsersCreated: 0',
        'result.failedSections = getSmokeFailureSections(result);',
        'result.ok = result.failedSections.length === 0 && runError === null;',
        'function writeSmokeEvidence',
        'redactSmokeResult(result)',
        'redactErrorForSmokeEvidence(error)',
        'SMOKE_COMPLETED_CHECKOUT_SESSION_ID',
        'verifyCompletedCheckoutEvidence',
        'SMOKE_BILLING_LIFECYCLE_MANUAL_CONFIRMATION',
        'synthetic webhook payloads are forbidden',
        ".from('package_prices')",
        ".from('checkout_intents')",
        'withdrawalLossAcknowledged: true',
        'deleteSmokeCheckoutArtifacts',
        'cleanupSchedulingSmokeArtifacts',
        'deleteSmokeFulfillmentJobArtifacts',
    ];
    const forbidden = [
        "process.env.SMOKE_BASE_URL || 'https://espanolhonesto.com'",
        'process.env.SMOKE_BASE_URL || "https://espanolhonesto.com"',
        'console.log(JSON.stringify(result, null, 2));',
        'console.error(error);',
        'generateTestHeaderString',
        'postSignedWebhook',
        'sendStripeEvent',
        'stripe.subscriptions.create',
        "source: 'tok_visa'",
        'supabaseAdmin.auth.admin.createUser',
        'supabaseAdmin.auth.admin.updateUserById',
    ];
    const missing = required.filter((snippet) => !source.includes(snippet));
    const presentForbidden = forbidden.filter((snippet) => source.includes(snippet));

    return {
        status: missing.length === 0 && presentForbidden.length === 0 ? 'ok' : 'failed',
        name: 'real_env_smoke_safety_gate',
        message: missing.length === 0 && presentForbidden.length === 0
            ? 'Real environment smoke requires exact host write confirmation, real Stripe test evidence, explicit credentials and redacted evidence.'
            : 'Real environment smoke is missing safety gates or contains unsafe fallback/output behavior.',
        details: [
            ...missing.map((snippet) => `missing=${snippet}`),
            ...presentForbidden.map((snippet) => `forbidden=${snippet}`),
        ],
    };
}

function validateSmokeCoverage(): SmokePackCheck {
    const source = readIfExists(smokeScriptPath);
    const required = [
        '/api/create-checkout',
        'SMOKE_COMPLETED_CHECKOUT_SESSION_ID',
        'verifyCompletedCheckoutEvidence',
        'SMOKE_BILLING_LIFECYCLE_MANUAL_CONFIRMATION',
        '/api/account/link-google-drive',
        'getDriveClient',
        '/api/calendar/sessions',
        '/api/calendar/session-action',
        '/internal/reminders/send-exact',
        '/api/admin/fulfillment-jobs?status=failed&limit=100',
        'waitForAdminJobAudit',
        'cancelClassEvent',
        'teacherCalendarContainsStudent',
        'adminCalendarContainsCompleted',
        'runAdminJobsRecoverySmoke',
    ];
    const missing = required.filter((snippet) => !source.includes(snippet));

    return {
        status: missing.length === 0 ? 'ok' : 'failed',
        name: 'real_env_smoke_flow_coverage',
        message: missing.length === 0
            ? 'Smoke harness covers approved checkout, real webhook reconciliation evidence, Drive, booking, Calendar/Meet, reminders, cancellation and Admin Jobs retry/recovery.'
            : 'Smoke harness is missing expected final smoke flow coverage.',
        details: missing.length === 0 ? [smokeScriptPath] : missing.map((snippet) => `missing=${snippet}`),
    };
}

function validateSmokeSafetyTest(): SmokePackCheck {
    const testSource = readIfExists(smokeSafetyTestPath);
    if (!testSource) {
        return {
            status: 'failed',
            name: 'real_env_smoke_safety_unit_test',
            message: 'Real environment smoke safety unit test is missing.',
            details: [smokeSafetyTestPath],
        };
    }

    const required = [
        'requires explicit environment credentials',
        'requires an explicit external-write confirmation',
        'redacts final smoke command output',
        'writes redacted final smoke evidence files',
        'covers Admin Jobs retry and cleanup',
        'uses real completed Checkout evidence and never fabricates Stripe events or subscriptions',
        'prepares the approved package_price checkout boundary and refuses live Stripe writes',
        'validates every precondition read-only before starting any write',
        'reuses only the existing allowlisted role accounts and performs bounded cleanup',
    ];
    const missing = required.filter((snippet) => !testSource.includes(snippet));

    return {
        status: missing.length === 0 ? 'ok' : 'failed',
        name: 'real_env_smoke_safety_unit_test',
        message: missing.length === 0
            ? 'Unit coverage guards the destructive smoke safety posture.'
            : 'Real environment smoke safety unit test is missing required assertions.',
        details: missing.length === 0 ? [smokeSafetyTestPath] : missing.map((snippet) => `missing=${snippet}`),
    };
}

function validateFinalReadinessWorksheet(): SmokePackCheck {
    const finalReadinessSource = readIfExists(finalReadinessScriptPath);
    const required = [
        'final-smoke-worksheet.md',
        'staging-only technical lifecycle harness',
        'Production uses a separate minimal manual smoke',
        'pnpm launch:final-smoke-execution-pack',
        'real-env-smoke.ts',
        'registration, checkout policy, webhook, Drive, email, booking, Doc, Calendar/Meet, reminder, cancellation and retry are proven in staging',
    ];
    const missing = required.filter((snippet) => !finalReadinessSource.includes(snippet));

    const worksheetDetail = latestFinalSmokeWorksheetPath
        ? `latestWorksheet=${latestFinalSmokeWorksheetPath}`
        : 'latestWorksheet=missing; run pnpm launch:final-readiness before final smoke';

    return {
        status: missing.length > 0 ? 'failed' : latestFinalSmokeWorksheetPath ? 'ok' : 'warning',
        name: 'final_readiness_smoke_worksheet',
        message: missing.length > 0
            ? 'Final readiness script is missing final smoke execution-pack guidance.'
            : latestFinalSmokeWorksheetPath
                ? 'Latest final smoke worksheet is available and points to the execution-pack gate.'
                : 'Final smoke worksheet support exists, but no latest launch:final-readiness output was found.',
        details: missing.length > 0 ? missing.map((snippet) => `missing=${snippet}`) : [worksheetDetail],
    };
}

function validateFinalPrerequisites(): SmokePackCheck {
    if (!latestLaunchStatusSummaryPath || !latestLaunchStatus) {
        return {
            status: 'warning',
            name: 'final_smoke_prerequisite_status',
            message: 'No launch:status summary is available to prove final smoke prerequisites are clear.',
            details: ['run=corepack pnpm --config.verify-deps-before-run=false launch:status'],
        };
    }

    return {
        status: finalPrerequisiteBlockers.length === 0 ? 'ok' : 'warning',
        name: 'final_smoke_prerequisite_status',
        message: finalPrerequisiteBlockers.length === 0
            ? 'Current launch status has no non-smoke final prerequisites blocking final smoke approval.'
            : 'Current launch status still has non-smoke final prerequisites open; do not approve final smoke yet.',
        details: [
            `latestLaunchStatus=${latestLaunchStatusSummaryPath}`,
            `launch_status=${latestLaunchStatus.status ?? 'unknown'}`,
            `final_prerequisite_blockers=${finalPrerequisiteBlockers.join('|') || 'none'}`,
        ],
    };
}

function validateDocsAndStatusWiring(): SmokePackCheck {
    const required: Array<[string, string]> = [
        [statusScriptPath, 'finalSmokeExecutionPack'],
        [statusScriptPath, 'approval-request-final-smoke.md'],
        [statusScriptPath, 'final-smoke-execution-manifest.json'],
        [manualEvidencePath, 'outputs/launch-final-smoke-execution-pack/<timestamp>/final-smoke-execution-manifest.json'],
        [manualRunbookPath, 'pnpm launch:final-smoke-execution-pack'],
        [manualRunbookPath, 'approval-request-final-smoke.md'],
        [manualRunbookPath, 'approval-request-staging-checkout-gate.md'],
        [manualRunbookPath, 'production-minimal-smoke-checklist.md'],
        [manualExamplePath, 'outputs/launch-final-smoke-execution-pack/<timestamp>/approval-request-final-smoke.md'],
        [operationsRunbookTestPath, 'launch:final-smoke-execution-pack'],
    ];
    const missingFiles = [...new Set(required.map(([file]) => file))].filter((file) => !existsSync(file));
    const missing = required.filter(([file, snippet]) => !readIfExists(file).includes(snippet));

    return {
        status: missingFiles.length === 0 && missing.length === 0 ? 'ok' : 'failed',
        name: 'docs_status_final_smoke_pack_wiring',
        message: missingFiles.length === 0 && missing.length === 0
            ? 'Status, manual evidence docs, example evidence and runbook tests point to the final smoke execution pack.'
            : 'Final smoke execution pack is not fully wired into status, docs or tests.',
        details: [
            ...missingFiles.map((file) => `missingFile=${file}`),
            ...missing.map(([file, snippet]) => `missing=${file}::${snippet}`),
        ],
    };
}

function validateGeneratedArtifactPosture(renderedArtifacts: RenderedArtifacts): SmokePackCheck {
    const combined = Object.values(renderedArtifacts).join('\n');
    const forbiddenSecretPatterns = [
        new RegExp('-----BEGIN ' + 'PRIVATE KEY-----'),
        /sk_(live|test)_[A-Za-z0-9]{20,}/,
        /whsec_[A-Za-z0-9]{20,}/,
        /sb_secret_[A-Za-z0-9_-]{20,}/,
        /AIza[0-9A-Za-z_-]{30,}/,
        /(?<![A-Za-z0-9_])re_[A-Za-z0-9_]{20,}/,
        /(postgres|postgresql):\/\/[^\s"']+:[^\s"']+@/,
    ];
    const offenders = forbiddenSecretPatterns.filter((pattern) => pattern.test(combined));
    const requiredSafetyText = [
        'does not run final smoke',
        'does not write external services',
        'final prerequisites',
        'exact approval',
        'SMOKE_EXTERNAL_WRITES_CONFIRMATION',
        'writes-ok:<host>',
        'staging rehearsal',
        'Separate Cloudflare Staging Checkout Gate Approval',
        'minimal manual production smoke',
        'redacted',
        'rollback',
    ];
    const missing = requiredSafetyText.filter((snippet) => !combined.includes(snippet));

    return {
        status: offenders.length === 0 && missing.length === 0 ? 'ok' : 'failed',
        name: 'generated_artifact_secret_and_scope_posture',
        message: offenders.length === 0 && missing.length === 0
            ? 'Generated artifacts contain final smoke scope gates and no obvious secret values.'
            : 'Generated artifacts are missing safety text or appear to include secret-like values.',
        details: [
            ...offenders.map((pattern) => `secretPattern=${pattern}`),
            ...missing.map((snippet) => `missing=${snippet}`),
        ],
    };
}

function renderArtifacts(reportToRender: FinalSmokeExecutionReport): RenderedArtifacts {
    const approvalRequest = renderApprovalRequest(reportToRender);
    const stagingApprovalRequest = renderStagingApprovalRequest(reportToRender);
    const stagingCheckoutGateApproval = renderStagingCheckoutGateApproval(reportToRender);
    const preflightChecklist = renderPreflightChecklist(reportToRender);
    const stagingPreflightChecklist = renderStagingPreflightChecklist(reportToRender);
    const productionMinimalChecklist = renderProductionMinimalChecklist(reportToRender);
    const rollbackPlan = renderRollbackPlan(reportToRender);
    const manualEvidenceDryRun = renderManualEvidenceDryRun(reportToRender);
    const summary = renderSummary(reportToRender);
    const manifest = renderManifest(reportToRender, {
        approvalRequest,
        stagingApprovalRequest,
        stagingCheckoutGateApproval,
        preflightChecklist,
        stagingPreflightChecklist,
        productionMinimalChecklist,
        rollbackPlan,
        manualEvidenceDryRun,
        summary,
    });

    return {
        manifest,
        approvalRequest,
        stagingApprovalRequest,
        stagingCheckoutGateApproval,
        preflightChecklist,
        stagingPreflightChecklist,
        productionMinimalChecklist,
        rollbackPlan,
        manualEvidenceDryRun,
        summary,
    };
}

function renderManifest(
    reportToRender: FinalSmokeExecutionReport,
    renderedFiles: Omit<RenderedArtifacts, 'manifest'>,
): string {
    return `${JSON.stringify({
        schemaVersion: 1,
        generatedAt: reportToRender.endedAt,
        status: reportToRender.status,
        finalSmokeClosureStatus: reportToRender.finalSmokeClosureStatus,
        stagingSmokeClosureStatus: reportToRender.stagingSmokeClosureStatus,
        readyForApproval: reportToRender.status === 'OK' && reportToRender.finalPrerequisiteBlockers.length === 0,
        readyForStagingApproval: reportToRender.stagingSmokeClosureStatus === 'READY_FOR_STAGING_SMOKE_APPROVAL',
        doesNotRunFinalSmoke: true,
        doesNotWriteExternalServices: true,
        requiresExactApprovalBeforeWrites: true,
        finalPrerequisiteBlockers: reportToRender.finalPrerequisiteBlockers,
        sourceEvidence: {
            smokeHarness: smokeScriptPath,
            smokeSafetyTest: smokeSafetyTestPath,
            latestFinalReadinessSummary: reportToRender.latestFinalReadinessSummaryPath,
            latestFinalSmokeWorksheet: reportToRender.latestFinalSmokeWorksheetPath,
            latestLaunchStatusSummary: reportToRender.latestLaunchStatusSummaryPath,
        },
        approvalBoundary: {
            requiredConfirmation: 'SMOKE_EXTERNAL_WRITES_CONFIRMATION=writes-ok:<host>',
            hostRule: 'The <host> must exactly match SMOKE_BASE_URL host.',
            stagingFirst: true,
            productionOnlyInFinalWindow: true,
            stagingHarnessIsNeverProductionSmoke: true,
            productionSmokeIsMinimalAndManual: true,
            checkoutGateUsesSeparateCloudflareApproval: true,
            exactApprovalRequired: true,
            stagingRehearsalMayRunBeforeLegalFinal: true,
            stagingRehearsalDoesNotCloseFinalSmoke: true,
        },
        sideEffectsIfApproved: [
            'Staging-only Supabase profile/session/fulfillment smoke data writes using one reusable existing student',
            'Stripe test rehearsal and read-only verification of a real completed Checkout/webhook lifecycle',
            'Google Drive folder/Doc and Calendar/Meet mutations',
            'Resend email sends or suppression checks',
            'Admin Jobs retry/cancel/audit mutations',
        ],
        forbiddenScope: [
            'No running final smoke from this package command.',
            'No secret values in repo files, outputs, screenshots or logs.',
            'No unplanned real payments or public checkout enabling.',
            'No password reset for owner/admin/teacher accounts.',
            'No Auth user creation and no example.com recipient.',
            'No execution of the staging harness against production.',
            'No broad service cleanup outside smoke-created resources.',
        ],
        files: {
            approvalRequest: fileMeta(reportToRender.approvalRequestPath, renderedFiles.approvalRequest),
            stagingApprovalRequest: fileMeta(reportToRender.stagingApprovalRequestPath, renderedFiles.stagingApprovalRequest),
            stagingCheckoutGateApproval: fileMeta(reportToRender.stagingCheckoutGateApprovalPath, renderedFiles.stagingCheckoutGateApproval),
            preflightChecklist: fileMeta(reportToRender.preflightChecklistPath, renderedFiles.preflightChecklist),
            stagingPreflightChecklist: fileMeta(reportToRender.stagingPreflightChecklistPath, renderedFiles.stagingPreflightChecklist),
            productionMinimalChecklist: fileMeta(reportToRender.productionMinimalChecklistPath, renderedFiles.productionMinimalChecklist),
            rollbackPlan: fileMeta(reportToRender.rollbackPlanPath, renderedFiles.rollbackPlan),
            manualEvidenceDryRun: fileMeta(reportToRender.manualEvidenceDryRunPath, renderedFiles.manualEvidenceDryRun),
            summary: fileMeta(reportToRender.summaryPath, renderedFiles.summary),
        },
        checks: reportToRender.checks,
    }, null, 2)}\n`;
}

function renderApprovalRequest(reportToRender: FinalSmokeExecutionReport): string {
    return `${[
        '# Production Minimal Manual Smoke Approval Request',
        '',
        'This local file is not permission. It prepares the exact approval boundary for the launch-day production smoke.',
        '',
        'This package does not run final smoke and does not write external services. The automated `scripts/smoke/real-env-smoke.ts` harness is staging-only and must never be pointed at production.',
        '',
        '## Production Boundary',
        '',
        '- Final prerequisites: `legal_owner_controller`, `legal_human_review`, `integration_readiness`, `seo_llm_final` and strict-QA blockers must be closed or explicitly accepted before production final smoke.',
        '- Environment: production only, in the final launch window, after the full staging lifecycle rehearsal passed.',
        '- Use `production-minimal-smoke-checklist.md`; do not rerun the destructive staging matrix in production.',
        '- Payment posture: one deliberately owned live checkout at most, only if the separate Stripe live/payment approval names that action. No-checkout remains rollback only.',
        '- Accounts: existing admin/teacher and the explicitly owned launch transaction only; no Auth user creation, no password reset and no need to access a customer inbox.',
        '',
        '## Required Read-Only Preflight',
        '',
        '- Review `pnpm launch:final-readiness` output and the latest final smoke worksheet.',
        '- Review `pnpm launch:status` and confirm `final_smoke` is still the intended blocker being closed.',
        '- Confirm this package says `READY_FOR_FINAL_SMOKE_APPROVAL`, not `WAITING_ON_FINAL_PREREQUISITES`.',
        '- Run `pnpm secrets:check` before the smoke window.',
        '- Confirm the domain/runtime/payment posture is final enough for this smoke; do not use final smoke to discover which runtime should receive production traffic.',
        '- Confirm production provider health and quotas read-only. Reuse staging evidence for the exhaustive Drive/Calendar/reminder/cancellation matrix.',
        '',
        '## Exact Approval Sentence',
        '',
        'Apruebo realizar el smoke minimo manual de production en `https://espanolhonesto.com` durante la ventana final, limitado a comprobar paginas publicas/legales, login y superficies esenciales con cuentas existentes, salud de proveedores mediante evidencia read-only y, solo si existe aprobacion Stripe live separada, una unica compra deliberadamente propia con reconciliacion y rollback documentados; no autorizo ejecutar `scripts/smoke/real-env-smoke.ts` contra production, crear usuarios, enviar campañas, fabricar webhooks, hacer pruebas destructivas masivas ni cambiar Cloudflare/DNS/configuracion.',
        '',
        '## Forbidden Scope',
        '',
        '- No secret value printing, screenshots, commits or output files.',
        '- No password reset for owner/admin/teacher accounts.',
        '- No Stripe live charge unless separately approved in the final payment decision.',
        '- No Cloudflare deploy/domain/DNS writes.',
        '- No Supabase schema migration, destructive cleanup or broad data deletion.',
        '- No automated staging harness, bulk Google/Calendar mutations or synthetic lifecycle data in production.',
        '',
        '## Current Local Package State',
        '',
        `- Package status: ${reportToRender.status}`,
        `- Closure status: ${reportToRender.finalSmokeClosureStatus}`,
        `- Final prerequisite blockers: ${reportToRender.finalPrerequisiteBlockers.join(', ') || 'none'}`,
        `- Latest launch status summary: ${reportToRender.latestLaunchStatusSummaryPath ?? 'missing'}`,
        `- Latest final readiness summary: ${reportToRender.latestFinalReadinessSummaryPath ?? 'missing'}`,
        `- Latest final smoke worksheet: ${reportToRender.latestFinalSmokeWorksheetPath ?? 'missing'}`,
        '',
    ].join('\n')}\n`;
}

function renderStagingApprovalRequest(reportToRender: FinalSmokeExecutionReport): string {
    return `${[
        '# Staging Smoke Rehearsal Approval Request',
        '',
        'This local file is not permission. It prepares the exact approval boundary for a staging rehearsal of the same write-capable lifecycle smoke.',
        '',
        'This package does not run staging smoke, does not write external services, does not open public checkout, does not send email and does not change Supabase, Stripe, Google, Resend or Cloudflare state. It is an approval checklist only.',
        '',
        '## Why This Is Separate From Final Smoke',
        '',
        '- Staging rehearsal can run before legal final values, live-domain SEO and production domain move are closed.',
        '- Staging rehearsal does not close `final_smoke`; it only finds technical, logistical and UX errors before the final launch window.',
        '- Production final smoke still waits for legal/domain/SEO/provider posture to be final enough.',
        '',
        '## Required Decisions Before Approval',
        '',
        '- Environment: staging only.',
        '- Exact `SMOKE_BASE_URL`: normally `https://espanolhonesto-staging.alindev95.workers.dev`; it must be an origin only.',
        '- Exact `SMOKE_EXTERNAL_WRITES_CONFIRMATION`: `writes-ok:<host>`, where `<host>` matches `SMOKE_BASE_URL` exactly.',
        '- Payment posture: Stripe test mode rehearsal only; no Stripe live mode and no real public checkout.',
        '- Accounts: reuse exactly `TEST_ADMIN_EMAIL`, `TEST_TEACHER_EMAIL` and `TEST_STUDENT_EMAIL` from the secure source; all three must equal the Resend allowlist, no `example.com` address is allowed, and the smoke never needs inbox access for the student.',
        '- Completed Checkout/manual lifecycle: provide a real `cs_test_...` session and the matching `reviewed-real-events:<session>` confirmation before any write.',
        '- Checkout gate: obtain the separate `approval-request-staging-checkout-gate.md` approval; this smoke approval alone does not authorize the runner-owned Cloudflare gate window.',
        '',
        '## Required Read-Only Preflight',
        '',
        '- Review this package summary and confirm `Staging closure status` is `READY_FOR_STAGING_SMOKE_APPROVAL`.',
        '- Review latest `pnpm launch:stripe-readonly`, `pnpm launch:final-readiness` and `pnpm launch:status` evidence for known residual risks.',
        '- Run `pnpm secrets:check` before the smoke window.',
        '- Confirm Google, Resend and Stripe test quotas/posture are acceptable for one staging smoke run.',
        '',
        '## Command Shape After Exact Approval',
        '',
        'Set the required environment variables from the secure source, then use only the gated runner:',
        '',
        '```bash',
        'corepack pnpm --config.verify-deps-before-run=false launch:staging-smoke-rehearsal-runner -- --execute-approved',
        '```',
        '',
        'The runner first invokes the harness with `--preflight-only --expect-checkout-override false`. Supabase/runtime/Stripe/Google/Resend, catalog, role allowlist, completed Checkout and manual lifecycle must pass read-only before the gate write; it then re-attests override `true` before smoke writes and restores/verifies `false` in `finally`.',
        '',
        '## Exact Approval Sentence',
        '',
        exactStagingSmokeApprovalSentence,
        '',
        '## Forbidden Scope',
        '',
        '- No production smoke and no live-domain claim from this rehearsal.',
        '- No secret value printing, screenshots, commits or output files.',
        '- No Auth user creation, password reset or email outside the three-account allowlist.',
        '- No Stripe live mode or real charge.',
        '- No Cloudflare deploy/domain/DNS writes under this approval; the temporary staging checkout gate has a separate exact approval and mandatory `false` rollback.',
        '- No Supabase schema migration, destructive cleanup or broad data deletion.',
        '- No Google Drive/Calendar cleanup outside smoke-created artifacts.',
        '',
        '## Current Local Package State',
        '',
        `- Package status: ${reportToRender.status}`,
        `- Staging closure status: ${reportToRender.stagingSmokeClosureStatus}`,
        `- Final smoke closure status: ${reportToRender.finalSmokeClosureStatus}`,
        `- Final prerequisite blockers, not staging blockers: ${reportToRender.finalPrerequisiteBlockers.join(', ') || 'none'}`,
        `- Latest launch status summary: ${reportToRender.latestLaunchStatusSummaryPath ?? 'missing'}`,
        '',
    ].join('\n')}\n`;
}

function renderStagingCheckoutGateApproval(reportToRender: FinalSmokeExecutionReport): string {
    return `${[
        '# Separate Cloudflare Staging Checkout Gate Approval Request',
        '',
        'This package does not perform the Cloudflare write. It prepares the exact separate approval under which the approved staging runner owns the temporary gate and its `finally` rollback.',
        '',
        '## Exact Resource And Sequence',
        '',
        '- The runner read-only preflights Cloudflare account `d1a22bcf6477ff2ff31d2bfb83084e44`, Worker `espanolhonesto-staging` and signed closed runtimes before any write.',
        '- The runner changes only `CHECKOUT_ENABLED_OVERRIDE=true` on that staging Worker.',
        '- The runner re-attests the deployed web/fulfillment configuration and requires the no-session probe to return `401` before smoke writes.',
        '- The runner runs the separately approved staging smoke.',
        '- Inside `finally`, the runner returns only that same variable to `false` and requires signed attestation plus `403 Checkout is disabled`, retrying at most three times.',
        '- An unverifiable rollback is reported as ambiguous and fails the run for immediate manual closure.',
        '',
        '## Exact Separate Approval Sentence',
        '',
        exactStagingCheckoutGateApprovalSentence,
        '',
        '## Current Package State',
        '',
        `- Package status: ${reportToRender.status}`,
        `- Staging closure status: ${reportToRender.stagingSmokeClosureStatus}`,
        '',
    ].join('\n')}\n`;
}

function renderPreflightChecklist(reportToRender: FinalSmokeExecutionReport): string {
    return `${[
        '# Production Minimal Manual Smoke Preflight Checklist',
        '',
        'Use this before the launch-day production check. Record only non-secret, redacted evidence; never run the staging lifecycle harness against production.',
        '',
        '## Local Readiness',
        '',
        '- `pnpm launch:final-readiness` has a fresh output.',
        '- `pnpm launch:final-smoke-execution-pack` is fresh and status is not `FAILED`.',
        '- `pnpm launch:final-smoke-execution-pack` reports `READY_FOR_FINAL_SMOKE_APPROVAL`, not `WAITING_ON_FINAL_PREREQUISITES`.',
        '- Non-smoke final prerequisites are clear or explicitly risk-accepted: legal, integration, SEO/LLM and strict-QA blockers.',
        '- `pnpm secrets:check` passes.',
        '- The full staging lifecycle rehearsal has passed with cleanup and its redacted evidence is attached.',
        '- `launch:status` still points to the latest final smoke execution pack.',
        '',
        '## Production Scope',
        '',
        '- Exact origin is `https://espanolhonesto.com` (and canonical redirect behavior for `www` is checked read-only).',
        '- Use only existing owner/admin/teacher accounts and the explicitly owned launch transaction; create no test Auth users.',
        '- Do not send bulk/test emails or recreate the Drive/Calendar lifecycle matrix in production.',
        '- A live purchase is attempted only under its separate payment approval and is limited to one deliberately owned transaction.',
        '- `scripts/smoke/real-env-smoke.ts` is staging-only and forbidden here.',
        '',
        '## Minimum Manual Coverage',
        '',
        '- Public home, pricing/application, legal pages, cookie controls and support load on the final domain.',
        '- Existing admin and teacher can sign in and reach their essential surfaces.',
        '- Checkout is either deliberately open with the approved live posture or deliberately closed with a verified 403 rollback.',
        '- Provider dashboards/logs show no new critical error; reuse staging evidence for exhaustive webhooks, Drive, Calendar, reminders and Admin Jobs.',
        '- `/ru` visual/Cyrillic spot check only if final typography changed.',
        '',
        '## Evidence Rules',
        '',
        '- Attach `production-minimal-smoke-checklist.md`, this package manifest and the approval request to `final_smoke` manual evidence.',
        '- Attach the prior staging harness summary as supporting integration evidence, not as production execution evidence.',
        '- Use manual notes for dashboard confirmations; do not paste payloads, customer records, private Drive URLs or card details.',
        '',
        '## Current Local Evidence',
        '',
        `- Latest final readiness summary: ${reportToRender.latestFinalReadinessSummaryPath ?? 'missing'}`,
        `- Latest final smoke worksheet: ${reportToRender.latestFinalSmokeWorksheetPath ?? 'missing'}`,
        `- Latest launch status summary: ${reportToRender.latestLaunchStatusSummaryPath ?? 'missing'}`,
        `- Final prerequisite blockers: ${reportToRender.finalPrerequisiteBlockers.join(', ') || 'none'}`,
        '',
    ].join('\n')}\n`;
}

function renderStagingPreflightChecklist(reportToRender: FinalSmokeExecutionReport): string {
    return `${[
        '# Staging Smoke Rehearsal Preflight Checklist',
        '',
        'Use this before an approved staging rehearsal. Record only non-secret, redacted evidence.',
        '',
        '## Local Readiness',
        '',
        '- `pnpm launch:final-smoke-execution-pack` is fresh and status is not `FAILED`.',
        '- The package reports `READY_FOR_STAGING_SMOKE_APPROVAL`.',
        '- `pnpm secrets:check` passes.',
        '- `tests/unit/real-env-smoke-safety.test.ts` passes.',
        '- Known final-only blockers are understood as not closing `final_smoke`: legal, live domain, SEO/LLM and production final smoke.',
        '',
        '## Environment And Writes',
        '',
        '- `SMOKE_BASE_URL=https://espanolhonesto-staging.alindev95.workers.dev` unless a different staging origin is explicitly approved.',
        '- `SMOKE_EXTERNAL_WRITES_CONFIRMATION=writes-ok:espanolhonesto-staging.alindev95.workers.dev` for the default staging origin.',
        '- `SMOKE_ADMIN_*`, `SMOKE_TEACHER_*` and `SMOKE_STUDENT_*` map only to the three existing `TEST_*` accounts; `EMAIL_RECIPIENT_ALLOWLIST` contains exactly those three and no `example.com` recipient.',
        '- The student inbox is not part of the acceptance procedure; API/provider delivery state is used.',
        '- Stripe keys are test-mode keys, not live-mode keys.',
        '- Google, Resend and Stripe quotas are acceptable for one staging rehearsal.',
        '- `SMOKE_COMPLETED_CHECKOUT_SESSION_ID` identifies a real completed Stripe test Checkout; no webhook payload is fabricated.',
        '- `SMOKE_BILLING_LIFECYCLE_MANUAL_CONFIRMATION=reviewed-real-events:<same-session>` is supplied only after real event/test-clock evidence has been reviewed.',
        '- `approval-request-staging-checkout-gate.md` has a separate exact approval in `STAGING_CHECKOUT_GATE_APPROVAL`; only the runner may change Worker `espanolhonesto-staging` during that window.',
        '- The runner executes the closed-runtime preflight before the gate write, the enabled-runtime preflight before smoke writes and the closed-runtime verification from `finally`.',
        '',
        '## Flow Coverage',
        '',
        '- Existing auth/session cookie paths for admin, teacher and student; zero Auth users created.',
        '- Checkout policy and read-only verification of real Stripe test Checkout/webhook side effects; no synthetic events.',
        '- Drive folder/Doc access model.',
        '- Booking, Calendar/Meet creation, conflict, cancellation, completion and no-show paths.',
        '- Reminder cron authorization and delivery/state update.',
        '- Admin Jobs failed-list, retry, pending-list, cancel and audit log.',
        '- Cleanup deletes the temporary CRM opportunity/intent, local scheduling subscription/sessions, Google class artifacts and job/audit rows; it restores profile/assignment state and preserves the reusable student/folder IDs.',
        '- UX/logistics notes for any awkward states found during the rehearsal.',
        '',
        '## Evidence Rules',
        '',
        '- Attach redacted `outputs/real-env-smoke/<timestamp>/summary.md` when the smoke runs.',
        '- Attach this staging approval request and checklist to the QA tracker as staging rehearsal evidence.',
        '- Do not use this rehearsal alone to mark `final_smoke` pass.',
        '- After success or failure, require the runner report to show `checkoutGateRollbackVerified=true`; ambiguous state requires immediate manual `false` closure and a fresh signed/403 probe.',
        '',
        '## Current Local Evidence',
        '',
        `- Latest final readiness summary: ${reportToRender.latestFinalReadinessSummaryPath ?? 'missing'}`,
        `- Latest final smoke worksheet: ${reportToRender.latestFinalSmokeWorksheetPath ?? 'missing'}`,
        `- Latest launch status summary: ${reportToRender.latestLaunchStatusSummaryPath ?? 'missing'}`,
        `- Final-only blockers that do not block staging rehearsal: ${reportToRender.finalPrerequisiteBlockers.join(', ') || 'none'}`,
        '',
    ].join('\n')}\n`;
}

function renderProductionMinimalChecklist(reportToRender: FinalSmokeExecutionReport): string {
    return `${[
        '# Production Minimal Manual Smoke Checklist',
        '',
        'This is the only production smoke shape prepared by this package. The exhaustive automated lifecycle harness is staging-only.',
        '',
        '## Before Traffic',
        '',
        '- [ ] Final domain and direct Worker probes are healthy; canonical redirects are correct.',
        '- [ ] Legal identity/review, integration readiness, SEO/LLM final and strict-QA blockers are closed or explicitly accepted.',
        '- [ ] Stripe live account/mode, Supabase production ref, webhook endpoint/events and Portal configuration are verified read-only.',
        '- [ ] A rollback owner can set `CHECKOUT_ENABLED_OVERRIDE=false` without disabling webhook reconciliation.',
        '',
        '## Manual Checks',
        '',
        '- [ ] Home, pricing/application, privacy, cookies, terms, cancellation/refund/desistimiento and support pages load on production.',
        '- [ ] Existing admin and teacher accounts sign in; no password is reset and no Auth user is created.',
        '- [ ] Campus/admin essential pages load without a new critical Sentry/provider error.',
        '- [ ] Checkout is intentionally open or intentionally closed. If open, one owned live transaction at most is run only under its separate payment approval.',
        '- [ ] The owned transaction, if any, is reconciled in Stripe/Supabase/webhook evidence without exposing card/customer data.',
        '- [ ] No bulk email, synthetic webhook, test-clock sequence, Drive folder creation or Calendar lifecycle matrix is run in production.',
        '',
        '## Evidence And Rollback',
        '',
        '- [ ] Record timestamp, owner, exact origin, each result and redacted provider evidence.',
        '- [ ] Attach the successful staging lifecycle summary as supporting evidence.',
        '- [ ] If any critical check fails, set `CHECKOUT_ENABLED_OVERRIDE=false`, keep webhook/fulfillment running, stop new traffic and keep `final_smoke` pending.',
        '',
        `- Package status: ${reportToRender.status}`,
        `- Closure status: ${reportToRender.finalSmokeClosureStatus}`,
        `- Final prerequisite blockers: ${reportToRender.finalPrerequisiteBlockers.join(', ') || 'none'}`,
        '',
    ].join('\n')}\n`;
}

function renderRollbackPlan(reportToRender: FinalSmokeExecutionReport): string {
    return `${[
        '# Final Smoke Rollback And Cleanup Plan',
        '',
        'This plan is non-secret evidence. It does not authorize writes by itself.',
        '',
        '## If Smoke Fails Before External Writes',
        '',
        '- Stop and keep `final_smoke` pending; if this was staging rehearsal, keep the rehearsal evidence as failed technical QA evidence instead of launch sign-off.',
        '- Fix local configuration or runtime routing, then regenerate this package and rerun read-only status checks.',
        '',
        '## If Smoke Creates Data Then Fails',
        '',
        '- Preserve the redacted `outputs/real-env-smoke/<timestamp>/summary.md` and `summary.json` for diagnosis.',
        '- The staging harness creates zero Auth users; it reuses exactly one existing allowlisted student and preserves that user/folder ID.',
        '- Its bounded cleanup must delete the temporary CRM opportunity/intent, local scheduling subscription/sessions, Google class artifacts and job/audit rows, then restore notes, Google-link value and teacher assignments.',
        '- A cleanup failure is a failed smoke. Use only the redacted IDs/evidence from that run for a separately reviewed cleanup; never delete completed payment evidence or non-smoke data.',
        '- The runner returns Worker `espanolhonesto-staging` to `CHECKOUT_ENABLED_OVERRIDE=false` in `finally`; require signed runtime attestation and the 403 rollback. Treat any ambiguous result as an immediate manual blocker.',
        '',
        '## If Checkout Or Payment Posture Is Wrong',
        '',
        '- Set `CHECKOUT_ENABLED_OVERRIDE=false` while leaving webhook and fulfillment reconciliation operational.',
        '- Reconcile Stripe dashboard, Supabase `payments`/`subscriptions` and webhook event rows using redacted references.',
        '- Rerun `pnpm launch:payments`, `pnpm launch:final-readiness`, this package and `pnpm launch:status`.',
        '',
        '## If Domain/Runtime Is Wrong',
        '',
        '- Do not repeat smoke until Cloudflare runtime/domain ownership is corrected.',
        '- Use the Cloudflare production runtime cutover package for any deploy/domain write approval.',
        '- Rerun live-domain read-only, SEO and final-readiness before a new smoke attempt.',
        '',
        '## If Email/Google Quota Or Permissions Fail',
        '',
        '- Stop the run and keep `final_smoke` pending.',
        '- Record provider/dashboard evidence without private payloads.',
        '- Fix quota/permission/configuration, then rerun only the scoped smoke after approval.',
        '',
        '## Reversal Of This Local Package',
        '',
        '- Remove `scripts/launch/final-smoke-execution-pack.ts`, the package script and related status/runbook/test/tracker references.',
        '- No service rollback is required because this package does not run final smoke, does not run staging rehearsal and does not write external services.',
        '',
        '## Current Package',
        '',
        `- Package status: ${reportToRender.status}`,
        `- Closure status: ${reportToRender.finalSmokeClosureStatus}`,
        `- Staging closure status: ${reportToRender.stagingSmokeClosureStatus}`,
        `- Final prerequisite blockers: ${reportToRender.finalPrerequisiteBlockers.join(', ') || 'none'}`,
        `- Manifest: ${toPosix(path.relative(process.cwd(), reportToRender.manifestPath))}`,
        '',
    ].join('\n')}\n`;
}

function renderManualEvidenceDryRun(reportToRender: FinalSmokeExecutionReport): string {
    const manifestPath = `../../${toPosix(path.relative(process.cwd(), reportToRender.manifestPath))}`;
    const approvalPath = `../../${toPosix(path.relative(process.cwd(), reportToRender.approvalRequestPath))}`;
    const preflightPath = `../../${toPosix(path.relative(process.cwd(), reportToRender.preflightChecklistPath))}`;
    const rollbackPath = `../../${toPosix(path.relative(process.cwd(), reportToRender.rollbackPlanPath))}`;
    const productionChecklistPath = `../../${toPosix(path.relative(process.cwd(), reportToRender.productionMinimalChecklistPath))}`;
    const finalSmokeWorksheet = reportToRender.latestFinalSmokeWorksheetPath
        ? `../../${reportToRender.latestFinalSmokeWorksheetPath}`
        : '../../outputs/launch-final-readiness/<timestamp>/final-smoke-worksheet.md';

    return `${[
        'corepack pnpm launch:manual-evidence:record --',
        '  --id final_smoke',
        '  --status pass',
        '  --summary "Production minimal manual smoke completed; exhaustive lifecycle remained staging-only."',
        '  --environment production',
        '  --owner Alin',
        `  --evidence "command_output=${manifestPath}::final smoke execution manifest reviewed before writes"`,
        `  --evidence "command_output=${approvalPath}::exact final smoke approval reviewed"`,
        `  --evidence "command_output=${preflightPath}::final smoke preflight checklist completed"`,
        `  --evidence "command_output=${rollbackPath}::rollback and cleanup plan reviewed"`,
        `  --evidence "command_output=${productionChecklistPath}::production minimal manual smoke checklist completed"`,
        `  --evidence "command_output=${finalSmokeWorksheet}::final smoke worksheet completed"`,
        '  --evidence "command_output=../../outputs/real-env-smoke/<staging-timestamp>/summary.md::successful staging-only lifecycle rehearsal attached as supporting integration evidence"',
        '  --evidence "manual_note=Replace with concrete non-secret production result: public/legal pages, existing-role login, provider health, checkout intended state and optional separately approved owned transaction passed."',
        '',
        '# Add --write only after replacing the placeholder note with real non-secret evidence and after the approved smoke actually runs.',
        '',
    ].join(' \\\n')}`;
}

function renderSummary(reportToRender: FinalSmokeExecutionReport): string {
    const lines = [
        '# Final Smoke Execution Pack Summary',
        '',
        `- Status: ${reportToRender.status}`,
        `- Final smoke closure status: ${reportToRender.finalSmokeClosureStatus}`,
        `- Staging closure status: ${reportToRender.stagingSmokeClosureStatus}`,
        `- Final prerequisite blockers: ${reportToRender.finalPrerequisiteBlockers.join(', ') || 'none'}`,
        `- Started: ${reportToRender.startedAt}`,
        `- Ended: ${reportToRender.endedAt}`,
        `- Manifest: ${toPosix(path.relative(process.cwd(), reportToRender.manifestPath))}`,
        `- Approval request: ${toPosix(path.relative(process.cwd(), reportToRender.approvalRequestPath))}`,
        `- Staging approval request: ${toPosix(path.relative(process.cwd(), reportToRender.stagingApprovalRequestPath))}`,
        `- Separate staging checkout gate approval: ${toPosix(path.relative(process.cwd(), reportToRender.stagingCheckoutGateApprovalPath))}`,
        `- Preflight checklist: ${toPosix(path.relative(process.cwd(), reportToRender.preflightChecklistPath))}`,
        `- Staging preflight checklist: ${toPosix(path.relative(process.cwd(), reportToRender.stagingPreflightChecklistPath))}`,
        `- Production minimal checklist: ${toPosix(path.relative(process.cwd(), reportToRender.productionMinimalChecklistPath))}`,
        `- Rollback plan: ${toPosix(path.relative(process.cwd(), reportToRender.rollbackPlanPath))}`,
        `- Manual evidence dry run: ${toPosix(path.relative(process.cwd(), reportToRender.manualEvidenceDryRunPath))}`,
        '',
        'This package does not run final smoke, does not run staging rehearsal and does not write external services. It prepares a fully gated staging-only lifecycle rehearsal, its separate Cloudflare checkout-gate approval, and a distinct minimal manual production smoke.',
        '',
        '| Status | Check | Message | Details |',
        '| --- | --- | --- | --- |',
    ];

    for (const check of reportToRender.checks) {
        lines.push(`| ${check.status} | ${check.name} | ${escapeCell(check.message)} | ${escapeCell(check.details.join(' / '))} |`);
    }

    lines.push('');
    return `${lines.join('\n')}\n`;
}

function latestGeneratedPath(folderName: string, fileName: string): string | null {
    const root = path.join(process.cwd(), 'outputs', folderName);
    if (!existsSync(root)) return null;

    const candidates = readdirSync(root, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => path.join(root, entry.name, fileName))
        .filter((candidate) => existsSync(candidate))
        .sort()
        .reverse();

    return candidates[0] ? toPosix(path.relative(process.cwd(), candidates[0])) : null;
}

function readIfExists(file: string): string {
    return existsSync(file) ? readFileSync(file, 'utf8') : '';
}

function readJsonIfExists<T>(file: string | null): T | null {
    if (!file || !existsSync(file)) return null;
    try {
        return JSON.parse(readFileSync(file, 'utf8')) as T;
    } catch {
        return null;
    }
}

function collectFinalPrerequisiteBlockers(statusSummary: {
    releaseCandidateReadiness?: {
        finalOnlyOpenChecks?: string[];
        strictQaOpenChecks?: string[];
    };
} | null): string[] {
    const finalOnly = statusSummary?.releaseCandidateReadiness?.finalOnlyOpenChecks ?? [];
    const strictQa = statusSummary?.releaseCandidateReadiness?.strictQaOpenChecks ?? [];
    return [...new Set([
        ...finalOnly.filter((check) => check !== 'final_smoke'),
        ...strictQa,
    ])].sort();
}

function fileMeta(filePath: string, contents: string) {
    return {
        path: toPosix(path.relative(process.cwd(), filePath)),
        sha256: sha256(contents),
        bytes: Buffer.byteLength(contents, 'utf8'),
    };
}

function statusFor(checkList: SmokePackCheck[]): ReportStatus {
    if (checkList.some((check) => check.status === 'failed')) return 'FAILED';
    if (checkList.some((check) => check.status === 'warning')) return 'WARNING';
    return 'OK';
}

function sha256(value: string): string {
    return createHash('sha256').update(value).digest('hex');
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
