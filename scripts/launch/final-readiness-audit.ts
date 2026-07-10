import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

type Status = 'ok' | 'warning' | 'failed';

interface Finding {
    status: Status;
    area: string;
    message: string;
    details?: string[];
}

interface FinalReadinessReport {
    schemaVersion: 1;
    startedAt: string;
    endedAt: string;
    status: 'OK' | 'WARNING' | 'FAILED';
    findings: Finding[];
    outputDir: string;
    integrationReadinessWorksheetPath: string;
    finalSmokeWorksheetPath: string;
}

const startedAt = new Date();
const outputDir = path.join(process.cwd(), 'outputs', 'launch-final-readiness', stamp(startedAt));
mkdirSync(outputDir, { recursive: true });

const findings: Finding[] = [
    reviewIntegrationEnvironmentCoverage(),
    reviewIntegrationRuntimeHooks(),
    reviewFinalSmokeHooks(),
    reviewLaunchSequenceAndRunbook(),
    reviewManualEvidenceRunbookCoverage(),
];

const failed = findings.filter((finding) => finding.status === 'failed');
const warnings = findings.filter((finding) => finding.status === 'warning');
const status = failed.length > 0 ? 'FAILED' : warnings.length > 0 ? 'WARNING' : 'OK';
const integrationReadinessWorksheetPath = path.join(outputDir, 'integration-readiness-worksheet.md');
const finalSmokeWorksheetPath = path.join(outputDir, 'final-smoke-worksheet.md');

const report: FinalReadinessReport = {
    schemaVersion: 1,
    startedAt: startedAt.toISOString(),
    endedAt: new Date().toISOString(),
    status,
    findings,
    outputDir,
    integrationReadinessWorksheetPath,
    finalSmokeWorksheetPath,
};

writeFileSync(path.join(outputDir, 'summary.json'), JSON.stringify(report, null, 2), 'utf8');
writeFileSync(path.join(outputDir, 'summary.md'), renderMarkdown(report), 'utf8');
writeFileSync(integrationReadinessWorksheetPath, renderIntegrationReadinessWorksheet(report), 'utf8');
writeFileSync(finalSmokeWorksheetPath, renderFinalSmokeWorksheet(report), 'utf8');

console.log(`[launch:final-readiness] Status: ${status}`);
console.log(`[launch:final-readiness] Failed: ${failed.length}`);
console.log(`[launch:final-readiness] Warnings: ${warnings.length}`);
console.log(`[launch:final-readiness] Summary: ${path.join(outputDir, 'summary.md')}`);
console.log(`[launch:final-readiness] Integration worksheet: ${integrationReadinessWorksheetPath}`);
console.log(`[launch:final-readiness] Final smoke worksheet: ${finalSmokeWorksheetPath}`);

if (failed.length > 0) process.exit(1);

