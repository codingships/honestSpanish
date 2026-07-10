import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

type Status = 'ok' | 'warning' | 'failed';

interface Finding {
    status: Status;
    area: string;
    message: string;
    details?: string[];
}

interface PaymentsReport {
    schemaVersion: 1;
    startedAt: string;
    endedAt: string;
    status: 'OK' | 'WARNING' | 'FAILED';
    findings: Finding[];
    outputDir: string;
    paymentsStagingWorksheetPath: string;
}

const startedAt = new Date();
const outputDir = path.join(process.cwd(), 'outputs', 'launch-payments', stamp(startedAt));
mkdirSync(outputDir, { recursive: true });

const findings: Finding[] = [
    reviewCheckoutEndpoint(),
    reviewPortalEndpoint(),
    reviewStripeWebhookLifecycle(),
    reviewPackageCatalogAdmin(),
    reviewPublicPricingUi(),
    reviewNoRealPaymentsLaunchMode(),
    reviewPaymentSchema(),
    reviewPaymentTestsAndSmokes(),
    reviewPaymentDocumentation(),
];

const failed = findings.filter((finding) => finding.status === 'failed');
const warnings = findings.filter((finding) => finding.status === 'warning');
const status = failed.length > 0 ? 'FAILED' : warnings.length > 0 ? 'WARNING' : 'OK';
const paymentsStagingWorksheetPath = path.join(outputDir, 'payments-staging-worksheet.md');

const report: PaymentsReport = {
    schemaVersion: 1,
    startedAt: startedAt.toISOString(),
    endedAt: new Date().toISOString(),
    status,
    findings,
    outputDir,
    paymentsStagingWorksheetPath,
};

writeFileSync(path.join(outputDir, 'summary.json'), JSON.stringify(report, null, 2), 'utf8');
writeFileSync(path.join(outputDir, 'summary.md'), renderMarkdown(report), 'utf8');
writeFileSync(paymentsStagingWorksheetPath, renderPaymentsStagingWorksheet(report), 'utf8');

console.log(`[launch:payments] Status: ${status}`);
console.log(`[launch:payments] Failed: ${failed.length}`);
console.log(`[launch:payments] Warnings: ${warnings.length}`);
console.log(`[launch:payments] Summary: ${path.join(outputDir, 'summary.md')}`);
console.log(`[launch:payments] Payments worksheet: ${paymentsStagingWorksheetPath}`);

if (failed.length > 0) process.exit(1);

