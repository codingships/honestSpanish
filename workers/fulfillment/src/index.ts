/// <reference types="@cloudflare/workers-types" />

import {
    ExactFulfillmentJobError,
    processDueFulfillmentJobs,
    processExactFulfillmentJob,
} from '../../../src/lib/fulfillment/jobs';
import { sendClassReminder } from '../../../src/lib/email';
import { recordClassEmailOutInCrmSafe } from '../../../src/lib/crm/class-email';
import { checkTeacherAvailability, getCalendarClient } from '../../../src/lib/google/calendar';
import { appendToDocument, ensureUserPermission, getFolderLink } from '../../../src/lib/google/drive';
import { createStudentFolderStructure } from '../../../src/lib/google/student-folder';
import { getPrivateProfile, upsertPrivateProfile } from '../../../src/lib/profiles-private';
import { createSupabaseAdminClient } from '../../../src/lib/supabase-admin';
import {
    createRuntimeAttestation,
    isValidAttestationNonce,
    timingSafeTextEqual,
} from '../../../src/lib/runtime-attestation';

type JsonObject = Record<string, unknown>;
type VersionMetadata = { id?: unknown; tag?: unknown; timestamp?: unknown };
type Env = Record<string, string | VersionMetadata | undefined> & {
    CF_VERSION_METADATA?: VersionMetadata;
};
type AvailableSlot = { slot_start: string; slot_end: string };
type Handler = (body: JsonObject, env: Env) => Promise<unknown>;

const SCHEDULED_FULFILLMENT_JOB_LIMIT = 5;
const FULFILLMENT_WORKER_ID = 'cloudflare-fulfillment-worker';

function internalSecret(env: Env): string | null {
    return envString(env, 'INTERNAL_JOB_SECRET') || null;
}

function envString(env: Env, key: string): string | undefined {
    const candidate = env[key];
    return typeof candidate === 'string' ? candidate : undefined;
}

function json(status: number, body: unknown): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: {
            'Cache-Control': 'no-store',
            'Content-Type': 'application/json; charset=utf-8',
            'X-Content-Type-Options': 'nosniff',
        },
    });
}

function isAuthorized(request: Request, env: Env): boolean {
    const secret = internalSecret(env);
    const bearer = request.headers.get('Authorization')?.replace(/^Bearer\s+/i, '') ?? '';
    return Boolean(secret && timingSafeTextEqual(bearer, secret));
}

async function readJson(request: Request): Promise<JsonObject> {
    if (request.method === 'GET') return {};

    const declaredLength = Number(request.headers.get('Content-Length') ?? '0');
    if (Number.isFinite(declaredLength) && declaredLength > 16_384) {
        throw new Error('REQUEST_TOO_LARGE');
    }

    const text = await request.text();
    if (text.length > 16_384) throw new Error('REQUEST_TOO_LARGE');
    if (!text.trim()) return {};

    return JSON.parse(text) as JsonObject;
}

async function handleProcessJobs(body: JsonObject): Promise<JsonObject> {
    const limit = typeof body.limit === 'number' ? body.limit : 20;
    return processDueFulfillmentJobs({
        limit,
        workerId: FULFILLMENT_WORKER_ID,
    });
}

function requiredSmokeString(body: JsonObject, key: string, pattern: RegExp): string {
    const candidate = body[key];
    if (typeof candidate !== 'string' || !pattern.test(candidate)) {
        throw new ExactFulfillmentJobError('EXACT_JOB_IDENTITY_MISMATCH');
    }
    return candidate;
}

function requiredPositiveInteger(body: JsonObject, key: string): number {
    const candidate = body[key];
    if (!Number.isSafeInteger(candidate) || Number(candidate) < 1) {
        throw new ExactFulfillmentJobError('EXACT_JOB_IDENTITY_MISMATCH');
    }
    return Number(candidate);
}