function reviewIntegrationEnvironmentCoverage(): Finding {
    const envExample = readIfExists('.env.example');
    const environmentDoc = readIfExists(path.join('docs', 'launch', 'ENVIRONMENT.md'));
    const productsDoc = readIfExists(path.join('docs', 'launch', 'PRODUCTS.md'));
    const details = [
        ...missingSnippets('.env.example', envExample, [
            'PUBLIC_SITE_URL',
            'PUBLIC_APP_ENV',
            'STRIPE_SECRET_KEY',
            'STRIPE_WEBHOOK_SECRET',
            'STRIPE_EXPECTED_ACCOUNT_ID',
            'STRIPE_PORTAL_CONFIGURATION_ID',
            'SUPABASE_EXPECTED_PROJECT_REF',
            'PUBLIC_STRIPE_PUBLISHABLE_KEY',
            'FULFILLMENT_WORKER_URL',
            'INTERNAL_JOB_SECRET',
            'GOOGLE_SERVICE_ACCOUNT_EMAIL',
            'GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY',
            'GOOGLE_ADMIN_EMAIL',
            'GOOGLE_DRIVE_ROOT_FOLDER_ID',
            'GOOGLE_TEMPLATE_DOC_ID',
            'RESEND_API_KEY',
            'EMAIL_FROM',
            'PUBLIC_TURNSTILE_SITE_KEY',
            'TURNSTILE_SECRET_KEY',
            'CRON_SECRET',
        ]),
        ...missingSnippets(path.join('docs', 'launch', 'ENVIRONMENT.md'), environmentDoc, [
            'Staging: Sandbox general dedicado `espanolhonesto-staging`',
            'Production: live mode',
            '`CHECKOUT_ENABLED_OVERRIDE=true` es el interruptor final',
            'Webhook secret diferente por entorno.',
            'pnpm google:setup-staging',
            'Staging y production deben tener carpetas y templates diferenciados.',
            'debe ser igual en Cloudflare Astro Worker y Cloudflare Fulfillment Worker',
            'DEMO_GUIDE_ENABLED=false',
        ]),
        ...missingSnippets(path.join('docs', 'launch', 'PRODUCTS.md'), productsDoc, [
            'Repetir sincronizacion con Stripe live antes de pagos reales',
            'Registrar evidencia de `payments_staging` antes de activar pagos reales',
            '`integration_readiness`',
        ]),
    ];

    return {
        status: details.length === 0 ? 'ok' : 'failed',
        area: 'integration environment coverage',
        message: details.length === 0
            ? 'Environment and product docs cover final integration variables, test/live Stripe separation, Google setup and final payment-posture evidence.'
            : 'Final integration environment documentation is incomplete.',
        details,
    };
}

function reviewIntegrationRuntimeHooks(): Finding {
    const details = [
        ...missingSnippets(path.join('src', 'pages', 'api', 'stripe-webhook.ts'), readIfExists(path.join('src', 'pages', 'api', 'stripe-webhook.ts')), [
            "readRuntimeEnv('STRIPE_WEBHOOK_SECRET')",
            'stripe.webhooks.constructEvent',
            'processed_webhook_events',
            'checkout.session.completed',
            'invoice.paid',
            'invoice.payment_failed',
            'charge.refunded',
            'customer.subscription.deleted',
        ]),
        ...missingSnippets(path.join('src', 'pages', 'api', 'create-checkout.ts'), readIfExists(path.join('src', 'pages', 'api', 'create-checkout.ts')), [
            'stripe.prices.retrieve(priceId)',
            'stripe.checkout.sessions.create',
            "mode: 'subscription'",
        ]),
        ...missingSnippets(path.join('src', 'pages', 'api', 'subscribe.ts'), readIfExists(path.join('src', 'pages', 'api', 'subscribe.ts')), [
            "readRuntimeEnv('TURNSTILE_SECRET_KEY')",
            'https://challenges.cloudflare.com/turnstile/v0/siteverify',
            'turnstileData.success',
        ]),
        ...missingSnippets(path.join('src', 'components', 'LeadCaptureForm.tsx'), readIfExists(path.join('src', 'components', 'LeadCaptureForm.tsx')), [
            'Turnstile',
            'PUBLIC_TURNSTILE_SITE_KEY',
            "'cf-turnstile-response'",
        ]),
        ...missingSnippets(path.join('src', 'pages', 'api', 'cron', 'send-reminders.ts'), readIfExists(path.join('src', 'pages', 'api', 'cron', 'send-reminders.ts')), [
            'CRON_SECRET',
            'Authorization',
            'Bearer',
            'sendDueReminders',
        ]),
        ...missingSnippets(path.join('src', 'lib', 'internal-job-service.ts'), readIfExists(path.join('src', 'lib', 'internal-job-service.ts')), [
            'FULFILLMENT_SERVICE',
            'FULFILLMENT_WORKER_URL',
            'INTERNAL_JOB_SECRET',
            'sendDueReminders',
            '/internal/reminders/send',
        ]),
        ...missingSnippets('wrangler.toml', readIfExists('wrangler.toml'), [
            '[[env.staging.services]]',
            'service = "espanol-honesto-fulfillment-staging"',
            '[[env.production.services]]',
            'service = "espanol-honesto-fulfillment-production"',
        ]),
        ...missingSnippets(path.join('workers', 'fulfillment', 'src', 'index.ts'), readIfExists(path.join('workers', 'fulfillment', 'src', 'index.ts')), [
            'INTERNAL_JOB_SECRET',
            'isAuthorized',
            '/internal/reminders/send',
            'sendClassReminder',
            'reminder_sent',
        ]),
        ...missingSnippets(path.join('src', 'lib', 'email', 'client.ts'), readIfExists(path.join('src', 'lib', 'email', 'client.ts')), [
            'RESEND_API_KEY',
            'RESEND_FROM_EMAIL',
            'EMAIL_FROM',
        ]),
        ...missingSnippets(path.join('workers', 'fulfillment', 'wrangler.toml'), readIfExists(path.join('workers', 'fulfillment', 'wrangler.toml')), [
            'espanol-honesto-fulfillment-staging',
            'espanol-honesto-fulfillment-production',
            'nodejs_compat',
        ]),
        ...missingSnippets(path.join('workers', 'fulfillment', 'package.json'), readIfExists(path.join('workers', 'fulfillment', 'package.json')), [
            '@googleapis/drive',
            'resend',
            'wrangler deploy',
        ]),
    ];

    return {
        status: details.length === 0 ? 'ok' : 'failed',
        area: 'integration runtime hooks',
        message: details.length === 0
            ? 'Runtime hooks exist for Stripe checkout/webhook, Turnstile, fulfillment Worker delegation, reminders, Resend and Google environment wiring.'
            : 'Final integration runtime hooks are incomplete.',
        details,
    };
}

