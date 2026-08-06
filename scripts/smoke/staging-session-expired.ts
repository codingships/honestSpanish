/**
 * Staging accreditation for A01: expired campus session recovery.
 *
 * 1) Middleware redirects an unauthenticated campus visit to login with returnTo.
 * 2) A live campus page that later sees a same-origin API 401 shows the alert and
 *    a role-compatible login link.
 * 3) A role-incompatible destination is dropped from the login returnTo.
 */
import { createBrowserClient } from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';
import { randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parse } from 'dotenv';
import { chromium } from 'playwright';
import { buildCampusSessionLoginUrl } from '../../src/lib/campus-session-recovery';
import {
    parseStagingSessionExpiredArgs,
    safeStagingSessionExpiredSummary,
    STAGING_SESSION_EXPIRED_IDENTITY,
    validateStagingSessionExpiredGate,
    type StagingSessionExpiredGate,
} from './staging-session-expired-safety';
import { stagingBrowserCookies } from './staging-checkout-v2-safety';

type Env = Record<string, string | undefined>;
type Log = (message: string) => void;
type AuthCookie = { name: string; value: string };

type RunnerDependencies = {
    envFile?: string;
    log?: Log;
    readText?: (file: string) => string;
    repositoryRemote?: (workspaceRoot: string) => string;
    workspaceRoot?: string;
};

const ADMIN_CAMPUS_PATH = '/es/campus/admin/packages?tab=drafts';
const ADMIN_API_PROBE = '/api/admin/audit';

