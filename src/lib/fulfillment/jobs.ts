import type { SupabaseClient } from '@supabase/supabase-js';
import { createSupabaseAdminClient } from '../supabase-admin';
import { createStudentFolderStructure } from '../google/student-folder';
import { getPrivateProfile, upsertPrivateProfile } from '../profiles-private';
import { sendWelcomeEmail } from '../email';
import { getSiteUrl } from '../site-url';
import { fulfillSessionBatch, fulfillSingleSession } from './session-fulfillment';
import type { Database, Json } from '../../types/database.types';

export type FulfillmentJobType =
    | 'session_fulfillment'
    | 'bulk_session_fulfillment'
    | 'welcome_fulfillment';

type FulfillmentJobPayload = {
    sessionId?: string;
    sessionIds?: string[];
    userId?: string;
    packageId?: string;
    autoCreateMeeting?: boolean;
    sendEmail?: boolean;
};

type FulfillmentJobRow = Database['public']['Tables']['fulfillment_jobs']['Row'];

function asPayload(value: Json | null): FulfillmentJobPayload {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? value as FulfillmentJobPayload
        : {};
}

function nextRunAt(attempts: number): string {
    const delaySeconds = Math.min(30 * Math.pow(2, Math.max(attempts - 1, 0)), 30 * 60);
    return new Date(Date.now() + delaySeconds * 1000).toISOString();
}

function isMissingJobsTable(error: { code?: string; message?: string } | null): boolean {
    return error?.code === '42P01' || error?.message?.includes('fulfillment_jobs') === true;
}

export async function enqueueFulfillmentJob(
    supabaseAdmin: SupabaseClient<Database>,
    input: {
        jobType: FulfillmentJobType;
        sessionId?: string | null;
        subscriptionId?: string | null;
        studentId?: string | null;
        payload: FulfillmentJobPayload;
        runAt?: string;
    }
): Promise<boolean> {
    const { error } = await supabaseAdmin
        .from('fulfillment_jobs')
        .insert({
            job_type: input.jobType,
            session_id: input.sessionId ?? null,
            subscription_id: input.subscriptionId ?? null,
            student_id: input.studentId ?? null,
            payload: input.payload as Json,
            run_at: input.runAt ?? new Date().toISOString(),
        });

    if (error) {
        if (isMissingJobsTable(error)) {
            console.warn('[Fulfillment] fulfillment_jobs table is missing; using direct fallback');
            return false;
        }
        throw error;
    }

    return true;
}

export async function enqueueSessionFulfillment(
    supabaseAdmin: SupabaseClient<Database>,
    session: Pick<Database['public']['Tables']['sessions']['Row'], 'id' | 'subscription_id' | 'student_id'>,
    options: { autoCreateMeeting?: boolean; sendEmail?: boolean } = {}
): Promise<boolean> {
    return enqueueFulfillmentJob(supabaseAdmin, {
        jobType: 'session_fulfillment',
        sessionId: session.id,
        subscriptionId: session.subscription_id,
        studentId: session.student_id,
        payload: {
            sessionId: session.id,
            autoCreateMeeting: options.autoCreateMeeting ?? true,
            sendEmail: options.sendEmail ?? true,
        },
    });
}

export async function enqueueBulkSessionFulfillment(
    supabaseAdmin: SupabaseClient<Database>,
    sessions: Pick<Database['public']['Tables']['sessions']['Row'], 'id' | 'subscription_id' | 'student_id'>[],
    options: { autoCreateMeeting?: boolean; sendEmail?: boolean } = {}
): Promise<boolean> {
    if (sessions.length === 0) return true;

    return enqueueFulfillmentJob(supabaseAdmin, {
        jobType: 'bulk_session_fulfillment',
        subscriptionId: sessions[0].subscription_id,
        studentId: sessions[0].student_id,
        payload: {
            sessionIds: sessions.map((session) => session.id),
            autoCreateMeeting: options.autoCreateMeeting ?? true,
            sendEmail: options.sendEmail ?? true,
        },
    });
}

export async function enqueueWelcomeFulfillment(
    supabaseAdmin: SupabaseClient<Database>,
    input: { userId: string; packageId: string }
): Promise<boolean> {
    return enqueueFulfillmentJob(supabaseAdmin, {
        jobType: 'welcome_fulfillment',
        studentId: input.userId,
        payload: input,
    });
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

    const { data: pkg, error: packageError } = await supabaseAdmin
        .from('packages')
        .select('name, display_name')
        .eq('id', payload.packageId)
        .single();

    if (packageError || !pkg) {
        throw packageError ?? new Error('Package not found for welcome fulfillment');
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

    const displayName = pkg.display_name;
    const packageName = typeof displayName === 'object' && displayName && !Array.isArray(displayName)
        ? String((displayName as { es?: string }).es || pkg.name)
        : pkg.name;

    const emailSent = await sendWelcomeEmail(student.email, {
        studentName: student.full_name || 'Estudiante',
        packageName,
        loginUrl: `${getSiteUrl('https://espanolhonesto.com')}/es/login`,
        driveFolderUrl: driveFolderUrl ?? undefined,
    });

    if (!emailSent) {
        throw new Error('Resend did not accept welcome email');
    }
}

async function processJob(
    supabaseAdmin: SupabaseClient<Database>,
    job: FulfillmentJobRow
) {
    const payload = asPayload(job.payload);

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
        const { error: lockError } = await supabaseAdmin
            .from('fulfillment_jobs')
            .update({
                status: 'processing',
                attempts,
                locked_at: new Date().toISOString(),
                locked_by: workerId,
                last_error: null,
            })
            .eq('id', job.id)
            .in('status', ['pending', 'failed']);

        if (lockError) {
            console.error('[Fulfillment] Could not lock job:', lockError);
            failed += 1;
            continue;
        }

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
