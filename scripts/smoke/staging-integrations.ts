/**
 * Focused staging write-path smoke for Google Drive/Docs/Calendar and exactly
 * one allowlisted Resend recipient. The default mode is read-only preflight.
 *
 * Preflight:
 *   pnpm exec tsx scripts/smoke/staging-integrations.ts \
 *     --base-url https://staging.espanolhonesto.com \
 *     --expected-web-version-id <wrangler-version-uuid> \
 *     --expected-fulfillment-version-id <wrangler-version-uuid>
 *
 * Execute only after explicit staging-write approval:
 *   pnpm exec tsx scripts/smoke/staging-integrations.ts \
 *     --base-url https://staging.espanolhonesto.com \
 *     --expected-web-version-id <wrangler-version-uuid> \
 *     --expected-fulfillment-version-id <wrangler-version-uuid> \
 *     --execute --send-one-email \
 *     --confirmation writes-ok:staging.espanolhonesto.com
 */
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { calendar as calendarApi, type calendar_v3 } from '@googleapis/calendar';
import { docs as docsApi } from '@googleapis/docs';
import { drive as driveApi, type drive_v3 } from '@googleapis/drive';
import { createBrowserClient } from '@supabase/ssr';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { parse } from 'dotenv';
import { JWT } from 'google-auth-library';
import { normalizeGooglePrivateKey } from '../../src/lib/google/private-key';
import {
    buildRuntimeAttestationConfig,
    RUNTIME_ATTESTATION_SCHEMA,
    verifyRuntimeAttestation,
    type RuntimeAttestationEnvelope,
    type RuntimeAttestationRole,
} from '../../src/lib/runtime-attestation';
import type { Database, Json } from '../../src/types/database.types';
import {
    assertCalendarCleanupTarget,
    assertDriveCleanupTarget,
    assertExactEmailResponse,
    assertExactJobResponse,
    parseRunnerArgs,
    STAGING_FULFILLMENT_IDENTITY,
    STAGING_SMOKE_LEASE_NAME,
    STAGING_WEB_IDENTITY,
    validateStagingGates,
    type RunnerArgs,
    type StagingGate,
} from './staging-integrations-safety';

type Profile = Pick<Database['public']['Tables']['profiles']['Row'], 'id' | 'email' | 'full_name' | 'role'>;
type PrivateProfile = Database['public']['Tables']['profiles_private']['Row'];
type PrivateProfileSnapshot = Pick<
    PrivateProfile,
    'drive_folder_id' | 'drive_folder_url' | 'google_account_email'
>;
type Subscription = Pick<
    Database['public']['Tables']['subscriptions']['Row'],
    'id' | 'ends_at' | 'sessions_total' | 'sessions_used'
>;
type SessionArtifacts = Pick<
    Database['public']['Tables']['sessions']['Row'],
    'id' | 'calendar_event_id' | 'drive_doc_id' | 'drive_doc_url' | 'meet_link'
>;
type AuthCookie = { name: string; value: string };
type SmokeRun = Database['public']['Tables']['staging_integration_smoke_runs']['Row'];

type GoogleClients = {
    calendar: calendar_v3.Calendar;
    docs: ReturnType<typeof docsApi>;
    drive: drive_v3.Drive;
};

type Preflight = {
    admin: Profile;
    budgetDaily: number;
    budgetMonthly: number;
    clients: GoogleClients;
    privateProfile: PrivateProfile;
    recoveryRun: SmokeRun | null;
    scheduledAt: string;
    student: Profile;
    subscription: Subscription;
    supabase: SupabaseClient<Database>;
    teacher: Profile;
};

type ExecutionState = {
    calendarEventIds: Set<string>;
    cancellationJobId: string | null;
    fulfillmentJobId: string | null;
    leaseGeneration: number;
    ownerToken: string;
    originalFullName: string | null;
    originalPrivateProfile: PrivateProfileSnapshot;
    rootFolderIds: Set<string>;
    sessionId: string | null;
    runId: string;
};

const GOOGLE_SCOPES = [
    'https://www.googleapis.com/auth/drive',
    'https://www.googleapis.com/auth/calendar',
    'https://www.googleapis.com/auth/calendar.events',
    'https://www.googleapis.com/auth/documents',
];
const EXPECTED_STAGING_ROOT_NAME = 'STAGING - Espanol Honesto';
const EXPECTED_STAGING_TEMPLATE_NAME = 'STAGING - Plantilla de clase';
const LEASE_TTL_SECONDS = 900;
const NEVER_DUE_RUN_AT = '2099-01-01T00:00:00.000Z';
const UUID_PATTERN = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;

async function main(): Promise<void> {
    const workspaceRoot = process.cwd();
    const args = parseRunnerArgs(process.argv.slice(2));
    const envPath = path.resolve(workspaceRoot, args.envFile);
    const env = parse(readFileSync(envPath));
    const gate = validateStagingGates({ args, env, workspaceRoot });

    const mode = args.cleanupOnly ? 'cleanup-only' : args.execute ? 'execute' : 'preflight';
    console.log(`[staging-integrations] mode=${mode}`);
    console.log(`[staging-integrations] target=${gate.baseHost}`);

    const preflight = await runPreflight(env, gate, args.cleanupOnly);
    console.log('[staging-integrations] preflight=ok');
    console.log(`[staging-integrations] email_budget_day=${preflight.budgetDaily}/${gate.dailyEmailLimit}`);
    console.log(`[staging-integrations] email_budget_month=${preflight.budgetMonthly}/${gate.monthlyEmailLimit}`);

    if (!args.execute) {
        console.log('[staging-integrations] external_writes=none');
        return;
    }

    if (args.cleanupOnly) {
        await executeCleanupOnly({ env, preflight, runId: args.cleanupOnly });
        return;
    }

    await executeSmoke({ args, env, gate, preflight });
}

