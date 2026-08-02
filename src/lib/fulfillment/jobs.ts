import type { SupabaseClient } from '@supabase/supabase-js';
import { createSupabaseAdminClient } from '../supabase-admin';
import { recordPostPaymentOnboardingSafe } from '../crm/onboarding';
import { createStudentFolderStructure, type StudentLevel } from '../google/student-folder';
import { getPrivateProfile, upsertPrivateProfile } from '../profiles-private';
import { sendGuaranteeRefundEmail, sendRenewalNoticeEmail, sendWelcomeEmail } from '../email';
import { getSiteUrl } from '../site-url';
import { fulfillSessionBatch, fulfillSingleSession } from './session-fulfillment';
import { FulfillmentDependencyPendingError } from './dependency';
import { processSessionReschedule } from './session-reschedule';
import { cancelClassEvent, deterministicClassEventId } from '../google/calendar';
import { sendClassCancelled } from '../email';
import { recordClassEmailOutInCrmSafe } from '../crm/class-email';
import { recordCrmActivityForProfileSafe } from '../crm/activity-sync';
import { INITIAL_INDIVIDUAL_OFFER } from '../package-pricing';
import type { Database } from '../../types/database.types';
import {
    FulfillmentEffectError,
    isFulfillmentEffectManualReviewError,
} from './effects';
import {
    asFulfillmentPayload,
    enqueueBulkSessionFulfillment,
    enqueueFulfillmentJob,
    enqueueSessionCancellation,
    enqueueSessionFulfillment,
    enqueueSessionReschedule,
    enqueueWelcomeFulfillment,
    enqueueRenewalNotice,
    isMissingJobsTable,
    type FulfillmentJobRow,
    type FulfillmentJobType,
    type FulfillmentJobPayload,
} from './queue';

export {
    enqueueBulkSessionFulfillment,
    enqueueFulfillmentJob,
    enqueueSessionCancellation,
    enqueueSessionFulfillment,
    enqueueSessionReschedule,
    enqueueWelcomeFulfillment,
    enqueueRenewalNotice,
    type FulfillmentJobPayload,
    type FulfillmentJobRow,
    type FulfillmentJobType,
};

export type ExactFulfillmentJobErrorCode =
    | 'EXACT_JOB_EXECUTION_FAILED'
    | 'EXACT_JOB_IDENTITY_MISMATCH'
    | 'EXACT_JOB_LEASE_INVALID'
    | 'EXACT_JOB_LOCK_FAILED'
    | 'EXACT_JOB_NOT_FOUND'
    | 'EXACT_JOB_NOT_PROCESSABLE';

export class ExactFulfillmentJobError extends Error {
    constructor(public readonly code: ExactFulfillmentJobErrorCode) {
        super(code);
        this.name = 'ExactFulfillmentJobError';
    }
}

const supportedWelcomeLocales = new Set(['es', 'en', 'ru']);
const STALE_PROCESSING_AFTER_MS = 20 * 60 * 1000;
const MANUAL_RECONCILIATION_RUN_AT = '9999-12-31T23:59:59.999Z';
export const STALE_PROCESSING_ERROR = 'STALE_PROCESSING_REQUIRES_RECONCILIATION';
export const POST_EFFECT_FINALIZATION_ERROR = 'POST_EFFECT_FINALIZATION_REQUIRES_RECONCILIATION';
export const MAX_ATTEMPTS_ERROR = 'MAX_ATTEMPTS_REQUIRES_RECONCILIATION';

function isSubscriptionProcessingContention(error: {
    code?: string;
    details?: string;
    hint?: string;
    message?: string;
} | null): boolean {
    if (error?.code !== '23505') return false;
    return [error.message, error.details, error.hint]
        .filter((value): value is string => typeof value === 'string')
        .some((value) => value.includes('fulfillment_jobs_one_processing_subscription_idx'));
}

function normalizedStudentLevel(value: string | null | undefined): StudentLevel {
    switch (value?.trim().toLowerCase()) {
        case 'b1': return 'B1';
        case 'b2': return 'B2';
        case 'c1':
        case 'c1+':
        case 'c1_plus': return 'C1';
        case 'a1':
        case 'a2':
        default: return 'A2';
    }
}

function nextRunAt(attempts: number): string {
    const delaySeconds = Math.min(30 * Math.pow(2, Math.max(attempts - 1, 0)), 30 * 60);
    return new Date(Date.now() + delaySeconds * 1000).toISOString();
}