async function handleProcessExactJob(body: JsonObject, env: Env): Promise<JsonObject> {
    if (envString(env, 'PUBLIC_APP_ENV') !== 'staging'
        || envString(env, 'WORKER_IDENTITY') !== 'espanol-honesto-fulfillment-staging') {
        throw new ExactFulfillmentJobError('EXACT_JOB_IDENTITY_MISMATCH');
    }
    const runId = requiredSmokeString(body, 'runId', /^[0-9a-f]{8}-[0-9a-f-]{27}$/i);
    const workerIdentity = envString(env, 'WORKER_IDENTITY') || FULFILLMENT_WORKER_ID;
    return processExactFulfillmentJob({
        dedupeKey: requiredSmokeString(body, 'dedupeKey', /^staging-integration(?:-cleanup)?:[A-Za-z0-9-]{20,160}$/),
        jobId: requiredSmokeString(body, 'jobId', /^[0-9a-f]{8}-[0-9a-f-]{27}$/i),
        leaseGeneration: requiredPositiveInteger(body, 'leaseGeneration'),
        leaseName: requiredSmokeString(body, 'leaseName', /^google-resend-write-smoke$/),
        ownerToken: requiredSmokeString(body, 'ownerToken', /^[0-9a-f]{8}-[0-9a-f-]{27}$/i),
        runId,
        smokeMarker: requiredSmokeString(body, 'smokeMarker', /^SMOKE-INTEGRATION-[A-Za-z0-9-]{20,160}$/),
        studentId: requiredSmokeString(body, 'studentId', /^[0-9a-f]{8}-[0-9a-f-]{27}$/i),
        workerId: `${workerIdentity}:${runId}:${requiredPositiveInteger(body, 'leaseGeneration')}`,
    });
}

async function handleRuntimeAttestation(body: JsonObject, env: Env) {
    if (envString(env, 'PUBLIC_APP_ENV') !== 'staging'
        || envString(env, 'WORKER_IDENTITY') !== 'espanol-honesto-fulfillment-staging') {
        return { errorCode: 'ATTESTATION_RUNTIME_INVALID' };
    }
    if (!isValidAttestationNonce(body.nonce)) {
        return { errorCode: 'ATTESTATION_INVALID_REQUEST' };
    }
    const workerVersionId = env.CF_VERSION_METADATA?.id;
    if (typeof workerVersionId !== 'string' || !workerVersionId) {
        return { errorCode: 'ATTESTATION_RUNTIME_INVALID' };
    }
    const attestedEnv = Object.fromEntries(
        Object.entries(env).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
    );
    attestedEnv.WORKER_VERSION_ID = workerVersionId;
    return createRuntimeAttestation('fulfillment', attestedEnv, body.nonce);
}

async function handleAvailability(body: JsonObject): Promise<JsonObject> {
    const teacherEmail = String(body.teacherEmail || '');
    const startTime = new Date(String(body.startTime || ''));
    const endTime = new Date(String(body.endTime || ''));

    if (!teacherEmail || Number.isNaN(startTime.getTime()) || Number.isNaN(endTime.getTime())) {
        return { error: 'teacherEmail, startTime and endTime are required' };
    }

    const available = await checkTeacherAvailability(teacherEmail, startTime, endTime);
    return { available };
}

async function handleFilterSlots(body: JsonObject): Promise<JsonObject> {
    const teacherEmail = String(body.teacherEmail || '');
    const slots = Array.isArray(body.slots) ? body.slots as AvailableSlot[] : [];

    if (!teacherEmail || slots.length === 0) {
        return { slots };
    }

    const startTime = new Date(slots[0].slot_start);
    const endTime = new Date(slots[slots.length - 1].slot_end);
    const calendar = getCalendarClient();
    const response = await calendar.freebusy.query({
        requestBody: {
            timeMin: startTime.toISOString(),
            timeMax: endTime.toISOString(),
            items: [{ id: teacherEmail }],
            timeZone: 'Europe/Madrid',
        },
    });

    const calendarAvailability = response.data.calendars?.[teacherEmail];
    if (!calendarAvailability || (calendarAvailability.errors?.length ?? 0) > 0) {
        throw new Error('Cannot verify Google Calendar availability');
    }

    const busySlots = calendarAvailability.busy || [];
    if (busySlots.length === 0) {
        return { slots };
    }

    const filteredSlots = slots.filter((slot) => {
        const slotStart = new Date(slot.slot_start).getTime();
        const slotEnd = new Date(slot.slot_end).getTime();

        return !busySlots.some((busy) => {
            if (!busy.start || !busy.end) return false;
            const busyStart = new Date(busy.start).getTime();
            const busyEnd = new Date(busy.end).getTime();
            return slotStart < busyEnd && slotEnd > busyStart;
        });
    });

    return { slots: filteredSlots };
}

async function handleAppendHomework(body: JsonObject): Promise<JsonObject> {
    const docId = String(body.docId || '');
    const content = String(body.content || '');

    if (!docId || !content) {
        return { error: 'docId and content are required' };
    }

    await appendToDocument(docId, content);
    return { success: true };
}

