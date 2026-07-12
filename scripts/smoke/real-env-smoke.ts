import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { createBrowserClient } from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';
import type { User } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import Stripe from 'stripe';
import { cancelClassEvent, getEvent } from '../../src/lib/google/calendar';
import { getDriveClient } from '../../src/lib/google/drive';
import { fulfillSingleSession } from '../../src/lib/fulfillment/session-fulfillment';
import {
    getCheckoutReadyPackageOffers,
    isPackageDuration,
    isPackageKeyCheckoutEligible,
    type PackageCatalogSnapshot,
    type PackagePriceSnapshot,
} from '../../src/lib/package-pricing';
import {
    verifyDeployedStagingRuntime,
    type ExpectedCheckoutOverride,
} from './deployed-runtime-safety';
import {
    STAGING_SUPABASE_PROJECT_REF,
    validateCanonicalLifecycleReport,
    type CanonicalLifecycleReportSummary,
} from '../launch/staging-billing-lifecycle-safety';
import {
    assessStagingSmokeEmailBudget,
    RESEND_FREE_DAILY_RECIPIENT_LIMIT,
    RESEND_FREE_MONTHLY_RECIPIENT_LIMIT,
    STAGING_SMOKE_PLANNED_RECIPIENTS,
    sanitizeStagingSmokeCapture,
    type StagingSmokeEmailBudgetAssessment,
} from '../launch/staging-smoke-runner-safety';
import {
    buildSubscriptionCandidateDateKeys,
    findFirstSchedulableAvailableSlot,
    isAcceptedDriveFolderProvisioning,
    parseAvailableSlotStartsForDate,
} from './real-env-smoke-safety';

// This harness is staging-only. Process env values supplied by the gated
// runner win; local defaults come exclusively from the ignored staging file.
dotenv.config({ path: '.env.staging', override: false, quiet: true });

const RUNTIME_PREFLIGHT_ONLY = process.argv.includes('--runtime-preflight-only');
const PREFLIGHT_ONLY = process.argv.includes('--preflight-only') || RUNTIME_PREFLIGHT_ONLY;

const BASE_URL = normalizeAndConfirmSmokeBaseUrl(
    requireEnv('SMOKE_BASE_URL'),
    requireEnv('SMOKE_EXTERNAL_WRITES_CONFIRMATION')
);
const ADMIN_EMAIL = requireEnv('SMOKE_ADMIN_EMAIL');
const ADMIN_PASSWORD = requireEnv('SMOKE_ADMIN_PASSWORD');
const TEACHER_EMAIL = requireEnv('SMOKE_TEACHER_EMAIL');
const TEACHER_PASSWORD = requireEnv('SMOKE_TEACHER_PASSWORD');
const STUDENT_EMAIL = requireEnv('SMOKE_STUDENT_EMAIL');
const STUDENT_PASSWORD = requireEnv('SMOKE_STUDENT_PASSWORD');
const EMAIL_RECIPIENT_ALLOWLIST = requireEnv('EMAIL_RECIPIENT_ALLOWLIST');
const EMAIL_DAILY_RECIPIENT_LIMIT = readPositiveIntegerEnv(
    'EMAIL_DAILY_RECIPIENT_LIMIT',
    RESEND_FREE_DAILY_RECIPIENT_LIMIT,
);
const EMAIL_MONTHLY_RECIPIENT_LIMIT = readPositiveIntegerEnv(
    'EMAIL_MONTHLY_RECIPIENT_LIMIT',
    RESEND_FREE_MONTHLY_RECIPIENT_LIMIT,
);
const COMPLETED_CHECKOUT_SESSION_ID = RUNTIME_PREFLIGHT_ONLY
    ? process.env.SMOKE_COMPLETED_CHECKOUT_SESSION_ID?.trim() ?? ''
    : requireEnv('SMOKE_COMPLETED_CHECKOUT_SESSION_ID');
const BILLING_LIFECYCLE_EVIDENCE_PATH = RUNTIME_PREFLIGHT_ONLY
    ? process.env.SMOKE_BILLING_LIFECYCLE_EVIDENCE_PATH?.trim() ?? ''
    : requireEnv('SMOKE_BILLING_LIFECYCLE_EVIDENCE_PATH');
const FULFILLMENT_WORKER_URL = normalizeAndConfirmFulfillmentWorkerUrl(requireEnv('FULFILLMENT_WORKER_URL'));
const INTERNAL_JOB_SECRET = requireEnv('INTERNAL_JOB_SECRET');
const SMOKE_AUTH_USER_SCAN_MAX_PAGES = readPositiveIntegerEnv('SMOKE_AUTH_USER_SCAN_MAX_PAGES', 100);
const EXPECTED_CHECKOUT_OVERRIDE = readExpectedCheckoutOverride(process.argv.slice(2));

if (EXPECTED_CHECKOUT_OVERRIDE !== 'false') {
    throw new Error('Real environment smoke requires --expect-checkout-override=false and never opens the checkout gate.');
}

const supabaseUrl = process.env.PUBLIC_SUPABASE_URL;
const anonKey = process.env.PUBLIC_SUPABASE_ANON_KEY;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const stripeSecretKey = process.env.STRIPE_SECRET_KEY;

if (!supabaseUrl || !anonKey || !serviceRoleKey || !stripeSecretKey) {
    throw new Error('Missing required environment variables for real environment smoke.');
}
const stagingSupabaseRef = 'mzjyvmlxfpzdfdjzxxyj';
if (new URL(supabaseUrl).hostname.split('.')[0] !== stagingSupabaseRef) {
    throw new Error(`Real environment smoke only accepts Supabase staging ${stagingSupabaseRef}.`);
}
if (!stripeSecretKey.startsWith('sk_test_')) {
    throw new Error('Real environment smoke refuses Stripe live credentials.');
}

const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);
const stripe = new Stripe(stripeSecretKey, { apiVersion: '2026-02-25.clover' });

type Json =
    | null
    | boolean
    | number
    | string
    | Json[]
    | { [key: string]: Json };

type RoleProfile = {
    id: string;
    email: string | null;
    full_name: string | null;
    role: string | null;
};

type SmokeStudent = {
    id: string;
    email: string;
    fullName: string;
};

type ActivePackage = PackageCatalogSnapshot & {
    id: string;
    package_prices: ActivePackagePrice[];
};

type ActivePackagePrice = PackagePriceSnapshot & {
    id: string;
    package_id: string;
};

type SessionRow = {
    id: string;
    subscription_id: string;
    status: string | null;
    scheduled_at: string | null;
    duration_minutes: number;
    meet_link: string | null;
    drive_doc_id: string | null;
    drive_doc_url: string | null;
    calendar_event_id: string | null;
    cancelled_at: string | null;
    completed_at: string | null;
    teacher_notes: string | null;
    post_class_report: Json | null;
    reminder_sent: boolean;
};

type SmokeSectionKey = 'notes' | 'drive' | 'checkout' | 'webhook' | 'billingLifecycle' | 'schedulingLifecycle' | 'adminJobs' | 'cleanup';

type SmokeResult = {
    ok: boolean;
    failedSections: SmokeSectionKey[];
    skippedSections: SmokeSectionKey[];
    executionError: Json | null;
    timestamp: string;
    remoteSchema: {
        profilesPrivateAvailable: boolean;
        profilesStillExposeLegacyPrivateColumns: boolean;
    };
    stripe: {
        activeRecurringPrices: number;
        activeOneTimePrices: number;
        packagePriceId: string | null;
        packagePrice3mId: string | null;
    };
    notes: {
        attempted: boolean;
        ok: boolean;
        status: number;
        body: Json | string;
        persistedNotes: string | null;
    };
    drive: {
        attempted: boolean;
        ok: boolean;
        status: number;
        body: Json | string;
        driveFolderId: string | null;
        driveFolderUrl: string | null;
        publicLinkPermissionBeforeLink: boolean;
        linkStatus: number;
        linkedGoogleEmail: string | null;
        publicLinkPermissionPreserved: boolean;
        explicitGooglePermissionGranted: boolean;
    };
    checkout: {
        ok: boolean;
        verificationMode: 'completed-checkout-readonly';
        status: number;
        body: Json | string;
        completedCheckoutVerified: boolean;
        checkoutIntentRecorded: boolean;
        cleanupStatus: string | null;
    };
    webhook: {
        ok: boolean;
        verificationMode: 'real-checkout-readonly';
        manualGate: string | null;
        checkoutIntentCompleted: boolean;
        subscriptionsCreated: number;
        paymentsCreated: number;
        crmOpportunityConverted: boolean;
    };
    billingLifecycle: {
        ok: boolean;
        verificationMode: 'canonical-lifecycle-evidence';
        manualGate: string | null;
        canonicalEvidenceVerified: boolean;
        processedWebhookEventsSucceeded: boolean;
        renewalPaymentFullyRefunded: boolean;
        initialPaymentPreserved: boolean;
        stripeSubscriptionId: string | null;
        stripeSubscriptionStatus: string | null;
        packagePriceMatched: boolean;
        durationMonths: number | null;
        sessionsTotal: number | null;
        paymentStatus: string | null;
    };
    schedulingLifecycle: {
        attempted: boolean;
        ok: boolean;
        error: Json | null;
        studentFolderStatus: number;
        studentFolderBody: Json | string;
        driveFolderId: string | null;
        driveFolderUrl: string | null;
        slotIso: string | null;
        initialScheduleStatus: number;
        initialSessionId: string | null;
        initialCalendarEventId: string | null;
        initialDriveDocId: string | null;
        initialConfirmationJobStatus: string | null;
        calendarEventExistsBeforeCancel: boolean;
        conflictStatus: number;
        cancelStatus: number;
        cancelledSessionStatus: string | null;
        cancellationJobStatus: string | null;
        calendarEventCleared: boolean;
        eventMissingAfterCancel: boolean;
        usageAfterSchedule: number | null;
        usageAfterCancel: number | null;
        rebookStatus: number;
        rebookSessionId: string | null;
        rebookCalendarEventId: string | null;
        usageAfterRebook: number | null;
        completeStatus: number;
        completedSessionId: string | null;
        completedSessionStatus: string | null;
        completedAtSet: boolean;
        completedReportStored: boolean;
        completedNotesStored: boolean;
        usageAfterComplete: number | null;
        noShowStatus: number;
        noShowSessionId: string | null;
        noShowSessionStatus: string | null;
        usageAfterNoShow: number | null;
        reminderUnauthorizedStatus: number;
        reminderAuthorizedStatus: number;
        reminderProcessed: number | null;
        reminderSentCount: number | null;
        reminderFailedCount: number | null;
        reminderMarkedSent: boolean;
        plannedEmailRecipients: number;
        dailyEmailRecipientsBefore: number;
        monthlyEmailRecipientsBefore: number;
        dailyEmailRecipientsAfterCoverage: number | null;
        monthlyEmailRecipientsAfterCoverage: number | null;
        dailyEmailRecipientDelta: number | null;
        monthlyEmailRecipientDelta: number | null;
        dailyEmailRecipientsAfterCleanup: number | null;
        monthlyEmailRecipientsAfterCleanup: number | null;
        dailyCleanupEmailRecipientDelta: number | null;
        monthlyCleanupEmailRecipientDelta: number | null;
        teacherDashboardStatus: number;
        teacherDashboardContainsStudent: boolean;
        teacherCalendarStatus: number;
        teacherCalendarContainsStudent: boolean;
        adminCalendarStatus: number;
        adminCalendarContainsStudent: boolean;
        adminCalendarContainsCompleted: boolean;
        adminCalendarContainsNoShow: boolean;
        cleanupCancelStatus: number;
        finalUsage: number | null;
        cleanupStatus: string | null;
    };
    adminJobs: {
        attempted: boolean;
        ok: boolean;
        adminJobsPageStatus: number;
        adminJobsPageContainsTitle: boolean;
        insertedJobId: string | null;
        failedListStatus: number;
        failedListContainsJob: boolean;
        retryStatus: number;
        retryBody: Json | string;
        retriedStatus: string | null;
        retryAuditLogged: boolean;
        pendingListStatus: number;
        pendingListContainsJob: boolean;
        cancelStatus: number;
        cancelBody: Json | string;
        cancelledStatus: string | null;
        cancelAuditLogged: boolean;
        cleanupStatus: string | null;
        error: Json | string | null;
    };
    smokeUsers: {
        reusedStudentEmail: string;
        authUsersCreated: number;
    };
    cleanup: {
        ok: boolean;
        completedCheckoutEvidencePreserved: boolean;
        profileStateRestored: boolean;
        reusableStudentPreserved: boolean;
        temporaryTeacherAvailabilityCreated: boolean;
        temporaryTeacherAvailabilityDeleted: boolean;
    };
};

type AuthJarCookie = { name: string; value: string };