export async function quarantineStaleFulfillmentJobs(options: {
    supabaseAdmin?: SupabaseClient<Database>;
    now?: Date;
} = {}): Promise<number> {
    const supabaseAdmin = options.supabaseAdmin ?? createSupabaseAdminClient();
    const now = options.now ?? new Date();
    const staleBefore = new Date(now.getTime() - STALE_PROCESSING_AFTER_MS).toISOString();
    const { data, error } = await supabaseAdmin
        .from('fulfillment_jobs')
        .update({
            status: 'failed',
            run_at: MANUAL_RECONCILIATION_RUN_AT,
            locked_at: null,
            locked_by: null,
            last_error: STALE_PROCESSING_ERROR,
        })
        .eq('status', 'processing')
        .or(`locked_at.is.null,locked_at.lt.${staleBefore}`)
        .select('id');

    if (error) {
        if (isMissingJobsTable(error)) return 0;
        throw error;
    }

    const quarantined = data?.length ?? 0;
    if (quarantined > 0) {
        console.error(JSON.stringify({
            event: 'fulfillment_stale_jobs_quarantined',
            count: quarantined,
        }));
    }
    return quarantined;
}

function normalizeWelcomeLocale(value: unknown) {
    return typeof value === 'string' && supportedWelcomeLocales.has(value) ? value : 'en';
}

function localizedPackageName(
    displayName: Database['public']['Tables']['packages']['Row']['display_name'],
    fallback: string,
    locale: 'es' | 'en' | 'ru'
): string {
    if (!displayName || typeof displayName !== 'object' || Array.isArray(displayName)) return fallback;
    const names = displayName as Record<string, unknown>;
    const localized = names[locale];
    return typeof localized === 'string' && localized.trim() ? localized : fallback;
}

function assertCheckoutV2WelcomePayload(payload: FulfillmentJobPayload): void {
    const isKnownCheckoutV2 = payload.contractSchemaVersion === 2
        || payload.packageKey === INITIAL_INDIVIDUAL_OFFER.packageKey;
    if (!isKnownCheckoutV2) return;

    const classStartsAt = payload.classStartsAt;
    const firstClassAt = Date.parse(classStartsAt?.[0] ?? '');
    const renewalAnchorAt = Date.parse(payload.renewalAnchorAt ?? '');
    const slotWeekday = payload.slotWeekday;
    const expectedLocalTime = payload.slotLocalStartTime?.slice(0, 5);
    const parsedClassDates = classStartsAt?.map((startsAt) => new Date(startsAt)) ?? [];
    let validTimezone = false;
    let localClassDays: number[] = [];
    let classPatternValid = false;
    try {
        const localDateFormatter = new Intl.DateTimeFormat('en-US', {
            timeZone: payload.timezoneName,
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
        });
        const timeFormatter = new Intl.DateTimeFormat('en-GB', {
            timeZone: payload.timezoneName,
            hour: '2-digit',
            minute: '2-digit',
            hourCycle: 'h23',
        });
        localDateFormatter.format(new Date(firstClassAt));
        validTimezone = true;
        if (parsedClassDates.length === 4 && parsedClassDates.every((date) => Number.isFinite(date.getTime()))) {
            localClassDays = parsedClassDates.map((date) => {
                const parts = Object.fromEntries(
                    localDateFormatter.formatToParts(date).map((part) => [part.type, part.value]),
                );
                return Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day));
            });
            classPatternValid = parsedClassDates.every((date, index) => (
                timeFormatter.format(date) === expectedLocalTime
                && new Date(localClassDays[index]).getUTCDay() === slotWeekday
                && (index === 0 || localClassDays[index] - localClassDays[index - 1] === 7 * 24 * 60 * 60 * 1000)
            ));
        }
    } catch {
        validTimezone = false;
    }

    if (
        payload.contractSchemaVersion !== 2
        || payload.amountTotal !== 25_900
        || payload.currency?.toLowerCase() !== 'eur'
        || payload.sessionsTotal !== 4
        || payload.classDurationMinutes !== 50
        || typeof payload.teacherName !== 'string'
        || !payload.teacherName.trim()
        || !Number.isInteger(slotWeekday)
        || (slotWeekday ?? -1) < 0
        || (slotWeekday ?? 7) > 6
        || typeof payload.slotLocalStartTime !== 'string'
        || !/^\d{2}:\d{2}(?::\d{2})?$/.test(payload.slotLocalStartTime)
        || typeof payload.timezoneName !== 'string'
        || !validTimezone
        || classStartsAt?.length !== 4
        || classStartsAt.some((startsAt) => !Number.isFinite(Date.parse(startsAt)))
        || !classPatternValid
        || !Number.isFinite(firstClassAt)
        || !Number.isFinite(renewalAnchorAt)
        || renewalAnchorAt !== firstClassAt + 28 * 24 * 60 * 60 * 1000
    ) {
        throw new Error('Checkout V2 welcome payload is incomplete or incoherent');
    }
}

