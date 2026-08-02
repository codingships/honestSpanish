import type { APIContext, APIRoute } from 'astro';
import { z } from 'zod';
import {
    addDaysToDateKey,
    MADRID_TIME_ZONE,
    madridDateTimeToUtcIso,
    normalizeDateInputToDateKey,
} from '../../../lib/calendar/madrid-time';
import { INITIAL_INDIVIDUAL_OFFER } from '../../../lib/package-pricing';
import { createSupabaseAdminClient } from '../../../lib/supabase-admin';
import { createSupabaseServerClient } from '../../../lib/supabase-server';

const jsonHeaders = {
    'Cache-Control': 'private, no-store',
    'Content-Type': 'application/json; charset=utf-8',
};
const uuid = z.string().uuid();
const timestamp = z.string().datetime({ offset: true });
const reason = z.string().trim().min(5).max(1000);

const actionSchema = z.discriminatedUnion('action', [
    z.object({
        action: z.literal('activate_teacher'),
        requestId: uuid,
        email: z.string().trim().toLowerCase().email().max(320),
        engagementKind: z.enum(['founder', 'external']),
        effectiveFrom: timestamp,
        reason,
    }),
    z.object({
        action: z.literal('configure_engagement'),
        requestId: uuid,
        teacherId: uuid,
        engagementKind: z.enum(['founder', 'external']),
        effectiveFrom: timestamp,
        reason,
    }),
    z.object({
        action: z.literal('create_slot'),
        requestId: uuid,
        teacherId: uuid,
        firstClassDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        localStartTime: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/),
        reason,
    }),
    z.object({
        action: z.literal('transition_slot'),
        requestId: uuid,
        slotId: uuid,
        transition: z.enum(['publish', 'resume', 'pause', 'retire']),
        reason,
    }),
]);

type DatabaseError = { code?: string; message?: string } | null;
type PageResult<T> = { data: T[] | null; error: DatabaseError };

const READ_PAGE_SIZE = 200;
const SLOT_RELATION_BATCH_SIZE = 100;

function json(payload: unknown, status = 200): Response {
    return new Response(JSON.stringify(payload), { status, headers: jsonHeaders });
}

function sameOriginRequest(request: Request): boolean {
    const origin = request.headers.get('Origin');
    if (!origin) return false;
    try {
        return new URL(origin).origin === new URL(request.url).origin;
    } catch {
        return false;
    }
}

function escapeIlikePattern(value: string): string {
    return value
        .replaceAll('\\', '\\\\')
        .replaceAll('%', '\\%')
        .replaceAll('_', '\\_');
}

async function requireAdmin(context: APIContext) {
    const supabase = createSupabaseServerClient(context);
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error || !user) return { user: null, error: json({ error: 'Unauthorized' }, 401) };

    const { data: profile } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', user.id)
        .single();
    if (profile?.role !== 'admin') {
        return { user: null, error: json({ error: 'Forbidden' }, 403) };
    }
    return { user, error: null };
}

function databaseErrorResponse(error: DatabaseError): Response {
    const code = error?.code || '';
    const message = error?.message || '';
    if (code === '42501' || message.includes('_forbidden')) return json({ error: 'Forbidden' }, 403);
    if (code === 'P0002' || message.includes('_not_found')) return json({ error: 'No se encontr\u00f3 el recurso solicitado' }, 404);
    if (
        code === '23505'
        || code === '23P01'
        || code === '40001'
        || message.toLowerCase().includes('conflict')
    ) {
        return json({ error: 'La operaci\u00f3n entra en conflicto con el estado registrado' }, 409);
    }
    if (
        code === '22023'
        || code === '23514'
        || message.includes('invalid_')
        || message.includes('_requires_')
    ) {
        return json({ error: 'La operaci\u00f3n no cumple el contrato de profesores y horarios' }, 400);
    }
    console.error('[AdminTeachersSlots] Database operation failed', { code });
    return json({ error: 'No se pudo completar la operaci\u00f3n' }, 500);
}

function operationalLoadError(scope: string, error: DatabaseError): Response {
    console.error('[AdminTeachersSlots] Could not load administration data', {
        scope,
        code: error?.code || 'unknown',
    });
    return json({ error: 'No se pudo cargar la administraci\u00f3n de profesores y horarios' }, 500);
}

async function collectAllPages<T>(
    fetchPage: (from: number, to: number) => PromiseLike<PageResult<T>>,
): Promise<PageResult<T>> {
    const rows: T[] = [];

    for (let from = 0; ; from += READ_PAGE_SIZE) {
        const page = await fetchPage(from, from + READ_PAGE_SIZE - 1);
        if (page.error) return { data: null, error: page.error };

        const pageRows = page.data || [];
        rows.push(...pageRows);
        if (pageRows.length < READ_PAGE_SIZE) return { data: rows, error: null };
    }
}