async function main() {
    if (RUNTIME_PREFLIGHT_ONLY) {
        await verifyDeployedRuntimeAndCheckoutGate();
        console.log(JSON.stringify({
            ok: true,
            environment: 'staging',
            mode: 'deployed-runtime-read-only-preflight',
            expectedCheckoutOverride: EXPECTED_CHECKOUT_OVERRIDE,
            runtimeAttestationsVerified: true,
            externalWritesStarted: false,
        }, null, 2));
        return;
    }

    const timestamp = new Date().toISOString();
    const suffix = timestamp.replace(/[-:.TZ]/g, '').slice(0, 14);
    const notesText = `Smoke note ${timestamp}`;

    const result: SmokeResult = {
        ok: false,
        failedSections: [],
        skippedSections: [],
        executionError: null,
        timestamp,
        remoteSchema: {
            profilesPrivateAvailable: false,
            profilesStillExposeLegacyPrivateColumns: false,
        },
        stripe: {
            activeRecurringPrices: 0,
            activeOneTimePrices: 0,
            packagePriceId: null,
            packagePrice3mId: null,
        },
        notes: {
            attempted: false,
            ok: false,
            status: 0,
            body: '',
            persistedNotes: null,
        },
        drive: {
            attempted: false,
            ok: false,
            status: 0,
            body: '',
            driveFolderId: null,
            driveFolderUrl: null,
            publicLinkPermissionBeforeLink: false,
            linkStatus: 0,
            linkedGoogleEmail: null,
            publicLinkPermissionPreserved: false,
            explicitGooglePermissionGranted: false,
        },
        checkout: {
            ok: false,
            verificationMode: 'completed-checkout-readonly',
            status: 0,
            body: '',
            completedCheckoutVerified: false,
            checkoutIntentRecorded: false,
            cleanupStatus: null,
        },
        webhook: {
            ok: false,
            verificationMode: 'real-checkout-readonly',
            manualGate: null,
            checkoutIntentCompleted: false,
            subscriptionsCreated: 0,
            paymentsCreated: 0,
            crmOpportunityConverted: false,
        },
        billingLifecycle: {
            ok: false,
            verificationMode: 'canonical-lifecycle-evidence',
            manualGate: null,
            canonicalEvidenceVerified: false,
            processedWebhookEventsSucceeded: false,
            renewalPaymentFullyRefunded: false,
            initialPaymentPreserved: false,
            stripeSubscriptionId: null,
            stripeSubscriptionStatus: null,
            packagePriceMatched: false,
            durationMonths: null,
            sessionsTotal: null,
            paymentStatus: null,
        },
        schedulingLifecycle: {
            attempted: false,
            ok: false,
            error: null,
            studentFolderStatus: 0,
            studentFolderBody: '',
            driveFolderId: null,
            driveFolderUrl: null,
            slotIso: null,
            initialScheduleStatus: 0,
            initialSessionId: null,
            initialCalendarEventId: null,
            initialDriveDocId: null,
            initialConfirmationJobStatus: null,
            calendarEventExistsBeforeCancel: false,
            conflictStatus: 0,
            cancelStatus: 0,
            cancelledSessionStatus: null,
            cancellationJobStatus: null,
            calendarEventCleared: false,
            eventMissingAfterCancel: false,
            usageAfterSchedule: null,
            usageAfterCancel: null,
            rebookStatus: 0,
            rebookSessionId: null,
            rebookCalendarEventId: null,
            usageAfterRebook: null,
            completeStatus: 0,
            completedSessionId: null,
            completedSessionStatus: null,
            completedAtSet: false,
            completedReportStored: false,
            completedNotesStored: false,
            usageAfterComplete: null,
            noShowStatus: 0,
            noShowSessionId: null,
            noShowSessionStatus: null,
            usageAfterNoShow: null,
            reminderUnauthorizedStatus: 0,
            reminderAuthorizedStatus: 0,
            reminderProcessed: null,
            reminderSentCount: null,
            reminderFailedCount: null,
            reminderMarkedSent: false,
            plannedEmailRecipients: STAGING_SMOKE_PLANNED_RECIPIENTS,
            dailyEmailRecipientsBefore: 0,
            monthlyEmailRecipientsBefore: 0,
            dailyEmailRecipientsAfterCoverage: null,
            monthlyEmailRecipientsAfterCoverage: null,
            dailyEmailRecipientDelta: null,
            monthlyEmailRecipientDelta: null,
            dailyEmailRecipientsAfterCleanup: null,
            monthlyEmailRecipientsAfterCleanup: null,
            dailyCleanupEmailRecipientDelta: null,
            monthlyCleanupEmailRecipientDelta: null,
            teacherDashboardStatus: 0,
            teacherDashboardContainsStudent: false,
            teacherCalendarStatus: 0,
            teacherCalendarContainsStudent: false,
            adminCalendarStatus: 0,
            adminCalendarContainsStudent: false,
            adminCalendarContainsCompleted: false,
            adminCalendarContainsNoShow: false,
            cleanupCancelStatus: 0,
            finalUsage: null,
            cleanupStatus: null,
        },
        adminJobs: {
            attempted: false,
            ok: false,
            adminJobsPageStatus: 0,
            adminJobsPageContainsTitle: false,
            insertedJobId: null,
            failedListStatus: 0,
            failedListContainsJob: false,
            retryStatus: 0,
            retryBody: '',
            retriedStatus: null,
            retryAuditLogged: false,
            pendingListStatus: 0,
            pendingListContainsJob: false,
            cancelStatus: 0,
            cancelBody: '',
            cancelledStatus: null,
            cancelAuditLogged: false,
            cleanupStatus: null,
            error: null,
        },
        smokeUsers: {
            reusedStudentEmail: STUDENT_EMAIL,
            authUsersCreated: 0,
        },
        cleanup: {
            ok: false,
            completedCheckoutEvidencePreserved: false,
            profileStateRestored: false,
            reusableStudentPreserved: false,
            temporaryTeacherAvailabilityCreated: false,
            temporaryTeacherAvailabilityDeleted: true,
        },
    };

    // Every provider/configuration prerequisite is verified read-only first. The
    // gated runner invokes this same path with --preflight-only, and the full run
    // authenticates all role credentials before its first durable smoke mutation.
    const preflight = await runReadOnlyPreflight();
    result.webhook = preflight.realPaymentEvidence.webhook;
    result.billingLifecycle = preflight.realPaymentEvidence.billingLifecycle;
    result.checkout.status = preflight.checkoutGateStatus;
    result.checkout.body = 'checkout-disabled-verified';
    result.checkout.completedCheckoutVerified = preflight.realPaymentEvidence.webhook.ok;
    result.checkout.checkoutIntentRecorded = preflight.realPaymentEvidence.webhook.checkoutIntentCompleted;
    result.checkout.cleanupStatus = 'completed-checkout-evidence-preserved';
    result.checkout.ok = preflight.checkoutGateStatus === 403
        && result.checkout.completedCheckoutVerified
        && result.checkout.checkoutIntentRecorded;

    if (PREFLIGHT_ONLY) {
        console.log(JSON.stringify({
            ok: true,
            environment: 'staging',
            mode: 'read-only-preflight',
            completedCheckoutVerified: true,
            canonicalBillingLifecycleVerified: true,
            checkoutGateVerified: EXPECTED_CHECKOUT_OVERRIDE,
            runtimeAttestationsVerified: true,
            allowlistedRoleAccountsVerified: true,
            emailRecipientBudget: preflight.emailRecipientBudget,
            externalWritesStarted: false,
        }, null, 2));
        return;
    }

    const { activePackage, oneMonthOffer, teacherProfile, student, stripePrices } = preflight;
    const initialPrivateState = await getReusableStudentPrivateState(student.id);
    let runError: unknown = null;
    let teacherDrivePermissionExisted = false;
    let temporaryTeacherAvailabilityId: string | null = null;

    result.stripe.activeRecurringPrices = stripePrices.data.filter((price) => Boolean(price.recurring)).length;
    result.stripe.activeOneTimePrices = stripePrices.data.filter((price) => !price.recurring).length;
    result.stripe.packagePriceId = oneMonthOffer.stripe_price_id;
    result.stripe.packagePrice3mId = getActivePackagePrice(activePackage, 3).stripe_price_id;
    result.remoteSchema.profilesPrivateAvailable = await tableExists('profiles_private');
    result.remoteSchema.profilesStillExposeLegacyPrivateColumns = await profilesStillExposeLegacyPrivateColumns();

    try {
        const teacherSession = await createSessionCookieHeader(TEACHER_EMAIL, TEACHER_PASSWORD);
        const adminSession = await createSessionCookieHeader(ADMIN_EMAIL, ADMIN_PASSWORD);
        const studentSession = await createSessionCookieHeader(STUDENT_EMAIL, STUDENT_PASSWORD);
        if (!(await hasCanonicalAvailableSlotWithinSubscriptionWindow(teacherSession, teacherProfile.id, 50))) {
            temporaryTeacherAvailabilityId = randomUUID();
            await createTemporaryTeacherAvailability(teacherProfile.id, temporaryTeacherAvailabilityId);
            result.cleanup.temporaryTeacherAvailabilityCreated = true;
            if (!(await hasCanonicalAvailableSlotWithinSubscriptionWindow(teacherSession, teacherProfile.id, 50))) {
                throw new Error('Temporary teacher availability did not produce a canonical Google-filtered slot.');
            }
        }
        await ensurePrimaryAssignment(student.id, teacherProfile.id);

        result.notes.attempted = true;
        const notesResponse = await authedJsonFetch(teacherSession, '/api/update-student-notes', {
            method: 'POST',
            body: { studentId: student.id, notes: notesText },
        });
        result.notes.status = notesResponse.status;
        result.notes.body = notesResponse.body;
        result.notes.persistedNotes = await getStudentNotes(student.id);
        result.notes.ok = notesResponse.status === 200 && result.notes.persistedNotes === notesText;

        result.drive.attempted = true;
        const driveResponse = await authedJsonFetch(adminSession, '/api/google/create-student-folder', {
            method: 'POST',
            body: { studentId: student.id },
        });
        result.drive.status = driveResponse.status;
        result.drive.body = driveResponse.body;
        const driveState = await waitForDriveState(student.id);
        result.drive.driveFolderId = driveState?.driveFolderId ?? null;
        result.drive.driveFolderUrl = driveState?.driveFolderUrl ?? null;

        if (result.drive.driveFolderId) {
            const permissionsBeforeLink = await getDrivePermissionState(result.drive.driveFolderId);
            result.drive.publicLinkPermissionBeforeLink = permissionsBeforeLink.hasAnyonePermission;
            teacherDrivePermissionExisted = permissionsBeforeLink.userEmails.includes(TEACHER_EMAIL.toLowerCase());
            const driveLinkResponse = await authedJsonFetch(studentSession, '/api/account/link-google-drive', {
                method: 'POST',
                body: { googleAccountEmail: TEACHER_EMAIL },
            });
            result.drive.linkStatus = driveLinkResponse.status;
            const linkedDriveState = await waitForDriveState(student.id, (state) => state.googleAccountEmail === TEACHER_EMAIL);
            result.drive.linkedGoogleEmail = linkedDriveState?.googleAccountEmail ?? null;
            result.drive.driveFolderUrl = linkedDriveState?.driveFolderUrl ?? result.drive.driveFolderUrl;
            const permissionsAfterLink = await getDrivePermissionState(result.drive.driveFolderId);
            result.drive.publicLinkPermissionPreserved = permissionsAfterLink.hasAnyonePermission;
            result.drive.explicitGooglePermissionGranted = permissionsAfterLink.userEmails.includes(TEACHER_EMAIL.toLowerCase());
        }

        result.drive.ok =
            isAcceptedDriveFolderProvisioning(driveResponse, driveState) &&
            Boolean(result.drive.driveFolderId) &&
            Boolean(result.drive.driveFolderUrl) &&
            result.drive.publicLinkPermissionBeforeLink &&
            result.drive.linkStatus === 200 &&
            result.drive.linkedGoogleEmail === TEACHER_EMAIL &&
            result.drive.publicLinkPermissionPreserved &&
            result.drive.explicitGooglePermissionGranted;

        result.schedulingLifecycle = await runSchedulingLifecycleSmoke({
            suffix,
            adminSession,
            teacherSession,
            teacherProfile,
            student,
            activePackage,
            dailyEmailRecipientsBefore: preflight.emailRecipientBudget.currentDailyRecipients,
            monthlyEmailRecipientsBefore: preflight.emailRecipientBudget.currentMonthlyRecipients,
        });

        if (!result.schedulingLifecycle.ok) {
            throw new Error(`Scheduling lifecycle smoke failed: ${JSON.stringify(result.schedulingLifecycle.error ?? 'section checks did not close')}`);
        }

        result.adminJobs = await runAdminJobsRecoverySmoke({
            suffix,
            adminSession,
            student,
            activePackage,
        });
    } catch (error) {
        runError = error;
        result.executionError = redactErrorForSmokeEvidence(error) as Json;
    } finally {
        try {
            result.cleanup.temporaryTeacherAvailabilityDeleted = await deleteTemporaryTeacherAvailability(
                temporaryTeacherAvailabilityId,
                teacherProfile.id,
            );
        } catch {
            result.cleanup.temporaryTeacherAvailabilityDeleted = false;
        }
        try {
            result.cleanup.completedCheckoutEvidencePreserved = result.checkout.cleanupStatus === 'completed-checkout-evidence-preserved';
            const profileRestored = await restoreReusableStudentPrivateState(student.id, initialPrivateState);
            const drivePermissionRestored = await restoreDriveUserPermission(
                result.drive.driveFolderId,
                TEACHER_EMAIL,
                teacherDrivePermissionExisted
            );
            result.cleanup.profileStateRestored = profileRestored && drivePermissionRestored;
            result.cleanup.reusableStudentPreserved = Boolean(await getAuthUserByEmail(STUDENT_EMAIL));
            result.cleanup.ok = result.cleanup.completedCheckoutEvidencePreserved
                && result.cleanup.profileStateRestored
                && result.cleanup.reusableStudentPreserved
                && result.cleanup.temporaryTeacherAvailabilityDeleted;
        } catch {
            result.cleanup.ok = false;
        }
    }

    result.failedSections = getSmokeFailureSections(result);
    result.skippedSections = getSmokeSkippedSections(result);
    result.ok = result.failedSections.length === 0 && runError === null;
    const summaryPath = writeSmokeEvidence(result);
    console.log(JSON.stringify(redactSmokeResult(result), null, 2));
    console.log(`[real-env-smoke] Summary: ${summaryPath}`);

    if (runError) throw runError;
    if (!result.ok) throw new Error(`Real environment smoke failed sections: ${result.failedSections.join(', ')}`);
}

type VerifiedRealPaymentEvidence = {
    webhook: SmokeResult['webhook'];
    billingLifecycle: SmokeResult['billingLifecycle'];
    verifiedStudentId: string | null;
    verifiedSubscriptionId: string | null;
};

type ReadOnlySmokePreflight = {
    activePackage: ActivePackage;
    oneMonthOffer: ActivePackagePrice;
    teacherProfile: RoleProfile;
    student: SmokeStudent;
    stripePrices: Awaited<ReturnType<typeof stripe.prices.list>>;
    realPaymentEvidence: VerifiedRealPaymentEvidence;
    checkoutGateStatus: number;
    emailRecipientBudget: StagingSmokeEmailBudgetAssessment;
};

async function runReadOnlyPreflight(): Promise<ReadOnlySmokePreflight> {
    const checkoutGateStatus = await verifyDeployedRuntimeAndCheckoutGate();
    assertExactSmokeEmailAllowlist();

    const [activePackage, adminProfile, teacherProfile, studentProfile, adminAuthUser, teacherAuthUser, studentAuthUser, stripePrices] = await Promise.all([
        getActivePackage(),
        getProfileForAuthUserByEmail(ADMIN_EMAIL),
        getProfileForAuthUserByEmail(TEACHER_EMAIL),
        getProfileForAuthUserByEmail(STUDENT_EMAIL),
        getAuthUserByEmail(ADMIN_EMAIL),
        getAuthUserByEmail(TEACHER_EMAIL),
        getAuthUserByEmail(STUDENT_EMAIL),
        stripe.prices.list({ active: true, limit: 100 }),
    ]);
    if (adminProfile.role !== 'admin' || teacherProfile.role !== 'teacher' || studentProfile.role !== 'student') {
        throw new Error('Smoke role accounts do not match the required admin, teacher and student profiles.');
    }
    if ([adminAuthUser, teacherAuthUser, studentAuthUser].some((user) => !user?.email_confirmed_at)) {
        throw new Error('The existing allowlisted smoke role users must already exist with confirmed emails.');
    }

    const student: SmokeStudent = {
        id: studentProfile.id,
        email: STUDENT_EMAIL,
        fullName: studentProfile.full_name || 'Smoke Student',
    };
    const oneMonthOffer = getActivePackagePrice(activePackage, 1);
    if (oneMonthOffer.sessions_per_period < 3) {
        throw new Error('The staging smoke offer needs at least three sessions before the write phase can exercise the full scheduling lifecycle.');
    }
    await assertTestStripeOffer(oneMonthOffer);

    const realPaymentEvidence = await verifyCompletedCheckoutEvidence(COMPLETED_CHECKOUT_SESSION_ID);
    if (
        !realPaymentEvidence.webhook.ok
        || !realPaymentEvidence.billingLifecycle.ok
        || realPaymentEvidence.verifiedStudentId !== student.id
        || !realPaymentEvidence.verifiedSubscriptionId
    ) {
        throw new Error('Completed Checkout and canonical billing lifecycle evidence must match the existing allowlisted smoke student before any write.');
    }

    const { data: blockingSubscription, error: blockingSubscriptionError } = await supabaseAdmin
        .from('subscriptions')
        .select('id')
        .eq('student_id', student.id)
        .in('status', ['active', 'pending', 'paused'])
        .limit(1)
        .maybeSingle();
    if (blockingSubscriptionError) throw blockingSubscriptionError;
    if (blockingSubscription) {
        throw new Error('The reusable smoke student still has an active, pending or paused subscription; complete and verify the canonical cancellation lifecycle before the write phase.');
    }
    // Keep the quota read as the final preflight operation so the snapshot is
    // as fresh as possible before role authentication and the first mutation.
    const emailRecipientBudget = await verifyStagingSmokeEmailBudget();

    return {
        activePackage,
        oneMonthOffer,
        teacherProfile,
        student,
        stripePrices,
        realPaymentEvidence,
        checkoutGateStatus,
        emailRecipientBudget,
    };
}