async function processRenewalNotice(
    supabaseAdmin: SupabaseClient<Database>,
    payload: FulfillmentJobPayload,
    job: FulfillmentJobRow,
) {
    const hasLegacyMonthlyPeriod = Number.isInteger(payload.durationMonths)
        && (payload.durationMonths ?? 0) > 0;
    const hasVersionedPeriod = ['day', 'week', 'month', 'year'].includes(
        payload.billingIntervalUnit ?? ''
    ) && Number.isInteger(payload.billingIntervalCount)
        && (payload.billingIntervalCount ?? 0) > 0;
    if (
        !payload.userId
        || !payload.packageId
        || !payload.subscriptionId
        || !payload.renewalAt
        || !payload.cancelBy
        || (!hasLegacyMonthlyPeriod && !hasVersionedPeriod)
        || !Number.isInteger(payload.amountTotal)
        || !payload.currency
    ) {
        throw new Error('renewal_notice requires subscription, renewal and charge details');
    }

    const { data: student, error: studentError } = await supabaseAdmin
        .from('profiles')
        .select('id, full_name, email, preferred_language')
        .eq('id', payload.userId)
        .single();
    if (studentError || !student?.email) {
        throw studentError ?? new Error('Student email not found for renewal notice');
    }

    let packageKey = payload.packageKey;
    let packageDisplayName = payload.packageDisplayName;
    if (!packageKey || !packageDisplayName) {
        const { data: pkg, error: packageError } = await supabaseAdmin
            .from('packages')
            .select('name, display_name')
            .eq('id', payload.packageId)
            .single();
        if (packageError || !pkg) {
            throw packageError ?? new Error('Package not found for renewal notice');
        }
        packageKey = pkg.name;
        packageDisplayName = pkg.display_name;
    }

    const locale = normalizeWelcomeLocale(student.preferred_language) as 'es' | 'en' | 'ru';
    const siteUrl = getSiteUrl('https://espanolhonesto.com');
    const emailSent = await sendRenewalNoticeEmail(student.email, {
        locale,
        studentName: student.full_name || { es: 'Estudiante', en: 'Student', ru: 'Ученик' }[locale],
        packageName: localizedPackageName(packageDisplayName, packageKey, locale),
        renewalAt: payload.renewalAt,
        cancelBy: payload.cancelBy,
        durationMonths: payload.durationMonths,
        billingIntervalUnit: payload.billingIntervalUnit,
        billingIntervalCount: payload.billingIntervalCount,
        amountTotal: payload.amountTotal as number,
        currency: payload.currency,
        accountUrl: `${siteUrl}/${locale}/campus/account`,
        supportUrl: `${siteUrl}/${locale}/campus/support`,
        termsUrl: `${siteUrl}/${locale}/legal/terminos`,
    }, fulfillmentEmailOptions(supabaseAdmin, job, 'email.renewal_notice.student'));

    if (!emailSent) {
        throw new Error('Resend did not accept renewal notice email');
    }
}

