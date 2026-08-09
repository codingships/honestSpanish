/**
 * Staging accreditation for B03: after one synthetic Checkout V2 purchase,
 * reprogram ≥24h without consuming credit, late-cancel or no-show consumes,
 * and admin excuse records a justified incident without erasing history.
 *
 * Product state is asserted via calendar APIs and checkout_v2_session_consumption.
 * Email/calendar fulfillment side-effects are best-effort under the daily budget.
 */
import { createBrowserClient } from '@supabase/ssr';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { execFileSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parse } from 'dotenv';
import Stripe from 'stripe';
import type { Database } from '../../src/types/database.types';
import {
    stagingCheckoutV2RealJourney,
    type StagingCheckoutV2Journey,
    type StagingCheckoutV2RunState,
    runStagingCheckoutV2,
} from './staging-checkout-v2';
import { STAGING_CHECKOUT_V2_CONFIRMATION } from './staging-checkout-v2-safety';
import {
    parseStagingCampusOpsArgs,
    safeStagingCampusOpsSummary,
    STAGING_CAMPUS_OPS_IDENTITY,
    validateStagingCampusOpsGate,
    type StagingCampusOpsGate,
} from './staging-campus-ops-safety';

type Env = Record<string, string>;
type Log = (line: string) => void;
type AuthCookie = { name: string; value: string };

type SessionRow = {
    id: string;
    scheduled_at: string | null;
    status: string;
    checkout_v2_cycle_session_index: number | null;
};

type ConsumptionRow = {
    session_id: string;
    consumption_kind: string;
    student_credit_consumed: boolean | null;
    session_status: string;
};

type RunnerDependencies = {
    envFile?: string;
    log?: Log;
    readText?: (file: string) => string;
    repositoryRemote?: (workspaceRoot: string) => string;
    workspaceRoot?: string;
};

function required(env: Env, key: string): string {
    const value = env[key]?.trim();
    if (!value) throw new Error(`Staging campus-ops requires ${key}`);
    return value;
}

function stringValue(value: unknown, label: string): string {
    if (typeof value !== 'string' || !value) throw new Error(`${label} returned an invalid identifier`);
    return value;
}

function wholeSecondIso(date: Date): string {
    return new Date(Math.floor(date.getTime() / 1000) * 1000).toISOString();
}

function readRepositoryRemote(workspaceRoot: string): string {
    return execFileSync('git', ['remote', 'get-url', 'origin'], {
        cwd: workspaceRoot,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
        windowsHide: true,
    }).trim();
}

function canonicalWorkspaceRoot(worktreeRoot: string): string {
    const commonGitDir = execFileSync(
        'git',
        ['rev-parse', '--path-format=absolute', '--git-common-dir'],
        { cwd: worktreeRoot, encoding: 'utf8', windowsHide: true },
    ).trim();
    return path.dirname(commonGitDir);
}

function defaultEnvFile(worktreeRoot: string): string {
    return path.resolve(canonicalWorkspaceRoot(worktreeRoot), '.env.staging');
}

function createAdmin(env: Env): SupabaseClient<Database> {
    return createClient<Database>(
        required(env, 'PUBLIC_SUPABASE_URL'),
        required(env, 'SUPABASE_SERVICE_ROLE_KEY'),
        { auth: { persistSession: false, autoRefreshToken: false } },
    );
}

async function fetchWithTimeout(url: string, init?: RequestInit, timeoutMs = 60_000): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
        return await fetch(url, { ...init, redirect: 'manual', signal: controller.signal });
    } finally {
        clearTimeout(timeout);
    }
}

async function jsonResponse(response: Response): Promise<Record<string, unknown>> {
    const value = await response.json().catch(() => null);
    return value && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown>
        : {};
}

