import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createBrowserClient } from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';
import type { User } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import Stripe from 'stripe';
import { cancelClassEvent, getEvent } from '../../src/lib/google/calendar';
import { getDriveClient } from '../../src/lib/google/drive';
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
const COMPLETED_CHECKOUT_SESSION_ID = RUNTIME_PREFLIGHT_ONLY
    ? process.env.SMOKE_COMPLETED_CHECKOUT_SESSION_ID?.trim() ?? ''
    : requireEnv('SMOKE_COMPLETED_CHECKOUT_SESSION_ID');
const BILLING_LIFECYCLE_CONFIRMATION = RUNTIME_PREFLIGHT_ONLY
    ? process.env.SMOKE_BILLING_LIFECYCLE_MANUAL_CONFIRMATION?.trim() ?? ''
    : requireEnv('SMOKE_BILLING_LIFECYCLE_MANUAL_CONFIRMATION');
const CHECKOUT_GATE_CONFIRMATION = requireEnv('STAGING_CHECKOUT_GATE_CONFIRMATION');
const FULFILLMENT_WORKER_URL = normalizeAndConfirmFulfillmentWorkerUrl(requireEnv('FULFILLMENT_WORKER_URL'));
const INTERNAL_JOB_SECRET = requireEnv('INTERNAL_JOB_SECRET');
const SMOKE_AUTH_USER_SCAN_MAX_PAGES = readPositiveIntegerEnv('SMOKE_AUTH_USER_SCAN_MAX_PAGES', 100);
const EXPECTED_CHECKOUT_OVERRIDE = readExpectedCheckoutOverride(process.argv.slice(2));

if (EXPECTED_CHECKOUT_OVERRIDE === 'false' && !PREFLIGHT_ONLY) {
    throw new Error('--expect-checkout-override=false is valid only for a read-only preflight');
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
    duration_minutes: number | null;
    meet_link: string | null;
    drive_doc_id: string | null;
    drive_doc_url: string | null;
    calendar_event_id: string | null;
    cancelled_at: string | null;
    completed_at: string | null;
    teacher_notes: string | null;
    post_class_report: Json | null;
    reminder_sent: boolean | null;
};

type SmokeSectionKey = 'notes' | 'drive' | 'checkout' | 'webhook' | 'billingLifecycle' | 'schedulingLifecycle' | 'adminJobs' | 'cleanup';