async function processWelcomeFulfillment(
    supabaseAdmin: SupabaseClient<Database>,
    payload: FulfillmentJobPayload,
    job: FulfillmentJobRow,
) {
    if (!payload.userId || !payload.packageId) {
        throw new Error('welcome_fulfillment requires userId and packageId');
    }
    assertCheckoutV2WelcomePayload(payload);

    const { data: student, error: studentError } = await supabaseAdmin
        .from('profiles')
        .select(`
            id,
            full_name,
            email,
            preferred_language,
            student_teachers!student_teachers_student_id_fkey(
                is_primary,
                teacher:profiles!student_teachers_teacher_id_fkey(full_name)
            )
        `)
        .eq('id', payload.userId)
        .single();

    if (studentError || !student) {
        throw studentError ?? new Error('Student not found for welcome fulfillment');
    }

    let packageKey = payload.packageKey;
    let packageDisplayName = payload.packageDisplayName;
    if (!packageKey || !packageDisplayName) {
        // Compatibility for jobs queued before contractual package snapshots
        // were embedded in the durable payload.
        const { data: pkg, error: packageError } = await supabaseAdmin
            .from('packages')
            .select('name, display_name')
            .eq('id', payload.packageId)
            .single();

        if (packageError || !pkg) {
            throw packageError ?? new Error('Package not found for welcome fulfillment');
        }
        packageKey = pkg.name;
        packageDisplayName = pkg.display_name;
    }

    const studentPrivate = await getPrivateProfile(payload.userId, supabaseAdmin);
    let driveFolderUrl = studentPrivate?.drive_folder_url ?? null;

    if (!studentPrivate?.drive_folder_id) {
        const teachers = student.student_teachers as unknown as Array<{
            is_primary?: boolean;
            teacher?: { full_name?: string | null } | null;
        }>;
        const primaryTeacher = teachers?.find((assignment) => assignment.is_primary);
        const teacherName = primaryTeacher?.teacher?.full_name || null;

        const result = await createStudentFolderStructure({
            levels: [normalizedStudentLevel(studentPrivate?.current_level)],
            studentName: student.full_name || student.email?.split('@')[0] || 'Estudiante',
            studentEmail: student.email,
            teacherName,
        });

        await upsertPrivateProfile(payload.userId, {
            drive_folder_id: result.rootFolderId,
            drive_folder_url: result.rootFolderLink,
            google_account_email: null,
        }, supabaseAdmin);

        driveFolderUrl = result.rootFolderLink;
    }

    const welcomeLocale = normalizeWelcomeLocale(student.preferred_language) as 'es' | 'en' | 'ru';
    const packageName = localizedPackageName(packageDisplayName, packageKey, welcomeLocale);

    const emailSent = await sendWelcomeEmail(student.email, {
        locale: welcomeLocale,
        studentName: student.full_name || { es: 'Estudiante', en: 'Student', ru: 'Ученик' }[welcomeLocale],
        packageName,
        loginUrl: `${getSiteUrl('https://espanolhonesto.com')}/${welcomeLocale}/login`,
        driveFolderUrl: driveFolderUrl ?? undefined,
        durationMonths: payload.durationMonths,
        startsAt: payload.startsAt,
        endsAt: payload.endsAt,
        sessionsTotal: payload.sessionsTotal,
        amountTotal: payload.amountTotal,
        currency: payload.currency,
        legalPolicyVersion: payload.legalPolicyVersion,
        policyAcceptedAt: payload.policyAcceptedAt,
        contractSchemaVersion: payload.contractSchemaVersion,
        classDurationMinutes: payload.classDurationMinutes,
        teacherName: payload.teacherName,
        slotWeekday: payload.slotWeekday,
        slotLocalStartTime: payload.slotLocalStartTime,
        timezoneName: payload.timezoneName,
        classStartsAt: payload.classStartsAt,
        renewalAnchorAt: payload.renewalAnchorAt,
        termsUrl: `${getSiteUrl('https://espanolhonesto.com')}/${welcomeLocale}/legal/terminos`,
        supportUrl: `${getSiteUrl('https://espanolhonesto.com')}/${welcomeLocale}/campus/support`,
    }, fulfillmentEmailOptions(supabaseAdmin, job, 'email.welcome.student'));

    if (!emailSent) {
        throw new Error('Resend did not accept welcome email');
    }

    await recordPostPaymentOnboardingSafe(supabaseAdmin, {
        profileId: payload.userId,
        email: student.email,
        fullName: student.full_name,
        subscriptionId: payload.subscriptionId ?? null,
        packageId: payload.packageId,
        packageName,
        driveFolderUrl,
    });
}

