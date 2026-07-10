import 'dotenv/config';

import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createBrowserClient } from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';
import Stripe from 'stripe';
import { cancelClassEvent, getEvent } from '../../src/lib/google/calendar';
import { getDriveClient } from '../../src/lib/google/drive';

const BASE_URL = normalizeAndConfirmSmokeBaseUrl(
    requireEnv('SMOKE_BASE_URL'),
    requireEnv('SMOKE_EXTERNAL_WRITES_CONFIRMATION')
);
const ADMIN_EMAIL = requireEnv('SMOKE_ADMIN_EMAIL');
const ADMIN_PASSWORD = requireEnv('SMOKE_ADMIN_PASSWORD');
const TEACHER_EMAIL = requireEnv('SMOKE_TEACHER_EMAIL');
const TEACHER_PASSWORD = requireEnv('SMOKE_TEACHER_PASSWORD');
const SMOKE_STUDENT_PASSWORD = process.env.SMOKE_STUDENT_PASSWORD || `Smoke-${randomUUID()}-Aa1`;
const SMOKE_AUTH_USER_SCAN_MAX_PAGES = readPositiveIntegerEnv('SMOKE_AUTH_USER_SCAN_MAX_PAGES', 100);

const supabaseUrl = process.env.PUBLIC_SUPABASE_URL;
const anonKey = process.env.PUBLIC_SUPABASE_ANON_KEY;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
const stripeWebhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
const cronSecret = process.env.CRON_SECRET;

if (!supabaseUrl || !anonKey || !serviceRoleKey || !stripeSecretKey || !stripeWebhookSecret || !cronSecret) {
    throw new Error('Missing required environment variables for real environment smoke.');
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

type ActivePackage = {
    id: string;
    name: string;
    price_monthly: number;
    sessions_per_month: number;
    stripe_price_1m: string | null;
    stripe_price_3m: string | null;
    stripe_price_6m: string | null;
};

type BillingSubscriptionRow = {
    id: string;
    student_id: string;
    package_id: string;
    status: string | null;
    duration_months: number;
    starts_at: string;
    ends_at: string;
    sessions_total: number;
    sessions_used: number | null;
    stripe_subscription_id: string | null;
    stripe_invoice_id: string | null;
    created_at: string;
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

type SmokeSectionKey = 'notes' | 'drive' | 'checkout' | 'webhook' | 'billingLifecycle' | 'schedulingLifecycle' | 'adminJobs';

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
        publicLinkPermissionRevoked: boolean;
        explicitGooglePermissionGranted: boolean;
    };
    checkout: {
        ok: boolean;
        status: number;
        body: Json | string;
    };
    webhook: {
        ok: boolean;
        firstCallStatus: number;
        secondCallStatus: number;
        firstCallBody: Json | string;
        secondCallBody: Json | string;
        subscriptionsCreated: number;
        paymentsCreated: number;
        processedEventRows: number;
        driveFolderId: string | null;
    };
    billingLifecycle: {
        ok: boolean;
        checkoutStatus: number;
        checkoutBody: Json | string;
        stripeCustomerId: string | null;
        stripeSubscriptionId: string | null;
        stripeSubscriptionCleanupStatus: string | null;
        stripeSubscriptionCleanupError: string | null;
        initialWebhookStatus: number;
        initialSubscriptionStatus: string | null;
        initialDurationMonths: number | null;
        initialEndsAt: string | null;
        pausedAfterUpdate: boolean;
        pausedAfterFailure: boolean;
        failedPaymentRecorded: boolean;
        resumedAfterUpdate: boolean;
        renewalStatus: number;
        renewedEndsAt: string | null;
        expectedRenewedEndsAt: string | null;
        renewedSessionsTotal: number | null;
        renewedSessionsUsed: number | null;
        renewalPaymentRecorded: boolean;
        cancellationStatus: number;
        cancelledAfterDelete: boolean;
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
        checkoutStudentEmail: string;
        driveStudentEmail: string;
        lifecycleStudentEmail: string;
        schedulingStudentEmail: string;
    };
};

type AuthJarCookie = { name: string; value: string };

