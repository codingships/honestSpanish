/// <reference types="@cloudflare/workers-types" />

import {
    ExactFulfillmentJobError,
    processDueFulfillmentJobs,
    processExactFulfillmentJob,
    quarantineStaleFulfillmentJobs,
} from '../../../src/lib/fulfillment/jobs';
import { sendClassReminder } from '../../../src/lib/email';
import { recordClassEmailOutInCrmSafe } from '../../../src/lib/crm/class-email';
import { madridDateKey, madridDateTimeToUtcIso } from '../../../src/lib/calendar/madrid-time';
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
type FulfillmentEnvironment = 'staging' | 'production';
type VersionMetadata = { id?: unknown; tag?: unknown; timestamp?: unknown };
export type FulfillmentQueueMessage = {
    version: 1;
    kind: 'process_due';
    environment: FulfillmentEnvironment;
    limit: number;
    requestedAt: string;
};
type Env = Record<string, unknown> & {
    FULFILLMENT_QUEUE?: Queue<FulfillmentQueueMessage>;
    CF_VERSION_METADATA?: VersionMetadata;
    [key: string]: unknown;
};
type AvailableSlot = { slot_start: string; slot_end: string };
type GoogleEventBoundary = {
    date?: string | null;
    dateTime?: string | null;
    timeZone?: string | null;
};
type Handler = (body: JsonObject, env: Env) => Promise<unknown>;

const SCHEDULED_FULFILLMENT_JOB_LIMIT = 5;
const QUEUED_FULFILLMENT_JOB_LIMIT = 1;
const FULFILLMENT_WORKER_ID = 'cloudflare-fulfillment-worker';
const FULFILLMENT_QUEUE_NAMES: Record<FulfillmentEnvironment, string> = {
    staging: 'espanol-honesto-fulfillment-staging-queue',
    production: 'espanol-honesto-fulfillment-production-queue',
};
const DEFAULT_FULFILLMENT_JOB_LIMIT = 20;
const MAX_FULFILLMENT_JOB_LIMIT = 100;

function fulfillmentWorkerRunId(scope: 'http' | 'scheduled'): string {
    return `${FULFILLMENT_WORKER_ID}:${scope}:${crypto.randomUUID()}`;
}

function internalSecret(env: Env): string | null {
    return envString(env, 'INTERNAL_JOB_SECRET') || null;
}

function envString(env: Env, key: string): string | undefined {
    const candidate = env[key];
    return typeof candidate === 'string' ? candidate : undefined;
}

function fulfillmentRuntimeMode(env: Env): 'active' | 'bootstrap' {
    return envString(env, 'FULFILLMENT_RUNTIME_MODE') === 'active' ? 'active' : 'bootstrap';
}

function fulfillmentEnvironment(env: Env): FulfillmentEnvironment | null {
    const appEnvironment = envString(env, 'PUBLIC_APP_ENV');
    const workerIdentity = envString(env, 'WORKER_IDENTITY');
    if (appEnvironment === 'staging' && workerIdentity === 'espanol-honesto-fulfillment-staging') {
        return 'staging';
    }
    if (appEnvironment === 'production' && workerIdentity === 'espanol-honesto-fulfillment-production') {
        return 'production';
    }
    return null;
}

function fulfillmentJobLimit(value: unknown): number {
    if (value === undefined) return DEFAULT_FULFILLMENT_JOB_LIMIT;
    if (!Number.isSafeInteger(value) || Number(value) < 1 || Number(value) > MAX_FULFILLMENT_JOB_LIMIT) {
        throw new Error('INVALID_FULFILLMENT_JOB_LIMIT');
    }
    return Number(value);
}

function isFulfillmentQueueMessage(
    value: unknown,
    environment: FulfillmentEnvironment,
): value is FulfillmentQueueMessage {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const message = value as Record<string, unknown>;
    return message.version === 1
        && message.kind === 'process_due'
        && message.environment === environment
        && Number.isSafeInteger(message.limit)
        && Number(message.limit) >= 1
        && Number(message.limit) <= MAX_FULFILLMENT_JOB_LIMIT
        && typeof message.requestedAt === 'string'
        && Number.isFinite(Date.parse(message.requestedAt));
}

