import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(path.join(process.cwd(), 'scripts/smoke/real-env-smoke.ts'), 'utf8');

describe('real environment smoke safety', () => {
    it('requires explicit environment credentials instead of hardcoded launch accounts', () => {
        expect(source).toContain("requireEnv('SMOKE_BASE_URL')");
        expect(source).toContain("requireEnv('SMOKE_EXTERNAL_WRITES_CONFIRMATION')");
        expect(source).toContain("requireEnv('SMOKE_ADMIN_EMAIL')");
        expect(source).toContain("requireEnv('SMOKE_ADMIN_PASSWORD')");
        expect(source).toContain("requireEnv('SMOKE_TEACHER_EMAIL')");
        expect(source).toContain("requireEnv('SMOKE_TEACHER_PASSWORD')");
        expect(source).not.toMatch(/const ADMIN_EMAIL = ['"]/);
        expect(source).not.toMatch(/const TEACHER_EMAIL = ['"]/);
        expect(source).not.toContain('SmokePass!2026');
    });

    it('does not reset owner or teacher auth passwords before login', () => {
        const smokeStudentBoundary = source.indexOf('async function ensureSmokeStudent');
        expect(smokeStudentBoundary).toBeGreaterThan(0);
        const ownerTeacherSection = source.slice(0, smokeStudentBoundary);

        expect(source).not.toContain('ensurePasswordAndGetProfile');
        expect(ownerTeacherSection).not.toContain('updateUserById');
    });

    it('requires an explicit external-write confirmation for the exact smoke host', () => {
        expect(source).toContain('function normalizeAndConfirmSmokeBaseUrl');
        expect(source).toContain('writes-ok:${parsedUrl.host}');
        expect(source).toContain('SMOKE_BASE_URL must be an origin only');
        expect(source).toContain('This smoke creates or updates test users and calls Supabase, Stripe, Google and Resend.');
        expect(source).not.toContain("process.env.SMOKE_BASE_URL || 'https://espanolhonesto.com'");
        expect(source).not.toContain('process.env.SMOKE_BASE_URL || "https://espanolhonesto.com"');
    });

    it('cleans up smoke-managed Stripe subscriptions even when billing smoke exits early', () => {
        expect(source).toContain("smoke_managed: 'true'");
        expect(source).toContain('stripeSubscriptionCleanupStatus');
        expect(source).toContain('stripeSubscriptionCleanupError');
        expect(source).toContain('async function recordSmokeStripeSubscriptionCleanup');
        expect(source).toContain('stripe.subscriptions.cancel(stripeSubscriptionId)');
        expect(source).toContain('} finally {');
        expect(source).toContain("result.ok = result.ok && result.stripeSubscriptionCleanupStatus === 'canceled';");
    });

    it('fails the command when any critical smoke section is not ok', () => {
        expect(source).toContain('type SmokeSectionKey');
        expect(source).toContain('failedSections: SmokeSectionKey[]');
        expect(source).toContain('function getSmokeFailureSections');
        expect(source).toContain('result.failedSections = getSmokeFailureSections(result);');
        expect(source).toContain('result.ok = result.failedSections.length === 0;');
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
        expect(source).toContain('result.cleanupStatus = await cancelSmokeFulfillmentJobDirectly(result.insertedJobId);');
    });
});