type SmokeResult = {
    ok: boolean;
    failedSections: SmokeSectionKey[];
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
        ok: boolean;
        status: number;
        body: Json | string;
        persistedNotes: string | null;
    };
    drive: {
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
        status: number;
        body: Json | string;
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
        verificationMode: 'real-checkout-readonly';
        manualGate: string | null;
        stripeSubscriptionId: string | null;
        stripeSubscriptionStatus: string | null;
        packagePriceMatched: boolean;
        durationMonths: number | null;
        sessionsTotal: number | null;
        paymentStatus: string | null;
    };
    schedulingLifecycle: {
        ok: boolean;
        studentFolderStatus: number;
        studentFolderBody: Json | string;
        driveFolderId: string | null;
        driveFolderUrl: string | null;
        slotIso: string | null;
        initialScheduleStatus: number;
        initialSessionId: string | null;
        initialCalendarEventId: string | null;
        initialDriveDocId: string | null;
        calendarEventExistsBeforeCancel: boolean;
        conflictStatus: number;
        cancelStatus: number;
        cancelledSessionStatus: string | null;
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
        crmOpportunityDeleted: boolean;
        profileStateRestored: boolean;
        reusableStudentPreserved: boolean;
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
            ok: false,
            status: 0,
            body: '',
            persistedNotes: null,
        },
        drive: {
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
            status: 0,
            body: '',
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
            verificationMode: 'real-checkout-readonly',
            manualGate: null,
            stripeSubscriptionId: null,
            stripeSubscriptionStatus: null,
            packagePriceMatched: false,
            durationMonths: null,
            sessionsTotal: null,
            paymentStatus: null,
        },
        schedulingLifecycle: {
            ok: false,
            studentFolderStatus: 0,
            studentFolderBody: '',
            driveFolderId: null,
            driveFolderUrl: null,
            slotIso: null,
            initialScheduleStatus: 0,
            initialSessionId: null,
            initialCalendarEventId: null,
            initialDriveDocId: null,
            calendarEventExistsBeforeCancel: false,
            conflictStatus: 0,
            cancelStatus: 0,
            cancelledSessionStatus: null,
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
            crmOpportunityDeleted: false,
            profileStateRestored: false,
            reusableStudentPreserved: false,
        },
    };

    // Every provider/configuration prerequisite is verified read-only first. The
    // gated runner invokes this same path with --preflight-only, and the full run
    // authenticates all role credentials before its first durable smoke mutation.
    const preflight = await runReadOnlyPreflight();
    result.webhook = preflight.realPaymentEvidence.webhook;
    result.billingLifecycle = preflight.realPaymentEvidence.billingLifecycle;

    if (PREFLIGHT_ONLY) {
        console.log(JSON.stringify({
            ok: true,
            environment: 'staging',
            mode: 'read-only-preflight',
            completedCheckoutVerified: true,
            billingLifecycleReviewed: true,
            checkoutGateVerified: EXPECTED_CHECKOUT_OVERRIDE,
            runtimeAttestationsVerified: true,
            allowlistedRoleAccountsVerified: true,
            externalWritesStarted: false,
        }, null, 2));
        return;
    }

    const { activePackage, oneMonthOffer, teacherProfile, student, stripePrices } = preflight;
    const initialPrivateState = await getReusableStudentPrivateState(student.id);
    let checkoutApproval: { contactId: string; opportunityId: string } | null = null;
    let openCheckout: OpenSmokeCheckout | null = null;
    let runError: unknown = null;
    let teacherDrivePermissionExisted = false;

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
        await ensurePrimaryAssignment(student.id, teacherProfile.id);

        const notesResponse = await authedJsonFetch(teacherSession, '/api/update-student-notes', {
            method: 'POST',
            body: { studentId: student.id, notes: notesText },
        });
        result.notes.status = notesResponse.status;
        result.notes.body = notesResponse.body;
        result.notes.persistedNotes = await getStudentNotes(student.id);
        result.notes.ok = notesResponse.status === 200 && result.notes.persistedNotes === notesText;

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
            driveResponse.status === 200 &&
            Boolean(result.drive.driveFolderId) &&
            Boolean(result.drive.driveFolderUrl) &&
            result.drive.publicLinkPermissionBeforeLink &&
            result.drive.linkStatus === 200 &&
            result.drive.linkedGoogleEmail === TEACHER_EMAIL &&
            result.drive.publicLinkPermissionPreserved &&
            result.drive.explicitGooglePermissionGranted;

        checkoutApproval = await ensureSmokeCheckoutApproval(student, activePackage.id);
        openCheckout = {
            ok: false,
            sessionId: null,
            intentId: null,
            opportunityId: checkoutApproval.opportunityId,
        };
        try {
            const checkoutResponse = await authedJsonFetch(studentSession, '/api/create-checkout', {
                method: 'POST',
                body: {
                    priceId: oneMonthOffer.stripe_price_id,
                    lang: 'es',
                    adultConfirmed: true,
                    termsAccepted: true,
                    serviceStartRequested: true,
                    withdrawalLossAcknowledged: true,
                },
            });
            result.checkout.status = checkoutResponse.status;
            result.checkout.body = checkoutResponse.body;
            openCheckout = await verifyOpenCheckout({
                response: checkoutResponse,
                studentId: student.id,
                opportunityId: checkoutApproval.opportunityId,
                packagePrice: oneMonthOffer,
            });
            result.checkout.checkoutIntentRecorded = openCheckout.ok;
            result.checkout.ok = checkoutResponse.status === 200 && openCheckout.ok;
        } finally {
            result.checkout.cleanupStatus = await expireOpenSmokeCheckout(openCheckout);
        }

        result.schedulingLifecycle = await runSchedulingLifecycleSmoke({
            suffix,
            adminSession,
            teacherSession,
            teacherProfile,
            student,
            activePackage,
        });

        result.adminJobs = await runAdminJobsRecoverySmoke({
            suffix,
            adminSession,
            student,
            activePackage,
        });
    } catch (error) {
        runError = error;
    } finally {
        try {
            result.cleanup.crmOpportunityDeleted = checkoutApproval
                ? await deleteSmokeCheckoutArtifacts(checkoutApproval.opportunityId, openCheckout?.intentId ?? null)
                : true;
            const profileRestored = await restoreReusableStudentPrivateState(student.id, initialPrivateState);
            const drivePermissionRestored = await restoreDriveUserPermission(
                result.drive.driveFolderId,
                TEACHER_EMAIL,
                teacherDrivePermissionExisted
            );
            result.cleanup.profileStateRestored = profileRestored && drivePermissionRestored;
            result.cleanup.reusableStudentPreserved = Boolean(await getAuthUserByEmail(STUDENT_EMAIL));
            result.cleanup.ok = result.cleanup.crmOpportunityDeleted
                && result.cleanup.profileStateRestored
                && result.cleanup.reusableStudentPreserved;
        } catch {
            result.cleanup.ok = false;
        }
    }

    result.failedSections = getSmokeFailureSections(result);
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
};

