import { INITIAL_INDIVIDUAL_OFFER } from './package-pricing';
import { createSupabaseAdminClient } from './supabase-admin';
import type { Database } from '../types/database.types';

type SlotRow = Pick<
    Database['public']['Tables']['bookable_slots']['Row'],
    'id' | 'public_id' | 'package_id' | 'teacher_id' | 'status' | 'contract_schema_version'
    | 'first_occurrence_at' | 'timezone_name' | 'weekday' | 'local_start_time' | 'published_at'
    | 'sold_subscription_id'
>;
type OccurrenceRow = Pick<
    Database['public']['Tables']['bookable_slot_occurrences']['Row'],
    'slot_id' | 'occurrence_index' | 'starts_at' | 'duration_minutes'
>;
type HoldRow = Pick<
    Database['public']['Tables']['bookable_slot_holds']['Row'],
    'slot_id' | 'status' | 'expires_at'
>;
type PackageRow = Pick<
    Database['public']['Tables']['packages']['Row'],
    'id' | 'name' | 'is_active' | 'is_publicly_listed' | 'contract_schema_version'
    | 'amount_cents' | 'billing_interval_unit' | 'billing_interval_count' | 'sessions_per_period'
    | 'class_duration_minutes'
>;
type TeacherRow = Pick<Database['public']['Tables']['profiles']['Row'], 'id' | 'full_name' | 'role'>;
type PackagePriceRow = Pick<
    Database['public']['Tables']['package_prices']['Row'],
    'id' | 'package_id' | 'status' | 'contract_schema_version' | 'amount_cents' | 'currency'
    | 'billing_interval_unit' | 'billing_interval_count' | 'sessions_per_period'
    | 'class_duration_minutes' | 'stripe_account_id' | 'stripe_livemode' | 'stripe_price_id'
>;
type PriceSnapshotRow = Pick<
    Database['public']['Tables']['checkout_v2_price_snapshots']['Row'],
    'package_price_id' | 'initial_amount_cents' | 'recurring_amount_cents' | 'currency'
    | 'recurring_interval_unit' | 'recurring_interval_count' | 'recurring_stripe_price_id'
    | 'stripe_account_id' | 'stripe_livemode'
>;

export type PublicBookableSlot = {
    publicId: string;
    teacherName: string;
    weekday: number;
    localStartTime: string;
    timezoneName: string;
    firstClassAt: string;
    renewalAt: string;
    occurrences: Array<{ index: number; startsAt: string; durationMinutes: number }>;
};

const renewalPeriodMs = 28 * 24 * 60 * 60 * 1000;