async function processSessionCancellation(
    supabaseAdmin: SupabaseClient<Database>,
    payload: FulfillmentJobPayload,
    job: FulfillmentJobRow
) {
    const sessionId = payload.sessionId || job.session_id;
    if (!sessionId) throw new Error('session_cancellation requires sessionId');

    const { data: session, error } = await supabaseAdmin
        .from('sessions')
        .select(`
            id,
            subscription_id,
            student_id,
            teacher_id,
            scheduled_at,
            duration_minutes,
            meet_link,
            drive_doc_url,
            calendar_event_id,
            student:profiles!sessions_student_id_fkey(id, full_name, email),
            teacher:profiles!sessions_teacher_id_fkey(id, full_name, email)
        `)
        .eq('id', sessionId)
        .single();

    if (error || !session) {
        throw error ?? new Error('Session not found for cancellation fulfillment');
    }

    const calendarEventId = session.calendar_event_id ?? deterministicClassEventId(sessionId);
    const cancelled = await cancelClassEvent(calendarEventId);
    if (!cancelled) {
        throw new Error('Google Calendar event cancellation failed');
    }

    const { error: cancellationStateError } = await supabaseAdmin
        .from('sessions')
        .update({
            calendar_event_id: null,
            meet_link: null,
        })
        .eq('id', sessionId);

    if (cancellationStateError) {
        throw cancellationStateError;
    }

    if (payload.sendEmail === false || !session.scheduled_at) return;

    const student = Array.isArray(session.student) ? session.student[0] : session.student;
    const teacher = Array.isArray(session.teacher) ? session.teacher[0] : session.teacher;

    if (!student?.email || !teacher?.email) {
        throw new Error('Cancellation email is missing student or teacher email');
    }

    const classDetails = {
        date: new Date(session.scheduled_at).toLocaleDateString('en-GB', {
            weekday: 'long',
            day: 'numeric',
            month: 'long',
            year: 'numeric',
            timeZone: 'Europe/Madrid',
        }),
        time: new Date(session.scheduled_at).toLocaleTimeString('en-GB', {
            hour: '2-digit',
            minute: '2-digit',
            hour12: false,
            timeZone: 'Europe/Madrid',
            timeZoneName: 'short',
        }),
        reason: payload.reason || 'No reason provided',
        cancelledBy: payload.cancelledBy || 'admin',
    };

    const studentEmailSent = await sendClassCancelled(student.email, {
        recipientName: student.full_name || 'Student',
        ...classDetails,
    }, fulfillmentEmailOptions(supabaseAdmin, job, 'email.class_cancelled.student'));
    const teacherEmailSent = await sendClassCancelled(teacher.email, {
        recipientName: teacher.full_name || 'Teacher',
        ...classDetails,
    }, fulfillmentEmailOptions(supabaseAdmin, job, 'email.class_cancelled.teacher'));

    if (!studentEmailSent || !teacherEmailSent) {
        throw new Error('Resend did not accept one or more cancellation emails');
    }

    await recordClassEmailOutInCrmSafe(supabaseAdmin, {
        template: 'class_cancelled',
        sessionId,
        studentId: session.student_id,
        studentEmail: student.email,
        studentName: student.full_name,
        teacherId: session.teacher_id,
        teacherEmail: teacher.email,
        teacherName: teacher.full_name,
        subscriptionId: session.subscription_id,
        scheduledAt: session.scheduled_at,
        durationMinutes: session.duration_minutes,
        dateLabel: classDetails.date,
        timeLabel: classDetails.time,
        meetLink: session.meet_link,
        documentLink: session.drive_doc_url,
        source: 'session_cancellation',
        extraMetadata: {
            cancelled_by: payload.cancelledBy || 'admin',
            cancellation_reason: payload.reason || null,
        },
    });
}

async function processGuaranteeRefund(
    supabaseAdmin: SupabaseClient<Database>,
    payload: FulfillmentJobPayload,
    job: FulfillmentJobRow,
) {
    const operationId = payload.operationId;
    const refundAmount = payload.refundAmount;
    const currency = payload.currency?.toLowerCase();
    const studentId = job.student_id;
    const subscriptionId = job.subscription_id;
    if (
        !operationId
        || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(operationId)
        || !studentId
        || !subscriptionId
        || (payload.userId !== undefined && payload.userId !== studentId)
        || (payload.subscriptionId !== undefined && payload.subscriptionId !== subscriptionId)
        || job.dedupe_key !== `guarantee_refund:${operationId}`
        || refundAmount !== 19425
        || currency !== 'eur'
        || payload.sendEmail !== true
    ) {
        throw new Error('guarantee_refund payload does not match the Checkout V2 contract');
    }

    const { data: operation, error: operationError } = await supabaseAdmin
        .from('checkout_v2_guarantee_operations')
        .select('id, actor_id, subscription_id, status, refund_amount_cents, currency, stripe_refund_id, refunded_at')
        .eq('id', operationId)
        .maybeSingle();
    if (
        operationError
        || !operation
        || operation.actor_id !== studentId
        || operation.subscription_id !== subscriptionId
        || operation.status !== 'refunded'
        || operation.refund_amount_cents !== refundAmount
        || operation.currency !== currency
        || !operation.stripe_refund_id
        || !operation.refunded_at
    ) {
        throw operationError ?? new Error('Guarantee refund operation is not terminal or does not match the job');
    }

    const { data: student, error } = await supabaseAdmin
        .from('profiles')
        .select('id, email, full_name, preferred_language')
        .eq('id', studentId)
        .single();
    if (error || !student?.email || student.id !== studentId) {
        throw error ?? new Error('Guarantee refund student is unavailable');
    }

    const locale = student.preferred_language === 'es' || student.preferred_language === 'ru'
        ? student.preferred_language
        : 'en';
    const sent = await sendGuaranteeRefundEmail(student.email, {
        locale,
        studentName: student.full_name || student.email.split('@')[0],
        refundAmount,
        currency,
        accountUrl: `${getSiteUrl('https://espanolhonesto.com')}/${locale}/campus/account`,
        supportUrl: `${getSiteUrl('https://espanolhonesto.com')}/${locale}/campus/support`,
    }, fulfillmentEmailOptions(supabaseAdmin, job, 'email.guarantee_refund.student'));
    if (!sent) throw new Error('Resend did not accept guarantee refund confirmation');

    await recordCrmActivityForProfileSafe(supabaseAdmin, {
        profileId: studentId,
        email: student.email,
        fullName: student.full_name,
        source: 'guarantee_refund',
        activityType: 'email_out',
        subject: 'Garantía y devolución confirmadas',
        body: 'guarantee_refund_confirmed',
        relatedEntityType: 'checkout_v2_guarantee',
        relatedEntityId: operationId,
        metadata: {
            automated: true,
            purpose: 'transactional',
            template: 'guarantee_refund',
            subscription_id: subscriptionId,
            refund_amount: refundAmount,
            currency,
        },
    });
}