function reviewFinalSmokeHooks(): Finding {
    const realEnvSmoke = readIfExists(path.join('scripts', 'smoke', 'real-env-smoke.ts'));
    const checkoutSmoke = readIfExists(path.join('scripts', 'smoke-checkout.ts'));
    const adminJobsApi = readIfExists(path.join('src', 'pages', 'api', 'admin', 'fulfillment-jobs.ts'));
    const adminJobsUi = readIfExists(path.join('src', 'components', 'admin', 'FulfillmentJobsManager.tsx'));
    const details = [
        ...missingSnippets(path.join('scripts', 'smoke', 'real-env-smoke.ts'), realEnvSmoke, [
            'runReadOnlyPreflight',
            '--preflight-only',
            'assertExactSmokeEmailAllowlist',
            'authUsersCreated: 0',
            'createSessionCookieHeader',
            '/api/create-checkout',
            'SMOKE_COMPLETED_CHECKOUT_SESSION_ID',
            'verifyCompletedCheckoutEvidence',
            'SMOKE_BILLING_LIFECYCLE_MANUAL_CONFIRMATION',
            'synthetic webhook payloads are forbidden',
            '/api/google/create-student-folder',
            'runSchedulingLifecycleSmoke',
            'cancelStatus',
            '/internal/reminders/send-exact',
            'SMOKE-REMINDER-',
            'INTERNAL_JOB_SECRET',
            'reminderAuthorizedStatus',
            'reminderMarkedSent',
            'calendarEventExistsBeforeCancel',
            'completedReportStored',
            'writeSmokeEvidence',
            "path.join(process.cwd(), 'outputs', 'real-env-smoke'",
            'summary.json',
            'summary.md',
            'runAdminJobsRecoverySmoke',
            '/es/campus/admin/jobs',
            '/api/admin/fulfillment-jobs?status=failed&limit=100',
            "body: { action: 'retry', jobId: insertedJob.id }",
            "body: { action: 'cancel', jobId: insertedJob.id }",
            'waitForAdminJobAudit',
            'fulfillment_job.retry',
            'fulfillment_job.cancel',
            'adminJobs.ok',
            'deleteSmokeCheckoutArtifacts',
            'cleanupSchedulingSmokeArtifacts',
            'deleteSmokeFulfillmentJobArtifacts',
        ]),
        ...missingSnippets(path.join('scripts', 'smoke-checkout.ts'), checkoutSmoke, [
            'getExistingSmokeUser',
            'signInForCheckout',
            'createCheckout',
            '/api/create-checkout',
            'https://checkout.stripe.com/',
            "requireEnv('SMOKE_EXTERNAL_WRITES_CONFIRMATION')",
            ".from('packages')",
            'package_prices (',
            'getCheckoutReadyPackageOffers',
            'isPackageKeyCheckoutEligible',
            ".from('checkout_intents')",
            'withdrawalLossAcknowledged: true',
            'closeSmokeCheckout',
            'probeCheckoutGateEnabledReadOnly',
        ]),
        ...missingSnippets(path.join('src', 'pages', 'api', 'admin', 'fulfillment-jobs.ts'), adminJobsApi, [
            "z.literal('retry')",
            "z.literal('cancel')",
            "z.literal('process_due')",
            'admin_audit_log',
        ]),
        ...missingSnippets(path.join('src', 'components', 'admin', 'FulfillmentJobsManager.tsx'), adminJobsUi, [
            'retry',
            'cancel',
            'process_due',
            '/api/admin/fulfillment-jobs',
        ]),
    ];

    return {
        status: details.length === 0 ? 'ok' : 'failed',
        area: 'final smoke hooks',
        message: details.length === 0
            ? 'Final smoke support exists for auth, checkout, webhook, Drive, billing lifecycle, scheduling, reminders, cancellation and admin job retry/recovery.'
            : 'Final smoke support hooks are incomplete.',
        details,
    };
}

