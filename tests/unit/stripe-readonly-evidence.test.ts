import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync('scripts/launch/stripe-readonly-evidence.ts', 'utf8');
const webhookEvents = readFileSync('src/lib/stripe-webhook-events.ts', 'utf8');
const cutoverPack = readFileSync('scripts/launch/stripe-webhook-cutover-pack.ts', 'utf8');
const packageJson = readFileSync('package.json', 'utf8');
const envExample = readFileSync('.env.example', 'utf8');
const environmentDoc = readFileSync('docs/launch/ENVIRONMENT.md', 'utf8');
const manualRunbook = readFileSync('docs/launch/MANUAL_EVIDENCE_RUNBOOK.md', 'utf8');

describe('Stripe read-only launch evidence', () => {
    it('requires an explicit Supabase environment and exposes a staging command', () => {
        expect(source).toContain("Use --environment staging or --environment production.");
        expect(source).toContain("dotenv.config({ path: '.env.staging', override: true");
        expect(source).toContain('supabase_project_ref=');
        expect(source).toContain('expected_supabase_project_ref=');
        expect(packageJson).toContain('launch:stripe-readonly:staging');
        expect(packageJson).toContain('--environment staging');
    });

    it('fails when enabled webhook endpoint hosts or events are outside launch expectations', () => {
        for (const snippet of [
            'STRIPE_EXPECTED_WEBHOOK_HOSTS',
            'expectedStripeWebhookHosts',
            'safeEndpointHost',
            'expected_webhook_hosts=',
            'matching_enabled_webhook_hosts=',
            'unexpected_enabled_webhook_hosts=',
            'matching_enabled_webhook_urls=',
            'unexpected_enabled_webhook_urls=',
            'isExpectedWebhookUrl',
            "url.pathname === '/api/stripe-webhook'",
            'host or required-event configuration needs launch review',
            'Exactly one enabled Stripe webhook endpoint has the exact launch host and event set',
            'requiredWebhookEvents',
            'REQUIRED_STRIPE_WEBHOOK_EVENTS',
            'missing_required_events=',
            'single_endpoint_has_required_events=',
            'single_endpoint_has_exact_events=',
            'exactly_one_enabled_endpoint=',
            "!endpointCountProblem && !hostReviewProblems && !eventReviewProblems ? 'ok' : 'failed'",
        ]) {
            expect(source).toContain(snippet);
        }

        expect(source).toContain('espanolhonesto.com');
        expect(source).not.toContain("['espanolhonesto.com', 'www.espanolhonesto.com']");
        expect(source).toContain('espanolhonesto-staging.alindev95.workers.dev');
        expect(source).toContain("../../src/lib/stripe-webhook-events");
        expect(webhookEvents).toContain("'invoice.upcoming'");
        expect(source).not.toContain('espanol-honesto-staging.pages.dev');
        expect(source).not.toContain('academia-one-tau.vercel.app');
    });

    it('warns when the Stripe account is not activated for real charges and payouts', () => {
        expect(source).toContain('liveActivationIncomplete');
        expect(source).toContain('merchant activation for real charges/payouts is incomplete');
        expect(source).toContain('details_submitted=');
        expect(source).toContain('capability_count=');
        expect(source).toContain('spain_country_match=');
        expect(source).toContain('eur_default_currency_match=');
    });

    it('requires the pinned Portal lifecycle configuration', () => {
        expect(source).toContain('configuration.features.invoice_history.enabled');
        expect(source).toContain('invoice_history=');
        expect(source).toContain("configuration.features.subscription_cancel.mode === 'at_period_end'");
        expect(source).toContain('!configuration.features.subscription_update.enabled');
    });

    it('requires the exact launch catalog and no unlinked legacy Stripe subscriptions', () => {
        expect(source).toContain("const expectedPackageKeys = ['group', 'standard', 'hybrid', 'bootcamp']");
        expect(source).toContain('catalog keys mismatch');
        expect(source).toContain('expected exactly ${expectedPackageKeys.length * 3} active immutable offers');
        expect(source).toContain('active immutable offer belongs to a package outside the launch catalog');
        expect(source).toContain('isPackageCheckoutReady');
        expect(source).toContain('stripe_subscriptions_without_package_price=');
        expect(source).toContain(".not('stripe_subscription_id', 'is', null)");
        expect(source).toContain(".is('package_price_id', null)");
    });

    it('documents the optional expected webhook host list without storing secrets', () => {
        expect(envExample).toContain('STRIPE_EXPECTED_WEBHOOK_HOSTS=espanolhonesto.com');
        expect(environmentDoc).toContain('espanolhonesto-staging.alindev95.workers.dev');
        expect(environmentDoc).toContain('STRIPE_EXPECTED_WEBHOOK_HOSTS');
        expect(environmentDoc).toContain('un host antiguo o eventos incompletos dejan el auditor en `FAILED`');
        expect(environmentDoc).toContain('Una cuenta test sin cobros/payouts puede quedar en `WARNING`, pero en production tambien deja el auditor en `FAILED`');
    });

    it('keeps webhook host cutover behind a local-only approval and rollback pack', () => {
        expect(packageJson).toContain('launch:stripe-webhook-cutover-pack');
        expect(packageJson).toContain('scripts/launch/stripe-webhook-cutover-pack.ts');
        expect(manualRunbook).toContain('pnpm launch:stripe-webhook-cutover-pack');
        expect(manualRunbook).toContain('outputs/launch-stripe-webhook-cutover-pack/<timestamp>/approval-request.md');

        for (const snippet of [
            'launch-stripe-webhook-cutover-pack',
            'stripe-webhook-cutover-manifest.json',
            'approval-request.md',
            'verification-checklist.md',
            'rollback-plan.md',
            'does not call Stripe',
            'does not create, update, disable or delete Stripe webhook endpoints',
            'does not change products, prices, customers, subscriptions, checkout enablement or Stripe live mode',
            'webhook signing secret',
            'READY_FOR_STRIPE_DASHBOARD_APPROVAL',
            'No autorizo ningun otro cambio de Stripe ni servicios externos',
            'corepack pnpm --config.verify-deps-before-run=false launch:stripe-readonly',
        ]) {
            expect(cutoverPack).toContain(snippet);
        }

        expect(cutoverPack).not.toContain('webhookEndpoints.create');
        expect(cutoverPack).not.toContain('webhookEndpoints.update');
        expect(cutoverPack).not.toContain('webhookEndpoints.del');
    });
});