async function verifyStagingSmokeEmailBudget(): Promise<StagingSmokeEmailBudgetAssessment> {
    const currentRecipients = await readEmailRecipientUsage();
    const assessment = assessStagingSmokeEmailBudget({
        currentDailyRecipients: currentRecipients.daily,
        currentMonthlyRecipients: currentRecipients.monthly,
        configuredDailyLimit: EMAIL_DAILY_RECIPIENT_LIMIT,
        configuredMonthlyLimit: EMAIL_MONTHLY_RECIPIENT_LIMIT,
        plannedSmokeRecipients: STAGING_SMOKE_PLANNED_RECIPIENTS,
    });
    if (!assessment.allowed) {
        throw new Error(
            `Staging smoke email budget rejected before writes: reason=${assessment.reason} daily=${assessment.currentDailyRecipients}+${assessment.plannedSmokeRecipients}->${assessment.projectedDailyRecipients}/${assessment.effectiveDailyLimit} monthly=${assessment.currentMonthlyRecipients}+${assessment.plannedSmokeRecipients}->${assessment.projectedMonthlyRecipients}/${assessment.effectiveMonthlyLimit}.`,
        );
    }
    return assessment;
}

async function readEmailRecipientUsage(): Promise<{ daily: number; monthly: number }> {
    const todayUtc = new Date().toISOString().slice(0, 10);
    const monthUtc = `${todayUtc.slice(0, 8)}01`;
    const { data, error } = await supabaseAdmin
        .from('email_recipient_budget_usage')
        .select('period_kind,period_start,recipient_count')
        .eq('budget_scope', 'nonproduction')
        .in('period_kind', ['day', 'month'])
        .in('period_start', [todayUtc, monthUtc]);
    if (error) throw error;
    return {
        daily: data?.find((row) =>
            row.period_kind === 'day' && row.period_start === todayUtc
        )?.recipient_count ?? 0,
        monthly: data?.find((row) =>
            row.period_kind === 'month' && row.period_start === monthUtc
        )?.recipient_count ?? 0,
    };
}

async function waitForEmailRecipientUsage(
    expectedDailyMinimum: number,
    expectedMonthlyMinimum: number,
    timeoutMs: number = 45_000,
): Promise<{ daily: number; monthly: number } | null> {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
        const current = await readEmailRecipientUsage();
        if (current.daily >= expectedDailyMinimum && current.monthly >= expectedMonthlyMinimum) {
            return current;
        }
        await sleep(500);
    }
    return null;
}

function assertExactSmokeEmailAllowlist() {
    const configured = new Set(
        EMAIL_RECIPIENT_ALLOWLIST
            .split(/[;,]/u)
            .map((email) => email.trim().toLowerCase())
            .filter(Boolean)
    );
    const required = [ADMIN_EMAIL, TEACHER_EMAIL, STUDENT_EMAIL].map((email) => email.trim().toLowerCase());
    if (required.some((email) => email.endsWith('@example.com'))) {
        throw new Error('Smoke role addresses must be existing allowlisted accounts; example.com recipients are forbidden.');
    }
    if (configured.size !== required.length || required.some((email) => !configured.has(email))) {
        throw new Error('EMAIL_RECIPIENT_ALLOWLIST must contain exactly the existing smoke admin, teacher and student accounts.');
    }
}

async function verifyDeployedRuntimeAndCheckoutGate() {
    await verifyDeployedStagingRuntime({
        baseOrigin: BASE_URL,
        env: process.env,
        expectedWebCheckoutOverride: EXPECTED_CHECKOUT_OVERRIDE,
        fulfillmentOrigin: FULFILLMENT_WORKER_URL,
        roleEmails: [ADMIN_EMAIL, TEACHER_EMAIL, STUDENT_EMAIL],
    });
    return probeCheckoutGateReadOnly(EXPECTED_CHECKOUT_OVERRIDE);
}

async function probeCheckoutGateReadOnly(expectedOverride: ExpectedCheckoutOverride) {
    const response = await fetch(`${BASE_URL}/api/create-checkout`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
            priceId: 'price_read_only_gate_probe',
            lang: 'es',
            adultConfirmed: true,
            termsAccepted: true,
            serviceStartRequested: true,
            withdrawalLossAcknowledged: true,
        }),
    });
    const expectedStatus = expectedOverride === 'true' ? 401 : 403;
    if (response.status !== expectedStatus) {
        throw new Error(`Read-only checkout gate probe expected ${expectedStatus} for override=${expectedOverride} and received ${response.status}.`);
    }
    return response.status;
}

function emptyRealPaymentEvidence(manualGate: string) {
    return {
        webhook: {
            ok: false,
            verificationMode: 'real-checkout-readonly' as const,
            manualGate,
            checkoutIntentCompleted: false,
            subscriptionsCreated: 0,
            paymentsCreated: 0,
            crmOpportunityConverted: false,
        },
        billingLifecycle: {
            ok: false,
            verificationMode: 'canonical-lifecycle-evidence' as const,
            manualGate,
            canonicalEvidenceVerified: false,
            processedWebhookEventsSucceeded: false,
            renewalPaymentFullyRefunded: false,
            initialPaymentPreserved: false,
            stripeSubscriptionId: null,
            stripeSubscriptionStatus: null,
            packagePriceMatched: false,
            durationMonths: null,
            sessionsTotal: null,
            paymentStatus: null,
        },
        verifiedStudentId: null,
        verifiedSubscriptionId: null,
    };
}

async function verifyCompletedCheckoutEvidence(rawSessionId: string | undefined): Promise<VerifiedRealPaymentEvidence> {
    const sessionId = rawSessionId?.trim();
    if (!sessionId) {
        return emptyRealPaymentEvidence(
            'Manual gate: provide SMOKE_COMPLETED_CHECKOUT_SESSION_ID for a real completed Stripe test Checkout; synthetic webhook payloads are forbidden.'
        );
    }
    if (!/^cs_test_[A-Za-z0-9_]+$/.test(sessionId)) {
        return emptyRealPaymentEvidence(
            'Manual gate failed: SMOKE_COMPLETED_CHECKOUT_SESSION_ID must identify a Stripe test-mode Checkout Session.'
        );
    }

    try {
        const session = await stripe.checkout.sessions.retrieve(sessionId, {
            expand: ['line_items', 'subscription', 'invoice'],
        });
        const metadata = session.metadata ?? {};
        if (
            session.livemode
            || session.status !== 'complete'
            || session.payment_status !== 'paid'
            || session.mode !== 'subscription'
            || !isUuid(metadata.userId)
            || !isUuid(metadata.packageId)
            || !isUuid(metadata.packagePriceId)
            || !isUuid(metadata.crmOpportunityId)
            || !isUuid(metadata.checkoutIntentId)
        ) {
            return emptyRealPaymentEvidence(
                'Manual gate failed: the supplied test Checkout Session is not a completed approved subscription Checkout.'
            );
        }

        const stripeSubscriptionId = stripeObjectId(session.subscription);
        const stripeInvoiceId = stripeObjectId(session.invoice)
            ?? stripeObjectId(
                typeof session.subscription === 'object' && session.subscription
                    ? session.subscription.latest_invoice
                    : null
            );
        if (!stripeSubscriptionId || !stripeInvoiceId) {
            return emptyRealPaymentEvidence(
                'Manual gate failed: the completed Checkout Session has no subscription/invoice evidence.'
            );
        }

        const [
            intentResult,
            subscriptionResult,
            packagePriceResult,
            paymentResult,
            opportunityResult,
        ] = await Promise.all([
            supabaseAdmin
                .from('checkout_intents')
                .select('id, opportunity_id, student_id, package_price_id, stripe_checkout_session_id, status, completed_at')
                .eq('id', metadata.checkoutIntentId)
                .maybeSingle(),
            supabaseAdmin
                .from('subscriptions')
                .select('id, student_id, package_id, package_price_id, status, duration_months, sessions_total, contracted_sessions_per_period, stripe_subscription_id, stripe_invoice_id')
                .eq('stripe_subscription_id', stripeSubscriptionId)
                .maybeSingle(),
            supabaseAdmin
                .from('package_prices')
                .select('id, package_id, duration_months, amount_cents, currency, sessions_per_period, stripe_price_id, stripe_livemode, status')
                .eq('id', metadata.packagePriceId)
                .maybeSingle(),
            supabaseAdmin
                .from('payments')
                .select('id, student_id, subscription_id, amount, currency, status, stripe_invoice_id')
                .eq('stripe_invoice_id', stripeInvoiceId)
                .maybeSingle(),
            supabaseAdmin
                .from('crm_opportunities')
                .select('id, converted_subscription_id, checkout_approved_at')
                .eq('id', metadata.crmOpportunityId)
                .maybeSingle(),
        ]);

        const queryError = intentResult.error
            ?? subscriptionResult.error
            ?? packagePriceResult.error
            ?? paymentResult.error
            ?? opportunityResult.error;
        if (queryError) throw queryError;

        const intent = intentResult.data;
        const subscription = subscriptionResult.data;
        const packagePrice = packagePriceResult.data;
        const payment = paymentResult.data;
        const opportunity = opportunityResult.data;
        const checkoutLine = session.line_items?.data[0];
        const checkoutPriceId = checkoutLine?.price?.id ?? metadata.priceId;
        const packagePriceMatched = Boolean(
            packagePrice
            && ['active', 'retired'].includes(packagePrice.status)
            && !packagePrice.stripe_livemode
            && packagePrice.package_id === metadata.packageId
            && packagePrice.stripe_price_id === checkoutPriceId
            && packagePrice.duration_months === subscription?.duration_months
            && packagePrice.sessions_per_period === subscription?.contracted_sessions_per_period
            && packagePrice.amount_cents === payment?.amount
            && packagePrice.currency === payment?.currency
        );
        const checkoutIntentCompleted = Boolean(
            intent
            && intent.status === 'completed'
            && intent.completed_at
            && intent.student_id === metadata.userId
            && intent.opportunity_id === metadata.crmOpportunityId
            && intent.package_price_id === metadata.packagePriceId
            && intent.stripe_checkout_session_id === session.id
        );
        const subscriptionProvisioned = Boolean(
            subscription
            && subscription.student_id === metadata.userId
            && subscription.package_id === metadata.packageId
            && subscription.package_price_id === metadata.packagePriceId
            && subscription.stripe_subscription_id === stripeSubscriptionId
        );
        const paymentRecorded = Boolean(
            payment
            && subscription
            && payment.student_id === metadata.userId
            && payment.subscription_id === subscription.id
            && payment.status === 'succeeded'
        );
        const crmOpportunityConverted = Boolean(
            opportunity
            && subscription
            && opportunity.converted_subscription_id === subscription.id
            && opportunity.checkout_approved_at === null
        );
        const realWebhookProvisioningOk = checkoutIntentCompleted
            && subscriptionProvisioned
            && paymentRecorded
            && packagePriceMatched
            && crmOpportunityConverted;

        const canonicalReport = readCanonicalLifecycleReport(
            BILLING_LIFECYCLE_EVIDENCE_PATH,
            session.id,
        );
        const canonicalState = await revalidateCanonicalLifecycleState(canonicalReport, metadata.userId);

        return {
            webhook: {
                ok: realWebhookProvisioningOk,
                verificationMode: 'real-checkout-readonly',
                manualGate: realWebhookProvisioningOk ? null : 'Real webhook reconciliation is incomplete or inconsistent.',
                checkoutIntentCompleted,
                subscriptionsCreated: subscriptionProvisioned ? 1 : 0,
                paymentsCreated: paymentRecorded ? 1 : 0,
                crmOpportunityConverted,
            },
            billingLifecycle: {
                ok: realWebhookProvisioningOk && canonicalState.ok,
                verificationMode: 'canonical-lifecycle-evidence',
                manualGate: null,
                canonicalEvidenceVerified: true,
                processedWebhookEventsSucceeded: canonicalState.processedWebhookEventsSucceeded,
                renewalPaymentFullyRefunded: canonicalState.renewalPaymentFullyRefunded,
                initialPaymentPreserved: canonicalState.initialPaymentPreserved,
                stripeSubscriptionId,
                stripeSubscriptionStatus: canonicalState.stripeSubscriptionStatus,
                packagePriceMatched,
                durationMonths: subscription?.duration_months ?? null,
                sessionsTotal: subscription?.sessions_total ?? null,
                paymentStatus: canonicalState.renewalPaymentStatus,
            },
            verifiedStudentId: metadata.userId,
            verifiedSubscriptionId: subscription?.id ?? null,
        };
    } catch {
        return emptyRealPaymentEvidence(
            'Canonical gate failed: the explicit completed lifecycle report or its live Stripe/Supabase state could not be verified.'
        );
    }
}

type CanonicalLifecycleState = {
    ok: true;
    stripeSubscriptionStatus: 'canceled';
    renewalPaymentStatus: 'refunded';
    processedWebhookEventsSucceeded: true;
    renewalPaymentFullyRefunded: true;
    initialPaymentPreserved: true;
};

function readCanonicalLifecycleReport(
    rawEvidencePath: string,
    checkoutSessionId: string,
): CanonicalLifecycleReportSummary {
    const evidenceRoot = path.resolve(
        process.cwd(),
        'outputs',
        'launch-staging-billing-lifecycle',
    );
    const evidencePath = path.resolve(process.cwd(), rawEvidencePath);
    const relative = path.relative(evidenceRoot, evidencePath);
    const pathParts = relative.split(path.sep);
    if (
        !relative
        || relative.startsWith('..')
        || path.isAbsolute(relative)
        || pathParts.length !== 2
        || pathParts[0] === 'checkpoints'
        || pathParts[1] !== 'summary.json'
        || !existsSync(evidencePath)
    ) {
        throw new Error('SMOKE_BILLING_LIFECYCLE_EVIDENCE_PATH must identify one explicit canonical lifecycle summary.json.');
    }

    const serialized = readFileSync(evidencePath, 'utf8');
    if (Buffer.byteLength(serialized, 'utf8') > 1_000_000) {
        throw new Error('Canonical lifecycle evidence exceeds the safe size limit.');
    }
    const report = validateCanonicalLifecycleReport(JSON.parse(serialized) as unknown, {
        checkoutSessionId,
        stripeAccountId: requireEnv('STRIPE_EXPECTED_ACCOUNT_ID'),
    });
    if (path.resolve(report.outputDir) !== path.dirname(evidencePath)) {
        throw new Error('Canonical lifecycle report outputDir does not match its explicit evidence path.');
    }
    return report;
}