function reviewLaunchSequenceAndRunbook(): Finding {
    const sequence = readIfExists(path.join('docs', 'launch', 'LAUNCH_SEQUENCE.md'));
    const runbook = readIfExists(path.join('docs', 'launch', 'RUNBOOK.md'));
    const checklist = readIfExists(path.join('docs', 'launch', 'CHECKLIST.md'));
    const details = [
        ...missingSnippets(path.join('docs', 'launch', 'LAUNCH_SEQUENCE.md'), sequence, [
            'Stripe live:',
            'Verificar Cloudflare Astro Worker, Cloudflare Fulfillment Worker, Supabase, Google, Resend, Turnstile, Sentry y cron',
            'Ejecutar smoke final: registro 18+, checkout con aceptaciones, webhook, confirmacion contractual, Drive, email, reserva, Doc, Calendar/Meet, recordatorio, cancelacion, reembolso/reconciliacion y retry de job.',
            '`integration_readiness`',
            '`final_smoke`',
        ]),
        ...missingSnippets(path.join('docs', 'launch', 'RUNBOOK.md'), runbook, [
            'Launch sin pagos reales',
            'Mantener Stripe en test hasta completar `payments_staging` e `integration_readiness`.',
            'Compra test completa crea Drive/email',
            'Reserva test crea Doc/Meet/email',
            'Recordatorio test marca `reminder_sent`',
            'Admin > Jobs ve y procesa jobs',
            'Rollback',
        ]),
        ...missingSnippets(path.join('docs', 'launch', 'CHECKLIST.md'), checklist, [
            'Integrations readiness',
            'Final smoke',
            'integration_readiness',
            'final_smoke',
            'Stripe live production en la ventana final',
            'pagos reales desde el primer dia',
            'Cloudflare Fulfillment Worker con service binding privado `FULFILLMENT_SERVICE`, `FULFILLMENT_WORKER_URL`, `PUBLIC_SITE_URL`, `INTERNAL_JOB_SECRET` y `CRON_SECRET`',
        ]),
    ];

    return {
        status: details.length === 0 ? 'ok' : 'failed',
        area: 'launch sequence and runbook final readiness',
        message: details.length === 0
            ? 'Launch sequence, runbook and checklist keep integrations and final smoke explicit final blockers.'
            : 'Launch sequence or runbook does not fully preserve final integration/smoke blockers.',
        details,
    };
}