async function runReadOnlyPreflight(): Promise<ReadOnlySmokePreflight> {
    await verifyDeployedRuntimeAndCheckoutGate();
    assertExactSmokeEmailAllowlist();
    if (EXPECTED_CHECKOUT_OVERRIDE === 'true') assertCheckoutGateConfirmation();

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
        throw new Error('Completed Checkout and reviewed billing lifecycle evidence must match the existing allowlisted smoke student before any write.');
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
        throw new Error('The reusable smoke student still has an active, pending or paused subscription; complete the reviewed cancellation lifecycle before the write phase.');
    }

    return {
        activePackage,
        oneMonthOffer,
        teacherProfile,
        student,
        stripePrices,
        realPaymentEvidence,
    };
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

function assertCheckoutGateConfirmation() {
    const expected = `enabled-after-separate-cloudflare-approval:${new URL(BASE_URL).host}`;
    if (CHECKOUT_GATE_CONFIRMATION !== expected) {
        throw new Error(`STAGING_CHECKOUT_GATE_CONFIRMATION must acknowledge the separately approved staging gate change for ${new URL(BASE_URL).host}.`);
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
    await probeCheckoutGateReadOnly(EXPECTED_CHECKOUT_OVERRIDE);
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
}

type OpenSmokeCheckout = {
    ok: boolean;
    sessionId: string | null;
    intentId: string | null;
    opportunityId: string;
};

async function verifyOpenCheckout(options: {
    response: { status: number; body: Json | string };
    studentId: string;
    opportunityId: string;
    packagePrice: ActivePackagePrice;
}): Promise<OpenSmokeCheckout> {
    const fallback: OpenSmokeCheckout = {
        ok: false,
        sessionId: null,
        intentId: null,
        opportunityId: options.opportunityId,
    };
    const responseBody = options.response.body;
    if (
        options.response.status !== 200
        || !responseBody
        || typeof responseBody !== 'object'
        || Array.isArray(responseBody)
    ) {
        return fallback;
    }

    const checkoutUrl = typeof responseBody.url === 'string'
        ? responseBody.url
        : null;
    const sessionId = checkoutUrl?.match(/\bcs_(?:test|live)_[A-Za-z0-9_]+/)?.[0] ?? null;
    if (!sessionId) return fallback;

    const [sessionOutcome, intentOutcome] = await Promise.allSettled([
        stripe.checkout.sessions.retrieve(sessionId),
        supabaseAdmin
            .from('checkout_intents')
            .select('id, opportunity_id, student_id, package_price_id, stripe_checkout_session_id, status')
            .eq('stripe_checkout_session_id', sessionId)
            .maybeSingle(),
    ]);
    if (sessionOutcome.status === 'rejected' || intentOutcome.status === 'rejected') {
        return { ...fallback, sessionId };
    }
    const session = sessionOutcome.value;
    const intentResult = intentOutcome.value;
    const intent = intentResult.data;
    if (intentResult.error || !intent) {
        return { ...fallback, sessionId };
    }

    return {
        ok:
            session.status === 'open'
            && !session.livemode
            && session.mode === 'subscription'
            && session.metadata?.userId === options.studentId
            && session.metadata?.packagePriceId === options.packagePrice.id
            && session.metadata?.crmOpportunityId === options.opportunityId
            && session.metadata?.checkoutIntentId === intent.id
            && intent.status === 'open'
            && intent.student_id === options.studentId
            && intent.opportunity_id === options.opportunityId
            && intent.package_price_id === options.packagePrice.id,
        sessionId,
        intentId: intent.id,
        opportunityId: options.opportunityId,
    };
}

async function expireOpenSmokeCheckout(checkout: OpenSmokeCheckout) {
    if (checkout.sessionId) {
        const session = await stripe.checkout.sessions.retrieve(checkout.sessionId);
        if (session.status === 'complete') {
            return 'preserved-complete-for-real-webhook-reconciliation';
        }
        if (session.status === 'open') {
            await stripe.checkout.sessions.expire(session.id);
        }
    }

    let intentId = checkout.intentId;
    if (!intentId && checkout.sessionId) {
        const { data: intent, error: intentReadError } = await supabaseAdmin
            .from('checkout_intents')
            .select('id')
            .eq('stripe_checkout_session_id', checkout.sessionId)
            .maybeSingle();
        if (intentReadError) throw intentReadError;
        intentId = intent?.id ?? null;
    }
    if (!intentId) {
        const { data: intent, error: intentReadError } = await supabaseAdmin
            .from('checkout_intents')
            .select('id')
            .eq('opportunity_id', checkout.opportunityId)
            .in('status', ['creating', 'open'])
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();
        if (intentReadError) throw intentReadError;
        intentId = intent?.id ?? null;
    }

    const now = new Date().toISOString();
    if (intentId) {
        const { error: intentError } = await supabaseAdmin
            .from('checkout_intents')
            .update({ status: 'expired', updated_at: now })
            .eq('id', intentId)
            .in('status', ['creating', 'open']);
        if (intentError) throw intentError;
    }

    const { error: approvalError } = await supabaseAdmin
        .from('crm_opportunities')
        .update({ checkout_approved_at: null, updated_at: now })
        .eq('id', checkout.opportunityId)
        .is('converted_subscription_id', null);
    if (approvalError) throw approvalError;

    return checkout.sessionId
        ? 'expired-test-session-and-released-approval'
        : 'released-approval-without-checkout-session';
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
            verificationMode: 'real-checkout-readonly' as const,
            manualGate,
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

        const billingConfirmation = BILLING_LIFECYCLE_CONFIRMATION;
        const expectedBillingConfirmation = 'reviewed-real-events:' + session.id;
        const billingManualGate = billingConfirmation === expectedBillingConfirmation
            ? null
            : 'Manual gate: review real Stripe test-clock renewal/failure/resume/cancellation evidence, then set SMOKE_BILLING_LIFECYCLE_MANUAL_CONFIRMATION=reviewed-real-events:<checkout-session-id>.';

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
                ok: realWebhookProvisioningOk && billingManualGate === null,
                verificationMode: 'real-checkout-readonly',
                manualGate: billingManualGate,
                stripeSubscriptionId,
                stripeSubscriptionStatus: subscription?.status ?? null,
                packagePriceMatched,
                durationMonths: subscription?.duration_months ?? null,
                sessionsTotal: subscription?.sessions_total ?? null,
                paymentStatus: payment?.status ?? null,
            },
            verifiedStudentId: metadata.userId,
            verifiedSubscriptionId: subscription?.id ?? null,
        };
    } catch {
        return emptyRealPaymentEvidence(
            'Manual gate failed: the supplied real Checkout evidence could not be verified read-only in Stripe and Supabase.'
        );
    }
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
}): Promise<SmokeResult['schedulingLifecycle']> {
    const result: SmokeResult['schedulingLifecycle'] = {
        ok: false,
        studentFolderStatus: 0,
        studentFolderBody: '',
        driveFolderId: null,
        driveFolderUrl: null,
        slotIso: null,
        initialScheduleStatus: 0,
        initialSessionId: null,
        initialCalendarEventId: null,
        initialDriveDocId: null,
        calendarEventExistsBeforeCancel: false,
        conflictStatus: 0,
        cancelStatus: 0,
        cancelledSessionStatus: null,
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
    const scheduledCandidate = await scheduleFirstAvailableSession(options.teacherSession, options.student.id, 50);
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
    result.calendarEventCleared = Boolean(cancelledSession && cancelledSession.calendar_event_id === null && cancelledSession.meet_link === null);
    if (initialSession?.calendar_event_id) {
        const cancelledEvent = await getEvent(initialSession.calendar_event_id);
        result.eventMissingAfterCancel = cancelledEvent === null || cancelledEvent.status === 'cancelled';
    }
    result.usageAfterCancel = await getSubscriptionUsage(schedulingSubscription.id);

    const rebookResponse = await authedJsonFetch(options.teacherSession, '/api/calendar/sessions', {
        method: 'POST',
        body: {
            studentId: options.student.id,
            scheduledAt: slot.toISOString(),
            durationMinutes: 50,
            autoCreateMeeting: true,
        },
    });
    result.rebookStatus = rebookResponse.status;

    const rebookSessionId = extractSessionId(rebookResponse.body);
    result.rebookSessionId = rebookSessionId;
    const rebookSession = rebookSessionId
        ? await waitForSessionState(rebookSessionId, (session) => Boolean(session.calendar_event_id && session.drive_doc_id))
        : null;
    result.rebookCalendarEventId = rebookSession?.calendar_event_id ?? null;
    result.usageAfterRebook = await getSubscriptionUsage(schedulingSubscription.id);

    const completeCandidate = await scheduleFirstAvailableSession(options.teacherSession, options.student.id, 50);
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

    const noShowCandidate = await scheduleFirstAvailableSession(options.teacherSession, options.student.id, 50);
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
        ? await authedJsonFetch(options.teacherSession, '/api/calendar/session-action', {
            method: 'POST',
            body: {
                sessionId: rebookSessionId,
                action: 'cancel',
                reason: `Smoke cleanup ${options.suffix}`,
            },
        })
        : { status: 0, body: 'missing rebook session id' as Json | string };
    result.cleanupCancelStatus = cleanupCancelResponse.status;

    if (rebookSessionId) {
        await waitForSessionState(rebookSessionId, (session) => session.status === 'cancelled');
    }
    result.finalUsage = await getSubscriptionUsage(schedulingSubscription.id);

    result.ok =
        result.studentFolderStatus === 200 &&
        Boolean(result.driveFolderId) &&
        Boolean(result.driveFolderUrl) &&
        result.initialScheduleStatus === 201 &&
        Boolean(result.initialSessionId) &&
        Boolean(result.initialCalendarEventId) &&
        Boolean(result.initialDriveDocId) &&
        result.calendarEventExistsBeforeCancel &&
        result.usageAfterSchedule === 1 &&
        result.conflictStatus === 409 &&
        result.cancelStatus === 200 &&
        result.cancelledSessionStatus === 'cancelled' &&
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
        result.finalUsage === 2;
    } finally {
        if (schedulingSubscriptionId) {
            const cleaned = await cleanupSchedulingSmokeArtifacts(options.student.id, schedulingSubscriptionId);
            result.cleanupStatus = cleaned ? 'deleted_sessions_subscription_and_google_artifacts' : 'cleanup_failed';
            result.ok = result.ok && cleaned;
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

async function ensureSmokeCheckoutApproval(student: SmokeStudent, packageId: string) {
    const now = new Date().toISOString();
    const { data: existingContact, error: contactReadError } = await supabaseAdmin
        .from('crm_contacts')
        .select('id')
        .eq('profile_id', student.id)
        .limit(1)
        .maybeSingle();
    if (contactReadError) throw contactReadError;

    const contactId = existingContact?.id as string | undefined;
    if (!contactId) {
        throw new Error('The reusable smoke student must already have the CRM contact created by the completed Checkout lifecycle.');
    }

    const { data: opportunity, error: opportunityError } = await supabaseAdmin
        .from('crm_opportunities')
        .insert({
            contact_id: contactId,
            stage: 'proposal',
            interest: 'real-env-checkout-smoke',
            preferred_package_id: packageId,
            checkout_approved_at: now,
        })
        .select('id')
        .single();
    if (opportunityError || !opportunity) {
        throw opportunityError ?? new Error('Could not create the smoke checkout approval.');
    }

    return { contactId, opportunityId: opportunity.id as string };
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

async function deleteSmokeCheckoutArtifacts(opportunityId: string, intentId: string | null) {
    const intentQuery = supabaseAdmin
        .from('checkout_intents')
        .select('id, status')
        .eq('opportunity_id', opportunityId);
    const { data: intents, error: intentReadError } = intentId
        ? await intentQuery.eq('id', intentId)
        : await intentQuery;
    if (intentReadError) throw intentReadError;
    if ((intents ?? []).some((intent) => intent.status === 'completed')) {
        throw new Error('Refusing cleanup because the smoke opportunity contains a completed checkout intent.');
    }

    const { error: intentDeleteError } = await supabaseAdmin
        .from('checkout_intents')
        .delete()
        .eq('opportunity_id', opportunityId)
        .in('status', ['expired', 'failed']);
    if (intentDeleteError) throw intentDeleteError;

    const { error: opportunityDeleteError } = await supabaseAdmin
        .from('crm_opportunities')
        .delete()
        .eq('id', opportunityId)
        .eq('interest', 'real-env-checkout-smoke')
        .is('converted_subscription_id', null);
    if (opportunityDeleteError) throw opportunityDeleteError;

    const { data: remaining, error: verifyError } = await supabaseAdmin
        .from('crm_opportunities')
        .select('id')
        .eq('id', opportunityId)
        .maybeSingle();
    if (verifyError) throw verifyError;
    return remaining === null;
}

async function createSmokeFailedFulfillmentJob(options: {
    suffix: string;
    student: SmokeStudent;
    activePackage: ActivePackage;
}) {
    const { data, error } = await supabaseAdmin
        .from('fulfillment_jobs')
        .insert({
            job_type: 'welcome_fulfillment',
            status: 'failed',
            student_id: options.student.id,
            payload: {
                userId: options.student.id,
                packageId: options.activePackage.id,
                locale: 'es',
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
        .filter(([, ok]) => !ok)
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

async function scheduleFirstAvailableSession(teacherSession: string, studentId: string, durationMinutes: number) {
    let lastFailure: { slot: string; status: number; body: Json | string } | null = null;

    for (let dayOffset = 14; dayOffset < 90; dayOffset += 1) {
        for (const hour of [6, 8, 10, 12, 14, 16, 18, 20]) {
            const slot = new Date();
            slot.setUTCDate(slot.getUTCDate() + dayOffset);
            slot.setUTCHours(hour, 0, 0, 0);

            const response = await authedJsonFetch(teacherSession, '/api/calendar/sessions', {
                method: 'POST',
                body: {
                    studentId,
                    scheduledAt: slot.toISOString(),
                    durationMinutes,
                    autoCreateMeeting: true,
                },
            });

            if (response.status === 201) {
                return { slot, response };
            }

            lastFailure = {
                slot: slot.toISOString(),
                status: response.status,
                body: response.body,
            };

            if (response.status !== 409) {
                throw new Error(`Scheduling probe failed at ${slot.toISOString()} with status ${response.status}: ${JSON.stringify(redactJsonForSmokeEvidence(response.body))}`);
            }
        }
    }

    throw new Error(`Could not schedule any candidate slot. Last failure: ${JSON.stringify(redactJsonForSmokeEvidence(lastFailure))}`);
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
        '',
        '## Scope',
        '',
        'This staging-only smoke reuses the three existing allowlisted role accounts; it never creates Auth users and never needs access to the student inbox. It calls Supabase staging, Stripe test, Google and Resend only after a read-only preflight validates every gate. The JSON evidence is redacted before it is written.',
        'Checkout creation is automated only during the runner-owned staging gate window under its separate exact Cloudflare approval; the runner restores and verifies `false` in `finally`. Webhook reconciliation requires `SMOKE_COMPLETED_CHECKOUT_SESSION_ID` from a real completed Checkout; billing renewal/failure/resume/cancellation requires the explicit reviewed-evidence gate. Synthetic Stripe events are never generated.',
        '',
        '## Sections',
        '',
        '| Section | Status |',
        '| --- | --- |',
    ];

    for (const [section, ok] of smokeSectionStatuses(result)) {
        lines.push(`| ${section} | ${ok ? 'ok' : 'failed'} |`);
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

function smokeSectionStatuses(result: SmokeResult): Array<[SmokeSectionKey, boolean]> {
    return [
        ['notes', result.notes.ok],
        ['drive', result.drive.ok],
        ['checkout', result.checkout.ok],
        ['webhook', result.webhook.ok],
        ['billingLifecycle', result.billingLifecycle.ok],
        ['schedulingLifecycle', result.schedulingLifecycle.ok],
        ['adminJobs', result.adminJobs.ok],
        ['cleanup', result.cleanup.ok],
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
    return value
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
    if (index === -1) return 'true';
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