export function sanitizePublicBookableSlots(input: {
    slots: SlotRow[];
    occurrences: OccurrenceRow[];
    holds: HoldRow[];
    packages: PackageRow[];
    packagePrices: PackagePriceRow[];
    priceSnapshots: PriceSnapshotRow[];
    teachers: TeacherRow[];
    now: Date;
}): PublicBookableSlot[] {
    const nowMs = input.now.getTime();
    const heldSlotIds = new Set(input.holds
        .filter((hold) => hold.status === 'held' && Date.parse(hold.expires_at) > nowMs)
        .map((hold) => hold.slot_id));
    const packages = new Map(input.packages.map((pkg) => [pkg.id, pkg]));
    const snapshots = new Map(input.priceSnapshots.map((snapshot) => [snapshot.package_price_id, snapshot]));
    const sellablePackageIds = new Set(input.packagePrices.flatMap((price) => {
        const snapshot = snapshots.get(price.id);
        const isComplete = price.status === 'active'
            && price.contract_schema_version === 2
            && price.amount_cents === INITIAL_INDIVIDUAL_OFFER.amountCents
            && price.currency === 'eur'
            && price.billing_interval_unit === INITIAL_INDIVIDUAL_OFFER.billingIntervalUnit
            && price.billing_interval_count === INITIAL_INDIVIDUAL_OFFER.billingIntervalCount
            && price.sessions_per_period === INITIAL_INDIVIDUAL_OFFER.sessionsPerPeriod
            && price.class_duration_minutes === INITIAL_INDIVIDUAL_OFFER.classDurationMinutes
            && Boolean(price.stripe_account_id)
            && snapshot?.initial_amount_cents === INITIAL_INDIVIDUAL_OFFER.amountCents
            && snapshot.recurring_amount_cents === INITIAL_INDIVIDUAL_OFFER.amountCents
            && snapshot.currency === 'eur'
            && snapshot.recurring_interval_unit === INITIAL_INDIVIDUAL_OFFER.billingIntervalUnit
            && snapshot.recurring_interval_count === INITIAL_INDIVIDUAL_OFFER.billingIntervalCount
            && snapshot.recurring_stripe_price_id === price.stripe_price_id
            && snapshot.stripe_account_id === price.stripe_account_id
            && snapshot.stripe_livemode === price.stripe_livemode;
        return isComplete ? [price.package_id] : [];
    }));
    const teachers = new Map(input.teachers.map((teacher) => [teacher.id, teacher]));
    const occurrencesBySlot = new Map<string, OccurrenceRow[]>();
    for (const occurrence of input.occurrences) {
        const current = occurrencesBySlot.get(occurrence.slot_id) ?? [];
        current.push(occurrence);
        occurrencesBySlot.set(occurrence.slot_id, current);
    }

    return input.slots.flatMap((slot) => {
        const pkg = packages.get(slot.package_id);
        const teacher = teachers.get(slot.teacher_id);
        const occurrences = (occurrencesBySlot.get(slot.id) ?? [])
            .slice()
            .sort((a, b) => a.occurrence_index - b.occurrence_index);
        const exactOccurrenceIndexes = occurrences.length === 4
            && occurrences.every((occurrence, index) => (
                occurrence.occurrence_index === index + 1
                && occurrence.duration_minutes === INITIAL_INDIVIDUAL_OFFER.classDurationMinutes
                && Date.parse(occurrence.starts_at) % 1000 === 0
                && Date.parse(occurrence.starts_at) > nowMs
            ));
        const exactPackage = pkg
            && pkg.name === INITIAL_INDIVIDUAL_OFFER.packageKey
            && pkg.is_active === true
            && pkg.is_publicly_listed === true
            && pkg.contract_schema_version === 2
            && pkg.amount_cents === INITIAL_INDIVIDUAL_OFFER.amountCents
            && pkg.billing_interval_unit === INITIAL_INDIVIDUAL_OFFER.billingIntervalUnit
            && pkg.billing_interval_count === INITIAL_INDIVIDUAL_OFFER.billingIntervalCount
            && pkg.sessions_per_period === INITIAL_INDIVIDUAL_OFFER.sessionsPerPeriod
            && pkg.class_duration_minutes === INITIAL_INDIVIDUAL_OFFER.classDurationMinutes;

        if (
            slot.status !== 'available'
            || slot.contract_schema_version !== 2
            || (slot.weekday === 0 && slot.local_start_time >= '02:00:00' && slot.local_start_time < '03:00:00')
            || !slot.published_at
            || slot.sold_subscription_id
            || heldSlotIds.has(slot.id)
            || !exactPackage
            || !sellablePackageIds.has(slot.package_id)
            || !teacher
            || teacher.role !== 'teacher'
            || !teacher.full_name?.trim()
            || !exactOccurrenceIndexes
            || occurrences[0]?.starts_at !== slot.first_occurrence_at
        ) return [];

        return [{
            publicId: slot.public_id,
            teacherName: teacher.full_name.trim(),
            weekday: slot.weekday,
            localStartTime: slot.local_start_time,
            timezoneName: slot.timezone_name,
            firstClassAt: slot.first_occurrence_at,
            renewalAt: new Date(Date.parse(slot.first_occurrence_at) + renewalPeriodMs).toISOString(),
            occurrences: occurrences.map((occurrence) => ({
                index: occurrence.occurrence_index,
                startsAt: occurrence.starts_at,
                durationMinutes: occurrence.duration_minutes,
            })),
        }];
    }).sort((a, b) => Date.parse(a.firstClassAt) - Date.parse(b.firstClassAt));
}

