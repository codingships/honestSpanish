import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
    buildSubscriptionCandidateDateKeys,
    findFirstSchedulableAvailableSlot,
    isAcceptedDriveFolderProvisioning,
    parseAvailableSlotStarts,
    parseAvailableSlotStartsForDate,
} from '../../scripts/smoke/real-env-smoke-safety';

const source = readFileSync(path.join(process.cwd(), 'scripts/smoke/real-env-smoke.ts'), 'utf8');
const checkoutSource = readFileSync(path.join(process.cwd(), 'scripts/smoke-checkout.ts'), 'utf8');
const checkoutBootstrapApprovalSource = readFileSync(path.join(process.cwd(), 'scripts/smoke/staging-checkout-bootstrap-approval.ts'), 'utf8');

describe('real environment smoke safety', () => {
    it('accepts an exact pre-existing Drive folder for the reusable smoke student', () => {
        const state = {
            driveFolderId: 'folder-1',
            driveFolderUrl: 'https://drive.google.com/drive/folders/folder-1',
        };

        expect(isAcceptedDriveFolderProvisioning({ status: 200, body: { success: true } }, state)).toBe(true);
        expect(isAcceptedDriveFolderProvisioning({
            status: 400,
            body: {
                error: 'Student already has a Drive folder',
                folderId: state.driveFolderId,
                folderUrl: state.driveFolderUrl,
            },
        }, state)).toBe(true);
        expect(isAcceptedDriveFolderProvisioning({
            status: 400,
            body: {
                error: 'Student already has a Drive folder',
                folderId: 'different-folder',
                folderUrl: state.driveFolderUrl,
            },
        }, state)).toBe(false);
        expect(isAcceptedDriveFolderProvisioning({ status: 400, body: { error: 'Other error' } }, state)).toBe(false);
    });

    it('parses only valid canonical available-slot payloads', () => {
        expect(parseAvailableSlotStarts({
            slots: [
                { slot_start: '2026-07-28T08:30:00.000Z', slot_end: '2026-07-28T09:20:00.000Z' },
                { slot_start: '2026-07-28T10:15:00.000Z' },
            ],
        })).toEqual([
            '2026-07-28T08:30:00.000Z',
            '2026-07-28T10:15:00.000Z',
        ]);
        expect(parseAvailableSlotStarts({ slots: [] })).toEqual([]);
        expect(parseAvailableSlotStarts({ slots: [{ slot_start: 'not-a-date' }] })).toBeNull();
        expect(parseAvailableSlotStarts({ slots: [{ slot_end: '2026-07-28T09:20:00.000Z' }] })).toBeNull();
        expect(parseAvailableSlotStarts({})).toBeNull();
        expect(parseAvailableSlotStartsForDate({
            slots: [{ slot_start: '2026-07-28T08:30:00.000Z' }],
        }, '2026-07-28')).toEqual(['2026-07-28T08:30:00.000Z']);
        expect(parseAvailableSlotStartsForDate({
            slots: [{ slot_start: '2026-07-29T08:30:00.000Z' }],
        }, '2026-07-28')).toBeNull();
    });

    it('selects real teacher availability before attempting the write-capable session endpoint', () => {
        const schedulingProbe = source.slice(
            source.indexOf('async function scheduleFirstAvailableSession'),
            source.indexOf('function extractSessionId'),
        );

        expect(schedulingProbe).toContain('listAvailableSlotStarts: (dateKey) => listCanonicalAvailableSlotStarts');
        expect(schedulingProbe).toContain('/api/calendar/available-slots?');
        expect(schedulingProbe).toContain('parseAvailableSlotStartsForDate');
        expect(schedulingProbe).toContain("'/api/calendar/sessions'");
        expect(schedulingProbe).not.toContain('for (const hour of');
        expect(schedulingProbe).toContain('subscriptionEndDate: options.subscriptionEndDate');
    });

    it('preserves scheduling cleanup evidence and marks downstream Admin Jobs as skipped on failure', () => {
        expect(source).toContain('attempted: boolean;');
        expect(source).toContain('result.error = redactErrorForSmokeEvidence(error) as Json;');
        expect(source).toContain("result.cleanupStatus = 'cleanup_failed';");
        expect(source).toContain("result.schedulingLifecycle.attempted ? (result.schedulingLifecycle.ok ? 'ok' : 'failed') : 'skipped'");
        expect(source).toContain("result.adminJobs.attempted ? (result.adminJobs.ok ? 'ok' : 'failed') : 'skipped'");
        expect(source.indexOf('if (!result.schedulingLifecycle.ok)')).toBeLessThan(
            source.indexOf('result.adminJobs = await runAdminJobsRecoverySmoke'),
        );
    });

    it('checks canonical availability before creating one bounded temporary window and always deletes it', () => {
        const teacherAuth = source.indexOf('const teacherSession = await createSessionCookieHeader');
        const studentAuth = source.indexOf('const studentSession = await createSessionCookieHeader');
        const availabilityPreflight = source.indexOf('await hasCanonicalAvailableSlotWithinSubscriptionWindow');
        const temporaryInsert = source.indexOf('await createTemporaryTeacherAvailability(teacherProfile.id, temporaryTeacherAvailabilityId);');
        const primaryAssignment = source.indexOf('await ensurePrimaryAssignment(student.id, teacherProfile.id);');

        expect(teacherAuth).toBeGreaterThan(0);
        expect(studentAuth).toBeGreaterThan(teacherAuth);
        expect(availabilityPreflight).toBeGreaterThan(teacherAuth);
        expect(availabilityPreflight).toBeGreaterThan(studentAuth);
        expect(temporaryInsert).toBeGreaterThan(availabilityPreflight);
        expect(temporaryInsert).toBeLessThan(primaryAssignment);
        expect(source).toContain(".from('teacher_availability')");
        expect(source).toContain('temporaryTeacherAvailabilityId = randomUUID();');
        expect(source).toContain('temporaryTeacherAvailabilityDeleted = await deleteTemporaryTeacherAvailability');
        expect(source).toContain('&& result.cleanup.temporaryTeacherAvailabilityDeleted;');
        expect(source).toContain('Temporary teacher availability did not produce a canonical Google-filtered slot.');
        expect(source).toContain('parseAvailableSlotStartsForDate(response.body, dateKey)');
    });

    it('uses non-round canonical slots, retries only conflicts and never crosses the subscription end date', async () => {
        const requestedDates: string[] = [];
        const attemptedSlots: string[] = [];
        const first = '2026-07-28T08:30:00.000Z';
        const second = '2026-07-28T10:15:00.000Z';

        const result = await findFirstSchedulableAvailableSlot<{
            error?: string;
            session?: { id: string };
        }>({
            now: new Date('2026-07-12T08:00:00.000Z'),
            subscriptionEndDate: '2026-08-12',
            listAvailableSlotStarts: async (dateKey) => {
                requestedDates.push(dateKey);
                return dateKey === '2026-07-28' ? [first, second] : [];
            },
            schedule: async (slotStart) => {
                attemptedSlots.push(slotStart);
                return slotStart === first
                    ? { status: 409, body: { error: 'conflict' } }
                    : { status: 201, body: { session: { id: 'session-1' } } };
            },
        });

        expect(result).toEqual({
            kind: 'scheduled',
            slotStart: second,
            response: { status: 201, body: { session: { id: 'session-1' } } },
        });
        expect(attemptedSlots).toEqual([first, second]);
        expect(requestedDates.every((dateKey) => dateKey <= '2026-08-12')).toBe(true);
    });

    it('builds an inclusive bounded candidate window for the temporary subscription', () => {
        const dates = buildSubscriptionCandidateDateKeys({
            now: new Date('2026-07-12T08:00:00.000Z'),
            subscriptionEndDate: '2026-08-12',
        });

        expect(dates[0]).toBe('2026-07-26');
        expect(dates.at(-1)).toBe('2026-08-12');
        expect(dates).not.toContain('2026-08-13');
    });

    it('stops on a non-conflict scheduling failure and returns no write attempt when there are no slots', async () => {
        const fatalAttempts: string[] = [];
        const fatal = await findFirstSchedulableAvailableSlot({
            now: new Date('2026-07-12T08:00:00.000Z'),
            subscriptionEndDate: '2026-08-12',
            listAvailableSlotStarts: async () => ['2026-07-28T08:30:00.000Z', '2026-07-28T10:15:00.000Z'],
            schedule: async (slotStart) => {
                fatalAttempts.push(slotStart);
                return { status: 400, body: { error: 'invalid' } };
            },
        });
        expect(fatal.kind).toBe('fatal');
        expect(fatalAttempts).toHaveLength(1);

        let emptyAttempts = 0;
        const none = await findFirstSchedulableAvailableSlot({
            now: new Date('2026-07-12T08:00:00.000Z'),
            subscriptionEndDate: '2026-08-12',
            listAvailableSlotStarts: async () => [],
            schedule: async () => {
                emptyAttempts += 1;
                return { status: 201, body: {} };
            },
        });
        expect(none).toEqual({ kind: 'none', lastFailure: null });
        expect(emptyAttempts).toBe(0);
    });

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
        expect(source).toContain('staging.espanolhonesto.com');
        expect(source).toContain('Real environment smoke only accepts the exact deployed staging Worker host.');
        expect(source).not.toContain("'localhost:4321'");
        expect(source).toContain('This staging-only smoke reuses the three existing allowlisted role accounts');
        expect(source).not.toContain("process.env.SMOKE_BASE_URL || 'https://espanolhonesto.com'");
        expect(source).not.toContain('process.env.SMOKE_BASE_URL || "https://espanolhonesto.com"');
    });

    it('validates every precondition read-only before starting any write', () => {
        const preflightCall = source.indexOf('const preflight = await runReadOnlyPreflight();');
        const firstWritePhaseCall = source.indexOf('await createTemporaryTeacherAvailability(teacherProfile.id, temporaryTeacherAvailabilityId);');
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

    it('checks the aggregate Resend Free budget before any smoke mutation', () => {
        const preflightSource = source.slice(
            source.indexOf('async function runReadOnlyPreflight'),
            source.indexOf('function assertExactSmokeEmailAllowlist'),
        );
        const budgetSource = source.slice(
            source.indexOf('async function verifyStagingSmokeEmailBudget'),
            source.indexOf('function assertExactSmokeEmailAllowlist'),
        );
        const mainPreflight = source.indexOf('const preflight = await runReadOnlyPreflight();');
        const firstMutation = source.indexOf('await createTemporaryTeacherAvailability(teacherProfile.id, temporaryTeacherAvailabilityId);');

        expect(preflightSource).toContain('const emailRecipientBudget = await verifyStagingSmokeEmailBudget();');
        expect(preflightSource).toContain('emailRecipientBudget,');
        expect(budgetSource).toContain("from('email_recipient_budget_usage')");
        expect(budgetSource).toContain("eq('budget_scope', 'nonproduction')");
        expect(budgetSource).toContain("in('period_kind', ['day', 'month'])");
        expect(budgetSource).toContain('currentMonthlyRecipients: currentRecipients.monthly');
        expect(budgetSource).toContain('configuredMonthlyLimit: EMAIL_MONTHLY_RECIPIENT_LIMIT');
        expect(budgetSource).toContain('plannedSmokeRecipients: STAGING_SMOKE_PLANNED_RECIPIENTS');
        expect(budgetSource).toContain('if (!assessment.allowed)');
        expect(budgetSource).not.toContain('.insert(');
        expect(budgetSource).not.toContain('.update(');
        expect(budgetSource).not.toContain('.delete(');
        expect(budgetSource).not.toContain('.rpc(');
        expect(mainPreflight).toBeLessThan(firstMutation);
    });

    it('limits email coverage to one confirmation, reminder and cancellation pair', () => {
        const schedulingSource = source.slice(
            source.indexOf('async function runSchedulingLifecycleSmoke'),
            source.indexOf('async function runAdminJobsRecoverySmoke'),
        );
        const cleanupSource = source.slice(
            source.indexOf('async function cleanupSchedulingSmokeArtifacts'),
            source.indexOf('async function createNoEmailSchedulingVariant'),
        );

        expect(schedulingSource.match(/scheduleFirstAvailableSession\(/gu)).toHaveLength(1);
        expect(schedulingSource.match(/createNoEmailSchedulingVariant\(/gu)).toHaveLength(3);
        expect(schedulingSource).toContain('/internal/reminders/send-exact');
        expect(schedulingSource).toContain("waitForSessionFulfillmentJob(initialSessionId, 'session_fulfillment')");
        expect(schedulingSource).toContain("waitForSessionFulfillmentJob(initialSessionId, 'session_cancellation')");
        expect(schedulingSource).toContain('cancelSchedulingVariantWithoutEmail');
        expect(schedulingSource).toContain('result.dailyEmailRecipientDelta === STAGING_SMOKE_PLANNED_RECIPIENTS');
        expect(schedulingSource).toContain('result.monthlyEmailRecipientDelta === STAGING_SMOKE_PLANNED_RECIPIENTS');
        expect(schedulingSource).toContain('result.dailyCleanupEmailRecipientDelta === 0');
        expect(schedulingSource).toContain('result.monthlyCleanupEmailRecipientDelta === 0');
        expect(source).toContain('sendEmail: false');
        expect(cleanupSource).not.toContain('sendEmail');
        expect(cleanupSource).not.toContain('enqueue');
        expect(cleanupSource).not.toContain('authedJsonFetch');
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
        expect(source).toContain('result.skippedSections = getSmokeSkippedSections(result);');
        expect(source).toContain('result.ok = result.failedSections.length === 0 && runError === null;');
        expect(source).toContain('Real environment smoke failed sections:');
        expect(source).toContain("['billingLifecycle', result.billingLifecycle.ok ? 'ok' : 'failed']");
        expect(source).toContain("['schedulingLifecycle', result.schedulingLifecycle.attempted ? (result.schedulingLifecycle.ok ? 'ok' : 'failed') : 'skipped']");
        expect(source).toContain("['adminJobs', result.adminJobs.attempted ? (result.adminJobs.ok ? 'ok' : 'failed') : 'skipped']");
        expect(source).toContain('result.executionError = redactErrorForSmokeEvidence(error) as Json;');
        expect(source).toContain('`- Skipped sections: ${result.skippedSections.length === 0');
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
        expect(source).toContain('sanitizeStagingSmokeCapture(value)');
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
        expect(source).toContain("job_type: 'session_fulfillment'");
        expect(source).toContain('sendEmail: false');
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
        expect(checkoutSource).toContain('staging.espanolhonesto.com');
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