function reviewManualEvidenceRunbookCoverage(): Finding {
    const manualEvidence = readIfExists(path.join('docs', 'launch', 'MANUAL_EVIDENCE.md'));
    const manualRunbook = readIfExists(path.join('docs', 'launch', 'MANUAL_EVIDENCE_RUNBOOK.md'));
    const manualAudit = readIfExists(path.join('scripts', 'launch', 'manual-evidence-audit.ts'));
    const details = [
        ...missingSnippets(path.join('docs', 'launch', 'MANUAL_EVIDENCE.md'), manualEvidence, [
            '`integration_readiness`',
            '`final_smoke`',
            'Stripe test ensayado y Stripe live preparado para pagos reales desde el primer dia',
            'El ciclo integral (Checkout real test, webhook, Drive, email, reserva, Doc, Calendar/Meet, recordatorio, cancelacion y retry) se demuestra en staging',
            'No ejecutar el arnes staging en production ni fabricar eventos Stripe.',
        ]),
        ...missingSnippets(path.join('docs', 'launch', 'MANUAL_EVIDENCE_RUNBOOK.md'), manualRunbook, [
            '## integration_readiness',
            '## final_smoke',
            'Revisar la ruta ya decidida',
            'Revisar Google Drive root folder, template doc y admin account.',
            'Revisar Resend sender/domain.',
            'Revisar Turnstile domains.',
            'Revisar fulfillment/reminder worker',
            'espanol-honesto-reminders',
            'Si el conector Stripe no permite listar productos/precios',
            'Verificar retry/cancel de job fallido.',
        ]),
        ...missingSnippets(path.join('scripts', 'launch', 'manual-evidence-audit.ts'), manualAudit, [
            'integration_readiness',
            'Stripe test rehearsal and Stripe live readiness for real payments from day one',
            'final_smoke',
            'Registration, checkout, webhook, Drive, email, booking, Doc, Calendar/Meet, reminder, cancellation and retry are verified end-to-end.',
        ]),
    ];

    return {
        status: details.length === 0 ? 'ok' : 'failed',
        area: 'manual evidence final readiness coverage',
        message: details.length === 0
            ? 'Manual evidence docs and audit preserve integration_readiness and final_smoke as required launch blockers.'
            : 'Manual evidence final readiness coverage is incomplete.',
        details,
    };
}

function renderMarkdown(report: FinalReadinessReport): string {
    const lines = [
        '# Launch Final Readiness Audit',
        '',
        `- Status: ${report.status}`,
        `- Started: ${report.startedAt}`,
        `- Ended: ${report.endedAt}`,
        `- Output: ${report.outputDir}`,
        `- Integration worksheet: ${report.integrationReadinessWorksheetPath}`,
        `- Final smoke worksheet: ${report.finalSmokeWorksheetPath}`,
        '',
        '| Status | Area | Message |',
        '| --- | --- | --- |',
    ];

    appendFindingsTable(lines, report.findings);

    lines.push('');
    lines.push('## Scope');
    lines.push('');
    lines.push('This audit checks that final integration readiness and final smoke are explicit, documented and supported by runtime hooks. It does not activate Stripe live, rotate API keys, call external dashboards, run production smoke or replace Alin final signoff.');
    lines.push('');

    return `${lines.join('\n')}\n`;
}

