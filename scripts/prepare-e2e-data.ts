/**
 * Prepare Supabase data required by Playwright E2E tests.
 *
 * Selects the allowlisted staging Supabase project through the Playwright
 * environment guard. It refuses the base/production-labelled project.
 * This script writes only Supabase auth/database records and does not call
 * Stripe, Google Workspace, or Resend.
 *
 * Run after explicit staging write approval:
 * E2E_STAGING_WRITE_CONFIRMATION=writes-ok:mzjyvmlxfpzdfdjzxxyj \
 *   pnpm exec tsx scripts/prepare-e2e-data.ts
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../src/types/database.types';
import {
    configurePlaywrightEnvironment,
    STAGING_SUPABASE_PROJECT_REF,
} from '../tests/e2e/environment-guard';

const selectedEnvironment = configurePlaywrightEnvironment();
const expectedConfirmation = `writes-ok:${STAGING_SUPABASE_PROJECT_REF}`;

if (
    selectedEnvironment.target !== 'staging' ||
    selectedEnvironment.supabaseRef !== STAGING_SUPABASE_PROJECT_REF
) {
    throw new Error('E2E data preparation is allowed only on the approved staging Supabase project');
}

if (process.env.E2E_STAGING_WRITE_CONFIRMATION !== expectedConfirmation) {
    throw new Error(`Refusing staging writes without E2E_STAGING_WRITE_CONFIRMATION=${expectedConfirmation}`);
}

const supabaseUrl = process.env.PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
    throw new Error('Missing PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
}

type Role = 'student' | 'teacher' | 'admin';
type TestUser = {
    role: Role;
    email: string;
    password: string;
    name: string;
};
type PackageRow = Database['public']['Tables']['packages']['Row'];
type SubscriptionRow = Database['public']['Tables']['subscriptions']['Row'];

const required = (name: string): string => {
    const value = process.env[name];
    if (!value) throw new Error(`Missing ${name} in .env.test`);
    return value;
};

const users: TestUser[] = [
    {
        role: 'admin',
        email: required('TEST_ADMIN_EMAIL'),
        password: required('TEST_ADMIN_PASSWORD'),
        name: 'E2E Admin',
    },
    {
        role: 'teacher',
        email: required('TEST_TEACHER_EMAIL'),
        password: required('TEST_TEACHER_PASSWORD'),
        name: 'E2E Teacher',
    },
    {
        role: 'student',
        email: required('TEST_STUDENT_EMAIL'),
        password: required('TEST_STUDENT_PASSWORD'),
        name: 'E2E Student',
    },
];

const supabase: SupabaseClient<Database> = createClient<Database>(supabaseUrl, supabaseServiceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
});

function toDateOnly(date: Date): string {
    return date.toISOString().slice(0, 10);
}

function daysFromNow(days: number, hour: number, minute = 0): Date {
    const date = new Date();
    date.setUTCDate(date.getUTCDate() + days);
    date.setUTCHours(hour, minute, 0, 0);
    return date;
}

async function findAuthUserByEmail(email: string) {
    let page = 1;

    while (true) {
        const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 100 });
        if (error) throw error;

        const found = data.users.find((user) => user.email?.toLowerCase() === email.toLowerCase());
        if (found) return found;
        if (data.users.length < 100) return null;
        page += 1;
    }
}

async function ensureAuthUser(user: TestUser): Promise<string> {
    const existing = await findAuthUserByEmail(user.email);

    if (existing) {
        const { error } = await supabase.auth.admin.updateUserById(existing.id, {
            password: user.password,
            email_confirm: true,
            user_metadata: { full_name: user.name },
        });
        if (error) throw error;
        console.log(`updated auth user: ${user.role} ${user.email}`);
        return existing.id;
    }

    const { data, error } = await supabase.auth.admin.createUser({
        email: user.email,
        password: user.password,
        email_confirm: true,
        user_metadata: { full_name: user.name },
    });

    if (error) throw error;
    if (!data.user) throw new Error(`Supabase did not return a user for ${user.email}`);

    console.log(`created auth user: ${user.role} ${user.email}`);
    return data.user.id;
}

async function ensureProfile(user: TestUser, id: string) {
    const { error } = await supabase
        .from('profiles')
        .upsert({
            id,
            email: user.email,
            full_name: user.name,
            role: user.role,
            preferred_language: 'es',
            timezone: 'Europe/Madrid',
        }, { onConflict: 'id' });

    if (error) throw error;

    const { error: privateError } = await supabase
        .from('profiles_private')
        .upsert({
            profile_id: id,
            current_level: 'A2',
        }, { onConflict: 'profile_id' });

    if (privateError && privateError.code !== '42P01') {
        throw privateError;
    }
}

async function choosePackage(): Promise<PackageRow> {
    const preferred = ['standard', 'bootcamp'];

    for (const name of preferred) {
        const { data, error } = await supabase
            .from('packages')
            .select('*')
            .eq('name', name)
            .maybeSingle();

        if (error) throw error;
        if (data) return data;
    }

    throw new Error('No checkout-eligible Standard or Bootcamp package exists for the E2E subscription');
}

async function ensureAssignment(studentId: string, teacherId: string) {
    const { error: demoteError } = await supabase
        .from('student_teachers')
        .update({ is_primary: false })
        .eq('student_id', studentId);

    if (demoteError) throw demoteError;

    const { error } = await supabase
        .from('student_teachers')
        .upsert({
            student_id: studentId,
            teacher_id: teacherId,
            is_primary: true,
        }, { onConflict: 'student_id,teacher_id' });

    if (error) throw error;
}

async function ensureSubscription(studentId: string, pkg: PackageRow): Promise<SubscriptionRow> {
    const startsAt = toDateOnly(daysFromNow(-7, 0));
    const endsAt = toDateOnly(daysFromNow(120, 0));
    const sessionsTotal = Math.max(pkg.sessions_per_month * 6, 40);

    const { data: existing, error: existingError } = await supabase
        .from('subscriptions')
        .select('*')
        .eq('student_id', studentId)
        .eq('status', 'active')
        .maybeSingle();

    if (existingError) throw existingError;

    if (existing) {
        const { data, error } = await supabase
            .from('subscriptions')
            .update({
                package_id: pkg.id,
                duration_months: 6,
                starts_at: startsAt,
                ends_at: endsAt,
                sessions_total: sessionsTotal,
                sessions_used: 2,
                stripe_subscription_id: 'sub_e2e_seed',
                stripe_invoice_id: 'in_e2e_seed',
            })
            .eq('id', existing.id)
            .select('*')
            .single();

        if (error) throw error;
        return data;
    }

    const { data, error } = await supabase
        .from('subscriptions')
        .insert({
            student_id: studentId,
            package_id: pkg.id,
            status: 'active',
            duration_months: 6,
            starts_at: startsAt,
            ends_at: endsAt,
            sessions_total: sessionsTotal,
            sessions_used: 2,
            stripe_subscription_id: 'sub_e2e_seed',
            stripe_invoice_id: 'in_e2e_seed',
        })
        .select('*')
        .single();

    if (error) throw error;
    return data;
}

async function ensureAvailability(teacherId: string) {
    for (const day of [1, 2, 3, 4, 5]) {
        const { data, error } = await supabase
            .from('teacher_availability')
            .select('id')
            .eq('teacher_id', teacherId)
            .eq('day_of_week', day)
            .eq('start_time', '09:00:00')
            .eq('end_time', '18:00:00')
            .maybeSingle();

        if (error) throw error;
        if (data) continue;

        const { error: insertError } = await supabase
            .from('teacher_availability')
            .insert({
                teacher_id: teacherId,
                day_of_week: day,
                start_time: '09:00:00',
                end_time: '18:00:00',
                is_active: true,
            });

        if (insertError) throw insertError;
    }
}

async function clearE2eSessions(studentId: string, teacherId: string) {
    // These accounts are dedicated to E2E. Clearing their sessions keeps repeated
    // scheduling tests from accumulating conflicts and consuming test quota.
    const { error } = await supabase
        .from('sessions')
        .delete()
        .eq('student_id', studentId)
        .eq('teacher_id', teacherId);

    if (error) throw error;
}

async function findFreeSessionTime(teacherId: string, startOffsetDays: number, hour: number): Promise<string> {
    for (let offset = startOffsetDays; offset < startOffsetDays + 60; offset++) {
        const candidate = daysFromNow(offset, hour, 10);
        const end = new Date(candidate.getTime() + 50 * 60 * 1000);

        const { data, error } = await supabase
            .from('sessions')
            .select('id')
            .eq('teacher_id', teacherId)
            .neq('status', 'cancelled')
            .gte('scheduled_at', candidate.toISOString())
            .lt('scheduled_at', end.toISOString());

        if (error) throw error;
        if (!data || data.length === 0) return candidate.toISOString();
    }

    throw new Error('Could not find a free teacher slot for seed sessions');
}

async function seedSessions(input: {
    studentId: string;
    teacherId: string;
    subscriptionId: string;
}) {
    await clearE2eSessions(input.studentId, input.teacherId);

    const futureAt = await findFreeSessionTime(input.teacherId, 21, 9);
    const pastAt = daysFromNow(-14, 9, 10).toISOString();

    const { error } = await supabase
        .from('sessions')
        .insert([
            {
                subscription_id: input.subscriptionId,
                student_id: input.studentId,
                teacher_id: input.teacherId,
                scheduled_at: futureAt,
                duration_minutes: 50,
                meet_link: 'https://meet.google.com/e2e-seed-future',
                status: 'scheduled',
                teacher_notes: 'E2E seed: future scheduled class',
            },
            {
                subscription_id: input.subscriptionId,
                student_id: input.studentId,
                teacher_id: input.teacherId,
                scheduled_at: pastAt,
                duration_minutes: 50,
                meet_link: 'https://meet.google.com/e2e-seed-past',
                status: 'completed',
                teacher_notes: 'E2E seed: completed class',
                completed_at: pastAt,
            },
        ]);

    if (error) throw error;
}

async function tableExists(table: 'fulfillment_jobs' | 'admin_audit_log') {
    const { error } = await supabase
        .from(table)
        .select('id')
        .limit(1);

    return !error;
}

async function main() {
    console.log(`Supabase: ${supabaseUrl}`);

    const ids = new Map<Role, string>();
    for (const user of users) {
        const id = await ensureAuthUser(user);
        await ensureProfile(user, id);
        ids.set(user.role, id);
    }

    const studentId = ids.get('student');
    const teacherId = ids.get('teacher');
    if (!studentId || !teacherId) throw new Error('Missing prepared student or teacher id');

    const pkg = await choosePackage();
    await ensureAssignment(studentId, teacherId);
    const subscription = await ensureSubscription(studentId, pkg);
    await ensureAvailability(teacherId);
    await seedSessions({ studentId, teacherId, subscriptionId: subscription.id });

    const hasFulfillmentJobs = await tableExists('fulfillment_jobs');
    const hasAuditLog = await tableExists('admin_audit_log');

    console.log('E2E data ready');
    console.log(`student=${users.find((user) => user.role === 'student')?.email}`);
    console.log(`teacher=${users.find((user) => user.role === 'teacher')?.email}`);
    console.log(`admin=${users.find((user) => user.role === 'admin')?.email}`);
    console.log(`package=${pkg.name}`);
    console.log(`fulfillment_jobs_table=${hasFulfillmentJobs ? 'present' : 'missing'}`);
    console.log(`admin_audit_log_table=${hasAuditLog ? 'present' : 'missing'}`);
}

main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
});