function fulfillmentEmailOptions(
    supabaseAdmin: SupabaseClient<Database>,
    job: FulfillmentJobRow,
    effectKey: string,
) {
    if (!job.locked_by) {
        throw new FulfillmentEffectError('FULFILLMENT_EFFECT_INVALID_CONTEXT', true);
    }
    return {
        fulfillmentEffect: {
            effectKey,
            jobId: job.id,
            leaseOwner: job.locked_by,
            supabaseAdmin,
        },
    };
}

async function processJob(
    supabaseAdmin: SupabaseClient<Database>,
    job: FulfillmentJobRow
) {
    const payload = asFulfillmentPayload(job.payload);

    switch (job.job_type as FulfillmentJobType) {
        case 'session_fulfillment': {
            const sessionId = payload.sessionId || job.session_id;
            if (!sessionId) throw new Error('session_fulfillment requires sessionId');
            await fulfillSingleSession(supabaseAdmin, sessionId, {
                autoCreateMeeting: payload.autoCreateMeeting,
                emailEffectJob: fulfillmentEmailJob(job),
                sendEmail: payload.sendEmail,
            });
            return;
        }
        case 'bulk_session_fulfillment': {
            const sessionIds = payload.sessionIds ?? [];
            if (sessionIds.length === 0) throw new Error('bulk_session_fulfillment requires sessionIds');
            await fulfillSessionBatch(supabaseAdmin, sessionIds, {
                autoCreateMeeting: payload.autoCreateMeeting,
                emailEffectJob: fulfillmentEmailJob(job),
                sendEmail: payload.sendEmail,
            });
            return;
        }
        case 'welcome_fulfillment':
            await processWelcomeFulfillment(supabaseAdmin, payload, job);
            return;
        case 'session_cancellation':
            await processSessionCancellation(supabaseAdmin, payload, job);
            return;
        case 'session_reschedule':
            await processSessionReschedule(supabaseAdmin, payload, job);
            return;
        case 'guarantee_refund':
            await processGuaranteeRefund(supabaseAdmin, payload, job);
            return;
        case 'renewal_notice':
            await processRenewalNotice(supabaseAdmin, payload, job);
            return;
        default:
            throw new Error(`Unsupported fulfillment job type: ${job.job_type}`);
    }
}

function fulfillmentEmailJob(job: FulfillmentJobRow) {
    if (!job.locked_by) {
        throw new FulfillmentEffectError('FULFILLMENT_EFFECT_INVALID_CONTEXT', true);
    }
    return { jobId: job.id, leaseOwner: job.locked_by };
}

