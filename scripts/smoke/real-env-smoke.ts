import 'dotenv/config';

import { createBrowserClient } from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';
import Stripe from 'stripe';
import { cancelClassEvent, getEvent } from '../../src/lib/google/calendar';
import { getDriveClient } from '../../src/lib/google/drive';

const BASE_URL = process.env.SMOKE_BASE_URL || 'https://espanolhonesto.com';
const ADMIN_EMAIL = 'alejandro@espanolhonesto.com';
const TEACHER_EMAIL = 'alindev95@gmail.com';
const SHARED_PASSWORD = 'SmokePass!2026';

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

type SmokeResult = {
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
        smokeUsers: {
            checkoutStudentEmail,
            driveStudentEmail,
            lifecycleStudentEmail,
            schedulingStudentEmail,
        },
    };

    const [, teacherProfile] = await Promise.all([
        ensurePasswordAndGetProfile(ADMIN_EMAIL, SHARED_PASSWORD),
        ensurePasswordAndGetProfile(TEACHER_EMAIL, SHARED_PASSWORD),
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

    const teacherSession = await createSessionCookieHeader(TEACHER_EMAIL, SHARED_PASSWORD);
    const adminSession = await createSessionCookieHeader(ADMIN_EMAIL, SHARED_PASSWORD);
    const checkoutStudentSession = await createSessionCookieHeader(checkoutStudent.email, SHARED_PASSWORD);
    const driveStudentSession = await createSessionCookieHeader(driveStudent.email, SHARED_PASSWORD);
    const lifecycleStudentSession = await createSessionCookieHeader(lifecycleStudent.email, SHARED_PASSWORD);

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

    console.log(JSON.stringify(result, null, 2));
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

async function ensurePasswordAndGetProfile(email: string, password: string): Promise<RoleProfile> {
    const user = await getAuthUserByEmail(email);
    if (!user) {
        throw new Error(`Auth user not found for ${email}`);
    }

    const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(user.id, {
        password,
        email_confirm: true,
    });
    if (updateError) {
        throw updateError;
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
            password: SHARED_PASSWORD,
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
            password: SHARED_PASSWORD,
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
    while (page <= 10) {
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
        throw new Error(`No auth cookies generated for ${email}`);
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

async function waitForDriveFolderId(studentId: string, timeoutMs: number = 30_000) {
    const driveState = await waitForDriveState(studentId, (state) => Boolean(state.driveFolderId), timeoutMs);
    return driveState?.driveFolderId ?? null;
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
        throw new Error(`Stripe customer ${customerId} is deleted`);
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
                throw new Error(`Scheduling probe failed at ${slot.toISOString()} with status ${response.status}: ${JSON.stringify(response.body)}`);
            }
        }
    }

    throw new Error(`Could not schedule any candidate slot. Last failure: ${JSON.stringify(lastFailure)}`);
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

    throw new Error(`Could not find a non-conflicting past slot for session ${sessionId}`);
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

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