async function revalidateCanonicalLifecycleState(
    report: CanonicalLifecycleReportSummary,
    expectedStudentId: string,
): Promise<CanonicalLifecycleState> {
    const evidence = report.canonicalEvidence;
    const eventEntries = [
        [evidence.webhookEventIds.checkoutCompleted, 'checkout.session.completed'],
        [evidence.webhookEventIds.initialInvoicePaid, 'invoice.paid'],
        [evidence.webhookEventIds.upcoming, 'invoice.upcoming'],
        [evidence.webhookEventIds.renewalFailed, 'invoice.payment_failed'],
        [evidence.webhookEventIds.renewalPaid, 'invoice.paid'],
        [evidence.webhookEventIds.cancellation, 'customer.subscription.deleted'],
        [evidence.webhookEventIds.partialRefund, 'charge.refunded'],
        [evidence.webhookEventIds.finalRefund, 'charge.refunded'],
    ] as const;
    const eventIds = eventEntries.map(([eventId]) => eventId);

    const [
        account,
        checkoutSession,
        stripeSubscription,
        renewalInvoice,
        initialPaymentIntent,
        recoveredPaymentIntent,
        partialRefund,
        finalRefund,
        localSubscriptionResult,
        localPaymentsResult,
        processedEventsResult,
    ] = await Promise.all([
        stripe.accounts.retrieve(),
        stripe.checkout.sessions.retrieve(evidence.checkoutSessionId),
        stripe.subscriptions.retrieve(evidence.subscriptionId),
        stripe.invoices.retrieve(evidence.renewalInvoiceId),
        stripe.paymentIntents.retrieve(evidence.initialPaymentIntentId),
        stripe.paymentIntents.retrieve(evidence.recoveredPaymentIntentId),
        stripe.refunds.retrieve(evidence.partialRefundId),
        stripe.refunds.retrieve(evidence.finalRefundId),
        supabaseAdmin
            .from('subscriptions')
            .select('id, student_id, status, stripe_subscription_id, stripe_invoice_id')
            .eq('stripe_subscription_id', evidence.subscriptionId)
            .single(),
        supabaseAdmin
            .from('payments')
            .select('id, student_id, subscription_id, amount, currency, status, stripe_payment_intent_id, stripe_invoice_id, amount_refunded')
            .in('stripe_invoice_id', [evidence.initialInvoiceId, evidence.renewalInvoiceId]),
        supabaseAdmin
            .from('processed_webhook_events')
            .select('stripe_event_id, event_type, processing_status, processing_error, processed_at')
            .in('stripe_event_id', eventIds),
    ]);

    const queryError = localSubscriptionResult.error
        ?? localPaymentsResult.error
        ?? processedEventsResult.error;
    if (queryError) throw queryError;
    const localSubscription = localSubscriptionResult.data;
    if (!localSubscription) throw new Error('Canonical lifecycle local subscription is missing.');
    const localPayments = localPaymentsResult.data ?? [];
    if (localPayments.length !== 2) {
        throw new Error('Canonical lifecycle requires exactly the initial and recovered local payments.');
    }
    const processedEvents = processedEventsResult.data ?? [];
    const initialPayment = localPayments.find((payment) => payment.stripe_invoice_id === evidence.initialInvoiceId);
    const renewalPayment = localPayments.find((payment) => payment.stripe_invoice_id === evidence.renewalInvoiceId);
    const paidInvoicePayments = await stripe.invoicePayments.list({
        invoice: evidence.renewalInvoiceId,
        status: 'paid',
        limit: 100,
    });
    const renewalInvoicePaymentIntents = paidInvoicePayments.data.filter((payment) => (
        payment.payment.type === 'payment_intent'
        && stripeObjectId(payment.payment.payment_intent) === evidence.recoveredPaymentIntentId
    ));
    const initialCharge = await retrieveCanonicalCharge(initialPaymentIntent, evidence.customerId);
    const recoveredCharge = await retrieveCanonicalCharge(recoveredPaymentIntent, evidence.customerId);

    const processedWebhookEventsSucceeded = processedEvents.length === eventEntries.length
        && eventEntries.every(([eventId, eventType]) => processedEvents.some((event) => (
            event.stripe_event_id === eventId
            && event.event_type === eventType
            && event.processing_status === 'succeeded'
            && event.processing_error === null
            && Boolean(event.processed_at)
        )));
    const renewalPaymentFullyRefunded = Boolean(
        renewalPayment
        && renewalPayment.status === 'refunded'
        && renewalPayment.amount > 1
        && renewalPayment.amount_refunded === renewalPayment.amount
        && renewalPayment.amount === renewalInvoice.amount_paid
        && renewalPayment.currency === renewalInvoice.currency
        && renewalPayment.stripe_payment_intent_id === evidence.recoveredPaymentIntentId
        && renewalPayment.subscription_id === localSubscription.id
        && renewalPayment.student_id === expectedStudentId
        && recoveredCharge.refunded
        && recoveredCharge.amount_refunded === recoveredCharge.amount
        && recoveredCharge.amount === renewalInvoice.amount_paid
        && partialRefund.status === 'succeeded'
        && finalRefund.status === 'succeeded'
        && stripeObjectId(partialRefund.payment_intent) === evidence.recoveredPaymentIntentId
        && stripeObjectId(finalRefund.payment_intent) === evidence.recoveredPaymentIntentId
        && partialRefund.amount + finalRefund.amount === recoveredCharge.amount
    );
    const initialPaymentPreserved = Boolean(
        initialPayment
        && initialPayment.status === 'succeeded'
        && initialPayment.amount_refunded === 0
        && initialPayment.stripe_payment_intent_id === evidence.initialPaymentIntentId
        && initialPayment.subscription_id === localSubscription.id
        && initialPayment.student_id === expectedStudentId
        && !initialCharge.refunded
        && initialCharge.amount_refunded === 0
    );
    const exactFinalState = account.id === report.scope.stripeAccountId
        && checkoutSession.id === evidence.checkoutSessionId
        && stripeObjectId(checkoutSession.subscription) === evidence.subscriptionId
        && stripeObjectId(checkoutSession.invoice) === evidence.initialInvoiceId
        && stripeSubscription.status === 'canceled'
        && stripeObjectId(stripeSubscription.customer) === evidence.customerId
        && renewalInvoice.status === 'paid'
        && renewalInvoice.amount_paid > 1
        && canonicalInvoiceSubscriptionId(renewalInvoice) === evidence.subscriptionId
        && stripeObjectId(renewalInvoice.customer) === evidence.customerId
        && renewalInvoicePaymentIntents.length === 1
        && recoveredPaymentIntent.status === 'succeeded'
        && recoveredPaymentIntent.amount_received === renewalInvoice.amount_paid
        && initialPaymentIntent.status === 'succeeded'
        && localSubscription.student_id === expectedStudentId
        && localSubscription.status === 'cancelled'
        && localSubscription.stripe_invoice_id === evidence.renewalInvoiceId
        && processedWebhookEventsSucceeded
        && renewalPaymentFullyRefunded
        && initialPaymentPreserved;
    if (!exactFinalState) {
        throw new Error('Canonical lifecycle evidence no longer matches terminal Stripe/Supabase state.');
    }

    return {
        ok: true,
        stripeSubscriptionStatus: 'canceled',
        renewalPaymentStatus: 'refunded',
        processedWebhookEventsSucceeded: true,
        renewalPaymentFullyRefunded: true,
        initialPaymentPreserved: true,
    };
}

async function retrieveCanonicalCharge(
    paymentIntent: Stripe.PaymentIntent,
    expectedCustomerId: string,
): Promise<Stripe.Charge> {
    if (paymentIntent.livemode || stripeObjectId(paymentIntent.customer) !== expectedCustomerId) {
        throw new Error('Canonical lifecycle PaymentIntent ownership or mode is invalid.');
    }
    const chargeId = stripeObjectId(paymentIntent.latest_charge);
    if (!chargeId) throw new Error('Canonical lifecycle PaymentIntent has no charge.');
    const charge = await stripe.charges.retrieve(chargeId);
    if (
        charge.livemode
        || stripeObjectId(charge.customer) !== expectedCustomerId
        || stripeObjectId(charge.payment_intent) !== paymentIntent.id
    ) {
        throw new Error('Canonical lifecycle charge ownership or mode is invalid.');
    }
    return charge;
}

function canonicalInvoiceSubscriptionId(invoice: Stripe.Invoice): string | null {
    const current = invoice.parent?.subscription_details?.subscription;
    if (current) return stripeObjectId(current);
    return stripeObjectId((invoice as unknown as { subscription?: string | { id: string } | null }).subscription);
}

function stripeObjectId(value: string | { id: string } | null | undefined): string | null {
    return typeof value === 'string' ? value : value?.id ?? null;
}