async function runPreflight(
    env: Record<string, string>,
    gate: StagingGate,
    cleanupRunId?: string,
): Promise<Preflight> {
    const supabase = createClient<Database>(env.PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
        auth: { autoRefreshToken: false, persistSession: false },
    });
    await verifyWorkerHealth(env, gate);
    await verifyRuntimeAttestations(env, gate);
    const clients = await createGoogleClients(env);

    let recoveryRun: SmokeRun | null = null;
    if (cleanupRunId) {
        const { data, error } = await supabase
            .from('staging_integration_smoke_runs')
            .select('*')
            .eq('run_id', cleanupRunId)
            .in('status', ['running', 'cleaning', 'cleanup_required'])
            .maybeSingle();
        if (error || !data) throw new Error('RECOVERY_RUN_NOT_FOUND');
        if (data.base_host !== gate.baseHost || data.lease_name !== STAGING_SMOKE_LEASE_NAME) {
            throw new Error('RECOVERY_RUN_IDENTITY_MISMATCH');
        }
        recoveryRun = data;
    }

    const [admin, student, teacher] = await Promise.all([
        getProfileByEmail(supabase, env.TEST_ADMIN_EMAIL, 'admin'),
        getProfileByEmail(supabase, env.TEST_STUDENT_EMAIL, 'student'),
        getProfileByEmail(supabase, env.TEST_TEACHER_EMAIL, 'teacher'),
    ]);

    if (recoveryRun && (recoveryRun.student_id !== student.id || recoveryRun.teacher_id !== teacher.id)) {
        throw new Error('RECOVERY_RUN_IDENTITY_MISMATCH');
    }

    const subscriptionQuery = supabase
        .from('subscriptions')
        .select('id,ends_at,sessions_total,sessions_used');
    const [{ data: privateProfile, error: privateError }, { data: subscription, error: subscriptionError }] = await Promise.all([
        supabase.from('profiles_private').select('*').eq('profile_id', student.id).single(),
        recoveryRun
            ? subscriptionQuery.eq('id', recoveryRun.subscription_id).single()
            : subscriptionQuery
                .eq('student_id', student.id)
                .eq('status', 'active')
                .gte('ends_at', new Date().toISOString().slice(0, 10))
                .order('created_at', { ascending: false })
                .limit(1)
                .single(),
    ]);
    if (privateError || !privateProfile) throw privateError ?? new Error('Missing test student private profile');
    if (subscriptionError || !subscription) throw subscriptionError ?? new Error('Missing active test subscription');
    if (!recoveryRun && (privateProfile.drive_folder_id || privateProfile.drive_folder_url)) {
        throw new Error('Test student already has an active Drive folder');
    }

    const [assignment, sessionCount, dueJobCount, activeRunCount, budget] = await Promise.all([
        supabase
            .from('student_teachers')
            .select('id')
            .eq('student_id', student.id)
            .eq('teacher_id', teacher.id)
            .maybeSingle(),
        supabase.from('sessions').select('id', { head: true, count: 'exact' }).eq('student_id', student.id),
        supabase
            .from('fulfillment_jobs')
            .select('id', { head: true, count: 'exact' })
            .in('status', ['pending', 'failed'])
            .lte('run_at', new Date().toISOString()),
        supabase
            .from('staging_integration_smoke_runs')
            .select('run_id', { head: true, count: 'exact' })
            .in('status', ['running', 'cleaning', 'cleanup_required']),
        readEmailBudget(supabase),
    ]);
    if (assignment.error || !assignment.data) throw assignment.error ?? new Error('Test teacher is not assigned');
    if (!recoveryRun) {
        if (sessionCount.error || (sessionCount.count ?? 0) !== 0) throw new Error('PREFLIGHT_STUDENT_NOT_CLEAN');
        if (dueJobCount.error || (dueJobCount.count ?? 0) !== 0) throw new Error('PREFLIGHT_QUEUE_NOT_CLEAN');
        if (activeRunCount.error || (activeRunCount.count ?? 0) !== 0) throw new Error('PREFLIGHT_ACTIVE_RUN_EXISTS');
        if (budget.daily + 1 > gate.dailyEmailLimit || budget.monthly + 1 > gate.monthlyEmailLimit) {
            throw new Error('PREFLIGHT_EMAIL_BUDGET_EXHAUSTED');
        }
    }

    await verifyProviderResources(env, clients, student, Boolean(recoveryRun));
    const scheduledAt = recoveryRun?.scheduled_at ?? await findCleanSlot({
        calendar: clients.calendar, env, subscription, supabase, teacher,
    });

    return {
        admin,
        budgetDaily: budget.daily,
        budgetMonthly: budget.monthly,
        clients,
        privateProfile,
        recoveryRun,
        scheduledAt,
        student,
        subscription,
        supabase,
        teacher,
    };
}