async function handleLinkGoogleDrive(body: JsonObject): Promise<JsonObject> {
    const userId = String(body.userId || '');
    const googleAccountEmail = String(body.googleAccountEmail || '').trim().toLowerCase();

    if (!userId || !googleAccountEmail) {
        return { error: 'userId and googleAccountEmail are required' };
    }

    const supabaseAdmin = createSupabaseAdminClient();
    const profilePrivate = await getPrivateProfile(userId, supabaseAdmin);

    if (!profilePrivate?.drive_folder_id) {
        return { error: 'Drive folder not ready yet' };
    }

    await ensureUserPermission(profilePrivate.drive_folder_id, googleAccountEmail, 'reader');
    const folderUrl = profilePrivate.drive_folder_url || await getFolderLink(profilePrivate.drive_folder_id);
    const updatedPrivateProfile = await upsertPrivateProfile(userId, {
        drive_folder_url: folderUrl,
        google_account_email: googleAccountEmail,
    }, supabaseAdmin);

    return {
        driveFolderUrl: updatedPrivateProfile.drive_folder_url,
        googleAccountEmail: updatedPrivateProfile.google_account_email,
    };
}

async function handleCreateStudentFolder(body: JsonObject): Promise<JsonObject> {
    const studentId = String(body.studentId || '');
    if (!studentId) {
        return { error: 'studentId is required' };
    }

    const supabaseAdmin = createSupabaseAdminClient();
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
        .eq('id', studentId)
        .single();

    if (studentError || !student) {
        throw studentError ?? new Error('Student not found');
    }

    const studentPrivate = await getPrivateProfile(studentId, supabaseAdmin);
    if (studentPrivate?.drive_folder_id) {
        return {
            rootFolderId: studentPrivate.drive_folder_id,
            rootFolderLink: studentPrivate.drive_folder_url,
            alreadyExists: true,
        };
    }

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

    await upsertPrivateProfile(studentId, {
        drive_folder_id: result.rootFolderId,
        drive_folder_url: result.rootFolderLink,
        google_account_email: null,
    }, supabaseAdmin);

    return result as unknown as JsonObject;
}