function batches<T>(values: T[], size: number): T[][] {
    const result: T[][] = [];
    for (let offset = 0; offset < values.length; offset += size) {
        result.push(values.slice(offset, offset + size));
    }
    return result;
}

async function loadCanonicalPackage(admin: ReturnType<typeof createSupabaseAdminClient>) {
    const packagesResult = await admin
        .from('packages')
        .select('id, name, display_name, amount_cents, contract_schema_version, billing_interval_unit, billing_interval_count, sessions_per_period, class_duration_minutes')
        .eq('name', INITIAL_INDIVIDUAL_OFFER.packageKey)
        .eq('is_active', true)
        .eq('is_publicly_listed', true)
        .eq('contract_schema_version', INITIAL_INDIVIDUAL_OFFER.contractSchemaVersion)
        .eq('amount_cents', INITIAL_INDIVIDUAL_OFFER.amountCents)
        .eq('billing_interval_unit', INITIAL_INDIVIDUAL_OFFER.billingIntervalUnit)
        .eq('billing_interval_count', INITIAL_INDIVIDUAL_OFFER.billingIntervalCount)
        .eq('sessions_per_period', INITIAL_INDIVIDUAL_OFFER.sessionsPerPeriod)
        .eq('class_duration_minutes', INITIAL_INDIVIDUAL_OFFER.classDurationMinutes)
        .limit(2);
    if (packagesResult.error) {
        return { package: null, price: null, error: packagesResult.error, invalid: false };
    }
    if (packagesResult.data?.length !== 1) {
        return { package: null, price: null, error: null, invalid: true };
    }

    const packageRow = packagesResult.data[0];
    const pricesResult = await admin
        .from('package_prices')
        .select('id, package_id, amount_cents, currency, contract_schema_version, billing_interval_unit, billing_interval_count, sessions_per_period, class_duration_minutes')
        .eq('package_id', packageRow.id)
        .eq('status', 'active')
        .eq('contract_schema_version', INITIAL_INDIVIDUAL_OFFER.contractSchemaVersion)
        .eq('amount_cents', INITIAL_INDIVIDUAL_OFFER.amountCents)
        .eq('currency', INITIAL_INDIVIDUAL_OFFER.currency)
        .eq('billing_interval_unit', INITIAL_INDIVIDUAL_OFFER.billingIntervalUnit)
        .eq('billing_interval_count', INITIAL_INDIVIDUAL_OFFER.billingIntervalCount)
        .eq('sessions_per_period', INITIAL_INDIVIDUAL_OFFER.sessionsPerPeriod)
        .eq('class_duration_minutes', INITIAL_INDIVIDUAL_OFFER.classDurationMinutes)
        .limit(2);
    if (pricesResult.error) {
        return { package: null, price: null, error: pricesResult.error, invalid: false };
    }
    if (pricesResult.data?.length !== 1) {
        return { package: null, price: null, error: null, invalid: true };
    }

    return { package: packageRow, price: pricesResult.data[0], error: null, invalid: false };
}

function canonicalPackageUnavailable(): Response {
    return json({ error: 'La oferta can\u00f3nica no est\u00e1 disponible' }, 503);
}