async function main() {
    const timestamp = new Date().toISOString();
    const suffix = timestamp.replace(/[-:.TZ]/g, '').slice(0, 14);
    const checkoutStudentEmail = `smoke-checkout-${suffix}@example.com`;
    const driveStudentEmail = `smoke-drive-${suffix}@example.com`;
    const lifecycleStudentEmail = `smoke-billing-${suffix}@example.com`;
    const schedulingStudentEmail = `smoke-scheduling-${suffix}@example.com`;
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
            publicLinkPermissionRevoked: false,
            explicitGooglePermissionGranted: false,
        },
        checkout: {
            ok: false,
            status: 0,
            body: '',
        },
        webhook: {
            ok: false,
            firstCallStatus: 0,
            secondCallStatus: 0,
            firstCallBody: '',
            secondCallBody: '',
            subscriptionsCreated: 0,
            paymentsCreated: 0,
            processedEventRows: 0,
            driveFolderId: null,
        },
        billingLifecycle: {
            ok: false,
            checkoutStatus: 0,
            checkoutBody: '',
            stripeCustomerId: null,
            stripeSubscriptionId: null,
            initialWebhookStatus: 0,
            initialSubscriptionStatus: null,
            initialDurationMonths: null,
            initialEndsAt: null,
            pausedAfterUpdate: false,
            pausedAfterFailure: false,
            failedPaymentRecorded: false,
            resumedAfterUpdate: false,
            renewalStatus: 0,
            renewedEndsAt: null,
            expectedRenewedEndsAt: null,
            renewedSessionsTotal: null,
            renewedSessionsUsed: null,
            renewalPaymentRecorded: false,
            cancellationStatus: 0,
            cancelledAfterDelete: false,
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
            checkoutStudentEmail,
            driveStudentEmail,
            lifecycleStudentEmail,
            schedulingStudentEmail,
        },
    };

    const [, teacherProfile] = await Promise.all([
        getProfileForAuthUserByEmail(ADMIN_EMAIL),
        getProfileForAuthUserByEmail(TEACHER_EMAIL),
    ]);

    const [checkoutStudent, driveStudent, lifecycleStudent, schedulingStudent, stripePrices, activePackage] = await Promise.all([
        ensureSmokeStudent(checkoutStudentEmail, `Smoke Checkout ${suffix}`),
        ensureSmokeStudent(driveStudentEmail, `Smoke Drive ${suffix}`),
        ensureSmokeStudent(lifecycleStudentEmail, `Smoke Billing ${suffix}`),
        ensureSmokeStudent(schedulingStudentEmail, `Smoke Scheduling ${suffix}`),
        stripe.prices.list({ active: true, limit: 100 }),
        getActivePackage(),
    ]);

    await Promise.all([
        ensurePrimaryAssignment(driveStudent.id, teacherProfile.id),
        ensurePrimaryAssignment(checkoutStudent.id, teacherProfile.id),
        ensurePrimaryAssignment(lifecycleStudent.id, teacherProfile.id),
        ensurePrimaryAssignment(schedulingStudent.id, teacherProfile.id),
    ]);
    await Promise.all([
        clearStudentRuntimeState(checkoutStudent.id),
        clearStudentRuntimeState(driveStudent.id),
        clearStudentRuntimeState(lifecycleStudent.id),
        clearStudentRuntimeState(schedulingStudent.id),
    ]);

    result.stripe.activeRecurringPrices = stripePrices.data.filter((price) => Boolean(price.recurring)).length;
    result.stripe.activeOneTimePrices = stripePrices.data.filter((price) => !price.recurring).length;
    result.stripe.packagePriceId = activePackage.stripe_price_1m;
    result.stripe.packagePrice3mId = activePackage.stripe_price_3m;

    result.remoteSchema.profilesPrivateAvailable = await tableExists('profiles_private');
    result.remoteSchema.profilesStillExposeLegacyPrivateColumns = await profilesStillExposeLegacyPrivateColumns();

    const teacherSession = await createSessionCookieHeader(TEACHER_EMAIL, TEACHER_PASSWORD);
    const adminSession = await createSessionCookieHeader(ADMIN_EMAIL, ADMIN_PASSWORD);
    const checkoutStudentSession = await createSessionCookieHeader(checkoutStudent.email, SMOKE_STUDENT_PASSWORD);
    const driveStudentSession = await createSessionCookieHeader(driveStudent.email, SMOKE_STUDENT_PASSWORD);
    const lifecycleStudentSession = await createSessionCookieHeader(lifecycleStudent.email, SMOKE_STUDENT_PASSWORD);

    const notesResponse = await authedJsonFetch(teacherSession, '/api/update-student-notes', {
        method: 'POST',
        body: { studentId: driveStudent.id, notes: notesText },
    });
    result.notes.status = notesResponse.status;
    result.notes.body = notesResponse.body;

    const persistedNotes = await getStudentNotes(driveStudent.id);
    result.notes.persistedNotes = persistedNotes;
    result.notes.ok = notesResponse.status === 200 && persistedNotes === notesText;

    const driveResponse = await authedJsonFetch(adminSession, '/api/google/create-student-folder', {
        method: 'POST',
        body: { studentId: driveStudent.id },
    });
    result.drive.status = driveResponse.status;
    result.drive.body = driveResponse.body;
    const driveState = await waitForDriveState(driveStudent.id);
    result.drive.driveFolderId = driveState?.driveFolderId ?? null;
    result.drive.driveFolderUrl = driveState?.driveFolderUrl ?? null;

    if (result.drive.driveFolderId) {
        const permissionsBeforeLink = await getDrivePermissionState(result.drive.driveFolderId);
        result.drive.publicLinkPermissionBeforeLink = permissionsBeforeLink.hasAnyonePermission;

        const driveLinkResponse = await authedJsonFetch(driveStudentSession, '/api/account/link-google-drive', {
            method: 'POST',
            body: { googleAccountEmail: TEACHER_EMAIL },
        });
        result.drive.linkStatus = driveLinkResponse.status;

        const linkedDriveState = await waitForDriveState(driveStudent.id, (state) => state.googleAccountEmail === TEACHER_EMAIL);
        result.drive.linkedGoogleEmail = linkedDriveState?.googleAccountEmail ?? null;
        result.drive.driveFolderUrl = linkedDriveState?.driveFolderUrl ?? result.drive.driveFolderUrl;

        const permissionsAfterLink = await getDrivePermissionState(result.drive.driveFolderId);
        result.drive.publicLinkPermissionRevoked = !permissionsAfterLink.hasAnyonePermission;
        result.drive.explicitGooglePermissionGranted = permissionsAfterLink.userEmails.includes(TEACHER_EMAIL.toLowerCase());
    }

    result.drive.ok =
        driveResponse.status === 200 &&
        Boolean(result.drive.driveFolderId) &&
        Boolean(result.drive.driveFolderUrl) &&
        result.drive.publicLinkPermissionBeforeLink &&
        result.drive.linkStatus === 200 &&
        result.drive.linkedGoogleEmail === TEACHER_EMAIL &&
        result.drive.publicLinkPermissionRevoked &&
        result.drive.explicitGooglePermissionGranted;

    const checkoutResponse = await authedJsonFetch(checkoutStudentSession, '/api/create-checkout', {
        method: 'POST',
        body: { priceId: requirePackagePrice(activePackage, 'stripe_price_1m'), lang: 'es' },
    });
    result.checkout.status = checkoutResponse.status;
    result.checkout.body = checkoutResponse.body;
    result.checkout.ok = checkoutResponse.status === 200;

    const eventId = `evt_smoke_checkout_${suffix}`;
    const webhookPayload = JSON.stringify({
        id: eventId,
        object: 'event',
        type: 'checkout.session.completed',
        data: {
            object: {
                id: `cs_smoke_${suffix}`,
                object: 'checkout.session',
                metadata: {
                    userId: checkoutStudent.id,
                    priceId: requirePackagePrice(activePackage, 'stripe_price_1m'),
                },
                amount_total: activePackage.price_monthly,
                currency: 'eur',
                invoice: `in_smoke_checkout_${suffix}`,
                payment_intent: `pi_smoke_checkout_${suffix}`,
                subscription: null,
            },
        },
    });

    const beforeWebhook = await getWebhookSideEffects(eventId, checkoutStudent.id);
    const firstWebhook = await postSignedWebhook(webhookPayload);
    result.webhook.firstCallStatus = firstWebhook.status;
    result.webhook.firstCallBody = firstWebhook.body;

    const secondWebhook = await postSignedWebhook(webhookPayload);
    result.webhook.secondCallStatus = secondWebhook.status;
    result.webhook.secondCallBody = secondWebhook.body;

    const afterWebhook = await getWebhookSideEffects(eventId, checkoutStudent.id);
    result.webhook.subscriptionsCreated = afterWebhook.subscriptionCount - beforeWebhook.subscriptionCount;
    result.webhook.paymentsCreated = afterWebhook.paymentCount - beforeWebhook.paymentCount;
    result.webhook.processedEventRows = afterWebhook.processedEventCount - beforeWebhook.processedEventCount;
    result.webhook.driveFolderId = afterWebhook.driveFolderId;
    result.webhook.ok =
        firstWebhook.status === 200 &&
        secondWebhook.status === 200 &&
        result.webhook.subscriptionsCreated === 1 &&
        result.webhook.paymentsCreated === 1 &&
        result.webhook.processedEventRows === 1 &&
        Boolean(afterWebhook.driveFolderId);

    result.billingLifecycle = await runBillingLifecycleSmoke({
        suffix,
        student: lifecycleStudent,
        studentSession: lifecycleStudentSession,
        activePackage,
    });

    result.schedulingLifecycle = await runSchedulingLifecycleSmoke({
        suffix,
        adminSession,
        teacherSession,
        teacherProfile,
        student: schedulingStudent,
        activePackage,
    });

    result.adminJobs = await runAdminJobsRecoverySmoke({
        suffix,
        adminSession,
        student: schedulingStudent,
        activePackage,
    });

    result.failedSections = getSmokeFailureSections(result);
    result.ok = result.failedSections.length === 0;
    const summaryPath = writeSmokeEvidence(result);
    console.log(JSON.stringify(redactSmokeResult(result), null, 2));
    console.log(`[real-env-smoke] Summary: ${summaryPath}`);

    if (!result.ok) {
        throw new Error(`Real environment smoke failed sections: ${result.failedSections.join(', ')}`);
    }
}