function renderIntegrationReadinessWorksheet(report: FinalReadinessReport): string {
    const lines = [
        '# Integration Readiness Worksheet',
        '',
        `- Status: ${report.status}`,
        `- Generated: ${report.endedAt}`,
        `- Output: ${report.outputDir}`,
        '',
        '## Rule',
        '',
        'Use this worksheet while filling `integration_readiness` in `docs/launch/MANUAL_EVIDENCE.local.json`. Keep Stripe live disabled unless Alin explicitly decides to accept real payments. Do not paste API keys, webhook secrets, private keys, dashboard tokens, database URLs with passwords, Bearer headers or unredacted customer data.',
        '',
        '## Automated Coverage',
        '',
        '| Status | Area | Message |',
        '| --- | --- | --- |',
    ];

    appendFindingsTable(lines, report.findings);

    lines.push('');
    lines.push('## Manual Checks');
    lines.push('');
    lines.push('| Check | How To Verify | Evidence To Record |');
    lines.push('| --- | --- | --- |');
    lines.push('| Payment posture | Confirm the selected posture: no-checkout blocked/disabled by config or package data, Stripe test mode for final rehearsal, or Stripe live mode with live Price IDs, webhook endpoint, webhook secret, Customer Portal, fraud/risk settings and tax/VAT decision before accepting real payments. | `dashboard` or `manual_note`; no keys, payloads or full customer/payment data. |');
    lines.push('| Cloudflare production domain/runtime | Review `outputs/019f1a5e-2745-7c43-870d-544e6ba4e0b1/strict-qa-v2/cloudflare-domain-worker-preflight.md`; run `pnpm launch:cloudflare-production-runtime-readonly`; confirm Pages project `espanolhonesto` no longer serves the final custom domains unless that is the deliberate final runtime, production Worker `espanolhonesto` exists if using Workers, required Worker secret names are present, the direct Worker URL passes non-destructive probes, and `espanolhonesto.com` / `www.espanolhonesto.com` are moved only after separate explicit approval. | `command_output`, `dashboard`, `manual_note` or redacted `screenshot`; no secret values. |');
    lines.push('| Google Drive | Confirm production root folder, template doc, service account, delegated admin and permissions are correct. | `dashboard` or `manual_note` with IDs shortened/redacted. |');
    lines.push('| Google Calendar/Meet | Confirm calendar access, Meet creation, teacher/admin impersonation and cancellation permissions. | `dashboard` or `manual_note`. |');
    lines.push('| Resend | Confirm sender/domain, DNS records, delivery visibility, bounce/suppression handling and support reply route. | `dashboard`, redacted `screenshot` or `manual_note`. |');
    lines.push('| Turnstile | Confirm production and staging domains, site key/secret per environment and lead form enforcement. Use `pnpm launch:turnstile-readonly -- --env-file <env-file>` only as runtime support; widget/domain closure still needs Cloudflare dashboard/API evidence. | `dashboard`, redacted `screenshot`, `manual_note` or `command_output`; no secret values. |');
    lines.push('| fulfillment/reminder worker | Confirm the production scheduled trigger, Cloudflare Worker `/internal/reminders/send`, staging-only `/internal/reminders/send-exact`, `INTERNAL_JOB_SECRET`, `FULFILLMENT_WORKER_URL` and `PUBLIC_SITE_URL` align by environment. The smoke must call only the exact route. | `dashboard`, `path` or `manual_note`. |');
    lines.push('| Cloudflare legacy Workers | Confirm no legacy Worker with cron can interfere with `workers/fulfillment`. Preflight found `espanol-honesto-reminders`; decide to disable/delete it in a controlled window or document why it is non-interfering. | `dashboard` or `manual_note` with resource name, decision and rollback path. |');
    lines.push('| Stripe evidence source | If the Codex Stripe connector cannot list products/prices, use Stripe dashboard, checkout test/live evidence, webhook delivery and Supabase reconciliation instead of MCP output. | `dashboard`, `url` to Stripe event, or `manual_note`; no keys or payloads. |');
    lines.push('| final key rotation | Confirm API keys and webhook secrets have been rotated after launch preparation and stored in KeePassXC/dashboard systems. | `manual_note` with systems and dates; never key values. |');
    lines.push('');
    lines.push('## Completion');
    lines.push('');
    lines.push('Mark `integration_readiness` as `pass` only when real dashboards and environment configuration have been checked directly. For Cloudflare, that means the final custom-domain owner, production Worker existence, Worker secret-name posture and direct Worker/domain probes are all verified or explicitly risk-accepted. `pnpm launch:final-readiness` proves the project has a review path; it does not prove external services are ready.');
    lines.push('');

    return `${lines.join('\n')}\n`;
}