export const GET: APIRoute = async (context) => {
    const auth = await requireAdmin(context);
    if (auth.error) return auth.error;

    const admin = createSupabaseAdminClient();
    const canonical = await loadCanonicalPackage(admin);
    if (canonical.error) return operationalLoadError('canonical-package', canonical.error);
    if (canonical.invalid || !canonical.package || !canonical.price) return canonicalPackageUnavailable();

    const [teachersResult, engagementsResult, availabilityResult, slotsResult] = await Promise.all([
        collectAllPages((from, to) => admin
            .from('profiles')
            .select('id, full_name, email')
            .eq('role', 'teacher')
            .order('full_name', { ascending: true })
            .order('id', { ascending: true })
            .range(from, to)),
        collectAllPages((from, to) => admin
            .from('teacher_compensation_engagements')
            .select('id, teacher_id, engagement_kind, effective_from')
            .order('teacher_id', { ascending: true })
            .order('effective_from', { ascending: false })
            .order('id', { ascending: false })
            .range(from, to)),
        collectAllPages((from, to) => admin
            .from('teacher_availability')
            .select('id, teacher_id, day_of_week, start_time, end_time')
            .eq('is_active', true)
            .order('teacher_id', { ascending: true })
            .order('day_of_week', { ascending: true })
            .order('start_time', { ascending: true })
            .order('id', { ascending: true })
            .range(from, to)),
        collectAllPages((from, to) => admin
            .from('bookable_slots')
            .select('id, public_id, teacher_id, status, weekday, local_start_time, timezone_name, first_occurrence_at, published_at, created_at')
            .eq('package_id', canonical.package.id)
            .order('first_occurrence_at', { ascending: true })
            .order('id', { ascending: true })
            .range(from, to)),
    ]);
    const failed = [teachersResult, engagementsResult, availabilityResult, slotsResult]
        .find((result) => result.error);
    if (failed?.error) return operationalLoadError('teachers-slots', failed.error);

    const slotIds = (slotsResult.data || []).map((slot) => slot.id);
    const occurrenceRows: Array<{
        slot_id: string;
        occurrence_index: number;
        starts_at: string;
        duration_minutes: number;
    }> = [];
    const holdRows: Array<{ slot_id: string }> = [];

    for (const slotIdBatch of batches(slotIds, SLOT_RELATION_BATCH_SIZE)) {
        const [occurrencesResult, holdsResult] = await Promise.all([
            admin
                .from('bookable_slot_occurrences')
                .select('slot_id, occurrence_index, starts_at, duration_minutes')
                .in('slot_id', slotIdBatch)
                .order('slot_id', { ascending: true })
                .order('occurrence_index', { ascending: true }),
            admin
                .from('bookable_slot_holds')
                .select('slot_id')
                .in('slot_id', slotIdBatch)
                .eq('status', 'held'),
        ]);
        if (occurrencesResult.error) return operationalLoadError('slot-occurrences', occurrencesResult.error);
        if (holdsResult.error) return operationalLoadError('slot-holds', holdsResult.error);
        occurrenceRows.push(...(occurrencesResult.data || []));
        holdRows.push(...(holdsResult.data || []));
    }

    type EngagementRow = NonNullable<typeof engagementsResult.data>[number];
    type AvailabilityRow = NonNullable<typeof availabilityResult.data>[number];
    type OccurrenceRow = typeof occurrenceRows[number];
    const currentEngagements = new Map<string, EngagementRow>();
    for (const engagement of engagementsResult.data || []) {
        if (!currentEngagements.has(engagement.teacher_id)) {
            currentEngagements.set(engagement.teacher_id, engagement);
        }
    }
    const availabilityByTeacher = new Map<string, AvailabilityRow[]>();
    for (const window of availabilityResult.data || []) {
        const windows = availabilityByTeacher.get(window.teacher_id) || [];
        windows.push(window);
        availabilityByTeacher.set(window.teacher_id, windows);
    }
    const occurrencesBySlot = new Map<string, OccurrenceRow[]>();
    for (const occurrence of occurrenceRows) {
        const occurrences = occurrencesBySlot.get(occurrence.slot_id) || [];
        occurrences.push(occurrence);
        occurrencesBySlot.set(occurrence.slot_id, occurrences);
    }
    const liveHoldSlotIds = new Set(holdRows.map((hold) => hold.slot_id));

    const slots = (slotsResult.data || []).map((slot) => ({
        id: slot.id,
        publicId: slot.public_id,
        teacherId: slot.teacher_id,
        status: slot.status,
        weekday: slot.weekday,
        localStartTime: slot.local_start_time,
        timezoneName: slot.timezone_name,
        firstOccurrenceAt: slot.first_occurrence_at,
        publishedAt: slot.published_at,
        createdAt: slot.created_at,
        hasLiveHold: liveHoldSlotIds.has(slot.id),
        occurrences: (occurrencesBySlot.get(slot.id) || []).map((occurrence) => ({
            index: occurrence.occurrence_index,
            startsAt: occurrence.starts_at,
            durationMinutes: occurrence.duration_minutes,
        })),
    }));
    if (slots.some((slot) => slot.occurrences.length !== 4)) {
        console.error('[AdminTeachersSlots] Slot occurrence invariant failed');
        return json({ error: 'Los horarios guardados no cumplen el contrato operativo' }, 500);
    }

    return json({
        package: {
            id: canonical.package.id,
            priceId: canonical.price.id,
            name: canonical.package.name,
            displayName: canonical.package.display_name,
            amountCents: canonical.package.amount_cents,
            currency: canonical.price.currency.toUpperCase(),
            billingIntervalUnit: canonical.package.billing_interval_unit,
            billingIntervalCount: canonical.package.billing_interval_count,
            sessionsPerPeriod: canonical.package.sessions_per_period,
            classDurationMinutes: canonical.package.class_duration_minutes,
        },
        teachers: (teachersResult.data || []).map((teacher) => {
            const engagement = currentEngagements.get(teacher.id);
            return {
                id: teacher.id,
                fullName: teacher.full_name,
                email: teacher.email,
                currentEngagement: engagement ? {
                    id: engagement.id,
                    engagementKind: engagement.engagement_kind,
                    effectiveFrom: engagement.effective_from,
                } : null,
                availability: (availabilityByTeacher.get(teacher.id) || []).map((window) => ({
                    id: window.id,
                    dayOfWeek: window.day_of_week,
                    startTime: window.start_time,
                    endTime: window.end_time,
                })),
            };
        }),
        slots,
    });
};