export async function processDueFulfillmentJobs(options: {
    limit?: number;
    workerId?: string;
    supabaseAdmin?: SupabaseClient<Database>;
} = {}) {
    const supabaseAdmin = options.supabaseAdmin ?? createSupabaseAdminClient();
    const workerId = options.workerId ?? `worker-${crypto.randomUUID()}`;
    const limit = options.limit ?? 10;

    const { data: jobs, error } = await supabaseAdmin
        .from('fulfillment_jobs')
        .select('*')
        .in('status', ['pending', 'failed'])
        .lte('run_at', new Date().toISOString())
        .order('run_at', { ascending: true })
        .limit(limit);

    if (error) {
        if (isMissingJobsTable(error)) return { processed: 0, succeeded: 0, failed: 0 };
        throw error;
    }

    let succeeded = 0;
    let failed = 0;
    let continuations = 0;

    for (const job of jobs ?? []) {
        if (job.attempts >= job.max_attempts) {
            let quarantineQuery = supabaseAdmin
                .from('fulfillment_jobs')
                .update({
                    status: 'failed',
                    run_at: MANUAL_RECONCILIATION_RUN_AT,
                    locked_at: null,
                    locked_by: null,
                    last_error: MAX_ATTEMPTS_ERROR,
                })
                .eq('id', job.id)
                .eq('status', job.status)
                .eq('attempts', job.attempts);
            quarantineQuery = job.updated_at === null
                ? quarantineQuery.is('updated_at', null)
                : quarantineQuery.eq('updated_at', job.updated_at);

            const { data: quarantinedJob, error: quarantineError } = await quarantineQuery
                .select('id')
                .maybeSingle();
            if (quarantineError) {
                console.error('[Fulfillment] Could not quarantine exhausted job:', quarantineError);
                failed += 1;
            } else if (quarantinedJob) {
                continuations += 1;
            }
            continue;
        }

        const attempts = job.attempts + 1;
        let lockQuery = supabaseAdmin
            .from('fulfillment_jobs')
            .update({
                status: 'processing',
                attempts,
                locked_at: new Date().toISOString(),
                locked_by: workerId,
                last_error: null,
            })
            .eq('id', job.id)
            .eq('status', job.status)
            .eq('attempts', job.attempts);
        lockQuery = job.updated_at === null
            ? lockQuery.is('updated_at', null)
            : lockQuery.eq('updated_at', job.updated_at);

        const { data: lockedJob, error: lockError } = await lockQuery
            .select('id')
            .maybeSingle();

        if (lockError) {
            if (isSubscriptionProcessingContention(lockError)) {
                continue;
            }
            console.error('[Fulfillment] Could not lock job:', lockError);
            failed += 1;
            continue;
        }

        if (!lockedJob) continue;

        let processingError: unknown = null;
        try {
            await processJob(supabaseAdmin, {
                ...job,
                attempts,
                locked_by: workerId,
                status: 'processing',
            });
        } catch (jobError) {
            processingError = jobError;
        }

        if (processingError) {
            const message = processingError instanceof Error ? processingError.message : 'Unknown fulfillment error';
            const manualReview = isFulfillmentEffectManualReviewError(processingError);
            const dependencyPending = processingError instanceof FulfillmentDependencyPendingError;
            const observationRetry = dependencyPending
                || (processingError instanceof FulfillmentEffectError && (
                    processingError.code === 'FULFILLMENT_EFFECT_FINALIZATION_AMBIGUOUS'
                    || processingError.code === 'FULFILLMENT_EFFECT_IN_PROGRESS'
                ));
            const exhausted = !observationRetry && attempts >= job.max_attempts;
            const { data: failedJob, error: failError } = await supabaseAdmin
                .from('fulfillment_jobs')
                .update({
                    ...(observationRetry ? { attempts: job.attempts } : {}),
                    status: manualReview || exhausted ? 'failed' : 'pending',
                    run_at: manualReview
                        ? MANUAL_RECONCILIATION_RUN_AT
                        : exhausted ? MANUAL_RECONCILIATION_RUN_AT : nextRunAt(attempts),
                    locked_at: null,
                    locked_by: null,
                    last_error: message,
                })
                .eq('id', job.id)
                .eq('status', 'processing')
                .eq('locked_by', workerId)
                .eq('attempts', attempts)
                .select('id')
                .maybeSingle();

            if (failError) {
                console.error('[Fulfillment] Could not mark failed job:', failError);
                failed += 1;
            } else if (!failedJob) {
                console.error(JSON.stringify({
                    event: 'fulfillment_job_finalization_conflict',
                    jobId: job.id,
                }));
                failed += 1;
            } else if (observationRetry || exhausted) {
                // These states have been persisted durably. A fresh Queue
                // message must advance the next phase without consuming the
                // delivery retry budget of the current message.
                continuations += 1;
            } else {
                failed += 1;
            }
            continue;
        }

        const { data: finalizedJob, error: successError } = await supabaseAdmin
            .from('fulfillment_jobs')
            .update({
                status: 'succeeded',
                locked_at: null,
                locked_by: null,
                last_error: null,
            })
            .eq('id', job.id)
            .eq('status', 'processing')
            .eq('locked_by', workerId)
            .eq('attempts', attempts)
            .select('id')
            .maybeSingle();

        if (!successError && finalizedJob) {
            succeeded += 1;
            continue;
        }

        const { data: quarantinedJob, error: quarantineError } = await supabaseAdmin
            .from('fulfillment_jobs')
            .update({
                status: 'failed',
                run_at: MANUAL_RECONCILIATION_RUN_AT,
                locked_at: null,
                locked_by: null,
                last_error: POST_EFFECT_FINALIZATION_ERROR,
            })
            .eq('id', job.id)
            .eq('status', 'processing')
            .eq('locked_by', workerId)
            .eq('attempts', attempts)
            .select('id')
            .maybeSingle();

        console.error(JSON.stringify({
            event: 'fulfillment_post_effect_finalization_requires_reconciliation',
            jobId: job.id,
            finalizationError: successError ? successError.message : 'ownership_conflict',
            quarantineError: quarantineError?.message ?? null,
            quarantined: Boolean(quarantinedJob),
        }));
        failed += 1;
    }

    return {
        processed: succeeded + failed + continuations,
        succeeded,
        failed,
    };
}