function renderFinalSmokeWorksheet(report: FinalReadinessReport): string {
    const lines = [
        '# Final Smoke Worksheet',
        '',
        `- Status: ${report.status}`,
        `- Generated: ${report.endedAt}`,
        `- Output: ${report.outputDir}`,
        '',
        '## Rule',
        '',
        'Use this worksheet while filling `final_smoke` in `docs/launch/MANUAL_EVIDENCE.local.json`. The exhaustive technical lifecycle harness is staging-only; Production uses a separate minimal manual smoke at the final launch decision. Do not paste secrets, full user records, payment/card details, webhook payloads, private Drive URLs with sensitive data or unredacted screenshots.',
        '',
        '## Supporting Commands',
        '',
        '- `pnpm launch:gate`: required before READY.',
        '- `pnpm launch:status`: consolidated blocker dashboard.',
        '- `pnpm launch:final-smoke-execution-pack`: local-only approval, preflight, rollback and evidence package; it separates the staging-only technical lifecycle harness from production minimal manual smoke and performs no writes.',
        '- `pnpm launch:staging-smoke-rehearsal-runner`: the only path to `scripts/smoke/real-env-smoke.ts`; it validates every precondition read-only before starting writes and must never target production.',
        '- `pnpm exec tsx scripts/smoke-checkout.ts`: narrower checkout smoke, also environment-dependent.',
        '',
        '## Manual Checks',
        '',
        '| Check | How To Verify | Evidence To Record |',
        '| --- | --- | --- |',
        '| registration | Create or verify a launch smoke student account. | `manual_note` with alias and environment. |',
    ];
    lines.push('| checkout | If payments are enabled, create a Checkout session and complete the expected flow. If not, confirm checkout is unavailable as intended. | `manual_note`, `command_output` or dashboard reference; no card data. |');
    lines.push('| webhook | Confirm Stripe webhook delivery, idempotency and side effects in Supabase. | `dashboard` or redacted `manual_note`. |');
    lines.push('| Drive | Confirm welcome folder or student folder is created and accessible under the correct root. | `dashboard` or `manual_note`; IDs redacted/shortened. |');
    lines.push('| email | Confirm welcome/session/reminder/cancelled email delivery or expected suppression in staging. | `dashboard`, redacted `screenshot` or `manual_note`. |');
    lines.push('| booking | Create a session from campus/admin/teacher flow with the smoke account. | `manual_note` with route and timestamp. |');
    lines.push('| Doc | Confirm class Doc is created from the configured template. | `dashboard` or `manual_note`. |');
    lines.push('| Calendar/Meet | Confirm Calendar event and Meet link are created and visible to the expected parties. | `dashboard` or `manual_note`. |');
    lines.push('| reminder | Trigger only staging `/internal/reminders/send-exact` for the smoke-owned session and confirm `reminder_sent`; do not drain the general cron/job queue. | `command_output`, `dashboard` or `manual_note`. |');
    lines.push('| cancellation | Cancel a smoke session and confirm status, Calendar cleanup and cancellation email behavior. | `manual_note` or `command_output`. |');
    lines.push('| retry | Create or identify a failed `fulfillment_jobs` item, retry from Admin > Jobs and confirm recovery/audit log. | `dashboard` or `manual_note`. |');
    lines.push('| production minimal manual smoke | On launch day, complete `production-minimal-smoke-checklist.md`: public/legal surfaces, existing-role login, provider health and intended checkout state; do not repeat the staging lifecycle matrix. | `manual_note` with timestamp, owner and result. |');
    lines.push('');
    lines.push('## Completion');
    lines.push('');
    lines.push('Mark `final_smoke` as `pass` only when registration, checkout policy, webhook, Drive, email, booking, Doc, Calendar/Meet, reminder, cancellation and retry are proven in staging with bounded cleanup, and the separate production minimal manual smoke passes on launch day. Attach both evidence paths; never use the staging harness against production.');
    lines.push('');

    return `${lines.join('\n')}\n`;
}

function appendFindingsTable(lines: string[], findings: Finding[]): void {
    for (const finding of findings) {
        lines.push(`| ${finding.status} | ${escapeCell(finding.area)} | ${escapeCell(finding.message)} |`);
        if (finding.details?.length) {
            lines.push(`|  |  | ${escapeCell(finding.details.join(' / '))} |`);
        }
    }
}

function missingSnippets(file: string, content: string, snippets: string[]): string[] {
    return snippets
        .filter((snippet) => !content.includes(snippet))
        .map((snippet) => `${file}: missing ${snippet}.`);
}

function readIfExists(file: string): string {
    return existsSync(file) ? readFileSync(file, 'utf8') : '';
}

function stamp(date: Date): string {
    return date.toISOString().replace(/[:.]/g, '-');
}

function escapeCell(value: string): string {
    return value.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}