export async function listPublicBookableSlots(): Promise<PublicBookableSlot[]> {
    const supabaseAdmin = createSupabaseAdminClient();
    const now = new Date();
    const { data: slots, error: slotsError } = await supabaseAdmin
        .from('bookable_slots')
        .select('id, public_id, package_id, teacher_id, status, contract_schema_version, first_occurrence_at, timezone_name, weekday, local_start_time, published_at, sold_subscription_id')
        .eq('status', 'available')
        .eq('contract_schema_version', 2)
        .not('published_at', 'is', null)
        .is('sold_subscription_id', null)
        .gt('first_occurrence_at', now.toISOString())
        .order('first_occurrence_at', { ascending: true })
        .limit(50);
    if (slotsError) throw slotsError;
    if (!slots?.length) return [];

    const slotIds = slots.map((slot) => slot.id);
    const packageIds = [...new Set(slots.map((slot) => slot.package_id))];
    const teacherIds = [...new Set(slots.map((slot) => slot.teacher_id))];
    const [occurrencesResult, holdsResult, packagesResult, packagePricesResult, teachersResult] = await Promise.all([
        supabaseAdmin
            .from('bookable_slot_occurrences')
            .select('slot_id, occurrence_index, starts_at, duration_minutes')
            .in('slot_id', slotIds)
            .order('occurrence_index', { ascending: true }),
        supabaseAdmin
            .from('bookable_slot_holds')
            .select('slot_id, status, expires_at')
            .in('slot_id', slotIds)
            .eq('status', 'held')
            .gt('expires_at', now.toISOString()),
        supabaseAdmin
            .from('packages')
            .select('id, name, is_active, is_publicly_listed, contract_schema_version, amount_cents, billing_interval_unit, billing_interval_count, sessions_per_period, class_duration_minutes')
            .in('id', packageIds),
        supabaseAdmin
            .from('package_prices')
            .select('id, package_id, status, contract_schema_version, amount_cents, currency, billing_interval_unit, billing_interval_count, sessions_per_period, class_duration_minutes, stripe_account_id, stripe_livemode, stripe_price_id')
            .in('package_id', packageIds)
            .eq('status', 'active')
            .eq('contract_schema_version', 2),
        supabaseAdmin
            .from('profiles')
            .select('id, full_name, role')
            .in('id', teacherIds)
            .eq('role', 'teacher'),
    ]);
    const error = occurrencesResult.error || holdsResult.error || packagesResult.error
        || packagePricesResult.error || teachersResult.error;
    if (error) throw error;

    const packagePriceIds = (packagePricesResult.data ?? []).map((price) => price.id);
    const priceSnapshotsResult = packagePriceIds.length
        ? await supabaseAdmin
            .from('checkout_v2_price_snapshots')
            .select('package_price_id, initial_amount_cents, recurring_amount_cents, currency, recurring_interval_unit, recurring_interval_count, recurring_stripe_price_id, stripe_account_id, stripe_livemode')
            .in('package_price_id', packagePriceIds)
        : { data: [], error: null };
    if (priceSnapshotsResult.error) throw priceSnapshotsResult.error;

    return sanitizePublicBookableSlots({
        slots,
        occurrences: occurrencesResult.data ?? [],
        holds: holdsResult.data ?? [],
        packages: packagesResult.data ?? [],
        packagePrices: packagePricesResult.data ?? [],
        priceSnapshots: priceSnapshotsResult.data ?? [],
        teachers: teachersResult.data ?? [],
        now,
    });
}