function isUuid(value: string | null | undefined): value is string {
    return typeof value === 'string'
        && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

async function runSchedulingLifecycleSmoke(options: {
    suffix: string;
    adminSession: string;
    teacherSession: string;
    teacherProfile: RoleProfile;
    student: SmokeStudent;
    activePackage: ActivePackage;
    dailyEmailRecipientsBefore: number;
    monthlyEmailRecipientsBefore: number;
}): Promise<SmokeResult['schedulingLifecycle']> {
    const result: SmokeResult['schedulingLifecycle'] = {
        attempted: true,
        ok: false,
        error: null,
        studentFolderStatus: 0,
        studentFolderBody: '',
        driveFolderId: null,
        driveFolderUrl: null,
        slotIso: null,
        initialScheduleStatus: 0,
        initialSessionId: null,
        initialCalendarEventId: null,
        initialDriveDocId: null,
        initialConfirmationJobStatus: null,
        calendarEventExistsBeforeCancel: false,
        conflictStatus: 0,
        cancelStatus: 0,
        cancelledSessionStatus: null,
        cancellationJobStatus: null,
        calendarEventCleared: false,
        eventMissingAfterCancel: false,
        usageAfterSchedule: null,
        usageAfterCancel: null,
        rebookStatus: 0,
        rebookSessionId: null,
        rebookCalendarEventId: null,
        usageAfterRebook: null,
        completeStatus: 0,
        completedSessionId: null,
        completedSessionStatus: null,
        completedAtSet: false,
        completedReportStored: false,
        completedNotesStored: false,
        usageAfterComplete: null,
        noShowStatus: 0,
        noShowSessionId: null,
        noShowSessionStatus: null,
        usageAfterNoShow: null,
        reminderUnauthorizedStatus: 0,
        reminderAuthorizedStatus: 0,
        reminderProcessed: null,
        reminderSentCount: null,
        reminderFailedCount: null,
        reminderMarkedSent: false,
        plannedEmailRecipients: STAGING_SMOKE_PLANNED_RECIPIENTS,
        dailyEmailRecipientsBefore: options.dailyEmailRecipientsBefore,
        monthlyEmailRecipientsBefore: options.monthlyEmailRecipientsBefore,
        dailyEmailRecipientsAfterCoverage: null,
        monthlyEmailRecipientsAfterCoverage: null,
        dailyEmailRecipientDelta: null,
        monthlyEmailRecipientDelta: null,
        dailyEmailRecipientsAfterCleanup: null,
        monthlyEmailRecipientsAfterCleanup: null,
        dailyCleanupEmailRecipientDelta: null,
        monthlyCleanupEmailRecipientDelta: null,
        teacherDashboardStatus: 0,
        teacherDashboardContainsStudent: false,
        teacherCalendarStatus: 0,
        teacherCalendarContainsStudent: false,
        adminCalendarStatus: 0,
        adminCalendarContainsStudent: false,
        adminCalendarContainsCompleted: false,
        adminCalendarContainsNoShow: false,
        cleanupCancelStatus: 0,
        finalUsage: null,
        cleanupStatus: null,
    };

    let schedulingSubscriptionId: string | null = null;
    try {

    const studentFolderResponse = await authedJsonFetch(options.adminSession, '/api/google/create-student-folder', {
        method: 'POST',
        body: { studentId: options.student.id },
    });
    result.studentFolderStatus = studentFolderResponse.status;
    result.studentFolderBody = studentFolderResponse.body;
    const studentDriveState = await waitForDriveState(options.student.id);
    result.driveFolderId = studentDriveState?.driveFolderId ?? null;
    result.driveFolderUrl = studentDriveState?.driveFolderUrl ?? null;

    const schedulingSubscription = await createSchedulingSubscription(options.student.id, options.activePackage);
    schedulingSubscriptionId = schedulingSubscription.id;
    const scheduledCandidate = await scheduleFirstAvailableSession({
        teacherSession: options.teacherSession,
        teacherId: options.teacherProfile.id,
        studentId: options.student.id,
        subscriptionEndDate: schedulingSubscription.ends_at,
        durationMinutes: 50,
    });
    const slot = scheduledCandidate.slot;
    result.slotIso = slot.toISOString();
    result.initialScheduleStatus = scheduledCandidate.response.status;

    const initialSessionId = extractSessionId(scheduledCandidate.response.body);
    result.initialSessionId = initialSessionId;
    const initialSession = initialSessionId
        ? await waitForSessionState(initialSessionId, (session) => Boolean(session.calendar_event_id && session.drive_doc_id))
        : null;

    result.initialCalendarEventId = initialSession?.calendar_event_id ?? null;
    result.initialDriveDocId = initialSession?.drive_doc_id ?? null;
    const initialConfirmationJob = initialSessionId
        ? await waitForSessionFulfillmentJob(initialSessionId, 'session_fulfillment')
        : null;
    result.initialConfirmationJobStatus = initialConfirmationJob?.status ?? null;
    result.calendarEventExistsBeforeCancel = initialSession?.calendar_event_id
        ? Boolean(await getEvent(initialSession.calendar_event_id))
        : false;
    result.usageAfterSchedule = await getSubscriptionUsage(schedulingSubscription.id);

    const conflictResponse = await authedJsonFetch(options.teacherSession, '/api/calendar/sessions', {
        method: 'POST',
        body: {
            studentId: options.student.id,
            scheduledAt: slot.toISOString(),
            durationMinutes: 50,
            autoCreateMeeting: true,
        },
    });
    result.conflictStatus = conflictResponse.status;

    const cancelResponse = initialSessionId
        ? await authedJsonFetch(options.teacherSession, '/api/calendar/session-action', {
            method: 'POST',
            body: {
                sessionId: initialSessionId,
                action: 'cancel',
                reason: `Smoke cancellation ${options.suffix}`,
            },
        })
        : { status: 0, body: 'missing session id' as Json | string };
    result.cancelStatus = cancelResponse.status;

    const cancelledSession = initialSessionId
        ? await waitForSessionState(initialSessionId, (session) =>
            session.status === 'cancelled' && session.calendar_event_id === null && session.meet_link === null
        )
        : null;
    result.cancelledSessionStatus = cancelledSession?.status ?? null;
    const cancellationJob = initialSessionId
        ? await waitForSessionFulfillmentJob(initialSessionId, 'session_cancellation')
        : null;
    result.cancellationJobStatus = cancellationJob?.status ?? null;
    result.calendarEventCleared = Boolean(cancelledSession && cancelledSession.calendar_event_id === null && cancelledSession.meet_link === null);
    if (initialSession?.calendar_event_id) {
        const cancelledEvent = await getEvent(initialSession.calendar_event_id);
        result.eventMissingAfterCancel = cancelledEvent === null || cancelledEvent.status === 'cancelled';
    }
    result.usageAfterCancel = await getSubscriptionUsage(schedulingSubscription.id);

    const rebookCandidate = await createNoEmailSchedulingVariant({
        studentId: options.student.id,
        teacherId: options.teacherProfile.id,
        teacherEmail: options.teacherProfile.email || TEACHER_EMAIL,
        subscriptionId: schedulingSubscription.id,
        durationMinutes: 50,
        preferredSlot: slot,
    });
    const rebookResponse = rebookCandidate.response;
    result.rebookStatus = rebookResponse.status;

    const rebookSessionId = extractSessionId(rebookResponse.body);
    result.rebookSessionId = rebookSessionId;
    const rebookSession = rebookSessionId
        ? await waitForSessionState(rebookSessionId, (session) => Boolean(session.calendar_event_id && session.drive_doc_id))
        : null;
    result.rebookCalendarEventId = rebookSession?.calendar_event_id ?? null;
    result.usageAfterRebook = await getSubscriptionUsage(schedulingSubscription.id);

    const completeCandidate = await createNoEmailSchedulingVariant({
        studentId: options.student.id,
        teacherId: options.teacherProfile.id,
        teacherEmail: options.teacherProfile.email || TEACHER_EMAIL,
        subscriptionId: schedulingSubscription.id,
        durationMinutes: 50,
    });
    const completedSessionId = extractSessionId(completeCandidate.response.body);
    result.completedSessionId = completedSessionId;
    const completedScheduledSession = completedSessionId
        ? await waitForSessionState(completedSessionId, (session) => Boolean(session.drive_doc_id))
        : null;

    if (completedSessionId) {
        await convertSessionToPastWithoutRealtimeArtifacts(completedSessionId, completedScheduledSession?.calendar_event_id ?? null, 180);
        const completeResponse = await authedJsonFetch(options.teacherSession, '/api/calendar/session-action', {
            method: 'POST',
            body: {
                sessionId: completedSessionId,
                action: 'complete',
                notes: `Smoke completion notes ${options.suffix}`,
                report: {
                    fluency_score: 4,
                    grammar_score: 5,
                    vocabulary_score: 4,
                    homework_text: `Smoke homework ${options.suffix}`,
                    teacher_comments: `Smoke completion notes ${options.suffix}`,
                },
            },
        });
        result.completeStatus = completeResponse.status;
    }

    const completedSession = completedSessionId
        ? await waitForSessionState(completedSessionId, (session) => session.status === 'completed' && Boolean(session.completed_at))
        : null;
    result.completedSessionStatus = completedSession?.status ?? null;
    result.completedAtSet = Boolean(completedSession?.completed_at);
    result.completedReportStored = Boolean(completedSession?.post_class_report);
    result.completedNotesStored = completedSession?.teacher_notes === `Smoke completion notes ${options.suffix}`;
    result.usageAfterComplete = await getSubscriptionUsage(schedulingSubscription.id);

    const noShowCandidate = await createNoEmailSchedulingVariant({
        studentId: options.student.id,
        teacherId: options.teacherProfile.id,
        teacherEmail: options.teacherProfile.email || TEACHER_EMAIL,
        subscriptionId: schedulingSubscription.id,
        durationMinutes: 50,
    });
    const noShowSessionId = extractSessionId(noShowCandidate.response.body);
    result.noShowSessionId = noShowSessionId;
    const noShowScheduledSession = noShowSessionId
        ? await waitForSessionState(noShowSessionId, (session) => Boolean(session.drive_doc_id))
        : null;

    if (noShowSessionId) {
        await convertSessionToPastWithoutRealtimeArtifacts(noShowSessionId, noShowScheduledSession?.calendar_event_id ?? null, 300);
        const noShowResponse = await authedJsonFetch(options.teacherSession, '/api/calendar/session-action', {
            method: 'POST',
            body: {
                sessionId: noShowSessionId,
                action: 'no_show',
            },
        });
        result.noShowStatus = noShowResponse.status;
    }

    const noShowSession = noShowSessionId
        ? await waitForSessionState(noShowSessionId, (session) => session.status === 'no_show')
        : null;
    result.noShowSessionStatus = noShowSession?.status ?? null;
    result.usageAfterNoShow = await getSubscriptionUsage(schedulingSubscription.id);

    const reminderSmokeMarker = `SMOKE-REMINDER-${options.suffix}`;
    const reminderSession = await createReminderSession({
        studentId: options.student.id,
        teacherId: options.teacherProfile.id,
        subscriptionId: schedulingSubscription.id,
        smokeMarker: reminderSmokeMarker,
    });
    const exactReminderUrl = `${FULFILLMENT_WORKER_URL}/internal/reminders/send-exact`;
    const exactReminderBody = {
        sessionId: reminderSession.id,
        studentId: options.student.id,
        teacherId: options.teacherProfile.id,
        subscriptionId: schedulingSubscription.id,
        smokeMarker: reminderSmokeMarker,
    };
    const reminderUnauthorizedResponse = await fetch(exactReminderUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(exactReminderBody),
    });
    result.reminderUnauthorizedStatus = reminderUnauthorizedResponse.status;

    const reminderAuthorizedResponse = await fetch(exactReminderUrl, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${INTERNAL_JOB_SECRET}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(exactReminderBody),
    });
    result.reminderAuthorizedStatus = reminderAuthorizedResponse.status;
    const reminderBody = await readJsonOrText(reminderAuthorizedResponse);
    if (reminderBody && typeof reminderBody === 'object' && !Array.isArray(reminderBody)) {
        result.reminderProcessed = typeof reminderBody.processed === 'number' ? reminderBody.processed : null;
        result.reminderSentCount = typeof reminderBody.sent === 'number' ? reminderBody.sent : null;
        result.reminderFailedCount = typeof reminderBody.failed === 'number' ? reminderBody.failed : null;
    }
    result.reminderMarkedSent = await waitForReminderSent(reminderSession.id);

    const teacherDashboardResponse = await authedTextFetch(options.teacherSession, '/es/campus/teacher');
    result.teacherDashboardStatus = teacherDashboardResponse.status;
    result.teacherDashboardContainsStudent = teacherDashboardResponse.body.includes(options.student.fullName) || teacherDashboardResponse.body.includes(options.student.email);

    const teacherCalendarResponse = await authedTextFetch(options.teacherSession, '/es/campus/teacher/calendar');
    result.teacherCalendarStatus = teacherCalendarResponse.status;
    result.teacherCalendarContainsStudent = teacherCalendarResponse.body.includes(options.student.fullName) || teacherCalendarResponse.body.includes(options.student.email);

    const adminCalendarResponse = await authedTextFetch(options.adminSession, '/es/campus/admin/calendar');
    result.adminCalendarStatus = adminCalendarResponse.status;
    result.adminCalendarContainsStudent = adminCalendarResponse.body.includes(options.student.fullName) || adminCalendarResponse.body.includes(options.student.email);
    result.adminCalendarContainsCompleted = adminCalendarResponse.body.includes('"status":"completed"') || adminCalendarResponse.body.includes('completed');
    result.adminCalendarContainsNoShow = adminCalendarResponse.body.includes('"status":"no_show"') || adminCalendarResponse.body.includes('no_show');

    const cleanupCancelResponse = rebookSessionId
        ? await cancelSchedulingVariantWithoutEmail({
            sessionId: rebookSessionId,
            actorId: options.teacherProfile.id,
            reason: `Smoke cleanup ${options.suffix}`,
        })
        : { status: 0, body: 'missing rebook session id' as Json | string };
    result.cleanupCancelStatus = cleanupCancelResponse.status;

    if (rebookSessionId) {
        await waitForSessionState(rebookSessionId, (session) => session.status === 'cancelled');
    }
    result.finalUsage = await getSubscriptionUsage(schedulingSubscription.id);
    const emailRecipientsAfterCoverage = await waitForEmailRecipientUsage(
        options.dailyEmailRecipientsBefore + STAGING_SMOKE_PLANNED_RECIPIENTS,
        options.monthlyEmailRecipientsBefore + STAGING_SMOKE_PLANNED_RECIPIENTS,
    );
    result.dailyEmailRecipientsAfterCoverage = emailRecipientsAfterCoverage?.daily ?? null;
    result.monthlyEmailRecipientsAfterCoverage = emailRecipientsAfterCoverage?.monthly ?? null;
    result.dailyEmailRecipientDelta = result.dailyEmailRecipientsAfterCoverage === null
        ? null
        : result.dailyEmailRecipientsAfterCoverage - options.dailyEmailRecipientsBefore;
    result.monthlyEmailRecipientDelta = result.monthlyEmailRecipientsAfterCoverage === null
        ? null
        : result.monthlyEmailRecipientsAfterCoverage - options.monthlyEmailRecipientsBefore;

    result.ok =
        isAcceptedDriveFolderProvisioning(studentFolderResponse, studentDriveState) &&
        Boolean(result.driveFolderId) &&
        Boolean(result.driveFolderUrl) &&
        result.initialScheduleStatus === 201 &&
        Boolean(result.initialSessionId) &&
        Boolean(result.initialCalendarEventId) &&
        Boolean(result.initialDriveDocId) &&
        result.initialConfirmationJobStatus === 'succeeded' &&
        result.calendarEventExistsBeforeCancel &&
        result.usageAfterSchedule === 1 &&
        result.conflictStatus === 409 &&
        result.cancelStatus === 200 &&
        result.cancelledSessionStatus === 'cancelled' &&
        result.cancellationJobStatus === 'succeeded' &&
        result.calendarEventCleared &&
        result.eventMissingAfterCancel &&
        result.usageAfterCancel === 0 &&
        result.rebookStatus === 201 &&
        Boolean(result.rebookSessionId) &&
        Boolean(result.rebookCalendarEventId) &&
        result.usageAfterRebook === 1 &&
        result.completeStatus === 200 &&
        Boolean(result.completedSessionId) &&
        result.completedSessionStatus === 'completed' &&
        result.completedAtSet &&
        result.completedReportStored &&
        result.completedNotesStored &&
        result.usageAfterComplete === 2 &&
        result.noShowStatus === 200 &&
        Boolean(result.noShowSessionId) &&
        result.noShowSessionStatus === 'no_show' &&
        result.usageAfterNoShow === 3 &&
        result.reminderUnauthorizedStatus === 401 &&
        result.reminderAuthorizedStatus === 200 &&
        (result.reminderProcessed ?? 0) >= 1 &&
        (result.reminderSentCount ?? 0) >= 2 &&
        (result.reminderFailedCount ?? 0) === 0 &&
        result.reminderMarkedSent &&
        result.teacherDashboardStatus === 200 &&
        result.teacherDashboardContainsStudent &&
        result.teacherCalendarStatus === 200 &&
        result.teacherCalendarContainsStudent &&
        result.adminCalendarStatus === 200 &&
        result.adminCalendarContainsStudent &&
        result.adminCalendarContainsCompleted &&
        result.adminCalendarContainsNoShow &&
        result.cleanupCancelStatus === 200 &&
        result.finalUsage === 2 &&
        result.plannedEmailRecipients === STAGING_SMOKE_PLANNED_RECIPIENTS &&
        result.dailyEmailRecipientDelta === STAGING_SMOKE_PLANNED_RECIPIENTS &&
        result.monthlyEmailRecipientDelta === STAGING_SMOKE_PLANNED_RECIPIENTS;
    } catch (error) {
        result.error = redactErrorForSmokeEvidence(error) as Json;
    } finally {
        if (schedulingSubscriptionId) {
            try {
                const cleaned = await cleanupSchedulingSmokeArtifacts(options.student.id, schedulingSubscriptionId);
                result.cleanupStatus = cleaned ? 'deleted_sessions_subscription_and_google_artifacts' : 'cleanup_failed';
                const emailRecipientsAfterCleanup = await readEmailRecipientUsage();
                result.dailyEmailRecipientsAfterCleanup = emailRecipientsAfterCleanup.daily;
                result.monthlyEmailRecipientsAfterCleanup = emailRecipientsAfterCleanup.monthly;
                result.dailyCleanupEmailRecipientDelta = result.dailyEmailRecipientsAfterCoverage === null
                    ? null
                    : result.dailyEmailRecipientsAfterCleanup - result.dailyEmailRecipientsAfterCoverage;
                result.monthlyCleanupEmailRecipientDelta = result.monthlyEmailRecipientsAfterCoverage === null
                    ? null
                    : result.monthlyEmailRecipientsAfterCleanup - result.monthlyEmailRecipientsAfterCoverage;
                result.ok = result.ok
                    && cleaned
                    && result.dailyCleanupEmailRecipientDelta === 0
                    && result.monthlyCleanupEmailRecipientDelta === 0;
            } catch (cleanupError) {
                result.cleanupStatus = 'cleanup_failed';
                result.error ??= redactErrorForSmokeEvidence(cleanupError) as Json;
                result.ok = false;
            }
        }
    }

    return result;
}