async function sendDueReminders(
    supabaseAdmin: ReturnType<typeof createSupabaseAdminClient>
): Promise<JsonObject> {
    const result = {
        success: true,
        timestamp: new Date().toISOString(),
        processed: 0,
        sent: 0,
        failed: 0,
        errors: [] as string[],
    };

    const now = new Date();
    const windowStart = new Date(now.getTime() + 23 * 60 * 60 * 1000);
    const windowEnd = new Date(now.getTime() + 25 * 60 * 60 * 1000);

    const { data: sessions, error } = await supabaseAdmin
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
            student:profiles!sessions_student_id_fkey(id, full_name, email),
            teacher:profiles!sessions_teacher_id_fkey(id, full_name, email)
        `)
        .eq('status', 'scheduled')
        .eq('reminder_sent', false)
        .gte('scheduled_at', windowStart.toISOString())
        .lte('scheduled_at', windowEnd.toISOString());

    if (error) {
        throw error;
    }

    for (const session of sessions ?? []) {
        result.processed += 1;

        const student = Array.isArray(session.student) ? session.student[0] : session.student;
        const teacher = Array.isArray(session.teacher) ? session.teacher[0] : session.teacher;

        if (!student?.email || !teacher?.email || !session.scheduled_at) {
            result.failed += 1;
            result.errors.push(`Session ${session.id}: missing email or scheduled_at`);
            continue;
        }

        const sessionDate = new Date(session.scheduled_at);
        const date = sessionDate.toLocaleDateString('es-ES', {
            weekday: 'long',
            day: 'numeric',
            month: 'long',
            year: 'numeric',
            timeZone: 'Europe/Madrid',
        });
        const time = sessionDate.toLocaleTimeString('es-ES', {
            hour: '2-digit',
            minute: '2-digit',
            timeZone: 'Europe/Madrid',
        });

        const studentSent = await sendClassReminder(student.email, {
            recipientName: student.full_name || 'Estudiante',
            date,
            time,
            teacherName: teacher.full_name || 'Tu profesor',
            meetLink: session.meet_link ?? undefined,
            documentLink: session.drive_doc_url ?? undefined,
        });

        const teacherSent = await sendClassReminder(teacher.email, {
            recipientName: teacher.full_name || 'Profesor',
            date,
            time,
            studentName: student.full_name || 'Tu estudiante',
            meetLink: session.meet_link ?? undefined,
            documentLink: session.drive_doc_url ?? undefined,
        });

        if (!studentSent || !teacherSent) {
            result.failed += 1;
            result.errors.push(`Session ${session.id}: reminder email failed`);
            continue;
        }

        const { error: updateError } = await supabaseAdmin
            .from('sessions')
            .update({ reminder_sent: true })
            .eq('id', session.id)
            .eq('reminder_sent', false);

        if (updateError) {
            result.failed += 1;
            result.errors.push(`Session ${session.id}: failed to mark reminder_sent`);
            continue;
        }

        result.sent += 2;

        await recordClassEmailOutInCrmSafe(supabaseAdmin, {
            template: 'class_reminder',
            sessionId: session.id,
            studentId: session.student_id,
            studentEmail: student.email,
            studentName: student.full_name,
            teacherId: session.teacher_id,
            teacherEmail: teacher.email,
            teacherName: teacher.full_name,
            subscriptionId: session.subscription_id,
            scheduledAt: session.scheduled_at,
            durationMinutes: session.duration_minutes,
            dateLabel: date,
            timeLabel: time,
            meetLink: session.meet_link,
            documentLink: session.drive_doc_url,
            source: 'reminder_worker',
        });
    }

    return result;
}

async function handleSendReminders(): Promise<JsonObject> {
    const supabaseAdmin = createSupabaseAdminClient();
    const fulfillment = await processDueFulfillmentJobs({ limit: 20, supabaseAdmin });
    const reminders = await sendDueReminders(supabaseAdmin);

    return { ...reminders, fulfillment };
}

async function handleScheduled(): Promise<void> {
    const supabaseAdmin = createSupabaseAdminClient();

    await processDueFulfillmentJobs({
        limit: SCHEDULED_FULFILLMENT_JOB_LIMIT,
        workerId: FULFILLMENT_WORKER_ID,
        supabaseAdmin,
    });
    await sendDueReminders(supabaseAdmin);
}

const routes: Record<string, Handler> = {
    '/internal/jobs/process': handleProcessJobs,
    '/internal/jobs/process-exact': handleProcessExactJob,
    '/internal/runtime-attestation': handleRuntimeAttestation,
    '/internal/google/availability': handleAvailability,
    '/internal/google/filter-available-slots': handleFilterSlots,
    '/internal/drive/append-homework': handleAppendHomework,
    '/internal/account/link-google-drive': handleLinkGoogleDrive,
    '/internal/google/create-student-folder': handleCreateStudentFolder,
    '/internal/reminders/send': handleSendReminders,
};

export default {
    async fetch(request: Request, env: Env): Promise<Response> {
        const url = new URL(request.url);

        if (request.method === 'GET' && url.pathname === '/health') {
            return json(200, {
                ok: true,
                service: 'fulfillment-worker',
                runtime: 'cloudflare-workers',
                timestamp: new Date().toISOString(),
            });
        }

        if (!isAuthorized(request, env)) {
            return json(401, { error: 'Unauthorized' });
        }

        const route = routes[url.pathname];
        if (!route) {
            return json(404, { error: 'Not found' });
        }
        if (request.method !== 'POST') {
            return json(405, { errorCode: 'METHOD_NOT_ALLOWED' });
        }

        try {
            const result = await route(await readJson(request), env);
            const errorCode = result && typeof result === 'object' && 'errorCode' in result
                ? (result as { errorCode?: unknown }).errorCode
                : null;
            return json(typeof errorCode === 'string' ? 400 : 200, result);
        } catch (error) {
            const errorCode = error instanceof ExactFulfillmentJobError
                ? error.code
                : error instanceof Error && error.message === 'REQUEST_TOO_LARGE'
                    ? 'REQUEST_TOO_LARGE'
                    : 'INTERNAL_OPERATION_FAILED';
            console.error(JSON.stringify({ event: 'fulfillment_request_failed', errorCode, path: url.pathname }));
            return json(errorCode === 'REQUEST_TOO_LARGE' ? 413 : 500, { errorCode });
        }
    },

    async scheduled(
        _controller: ScheduledController,
        _env: Env,
        ctx: ExecutionContext
    ): Promise<void> {
        ctx.waitUntil(handleScheduled());
    },
};