async function runBillingLifecycleSmoke(options: {
    suffix: string;
    student: SmokeStudent;
    studentSession: string;
    activePackage: ActivePackage;
}): Promise<SmokeResult['billingLifecycle']> {
    const result: SmokeResult['billingLifecycle'] = {
        ok: false,
        checkoutStatus: 0,
        checkoutBody: '',
        stripeCustomerId: null,
        stripeSubscriptionId: null,
        stripeSubscriptionCleanupStatus: null,
        stripeSubscriptionCleanupError: null,
        initialWebhookStatus: 0,
        initialSubscriptionStatus: null,
        initialDurationMonths: null,
        initialEndsAt: null,
        pausedAfterUpdate: false,
        pausedAfterFailure: false,
        failedPaymentRecorded: false,
        resumedAfterUpdate: false,
        renewalStatus: 0,
        renewedEndsAt: null,
        expectedRenewedEndsAt: null,
        renewedSessionsTotal: null,
        renewedSessionsUsed: null,
        renewalPaymentRecorded: false,
        cancellationStatus: 0,
        cancelledAfterDelete: false,
    };

    const priceId = requirePackagePrice(options.activePackage, 'stripe_price_3m');
    const checkoutResponse = await authedJsonFetch(options.studentSession, '/api/create-checkout', {
        method: 'POST',
        body: { priceId, lang: 'es' },
    });
    result.checkoutStatus = checkoutResponse.status;
    result.checkoutBody = checkoutResponse.body;

    const stripeCustomerId = await getStripeCustomerId(options.student.id);
    result.stripeCustomerId = stripeCustomerId;
    if (!stripeCustomerId) {
        return result;
    }

    await ensureSmokeCustomerFundingSource(stripeCustomerId);
    let stripeSubscriptionId: string | null = null;

    try {
        const stripeSubscription = await stripe.subscriptions.create({
            customer: stripeCustomerId,
            items: [{ price: priceId }],
            metadata: {
                userId: options.student.id,
                priceId,
                smoke_managed: 'true',
            },
            payment_behavior: 'allow_incomplete',
        });
        stripeSubscriptionId = stripeSubscription.id;
        result.stripeSubscriptionId = stripeSubscription.id;

        const initialWebhook = await postSignedWebhook(JSON.stringify({
            id: `evt_smoke_billing_checkout_${options.suffix}`,
            object: 'event',
            type: 'checkout.session.completed',
            data: {
                object: {
                    id: `cs_smoke_billing_${options.suffix}`,
                    object: 'checkout.session',
                    metadata: {
                        userId: options.student.id,
                        priceId,
                    },
                    amount_total: options.activePackage.price_monthly * 3,
                    currency: 'eur',
                    invoice: `in_smoke_billing_initial_${options.suffix}`,
                    payment_intent: `pi_smoke_billing_initial_${options.suffix}`,
                    subscription: stripeSubscription.id,
                },
            },
        }));
        result.initialWebhookStatus = initialWebhook.status;

        const initialSubscription = await waitForLatestSubscription(options.student.id, (row) => row.stripe_subscription_id === stripeSubscription.id);
        result.initialSubscriptionStatus = initialSubscription?.status ?? null;
        result.initialDurationMonths = initialSubscription?.duration_months ?? null;
        result.initialEndsAt = initialSubscription?.ends_at ?? null;

        await sendStripeEvent({
            id: `evt_smoke_billing_paused_${options.suffix}`,
            type: 'customer.subscription.updated',
            object: {
                ...stripeSubscription,
                status: 'past_due',
                metadata: {
                    ...stripeSubscription.metadata,
                    userId: options.student.id,
                    priceId,
                },
            },
        });

        const pausedSubscription = await waitForLatestSubscription(options.student.id, (row) => row.status === 'paused');
        result.pausedAfterUpdate = pausedSubscription?.status === 'paused';

        const failedInvoiceId = `in_smoke_billing_failed_${options.suffix}`;
        await sendStripeEvent({
            id: `evt_smoke_billing_failed_${options.suffix}`,
            type: 'invoice.payment_failed',
            object: {
                id: failedInvoiceId,
                object: 'invoice',
                subscription: stripeSubscription.id,
                amount_due: options.activePackage.price_monthly * 3,
                amount_remaining: options.activePackage.price_monthly * 3,
                total: options.activePackage.price_monthly * 3,
                currency: 'eur',
                payment_intent: `pi_smoke_billing_failed_${options.suffix}`,
            },
        });

        const pausedAfterFailure = await waitForLatestSubscription(options.student.id, (row) => row.status === 'paused');
        result.pausedAfterFailure = pausedAfterFailure?.status === 'paused';
        result.failedPaymentRecorded = await paymentExists(options.student.id, failedInvoiceId, 'failed');

        await sendStripeEvent({
            id: `evt_smoke_billing_resumed_${options.suffix}`,
            type: 'customer.subscription.updated',
            object: {
                ...stripeSubscription,
                status: 'active',
                metadata: {
                    ...stripeSubscription.metadata,
                    userId: options.student.id,
                    priceId,
                },
            },
        });

        const resumedSubscription = await waitForLatestSubscription(options.student.id, (row) => row.status === 'active');
        result.resumedAfterUpdate = resumedSubscription?.status === 'active';

        if (!resumedSubscription) {
            return result;
        }

        await supabaseAdmin
            .from('subscriptions')
            .update({ sessions_used: 2 })
            .eq('id', resumedSubscription.id);

        const expectedRenewedEndsAt = addMonthsToDateString(resumedSubscription.ends_at, 3);
        result.expectedRenewedEndsAt = expectedRenewedEndsAt;

        const renewedInvoiceId = `in_smoke_billing_renewal_${options.suffix}`;
        const renewalResponse = await sendStripeEvent({
            id: `evt_smoke_billing_renewal_${options.suffix}`,
            type: 'invoice.paid',
            object: {
                id: renewedInvoiceId,
                object: 'invoice',
                subscription: stripeSubscription.id,
                billing_reason: 'subscription_cycle',
                amount_paid: options.activePackage.price_monthly * 3,
                currency: 'eur',
                payment_intent: `pi_smoke_billing_renewal_${options.suffix}`,
            },
        });

        result.renewalStatus = renewalResponse.status;

        const renewedSubscription = await waitForLatestSubscription(options.student.id, (row) =>
            row.ends_at === expectedRenewedEndsAt && row.status === 'active'
        );
        result.renewedEndsAt = renewedSubscription?.ends_at ?? null;
        result.renewedSessionsTotal = renewedSubscription?.sessions_total ?? null;
        result.renewedSessionsUsed = renewedSubscription?.sessions_used ?? null;
        result.renewalPaymentRecorded = await paymentExists(options.student.id, renewedInvoiceId, 'succeeded');

        const cancellationResponse = await sendStripeEvent({
            id: `evt_smoke_billing_cancelled_${options.suffix}`,
            type: 'customer.subscription.deleted',
            object: {
                ...stripeSubscription,
                status: 'canceled',
                metadata: {
                    ...stripeSubscription.metadata,
                    userId: options.student.id,
                    priceId,
                },
            },
        });

        result.cancellationStatus = cancellationResponse.status;
        const cancelledSubscription = await waitForLatestSubscription(options.student.id, (row) => row.status === 'cancelled');
        result.cancelledAfterDelete = cancelledSubscription?.status === 'cancelled';

        result.ok =
            checkoutResponse.status === 200 &&
            result.initialWebhookStatus === 200 &&
            result.initialSubscriptionStatus === 'active' &&
            result.initialDurationMonths === 3 &&
            result.pausedAfterUpdate &&
            result.pausedAfterFailure &&
            result.failedPaymentRecorded &&
            result.resumedAfterUpdate &&
            result.renewalStatus === 200 &&
            result.renewedEndsAt === expectedRenewedEndsAt &&
            result.renewedSessionsTotal === options.activePackage.sessions_per_month * 3 &&
            result.renewedSessionsUsed === 0 &&
            result.renewalPaymentRecorded &&
            result.cancellationStatus === 200 &&
            result.cancelledAfterDelete;

        return result;
    } finally {
        if (stripeSubscriptionId) {
            await recordSmokeStripeSubscriptionCleanup(result, stripeSubscriptionId);
            result.ok = result.ok && result.stripeSubscriptionCleanupStatus === 'canceled';
        }
    }
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
    };

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

    const reminderSession = await createReminderSession({
        studentId: options.student.id,
        teacherId: options.teacherProfile.id,
        subscriptionId: schedulingSubscription.id,
    });
    const reminderUnauthorizedResponse = await fetch(`${BASE_URL}/api/cron/send-reminders`);
    result.reminderUnauthorizedStatus = reminderUnauthorizedResponse.status;

    const reminderAuthorizedResponse = await fetch(`${BASE_URL}/api/cron/send-reminders`, {
        headers: {
            Authorization: `Bearer ${cronSecret}`,
        },
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
        result.error = redactErrorForSmokeEvidence(error);
    } finally {
        if (result.insertedJobId && result.cancelledStatus !== 'cancelled') {
            result.cleanupStatus = await cancelSmokeFulfillmentJobDirectly(result.insertedJobId);
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

async function ensureSmokeStudent(email: string, fullName: string): Promise<SmokeStudent> {
    let user = await getAuthUserByEmail(email);

    if (!user) {
        const created = await supabaseAdmin.auth.admin.createUser({
            email,
            password: SMOKE_STUDENT_PASSWORD,
            email_confirm: true,
            user_metadata: {
                full_name: fullName,
            },
        });
        if (created.error || !created.data.user) {
            throw created.error ?? new Error(`Could not create smoke user ${email}`);
        }
        user = created.data.user;
    } else {
        const updated = await supabaseAdmin.auth.admin.updateUserById(user.id, {
            password: SMOKE_STUDENT_PASSWORD,
            email_confirm: true,
            user_metadata: {
                full_name: fullName,
            },
        });
        if (updated.error) {
            throw updated.error;
        }
    }

    await waitForProfile(user.id);
    const { error: updateProfileError } = await supabaseAdmin
        .from('profiles')
        .update({
            email,
            full_name: fullName,
            role: 'student',
        })
        .eq('id', user.id);

    if (updateProfileError) {
        throw updateProfileError;
    }

    if (await tableExists('profiles_private')) {
        const { error: privateUpdateError } = await supabaseAdmin
            .from('profiles_private')
            .upsert({
                profile_id: user.id,
                notes: null,
                drive_folder_id: null,
                drive_folder_url: null,
                google_account_email: null,
                stripe_customer_id: null,
                current_level: 'A2',
            }, { onConflict: 'profile_id' });

        if (privateUpdateError) {
            throw privateUpdateError;
        }
    }

    return { id: user.id, email, fullName };
}

async function waitForProfile(profileId: string) {
    for (let attempt = 0; attempt < 10; attempt += 1) {
        const { data } = await supabaseAdmin
            .from('profiles')
            .select('id')
            .eq('id', profileId)
            .maybeSingle();

        if (data) {
            return data;
        }

        await sleep(300);
    }

    throw new Error(`Profile creation timeout for ${profileId}`);
}

async function getAuthUserByEmail(email: string) {
    let page = 1;
    while (page <= SMOKE_AUTH_USER_SCAN_MAX_PAGES) {
        const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage: 100 });
        if (error) {
            throw error;
        }

        const user = data.users.find((entry) => entry.email === email);
        if (user) {
            return user;
        }

        if (data.users.length < 100) {
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

async function clearStudentRuntimeState(studentId: string) {
    const { error: sessionDeleteError } = await supabaseAdmin
        .from('sessions')
        .delete()
        .eq('student_id', studentId);
    if (sessionDeleteError) {
        throw sessionDeleteError;
    }

    const { error: paymentDeleteError } = await supabaseAdmin
        .from('payments')
        .delete()
        .eq('student_id', studentId);
    if (paymentDeleteError) {
        throw paymentDeleteError;
    }

    const { error: subscriptionDeleteError } = await supabaseAdmin
        .from('subscriptions')
        .delete()
        .eq('student_id', studentId);
    if (subscriptionDeleteError) {
        throw subscriptionDeleteError;
    }

    const { error: fulfillmentJobDeleteError } = await supabaseAdmin
        .from('fulfillment_jobs')
        .delete()
        .eq('student_id', studentId);
    if (fulfillmentJobDeleteError) {
        throw fulfillmentJobDeleteError;
    }

    if (await tableExists('profiles_private')) {
        const { error: privateResetError } = await supabaseAdmin
            .from('profiles_private')
            .update({
                notes: null,
                drive_folder_id: null,
                drive_folder_url: null,
                google_account_email: null,
                stripe_customer_id: null,
                current_level: 'A2',
            })
            .eq('profile_id', studentId);
        if (privateResetError) {
            throw privateResetError;
        }
    }
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
        .select('id,name,price_monthly,sessions_per_month,stripe_price_1m,stripe_price_3m,stripe_price_6m')
        .eq('is_active', true)
        .order('created_at', { ascending: true })
        .limit(1)
        .single();

    if (error || !data) {
        throw error ?? new Error('No active package found');
    }

    return data;
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

async function getStripeCustomerId(studentId: string) {
    if (!(await tableExists('profiles_private'))) {
        return null;
    }

    const { data, error } = await supabaseAdmin
        .from('profiles_private')
        .select('stripe_customer_id')
        .eq('profile_id', studentId)
        .maybeSingle();

    if (error) {
        throw error;
    }

    return data?.stripe_customer_id ?? null;
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

async function getWebhookSideEffects(eventId: string, studentId: string) {
    const profileQuery = await tableExists('profiles_private')
        ? supabaseAdmin.from('profiles_private').select('drive_folder_id').eq('profile_id', studentId).maybeSingle()
        : supabaseAdmin.from('profiles').select('drive_folder_id').eq('id', studentId).single();

    const [{ count: subscriptionCount, error: subscriptionError }, { count: paymentCount, error: paymentError }, { count: processedEventCount, error: eventError }, { data: profile, error: profileError }] =
        await Promise.all([
            supabaseAdmin.from('subscriptions').select('id', { head: true, count: 'exact' }).eq('student_id', studentId),
            supabaseAdmin.from('payments').select('id', { head: true, count: 'exact' }).eq('student_id', studentId),
            supabaseAdmin.from('processed_webhook_events').select('stripe_event_id', { head: true, count: 'exact' }).eq('stripe_event_id', eventId),
            profileQuery,
        ]);

    if (subscriptionError || paymentError || eventError || profileError) {
        throw subscriptionError ?? paymentError ?? eventError ?? profileError;
    }

    return {
        subscriptionCount: subscriptionCount ?? 0,
        paymentCount: paymentCount ?? 0,
        processedEventCount: processedEventCount ?? 0,
        driveFolderId: profile.drive_folder_id,
    };
}

async function postSignedWebhook(payload: string) {
    const signature = stripe.webhooks.generateTestHeaderString({
        payload,
        secret: stripeWebhookSecret!,
    });

    const response = await fetch(`${BASE_URL}/api/stripe-webhook`, {
        method: 'POST',
        headers: {
            'content-type': 'application/json',
            'stripe-signature': signature,
        },
        body: payload,
    });

    return {
        status: response.status,
        body: await readJsonOrText(response),
    };
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

async function ensureSmokeCustomerFundingSource(customerId: string) {
    const customer = await stripe.customers.retrieve(customerId);
    if (customer.deleted) {
        throw new Error(`Stripe customer ${redactSmokeString(customerId, 'stripeCustomerId')} is deleted`);
    }

    const hasDefaultSource = Boolean(customer.default_source);
    const hasDefaultPaymentMethod = Boolean(customer.invoice_settings?.default_payment_method);

    if (hasDefaultSource || hasDefaultPaymentMethod) {
        return;
    }

    await stripe.customers.update(customerId, {
        source: 'tok_visa',
    });
}

async function recordSmokeStripeSubscriptionCleanup(
    result: SmokeResult['billingLifecycle'],
    stripeSubscriptionId: string
) {
    try {
        const subscription = await stripe.subscriptions.retrieve(stripeSubscriptionId);
        if (subscription.status === 'canceled') {
            result.stripeSubscriptionCleanupStatus = 'canceled';
            return;
        }

        const cancelledSubscription = await stripe.subscriptions.cancel(stripeSubscriptionId);
        result.stripeSubscriptionCleanupStatus = cancelledSubscription.status;
    } catch (error) {
        result.stripeSubscriptionCleanupStatus = 'failed';
        result.stripeSubscriptionCleanupError = redactSmokeString(
            error instanceof Error ? error.message : String(error),
            'stripeSubscriptionCleanupError'
        );
    }
}

function getSmokeFailureSections(result: SmokeResult): SmokeSectionKey[] {
    return smokeSectionStatuses(result)
        .filter(([, ok]) => !ok)
        .map(([section]) => section);
}

async function sendStripeEvent(event: { id: string; type: string; object: Record<string, unknown> }) {
    const payload = JSON.stringify({
        id: event.id,
        object: 'event',
        type: event.type,
        data: {
            object: event.object,
        },
    });

    return await postSignedWebhook(payload);
}

async function waitForLatestSubscription(
    studentId: string,
    predicate: (row: BillingSubscriptionRow) => boolean,
    timeoutMs: number = 30_000
) {
    const startedAt = Date.now();

    while (Date.now() - startedAt < timeoutMs) {
        const subscription = await getLatestSubscription(studentId);
        if (subscription && predicate(subscription)) {
            return subscription;
        }
        await sleep(1_000);
    }

    return null;
}

async function getLatestSubscription(studentId: string) {
    const { data, error } = await supabaseAdmin
        .from('subscriptions')
        .select('id,student_id,package_id,status,duration_months,starts_at,ends_at,sessions_total,sessions_used,stripe_subscription_id,stripe_invoice_id,created_at')
        .eq('student_id', studentId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

    if (error) {
        throw error;
    }

    return data;
}

async function paymentExists(studentId: string, invoiceId: string, status: 'failed' | 'succeeded') {
    const { data, error } = await supabaseAdmin
        .from('payments')
        .select('id')
        .eq('student_id', studentId)
        .eq('stripe_invoice_id', invoiceId)
        .eq('status', status)
        .maybeSingle();

    if (error) {
        throw error;
    }

    return Boolean(data);
}

function addMonthsToDateString(dateString: string, months: number) {
    const date = new Date(`${dateString}T00:00:00.000Z`);
    date.setMonth(date.getMonth() + months);
    return toIsoDate(date);
}

async function createSchedulingSubscription(studentId: string, activePackage: ActivePackage) {
    const startsAt = toIsoDate(new Date());
    const endsAt = addMonthsToDateString(startsAt, 1);
    const { data, error } = await supabaseAdmin
        .from('subscriptions')
        .insert({
            student_id: studentId,
            package_id: activePackage.id,
            status: 'active',
            duration_months: 1,
            starts_at: startsAt,
            ends_at: endsAt,
            sessions_total: Math.max(activePackage.sessions_per_month, 3),
            sessions_used: 0,
        })
        .select('id,student_id,package_id,status,duration_months,starts_at,ends_at,sessions_total,sessions_used,stripe_subscription_id,stripe_invoice_id,created_at')
        .single();

    if (error) {
        throw error;
    }

    return data;
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
    if (!body || typeof body === 'string' || Array.isArray(body)) {
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

function requirePackagePrice(activePackage: ActivePackage, key: 'stripe_price_1m' | 'stripe_price_3m' | 'stripe_price_6m') {
    const priceId = activePackage[key];
    if (!priceId) {
        throw new Error(`Active package is missing ${key}`);
    }
    return priceId;
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
        'This smoke creates or updates test users and calls Supabase, Stripe, Google and Resend. It only runs after `SMOKE_EXTERNAL_WRITES_CONFIRMATION` exactly matches `writes-ok:<host>` for `SMOKE_BASE_URL`. The JSON evidence is redacted before it is written.',
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
    lines.push('Use this output as `command_output` support for `final_smoke` only after checking the intended staging/production environment and confirming any residual dashboard evidence without secrets.');
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
        throw new Error('SMOKE_BASE_URL must be an absolute http(s) origin before running final smoke writes.');
    }

    if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
        throw new Error('SMOKE_BASE_URL must use http or https before running final smoke writes.');
    }

    if ((parsedUrl.pathname !== '/' && parsedUrl.pathname !== '') || parsedUrl.search || parsedUrl.hash) {
        throw new Error('SMOKE_BASE_URL must be an origin only, for example https://espanolhonesto.com.');
    }

    const expectedConfirmation = `writes-ok:${parsedUrl.host}`;
    if (confirmation !== expectedConfirmation) {
        throw new Error(
            `SMOKE_EXTERNAL_WRITES_CONFIRMATION must be "${expectedConfirmation}" for ${parsedUrl.origin}. `
            + 'This smoke creates or updates test users and calls Supabase, Stripe, Google and Resend.'
        );
    }

    return parsedUrl.origin;
}

main().catch((error) => {
    console.error(redactErrorForSmokeEvidence(error));
    process.exitCode = 1;
});