async function runAdminJobsRecoverySmoke(options: {
    suffix: string;
    adminSession: string;
    student: SmokeStudent;
    activePackage: ActivePackage;
}): Promise<SmokeResult['adminJobs']> {
    const result: SmokeResult['adminJobs'] = {
        attempted: true,
        ok: false,
        adminJobsPageStatus: 0,
        adminJobsPageContainsTitle: false,
        insertedJobId: null,
        failedListStatus: 0,
        failedListContainsJob: false,
        retryStatus: 0,
        retryBody: '',
        retriedStatus: null,
        retryAuditLogged: false,
        pendingListStatus: 0,
        pendingListContainsJob: false,
        cancelStatus: 0,
        cancelBody: '',
        cancelledStatus: null,
        cancelAuditLogged: false,
        cleanupStatus: null,
        error: null,
    };

    try {
        const adminJobsPage = await authedTextFetch(options.adminSession, '/es/campus/admin/jobs');
        result.adminJobsPageStatus = adminJobsPage.status;
        result.adminJobsPageContainsTitle = adminJobsPage.body.includes('Jobs operativos');

        const insertedJob = await createSmokeFailedFulfillmentJob(options);
        result.insertedJobId = insertedJob.id;

        const failedListResponse = await authedJsonFetch(options.adminSession, '/api/admin/fulfillment-jobs?status=failed&limit=100');
        result.failedListStatus = failedListResponse.status;
        result.failedListContainsJob = jsonBodyContainsJobId(failedListResponse.body, insertedJob.id);

        const retryResponse = await authedJsonFetch(options.adminSession, '/api/admin/fulfillment-jobs', {
            method: 'POST',
            body: { action: 'retry', jobId: insertedJob.id },
        });
        result.retryStatus = retryResponse.status;
        result.retryBody = retryResponse.body;

        const retriedJob = await waitForFulfillmentJobState(insertedJob.id, (job) => job.status === 'pending');
        result.retriedStatus = retriedJob?.status ?? null;
        result.retryAuditLogged = await waitForAdminJobAudit(insertedJob.id, 'fulfillment_job.retry');

        const pendingListResponse = await authedJsonFetch(options.adminSession, '/api/admin/fulfillment-jobs?status=pending&limit=100');
        result.pendingListStatus = pendingListResponse.status;
        result.pendingListContainsJob = jsonBodyContainsJobId(pendingListResponse.body, insertedJob.id);

        const cancelResponse = await authedJsonFetch(options.adminSession, '/api/admin/fulfillment-jobs', {
            method: 'POST',
            body: { action: 'cancel', jobId: insertedJob.id },
        });
        result.cancelStatus = cancelResponse.status;
        result.cancelBody = cancelResponse.body;

        const cancelledJob = await waitForFulfillmentJobState(insertedJob.id, (job) => job.status === 'cancelled');
        result.cancelledStatus = cancelledJob?.status ?? null;
        result.cancelAuditLogged = await waitForAdminJobAudit(insertedJob.id, 'fulfillment_job.cancel');
        result.cleanupStatus = result.cancelledStatus === 'cancelled' ? 'cancelled_via_admin_api' : null;

        result.ok =
            result.adminJobsPageStatus === 200 &&
            result.adminJobsPageContainsTitle &&
            Boolean(result.insertedJobId) &&
            result.failedListStatus === 200 &&
            result.failedListContainsJob &&
            result.retryStatus === 200 &&
            result.retriedStatus === 'pending' &&
            result.retryAuditLogged &&
            result.pendingListStatus === 200 &&
            result.pendingListContainsJob &&
            result.cancelStatus === 200 &&
            result.cancelledStatus === 'cancelled' &&
            result.cancelAuditLogged;
    } catch (error) {
        result.error = redactErrorForSmokeEvidence(error) as Json;
    } finally {
        if (result.insertedJobId && result.cancelledStatus !== 'cancelled') {
            result.cleanupStatus = await cancelSmokeFulfillmentJobDirectly(result.insertedJobId);
        }
        if (result.insertedJobId) {
            const deleted = await deleteSmokeFulfillmentJobArtifacts(result.insertedJobId);
            result.cleanupStatus = deleted ? 'deleted_job_and_audit_rows' : 'cleanup_failed:job_or_audit_remains';
            result.ok = result.ok && deleted;
        }
    }

    return result;
}

async function getProfileForAuthUserByEmail(email: string): Promise<RoleProfile> {
    const user = await getAuthUserByEmail(email);
    if (!user) {
        throw new Error(`Auth user not found for ${email}`);
    }

    const { data: profile, error } = await supabaseAdmin
        .from('profiles')
        .select('id,email,full_name,role')
        .eq('id', user.id)
        .single();

    if (error || !profile) {
        throw error ?? new Error(`Profile not found for ${email}`);
    }

    return profile;
}

async function getAuthUserByEmail(email: string) {
    let page = 1;
    while (page <= SMOKE_AUTH_USER_SCAN_MAX_PAGES) {
        const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage: 100 });
        if (error) {
            throw error;
        }

        const users = data.users as unknown as User[];
        const user = users.find((entry) => entry.email === email);
        if (user) {
            return user;
        }

        if (users.length < 100) {
            break;
        }

        page += 1;
    }

    return null;
}

async function ensurePrimaryAssignment(studentId: string, teacherId: string) {
    const { error: deleteError } = await supabaseAdmin
        .from('student_teachers')
        .delete()
        .eq('student_id', studentId);

    if (deleteError) {
        throw deleteError;
    }

    const { error: insertError } = await supabaseAdmin
        .from('student_teachers')
        .insert({
            student_id: studentId,
            teacher_id: teacherId,
            is_primary: true,
        });

    if (insertError) {
        throw insertError;
    }
}

type ReusableStudentPrivateState = {
    notes: string | null;
    google_account_email: string | null;
    teacherAssignments: Array<{ teacher_id: string; is_primary: boolean | null }>;
};

async function getReusableStudentPrivateState(studentId: string): Promise<ReusableStudentPrivateState> {
    const [privateResult, assignmentResult] = await Promise.all([
        supabaseAdmin.from('profiles_private').select('notes, google_account_email').eq('profile_id', studentId).single(),
        supabaseAdmin.from('student_teachers').select('teacher_id, is_primary').eq('student_id', studentId),
    ]);
    const error = privateResult.error ?? assignmentResult.error;
    if (error || !privateResult.data) throw error ?? new Error('Reusable smoke student private profile is missing.');
    return {
        ...privateResult.data,
        teacherAssignments: assignmentResult.data ?? [],
    };
}

async function restoreReusableStudentPrivateState(studentId: string, state: ReusableStudentPrivateState) {
    const { error: privateError } = await supabaseAdmin
        .from('profiles_private')
        .update({
            notes: state.notes,
            google_account_email: state.google_account_email,
        })
        .eq('profile_id', studentId);
    if (privateError) return false;

    const { error: assignmentDeleteError } = await supabaseAdmin
        .from('student_teachers')
        .delete()
        .eq('student_id', studentId);
    if (assignmentDeleteError) return false;

    if (state.teacherAssignments.length > 0) {
        const { error: assignmentInsertError } = await supabaseAdmin
            .from('student_teachers')
            .insert(state.teacherAssignments.map((assignment) => ({
                student_id: studentId,
                teacher_id: assignment.teacher_id,
                is_primary: assignment.is_primary,
            })));
        if (assignmentInsertError) return false;
    }
    return true;
}

async function createSmokeFailedFulfillmentJob(options: {
    suffix: string;
    student: SmokeStudent;
    activePackage: ActivePackage;
}) {
    const inertSessionId = crypto.randomUUID();
    const { data, error } = await supabaseAdmin
        .from('fulfillment_jobs')
        .insert({
            job_type: 'session_fulfillment',
            status: 'failed',
            student_id: options.student.id,
            payload: {
                sessionId: inertSessionId,
                autoCreateMeeting: false,
                sendEmail: false,
                smoke_managed: true,
                source: 'real-env-smoke',
                suffix: options.suffix,
            },
            attempts: 2,
            max_attempts: 5,
            run_at: new Date().toISOString(),
            last_error: `Smoke controlled failure ${options.suffix}`,
        })
        .select('id,status,attempts,last_error,run_at')
        .single();

    if (error || !data) {
        throw error ?? new Error('Could not create smoke fulfillment job');
    }

    return data;
}

async function cancelSmokeFulfillmentJobDirectly(jobId: string) {
    const { error } = await supabaseAdmin
        .from('fulfillment_jobs')
        .update({
            status: 'cancelled',
            locked_at: null,
            locked_by: null,
        })
        .eq('id', jobId);

    return error ? `cleanup_failed:${error.code || 'unknown'}` : 'cancelled_directly';
}

async function deleteSmokeFulfillmentJobArtifacts(jobId: string) {
    const { error: auditDeleteError } = await supabaseAdmin
        .from('admin_audit_log')
        .delete()
        .eq('entity_type', 'fulfillment_job')
        .eq('entity_id', jobId);
    if (auditDeleteError) return false;

    const { error: jobDeleteError } = await supabaseAdmin
        .from('fulfillment_jobs')
        .delete()
        .eq('id', jobId)
        .eq('status', 'cancelled');
    if (jobDeleteError) return false;

    const { data: remaining, error: verifyError } = await supabaseAdmin
        .from('fulfillment_jobs')
        .select('id')
        .eq('id', jobId)
        .maybeSingle();
    return !verifyError && remaining === null;
}

async function waitForFulfillmentJobState(
    jobId: string,
    predicate: (job: { status: string | null }) => boolean,
    timeoutMs: number = 15_000
) {
    const startedAt = Date.now();

    while (Date.now() - startedAt < timeoutMs) {
        const { data, error } = await supabaseAdmin
            .from('fulfillment_jobs')
            .select('id,status,attempts,last_error,run_at')
            .eq('id', jobId)
            .maybeSingle();

        if (error) {
            throw error;
        }

        if (data && predicate(data)) {
            return data;
        }

        await sleep(500);
    }

    return null;
}

async function waitForSessionFulfillmentJob(
    sessionId: string,
    jobType: 'session_fulfillment' | 'session_cancellation',
    timeoutMs: number = 45_000,
) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
        const { data, error } = await supabaseAdmin
            .from('fulfillment_jobs')
            .select('id,status')
            .eq('session_id', sessionId)
            .eq('job_type', jobType)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();
        if (error) throw error;
        if (data && ['succeeded', 'failed', 'cancelled'].includes(data.status ?? '')) {
            return data;
        }
        await sleep(500);
    }
    return null;
}

async function waitForAdminJobAudit(jobId: string, action: 'fulfillment_job.retry' | 'fulfillment_job.cancel') {
    const startedAt = Date.now();

    while (Date.now() - startedAt < 10_000) {
        const { data, error } = await supabaseAdmin
            .from('admin_audit_log')
            .select('id')
            .eq('entity_type', 'fulfillment_job')
            .eq('entity_id', jobId)
            .eq('action', action)
            .limit(1);

        if (error) {
            throw error;
        }

        if ((data?.length ?? 0) > 0) {
            return true;
        }

        await sleep(500);
    }

    return false;
}

function jsonBodyContainsJobId(body: Json | string, jobId: string) {
    return typeof body !== 'string' && JSON.stringify(body).includes(jobId);
}

async function getActivePackage(): Promise<ActivePackage> {
    const { data, error } = await supabaseAdmin
        .from('packages')
        .select(`
            id,
            name,
            catalog_version,
            price_monthly,
            sessions_per_month,
            has_group_session,
            has_dual_teacher,
            is_active,
            stripe_product_id,
            stripe_price_1m,
            stripe_price_3m,
            stripe_price_6m,
            package_prices (
                id,
                package_id,
                catalog_version,
                package_key,
                duration_months,
                amount_cents,
                currency,
                sessions_per_month,
                sessions_per_period,
                has_group_session,
                has_dual_teacher,
                status,
                stripe_account_id,
                stripe_livemode,
                stripe_price_id,
                stripe_product_id
            )
        `)
        .eq('is_active', true)
        .in('name', ['standard', 'bootcamp']);

    if (error) {
        throw error;
    }

    const candidates = (data as unknown as ActivePackage[])
        .filter((pkg) => isPackageKeyCheckoutEligible(pkg.name))
        .map((pkg) => ({ pkg, offers: getCheckoutReadyPackageOffers(pkg) }))
        .filter((candidate) => candidate.offers !== null)
        .sort((left, right) => (
            Number(right.pkg.name === 'standard') - Number(left.pkg.name === 'standard')
        ));
    const activePackage = candidates[0]?.pkg;
    if (!activePackage) {
        throw new Error('No checkout-eligible Standard or Bootcamp package has an exact canonical offer set.');
    }

    return activePackage;
}

function getActivePackagePrice(activePackage: ActivePackage, durationMonths: number): ActivePackagePrice {
    if (!isPackageDuration(durationMonths)) {
        throw new Error(`Unsupported package duration ${durationMonths}.`);
    }
    const offer = getCheckoutReadyPackageOffers(activePackage)?.get(durationMonths) as ActivePackagePrice | undefined;
    if (!isPackageKeyCheckoutEligible(activePackage.name) || !offer) {
        throw new Error(`Active package is missing a coherent ${durationMonths}-month package_price.`);
    }
    return offer;
}

async function assertTestStripeOffer(offer: ActivePackagePrice) {
    const [account, price] = await Promise.all([
        stripe.accounts.retrieve(),
        stripe.prices.retrieve(offer.stripe_price_id),
    ]);
    const productId = typeof price.product === 'string' ? price.product : price.product.id;
    if (offer.stripe_livemode || price.livemode) {
        throw new Error('The automated real-environment smoke refuses live Stripe writes.');
    }
    if (
        account.id !== offer.stripe_account_id
        || !price.active
        || price.unit_amount !== offer.amount_cents
        || price.currency !== offer.currency
        || productId !== offer.stripe_product_id
        || price.recurring?.interval !== 'month'
        || price.recurring.interval_count !== offer.duration_months
    ) {
        throw new Error('The package_price does not match the connected Stripe test account.');
    }
}

async function createSessionCookieHeader(email: string, password: string) {
    const jar: AuthJarCookie[] = [];
    const supabase = createBrowserClient(supabaseUrl!, anonKey!, {
        cookies: {
            getAll() {
                return jar;
            },
            setAll(cookiesToSet) {
                for (const cookie of cookiesToSet) {
                    const nextCookie = { name: cookie.name, value: cookie.value };
                    const index = jar.findIndex((entry) => entry.name === cookie.name);
                    if (index >= 0) {
                        jar[index] = nextCookie;
                    } else {
                        jar.push(nextCookie);
                    }
                }
            },
        },
    });

    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
        throw error;
    }

    if (jar.length === 0) {
        throw new Error(`No auth cookies generated for ${redactSmokeString(email, 'email')}`);
    }

    return jar.map((cookie) => `${cookie.name}=${cookie.value}`).join('; ');
}

async function authedJsonFetch(cookieHeader: string, path: string, options?: { method?: string; body?: Json }) {
    const response = await fetch(`${BASE_URL}${path}`, {
        method: options?.method ?? 'GET',
        headers: {
            Cookie: cookieHeader,
            'Content-Type': 'application/json',
        },
        body: options?.body ? JSON.stringify(options.body) : undefined,
    });

    return {
        status: response.status,
        body: await readJsonOrText(response),
    };
}

async function readJsonOrText(response: Response) {
    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
        return (await response.json()) as Json;
    }

    return await response.text();
}

async function getStudentNotes(studentId: string) {
    if (await tableExists('profiles_private')) {
        const { data, error } = await supabaseAdmin
            .from('profiles_private')
            .select('notes')
            .eq('profile_id', studentId)
            .maybeSingle();

        if (error) {
            throw error;
        }

        return data?.notes ?? null;
    }

    const { data, error } = await supabaseAdmin
        .from('profiles')
        .select('notes')
        .eq('id', studentId)
        .single();

    if (error) {
        throw error;
    }

    return data.notes;
}

async function waitForDriveState(
    studentId: string,
    predicate?: (state: { driveFolderId: string | null; driveFolderUrl: string | null; googleAccountEmail: string | null }) => boolean,
    timeoutMs: number = 30_000
) {
    const startedAt = Date.now();

    while (Date.now() - startedAt < timeoutMs) {
        const driveState = await getDriveState(studentId);
        if (driveState && (!predicate ? Boolean(driveState.driveFolderId) : predicate(driveState))) {
            return driveState;
        }
        await sleep(1_000);
    }

    return null;
}