async function executeSmoke(input: {
    args: RunnerArgs;
    env: Record<string, string>;
    gate: StagingGate;
    preflight: Preflight;
}): Promise<void> {
    const { env, gate, preflight } = input;
    const runId = randomUUID();
    const ownerToken = randomUUID();
    const marker = `SMOKE-INTEGRATION-${new Date().toISOString().replace(/\D/g, '').slice(0, 14)}-${randomUUID().slice(0, 8)}`;
    const leaseGeneration = await acquireLease(preflight.supabase, runId, ownerToken);
    const state: ExecutionState = {
        calendarEventIds: new Set(),
        cancellationJobId: null,
        fulfillmentJobId: null,
        leaseGeneration,
        ownerToken,
        originalFullName: preflight.student.full_name,
        originalPrivateProfile: snapshotPrivateProfile(preflight.privateProfile),
        rootFolderIds: new Set(),
        sessionId: null,
        runId,
    };

    let smokeError: unknown = null;
    let runCreated = false;
    try {
        const { error: runError } = await preflight.supabase
            .from('staging_integration_smoke_runs')
            .insert({
                run_id: runId,
                lease_name: STAGING_SMOKE_LEASE_NAME,
                lease_generation: leaseGeneration,
                marker,
                status: 'running',
                phase: 'initialized',
                base_host: gate.baseHost,
                student_id: preflight.student.id,
                teacher_id: preflight.teacher.id,
                subscription_id: preflight.subscription.id,
                scheduled_at: preflight.scheduledAt,
                original_full_name: state.originalFullName,
                original_private_profile: state.originalPrivateProfile as Json,
            });
        if (runError) throw runError;
        runCreated = true;

        const [adminCookie, teacherCookie] = await Promise.all([
            createSessionCookie(env, env.TEST_ADMIN_EMAIL, env.TEST_ADMIN_PASSWORD),
            createSessionCookie(env, env.TEST_TEACHER_EMAIL, env.TEST_TEACHER_PASSWORD),
        ]);

        await renewLease(preflight.supabase, state);
        await updateStudentName(
            preflight.supabase,
            preflight.student.id,
            marker,
            state.originalFullName,
        );
        await persistRunState(preflight.supabase, state, { phase: 'student_marked' });

        const folderResponse = await authedJson(gate.baseOrigin, adminCookie, '/api/google/create-student-folder', {
            studentId: preflight.student.id,
        });
        if (folderResponse.status !== 200) throw new Error(`Student folder endpoint returned ${folderResponse.status}`);
        const rootFolderId = nestedString(folderResponse.body, ['result', 'rootFolderId']);
        if (!rootFolderId) throw new Error('Student folder endpoint did not return a root folder');
        state.rootFolderIds.add(rootFolderId);
        await verifyCreatedRoot(preflight.clients.drive, env, rootFolderId, marker);
        await persistRunState(preflight.supabase, state, { phase: 'drive_created' });
        console.log('[staging-integrations] google_drive_folder=ok');

        await renewLease(preflight.supabase, state);
        const { data: session, error: sessionError } = await preflight.supabase
            .from('sessions')
            .insert({
                subscription_id: preflight.subscription.id,
                student_id: preflight.student.id,
                teacher_id: preflight.teacher.id,
                scheduled_at: preflight.scheduledAt,
                duration_minutes: 50,
                status: 'scheduled',
            })
            .select('id')
            .single();
        if (sessionError || !session) throw sessionError ?? new Error('Could not insert smoke session');
        state.sessionId = session.id;
        await persistRunState(preflight.supabase, state, { phase: 'session_created' });

        const { data: job, error: jobError } = await preflight.supabase
            .from('fulfillment_jobs')
            .insert({
                job_type: 'session_fulfillment',
                status: 'pending',
                session_id: session.id,
                subscription_id: preflight.subscription.id,
                student_id: preflight.student.id,
                dedupe_key: `staging-integration:${marker}`,
                max_attempts: 3,
                run_at: NEVER_DUE_RUN_AT,
                payload: {
                    sessionId: session.id,
                    autoCreateMeeting: true,
                    sendEmail: false,
                    smokeMarker: marker,
                    smokeRunId: runId,
                } as Json,
            })
            .select('id')
            .single();
        if (jobError || !job) throw jobError ?? new Error('Could not enqueue smoke fulfillment');
        state.fulfillmentJobId = job.id;
        await persistRunState(preflight.supabase, state, { phase: 'fulfillment_job_created' });

        await processExactJob(env, state, {
            dedupeKey: `staging-integration:${marker}`,
            jobId: job.id,
            marker,
            studentId: preflight.student.id,
        });
        await waitForJob(preflight.supabase, job.id, 'succeeded');
        const artifacts = await waitForArtifacts(preflight.supabase, session.id);
        if (artifacts.calendar_event_id) state.calendarEventIds.add(artifacts.calendar_event_id);
        await verifyArtifacts(preflight.clients, env, artifacts, rootFolderId, marker, preflight.scheduledAt);
        await persistRunState(preflight.supabase, state, { phase: 'fulfillment_verified' });
        console.log('[staging-integrations] google_calendar_drive_meet=ok');

        await renewLease(preflight.supabase, state);
        const docsResponse = await authedJson(gate.baseOrigin, teacherCookie, '/api/drive/append-homework', {
            docUrl: artifacts.drive_doc_url,
            text: marker,
            classDate: preflight.scheduledAt,
        });
        if (docsResponse.status !== 200) throw new Error(`Docs append endpoint returned ${docsResponse.status}`);
        const document = await preflight.clients.docs.documents.get({ documentId: artifacts.drive_doc_id! });
        if (!JSON.stringify(document.data.body ?? {}).includes(marker)) {
            throw new Error('Docs readback did not contain the smoke marker');
        }
        await persistRunState(preflight.supabase, state, { phase: 'docs_verified' });
        console.log('[staging-integrations] google_docs_append=ok');

        const beforeBudget = await readEmailBudget(preflight.supabase);
        await renewLease(preflight.supabase, state);
        const emailResponse = await sendExactStagingEmail(
            `${gate.baseOrigin}/api/internal/staging-integration-email`,
            env.INTERNAL_JOB_SECRET,
            {
                leaseGeneration: state.leaseGeneration,
                leaseName: STAGING_SMOKE_LEASE_NAME,
                ownerToken: state.ownerToken,
                recipient: env.TEST_ADMIN_EMAIL,
                runId,
                smokeMarker: marker,
            },
        );
        if (emailResponse.status !== 200) {
            throw new Error(`Exact staging email endpoint returned ${emailResponse.status}`);
        }
        assertExactEmailResponse(emailResponse.body, { runId, smokeMarker: marker });
        const { data: emailState, error: emailStateError } = await preflight.supabase
            .from('staging_integration_smoke_runs')
            .select('email_status,email_provider_id,email_budget_reserved,email_payload_sha256,email_idempotency_key')
            .eq('run_id', runId)
            .single();
        if (
            emailStateError
            || !emailState
            || emailState.email_status !== 'sent'
            || !emailState.email_provider_id
            || !emailState.email_budget_reserved
            || !emailState.email_payload_sha256
            || emailState.email_idempotency_key !== `staging-integration-smoke/email/${runId}`
        ) {
            throw emailStateError ?? new Error('Durable staging email state was not finalized');
        }
        await persistRunState(preflight.supabase, state, { phase: 'email_verified' });
        const afterBudget = await readEmailBudget(preflight.supabase);
        if (afterBudget.daily !== beforeBudget.daily + 1 || afterBudget.monthly !== beforeBudget.monthly + 1) {
            throw new Error('Email recipient budget did not increase exactly once');
        }
        console.log('[staging-integrations] resend_allowlisted_recipient=ok');
    } catch (error) {
        smokeError = error;
    }

    if (!runCreated) {
        await releaseLease(preflight.supabase, state);
        throw smokeError;
    }

    const cleanupErrors = await cleanupSmoke({ env, marker, preflight, state });
    if (cleanupErrors.length > 0) {
        throw new Error(`Smoke cleanup failed: ${cleanupErrors.join(', ')}`);
    }
    console.log('[staging-integrations] cleanup=ok');

    if (smokeError) throw smokeError;
    console.log('[staging-integrations] result=ok');
}

async function executeCleanupOnly(input: {
    env: Record<string, string>;
    preflight: Preflight;
    runId: string;
}): Promise<void> {
    const run = input.preflight.recoveryRun;
    if (!run || run.run_id !== input.runId) throw new Error('RECOVERY_RUN_NOT_FOUND');

    const ownerToken = randomUUID();
    const leaseGeneration = await acquireLease(input.preflight.supabase, run.run_id, ownerToken);
    const state: ExecutionState = {
        calendarEventIds: new Set(run.calendar_event_ids),
        cancellationJobId: run.cancellation_job_id,
        fulfillmentJobId: run.fulfillment_job_id,
        leaseGeneration,
        ownerToken,
        originalFullName: run.original_full_name,
        originalPrivateProfile: parsePrivateProfileSnapshot(run.original_private_profile),
        rootFolderIds: new Set(run.drive_root_ids),
        runId: run.run_id,
        sessionId: run.session_id,
    };
    const { data: adopted, error: adoptError } = await input.preflight.supabase
        .from('staging_integration_smoke_runs')
        .update({
            lease_generation: leaseGeneration,
            phase: 'recovery_acquired',
            status: 'cleaning',
            updated_at: new Date().toISOString(),
        })
        .eq('run_id', run.run_id)
        .eq('lease_generation', run.lease_generation)
        .in('status', ['running', 'cleaning', 'cleanup_required'])
        .select('run_id')
        .maybeSingle();
    if (adoptError || !adopted) {
        await releaseLease(input.preflight.supabase, state);
        throw adoptError ?? new Error('RECOVERY_RUN_FENCE_MISMATCH');
    }

    const cleanupErrors = await cleanupSmoke({
        env: input.env,
        marker: run.marker,
        preflight: input.preflight,
        state,
    });
    if (cleanupErrors.length > 0) {
        throw new Error(`Recovery cleanup failed: ${cleanupErrors.join(', ')}`);
    }
    console.log('[staging-integrations] recovery_cleanup=ok');
}