export const POST: APIRoute = async (context) => {
    if (!sameOriginRequest(context.request)) return json({ error: 'Forbidden' }, 403);

    const auth = await requireAdmin(context);
    if (auth.error || !auth.user) return auth.error;

    let body: unknown;
    try {
        body = await context.request.json();
    } catch {
        return json({ error: 'Invalid JSON body' }, 400);
    }
    const parsed = actionSchema.safeParse(body);
    if (!parsed.success) return json({ error: 'Invalid teacher or slot action' }, 400);

    const admin = createSupabaseAdminClient();
    const action = parsed.data;

    if (action.action === 'activate_teacher') {
        const profilesResult = await admin
            .from('profiles')
            .select('id, email')
            .ilike('email', escapeIlikePattern(action.email))
            .limit(2);
        if (profilesResult.error) return operationalLoadError('activation-profile', profilesResult.error);
        if (!profilesResult.data?.length) return json({ error: 'No se encontr\u00f3 el perfil solicitado' }, 404);
        if (profilesResult.data.length !== 1) {
            return json({ error: 'El email no identifica un perfil de forma inequ\u00edvoca' }, 409);
        }

        const profile = profilesResult.data[0];
        const authResult = await admin.auth.admin.getUserById(profile.id);
        const authEmail = authResult.data.user?.email?.trim().toLowerCase();
        if (authResult.error || !authResult.data.user) {
            console.error('[AdminTeachersSlots] Could not validate activation identity', {
                code: authResult.error?.code || 'missing-user',
            });
            return json({ error: 'No se pudo validar la identidad del perfil' }, 409);
        }
        if (
            profile.email.trim().toLowerCase() !== action.email
            || authEmail !== action.email
            || !authResult.data.user.email_confirmed_at
        ) {
            return json({ error: 'El perfil no tiene un email confirmado coincidente' }, 400);
        }

        const result = await admin.rpc('activate_teacher_profile', {
            p_request_id: action.requestId,
            p_profile_id: profile.id,
            p_engagement_kind: action.engagementKind,
            p_effective_from: action.effectiveFrom,
            p_admin_id: auth.user.id,
            p_reason: action.reason,
        });
        if (result.error) return databaseErrorResponse(result.error);
        return json({ result: result.data });
    }

    if (action.action === 'create_slot') {
        if (normalizeDateInputToDateKey(action.firstClassDate) !== action.firstClassDate) {
            return json({ error: 'La fecha de la primera clase no es v\u00e1lida' }, 400);
        }

        let dateKeys: string[];
        try {
            dateKeys = [0, 7, 14, 21].map((days) => addDaysToDateKey(action.firstClassDate, days));
        } catch (error) {
            if (error instanceof RangeError) {
                return json({ error: 'La fecha de la primera clase no es v\u00e1lida' }, 400);
            }
            throw error;
        }
        const occurrences = dateKeys.map((dateKey) => (
            madridDateTimeToUtcIso(dateKey, action.localStartTime)
        ));
        if (occurrences.some((occurrence) => occurrence === null)) {
            return json({ error: 'La hora local es inexistente o ambigua por el cambio horario' }, 400);
        }

        const canonical = await loadCanonicalPackage(admin);
        if (canonical.error) return operationalLoadError('canonical-package', canonical.error);
        if (canonical.invalid || !canonical.package) return canonicalPackageUnavailable();

        const result = await admin.rpc('admin_create_bookable_slot', {
            p_request_id: action.requestId,
            p_package_id: canonical.package.id,
            p_teacher_id: action.teacherId,
            p_timezone_name: MADRID_TIME_ZONE,
            p_occurrences: occurrences as string[],
            p_admin_id: auth.user.id,
            p_reason: action.reason,
        });
        if (result.error) return databaseErrorResponse(result.error);
        return json({ result: result.data });
    }

    if (action.action === 'configure_engagement') {
        const result = await admin.rpc('configure_teacher_compensation_engagement', {
            p_request_id: action.requestId,
            p_teacher_id: action.teacherId,
            p_engagement_kind: action.engagementKind,
            p_effective_from: action.effectiveFrom,
            p_configured_by: auth.user.id,
            p_reason: action.reason,
        });
        if (result.error) return databaseErrorResponse(result.error);
        return json({ result: result.data });
    }

    const result = await admin.rpc('admin_transition_bookable_slot', {
        p_request_id: action.requestId,
        p_slot_id: action.slotId,
        p_transition: action.transition,
        p_admin_id: auth.user.id,
        p_reason: action.reason,
    });
    if (result.error) return databaseErrorResponse(result.error);
    return json({ result: result.data });
};