async function getDriveState(studentId: string) {
    if (await tableExists('profiles_private')) {
        const { data, error } = await supabaseAdmin
            .from('profiles_private')
            .select('drive_folder_id,drive_folder_url,google_account_email')
            .eq('profile_id', studentId)
            .maybeSingle();

        if (error) {
            throw error;
        }

        return {
            driveFolderId: data?.drive_folder_id ?? null,
            driveFolderUrl: data?.drive_folder_url ?? null,
            googleAccountEmail: data?.google_account_email ?? null,
        };
    }

    const { data, error } = await supabaseAdmin
        .from('profiles')
        .select('drive_folder_id')
        .eq('id', studentId)
        .single();

    if (error) {
        throw error;
    }

    return {
        driveFolderId: data.drive_folder_id,
        driveFolderUrl: data.drive_folder_id ? `https://drive.google.com/drive/folders/${data.drive_folder_id}` : null,
        googleAccountEmail: null,
    };
}

async function getDrivePermissionState(folderId: string) {
    const drive = getDriveClient();
    const { data } = await drive.permissions.list({
        fileId: folderId,
        fields: 'permissions(id,type,role,emailAddress)',
    });

    const permissions = data.permissions || [];
    return {
        hasAnyonePermission: permissions.some((permission) => permission.type === 'anyone'),
        userEmails: permissions
            .filter((permission) => permission.type === 'user' && permission.emailAddress)
            .map((permission) => permission.emailAddress!.toLowerCase()),
    };
}

async function restoreDriveUserPermission(folderId: string | null, email: string, existedBefore: boolean) {
    if (!folderId || existedBefore) return true;
    const drive = getDriveClient();
    const { data } = await drive.permissions.list({
        fileId: folderId,
        fields: 'permissions(id,type,emailAddress)',
    });
    const permission = (data.permissions ?? []).find((candidate) =>
        candidate.type === 'user'
        && candidate.emailAddress?.toLowerCase() === email.toLowerCase()
        && candidate.id
    );
    if (permission?.id) {
        await drive.permissions.delete({ fileId: folderId, permissionId: permission.id });
    }
    const after = await getDrivePermissionState(folderId);
    return !after.userEmails.includes(email.toLowerCase());
}

async function tableExists(tableName: string) {
    const selector = tableName === 'profiles_private' ? 'profile_id' : 'id';
    const { error } = await supabaseAdmin.from(tableName).select(selector).limit(1);
    return !error;
}

async function profilesStillExposeLegacyPrivateColumns() {
    const { error } = await supabaseAdmin
        .from('profiles')
        .select('drive_folder_id,notes,current_level,stripe_customer_id')
        .limit(1);

    return !error;
}

async function authedTextFetch(cookieHeader: string, path: string) {
    const response = await fetch(`${BASE_URL}${path}`, {
        headers: {
            Cookie: cookieHeader,
        },
    });

    return {
        status: response.status,
        body: await response.text(),
    };
}

function getSmokeFailureSections(result: SmokeResult): SmokeSectionKey[] {
    return smokeSectionStatuses(result)
        .filter(([, status]) => status === 'failed')
        .map(([section]) => section);
}

function getSmokeSkippedSections(result: SmokeResult): SmokeSectionKey[] {
    return smokeSectionStatuses(result)
        .filter(([, status]) => status === 'skipped')
        .map(([section]) => section);
}

function addMonthsToDateString(dateString: string, months: number) {
    const date = new Date(`${dateString}T00:00:00.000Z`);
    date.setMonth(date.getMonth() + months);
    return toIsoDate(date);
}

async function createSchedulingSubscription(studentId: string, activePackage: ActivePackage) {
    const startsAt = toIsoDate(new Date());
    const endsAt = addMonthsToDateString(startsAt, 1);
    const oneMonthOffer = getActivePackagePrice(activePackage, 1);
    const { data, error } = await supabaseAdmin
        .from('subscriptions')
        .insert({
            student_id: studentId,
            package_id: activePackage.id,
            package_price_id: oneMonthOffer.id,
            status: 'active',
            duration_months: 1,
            starts_at: startsAt,
            ends_at: endsAt,
            sessions_total: oneMonthOffer.sessions_per_period,
            contracted_sessions_per_period: oneMonthOffer.sessions_per_period,
            sessions_used: 0,
        })
        .select('id,student_id,package_id,status,duration_months,starts_at,ends_at,sessions_total,sessions_used,stripe_subscription_id,stripe_invoice_id,created_at')
        .single();

    if (error) {
        throw error;
    }

    return data;
}

async function cleanupSchedulingSmokeArtifacts(studentId: string, subscriptionId: string) {
    const { data: sessions, error: sessionReadError } = await supabaseAdmin
        .from('sessions')
        .select('id, calendar_event_id, drive_doc_id')
        .eq('student_id', studentId)
        .eq('subscription_id', subscriptionId);
    if (sessionReadError) return false;

    const drive = getDriveClient();
    for (const session of sessions ?? []) {
        if (session.calendar_event_id && !(await cancelClassEvent(session.calendar_event_id))) {
            return false;
        }
        if (session.drive_doc_id) {
            try {
                await drive.files.delete({ fileId: session.drive_doc_id });
            } catch (error) {
                const status = typeof error === 'object' && error !== null && 'code' in error
                    ? Number((error as { code?: number }).code)
                    : undefined;
                if (status !== 404 && status !== 410) return false;
            }
        }
    }

    const { error: sessionDeleteError } = await supabaseAdmin
        .from('sessions')
        .delete()
        .eq('student_id', studentId)
        .eq('subscription_id', subscriptionId);
    if (sessionDeleteError) return false;

    const { error: subscriptionDeleteError } = await supabaseAdmin
        .from('subscriptions')
        .delete()
        .eq('id', subscriptionId)
        .eq('student_id', studentId)
        .is('stripe_subscription_id', null)
        .is('stripe_invoice_id', null);
    if (subscriptionDeleteError) return false;

    const [{ data: remainingSession, error: sessionVerifyError }, { data: remainingSubscription, error: subscriptionVerifyError }] = await Promise.all([
        supabaseAdmin.from('sessions').select('id').eq('subscription_id', subscriptionId).limit(1).maybeSingle(),
        supabaseAdmin.from('subscriptions').select('id').eq('id', subscriptionId).maybeSingle(),
    ]);
    return !sessionVerifyError && !subscriptionVerifyError && remainingSession === null && remainingSubscription === null;
}

async function createNoEmailSchedulingVariant(options: {
    studentId: string;
    teacherId: string;
    teacherEmail: string;
    subscriptionId: string;
    durationMinutes: number;
    preferredSlot?: Date;
}) {
    const generatedSlots = buildNoEmailSchedulingCandidateSlots();
    const candidateSlots = options.preferredSlot
        ? [
            new Date(options.preferredSlot),
            ...generatedSlots.filter((slot) => slot.getTime() !== options.preferredSlot!.getTime()),
        ]
        : generatedSlots;
    let lastFailure: { slot: string; reason: string } | null = null;

    for (const slot of candidateSlots) {
        const end = new Date(slot.getTime() + options.durationMinutes * 60_000);
        if (!(await isGoogleSlotAvailableForSmoke(options.teacherEmail, slot, end))) {
            lastFailure = { slot: slot.toISOString(), reason: 'google-calendar-busy' };
            continue;
        }

        const sessionsUsed = await getSubscriptionUsage(options.subscriptionId);
        const { data: subscription, error: subscriptionError } = await supabaseAdmin
            .from('subscriptions')
            .select('sessions_total')
            .eq('id', options.subscriptionId)
            .single();
        if (subscriptionError) throw subscriptionError;
        if (sessionsUsed >= (subscription.sessions_total ?? 0)) {
            throw new Error('No sessions remain for a no-email smoke scheduling variant.');
        }

        const { data: session, error: sessionError } = await supabaseAdmin
            .from('sessions')
            .insert({
                subscription_id: options.subscriptionId,
                student_id: options.studentId,
                teacher_id: options.teacherId,
                scheduled_at: slot.toISOString(),
                duration_minutes: options.durationMinutes,
                status: 'scheduled',
                reminder_sent: false,
            })
            .select('id')
            .single();
        if (sessionError?.code === '23P01') {
            lastFailure = { slot: slot.toISOString(), reason: 'database-conflict' };
            continue;
        }
        if (sessionError || !session) throw sessionError ?? new Error('No-email smoke session insert failed.');

        const { data: quotaUpdate, error: quotaError } = await supabaseAdmin
            .from('subscriptions')
            .update({ sessions_used: sessionsUsed + 1 })
            .eq('id', options.subscriptionId)
            .eq('sessions_used', sessionsUsed)
            .select('id')
            .maybeSingle();
        if (quotaError || !quotaUpdate) {
            await supabaseAdmin.from('sessions').delete().eq('id', session.id);
            throw quotaError ?? new Error('No-email smoke session quota update lost an optimistic race.');
        }

        // Secondary variants still exercise real Drive/Docs/Calendar/Meet
        // artifacts, but never reserve or send another Resend recipient.
        await fulfillSingleSession(supabaseAdmin, session.id, {
            autoCreateMeeting: true,
            sendEmail: false,
        });

        return {
            slot,
            response: {
                status: 201,
                body: { session: { id: session.id }, sendEmail: false } as Json,
            },
        };
    }

    throw new Error(`Could not create a no-email scheduling variant. Last failure: ${JSON.stringify(lastFailure)}`);
}

function buildNoEmailSchedulingCandidateSlots(): Date[] {
    const slots: Date[] = [];
    for (let dayOffset = 21; dayOffset < 90; dayOffset += 1) {
        for (const hour of [6, 8, 10, 12, 14, 16, 18, 20]) {
            const slot = new Date();
            slot.setUTCDate(slot.getUTCDate() + dayOffset);
            slot.setUTCHours(hour, 0, 0, 0);
            slots.push(slot);
        }
    }
    return slots;
}

async function isGoogleSlotAvailableForSmoke(teacherEmail: string, start: Date, end: Date) {
    const response = await fetch(`${FULFILLMENT_WORKER_URL}/internal/google/availability`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${INTERNAL_JOB_SECRET}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            teacherEmail,
            startTime: start.toISOString(),
            endTime: end.toISOString(),
        }),
    });
    const body = await readJsonOrText(response);
    if (!response.ok || !body || typeof body !== 'object' || Array.isArray(body)) {
        throw new Error(`Google availability preflight failed with status ${response.status}.`);
    }
    return body.available === true;
}

async function cancelSchedulingVariantWithoutEmail(options: {
    sessionId: string;
    actorId: string;
    reason: string;
}): Promise<{ status: number; body: Json | string }> {
    const session = await getSession(options.sessionId);
    if (!session) return { status: 404, body: 'missing session' };

    const { data: cancelRows, error: cancelError } = await supabaseAdmin.rpc('cancel_scheduled_session', {
        p_session_id: options.sessionId,
        p_cancelled_by: options.actorId,
        p_cancelled_by_role: 'teacher',
        p_cancellation_reason: options.reason,
    });
    if (cancelError) throw cancelError;
    if (!cancelRows?.[0]) return { status: 409, body: 'session state changed' };

    if (session.calendar_event_id && !(await cancelClassEvent(session.calendar_event_id))) {
        throw new Error('No-email cleanup could not cancel its smoke Calendar event.');
    }
    const { error: updateError } = await supabaseAdmin
        .from('sessions')
        .update({ calendar_event_id: null, meet_link: null })
        .eq('id', options.sessionId);
    if (updateError) throw updateError;

    return {
        status: 200,
        body: { success: true, sendEmail: false },
    };
}

async function scheduleFirstAvailableSession(options: {
    teacherSession: string;
    teacherId: string;
    studentId: string;
    subscriptionEndDate: string;
    durationMinutes: number;
}) {
    const probe = await findFirstSchedulableAvailableSlot<Json | string>({
        now: new Date(),
        subscriptionEndDate: options.subscriptionEndDate,
        listAvailableSlotStarts: (dateKey) => listCanonicalAvailableSlotStarts(
            options.teacherSession,
            options.teacherId,
            dateKey,
            options.durationMinutes,
        ),
        schedule: (slotStart) => authedJsonFetch(options.teacherSession, '/api/calendar/sessions', {
                method: 'POST',
                body: {
                    studentId: options.studentId,
                    scheduledAt: new Date(slotStart).toISOString(),
                    durationMinutes: options.durationMinutes,
                    autoCreateMeeting: true,
                },
            }),
    });

    if (probe.kind === 'scheduled') {
        return { slot: new Date(probe.slotStart), response: probe.response };
    }
    if (probe.kind === 'fatal') {
        throw new Error(`Scheduling probe failed at ${probe.slotStart} with status ${probe.response.status}: ${JSON.stringify(redactJsonForSmokeEvidence(probe.response.body))}`);
    }

    throw new Error(`Could not schedule any canonical available slot before the subscription end date. Last failure: ${JSON.stringify(redactJsonForSmokeEvidence(probe.lastFailure))}`);
}

async function hasCanonicalAvailableSlotWithinSubscriptionWindow(
    teacherSession: string,
    teacherId: string,
    durationMinutes: number,
): Promise<boolean> {
    const now = new Date();
    const subscriptionEndDate = addMonthsToDateString(toIsoDate(now), 1);
    for (const dateKey of buildSubscriptionCandidateDateKeys({ now, subscriptionEndDate })) {
        const slots = await listCanonicalAvailableSlotStarts(
            teacherSession,
            teacherId,
            dateKey,
            durationMinutes,
        );
        if (slots.length > 0) return true;
    }

    return false;
}

async function createTemporaryTeacherAvailability(teacherId: string, id: string): Promise<void> {
    const candidateDate = new Date();
    candidateDate.setUTCDate(candidateDate.getUTCDate() + 14);
    const dayOfWeek = candidateDate.getUTCDay();
    const candidateWindows = [
        { start: '06:17:00', end: '22:17:00' },
        { start: '05:13:00', end: '21:13:00' },
        { start: '07:19:00', end: '23:19:00' },
    ];

    const { data: existing, error: readError } = await supabaseAdmin
        .from('teacher_availability')
        .select('start_time')
        .eq('teacher_id', teacherId)
        .eq('day_of_week', dayOfWeek);
    if (readError) throw readError;

    const existingStarts = new Set((existing ?? []).map((row) => row.start_time));
    const selected = candidateWindows.find((window) => !existingStarts.has(window.start));
    if (!selected) {
        throw new Error('No collision-free temporary teacher availability window is available.');
    }

    const { data, error } = await supabaseAdmin
        .from('teacher_availability')
        .insert({
            id,
            teacher_id: teacherId,
            day_of_week: dayOfWeek,
            start_time: selected.start,
            end_time: selected.end,
            is_active: true,
        })
        .select('id')
        .single();
    if (error || data?.id !== id) throw error ?? new Error('Temporary teacher availability insert returned the wrong row.');
}

async function deleteTemporaryTeacherAvailability(id: string | null, teacherId: string): Promise<boolean> {
    if (!id) return true;

    const { error } = await supabaseAdmin
        .from('teacher_availability')
        .delete()
        .eq('id', id)
        .eq('teacher_id', teacherId)
        .select('id');
    if (error) return false;

    const { data: remaining, error: verifyError } = await supabaseAdmin
        .from('teacher_availability')
        .select('id')
        .eq('id', id)
        .maybeSingle();
    return !verifyError && remaining === null;
}

