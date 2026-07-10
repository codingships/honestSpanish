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

    it('warns when enabled webhook endpoint hosts are outside launch expectations', () => {
        for (const snippet of [
            'STRIPE_EXPECTED_WEBHOOK_HOSTS',
            'expectedStripeWebhookHosts',
            'safeEndpointHost',
            'expected_webhook_hosts=',
            'matching_enabled_webhook_hosts=',
            'unexpected_enabled_webhook_hosts=',
            'host or required-event configuration needs launch review',
            'At least one enabled Stripe webhook endpoint is visible on an expected launch host',
            'requiredWebhookEvents',
            'REQUIRED_STRIPE_WEBHOOK_EVENTS',
            'missing_required_events=',
            'single_endpoint_has_required_events=',
            "enabled.length > 0 && !hostReviewProblems && !eventReviewProblems ? 'ok' : 'warning'",
        ]) {
            expect(source).toContain(snippet);
        }

        expect(source).toContain('espanolhonesto.com');
        expect(source).toContain('www.espanolhonesto.com');
        expect(source).toContain('staging.espanolhonesto.com');
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
    });

    it('documents the optional expected webhook host list without storing secrets', () => {
        expect(envExample).toContain('STRIPE_EXPECTED_WEBHOOK_HOSTS=espanolhonesto.com,www.espanolhonesto.com,staging.espanolhonesto.com');
        expect(environmentDoc).toContain('STRIPE_EXPECTED_WEBHOOK_HOSTS');
        expect(environmentDoc).toContain('un host antiguo, eventos incompletos o una cuenta sin cobros/payouts debe quedar como warning');
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