function reviewCheckoutEndpoint(): Finding {
    const file = path.join('src', 'pages', 'api', 'create-checkout.ts');
    const source = readIfExists(file);
    const details = [
        ...missingSnippets(file, source, [
            'createSupabaseServerClient',
            'isCheckoutEnabled(context)',
            'Checkout is disabled',
            'auth.getUser',
            'priceId is required',
            ".from('profiles')",
            ".from('subscriptions')",
            ".eq('student_id', user.id)",
            ".eq('status', 'active')",
            ".from('packages')",
            'isStripePriceId',
            'normalizeCheckoutLang',
            ".select('id, stripe_price_1m, stripe_price_3m, stripe_price_6m')",
            'activePackages?.find',
            ".eq('is_active', true)",
            'stripe.prices.retrieve(priceId)',
            '!stripePrice.active',
            '!stripePrice.recurring',
            'getPrivateProfile',
            'upsertPrivateProfile',
            'stripe.customers.create',
            'stripe.checkout.sessions.create',
            "mode: 'subscription'",
            'hasAcceptedCheckoutPolicies',
            'LEGAL_POLICY_VERSION',
            'getSiteUrl',
            'success_url',
            'cancel_url',
            "payment_method_types: ['card']",
            'allow_promotion_codes: false',
            'subscription_data',
            'metadata',
            'userId',
            'priceId',
            'lang',
        ]),
    ];

    if (/\.from\(['"]profiles['"]\)[\s\S]{0,900}stripe_customer_id/.test(source)) {
        details.push(`${file}: checkout appears to read or write stripe_customer_id through public profiles.`);
    }
    if (!/stripe\.prices\.retrieve\(\s*priceId\s*\)/.test(source)) {
        details.push(`${file}: priceId is not verified against Stripe before checkout creation.`);
    }
    if (/\.or\(\s*`/.test(source)) {
        details.push(`${file}: checkout builds a Supabase .or() filter with a template literal.`);
    }

    return {
        status: details.length === 0 ? 'ok' : 'failed',
        area: 'checkout endpoint',
        message: details.length === 0
            ? 'Checkout requires an authenticated user, prevents duplicate active subscriptions, validates Supabase and Stripe price state, and creates subscription-mode Checkout with metadata.'
            : 'Checkout endpoint is missing launch-critical payment invariants.',
        details,
    };
}

function reviewPortalEndpoint(): Finding {
    const file = path.join('src', 'pages', 'api', 'account', 'create-portal-session.ts');
    const source = readIfExists(file);
    const details = [
        ...missingSnippets(file, source, [
            'createSupabaseServerClient',
            'auth.getUser',
            'getPrivateProfile',
            'stripe.billingPortal.sessions.create',
            'getSiteUrl',
            'return_url',
            '/campus/account',
        ]),
    ];

    if (/headers\.get\(['"]Origin['"]\)/i.test(source)) {
        details.push(`${file}: portal return_url reads Origin header, which reopens open-redirect risk.`);
    }

    return {
        status: details.length === 0 ? 'ok' : 'failed',
        area: 'customer portal endpoint',
        message: details.length === 0
            ? 'Stripe Customer Portal requires authentication, uses the private Stripe customer store and returns to the configured site URL.'
            : 'Customer Portal endpoint is missing launch-critical invariants.',
        details,
    };
}

function reviewStripeWebhookLifecycle(): Finding {
    const file = path.join('src', 'pages', 'api', 'stripe-webhook.ts');
    const source = readIfExists(file);
    const details = [
        ...missingSnippets(file, source, [
            'createSupabaseAdminClient',
            "readRuntimeEnv('STRIPE_WEBHOOK_SECRET')",
            'request.text()',
            "headers.get('stripe-signature')",
            'stripe.webhooks.constructEvent',
            'processed_webhook_events',
            'event.id',
            'markWebhookEventProcessed',
            "error.code === '23505'",
            "markProcessed === 'failed'",
            'checkout.session.completed',
            'invoice.paid',
            'invoice.payment_failed',
            'invoice.upcoming',
            'charge.refunded',
            'customer.subscription.deleted',
            'customer.subscription.updated',
            'handleCheckoutCompleted',
            'handleInvoicePaid',
            'handleInvoicePaymentFailed',
            'handleInvoiceUpcoming',
            'handleSubscriptionDeleted',
            'handleSubscriptionUpdated',
            ".from('packages')",
            ".from('subscriptions')",
            ".from('payments')",
            'isStripePriceId',
            'enqueueWelcomeFulfillment',
            'enqueueRenewalNotice',
            'triggerFulfillmentProcessing',
            'findManagedSubscription',
            'mapStripeSubscriptionStatus',
        ]),
    ];

    if (!/switch\s*\(\s*event\.type\s*\)/.test(source)) {
        details.push(`${file}: webhook does not dispatch by event.type.`);
    }
    if (/request\.json\(\)/.test(source)) {
        details.push(`${file}: webhook parses JSON body; Stripe signature verification requires the raw body.`);
    }
    if (/\.or\(\s*`/.test(source)) {
        details.push(`${file}: webhook builds a Supabase .or() filter with a template literal.`);
    }

    const requiredEventsFile = path.join('src', 'lib', 'stripe-webhook-events.ts');
    details.push(...missingSnippets(requiredEventsFile, readIfExists(requiredEventsFile), [
        'REQUIRED_STRIPE_WEBHOOK_EVENTS',
        'invoice.upcoming',
        'customer.subscription.updated',
        'customer.subscription.deleted',
    ]));

    return {
        status: details.length === 0 ? 'ok' : 'failed',
        area: 'Stripe webhook lifecycle',
        message: details.length === 0
            ? 'Webhook verifies raw Stripe signatures, records idempotency, handles subscription lifecycle events, writes subscriptions/payments and enqueues welcome fulfillment.'
            : 'Stripe webhook lifecycle handling is incomplete.',
        details,
    };
}

function reviewPackageCatalogAdmin(): Finding {
    const file = path.join('src', 'pages', 'api', 'admin', 'packages.ts');
    const source = readIfExists(file);
    const details = [
        ...missingSnippets(file, source, [
            'requireAdmin',
            "profile?.role !== 'admin'",
            'checkout_ready',
            'ensureStripeProduct',
            'ensureStripePrice',
            'stripe.products.create',
            'stripe.prices.create',
            'stripe.prices.update',
            'priceChanged',
            'updateData.stripe_price_1m = null',
            'updateData.stripe_price_3m = null',
            'updateData.stripe_price_6m = null',
            'admin_audit_log',
            "action: 'package.update'",
            "action: 'package.create'",
            "action: 'package.stripe_sync'",
            'syncStripeSchema',
            'durations',
            '0.9',
            '0.8',
        ]),
    ];

    if (!/priceUpdates\[key\]\s*=\s*await\s+ensureStripePrice/.test(source)) {
        details.push(`${file}: sync_stripe does not write recurring Stripe Price IDs back to packages.`);
    }

    return {
        status: details.length === 0 ? 'ok' : 'failed',
        area: 'package catalog admin',
        message: details.length === 0
            ? 'Admin package CRM is admin-gated, audit-logged, computes checkout readiness, syncs immutable Stripe prices and clears stale Price IDs after price changes.'
            : 'Package catalog admin flow is missing launch-critical commerce controls.',
        details,
    };
}

function reviewPublicPricingUi(): Finding {
    const landingFile = path.join('src', 'components', 'LandingPage.astro');
    const landingDataFile = path.join('src', 'lib', 'landing-data.ts');
    const pricingFile = path.join('src', 'components', 'PricingSection.tsx');
    const modalFile = path.join('src', 'components', 'PricingModal.tsx');
    const landing = readIfExists(landingFile);
    const landingData = readIfExists(landingDataFile);
    const pricing = readIfExists(pricingFile);
    const modal = readIfExists(modalFile);
    const details = [
        ...missingSnippets(landingFile, landing, [
            'import type { LandingPackage }',
            'packages: LandingPackage[]',
            '<PricingSection',
            'packages={packages}',
        ]),
        ...missingSnippets(landingDataFile, landingData, [
            'createSupabaseServerClient',
            ".from('packages')",
            ".eq('is_active', true)",
            'stripe_price_1m',
            'stripe_price_3m',
            'stripe_price_6m',
            'normalizeDisplayName',
        ]),
        ...missingSnippets(pricingFile, pricing, [
            "checkoutMode?: 'application' | 'checkout'",
            "checkoutMode = 'application'",
            'checkoutReady',
            'checkoutEnabled',
            "checkoutMode === 'checkout' && checkoutReady",
            'requestApplication',
            "checkoutMode === 'application'",
            'stripe_price_1m && pkg.stripe_price_3m && pkg.stripe_price_6m',
            'disabled={!pkg}',
            'copy.modal.contact',
            'data-testid={`select-plan-${key}`}',
        ]),
        ...missingSnippets(modalFile, modal, [
            'getPriceId',
            "fetch('/api/create-checkout'",
            'priceId',
            'lang',
            'window.location.href',
            `/${'${lang}'}/login`,
        ]),
    ];

    return {
        status: details.length === 0 ? 'ok' : 'failed',
        area: 'public pricing UI',
        message: details.length === 0
            ? 'Public pricing reads active runtime packages, defaults to reviewed applications, and keeps Stripe checkout behind an explicit checkout mode.'
            : 'Public pricing UI is missing runtime catalog, application-first controls or explicit checkout readiness controls.',
        details,
    };
}

function reviewNoRealPaymentsLaunchMode(): Finding {
    const envExampleFile = '.env.example';
    const checkoutFile = path.join('src', 'pages', 'api', 'create-checkout.ts');
    const checkoutGateFile = path.join('src', 'lib', 'checkout-enabled.ts');
    const landingFile = path.join('src', 'components', 'LandingPage.astro');
    const segmentLandingFile = path.join('src', 'components', 'landing', 'SegmentLandingPage.astro');
    const pricingFile = path.join('src', 'components', 'PricingSection.tsx');
    const checkoutTestFile = path.join('tests', 'api', 'create-checkout.test.ts');
    const publicCheckoutTestFile = path.join('tests', 'e2e', 'checkout.public.spec.ts');
    const sequenceFile = path.join('docs', 'launch', 'LAUNCH_SEQUENCE.md');
    const finalClosureFile = path.join('docs', 'launch', 'FINAL_CLOSURE.md');
    const productsFile = path.join('docs', 'launch', 'PRODUCTS.md');

    const envExample = readIfExists(envExampleFile);
    const checkout = readIfExists(checkoutFile);
    const checkoutGate = readIfExists(checkoutGateFile);
    const landing = readIfExists(landingFile);
    const segmentLanding = readIfExists(segmentLandingFile);
    const pricing = readIfExists(pricingFile);
    const checkoutTest = readIfExists(checkoutTestFile);
    const publicCheckoutTest = readIfExists(publicCheckoutTestFile);
    const sequence = readIfExists(sequenceFile);
    const finalClosure = readIfExists(finalClosureFile);
    const products = readIfExists(productsFile);

    const details = [
        ...missingSnippets(envExampleFile, envExample, [
            'CHECKOUT_ENABLED=false',
        ]),
        ...missingSnippets(checkoutFile, checkout, [
            'isCheckoutEnabled(context)',
            'Checkout is disabled',
            'status: 403',
        ]),
        ...missingSnippets(checkoutGateFile, checkoutGate, [
            "readRuntimeEnv('CHECKOUT_ENABLED_OVERRIDE'",
            "readRuntimeEnv('CHECKOUT_ENABLED'",
            "override === 'true'",
        ]),
        ...missingSnippets(landingFile, landing, [
            'checkoutMode={checkoutMode}',
            "isCheckoutEnabled({ locals: Astro.locals }) ? 'checkout' : 'application'",
        ]),
        ...missingSnippets(segmentLandingFile, segmentLanding, [
            'checkoutMode={checkoutMode}',
            "isCheckoutEnabled({ locals: Astro.locals }) ? 'checkout' : 'application'",
        ]),
        ...missingSnippets(pricingFile, pricing, [
            "checkoutMode?: 'application' | 'checkout'",
            "checkoutMode = 'application'",
            "checkoutMode === 'application'",
            'requestApplication',
            "checkoutMode === 'checkout' && checkoutReady",
        ]),
        ...missingSnippets(checkoutTestFile, checkoutTest, [
            'fails closed before touching Supabase or Stripe when checkout is not explicitly enabled',
            'Checkout is disabled',
            'expect(response.status).toBe(403)',
            'expect(createSupabaseServerClient).not.toHaveBeenCalled()',
            'expect(stripeMock.checkout.sessions.create).not.toHaveBeenCalled()',
        ]),
        ...missingSnippets(publicCheckoutTestFile, publicCheckoutTest, [
            'Public pricing application flow',
            'clicking a public package CTA goes to the application form before checkout',
            '#contacto form',
        ]),
        ...missingSnippets(sequenceFile, sequence, [
            'checkout debe quedar desactivado, oculto o bloqueado',
            'sin pagos reales',
        ]),
        ...missingSnippets(finalClosureFile, finalClosure, [
            'Rollback sin nuevos cobros',
            '`CHECKOUT_ENABLED_OVERRIDE=false`',
        ]),
        ...missingSnippets(productsFile, products, [
            'CHECKOUT_ENABLED=false',
            'Mantener `CHECKOUT_ENABLED=false` para operar sin cobros reales',
        ]),
    ];

    return {
        status: details.length === 0 ? 'ok' : 'failed',
        area: 'no-real-payments launch mode',
        message: details.length === 0
            ? 'No-real-payments launch mode is explicit: public CTAs are application-first, checkout defaults disabled, and the API fails closed before Supabase or Stripe when CHECKOUT_ENABLED is not true.'
            : 'No-real-payments launch mode is not sufficiently guarded.',
        details,
    };
}

function reviewPaymentSchema(): Finding {
    const file = path.join('db', 'schema.sql');
    const schema = readIfExists(file);
    const details = [
        ...missingSnippets(file, schema, [
            'CREATE TABLE packages',
            'stripe_product_id TEXT',
            'stripe_price_1m TEXT',
            'stripe_price_3m TEXT',
            'stripe_price_6m TEXT',
            'CREATE TABLE subscriptions',
            'stripe_subscription_id TEXT',
            'stripe_invoice_id TEXT',
            'CREATE TABLE payments',
            'stripe_payment_intent_id TEXT',
            'amount_refunded INTEGER',
            'stripe_refund_id TEXT',
            'refunded_at TIMESTAMPTZ',
            'CREATE TABLE processed_webhook_events',
            'stripe_event_id TEXT PRIMARY KEY',
            'profiles_private_stripe_customer_unique',
            'subscriptions_one_active_per_student',
            'ALTER TABLE packages ENABLE ROW LEVEL SECURITY',
            'ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY',
            'ALTER TABLE processed_webhook_events ENABLE ROW LEVEL SECURITY',
        ]),
    ];

    return {
        status: details.length === 0 ? 'ok' : 'failed',
        area: 'payment database schema',
        message: details.length === 0
            ? 'Official schema stores package Price IDs, subscriptions, payments, webhook idempotency and active-subscription uniqueness.'
            : 'Payment database schema is missing launch-critical structures.',
        details,
    };
}

function reviewPaymentTestsAndSmokes(): Finding {
    const webhookTest = readIfExists(path.join('tests', 'api', 'stripe-webhook.test.ts'));
    const securityRegression = readIfExists(path.join('tests', 'api', 'security-regression.test.ts'));
    const queryConstructionTest = readIfExists(path.join('tests', 'unit', 'api-query-construction.test.ts'));
    const checkoutE2e = readIfExists(path.join('tests', 'e2e', 'checkout.public.spec.ts'));
    const checkoutSmoke = readIfExists(path.join('scripts', 'smoke-checkout.ts'));
    const realEnvSmoke = readIfExists(path.join('scripts', 'smoke', 'real-env-smoke.ts'));
    const details = [
        ...missingSnippets(path.join('tests', 'api', 'stripe-webhook.test.ts'), webhookTest, [
            'missing Stripe-Signature header',
            'webhook signature verification failure',
            'constructEvent',
        ]),
        ...missingSnippets(path.join('tests', 'api', 'security-regression.test.ts'), securityRegression, [
            'create-portal-session open redirect prevention',
            'getSiteUrl',
        ]),
        ...missingSnippets(path.join('tests', 'unit', 'api-query-construction.test.ts'), queryConstructionTest, [
            'does not build Supabase OR filters with template-literal user input',
            'src/pages/api',
        ]),
        ...missingSnippets(path.join('tests', 'e2e', 'checkout.public.spec.ts'), checkoutE2e, [
            'Public pricing application flow',
            '/es',
            '#contacto form',
            '[data-testid^="select-plan-"]',
        ]),
        ...missingSnippets(path.join('scripts', 'smoke-checkout.ts'), checkoutSmoke, [
            'createSmokeUser',
            'signInAndCreateCheckout',
            '/api/create-checkout',
            'https://checkout.stripe.com/',
            'deleteSmokeUser',
        ]),
        ...missingSnippets(path.join('scripts', 'smoke', 'real-env-smoke.ts'), realEnvSmoke, [
            'checkout',
            'webhook',
            'subscriptionsCreated',
            'paymentsCreated',
            '/api/create-checkout',
        ]),
    ];

    return {
        status: details.length === 0 ? 'ok' : 'failed',
        area: 'payment tests and live smoke hooks',
        message: details.length === 0
            ? 'Payment regression tests and live smoke scripts exist for signature, portal redirect, public application-first pricing, real checkout and webhook verification.'
            : 'Payment test or smoke coverage is missing.',
        details,
    };
}

function reviewPaymentDocumentation(): Finding {
    const productDoc = readIfExists(path.join('docs', 'launch', 'PRODUCTS.md'));
    const runbook = readIfExists(path.join('docs', 'launch', 'RUNBOOK.md'));
    const decisions = readIfExists(path.join('docs', 'launch', 'DECISIONS.md'));
    const envDoc = readIfExists(path.join('docs', 'launch', 'ENVIRONMENT.md'));
    const details = [
        ...missingSnippets(path.join('docs', 'launch', 'PRODUCTS.md'), productDoc, [
            'Fuente runtime: Supabase `packages`',
            'Stripe Price IDs son inmutables',
            'Si cambia el precio mensual, el CRM borra los Price IDs guardados',
            'Un paquete activo sin `stripe_price_1m`, `stripe_price_3m` y `stripe_price_6m` no esta listo para checkout',
            'CHECKOUT_ENABLED=false',
            'El plan `group` no incluye clases privadas',
            'Solo si hay compatibilidad de nivel, intereses y ritmo',
            'Repetir sincronizacion con Stripe live antes de pagos reales',
        ]),
        ...missingSnippets(path.join('docs', 'launch', 'RUNBOOK.md'), runbook, [
            'Pago completado sin suscripcion',
            'Paquete activo sin checkout',
            '/api/create-checkout` crea Stripe Checkout URL',
            'Stripe webhook encola fulfillment',
            'Compra test completa crea Drive/email',
        ]),
        ...missingSnippets(path.join('docs', 'launch', 'DECISIONS.md'), decisions, [
            'Supabase `packages` es la fuente runtime',
            'Stripe Price IDs historicos se mantienen trazables',
        ]),
        ...missingSnippets(path.join('docs', 'launch', 'ENVIRONMENT.md'), envDoc, [
            'STRIPE_SECRET_KEY',
            'STRIPE_WEBHOOK_SECRET',
            'PUBLIC_STRIPE_PUBLISHABLE_KEY',
            'CHECKOUT_ENABLED',
            'Los Price IDs viven en Supabase `packages`',
        ]),
    ];

    return {
        status: details.length === 0 ? 'ok' : 'failed',
        area: 'payment documentation',
        message: details.length === 0
            ? 'Product, runbook, decisions and environment docs describe Stripe/package ownership, checkout readiness and live payment smoke expectations.'
            : 'Payment launch documentation is incomplete.',
        details,
    };
}

function missingSnippets(file: string, content: string, snippets: string[]): string[] {
    return snippets
        .filter((snippet) => !content.includes(snippet))
        .map((snippet) => `${file}: missing ${snippet}.`);
}

function readIfExists(file: string): string {
    return existsSync(file) ? readFileSync(file, 'utf8') : '';
}

function renderMarkdown(report: PaymentsReport): string {
    const lines = [
        '# Launch Payments Audit',
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
        lines.push(`| ${finding.status} | ${escapeCell(finding.area)} | ${escapeCell(finding.message)} |`);
        if (finding.details?.length) {
            lines.push(`|  |  | ${escapeCell(finding.details.join(' / '))} |`);
        }
    }

    lines.push('');
    lines.push('## Scope');
    lines.push('');
    lines.push('This automated audit checks launch-critical static payment invariants for checkout, no-real-payments launch mode, Stripe webhooks, customer portal, product catalog, schema, tests and documentation. It does not replace a live Stripe test-mode purchase, webhook delivery from Stripe, Customer Portal smoke, subscription/payment reconciliation in Supabase, live-mode Price ID validation, fraud/risk configuration review, refund testing, tax/VAT review or bank/payout readiness.');
    lines.push('');

    return `${lines.join('\n')}\n`;
}

function renderPaymentsStagingWorksheet(report: PaymentsReport): string {
    const lines = [
        '# Payments Staging Worksheet',
        '',
        `- Status: ${report.status}`,
        `- Generated: ${report.endedAt}`,
        `- Output: ${report.outputDir}`,
        '',
        '## Rule',
        '',
        'Use this worksheet while filling `payments_staging` in `docs/launch/MANUAL_EVIDENCE.local.json`. Keep Stripe in test mode unless Alin explicitly decides otherwise. Do not paste secret keys, webhook secrets, full card data, full customer data, payment method details, live event payloads or unredacted dashboard URLs with tokens.',
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
    lines.push('| Stripe test mode | Confirm the staging checkout uses Stripe test mode, test Price IDs and staging URLs. | `dashboard` or `manual_note` with test-mode confirmation; no keys. |');
    lines.push('| Stripe evidence source | If the Codex Stripe connector cannot list products/prices, use the Stripe dashboard and real checkout/webhook evidence as the source of truth. Do not block closure on MCP list output alone. | `dashboard`, `url` to a Stripe test event, or `manual_note`; no keys or payloads. |');
    lines.push('| no-real-payments launch mode | If launching without real payments, confirm public CTAs remain application-first, `CHECKOUT_ENABLED=false` in the intended environment, and `/api/create-checkout` returns 403 before Supabase or Stripe. | `command_output` from `pnpm launch:payments` plus `manual_note` with environment and checkout posture; no secret values. |');
    lines.push('| checkout | Complete a staging purchase with a Stripe test card and a test user. | `manual_note` with timestamp, test user alias and result; no card data. |');
    lines.push('| webhook delivery | Confirm Stripe delivered `checkout.session.completed` and subscription/invoice events to the staging webhook. | `url` to Stripe test event or `dashboard`; no secret payloads. |');
    lines.push('| subscriptions | Confirm Supabase `subscriptions` has the expected active/test subscription state for the test student. | `dashboard` or `manual_note`; no private student data. |');
    lines.push('| payments | Confirm Supabase `payments` reflects the expected Stripe invoice/payment state and amount. | `dashboard` or `manual_note`; no full payment method data. |');
    lines.push('| portal | Confirm the authenticated test user can open Stripe Customer Portal and returns to the configured campus URL. | `manual_note` or redacted `screenshot`. |');
    lines.push('| reconciliation | Compare Stripe event/subscription/invoice with Supabase rows and package quota state. | `manual_note` with IDs shortened/redacted. |');
    lines.push('| failure/rollback | Confirm failed payment handling, package inactive fallback or rollback path in `docs/launch/RUNBOOK.md`. | `path` to runbook plus `manual_note`. |');
    lines.push('');
    lines.push('## Completion');
    lines.push('');
    lines.push('Mark `payments_staging` as `pass` only after either a real Stripe test-mode staging purchase, webhook delivery, Supabase reconciliation and portal smoke are verified, or Alin explicitly chooses a no-real-payments launch and records that checkout is disabled, hidden or blocked for the intended environment. `pnpm launch:payments` proves static payment safeguards; it does not prove hosted Stripe delivery or environment configuration by itself.');
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

function stamp(date: Date): string {
    return date.toISOString().replace(/[:.]/g, '-');
}

function escapeCell(value: string): string {
    return value.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}