function required(env: Env, key: string): string {
    const value = env[key]?.trim();
    if (!value) throw new Error(`Staging session-expired requires ${key}`);
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

async function fetchWithTimeout(url: string, init?: RequestInit, timeoutMs = 60_000): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
        return await fetch(url, { ...init, redirect: 'manual', signal: controller.signal });
    } finally {
        clearTimeout(timeout);
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

function locationPath(response: Response): string {
    const location = response.headers.get('location');
    if (!location) throw new Error('Campus redirect did not include Location');
    const url = new URL(location, STAGING_SESSION_EXPIRED_IDENTITY.webOrigin);
    return `${url.pathname}${url.search}${url.hash}`;
}

async function accreditMiddlewareRedirect(log: Log): Promise<void> {
    const destination = `${STAGING_SESSION_EXPIRED_IDENTITY.webOrigin}${ADMIN_CAMPUS_PATH}`;
    const response = await fetchWithTimeout(destination);
    if (![301, 302, 303, 307, 308].includes(response.status)) {
        throw new Error(`Unauthenticated campus visit returned HTTP ${response.status}`);
    }
    const redirected = locationPath(response);
    const expectedReturnTo = encodeURIComponent(ADMIN_CAMPUS_PATH);
    const expected = `/es/login?returnTo=${expectedReturnTo}`;
    if (redirected !== expected) {
        throw new Error(`Middleware redirect mismatch: got ${redirected}, expected ${expected}`);
    }
    log('[staging-session-expired] middleware=ok returnTo=admin-packages');
}

async function accreditClientAlert(env: Env, log: Log): Promise<void> {
    const cookieHeader = await createSessionCookie(
        env,
        required(env, 'TEST_ADMIN_EMAIL'),
        required(env, 'TEST_ADMIN_PASSWORD'),
    );
    const browser = await chromium.launch({ headless: true });
    try {
        const context = await browser.newContext();
        await context.addCookies(stagingBrowserCookies(cookieHeader));
        const page = await context.newPage();
        const campusUrl = `${STAGING_SESSION_EXPIRED_IDENTITY.webOrigin}${ADMIN_CAMPUS_PATH}`;
        await page.goto(campusUrl, { waitUntil: 'domcontentloaded', timeout: 90_000 });
        await page.waitForSelector('#session-expired-alert', { state: 'attached', timeout: 30_000 });
        const initiallyHidden = await page.locator('#session-expired-alert').isHidden();
        if (!initiallyHidden) throw new Error('Session-expired alert was visible before expiry');

        await context.clearCookies();
        const probeStatus = await page.evaluate(async (apiPath) => {
            const response = await fetch(apiPath, {
                headers: { Accept: 'application/json' },
                credentials: 'same-origin',
            });
            return response.status;
        }, ADMIN_API_PROBE);
        if (probeStatus !== 401) {
            throw new Error(`Expired campus API probe returned HTTP ${probeStatus}, expected 401`);
        }

        await page.waitForFunction(() => {
            const alert = document.getElementById('session-expired-alert');
            return Boolean(alert && !alert.hasAttribute('hidden'));
        }, undefined, { timeout: 15_000 });

        const loginHref = await page.locator('#session-expired-login').getAttribute('href');
        const expected = buildCampusSessionLoginUrl(
            'es',
            'admin',
            campusUrl,
        );
        if (loginHref !== expected) {
            throw new Error(`Session-expired login href mismatch: got ${loginHref}, expected ${expected}`);
        }
        log('[staging-session-expired] client_alert=ok api_401=true returnTo=admin-packages');
    } finally {
        await browser.close();
    }
}

function accreditRoleIncompatibleReturnTo(log: Log): void {
    const incompatible = buildCampusSessionLoginUrl(
        'es',
        'teacher',
        `${STAGING_SESSION_EXPIRED_IDENTITY.webOrigin}${ADMIN_CAMPUS_PATH}`,
    );
    if (incompatible !== '/es/login') {
        throw new Error(`Teacher must not keep an admin returnTo, got ${incompatible}`);
    }
    log('[staging-session-expired] role_filter=ok incompatible_returnTo=dropped');
}

async function preflightIdentities(env: Env, log: Log): Promise<void> {
    const admin = createClient(
        required(env, 'PUBLIC_SUPABASE_URL'),
        required(env, 'SUPABASE_SERVICE_ROLE_KEY'),
        { auth: { persistSession: false, autoRefreshToken: false } },
    );
    const [home, adminProfile, teacherProfile] = await Promise.all([
        fetchWithTimeout(`${STAGING_SESSION_EXPIRED_IDENTITY.webOrigin}/es/`),
        admin.from('profiles').select('id,role,email')
            .eq('email', required(env, 'TEST_ADMIN_EMAIL').toLowerCase()).limit(2),
        admin.from('profiles').select('id,role,email')
            .eq('email', required(env, 'TEST_TEACHER_EMAIL').toLowerCase()).limit(2),
    ]);
    if (!home.ok && home.status !== 304) {
        throw new Error(`Staging web preflight failed with HTTP ${home.status}`);
    }
    if (adminProfile.error || adminProfile.data?.length !== 1 || adminProfile.data[0]?.role !== 'admin') {
        throw new Error('Staging admin identity is missing or ambiguous');
    }
    if (
        teacherProfile.error
        || teacherProfile.data?.length !== 1
        || teacherProfile.data[0]?.role !== 'teacher'
    ) {
        throw new Error('Staging teacher identity is missing or ambiguous');
    }
    log('[staging-session-expired] preflight=ok supabase=staging web=staging identities=ok');
}

export async function runStagingSessionExpired(
    argv: string[],
    dependencies: RunnerDependencies = {},
): Promise<{ runId: string } | null> {
    const workspaceRoot = path.resolve(dependencies.workspaceRoot ?? process.cwd());
    const readText = dependencies.readText ?? ((file: string) => readFileSync(file, 'utf8'));
    const args = parseStagingSessionExpiredArgs(argv);
    const envFile = path.resolve(dependencies.envFile ?? defaultEnvFile(workspaceRoot));
    const env = parse(readText(envFile));
    const gate: StagingSessionExpiredGate = validateStagingSessionExpiredGate({
        args,
        env,
        repositoryRemote: (dependencies.repositoryRemote ?? readRepositoryRemote)(workspaceRoot),
        resolvedEnvFile: envFile,
        webConfig: readText(path.resolve(workspaceRoot, 'wrangler.toml')),
        workspaceRoot,
    });
    const log = dependencies.log ?? console.log;
    for (const item of safeStagingSessionExpiredSummary(gate)) {
        log(`[staging-session-expired] ${item}`);
    }

    await preflightIdentities(env, log);
    accreditRoleIncompatibleReturnTo(log);

    if (gate.mode === 'preflight') {
        log('[staging-session-expired] result=ok external_writes=none');
        return null;
    }

    const runId = `session-expired-${new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14)}-${randomBytes(4).toString('hex')}`;
    await accreditMiddlewareRedirect(log);
    await accreditClientAlert(env, log);
    log(`[staging-session-expired] a01=verified run_id=${runId}`);
    log(`[staging-session-expired] result=ok run_id=${runId}`);
    return { runId };
}

const invokedScriptPath = process.argv[1];
if (invokedScriptPath && import.meta.url === pathToFileURL(path.resolve(invokedScriptPath)).href) {
    runStagingSessionExpired(process.argv.slice(2)).catch((error: unknown) => {
        const message = error instanceof Error
            ? error.message
            : (error && typeof error === 'object' && typeof (error as { message?: unknown }).message === 'string'
                ? (error as { message: string }).message
                : 'Staging session-expired failed');
        console.error(`[staging-session-expired] failed=${message}`);
        process.exitCode = 1;
    });
}