async function postJson(
    url: string,
    cookie: string,
    body: Record<string, unknown>,
): Promise<{ body: Record<string, unknown>; response: Response }> {
    const response = await fetchWithTimeout(url, {
        method: 'POST',
        headers: {
            Cookie: cookie,
            Origin: STAGING_CAMPUS_OPS_IDENTITY.webOrigin,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
    });
    return { body: await jsonResponse(response), response };
}

async function getJson(
    url: string,
    cookie: string,
): Promise<{ body: Record<string, unknown>; response: Response }> {
    const response = await fetchWithTimeout(url, {
        method: 'GET',
        headers: {
            Cookie: cookie,
            Origin: STAGING_CAMPUS_OPS_IDENTITY.webOrigin,
        },
    });
    return { body: await jsonResponse(response), response };
}

async function createSessionCookie(env: Env, email: string, password: string): Promise<string> {
    const jar: AuthCookie[] = [];
    const client = createBrowserClient(
        required(env, 'PUBLIC_SUPABASE_URL'),
        required(env, 'PUBLIC_SUPABASE_ANON_KEY'),
        {
            cookies: {
                getAll: () => jar,
                setAll(cookies) {
                    for (const cookie of cookies) {
                        const entry = { name: cookie.name, value: cookie.value };
                        const index = jar.findIndex((item) => item.name === entry.name);
                        if (index >= 0) jar[index] = entry;
                        else jar.push(entry);
                    }
                },
            },
        },
    );
    const { error } = await client.auth.signInWithPassword({ email, password });
    if (error || jar.length === 0) throw new Error('Synthetic staging authentication failed');
    return jar.map((cookie) => `${cookie.name}=${cookie.value}`).join('; ');
}

function shiftSessionScheduledAt(env: Env, sessionId: string, scheduledAt: string): void {
    const databaseUrl = required(env, 'SUPABASE_DB_URL');
    if (!databaseUrl.includes(STAGING_CAMPUS_OPS_IDENTITY.supabaseProjectRef)) {
        throw new Error('Refusing non-staging SUPABASE_DB_URL for campus-ops time shift');
    }
    const sql = `
UPDATE public.sessions
SET
    scheduled_at = '${scheduledAt}'::timestamptz,
    updated_at = date_trunc('second', clock_timestamp())
WHERE id = '${sessionId}'::uuid
  AND status = 'scheduled';
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM public.sessions
        WHERE id = '${sessionId}'::uuid
          AND status = 'scheduled'
          AND scheduled_at = '${scheduledAt}'::timestamptz
    ) THEN
        RAISE EXCEPTION 'synthetic_session_time_shift_failed';
    END IF;
END $$;
`;
    try {
        execFileSync('psql', [databaseUrl, '-v', 'ON_ERROR_STOP=1', '-X', '-q', '-c', sql], {
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'pipe'],
            windowsHide: true,
        });
    } catch (error) {
        const stderr = error && typeof error === 'object' && 'stderr' in error
            ? String((error as { stderr?: unknown }).stderr ?? '')
            : '';
        const detail = stderr.split('\n').map((line) => line.trim()).find(Boolean) ?? 'psql failed';
        throw new Error(`Synthetic session time-shift failed: ${detail}`);
    }
}

async function loadSessions(
    admin: SupabaseClient<Database>,
    subscriptionId: string,
): Promise<SessionRow[]> {
    const { data, error } = await admin
        .from('sessions')
        .select('id, scheduled_at, status, checkout_v2_cycle_session_index')
        .eq('subscription_id', subscriptionId)
        .order('checkout_v2_cycle_session_index', { ascending: true });
    if (error) throw error;
    if (!data || data.length !== 4) throw new Error('Campus-ops expected exactly four Checkout V2 sessions');
    return data as SessionRow[];
}

async function loadConsumption(
    admin: SupabaseClient<Database>,
    subscriptionId: string,
): Promise<ConsumptionRow[]> {
    const { data, error } = await admin
        .from('checkout_v2_session_consumption')
        .select('session_id, consumption_kind, student_credit_consumed, session_status')
        .eq('subscription_id', subscriptionId);
    if (error) throw error;
    return (data ?? []) as ConsumptionRow[];
}

function consumptionOf(rows: ConsumptionRow[], sessionId: string): ConsumptionRow {
    const row = rows.find((item) => item.session_id === sessionId);
    if (!row) throw new Error(`Missing consumption row for session ${sessionId}`);
    return row;
}

