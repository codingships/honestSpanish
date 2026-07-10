import type { SupabaseClient } from '@supabase/supabase-js';
import { createSupabaseAdminClient } from '../supabase-admin';
import { recordPostPaymentOnboardingSafe } from '../crm/onboarding';
import { createStudentFolderStructure } from '../google/student-folder';
import { getPrivateProfile, upsertPrivateProfile } from '../profiles-private';
import { sendRenewalNoticeEmail, sendWelcomeEmail } from '../email';
import { getSiteUrl } from '../site-url';
import { fulfillSessionBatch, fulfillSingleSession } from './session-fulfillment';
import { cancelClassEvent } from '../google/calendar';
import { sendClassCancelled } from '../email';
import { recordClassEmailOutInCrmSafe } from '../crm/class-email';
import type { Database } from '../../types/database.types';
import {
    asFulfillmentPayload,
    enqueueBulkSessionFulfillment,
    enqueueFulfillmentJob,
    enqueueSessionCancellation,
    enqueueSessionFulfillment,
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

function nextRunAt(attempts: number): string {
    const delaySeconds = Math.min(30 * Math.pow(2, Math.max(attempts - 1, 0)), 30 * 60);
    return new Date(Date.now() + delaySeconds * 1000).toISOString();
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

async function processRenewalNotice(
    supabaseAdmin: SupabaseClient<Database>,
    payload: FulfillmentJobPayload
) {
    if (
        !payload.userId
        || !payload.packageId
        || !payload.subscriptionId
        || !payload.renewalAt
        || !payload.cancelBy
        || !Number.isInteger(payload.durationMonths)
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
        studentName: student.full_name || 'Estudiante',
        packageName: localizedPackageName(packageDisplayName, packageKey, locale),
        renewalAt: payload.renewalAt,
        cancelBy: payload.cancelBy,
        durationMonths: payload.durationMonths as number,
        amountTotal: payload.amountTotal as number,
        currency: payload.currency,
        accountUrl: `${siteUrl}/${locale}/campus/account`,
        supportUrl: `${siteUrl}/${locale}/campus/support`,
        termsUrl: `${siteUrl}/${locale}/legal/terminos`,
    });

    if (!emailSent) {
        throw new Error('Resend did not accept renewal notice email');
    }
}

async function processWelcomeFulfillment(
    supabaseAdmin: SupabaseClient<Database>,
    payload: FulfillmentJobPayload
) {
    if (!payload.userId || !payload.packageId) {
        throw new Error('welcome_fulfillment requires userId and packageId');
    }

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
        termsUrl: `${getSiteUrl('https://espanolhonesto.com')}/${welcomeLocale}/legal/terminos`,
        supportUrl: `${getSiteUrl('https://espanolhonesto.com')}/${welcomeLocale}/campus/support`,
    });

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

    if (session.calendar_event_id) {
        const cancelled = await cancelClassEvent(session.calendar_event_id);
        if (!cancelled) {
            throw new Error('Google Calendar event cancellation failed');
        }

        await supabaseAdmin
            .from('sessions')
            .update({
                calendar_event_id: null,
                meet_link: null,
            })
            .eq('id', sessionId);
    }

    if (payload.sendEmail === false || !session.scheduled_at) return;

    const student = Array.isArray(session.student) ? session.student[0] : session.student;
    const teacher = Array.isArray(session.teacher) ? session.teacher[0] : session.teacher;

    if (!student?.email || !teacher?.email) {
        throw new Error('Cancellation email is missing student or teacher email');
    }

    const classDetails = {
        date: new Date(session.scheduled_at).toLocaleDateString('es-ES', { timeZone: 'Europe/Madrid' }),
        time: new Date(session.scheduled_at).toLocaleTimeString('es-ES', { timeZone: 'Europe/Madrid' }),
        reason: payload.reason || 'Sin motivo especificado',
        cancelledBy: payload.cancelledBy || 'admin',
    };

    const studentEmailSent = await sendClassCancelled(student.email, {
        recipientName: student.full_name || 'Estudiante',
        ...classDetails,
    });
    const teacherEmailSent = await sendClassCancelled(teacher.email, {
        recipientName: teacher.full_name || 'Profesor',
        ...classDetails,
    });

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
                sendEmail: payload.sendEmail,
            });
            return;
        }
        case 'bulk_session_fulfillment': {
            const sessionIds = payload.sessionIds ?? [];
            if (sessionIds.length === 0) throw new Error('bulk_session_fulfillment requires sessionIds');
            await fulfillSessionBatch(supabaseAdmin, sessionIds, {
                autoCreateMeeting: payload.autoCreateMeeting,
                sendEmail: payload.sendEmail,
            });
            return;
        }
        case 'welcome_fulfillment':
            await processWelcomeFulfillment(supabaseAdmin, payload);
            return;
        case 'session_cancellation':
            await processSessionCancellation(supabaseAdmin, payload, job);
            return;
        case 'renewal_notice':
            await processRenewalNotice(supabaseAdmin, payload);
            return;
        default:
            throw new Error(`Unsupported fulfillment job type: ${job.job_type}`);
    }
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

    for (const job of jobs ?? []) {
        if (job.attempts >= job.max_attempts) continue;

        const attempts = job.attempts + 1;
        const { data: lockedJob, error: lockError } = await supabaseAdmin
            .from('fulfillment_jobs')
            .update({
                status: 'processing',
                attempts,
                locked_at: new Date().toISOString(),
                locked_by: workerId,
                last_error: null,
            })
            .eq('id', job.id)
            .in('status', ['pending', 'failed'])
            .select('id')
            .maybeSingle();

        if (lockError) {
            console.error('[Fulfillment] Could not lock job:', lockError);
            failed += 1;
            continue;
        }

        if (!lockedJob) continue;

        try {
            await processJob(supabaseAdmin, { ...job, attempts, status: 'processing' });
            const { error: successError } = await supabaseAdmin
                .from('fulfillment_jobs')
                .update({
                    status: 'succeeded',
                    locked_at: null,
                    locked_by: null,
                    last_error: null,
                })
                .eq('id', job.id);

            if (successError) throw successError;
            succeeded += 1;
        } catch (jobError) {
            const message = jobError instanceof Error ? jobError.message : 'Unknown fulfillment error';
            const exhausted = attempts >= job.max_attempts;
            const { error: failError } = await supabaseAdmin
                .from('fulfillment_jobs')
                .update({
                    status: exhausted ? 'failed' : 'pending',
                    run_at: exhausted ? job.run_at : nextRunAt(attempts),
                    locked_at: null,
                    locked_by: null,
                    last_error: message,
                })
                .eq('id', job.id);

            if (failError) {
                console.error('[Fulfillment] Could not mark failed job:', failError);
            }
            failed += 1;
        }
    }

    return {
        processed: succeeded + failed,
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