export async function processExactFulfillmentJob(options: {
    dedupeKey: string;
    jobId: string;
    leaseGeneration: number;
    leaseName: string;
    ownerToken: string;
    runId: string;
    smokeMarker: string;
    studentId: string;
    workerId?: string;
    supabaseAdmin?: SupabaseClient<Database>;
}) {
    const supabaseAdmin = options.supabaseAdmin ?? createSupabaseAdminClient();
    const workerId = options.workerId ?? `smoke:${options.runId}:${options.leaseGeneration}`;
    const { data: claimRows, error: claimError } = await supabaseAdmin.rpc(
        'claim_staging_integration_smoke_job',
        {
            p_dedupe_key: options.dedupeKey,
            p_generation: options.leaseGeneration,
            p_job_id: options.jobId,
            p_lease_name: options.leaseName,
            p_owner_token: options.ownerToken,
            p_run_id: options.runId,
            p_smoke_marker: options.smokeMarker,
            p_student_id: options.studentId,
            p_worker_id: workerId,
        },
    );
    if (claimError) {
        const message = claimError.message ?? '';
        if (message.includes('exact_job_lease_invalid')) {
            throw new ExactFulfillmentJobError('EXACT_JOB_LEASE_INVALID');
        }
        if (message.includes('exact_job_not_found')) {
            throw new ExactFulfillmentJobError('EXACT_JOB_NOT_FOUND');
        }
        if (message.includes('exact_job_not_processable')) {
            throw new ExactFulfillmentJobError('EXACT_JOB_NOT_PROCESSABLE');
        }
        if (message.includes('exact_job_claim_conflict')) {
            throw new ExactFulfillmentJobError('EXACT_JOB_LOCK_FAILED');
        }
        throw new ExactFulfillmentJobError('EXACT_JOB_IDENTITY_MISMATCH');
    }
    const claim = claimRows?.[0];
    if (!claim) throw new ExactFulfillmentJobError('EXACT_JOB_LOCK_FAILED');
    if (!claim.claimed && claim.job_status === 'succeeded') {
        return {
            dedupeKey: options.dedupeKey,
            jobId: options.jobId,
            runId: options.runId,
            smokeMarker: options.smokeMarker,
            status: 'succeeded' as const,
        };
    }
    if (!claim.claimed || claim.job_status !== 'processing') {
        throw new ExactFulfillmentJobError('EXACT_JOB_LOCK_FAILED');
    }
    const claimedAttempts = claim.attempts;

    const { data: job, error: jobError } = await supabaseAdmin
        .from('fulfillment_jobs')
        .select('*')
        .eq('id', options.jobId)
        .eq('dedupe_key', options.dedupeKey)
        .eq('student_id', options.studentId)
        .eq('status', 'processing')
        .eq('locked_by', workerId)
        .maybeSingle();
    if (jobError || !job) throw new ExactFulfillmentJobError('EXACT_JOB_LOCK_FAILED');

    try {
        await processJob(supabaseAdmin, job);
    } catch {
        await supabaseAdmin.rpc('finalize_staging_integration_smoke_job', {
            p_attempts: claimedAttempts,
            p_generation: options.leaseGeneration,
            p_job_id: job.id,
            p_lease_name: options.leaseName,
            p_owner_token: options.ownerToken,
            p_run_id: options.runId,
            p_succeeded: false,
            p_worker_id: workerId,
        });
        throw new ExactFulfillmentJobError('EXACT_JOB_EXECUTION_FAILED');
    }
    const { data: finalized, error: finalizeError } = await supabaseAdmin.rpc(
        'finalize_staging_integration_smoke_job',
        {
            p_attempts: claimedAttempts,
            p_generation: options.leaseGeneration,
            p_job_id: job.id,
            p_lease_name: options.leaseName,
            p_owner_token: options.ownerToken,
            p_run_id: options.runId,
            p_succeeded: true,
            p_worker_id: workerId,
        },
    );
    if (finalizeError || finalized !== true) {
        throw new ExactFulfillmentJobError('EXACT_JOB_LEASE_INVALID');
    }

    return {
        dedupeKey: job.dedupe_key,
        jobId: job.id,
        runId: options.runId,
        smokeMarker: options.smokeMarker,
        status: 'succeeded' as const,
    };
}