async function cleanupSmoke(input: {
    env: Record<string, string>;
    marker: string;
    preflight: Preflight;
    state: ExecutionState;
}): Promise<string[]> {
    const { env, marker, preflight, state } = input;
    const errors: string[] = [];
    const cancellationJobErrors: string[] = [];

    try {
        await renewLease(preflight.supabase, state);
        await persistRunState(preflight.supabase, state, {
            phase: 'cleanup_started',
            status: 'cleaning',
        });
    } catch {
        return ['lease'];
    }

    await collectCleanupError(cancellationJobErrors, 'calendar_job', async () => {
        if (!state.sessionId) return;
        const { data: currentSession } = await preflight.supabase
            .from('sessions')
            .select('calendar_event_id')
            .eq('id', state.sessionId)
            .maybeSingle();
        if (!currentSession?.calendar_event_id) return;
        state.calendarEventIds.add(currentSession.calendar_event_id);

        if (!state.cancellationJobId) {
            const { data: job, error } = await preflight.supabase
                .from('fulfillment_jobs')
                .insert({
                    job_type: 'session_cancellation',
                    status: 'pending',
                    session_id: state.sessionId,
                    subscription_id: preflight.subscription.id,
                    student_id: preflight.student.id,
                    dedupe_key: `staging-integration-cleanup:${marker}`,
                    max_attempts: 3,
                    run_at: NEVER_DUE_RUN_AT,
                    payload: {
                        sessionId: state.sessionId,
                        cancelledBy: 'admin',
                        reason: 'Staging integration smoke cleanup',
                        sendEmail: false,
                        smokeMarker: marker,
                        smokeRunId: state.runId,
                    } as Json,
                })
                .select('id')
                .single();
            if (error || !job) throw error ?? new Error('Could not enqueue calendar cleanup');
            state.cancellationJobId = job.id;
            await persistRunState(preflight.supabase, state, { phase: 'cancellation_job_created' });
        }
        await processExactJob(env, state, {
            dedupeKey: `staging-integration-cleanup:${marker}`,
            jobId: state.cancellationJobId,
            marker,
            studentId: preflight.student.id,
        });
        await waitForJob(preflight.supabase, state.cancellationJobId, 'succeeded');
    });

    await collectCleanupError(errors, 'calendar_direct', async () => {
        await renewLease(preflight.supabase, state);
        const events = await findMarkerEvents(preflight.clients.calendar, marker, preflight.scheduledAt);
        for (const eventId of state.calendarEventIds) {
            const event = await getActiveEvent(preflight.clients.calendar, eventId);
            if (event && !events.some((candidate) => candidate.id === event.id)) events.push(event);
        }
        for (const event of events) {
            if (!event.id || event.status === 'cancelled') continue;
            assertCalendarCleanupTarget(event, {
                marker,
                organizerEmail: env.GOOGLE_ADMIN_EMAIL,
                scheduledAt: preflight.scheduledAt,
            });
            state.calendarEventIds.add(event.id);
            await preflight.clients.calendar.events.delete({
                calendarId: 'primary',
                eventId: event.id,
                sendUpdates: 'all',
            });
        }
        if ((await findMarkerEvents(preflight.clients.calendar, marker, preflight.scheduledAt)).length !== 0) {
            throw new Error('Smoke Calendar events remain active');
        }
        await persistRunState(preflight.supabase, state, { phase: 'calendar_cleaned' });
    });

    if (cancellationJobErrors.length > 0 && !errors.includes('calendar_direct')) {
        console.log('[staging-integrations] calendar_cleanup=fallback_direct');
    }

    await collectCleanupError(errors, 'drive', async () => {
        await renewLease(preflight.supabase, state);
        const roots = await findMarkerRoots(preflight.clients.drive, env, marker);
        for (const rootId of state.rootFolderIds) {
            const root = await getActiveDriveRoot(preflight.clients.drive, rootId);
            if (root && !roots.some((candidate) => candidate.id === root.id)) roots.push(root);
        }
        for (const root of roots) {
            if (!root.id) continue;
            assertDriveCleanupTarget(root, env.GOOGLE_DRIVE_ROOT_FOLDER_ID, marker);
            state.rootFolderIds.add(root.id);
            await preflight.clients.drive.files.update({
                fileId: root.id,
                requestBody: { trashed: true },
                fields: 'id,trashed',
            });
        }
        if ((await findMarkerRoots(preflight.clients.drive, env, marker)).length !== 0) {
            throw new Error('Smoke Drive roots remain active');
        }
        await persistRunState(preflight.supabase, state, { phase: 'drive_cleaned' });
    });

    if (errors.length === 0) {
        await collectCleanupError(errors, 'database', async () => {
            const jobIds = [state.fulfillmentJobId, state.cancellationJobId].filter((id): id is string => Boolean(id));
            if (jobIds.length > 0) {
                const { data, error } = await preflight.supabase
                    .from('fulfillment_jobs')
                    .delete()
                    .in('id', jobIds)
                    .select('id');
                if (error) throw error;
                if ((data?.length ?? 0) > jobIds.length) throw new Error('Smoke job cleanup was not exact');
                const { count, error: remainingError } = await preflight.supabase
                    .from('fulfillment_jobs')
                    .select('id', { count: 'exact', head: true })
                    .in('id', jobIds);
                if (remainingError || (count ?? 0) !== 0) {
                    throw remainingError ?? new Error('Smoke job cleanup was incomplete');
                }
                state.fulfillmentJobId = null;
                state.cancellationJobId = null;
            }
            if (state.sessionId) {
                const sessionId = state.sessionId;
                const { data, error } = await preflight.supabase
                    .from('sessions')
                    .delete()
                    .eq('id', sessionId)
                    .select('id');
                if (error) throw error;
                if ((data?.length ?? 0) > 1) throw new Error('Smoke session cleanup was not exact');
                const { count, error: remainingError } = await preflight.supabase
                    .from('sessions')
                    .select('id', { count: 'exact', head: true })
                    .eq('id', sessionId);
                if (remainingError || (count ?? 0) !== 0) {
                    throw remainingError ?? new Error('Smoke session cleanup was incomplete');
                }
                state.sessionId = null;
            }
            const { data: restoredPrivate, error: privateError } = await preflight.supabase
                .from('profiles_private')
                .update({
                    drive_folder_id: state.originalPrivateProfile.drive_folder_id,
                    drive_folder_url: state.originalPrivateProfile.drive_folder_url,
                    google_account_email: state.originalPrivateProfile.google_account_email,
                })
                .eq('profile_id', preflight.student.id)
                .select('profile_id,drive_folder_id,drive_folder_url,google_account_email')
                .single();
            if (privateError) throw privateError;
            await updateStudentName(
                preflight.supabase,
                preflight.student.id,
                state.originalFullName,
                marker,
            );

            const privateKeys = [
                'drive_folder_id',
                'drive_folder_url',
                'google_account_email',
            ] as const;
            if (privateKeys.some((key) => restoredPrivate[key] !== state.originalPrivateProfile[key])) {
                throw new Error('Test student private profile was not restored');
            }
            await persistRunState(preflight.supabase, state, { phase: 'database_cleaned' });
        });
    }

    if (errors.length === 0) {
        await collectCleanupError(errors, 'run_finalize', async () => {
            await persistRunState(preflight.supabase, state, {
                phase: 'cleaned',
                status: 'cleaned',
            });
        });
    }
    if (errors.length > 0) {
        await collectCleanupError(errors, 'recovery_state', async () => {
            await persistRunState(preflight.supabase, state, {
                phase: 'cleanup_incomplete',
                status: 'cleanup_required',
            });
        });
    }
    await collectCleanupError(errors, 'lease_release', async () => {
        await releaseLease(preflight.supabase, state);
    });
    return errors;
}