async function listCanonicalAvailableSlotStarts(
    teacherSession: string,
    teacherId: string,
    dateKey: string,
    durationMinutes: number,
) {
    const query = new URLSearchParams({
        teacherId,
        date: dateKey,
        duration: String(durationMinutes),
    });
    const response = await authedJsonFetch(
        teacherSession,
        `/api/calendar/available-slots?${query.toString()}`,
    );
    if (response.status !== 200) {
        throw new Error(`Available-slot lookup failed for ${dateKey} with status ${response.status}: ${JSON.stringify(redactJsonForSmokeEvidence(response.body))}`);
    }

    const slots = parseAvailableSlotStartsForDate(response.body, dateKey);
    if (!slots) {
        throw new Error(`Available-slot lookup returned an invalid or out-of-date payload for ${dateKey}.`);
    }
    return slots;
}

function extractSessionId(body: Json | string) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
        return null;
    }

    const session = body.session;
    if (session && typeof session === 'object' && !Array.isArray(session) && typeof session.id === 'string') {
        return session.id;
    }

    return null;
}

async function waitForSessionState(
    sessionId: string,
    predicate: (session: SessionRow) => boolean,
    timeoutMs: number = 45_000
) {
    const startedAt = Date.now();

    while (Date.now() - startedAt < timeoutMs) {
        const session = await getSession(sessionId);
        if (session && predicate(session)) {
            return session;
        }
        await sleep(1_000);
    }

    return null;
}

async function getSession(sessionId: string) {
    const { data, error } = await supabaseAdmin
        .from('sessions')
        .select('id,subscription_id,status,scheduled_at,duration_minutes,meet_link,drive_doc_id,drive_doc_url,calendar_event_id,cancelled_at,completed_at,teacher_notes,post_class_report,reminder_sent')
        .eq('id', sessionId)
        .maybeSingle();

    if (error) {
        throw error;
    }

    return data;
}

async function getSubscriptionUsage(subscriptionId: string) {
    const { data, error } = await supabaseAdmin
        .from('subscriptions')
        .select('sessions_used')
        .eq('id', subscriptionId)
        .single();

    if (error) {
        throw error;
    }

    return data.sessions_used ?? 0;
}

async function convertSessionToPastWithoutRealtimeArtifacts(sessionId: string, calendarEventId: string | null, minutesAgo: number) {
    if (calendarEventId) {
        await cancelClassEvent(calendarEventId);
    }

    for (let attempt = 0; attempt < 12; attempt += 1) {
        const scheduledAt = new Date(Date.now() - (minutesAgo + attempt * 90) * 60 * 1000).toISOString();
        const { error } = await supabaseAdmin
            .from('sessions')
            .update({
                scheduled_at: scheduledAt,
                calendar_event_id: null,
                meet_link: null,
                reminder_sent: false,
            })
            .eq('id', sessionId);

        if (!error) {
            return;
        }

        if (error.code !== '23P01') {
            throw error;
        }
    }

    throw new Error(`Could not find a non-conflicting past slot for session ${redactSmokeString(sessionId, 'sessionId')}`);
}

async function createReminderSession(options: {
    studentId: string;
    teacherId: string;
    subscriptionId: string;
    smokeMarker: string;
}) {
    for (let attempt = 0; attempt < 12; attempt += 1) {
        const scheduledAt = new Date(Date.now() + (24 * 60 + attempt * 10) * 60 * 1000).toISOString();
        const { data, error } = await supabaseAdmin
            .from('sessions')
            .insert({
                student_id: options.studentId,
                teacher_id: options.teacherId,
                subscription_id: options.subscriptionId,
                scheduled_at: scheduledAt,
                duration_minutes: 50,
                status: 'scheduled',
                reminder_sent: false,
                teacher_notes: options.smokeMarker,
            })
            .select('id,subscription_id,status,scheduled_at,duration_minutes,meet_link,drive_doc_id,drive_doc_url,calendar_event_id,cancelled_at,completed_at,teacher_notes,post_class_report,reminder_sent')
            .single();

        if (!error) {
            return data;
        }

        if (error.code !== '23P01') {
            throw error;
        }
    }

    throw new Error('Could not create a non-conflicting reminder session');
}

async function waitForReminderSent(sessionId: string, timeoutMs: number = 15_000) {
    const startedAt = Date.now();

    while (Date.now() - startedAt < timeoutMs) {
        const session = await getSession(sessionId);
        if (session?.reminder_sent) {
            return true;
        }
        await sleep(500);
    }

    return false;
}

function toIsoDate(date: Date) {
    return date.toISOString().split('T')[0];
}

function sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function writeSmokeEvidence(result: SmokeResult) {
    const outputDir = path.join(process.cwd(), 'outputs', 'real-env-smoke', stamp(new Date(result.timestamp)));
    mkdirSync(outputDir, { recursive: true });

    const redactedResult = redactSmokeResult(result);
    writeFileSync(path.join(outputDir, 'summary.json'), `${JSON.stringify(redactedResult, null, 2)}\n`, 'utf8');
    writeFileSync(path.join(outputDir, 'summary.md'), renderSmokeSummary(result), 'utf8');

    return path.join(outputDir, 'summary.md');
}

function renderSmokeSummary(result: SmokeResult) {
    const lines = [
        '# Real Environment Smoke Evidence',
        '',
        `- Status: ${result.ok ? 'OK' : 'FAILED'}`,
        `- Timestamp: ${result.timestamp}`,
        `- Base host: ${new URL(BASE_URL).host}`,
        `- Failed sections: ${result.failedSections.length === 0 ? 'none' : result.failedSections.join(', ')}`,
        `- Skipped sections: ${result.skippedSections.length === 0 ? 'none' : result.skippedSections.join(', ')}`,
        '',
        '## Scope',
        '',
        'This staging-only smoke reuses the three existing allowlisted role accounts; it never creates Auth users and never needs access to the student inbox. It calls Supabase staging, Stripe test, Google and Resend only after a read-only preflight validates every gate. The JSON evidence is redacted before it is written.',
        'Checkout stays disabled throughout and the unauthenticated probe must return `403 Checkout is disabled`. The smoke reuses `SMOKE_COMPLETED_CHECKOUT_SESSION_ID` from a real completed Checkout and preserves that evidence; it never creates or expires another Checkout Session. Billing renewal/failure/resume/cancellation requires an explicit canonical lifecycle report plus live terminal revalidation. Synthetic Stripe events are never generated.',
        '',
        '## Email Recipient Budget',
        '',
        `- Planned recipients: ${result.schedulingLifecycle.plannedEmailRecipients}`,
        `- UTC daily delta before cleanup: ${result.schedulingLifecycle.dailyEmailRecipientDelta ?? 'unverified'}; cleanup delta: ${result.schedulingLifecycle.dailyCleanupEmailRecipientDelta ?? 'unverified'}`,
        `- UTC monthly delta before cleanup: ${result.schedulingLifecycle.monthlyEmailRecipientDelta ?? 'unverified'}; cleanup delta: ${result.schedulingLifecycle.monthlyCleanupEmailRecipientDelta ?? 'unverified'}`,
        '',
        '## Sections',
        '',
        '| Section | Status |',
        '| --- | --- |',
    ];

    for (const [section, status] of smokeSectionStatuses(result)) {
        lines.push(`| ${section} | ${status} |`);
    }

    lines.push('');
    lines.push('## Evidence Files');
    lines.push('');
    lines.push('- `summary.json`: redacted structured result for the smoke run.');
    lines.push('- `summary.md`: this human-readable summary for manual evidence.');
    lines.push('');
    lines.push('## Manual Evidence Use');
    lines.push('');
    lines.push('Use this output as staging `integration_readiness` evidence. Production `final_smoke` is a separate minimal manual launch-day check; this harness must never run against production.');
    lines.push('');

    return `${lines.join('\n')}\n`;
}

function smokeSectionStatuses(result: SmokeResult): Array<[SmokeSectionKey, 'ok' | 'failed' | 'skipped']> {
    return [
        ['notes', result.notes.attempted ? (result.notes.ok ? 'ok' : 'failed') : 'skipped'],
        ['drive', result.drive.attempted ? (result.drive.ok ? 'ok' : 'failed') : 'skipped'],
        ['checkout', result.checkout.ok ? 'ok' : 'failed'],
        ['webhook', result.webhook.ok ? 'ok' : 'failed'],
        ['billingLifecycle', result.billingLifecycle.ok ? 'ok' : 'failed'],
        ['schedulingLifecycle', result.schedulingLifecycle.attempted ? (result.schedulingLifecycle.ok ? 'ok' : 'failed') : 'skipped'],
        ['adminJobs', result.adminJobs.attempted ? (result.adminJobs.ok ? 'ok' : 'failed') : 'skipped'],
        ['cleanup', result.cleanup.ok ? 'ok' : 'failed'],
    ];
}

function redactSmokeResult(result: SmokeResult) {
    return redactJsonForSmokeEvidence(result);
}

function redactJsonForSmokeEvidence(value: unknown, key = ''): unknown {
    if (typeof value === 'string') {
        return redactSmokeString(value, key);
    }

    if (Array.isArray(value)) {
        return value.map((item) => redactJsonForSmokeEvidence(item, key));
    }

    if (value && typeof value === 'object') {
        return Object.fromEntries(
            Object.entries(value).map(([entryKey, entryValue]) => [
                entryKey,
                redactJsonForSmokeEvidence(entryValue, key ? `${key}.${entryKey}` : entryKey),
            ])
        );
    }

    return value;
}

function redactSmokeString(value: string, key = '') {
    if (!value) {
        return value;
    }

    const normalizedKey = key.toLowerCase();
    const redacted = redactFreeformSmokeString(value);

    if (normalizedKey.includes('body')) {
        return redacted === value ? '[redacted-response-body]' : redacted;
    }

    if (isSensitiveSmokeOutputKey(normalizedKey)) {
        if (normalizedKey.includes('email')) {
            return redacted;
        }

        if (normalizedKey.includes('url') || normalizedKey.includes('link')) {
            return redactUrlForSmokeEvidence(value);
        }

        return `[redacted-${redactionLabelForKey(key)}]`;
    }

    return redacted;
}

function redactFreeformSmokeString(value: string) {
    return sanitizeStagingSmokeCapture(value)
        .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[redacted-email]')
        .replace(/https?:\/\/[^\s"')]+/g, (url) => redactUrlForSmokeEvidence(url))
        .replace(/\b(?:cs|cus|sub|in|pi|evt|price|prod|pm|tok)_(?:test|live)?_?[A-Za-z0-9_]+\b/g, '[redacted-stripe-id]')
        .replace(/\b(?:eyJ|ya29)[A-Za-z0-9._-]{20,}\b/g, '[redacted-token]');
}

function redactUrlForSmokeEvidence(value: string) {
    try {
        const url = new URL(value);
        return `[redacted-url:${url.hostname}]`;
    } catch {
        return '[redacted-url]';
    }
}

function isSensitiveSmokeOutputKey(normalizedKey: string) {
    return [
        'email',
        'cookie',
        'token',
        'secret',
        'signature',
        'password',
        'packagepriceid',
        'stripecustomerid',
        'stripesubscriptionid',
        'stripeinvoiceid',
        'drivefolderid',
        'drivefolderurl',
        'linkedgoogleemail',
        'calendareventid',
        'drivedocid',
        'drivedocurl',
        'meetlink',
        'sessionid',
        'rebooksessionid',
        'completedsessionid',
        'noshowsessionid',
        'jobid',
        'insertedjobid',
    ].some((fragment) => normalizedKey.includes(fragment));
}

function redactionLabelForKey(key: string) {
    const label = key.split('.').pop() || 'value';
    return label.replace(/[^a-z0-9]+/gi, '-').toLowerCase();
}

function redactErrorForSmokeEvidence(error: unknown) {
    if (error instanceof Error) {
        return {
            name: error.name,
            message: redactSmokeString(error.message, 'errorMessage'),
            stack: error.stack ? redactSmokeString(error.stack, 'stack') : undefined,
        };
    }

    return redactJsonForSmokeEvidence(error);
}

function requireEnv(name: string): string {
    const value = process.env[name]?.trim();
    if (!value) {
        throw new Error(`Missing ${name}. Real environment smoke must use explicit environment credentials and must not reset owner/teacher passwords.`);
    }
    return value;
}

function readPositiveIntegerEnv(name: string, defaultValue: number): number {
    const value = process.env[name]?.trim();
    if (!value) {
        return defaultValue;
    }

    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 1) {
        throw new Error(`${name} must be a positive integer.`);
    }

    return parsed;
}

function stamp(date: Date): string {
    return date.toISOString().replaceAll(':', '-').replaceAll('.', '-');
}

function normalizeAndConfirmSmokeBaseUrl(rawBaseUrl: string, confirmation: string): string {
    let parsedUrl: URL;
    try {
        parsedUrl = new URL(rawBaseUrl);
    } catch {
        throw new Error('SMOKE_BASE_URL must be an absolute http(s) origin before running staging smoke writes.');
    }

    if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
        throw new Error('SMOKE_BASE_URL must use http or https before running staging smoke writes.');
    }

    if ((parsedUrl.pathname !== '/' && parsedUrl.pathname !== '') || parsedUrl.search || parsedUrl.hash) {
        throw new Error('SMOKE_BASE_URL must be an origin only.');
    }

    const allowedHosts = new Set([
        'espanolhonesto-staging.alindev95.workers.dev',
    ]);
    if (!allowedHosts.has(parsedUrl.host)) {
        throw new Error('Real environment smoke only accepts the exact deployed staging Worker host.');
    }

    const expectedConfirmation = `writes-ok:${parsedUrl.host}`;
    if (confirmation !== expectedConfirmation) {
        throw new Error(
            `SMOKE_EXTERNAL_WRITES_CONFIRMATION must be "${expectedConfirmation}" for ${parsedUrl.origin}. `
            + 'This staging-only smoke reuses allowlisted role users and calls Supabase, Stripe, Google and Resend.'
        );
    }

    return parsedUrl.origin;
}

function normalizeAndConfirmFulfillmentWorkerUrl(rawUrl: string): string {
    let parsedUrl: URL;
    try {
        parsedUrl = new URL(rawUrl);
    } catch {
        throw new Error('FULFILLMENT_WORKER_URL must be an absolute staging Worker origin.');
    }

    if (
        parsedUrl.protocol !== 'https:'
        || parsedUrl.host !== 'espanol-honesto-fulfillment-staging.alindev95.workers.dev'
        || (parsedUrl.pathname !== '/' && parsedUrl.pathname !== '')
        || parsedUrl.search
        || parsedUrl.hash
    ) {
        throw new Error('Real environment smoke only accepts the exact Fulfillment staging Worker origin.');
    }
    return parsedUrl.origin;
}

function readExpectedCheckoutOverride(argv: string[]): ExpectedCheckoutOverride {
    const option = '--expect-checkout-override';
    const index = argv.indexOf(option);
    if (index === -1) return 'false';
    const value = argv[index + 1];
    if (value !== 'true' && value !== 'false') {
        throw new Error(`${option} requires true or false`);
    }
    return value;
}

main().catch((error) => {
    console.error(redactErrorForSmokeEvidence(error));
    process.exitCode = 1;
});
