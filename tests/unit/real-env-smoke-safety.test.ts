import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(path.join(process.cwd(), 'scripts/smoke/real-env-smoke.ts'), 'utf8');
const checkoutSource = readFileSync(path.join(process.cwd(), 'scripts/smoke-checkout.ts'), 'utf8');
const checkoutBootstrapApprovalSource = readFileSync(path.join(process.cwd(), 'scripts/smoke/staging-checkout-bootstrap-approval.ts'), 'utf8');

describe('real environment smoke safety', () => {
    it('requires explicit environment credentials instead of hardcoded launch accounts', () => {
        expect(source).toContain("requireEnv('SMOKE_BASE_URL')");
        expect(source).toContain("requireEnv('SMOKE_EXTERNAL_WRITES_CONFIRMATION')");
        expect(source).toContain("requireEnv('SMOKE_ADMIN_EMAIL')");
        expect(source).toContain("requireEnv('SMOKE_ADMIN_PASSWORD')");
        expect(source).toContain("requireEnv('SMOKE_TEACHER_EMAIL')");
        expect(source).toContain("requireEnv('SMOKE_TEACHER_PASSWORD')");
        expect(source).toContain("requireEnv('SMOKE_STUDENT_EMAIL')");
        expect(source).toContain("requireEnv('SMOKE_STUDENT_PASSWORD')");
        expect(source).toContain("requireEnv('EMAIL_RECIPIENT_ALLOWLIST')");
        expect(source).toContain("requireEnv('FULFILLMENT_WORKER_URL')");
        expect(source).toContain("requireEnv('INTERNAL_JOB_SECRET')");
        expect(source).not.toMatch(/const ADMIN_EMAIL = ['"]/);
        expect(source).not.toMatch(/const TEACHER_EMAIL = ['"]/);
        expect(source).not.toContain('SmokePass!2026');
    });

    it('does not create users or reset any role-account password', () => {
        expect(source).not.toContain('auth.admin.createUser');
        expect(source).not.toContain('auth.admin.updateUserById');
        expect(source).not.toContain('ensureSmokeStudent');
        expect(source).toContain('authUsersCreated: 0');
    });

    it('requires an explicit external-write confirmation for the exact smoke host', () => {
        expect(source).toContain('function normalizeAndConfirmSmokeBaseUrl');
        expect(source).toContain('writes-ok:${parsedUrl.host}');
        expect(source).toContain('SMOKE_BASE_URL must be an origin only');
        expect(source).toContain('espanolhonesto-staging.alindev95.workers.dev');
        expect(source).toContain('Real environment smoke only accepts the exact deployed staging Worker host.');
        expect(source).not.toContain("'localhost:4321'");
        expect(source).toContain('This staging-only smoke reuses the three existing allowlisted role accounts');
        expect(source).not.toContain("process.env.SMOKE_BASE_URL || 'https://espanolhonesto.com'");
        expect(source).not.toContain('process.env.SMOKE_BASE_URL || "https://espanolhonesto.com"');
    });

    it('validates every precondition read-only before starting any write', () => {
        const preflightCall = source.indexOf('const preflight = await runReadOnlyPreflight();');
        const firstWritePhaseCall = source.indexOf('await ensurePrimaryAssignment(student.id, teacherProfile.id);');
        const roleAuthenticationCall = source.indexOf('const teacherSession = await createSessionCookieHeader');
        expect(preflightCall).toBeGreaterThan(0);
        expect(roleAuthenticationCall).toBeGreaterThan(preflightCall);
        expect(firstWritePhaseCall).toBeGreaterThan(roleAuthenticationCall);
        expect(firstWritePhaseCall).toBeGreaterThan(preflightCall);
        expect(source).toContain("process.argv.includes('--preflight-only') || RUNTIME_PREFLIGHT_ONLY");
        expect(source).toContain('externalWritesStarted: false');
        expect(source).toContain('verifyDeployedStagingRuntime');
        expect(source).toContain('probeCheckoutGateReadOnly');
        expect(source).toContain("EXPECTED_CHECKOUT_OVERRIDE !== 'false'");
        expect(source).toContain('never opens the checkout gate');
        expect(source).toContain('COMPLETED_CHECKOUT_SESSION_ID');
        expect(source).toContain('BILLING_LIFECYCLE_EVIDENCE_PATH');
        expect(source).toContain('Completed Checkout and canonical billing lifecycle evidence must match');
    });

    it('reuses only the existing allowlisted role accounts and performs bounded cleanup', () => {
        expect(source).toContain('assertExactSmokeEmailAllowlist');
        expect(source).toContain('EMAIL_RECIPIENT_ALLOWLIST must contain exactly');
        expect(source).toContain("email.endsWith('@example.com')");
        expect(source).toContain('cleanupSchedulingSmokeArtifacts');
        expect(source).toContain('deleteSmokeFulfillmentJobArtifacts');
        expect(source).toContain('restoreReusableStudentPrivateState');
        expect(source).toContain('reusableStudentPreserved');
        expect(source).toContain('completedCheckoutEvidencePreserved');
        expect(source).not.toContain('crmOpportunityDeleted');
        expect(source).not.toMatch(/smoke-(?:checkout|drive|scheduling)-\$\{suffix\}@example\.com/);
    });

    it('sends reminders only through the exact staging Worker endpoint', () => {
        expect(source).toContain('/internal/reminders/send-exact');
        expect(source).toContain('SMOKE-REMINDER-${options.suffix}');
        expect(source).toContain("teacher_notes: options.smokeMarker");
        expect(source).toContain("Authorization: `Bearer ${INTERNAL_JOB_SECRET}`");
        expect(source).toContain('normalizeAndConfirmFulfillmentWorkerUrl');
        expect(source).not.toContain('/api/cron/send-reminders');
        expect(source).not.toContain('process.env.CRON_SECRET');
    });

    it('loads only staging defaults and rejects production Supabase or live Stripe credentials', () => {
        expect(source).toContain("dotenv.config({ path: '.env.staging', override: false");
        expect(source).toContain('mzjyvmlxfpzdfdjzxxyj');
        expect(source).toContain('Real environment smoke only accepts Supabase staging');
        expect(source).toContain("stripeSecretKey.startsWith('sk_test_')");
        expect(source).toContain('Real environment smoke refuses Stripe live credentials.');
        expect(source).not.toContain("dotenv.config({ path: '.env',");
        expect(source).not.toContain("import 'dotenv/config'");
    });

    it('uses real completed Checkout evidence and never fabricates Stripe events or subscriptions', () => {
        expect(source).toContain('SMOKE_COMPLETED_CHECKOUT_SESSION_ID');
        expect(source).toContain('verifyCompletedCheckoutEvidence');
        expect(source).toContain("verificationMode: 'real-checkout-readonly'");
        expect(source).toContain('SMOKE_BILLING_LIFECYCLE_EVIDENCE_PATH');
        expect(source).not.toContain('SMOKE_BILLING_LIFECYCLE_MANUAL_CONFIRMATION');
        expect(source).not.toContain('reviewed-real-events:');
        expect(source).toContain('synthetic webhook payloads are forbidden');
        expect(source).not.toContain('generateTestHeaderString');
        expect(source).not.toContain('postSignedWebhook');
        expect(source).not.toContain('sendStripeEvent');
        expect(source).not.toContain('stripe.subscriptions.create');
        expect(source).not.toContain("smoke_managed: 'true'");
    });

    it('requires an explicit canonical completed lifecycle report and revalidates terminal Stripe/Supabase events', () => {
        expect(source).toContain("requireEnv('SMOKE_BILLING_LIFECYCLE_EVIDENCE_PATH')");
        expect(source).toContain('function readCanonicalLifecycleReport');
        expect(source).toContain('validateCanonicalLifecycleReport');
        expect(source).toContain("pathParts[1] !== 'summary.json'");
        expect(source).toContain('function revalidateCanonicalLifecycleState');
        expect(source).toContain("stripeSubscription.status === 'canceled'");
        expect(source).toContain("renewalPayment.status === 'refunded'");
        expect(source).toContain('renewalPayment.amount_refunded === renewalPayment.amount');
        expect(source).toContain('initialPayment.amount_refunded === 0');
        expect(source).toContain("from('processed_webhook_events')");
        expect(source).toContain("event.processing_status === 'succeeded'");
        expect(source).toContain('canonicalEvidenceVerified: true');
    });

    it('reuses the completed package_price checkout evidence and never creates or expires another Checkout', () => {
        expect(source).toContain(".from('package_prices')");
        expect(source).toContain(".from('checkout_intents')");
        expect(source).toContain('assertTestStripeOffer');
        expect(source).toContain('refuses live Stripe writes');
        expect(source).toContain("verificationMode: 'completed-checkout-readonly'");
        expect(source).toContain("result.checkout.cleanupStatus = 'completed-checkout-evidence-preserved'");
        expect(source).toContain('preflight.checkoutGateStatus === 403');
        expect(source).not.toContain('ensureSmokeCheckoutApproval');
        expect(source).not.toContain('stripe.checkout.sessions.expire');
        expect(source).not.toContain("authedJsonFetch(studentSession, '/api/create-checkout'");
    });

    it('selects only a canonical checkout-eligible launch package', () => {
        expect(source).toContain('getCheckoutReadyPackageOffers');
        expect(source).toContain('isPackageKeyCheckoutEligible');
        expect(source).toContain(".in('name', ['standard', 'bootcamp'])");
        expect(source).toContain("pkg.name === 'standard'");
        expect(source).not.toContain(".order('created_at', { ascending: true })\n        .limit(1)");
    });

    it('keeps public-link Drive access under the current operating model', () => {
        expect(source).toContain('publicLinkPermissionPreserved');
        expect(source).not.toContain('publicLinkPermissionRevoked');
    });

    it('fails the command when any critical smoke section is not ok', () => {
        expect(source).toContain('type SmokeSectionKey');
        expect(source).toContain('failedSections: SmokeSectionKey[]');
        expect(source).toContain('function getSmokeFailureSections');
        expect(source).toContain('result.failedSections = getSmokeFailureSections(result);');
        expect(source).toContain('result.ok = result.failedSections.length === 0 && runError === null;');
        expect(source).toContain('Real environment smoke failed sections:');
        expect(source).toContain("['billingLifecycle', result.billingLifecycle.ok]");
        expect(source).toContain("['schedulingLifecycle', result.schedulingLifecycle.ok]");
        expect(source).toContain("['adminJobs', result.adminJobs.ok]");
    });

    it('uses a configurable Supabase Auth user scan limit instead of a fixed ten-page cap', () => {
        expect(source).toContain("readPositiveIntegerEnv('SMOKE_AUTH_USER_SCAN_MAX_PAGES', 100)");
        expect(source).toContain('function readPositiveIntegerEnv');
        expect(source).toContain('page <= SMOKE_AUTH_USER_SCAN_MAX_PAGES');
        expect(source).toContain('`${name} must be a positive integer.`');
        expect(source).not.toContain('page <= 10');
    });

    it('redacts final smoke command output and errors before printing', () => {
        expect(source).toContain('console.log(JSON.stringify(redactSmokeResult(result), null, 2));');
        expect(source).toContain('console.error(redactErrorForSmokeEvidence(error));');
        expect(source).toContain('function redactJsonForSmokeEvidence');
        expect(source).toContain('function redactSmokeString');
        expect(source).toContain('[redacted-email]');
        expect(source).toContain('[redacted-url:');
        expect(source).toContain('[redacted-stripe-id]');
        expect(source).toContain('[redacted-response-body]');
        expect(source).not.toContain('console.log(JSON.stringify(result, null, 2));');
        expect(source).not.toContain('console.error(error);');
    });

    it('writes redacted final smoke evidence files for manual evidence', () => {
        expect(source).toContain('function writeSmokeEvidence');
        expect(source).toContain("path.join(process.cwd(), 'outputs', 'real-env-smoke'");
        expect(source).toContain("path.join(outputDir, 'summary.json')");
        expect(source).toContain("path.join(outputDir, 'summary.md')");
        expect(source).toContain('const redactedResult = redactSmokeResult(result);');
        expect(source).toContain('renderSmokeSummary(result)');
        expect(source).toContain('[real-env-smoke] Summary:');
        expect(source).toContain('SMOKE_EXTERNAL_WRITES_CONFIRMATION');
        expect(source).not.toContain("writeFileSync(path.join(outputDir, 'summary.json'), `${JSON.stringify(result");
    });

    it('covers Admin Jobs retry and cleanup in the real environment smoke', () => {
        expect(source).toContain('runAdminJobsRecoverySmoke');
        expect(source).toContain('createSmokeFailedFulfillmentJob');
        expect(source).toContain("job_type: 'welcome_fulfillment'");
        expect(source).toContain("status: 'failed'");
        expect(source).toContain("source: 'real-env-smoke'");
        expect(source).toContain('/es/campus/admin/jobs');
        expect(source).toContain('/api/admin/fulfillment-jobs?status=failed&limit=100');
        expect(source).toContain("body: { action: 'retry', jobId: insertedJob.id }");
        expect(source).toContain("waitForAdminJobAudit(insertedJob.id, 'fulfillment_job.retry')");
        expect(source).toContain('/api/admin/fulfillment-jobs?status=pending&limit=100');
        expect(source).toContain("body: { action: 'cancel', jobId: insertedJob.id }");
        expect(source).toContain("waitForAdminJobAudit(insertedJob.id, 'fulfillment_job.cancel')");
        expect(source).toContain('cancelSmokeFulfillmentJobDirectly');
        expect(source).toContain('deleteSmokeFulfillmentJobArtifacts(result.insertedJobId)');
        expect(source).toContain("result.cleanupStatus = deleted ? 'deleted_job_and_audit_rows'");
    });
});

describe('narrow checkout smoke safety', () => {
    it('requires the exact host write confirmation and stays in Stripe test mode', () => {
        expect(checkoutSource).toContain("requireEnv('SMOKE_EXTERNAL_WRITES_CONFIRMATION')");
        expect(checkoutSource).toContain('writes-ok:${parsedUrl.host}');
        expect(checkoutSource).toContain('test-mode only and refuses live Stripe writes');
        expect(checkoutSource).toContain("dotenv.config({ path: '.env.staging', override: false");
        expect(checkoutSource).toContain('mzjyvmlxfpzdfdjzxxyj');
        expect(checkoutSource).toContain('espanolhonesto-staging.alindev95.workers.dev');
        expect(checkoutSource).toContain("requireEnv('SMOKE_STUDENT_EMAIL')");
        expect(checkoutSource).toContain("requireEnv('SMOKE_STUDENT_PASSWORD')");
        expect(checkoutSource).toContain("requireEnv('EMAIL_RECIPIENT_ALLOWLIST')");
        expect(checkoutSource).toContain('process.env.STAGING_CHECKOUT_GATE_CONFIRMATION');
        expect(checkoutSource).toContain('manual-exception-owner-will-restore-checkout-false:${new URL(baseUrl).host}');
        expect(checkoutSource).toContain("waitUntil: 'commit'");
        expect(checkoutSource).toContain('timeout: 30_000');
        expect(checkoutSource).not.toContain("dotenv.config({ path: '.env.test', override: true");
        expect(checkoutSource).not.toContain("dotenv.config({ path: '.env', quiet: true");
    });

    it('reuses the existing student and deletes its temporary CRM checkout artifacts', () => {
        expect(checkoutSource).toContain('getExistingSmokeUser');
        expect(checkoutSource).not.toContain('auth.admin.createUser');
        expect(checkoutSource).not.toContain('auth.admin.updateUserById');
        expect(checkoutSource).toContain(".eq('interest', checkout.interest)");
        expect(checkoutSource).toContain(".in('interest', ['checkout-smoke', 'staging-checkout-bootstrap'])");
        expect(checkoutSource).toContain(".from('checkout_intents')");
        expect(checkoutSource).toContain(".from('crm_opportunities')");
        expect(checkoutSource).toContain('probeCheckoutGateEnabledReadOnly');
        const mainSource = checkoutSource.slice(
            checkoutSource.indexOf('async function main()'),
            checkoutSource.indexOf('function assertExistingAllowlistedStudent'),
        );
        expect(mainSource.indexOf('const authenticated = await signInForCheckout')).toBeLessThan(
            mainSource.indexOf('await expireOwnedOpenCheckoutIntents(userId)')
        );
    });

    it('uses CRM approval, immutable offers, legal acceptance and checkout_intent verification', () => {
        expect(checkoutSource).toContain('ensureCheckoutApproval');
        expect(checkoutSource).toContain(".from('packages')");
        expect(checkoutSource).toContain('package_prices (');
        expect(checkoutSource).toContain(".from('checkout_intents')");
        expect(checkoutSource).toContain('withdrawalLossAcknowledged: true');
        expect(checkoutSource).toContain('session.metadata?.packagePriceId');
        expect(checkoutSource).toContain('session.metadata?.checkoutIntentId');
    });

    it('selects only a canonical checkout-eligible launch package', () => {
        expect(checkoutSource).toContain('getCheckoutReadyPackageOffers');
        expect(checkoutSource).toContain('isPackageKeyCheckoutEligible');
        expect(checkoutSource).toContain(".in('name', ['standard', 'bootcamp'])");
        expect(checkoutSource).toContain("pkg.name === 'standard'");
        expect(checkoutSource).not.toContain(".order('amount_cents', { ascending: true })");
    });

    it('does not complete payments or synthesize webhooks and safely expires its open session', () => {
        expect(checkoutSource).toContain('stripe.checkout.sessions.expire');
        expect(checkoutSource).not.toContain('generateTestHeaderString');
        expect(checkoutSource).not.toContain('postSignedWebhook');
        expect(checkoutSource).not.toContain('stripe.subscriptions.create');
    });

    it('keeps bootstrap as an exceptional manual tool with explicit external gate ownership', () => {
        expect(checkoutSource).toContain("process.argv.includes('--bootstrap-preflight')");
        expect(checkoutSource).toContain("process.argv.includes('--bootstrap-preserve-open')");
        expect(checkoutSource).toContain("process.argv.includes('--bootstrap-cleanup')");
        expect(checkoutSource).toContain("process.argv.includes('--manual-exception')");
        expect(checkoutSource).toContain('Exceptional Checkout bootstrap requires --manual-exception');
        expect(checkoutSource).toContain('manual-exception-owner-will-restore-checkout-false:${new URL(baseUrl).host}');
        expect(checkoutSource).toContain('this script never changes or rolls back Cloudflare');
        expect(checkoutSource).toContain('EXACT_STAGING_CHECKOUT_BOOTSTRAP_APPROVAL');
        expect(checkoutBootstrapApprovalSource).toContain('solo como excepcion manual fuera del flujo activo de smoke');
        expect(checkoutBootstrapApprovalSource).toContain('Este script no abre, cambia ni restaura Cloudflare');
        expect(checkoutBootstrapApprovalSource).not.toContain('runner debe restaurar');
        expect(checkoutSource).toContain("const stagingStripeAccountId = 'acct_1TruqOC22M3erP0j'");
        expect(checkoutSource).toContain('stripe.testHelpers.testClocks.create');
        expect(checkoutSource).toContain("test_clock: testClock.id");
        expect(checkoutSource).toContain("source: 'staging-checkout-bootstrap'");
        expect(checkoutSource).toContain("selected?.pkg.name !== 'standard'");
        expect(checkoutSource).toContain("account.country !== 'ES'");
        expect(checkoutSource).toContain("account.default_currency !== 'eur'");
        expect(checkoutSource).toContain('copyCheckoutUrlToClipboard(created.url)');
        expect(checkoutSource).toContain('if (!preserveCheckout) await closeSmokeCheckout(checkout)');
        expect(checkoutSource).toContain('cleanupOwnedBootstrapArtifacts');
        expect(checkoutSource).toContain('Refusing to clean a bootstrap Customer with completed billing evidence.');
        expect(checkoutSource).not.toContain('console.log(created.url)');
        expect(checkoutSource).not.toContain('writeFileSync(created.url');
    });

    it('refuses a non-smoke open intent before expiring its Stripe Session', () => {
        const functionStart = checkoutSource.indexOf('async function expireOwnedOpenCheckoutIntents');
        const functionEnd = checkoutSource.indexOf('async function ensureCheckoutApproval');
        const cleanupSource = checkoutSource.slice(functionStart, functionEnd);
        const ownershipGuard = cleanupSource.indexOf('A non-smoke Checkout intent is already open');
        const sessionExpire = cleanupSource.indexOf('stripe.checkout.sessions.expire');
        expect(ownershipGuard).toBeGreaterThan(0);
        expect(sessionExpire).toBeGreaterThan(ownershipGuard);
    });
});