function snapshotPrivateProfile(profile: PrivateProfile): PrivateProfileSnapshot {
    return {
        drive_folder_id: profile.drive_folder_id,
        drive_folder_url: profile.drive_folder_url,
        google_account_email: profile.google_account_email,
    };
}

function parsePrivateProfileSnapshot(value: Json): PrivateProfileSnapshot {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error('RECOVERY_PRIVATE_PROFILE_INVALID');
    }
    const record = value as Record<string, Json | undefined>;
    const readNullableString = (key: keyof PrivateProfileSnapshot): string | null => {
        const candidate = record[key];
        if (candidate === null || typeof candidate === 'string') return candidate;
        throw new Error('RECOVERY_PRIVATE_PROFILE_INVALID');
    };
    return {
        drive_folder_id: readNullableString('drive_folder_id'),
        drive_folder_url: readNullableString('drive_folder_url'),
        google_account_email: readNullableString('google_account_email'),
    };
}

async function acquireLease(
    supabase: SupabaseClient<Database>,
    runId: string,
    ownerToken: string,
): Promise<number> {
    const { data, error } = await supabase.rpc('acquire_staging_integration_smoke_lease', {
        p_lease_name: STAGING_SMOKE_LEASE_NAME,
        p_owner_token: ownerToken,
        p_run_id: runId,
        p_ttl_seconds: LEASE_TTL_SECONDS,
    });
    if (error) throw error;
    const lease = data?.[0];
    if (!lease?.acquired || !Number.isSafeInteger(lease.generation) || lease.generation < 1) {
        throw new Error('STAGING_SMOKE_LEASE_BUSY');
    }
    return lease.generation;
}

async function renewLease(
    supabase: SupabaseClient<Database>,
    state: Pick<ExecutionState, 'leaseGeneration' | 'ownerToken' | 'runId'>,
): Promise<void> {
    const { data, error } = await supabase.rpc('renew_staging_integration_smoke_lease', {
        p_generation: state.leaseGeneration,
        p_lease_name: STAGING_SMOKE_LEASE_NAME,
        p_owner_token: state.ownerToken,
        p_run_id: state.runId,
        p_ttl_seconds: LEASE_TTL_SECONDS,
    });
    if (error || !data?.[0]?.renewed) throw error ?? new Error('STAGING_SMOKE_LEASE_LOST');
}

async function releaseLease(
    supabase: SupabaseClient<Database>,
    state: Pick<ExecutionState, 'leaseGeneration' | 'ownerToken' | 'runId'>,
): Promise<void> {
    const { data, error } = await supabase.rpc('release_staging_integration_smoke_lease', {
        p_generation: state.leaseGeneration,
        p_lease_name: STAGING_SMOKE_LEASE_NAME,
        p_owner_token: state.ownerToken,
        p_run_id: state.runId,
    });
    if (error || data !== true) throw error ?? new Error('STAGING_SMOKE_LEASE_RELEASE_FAILED');
}

async function persistRunState(
    supabase: SupabaseClient<Database>,
    state: ExecutionState,
    update: { phase: string; status?: 'running' | 'cleaning' | 'cleanup_required' | 'cleaned' },
): Promise<void> {
    await renewLease(supabase, state);
    const { data, error } = await supabase
        .from('staging_integration_smoke_runs')
        .update({
            calendar_event_ids: [...state.calendarEventIds],
            cancellation_job_id: state.cancellationJobId,
            drive_root_ids: [...state.rootFolderIds],
            fulfillment_job_id: state.fulfillmentJobId,
            phase: update.phase,
            session_id: state.sessionId,
            ...(update.status ? { status: update.status } : {}),
            updated_at: new Date().toISOString(),
        })
        .eq('run_id', state.runId)
        .eq('lease_generation', state.leaseGeneration)
        .in('status', ['running', 'cleaning', 'cleanup_required'])
        .select('run_id')
        .maybeSingle();
    if (error || !data) throw error ?? new Error('STAGING_SMOKE_RUN_FENCE_MISMATCH');
}

async function processExactJob(
    env: Record<string, string>,
    state: ExecutionState,
    input: { dedupeKey: string; jobId: string; marker: string; studentId: string },
): Promise<void> {
    const response = await internalJson(
        `${env.FULFILLMENT_WORKER_URL}/internal/jobs/process-exact`,
        env.INTERNAL_JOB_SECRET,
        {
            dedupeKey: input.dedupeKey,
            jobId: input.jobId,
            leaseGeneration: state.leaseGeneration,
            leaseName: STAGING_SMOKE_LEASE_NAME,
            ownerToken: state.ownerToken,
            runId: state.runId,
            smokeMarker: input.marker,
            studentId: input.studentId,
        },
    );
    if (response.status !== 200) throw new Error(`Exact fulfillment endpoint returned ${response.status}`);
    assertExactJobResponse(response.body, {
        dedupeKey: input.dedupeKey,
        jobId: input.jobId,
        runId: state.runId,
        smokeMarker: input.marker,
    });
}