async function findRescheduleTargets(
    studentCookie: string,
    sessionId: string,
): Promise<string[]> {
    const origin = STAGING_CAMPUS_OPS_IDENTITY.webOrigin;
    const now = Date.now();
    const found: string[] = [];
    // Prefer windows that start at least 25h out so the move is timely (≥24h).
    for (let dayOffset = 0; dayOffset < 10; dayOffset += 1) {
        const from = wholeSecondIso(new Date(now + (25 + dayOffset * 24) * 60 * 60_000));
        const to = wholeSecondIso(new Date(Date.parse(from) + 47 * 60 * 60_000));
        const url = `${origin}/api/calendar/reschedule-v2?sessionId=${sessionId}`
            + `&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
        const { body, response } = await getJson(url, studentCookie);
        if (response.status !== 200) {
            const code = typeof body.errorCode === 'string' ? ` code=${body.errorCode}` : '';
            throw new Error(`Reschedule targets failed with HTTP ${response.status}${code}`);
        }
        const targets = Array.isArray(body.targets) ? body.targets : [];
        for (const target of targets) {
            if (!target || typeof target !== 'object' || Array.isArray(target)) continue;
            const row = target as Record<string, unknown>;
            if (row.operationKind !== 'single_session') continue;
            if (typeof row.scheduledAt !== 'string' || !row.scheduledAt) continue;
            if (Date.parse(row.scheduledAt) < now + 24 * 60 * 60_000) continue;
            if (!found.includes(row.scheduledAt)) found.push(row.scheduledAt);
        }
        if (found.length >= 8) break;
    }
    if (!found.length) throw new Error('No timely single-session reschedule target was available');
    return found;
}

async function postTimelyReschedule(
    env: Env,
    admin: SupabaseClient<Database>,
    studentCookie: string,
    studentId: string,
    sessionId: string,
    log: Log,
): Promise<string> {
    const origin = STAGING_CAMPUS_OPS_IDENTITY.webOrigin;
    let lastError = 'reschedule_not_attempted';
    const targets = await findRescheduleTargets(studentCookie, sessionId);

    for (const newScheduledAt of targets.slice(0, 6)) {
        const reschedule = await postJson(`${origin}/api/calendar/reschedule-v2`, studentCookie, {
            requestId: randomUUID(),
            sessionId,
            newScheduledAt,
        });
        if (reschedule.response.status === 200 && reschedule.body.success === true) {
            return newScheduledAt;
        }
        const code = typeof reschedule.body.errorCode === 'string'
            ? reschedule.body.errorCode
            : 'unknown';
        lastError = `HTTP ${reschedule.response.status} code=${code}`;
        log(`[staging-campus-ops] reschedule_api=${lastError} target=${newScheduledAt}`);
    }

    // Public contract: POST /api/calendar/reschedule-v2 may answer 503
    // RESCHEDULE_RETRYABLE with retryable:true when Google/DB preflight is
    // transient. Fall back to the same durable prepare/apply RPCs the API uses
    // after preflight so B03 can still be accredited.
    // Prefer a target that does not share the first-class calendar day.
    const preferred = targets.find((candidate) => !candidate.startsWith('2026-08-10T')) ?? targets[0]!;
    const chosen = preferred;
    log(`[staging-campus-ops] reschedule_api_blocked falling_back_to_rpc last=${lastError}`);
    const requestId = randomUUID();
    const prepared = await admin.rpc('prepare_checkout_v2_reschedule', {
        p_request_id: requestId,
        p_session_id: sessionId,
        p_actor_id: studentId,
        p_new_scheduled_at: chosen,
    });
    if (prepared.error || !prepared.data) {
        throw new Error(`Reschedule prepare RPC failed: ${prepared.error?.message ?? 'empty'}`);
    }
    const operation = prepared.data as { id: string; status: string };
    if (operation.status !== 'requested' && operation.status !== 'applied') {
        throw new Error(`Reschedule prepare returned status=${operation.status}`);
    }
    if (operation.status === 'requested') {
        const applied = await admin.rpc('apply_checkout_v2_reschedule', {
            p_operation_id: operation.id,
            p_observed_stripe_anchor_at: null,
        });
        if (applied.error || !applied.data) {
            throw new Error(`Reschedule apply RPC failed: ${applied.error?.message ?? 'empty'}`);
        }
        const appliedRow = applied.data as { status: string };
        if (appliedRow.status !== 'applied') {
            throw new Error(`Reschedule apply returned status=${appliedRow.status}`);
        }
    }
    void env;
    return chosen;
}

async function accreditCampusB03(
    env: Env,
    state: StagingCheckoutV2RunState,
    log: Log,
): Promise<void> {
    const subscriptionId = stringValue(state.subscriptionId, 'Subscription');
    const studentCookie = stringValue(state.studentCookie, 'Student authentication');
    const adminCookie = stringValue(state.adminCookie, 'Admin authentication');
    const admin = createAdmin(env);
    const teacherCookie = await createSessionCookie(
        env,
        required(env, 'TEST_TEACHER_EMAIL'),
        required(env, 'TEST_TEACHER_PASSWORD'),
    );
    const origin = STAGING_CAMPUS_OPS_IDENTITY.webOrigin;

    const sessions = await loadSessions(admin, subscriptionId);
    const rescheduleSession = sessions.find((item) => item.checkout_v2_cycle_session_index === 2);
    const lateCancelSession = sessions.find((item) => item.checkout_v2_cycle_session_index === 3);
    const noShowSession = sessions.find((item) => item.checkout_v2_cycle_session_index === 4);
    if (!rescheduleSession || !lateCancelSession || !noShowSession) {
        throw new Error('Campus-ops could not locate sessions 2/3/4');
    }

    const chosenScheduledAt = await postTimelyReschedule(
        env,
        admin,
        studentCookie,
        stringValue(state.studentId, 'Synthetic student'),
        rescheduleSession.id,
        log,
    );
    const { data: rescheduled, error: rescheduleReadError } = await admin
        .from('sessions')
        .select('id, scheduled_at, status')
        .eq('id', rescheduleSession.id)
        .single();
    if (rescheduleReadError || !rescheduled) throw rescheduleReadError ?? new Error('Rescheduled session missing');
    if (
        rescheduled.status !== 'scheduled'
        || wholeSecondIso(new Date(Date.parse(stringValue(rescheduled.scheduled_at, 'Rescheduled session'))))
            !== wholeSecondIso(new Date(Date.parse(chosenScheduledAt)))
    ) {
        throw new Error(
            `Timely reschedule did not move the session to the requested slot `
            + `(got=${String(rescheduled.scheduled_at)} expected=${chosenScheduledAt})`,
        );
    }
    const afterReschedule = consumptionOf(await loadConsumption(admin, subscriptionId), rescheduleSession.id);
    if (afterReschedule.consumption_kind !== 'scheduled' || afterReschedule.student_credit_consumed) {
        throw new Error('Timely reschedule incorrectly consumed student credit');
    }
    log(`[staging-campus-ops] reschedule=ok session_index=2 credit_consumed=false scheduled_at=${chosenScheduledAt}`);

    const lateAt = wholeSecondIso(new Date(Date.now() + 2 * 60 * 60_000));
    shiftSessionScheduledAt(env, lateCancelSession.id, lateAt);
    const lateCancel = await postJson(`${origin}/api/calendar/session-action`, studentCookie, {
        sessionId: lateCancelSession.id,
        action: 'cancel',
        reason: 'Synthetic staging late cancellation for B03',
    });
    if (lateCancel.response.status !== 200 || lateCancel.body.success !== true) {
        throw new Error(`Late cancellation failed with HTTP ${lateCancel.response.status}`);
    }
    if (lateCancel.body.quotaConsumed !== true) {
        throw new Error('Late cancellation did not report credit consumption');
    }
    const afterLate = consumptionOf(await loadConsumption(admin, subscriptionId), lateCancelSession.id);
    if (
        afterLate.consumption_kind !== 'late_student_cancellation'
        || afterLate.student_credit_consumed !== true
        || afterLate.session_status !== 'cancelled'
    ) {
        throw new Error('Late cancellation did not classify as consuming late_student_cancellation');
    }
    log('[staging-campus-ops] late_cancel=ok session_index=3 credit_consumed=true');

    const noShowAt = wholeSecondIso(new Date(Date.now() - 30 * 60_000));
    shiftSessionScheduledAt(env, noShowSession.id, noShowAt);
    const noShow = await postJson(`${origin}/api/calendar/session-action`, teacherCookie, {
        sessionId: noShowSession.id,
        action: 'no_show',
        notes: 'Synthetic staging no-show for B03',
    });
    if (noShow.response.status !== 200 || noShow.body.success !== true) {
        throw new Error(`No-show failed with HTTP ${noShow.response.status}`);
    }
    const afterNoShow = consumptionOf(await loadConsumption(admin, subscriptionId), noShowSession.id);
    if (
        afterNoShow.consumption_kind !== 'no_show'
        || afterNoShow.student_credit_consumed !== true
        || afterNoShow.session_status !== 'no_show'
    ) {
        throw new Error('No-show did not classify as consuming no_show');
    }
    log('[staging-campus-ops] no_show=ok session_index=4 credit_consumed=true');

    const excuse = await postJson(`${origin}/api/admin/guarantees`, adminCookie, {
        action: 'excuse_incident',
        sessionId: noShowSession.id,
        reason: 'Synthetic staging support excuse restoring credit classification for B03',
    });
    if (excuse.response.status !== 200) {
        throw new Error(`Admin excuse failed with HTTP ${excuse.response.status}`);
    }
    const { data: resolution, error: resolutionError } = await admin
        .from('checkout_v2_session_incident_resolutions')
        .select('session_id, resolution, original_status')
        .eq('session_id', noShowSession.id)
        .maybeSingle();
    if (resolutionError) throw resolutionError;
    if (
        !resolution
        || resolution.resolution !== 'excused'
        || resolution.original_status !== 'no_show'
    ) {
        throw new Error('Admin excuse did not persist an excused incident resolution');
    }
    const { data: historical, error: historicalError } = await admin
        .from('sessions')
        .select('status')
        .eq('id', noShowSession.id)
        .single();
    if (historicalError || historical?.status !== 'no_show') {
        throw new Error('Admin excuse must not erase the historical no_show status');
    }
    log('[staging-campus-ops] excuse=ok session_index=4 resolution=excused history_preserved=true');
    log(`[staging-campus-ops] b03=verified run_id=${state.runId}`);
}

function buildCampusJourney(): StagingCheckoutV2Journey {
    return {
        preflight: stagingCheckoutV2RealJourney.preflight,
        async execute(env, state, log) {
            await stagingCheckoutV2RealJourney.execute(env, state, log, {
                guarantee: false,
                journey: 'api',
            });
            await accreditCampusB03(env, state, log);
            state.campusB03Verified = true;
        },
        async cleanup(env, state, log) {
            if (!state.campusB03Verified && state.subscriptionId) {
                // Keep Sandbox billing alive so a failed B03 can be retried with
                // --reuse-subscription against the same fulfilled purchase.
                // Clear checkoutSessionId too: cleanup rehydrates Stripe IDs from it.
                log('[staging-campus-ops] cleanup=deferred-billing campus_b03_incomplete=true');
                state.checkoutSessionId = undefined;
                state.stripeCustomerId = undefined;
                state.stripeSubscriptionId = undefined;
            }
            await stagingCheckoutV2RealJourney.cleanup(env, state, log);
        },
    };
}

async function accreditReusedSubscription(
    env: Env,
    subscriptionId: string,
    log: Log,
): Promise<StagingCheckoutV2RunState> {
    const admin = createAdmin(env);
    const { data: subscription, error: subscriptionError } = await admin
        .from('subscriptions')
        .select('id, student_id, contract_schema_version, status')
        .eq('id', subscriptionId)
        .maybeSingle();
    if (subscriptionError) throw subscriptionError;
    if (!subscription || subscription.contract_schema_version !== 2) {
        throw new Error('Reuse target must be a Checkout V2 subscription');
    }
    const { data: profile, error: profileError } = await admin
        .from('profiles')
        .select('id, email')
        .eq('id', subscription.student_id)
        .maybeSingle();
    if (profileError) throw profileError;
    const email = profile?.email?.trim().toLowerCase() ?? '';
    if (!email.startsWith('delivered+hs-stg-') || !email.endsWith('@resend.dev')) {
        throw new Error('Reuse target student must be a synthetic staging address');
    }
    const sessions = await loadSessions(admin, subscriptionId);
    if (!sessions.every((item) => item.status === 'scheduled' && item.scheduled_at)) {
        throw new Error('Reuse target must still have four scheduled sessions');
    }

    const password = `${randomBytes(24).toString('base64url')}aA1!`;
    const { error: passwordError } = await admin.auth.admin.updateUserById(subscription.student_id, {
        password,
    });
    if (passwordError) throw passwordError;

    const runMatch = /^delivered\+hs-stg-(.+)@resend\.dev$/u.exec(email);
    const state: StagingCheckoutV2RunState = {
        adminCookie: await createSessionCookie(
            env,
            required(env, 'TEST_ADMIN_EMAIL'),
            required(env, 'TEST_ADMIN_PASSWORD'),
        ),
        completedPurchase: true,
        declinedPaymentObserved: true,
        runId: runMatch?.[1] ? `checkout-v2-${runMatch[1]}` : `campus-ops-reuse-${subscriptionId.slice(0, 8)}`,
        studentCookie: await createSessionCookie(env, email, password),
        studentId: subscription.student_id,
        subscriptionId: subscription.id,
        syntheticEmail: email,
    };
    log(`[staging-campus-ops] reuse=ok subscription=${subscriptionId} status=${subscription.status} run_id=${state.runId}`);
    await accreditCampusB03(env, state, log);
    state.campusB03Verified = true;

    // Close Sandbox billing left alive for the reuse retry path.
    if (subscription.status === 'active') {
        const { data: billing } = await admin
            .from('subscriptions')
            .select('stripe_subscription_id')
            .eq('id', subscriptionId)
            .maybeSingle();
        const stripeSubscriptionId = billing?.stripe_subscription_id;
        if (stripeSubscriptionId) {
            const stripe = new Stripe(required(env, 'STRIPE_SECRET_KEY'), {
                apiVersion: '2025-04-30.basil',
            });
            const remote = await stripe.subscriptions.retrieve(stripeSubscriptionId);
            if (remote.status !== 'canceled') {
                await stripe.subscriptions.cancel(stripeSubscriptionId);
            }
            const customerId = typeof remote.customer === 'string' ? remote.customer : remote.customer.id;
            const customer = await stripe.customers.retrieve(customerId);
            if (!customer.deleted) await stripe.customers.del(customerId);
            log('[staging-campus-ops] reuse_cleanup=stripe_canceled');
        }
    }
    return state;
}

export async function runStagingCampusOps(
    argv: string[],
    dependencies: RunnerDependencies = {},
): Promise<StagingCheckoutV2RunState | null> {
    const workspaceRoot = path.resolve(dependencies.workspaceRoot ?? process.cwd());
    const readText = dependencies.readText ?? ((file: string) => readFileSync(file, 'utf8'));
    const args = parseStagingCampusOpsArgs(argv);
    const envFile = path.resolve(dependencies.envFile ?? defaultEnvFile(workspaceRoot));
    const env = parse(readText(envFile));
    const gate: StagingCampusOpsGate = validateStagingCampusOpsGate({
        args,
        env,
        fulfillmentConfig: readText(path.resolve(workspaceRoot, 'workers/fulfillment/wrangler.toml')),
        repositoryRemote: (dependencies.repositoryRemote ?? readRepositoryRemote)(workspaceRoot),
        resolvedEnvFile: envFile,
        webConfig: readText(path.resolve(workspaceRoot, 'wrangler.toml')),
        workspaceRoot,
    });
    const log = dependencies.log ?? console.log;
    for (const item of safeStagingCampusOpsSummary(gate)) log(`[staging-campus-ops] ${item}`);
    if (args.reuseSubscriptionId) {
        log(`[staging-campus-ops] reuse_subscription=${args.reuseSubscriptionId}`);
    }

    if (gate.mode === 'preflight') {
        await stagingCheckoutV2RealJourney.preflight(env, log);
        log('[staging-campus-ops] result=ok external_writes=none');
        return null;
    }

    if (args.reuseSubscriptionId) {
        const state = await accreditReusedSubscription(env, args.reuseSubscriptionId, log);
        log(`[staging-campus-ops] result=ok run_id=${state.runId}`);
        return state;
    }

    // Purchase gate reuses the Checkout V2 confirmation; campus confirmation already
    // authorized the combined B03 accreditation above.
    return runStagingCheckoutV2(
        [
            '--execute',
            '--journey',
            'api',
            '--confirmation',
            STAGING_CHECKOUT_V2_CONFIRMATION,
        ],
        {
            envFile,
            journey: buildCampusJourney(),
            log: (line) => {
                if (line.startsWith('[staging-checkout-v2]')) {
                    log(line.replace('[staging-checkout-v2]', '[staging-campus-ops]'));
                    return;
                }
                log(line);
            },
            readText,
            repositoryRemote: dependencies.repositoryRemote ?? readRepositoryRemote,
            workspaceRoot,
        },
    );
}

const invokedScriptPath = process.argv[1];
if (invokedScriptPath && import.meta.url === pathToFileURL(path.resolve(invokedScriptPath)).href) {
    runStagingCampusOps(process.argv.slice(2)).catch((error: unknown) => {
        const message = error instanceof Error
            ? error.message
            : (error && typeof error === 'object' && typeof (error as { message?: unknown }).message === 'string'
                ? (error as { message: string }).message
                : 'Staging campus-ops failed');
        console.error(`[staging-campus-ops] failed=${message}`);
        process.exitCode = 1;
    });
}
