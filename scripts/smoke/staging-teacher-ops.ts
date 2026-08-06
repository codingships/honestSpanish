/**
 * Staging accreditation for O01: activate a synthetic teacher, set availability,
 * create and publish a bookable slot, then retire and remove the synthetic identity.
 *
 * Preflight is read-only. Execute requires the confirmation token and only writes
 * to the approved staging Supabase + staging web origin.
 */
import { createBrowserClient } from '@supabase/ssr';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { randomBytes, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parse } from 'dotenv';
import type { Database } from '../../src/types/database.types';
import {
    parseStagingTeacherOpsArgs,
    safeStagingTeacherOpsSummary,
    STAGING_TEACHER_OPS_IDENTITY,
    validateStagingTeacherOpsGate,
    type StagingTeacherOpsGate,
} from './staging-teacher-ops-safety';

type Env = Record<string, string | undefined>;
type Log = (message: string) => void;
type AuthCookie = { name: string; value: string };

type RunState = {
    adminCookie?: string;
    availabilityIds: string[];
    password?: string;
    retainedImmutableEvidence?: boolean;
    runId: string;
    slotId?: string;
    slotPublicId?: string;
    syntheticEmail: string;
    teacherId?: string;
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
    if (!value) throw new Error(`Staging teacher-ops requires ${key}`);
    return value;
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

async function requestJson(
    url: string,
    cookie: string,
    method: 'POST' | 'DELETE',
    body: Record<string, unknown>,
): Promise<{ body: Record<string, unknown>; response: Response }> {
    const response = await fetchWithTimeout(url, {
        method,
        headers: {
            Cookie: cookie,
            Origin: STAGING_TEACHER_OPS_IDENTITY.webOrigin,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
    });
    return { body: await jsonResponse(response), response };
}

function stringValue(value: unknown, label: string): string {
    if (typeof value !== 'string' || !value) throw new Error(`${label} returned an invalid identifier`);
    return value;
}

function assertHttp(response: Response, body: Record<string, unknown>, expected: number, label: string): void {
    if (response.status !== expected) {
        const detail = typeof body.error === 'string' ? ` error=${body.error}` : '';
        throw new Error(`${label} failed with HTTP ${response.status}${detail}`);
    }
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

const madridWeekdayHour = new Intl.DateTimeFormat('en-US', {
    hour: '2-digit',
    hour12: false,
    minute: '2-digit',
    timeZone: 'Europe/Madrid',
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
});

function madridParts(date: Date): { dateKey: string; weekday: number } {
    const parts = Object.fromEntries(
        madridWeekdayHour.formatToParts(date).map((part) => [part.type, part.value]),
    ) as Record<string, string>;
    const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    return {
        dateKey: `${parts.year}-${parts.month}-${parts.day}`,
        weekday: weekdays.indexOf(parts.weekday ?? ''),
    };
}

function chooseSchedule(): { firstClassDate: string; localStartTime: string; weekday: number } {
    for (let dayOffset = 2; dayOffset <= 16; dayOffset += 1) {
        const candidate = new Date(Date.now() + dayOffset * 86_400_000);
        const day = madridParts(candidate);
        if (day.weekday < 1 || day.weekday > 5) continue;
        return { firstClassDate: day.dateKey, localStartTime: '10:00', weekday: day.weekday };
    }
    throw new Error('No weekday schedule is available for the synthetic teacher slot');
}

async function waitForProfile(admin: SupabaseClient<Database>, userId: string): Promise<void> {
    for (let attempt = 0; attempt < 40; attempt += 1) {
        const { data, error } = await admin.from('profiles').select('id').eq('id', userId).maybeSingle();
        if (data) return;
        if (error) throw error;
        await new Promise((resolve) => setTimeout(resolve, 200));
    }
    throw new Error('Synthetic teacher profile was not created');
}

function newRunState(): RunState {
    const stamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
    const suffix = randomBytes(4).toString('hex');
    return {
        availabilityIds: [],
        runId: `teacher-ops-${stamp}-${suffix}`,
        syntheticEmail: `delivered+hs-stg-o01-${stamp}-${suffix}@resend.dev`,
    };
}

async function createSyntheticCandidate(
    env: Env,
    admin: SupabaseClient<Database>,
    state: RunState,
): Promise<void> {
    const password = `${randomBytes(24).toString('base64url')}aA1!`;
    state.password = password;
    const { data, error } = await admin.auth.admin.createUser({
        email: state.syntheticEmail,
        email_confirm: true,
        password,
        user_metadata: { full_name: `Staging Teacher Ops ${state.runId}` },
    });
    if (error || !data.user) throw error ?? new Error('Could not create synthetic teacher candidate');
    state.teacherId = data.user.id;
    await waitForProfile(admin, data.user.id);

    const cookie = await createSessionCookie(env, state.syntheticEmail, password);
    const confirmed = await requestJson(
        `${STAGING_TEACHER_OPS_IDENTITY.webOrigin}/api/auth/confirm-adult`,
        cookie,
        'POST',
        { adultConfirmed: true },
    );
    assertHttp(confirmed.response, confirmed.body, 200, 'Synthetic adult confirmation');
}

async function activateTeacher(state: RunState, log: Log): Promise<void> {
    const adminCookie = stringValue(state.adminCookie, 'Admin authentication');
    const activated = await requestJson(
        `${STAGING_TEACHER_OPS_IDENTITY.webOrigin}/api/admin/teachers-slots`,
        adminCookie,
        'POST',
        {
            action: 'activate_teacher',
            email: state.syntheticEmail,
            engagementKind: 'external',
            effectiveFrom: new Date(Date.now() - 60_000).toISOString(),
            reason: `Synthetic staging O01 accreditation ${state.runId}`,
            requestId: randomUUID(),
        },
    );
    assertHttp(activated.response, activated.body, 200, 'Synthetic teacher activation');
    const result = activated.body.result as { profile?: { id?: unknown; role?: unknown } } | null;
    const profileId = stringValue(result?.profile?.id, 'Activated teacher profile');
    if (profileId !== state.teacherId || result?.profile?.role !== 'teacher') {
        throw new Error('Activated teacher profile does not match the synthetic candidate');
    }
    log(`[staging-teacher-ops] teacher=activated id=${profileId} engagement=external`);
}

async function setAvailability(state: RunState, log: Log): Promise<void> {
    const adminCookie = stringValue(state.adminCookie, 'Admin authentication');
    const teacherId = stringValue(state.teacherId, 'Synthetic teacher');
    for (let dayOfWeek = 1; dayOfWeek <= 5; dayOfWeek += 1) {
        const created = await requestJson(
            `${STAGING_TEACHER_OPS_IDENTITY.webOrigin}/api/teacher/availability`,
            adminCookie,
            'POST',
            {
                teacherId,
                dayOfWeek,
                startTime: '09:00',
                endTime: '18:00',
            },
        );
        assertHttp(created.response, created.body, 201, `Synthetic availability weekday=${dayOfWeek}`);
        const availability = created.body.availability as { id?: unknown } | null;
        state.availabilityIds.push(stringValue(availability?.id, 'Synthetic availability'));
    }
    log(`[staging-teacher-ops] availability=created weekdays=1-5 windows=${state.availabilityIds.length}`);
}

async function createAndPublishSlot(state: RunState, log: Log): Promise<void> {
    const adminCookie = stringValue(state.adminCookie, 'Admin authentication');
    const teacherId = stringValue(state.teacherId, 'Synthetic teacher');
    const schedule = chooseSchedule();
    const endpoint = `${STAGING_TEACHER_OPS_IDENTITY.webOrigin}/api/admin/teachers-slots`;

    const created = await requestJson(endpoint, adminCookie, 'POST', {
        action: 'create_slot',
        firstClassDate: schedule.firstClassDate,
        localStartTime: schedule.localStartTime,
        reason: `Synthetic staging O01 accreditation ${state.runId}`,
        requestId: randomUUID(),
        teacherId,
    });
    assertHttp(created.response, created.body, 200, 'Synthetic slot creation');
    const slot = created.body.result as { id?: unknown; public_id?: unknown } | null;
    state.slotId = stringValue(slot?.id, 'Synthetic slot');
    state.slotPublicId = stringValue(slot?.public_id, 'Synthetic slot public id');

    const published = await requestJson(endpoint, adminCookie, 'POST', {
        action: 'transition_slot',
        reason: `Synthetic staging O01 accreditation ${state.runId}`,
        requestId: randomUUID(),
        slotId: state.slotId,
        transition: 'publish',
    });
    assertHttp(published.response, published.body, 200, 'Synthetic slot publication');
    log(
        `[staging-teacher-ops] slot=published id=${state.slotId} public_id=${state.slotPublicId} `
        + `first_class=${schedule.firstClassDate}T${schedule.localStartTime}@Europe/Madrid`,
    );
}

async function verifyPersistedState(admin: SupabaseClient<Database>, state: RunState, log: Log): Promise<void> {
    const teacherId = stringValue(state.teacherId, 'Synthetic teacher');
    const slotId = stringValue(state.slotId, 'Synthetic slot');

    const [profile, engagement, availability, slot] = await Promise.all([
        admin.from('profiles').select('id,role,email').eq('id', teacherId).single(),
        admin.from('teacher_compensation_engagements').select('id,engagement_kind,teacher_id')
            .eq('teacher_id', teacherId).eq('engagement_kind', 'external').limit(2),
        admin.from('teacher_availability').select('id,is_active')
            .eq('teacher_id', teacherId).eq('is_active', true),
        admin.from('bookable_slots').select('id,status,public_id,teacher_id').eq('id', slotId).single(),
    ]);
    const queryError = profile.error ?? engagement.error ?? availability.error ?? slot.error;
    if (queryError) throw queryError;
    if (
        profile.data?.role !== 'teacher'
        || profile.data.email !== state.syntheticEmail
        || (engagement.data?.length ?? 0) < 1
        || (availability.data?.length ?? 0) < 5
        || slot.data?.status !== 'available'
        || slot.data.public_id !== state.slotPublicId
        || slot.data.teacher_id !== teacherId
    ) {
        throw new Error('Persisted O01 state does not match activation + availability + published slot');
    }
    log('[staging-teacher-ops] verify=ok role=teacher engagement=external availability=5 slot=available');
}

async function cleanup(
    admin: SupabaseClient<Database>,
    state: RunState,
    log: Log,
): Promise<void> {
    const adminCookie = state.adminCookie;
    if (state.slotId && adminCookie) {
        const retired = await requestJson(
            `${STAGING_TEACHER_OPS_IDENTITY.webOrigin}/api/admin/teachers-slots`,
            adminCookie,
            'POST',
            {
                action: 'transition_slot',
                reason: `Synthetic staging O01 cleanup ${state.runId}`,
                requestId: randomUUID(),
                slotId: state.slotId,
                transition: 'retire',
            },
        );
        if (retired.response.status !== 200) {
            state.retainedImmutableEvidence = true;
            log(`[staging-teacher-ops] cleanup=slot-retire-failed status=${retired.response.status}`);
        }
    }

    // Soft-delete via service role: some edges drop DELETE request bodies.
    if (state.teacherId) {
        const deactivated = await admin
            .from('teacher_availability')
            .update({ is_active: false })
            .eq('teacher_id', state.teacherId)
            .eq('is_active', true)
            .select('id');
        if (deactivated.error) {
            state.retainedImmutableEvidence = true;
            log(`[staging-teacher-ops] cleanup=availability-failed code=${deactivated.error.code ?? 'unknown'}`);
        }
    }

    if (state.teacherId) {
        const deleted = await admin.auth.admin.deleteUser(state.teacherId);
        if (deleted.error) {
            state.retainedImmutableEvidence = true;
            log(`[staging-teacher-ops] cleanup=user-delete-failed code=${deleted.error.code ?? 'unknown'}`);
        }
    }

    log(`[staging-teacher-ops] cleanup=ok retained_immutable_evidence=${String(Boolean(state.retainedImmutableEvidence))}`);
}

async function preflight(env: Env, admin: SupabaseClient<Database>, log: Log): Promise<void> {
    const [home, adminProfile] = await Promise.all([
        fetchWithTimeout(`${STAGING_TEACHER_OPS_IDENTITY.webOrigin}/es/`, undefined, 30_000),
        admin.from('profiles').select('id,role').eq('email', required(env, 'TEST_ADMIN_EMAIL')).limit(2),
    ]);
    if (!home.ok && home.status !== 304) throw new Error(`Staging web preflight failed with HTTP ${home.status}`);
    if (adminProfile.error || adminProfile.data?.length !== 1 || adminProfile.data[0]?.role !== 'admin') {
        throw new Error('Staging admin identity is missing or ambiguous');
    }
    log('[staging-teacher-ops] preflight=ok supabase=staging web=staging');
}

export async function runStagingTeacherOps(
    argv: string[],
    dependencies: RunnerDependencies = {},
): Promise<RunState | null> {
    const workspaceRoot = path.resolve(dependencies.workspaceRoot ?? process.cwd());
    const readText = dependencies.readText ?? ((file: string) => readFileSync(file, 'utf8'));
    const args = parseStagingTeacherOpsArgs(argv);
    const envFile = path.resolve(dependencies.envFile ?? defaultEnvFile(workspaceRoot));
    const env = parse(readText(envFile));
    const gate: StagingTeacherOpsGate = validateStagingTeacherOpsGate({
        args,
        env,
        repositoryRemote: (dependencies.repositoryRemote ?? readRepositoryRemote)(workspaceRoot),
        resolvedEnvFile: envFile,
        webConfig: readText(path.resolve(workspaceRoot, 'wrangler.toml')),
        workspaceRoot,
    });
    const log = dependencies.log ?? ((message: string) => console.log(message));
    for (const line of safeStagingTeacherOpsSummary(gate)) {
        log(`[staging-teacher-ops] ${line}`);
    }

    const admin = createAdmin(env);
    await preflight(env, admin, log);
    if (gate.mode === 'preflight') {
        log('[staging-teacher-ops] result=ok external_writes=none');
        return null;
    }

    const state = newRunState();
    log(`[staging-teacher-ops] execute=start run_id=${state.runId}`);
    let executionError: unknown;
    try {
        state.adminCookie = await createSessionCookie(
            env,
            required(env, 'TEST_ADMIN_EMAIL'),
            required(env, 'TEST_ADMIN_PASSWORD'),
        );
        await createSyntheticCandidate(env, admin, state);
        await activateTeacher(state, log);
        await setAvailability(state, log);
        await createAndPublishSlot(state, log);
        await verifyPersistedState(admin, state, log);
    } catch (error) {
        executionError = error;
    }
    try {
        await cleanup(admin, state, log);
    } catch (cleanupError) {
        if (executionError) {
            throw new AggregateError([executionError, cleanupError], 'Teacher-ops journey and cleanup both failed');
        }
        throw cleanupError;
    }
    if (executionError) throw executionError;
    log(`[staging-teacher-ops] result=ok run_id=${state.runId}`);
    return state;
}

const invokedScriptPath = process.argv[1];
if (invokedScriptPath && import.meta.url === pathToFileURL(path.resolve(invokedScriptPath)).href) {
    runStagingTeacherOps(process.argv.slice(2)).catch((error: unknown) => {
        const message = error instanceof Error ? error.message : 'unknown failure';
        console.error(`[staging-teacher-ops] failed=${message}`);
        process.exitCode = 1;
    });
}