async function createGoogleClients(env: Record<string, string>): Promise<GoogleClients> {
    const auth = new JWT({
        email: env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
        key: normalizeGooglePrivateKey(env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY),
        scopes: GOOGLE_SCOPES,
        subject: env.GOOGLE_ADMIN_EMAIL,
    });
    await auth.authorize();
    return {
        calendar: calendarApi({ version: 'v3', auth }),
        docs: docsApi({ version: 'v1', auth }),
        drive: driveApi({ version: 'v3', auth }),
    };
}

async function verifyProviderResources(
    env: Record<string, string>,
    clients: GoogleClients,
    student: Profile,
    allowExistingStudentRoots = false,
): Promise<void> {
    const [root, template, document, primary, existingRoots] = await Promise.all([
        clients.drive.files.get({
            fileId: env.GOOGLE_DRIVE_ROOT_FOLDER_ID,
            fields: 'id,name,mimeType,trashed',
        }),
        clients.drive.files.get({
            fileId: env.GOOGLE_TEMPLATE_DOC_ID,
            fields: 'id,name,mimeType,trashed',
        }),
        clients.docs.documents.get({ documentId: env.GOOGLE_TEMPLATE_DOC_ID }),
        clients.calendar.calendarList.get({ calendarId: 'primary' }),
        findExactStudentRoots(clients.drive, env, student),
    ]);
    if (root.data.name !== EXPECTED_STAGING_ROOT_NAME
        || root.data.mimeType !== 'application/vnd.google-apps.folder'
        || root.data.trashed) throw new Error('Configured Google root is not the exact active staging root');
    if (template.data.name !== EXPECTED_STAGING_TEMPLATE_NAME
        || template.data.mimeType !== 'application/vnd.google-apps.document'
        || template.data.trashed) throw new Error('Configured Google template is not the exact active staging template');
    if (document.data.title !== EXPECTED_STAGING_TEMPLATE_NAME) throw new Error('Google Docs template title mismatch');
    if (primary.data.accessRole !== 'owner') throw new Error('Google primary calendar is not owned by the impersonated admin');
    if (!allowExistingStudentRoots && existingRoots.length !== 0) {
        throw new Error('An active Drive root already exists for the test student');
    }
}

async function verifyWorkerHealth(env: Record<string, string>, gate: StagingGate): Promise<void> {
    const [site, fulfillment] = await Promise.all([
        fetchWithTimeout(`${gate.baseOrigin}/health`),
        fetchWithTimeout(`${env.FULFILLMENT_WORKER_URL}/health`),
    ]);
    if (!site.ok) throw new Error(`Staging web health returned ${site.status}`);
    if (!fulfillment.ok) throw new Error(`Staging fulfillment health returned ${fulfillment.status}`);
    const [siteBody, fulfillmentBody] = await Promise.all([site.json(), fulfillment.json()]);
    if (!siteBody || typeof siteBody !== 'object' || Array.isArray(siteBody)
        || siteBody.appEnvironment !== 'staging'
        || siteBody.checkoutEnabled !== false
        || siteBody.runtimeMode !== 'active'
        || siteBody.status !== 'ok'
        || siteBody.workerIdentity !== STAGING_WEB_IDENTITY) {
        throw new Error('Staging web health returned an invalid readiness contract');
    }
    if (!fulfillmentBody || typeof fulfillmentBody !== 'object' || Array.isArray(fulfillmentBody)
        || fulfillmentBody.appEnvironment !== 'staging'
        || fulfillmentBody.ok !== true
        || fulfillmentBody.operationMode !== 'active'
        || fulfillmentBody.status !== 'ok'
        || fulfillmentBody.workerIdentity !== STAGING_FULFILLMENT_IDENTITY) {
        throw new Error('Staging fulfillment health returned an invalid readiness contract');
    }
}

function parseAttestationEnvelope(value: unknown): RuntimeAttestationEnvelope {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error('Runtime attestation response is invalid');
    }
    const record = value as Record<string, unknown>;
    if (
        !isValidAttestationEnvelopeString(record.nonce, /^[A-Za-z0-9_-]{16,128}$/)
        || !isValidAttestationEnvelopeString(record.proof, /^[a-f0-9]{64}$/)
        || (record.role !== 'web' && record.role !== 'fulfillment')
        || record.schema !== RUNTIME_ATTESTATION_SCHEMA
        || !isValidAttestationEnvelopeString(record.workerIdentity, /^[a-z0-9-]{8,80}$/)
        || !isValidAttestationEnvelopeString(record.workerVersionId, UUID_PATTERN)
    ) {
        throw new Error('Runtime attestation response is invalid');
    }
    return record as RuntimeAttestationEnvelope;
}

function isValidAttestationEnvelopeString(value: unknown, pattern: RegExp): value is string {
    return typeof value === 'string' && pattern.test(value);
}

async function verifyRuntimeAttestations(
    env: Record<string, string>,
    gate: StagingGate,
): Promise<void> {
    const targets: Array<{
        expectedIdentity: string;
        expectedVersionId: string;
        role: RuntimeAttestationRole;
        url: string;
    }> = [
        {
            expectedIdentity: STAGING_WEB_IDENTITY,
            expectedVersionId: gate.expectedWebVersionId,
            role: 'web',
            url: `${gate.baseOrigin}/api/internal/runtime-attestation`,
        },
        {
            expectedIdentity: STAGING_FULFILLMENT_IDENTITY,
            expectedVersionId: gate.expectedFulfillmentVersionId,
            role: 'fulfillment',
            url: `${env.FULFILLMENT_WORKER_URL}/internal/runtime-attestation`,
        },
    ];

    await Promise.all(targets.map(async (target) => {
        const nonce = randomUUID();
        const response = await internalJson(target.url, env.INTERNAL_JOB_SECRET, { nonce });
        if (response.status !== 200) {
            throw new Error(`${target.role} runtime attestation returned ${response.status}`);
        }
        const envelope = parseAttestationEnvelope(response.body);
        const config = await buildRuntimeAttestationConfig(target.role, {
            ...env,
            WORKER_IDENTITY: target.expectedIdentity,
            WORKER_VERSION_ID: target.expectedVersionId,
        });
        const valid = await verifyRuntimeAttestation(envelope, {
            config,
            nonce,
            role: target.role,
            schema: RUNTIME_ATTESTATION_SCHEMA,
        }, env.INTERNAL_JOB_SECRET);
        if (!valid) throw new Error(`${target.role} runtime attestation did not match the approved version`);
    }));
}

async function getProfileByEmail(
    supabase: SupabaseClient<Database>,
    email: string,
    expectedRole: 'admin' | 'student' | 'teacher',
): Promise<Profile> {
    const { data, error } = await supabase
        .from('profiles')
        .select('id,email,full_name,role')
        .eq('email', email)
        .single();
    if (error || !data) throw error ?? new Error(`Missing ${expectedRole} test profile`);
    if (data.role !== expectedRole) throw new Error(`Test profile does not have role ${expectedRole}`);
    return data;
}