function queueRetryDelay(attempts: number): number {
    return Math.min(30 * (2 ** Math.max(attempts - 1, 0)), 30 * 60);
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

async function handleProcessJobs(body: JsonObject, env: Env): Promise<JsonObject> {
    const environment = fulfillmentEnvironment(env);
    if (!environment) {
        throw new Error('FULFILLMENT_RUNTIME_IDENTITY_INVALID');
    }
    const limit = fulfillmentJobLimit(body.limit);

    if (!env.FULFILLMENT_QUEUE) {
        throw new Error('FULFILLMENT_QUEUE_NOT_CONFIGURED');
    }
    await env.FULFILLMENT_QUEUE.send({
        version: 1,
        kind: 'process_due',
        environment,
        limit,
        requestedAt: new Date().toISOString(),
    }, { contentType: 'json' });

    return { queued: true, limit };
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
    const appEnvironment = envString(env, 'PUBLIC_APP_ENV');
    const expectedIdentity = appEnvironment === 'staging'
        ? 'espanol-honesto-fulfillment-staging'
        : appEnvironment === 'production'
            ? 'espanol-honesto-fulfillment-production'
            : null;
    if (!expectedIdentity || envString(env, 'WORKER_IDENTITY') !== expectedIdentity) {
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

function googleEventBoundaryMillis(boundary: GoogleEventBoundary | null | undefined): number {
    if (boundary?.dateTime) {
        // RFC3339 permits omitting an offset when timeZone is supplied. Do not
        // let JavaScript reinterpret that valid wall time as UTC: an uncertain
        // busy interval must fail closed instead.
        const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(\.\d{1,3})?(Z|([+-])(\d{2}):(\d{2}))$/i.exec(boundary.dateTime);
        if (!match) {
            throw new Error('Cannot verify Google Calendar availability');
        }
        const [, yearText, monthText, dayText, hourText, minuteText, secondText, fractionText, , offsetSign, offsetHourText, offsetMinuteText] = match;
        const year = Number(yearText);
        const month = Number(monthText);
        const day = Number(dayText);
        const hour = Number(hourText);
        const minute = Number(minuteText);
        const second = Number(secondText);
        const milliseconds = fractionText
            ? Number(fractionText.slice(1).padEnd(3, '0').slice(0, 3))
            : 0;
        const offsetHour = offsetHourText ? Number(offsetHourText) : 0;
        const offsetMinute = offsetMinuteText ? Number(offsetMinuteText) : 0;
        if (
            year < 1
            || month < 1 || month > 12
            || day < 1 || day > 31
            || hour > 23
            || minute > 59
            || second > 59
            || offsetHour > 14
            || offsetMinute > 59
            || (offsetHour === 14 && offsetMinute !== 0)
        ) {
            throw new Error('Cannot verify Google Calendar availability');
        }
        const civil = new Date(0);
        civil.setUTCFullYear(year, month - 1, day);
        civil.setUTCHours(hour, minute, second, milliseconds);
        if (
            civil.getUTCFullYear() !== year
            || civil.getUTCMonth() !== month - 1
            || civil.getUTCDate() !== day
            || civil.getUTCHours() !== hour
            || civil.getUTCMinutes() !== minute
            || civil.getUTCSeconds() !== second
        ) throw new Error('Cannot verify Google Calendar availability');
        const offsetDirection = offsetSign === '+' ? 1 : offsetSign === '-' ? -1 : 0;
        return civil.getTime()
            - offsetDirection * (offsetHour * 60 + offsetMinute) * 60_000;
    }

    if (boundary?.date) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(boundary.date)) {
            throw new Error('Cannot verify Google Calendar availability');
        }
        const instant = madridDateTimeToUtcIso(boundary.date, '00:00');
        if (!instant || madridDateKey(new Date(instant)) !== boundary.date) {
            throw new Error('Cannot verify Google Calendar availability');
        }
        return Date.parse(instant);
    }

    throw new Error('Cannot verify Google Calendar availability');
}

async function handleFilterSlots(body: JsonObject): Promise<JsonObject> {
    const teacherEmail = String(body.teacherEmail || '');
    const slots = Array.isArray(body.slots)
        ? (body.slots as AvailableSlot[]).slice().sort((left, right) => (
            new Date(left.slot_start).getTime() - new Date(right.slot_start).getTime()
        ))
        : [];
    const ignoredEventIds = new Set(
        Array.isArray(body.ignoredEventIds)
            ? body.ignoredEventIds
                .filter((value): value is string => typeof value === 'string' && value.length > 0 && value.length <= 1024)
            : [],
    );

    if (slots.length === 0) {
        return { slots };
    }

    if (!teacherEmail || slots.some((slot) => {
        const start = Date.parse(slot.slot_start);
        const end = Date.parse(slot.slot_end);
        return !Number.isFinite(start) || !Number.isFinite(end) || start >= end;
    })) {
        throw new Error('Cannot verify Google Calendar availability');
    }

    const startTime = new Date(slots[0].slot_start);
    const endTime = new Date(slots[slots.length - 1].slot_end);
    if (Number.isNaN(startTime.getTime()) || Number.isNaN(endTime.getTime()) || startTime >= endTime) {
        throw new Error('Cannot verify Google Calendar availability');
    }
    const calendar = getCalendarClient();

    if (ignoredEventIds.size > 0) {
        const busySlots: Array<{ start: number; end: number }> = [];
        let pageToken: string | undefined;
        const seenPageTokens = new Set<string>();
        let pageCount = 0;
        do {
            pageCount += 1;
            if (pageCount > 20 || (pageToken && seenPageTokens.has(pageToken))) {
                throw new Error('Cannot verify Google Calendar availability');
            }
            if (pageToken) seenPageTokens.add(pageToken);
            const response = await calendar.events.list({
                calendarId: teacherEmail,
                timeMin: startTime.toISOString(),
                timeMax: endTime.toISOString(),
                singleEvents: true,
                showDeleted: false,
                maxResults: 2500,
                pageToken,
                timeZone: 'Europe/Madrid',
            });
            for (const event of response.data.items ?? []) {
                if (typeof event.id !== 'string' || !event.id) {
                    throw new Error('Cannot verify Google Calendar availability');
                }
                const declinedByTeacher = event.attendees?.some((attendee) => (
                    attendee.self === true && attendee.responseStatus === 'declined'
                ));
                if (
                    ignoredEventIds.has(event.id)
                    || event.status === 'cancelled'
                    || event.transparency === 'transparent'
                    || declinedByTeacher
                ) continue;
                const startsAt = googleEventBoundaryMillis(event.start);
                const endsAt = googleEventBoundaryMillis(event.end);
                if (startsAt >= endsAt) {
                    throw new Error('Cannot verify Google Calendar availability');
                }
                busySlots.push({ start: startsAt, end: endsAt });
            }
            pageToken = response.data.nextPageToken || undefined;
        } while (pageToken);

        return {
            slots: slots.filter((slot) => {
                const slotStart = new Date(slot.slot_start).getTime();
                const slotEnd = new Date(slot.slot_end).getTime();
                return !busySlots.some((busy) => slotStart < busy.end && slotEnd > busy.start);
            }),
        };
    }

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
            if (!busy.start || !busy.end) {
                throw new Error('Cannot verify Google Calendar availability');
            }
            const busyStart = new Date(busy.start).getTime();
            const busyEnd = new Date(busy.end).getTime();
            if (Number.isNaN(busyStart) || Number.isNaN(busyEnd) || busyStart >= busyEnd) {
                throw new Error('Cannot verify Google Calendar availability');
            }
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
    supabaseAdmin: ReturnType<typeof createSupabaseAdminClient>,
    exactScope?: {
        sessionId: string;
        studentId: string;
        teacherId: string;
        subscriptionId: string;
        smokeMarker: string;
    },
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

    let sessionsQuery = supabaseAdmin
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
        .eq('reminder_sent', false);

    if (exactScope) {
        sessionsQuery = sessionsQuery
            .eq('id', exactScope.sessionId)
            .eq('student_id', exactScope.studentId)
            .eq('teacher_id', exactScope.teacherId)
            .eq('subscription_id', exactScope.subscriptionId)
            .eq('teacher_notes', exactScope.smokeMarker);
    }

    const { data: sessions, error } = await sessionsQuery
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
        const date = sessionDate.toLocaleDateString('en-GB', {
            weekday: 'long',
            day: 'numeric',
            month: 'long',
            year: 'numeric',
            timeZone: 'Europe/Madrid',
        });
        const time = sessionDate.toLocaleTimeString('en-GB', {
            hour: '2-digit',
            minute: '2-digit',
            hour12: false,
            timeZone: 'Europe/Madrid',
            timeZoneName: 'short',
        });

        const studentSent = await sendClassReminder(student.email, {
            recipientName: student.full_name || 'Student',
            date,
            time,
            teacherName: teacher.full_name || 'Your teacher',
            meetLink: session.meet_link ?? undefined,
            documentLink: session.drive_doc_url ?? undefined,
        });

        const teacherSent = await sendClassReminder(teacher.email, {
            recipientName: teacher.full_name || 'Teacher',
            date,
            time,
            studentName: student.full_name || 'Your student',
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
    await quarantineStaleFulfillmentJobs({ supabaseAdmin });
    const fulfillment = await processDueFulfillmentJobs({ limit: 20, supabaseAdmin });
    const reminders = await sendDueReminders(supabaseAdmin);

    return { ...reminders, fulfillment };
}

async function handleSendExactReminder(body: JsonObject, env: Env): Promise<JsonObject> {
    if (envString(env, 'PUBLIC_APP_ENV') !== 'staging'
        || envString(env, 'WORKER_IDENTITY') !== 'espanol-honesto-fulfillment-staging') {
        throw new ExactFulfillmentJobError('EXACT_JOB_IDENTITY_MISMATCH');
    }

    const supabaseAdmin = createSupabaseAdminClient();
    const result = await sendDueReminders(supabaseAdmin, {
        sessionId: requiredSmokeString(body, 'sessionId', /^[0-9a-f]{8}-[0-9a-f-]{27}$/i),
        studentId: requiredSmokeString(body, 'studentId', /^[0-9a-f]{8}-[0-9a-f-]{27}$/i),
        teacherId: requiredSmokeString(body, 'teacherId', /^[0-9a-f]{8}-[0-9a-f-]{27}$/i),
        subscriptionId: requiredSmokeString(body, 'subscriptionId', /^[0-9a-f]{8}-[0-9a-f-]{27}$/i),
        smokeMarker: requiredSmokeString(body, 'smokeMarker', /^SMOKE-REMINDER-[A-Za-z0-9-]{14,80}$/),
    });

    if (result.processed !== 1 || result.sent !== 2 || result.failed !== 0) {
        throw new ExactFulfillmentJobError('EXACT_JOB_IDENTITY_MISMATCH');
    }
    return result;
}

async function handleScheduled(): Promise<void> {
    const supabaseAdmin = createSupabaseAdminClient();

    await quarantineStaleFulfillmentJobs({ supabaseAdmin });
    await processDueFulfillmentJobs({
        limit: SCHEDULED_FULFILLMENT_JOB_LIMIT,
        workerId: fulfillmentWorkerRunId('scheduled'),
        supabaseAdmin,
    });
    await sendDueReminders(supabaseAdmin);
}

async function handleQueue(
    batch: MessageBatch<FulfillmentQueueMessage>,
    env: Env,
): Promise<void> {
    const environment = fulfillmentEnvironment(env);
    if (
        fulfillmentRuntimeMode(env) !== 'active'
        || !environment
        || batch.queue !== FULFILLMENT_QUEUE_NAMES[environment]
    ) {
        console.error(JSON.stringify({
            event: 'fulfillment_queue_runtime_mismatch',
            queue: batch.queue,
        }));
        batch.retryAll({ delaySeconds: 60 });
        return;
    }

    for (const message of batch.messages) {
        if (!isFulfillmentQueueMessage(message.body, environment)) {
            console.error(JSON.stringify({
                event: 'fulfillment_queue_invalid_message',
                messageId: message.id,
            }));
            message.retry({ delaySeconds: 5 * 60 });
            continue;
        }

        try {
            await quarantineStaleFulfillmentJobs();
            const result = await processDueFulfillmentJobs({
                // A welcome job or one class artifact can consume most of the
                // Free-plan subrequest budget. Never combine durable jobs in
                // the same Queue invocation.
                limit: QUEUED_FULFILLMENT_JOB_LIMIT,
                workerId: `${FULFILLMENT_WORKER_ID}:queue:${message.id}:${message.attempts}`,
            });
            if (result.failed > 0) {
                message.retry({ delaySeconds: queueRetryDelay(message.attempts) });
                continue;
            }
            if (result.processed === QUEUED_FULFILLMENT_JOB_LIMIT) {
                if (!env.FULFILLMENT_QUEUE) {
                    throw new Error('FULFILLMENT_QUEUE_NOT_CONFIGURED');
                }
                await env.FULFILLMENT_QUEUE.send({
                    ...message.body,
                    requestedAt: new Date().toISOString(),
                }, {
                    contentType: 'json',
                    ...(result.continuationDelaySeconds === undefined
                        ? {}
                        : { delaySeconds: result.continuationDelaySeconds }),
                });
            }
            message.ack();
        } catch (error) {
            console.error(JSON.stringify({
                event: 'fulfillment_queue_processing_failed',
                messageId: message.id,
                attempts: message.attempts,
                error: error instanceof Error ? error.message : 'unknown_error',
            }));
            message.retry({ delaySeconds: queueRetryDelay(message.attempts) });
        }
    }
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
    '/internal/reminders/send-exact': handleSendExactReminder,
};

export default {
    async fetch(request: Request, env: Env): Promise<Response> {
        const url = new URL(request.url);

        if (request.method === 'GET' && url.pathname === '/health') {
            const appEnvironment = envString(env, 'PUBLIC_APP_ENV');
            const operationMode = envString(env, 'FULFILLMENT_RUNTIME_MODE');
            const workerIdentity = envString(env, 'WORKER_IDENTITY');
            const healthy = operationMode === 'active' && fulfillmentEnvironment(env) !== null;
            return json(healthy ? 200 : 503, {
                appEnvironment: appEnvironment ?? 'unconfigured',
                ok: healthy,
                operationMode: operationMode ?? 'unconfigured',
                service: 'fulfillment-worker',
                status: healthy ? 'ok' : 'invalid',
                workerIdentity: workerIdentity ?? 'unconfigured',
                runtime: 'cloudflare-workers',
                timestamp: new Date().toISOString(),
            });
        }

        if (url.pathname !== '/internal/runtime-attestation' && fulfillmentRuntimeMode(env) !== 'active') {
            return json(503, { errorCode: 'FULFILLMENT_DISABLED' });
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

    async queue(
        batch: MessageBatch<FulfillmentQueueMessage>,
        env: Env,
    ): Promise<void> {
        await handleQueue(batch, env);
    },

    async scheduled(
        _controller: ScheduledController,
        env: Env,
        ctx: ExecutionContext
    ): Promise<void> {
        if (fulfillmentRuntimeMode(env) !== 'active') {
            console.log(JSON.stringify({ event: 'fulfillment_scheduled_skipped', reason: 'runtime_disabled' }));
            return;
        }
        ctx.waitUntil(handleScheduled());
    },
} satisfies ExportedHandler<Env, FulfillmentQueueMessage>;