async function findCleanSlot(input: {
    calendar: calendar_v3.Calendar;
    env: Record<string, string>;
    subscription: Subscription;
    supabase: SupabaseClient<Database>;
    teacher: Profile;
}): Promise<string> {
    const timeMin = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
    const subscriptionEnd = new Date(`${input.subscription.ends_at}T23:59:59.000Z`);
    const timeMax = new Date(Math.min(subscriptionEnd.getTime(), Date.now() + 30 * 24 * 60 * 60 * 1000));
    if (timeMax.getTime() <= timeMin.getTime()) throw new Error('Test subscription ends too soon for a safe smoke slot');

    const calendarIds = [...new Set([input.teacher.email, input.env.GOOGLE_ADMIN_EMAIL].filter(Boolean) as string[])];
    const [freeBusy, sessions] = await Promise.all([
        input.calendar.freebusy.query({
            requestBody: {
                timeMin: timeMin.toISOString(),
                timeMax: timeMax.toISOString(),
                timeZone: 'Europe/Madrid',
                items: calendarIds.map((id) => ({ id })),
            },
        }),
        input.supabase
            .from('sessions')
            .select('scheduled_at,duration_minutes,status')
            .eq('teacher_id', input.teacher.id)
            .neq('status', 'cancelled')
            .gte('scheduled_at', timeMin.toISOString())
            .lte('scheduled_at', timeMax.toISOString()),
    ]);
    if (sessions.error) throw sessions.error;

    const busy = calendarIds.flatMap((id) => {
        const calendar = freeBusy.data.calendars?.[id];
        if (calendar?.errors?.length) throw new Error('Google FreeBusy returned an error for a smoke calendar');
        return calendar?.busy ?? [];
    });
    const databaseBusy = (sessions.data ?? []).flatMap((session) => {
        if (!session.scheduled_at) return [];
        const start = new Date(session.scheduled_at).getTime();
        return [{ start, end: start + (session.duration_minutes ?? 50) * 60_000 }];
    });

    for (let day = 0; day < 27; day += 1) {
        for (const hour of [8, 10, 12, 14, 16]) {
            const start = new Date(timeMin);
            start.setUTCDate(timeMin.getUTCDate() + day);
            start.setUTCHours(hour, 0, 0, 0);
            const end = new Date(start.getTime() + 50 * 60_000);
            if (end > timeMax) continue;
            const googleConflict = busy.some((slot) => slot.start && slot.end
                && start < new Date(slot.end) && end > new Date(slot.start));
            const databaseConflict = databaseBusy.some((slot) => start.getTime() < slot.end && end.getTime() > slot.start);
            if (!googleConflict && !databaseConflict) return start.toISOString();
        }
    }
    throw new Error('No clean Google/DB slot was found for the smoke');
}

async function createSessionCookie(env: Record<string, string>, email: string, password: string): Promise<string> {
    const jar: AuthCookie[] = [];
    const supabase = createBrowserClient(env.PUBLIC_SUPABASE_URL, env.PUBLIC_SUPABASE_ANON_KEY, {
        cookies: {
            getAll: () => jar,
            setAll(cookies) {
                for (const cookie of cookies) {
                    const value = { name: cookie.name, value: cookie.value };
                    const index = jar.findIndex((entry) => entry.name === cookie.name);
                    if (index >= 0) jar[index] = value;
                    else jar.push(value);
                }
            },
        },
    });
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw new Error('Test account authentication failed');
    if (jar.length === 0) throw new Error('Test account authentication produced no cookies');
    return jar.map((cookie) => `${cookie.name}=${cookie.value}`).join('; ');
}

async function authedJson(origin: string, cookie: string, pathname: string, body: Record<string, unknown>) {
    const response = await fetchWithTimeout(`${origin}${pathname}`, {
        method: 'POST',
        headers: { Cookie: cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    }, 60_000);
    const contentType = response.headers.get('content-type') ?? '';
    return {
        status: response.status,
        body: contentType.includes('application/json') ? await response.json() : null,
    };
}

async function internalJson(
    url: string,
    secret: string,
    body: Record<string, unknown>,
): Promise<{ body: unknown; status: number }> {
    const response = await fetchWithTimeout(url, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${secret}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
    }, 60_000);
    const contentType = response.headers.get('content-type') ?? '';
    return {
        body: contentType.includes('application/json') ? await response.json() : null,
        status: response.status,
    };
}

async function sendExactStagingEmail(
    url: string,
    secret: string,
    body: Record<string, unknown>,
): Promise<{ body: unknown; status: number }> {
    for (let attempt = 1; attempt <= 2; attempt += 1) {
        const response = await internalJson(url, secret, body);
        if (response.status === 200) return response;
        const errorCode = response.body && typeof response.body === 'object' && !Array.isArray(response.body)
            ? (response.body as Record<string, unknown>).errorCode
            : null;
        if (errorCode !== 'STAGING_SMOKE_EMAIL_RETRYABLE' || attempt === 2) return response;
        await delay(1_500);
    }
    throw new Error('Exact staging email retry state was invalid');
}

async function waitForJob(
    supabase: SupabaseClient<Database>,
    jobId: string,
    expectedStatus: string,
    timeoutMs = 60_000,
): Promise<void> {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
        const { data, error } = await supabase.from('fulfillment_jobs').select('status').eq('id', jobId).single();
        if (error) throw error;
        if (data.status === expectedStatus) return;
        if (data.status === 'failed') throw new Error('Fulfillment job failed');
        await delay(750);
    }
    throw new Error('Timed out waiting for fulfillment job');
}

async function waitForArtifacts(
    supabase: SupabaseClient<Database>,
    sessionId: string,
    timeoutMs = 60_000,
): Promise<SessionArtifacts> {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
        const { data, error } = await supabase
            .from('sessions')
            .select('id,calendar_event_id,drive_doc_id,drive_doc_url,meet_link')
            .eq('id', sessionId)
            .single();
        if (error) throw error;
        if (data.calendar_event_id && data.drive_doc_id && data.drive_doc_url && data.meet_link) return data;
        await delay(750);
    }
    throw new Error('Timed out waiting for Google artifacts');
}

async function verifyArtifacts(
    clients: GoogleClients,
    env: Record<string, string>,
    artifacts: SessionArtifacts,
    rootFolderId: string,
    marker: string,
    scheduledAt: string,
): Promise<void> {
    const [doc, event] = await Promise.all([
        clients.drive.files.get({
            fileId: artifacts.drive_doc_id!,
            fields: 'id,mimeType,parents,trashed',
        }),
        clients.calendar.events.get({ calendarId: 'primary', eventId: artifacts.calendar_event_id! }),
    ]);
    if (doc.data.mimeType !== 'application/vnd.google-apps.document' || doc.data.trashed) {
        throw new Error('Fulfillment Drive artifact is not an active Google Doc');
    }
    if (!(await isDriveDescendant(clients.drive, artifacts.drive_doc_id!, rootFolderId))) {
        throw new Error('Fulfillment Drive artifact is outside the smoke root');
    }
    assertCalendarCleanupTarget(event.data, {
        marker,
        organizerEmail: env.GOOGLE_ADMIN_EMAIL,
        scheduledAt,
    });
    if (event.data.status !== 'confirmed' || !artifacts.meet_link) {
        throw new Error('Calendar event or Meet link is not active');
    }
}

async function isDriveDescendant(drive: drive_v3.Drive, fileId: string, ancestorId: string): Promise<boolean> {
    let pending = [fileId];
    const visited = new Set<string>();
    for (let depth = 0; depth < 8 && pending.length > 0; depth += 1) {
        const next: string[] = [];
        for (const id of pending) {
            if (id === ancestorId) return true;
            if (visited.has(id)) continue;
            visited.add(id);
            const response = await drive.files.get({ fileId: id, fields: 'parents' });
            next.push(...(response.data.parents ?? []));
        }
        pending = next;
    }
    return pending.includes(ancestorId);
}

async function verifyCreatedRoot(
    drive: drive_v3.Drive,
    env: Record<string, string>,
    rootFolderId: string,
    marker: string,
): Promise<void> {
    const response = await drive.files.get({
        fileId: rootFolderId,
        fields: 'id,name,mimeType,parents,trashed',
    });
    assertDriveCleanupTarget(response.data, env.GOOGLE_DRIVE_ROOT_FOLDER_ID, marker);
    if (response.data.trashed) throw new Error('Created smoke root is already trashed');
}

async function findExactStudentRoots(drive: drive_v3.Drive, env: Record<string, string>, student: Profile) {
    const displayName = student.full_name || student.email?.split('@')[0] || 'Estudiante';
    const name = `${displayName} - ${student.email}`;
    const response = await drive.files.list({
        q: `name = '${escapeDriveValue(name)}' and '${escapeDriveValue(env.GOOGLE_DRIVE_ROOT_FOLDER_ID)}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
        fields: 'files(id)',
        spaces: 'drive',
    });
    return response.data.files ?? [];
}

async function findMarkerRoots(drive: drive_v3.Drive, env: Record<string, string>, marker: string) {
    const response = await drive.files.list({
        q: `name contains '${escapeDriveValue(marker)}' and '${escapeDriveValue(env.GOOGLE_DRIVE_ROOT_FOLDER_ID)}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
        fields: 'files(id,name,mimeType,parents,trashed)',
        spaces: 'drive',
    });
    return response.data.files ?? [];
}

async function findMarkerEvents(calendar: calendar_v3.Calendar, marker: string, scheduledAt: string) {
    const start = new Date(scheduledAt);
    const response = await calendar.events.list({
        calendarId: 'primary',
        q: marker,
        showDeleted: false,
        singleEvents: true,
        timeMin: new Date(start.getTime() - 24 * 60 * 60 * 1000).toISOString(),
        timeMax: new Date(start.getTime() + 24 * 60 * 60 * 1000).toISOString(),
        maxResults: 20,
    });
    return response.data.items ?? [];
}

async function getActiveEvent(calendar: calendar_v3.Calendar, eventId: string) {
    try {
        const response = await calendar.events.get({ calendarId: 'primary', eventId });
        return response.data.status === 'cancelled' ? null : response.data;
    } catch (error) {
        if (googleErrorStatus(error) === 404 || googleErrorStatus(error) === 410) return null;
        throw error;
    }
}

async function getActiveDriveRoot(drive: drive_v3.Drive, rootId: string) {
    try {
        const response = await drive.files.get({
            fileId: rootId,
            fields: 'id,name,mimeType,parents,trashed',
        });
        return response.data.trashed ? null : response.data;
    } catch (error) {
        if (googleErrorStatus(error) === 404) return null;
        throw error;
    }
}

async function readEmailBudget(supabase: SupabaseClient<Database>): Promise<{ daily: number; monthly: number }> {
    const today = new Date().toISOString().slice(0, 10);
    const month = `${today.slice(0, 8)}01`;
    const { data, error } = await supabase
        .from('email_recipient_budget_usage')
        .select('period_kind,period_start,recipient_count')
        .eq('budget_scope', 'nonproduction')
        .in('period_start', [today, month]);
    if (error) throw error;
    return {
        daily: data?.find((row) => row.period_kind === 'day' && row.period_start === today)?.recipient_count ?? 0,
        monthly: data?.find((row) => row.period_kind === 'month' && row.period_start === month)?.recipient_count ?? 0,
    };
}

async function updateStudentName(
    supabase: SupabaseClient<Database>,
    studentId: string,
    fullName: string | null,
    expectedFullName: string | null,
): Promise<void> {
    let query = supabase
        .from('profiles')
        .update({ full_name: fullName })
        .eq('id', studentId);
    query = expectedFullName === null
        ? query.is('full_name', null)
        : query.eq('full_name', expectedFullName);
    const { data, error } = await query
        .select('id')
        .maybeSingle();
    if (error || !data) throw error ?? new Error('Smoke student name changed concurrently');
}

async function collectCleanupError(errors: string[], label: string, work: () => Promise<void>): Promise<void> {
    try {
        await work();
    } catch {
        errors.push(label);
    }
}

async function fetchWithTimeout(url: string, init?: RequestInit, timeoutMs = 20_000): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
        return await fetch(url, { ...init, signal: controller.signal });
    } finally {
        clearTimeout(timeout);
    }
}

function nestedString(value: unknown, keys: string[]): string | null {
    let current = value;
    for (const key of keys) {
        if (!current || typeof current !== 'object' || Array.isArray(current)) return null;
        current = (current as Record<string, unknown>)[key];
    }
    return typeof current === 'string' ? current : null;
}

function escapeDriveValue(value: string): string {
    return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function googleErrorStatus(error: unknown): number | null {
    if (!error || typeof error !== 'object' || !('code' in error)) return null;
    const status = Number((error as { code?: unknown }).code);
    return Number.isFinite(status) ? status : null;
}

function delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function safeErrorMessage(error: unknown): string {
    const raw = error instanceof Error ? error.message : 'Unknown staging integration error';
    return raw
        .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[redacted-email]')
        .replace(/https?:\/\/\S+/gi, '[redacted-url]')
        .replace(/(?:eyJ|ya29)[A-Za-z0-9._-]{20,}/g, '[redacted-token]');
}

const isMain = Boolean(process.argv[1])
    && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isMain) {
    main().catch((error) => {
        console.error(`[staging-integrations] failed=${safeErrorMessage(error)}`);
        process.exitCode = 1;
    });
}
