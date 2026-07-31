import type { APIContext } from 'astro';
import { INITIAL_INDIVIDUAL_OFFER } from './package-pricing';
import { readRuntimeEnv } from './runtime-env';
import { createSupabaseServerClient } from './supabase-server';

export interface LandingPackage {
    id: string;
    name: string;
    display_name: { es: string; en: string; ru: string };
    price_monthly: number;
    sessions_per_month: number;
    has_group_session: boolean | null;
    has_dual_teacher: boolean | null;
    stripe_price_1m: string | null;
    stripe_price_3m: string | null;
    stripe_price_6m: string | null;
}

export const PUBLIC_OFFER_KEY = INITIAL_INDIVIDUAL_OFFER.packageKey;

// Transitional public projection for R1. Billing remains disabled until the
// catalog and capacity reservation slices implement this exact contract.
const PUBLIC_TARGET_PACKAGE: LandingPackage = {
    id: '00000000-0000-4000-8000-000000000028',
    name: PUBLIC_OFFER_KEY,
    display_name: {
        es: '4 clases individuales',
        en: '4 individual classes',
        ru: '4 индивидуальных занятия',
    },
    price_monthly: INITIAL_INDIVIDUAL_OFFER.amountCents,
    sessions_per_month: INITIAL_INDIVIDUAL_OFFER.sessionsPerPeriod,
    has_group_session: false,
    has_dual_teacher: false,
    stripe_price_1m: null,
    stripe_price_3m: null,
    stripe_price_6m: null,
};

const INERT_E2E_PACKAGES: readonly LandingPackage[] = [PUBLIC_TARGET_PACKAGE];

function isInertPublicE2e(context: APIContext): boolean {
    return readRuntimeEnv('PUBLIC_APP_ENV', context) === 'test'
        && readRuntimeEnv('E2E_RUNTIME_ISOLATED', context) === 'true'
        && readRuntimeEnv('E2E_DISABLE_EXTERNAL_INTEGRATIONS', context) === 'true'
        && readRuntimeEnv('E2E_TARGET_SUPABASE_REF', context) === 'placeholder';
}

export function normalizeDisplayName(value: unknown, fallback: string): LandingPackage['display_name'] {
    if (value && typeof value === 'object') {
        const record = value as Partial<Record<'es' | 'en' | 'ru', unknown>>;
        return {
            es: typeof record.es === 'string' ? record.es : fallback,
            en: typeof record.en === 'string' ? record.en : fallback,
            ru: typeof record.ru === 'string' ? record.ru : fallback,
        };
    }

    return { es: fallback, en: fallback, ru: fallback };
}

function isExactClosedPublicOffer(row: {
    name: string;
    price_monthly: number;
    sessions_per_month: number;
    has_group_session: boolean | null;
    has_dual_teacher: boolean | null;
    stripe_price_1m: string | null;
    stripe_price_3m: string | null;
    stripe_price_6m: string | null;
    is_active: boolean | null;
    is_publicly_listed: boolean;
    contract_schema_version: number;
    amount_cents: number | null;
    billing_interval_unit: string | null;
    billing_interval_count: number | null;
    sessions_per_period: number | null;
    class_duration_minutes: number | null;
}): boolean {
    return row.name === INITIAL_INDIVIDUAL_OFFER.packageKey
        && row.price_monthly === INITIAL_INDIVIDUAL_OFFER.amountCents
        && row.sessions_per_month === INITIAL_INDIVIDUAL_OFFER.sessionsPerPeriod
        && row.has_group_session === false
        && row.has_dual_teacher === false
        && row.stripe_price_1m === null
        && row.stripe_price_3m === null
        && row.stripe_price_6m === null
        && row.is_active === false
        && row.is_publicly_listed === true
        && row.contract_schema_version === INITIAL_INDIVIDUAL_OFFER.contractSchemaVersion
        && row.amount_cents === INITIAL_INDIVIDUAL_OFFER.amountCents
        && row.billing_interval_unit === INITIAL_INDIVIDUAL_OFFER.billingIntervalUnit
        && row.billing_interval_count === INITIAL_INDIVIDUAL_OFFER.billingIntervalCount
        && row.sessions_per_period === INITIAL_INDIVIDUAL_OFFER.sessionsPerPeriod
        && row.class_duration_minutes === INITIAL_INDIVIDUAL_OFFER.classDurationMinutes;
}

export async function getLandingPageData(context: APIContext): Promise<{
    packages: LandingPackage[];
    isLoggedIn: boolean;
}> {
    // Public CI runs against a non-existent Supabase ref by design. This exact
    // four-part gate keeps that test runtime deterministic without introducing
    // another catalogue source for staging or production.
    if (isInertPublicE2e(context)) {
        return {
            packages: INERT_E2E_PACKAGES.map((pkg) => ({
                ...pkg,
                display_name: { ...pkg.display_name },
            })),
            isLoggedIn: false,
        };
    }

    const supabase = createSupabaseServerClient(context);

    const { data: packages, error: packagesError } = await supabase
        .from('packages')
        .select('id, name, display_name, price_monthly, sessions_per_month, has_group_session, has_dual_teacher, stripe_price_1m, stripe_price_3m, stripe_price_6m, is_active, is_publicly_listed, contract_schema_version, amount_cents, billing_interval_unit, billing_interval_count, sessions_per_period, class_duration_minutes')
        .eq('name', PUBLIC_OFFER_KEY)
        .eq('is_publicly_listed', true);

    if (packagesError) {
        console.error('Packages fetch error:', packagesError);
    }

    const { data: { user } } = await supabase.auth.getUser();

    return {
        // Never blend an error or a merely name-matching legacy row into the
        // public offer. The executable contract owns price and session terms;
        // the closed catalogue row only proves that the v2 snapshot exists.
        packages: !packagesError && packages?.length === 1 && isExactClosedPublicOffer(packages[0])
            ? [{
                ...PUBLIC_TARGET_PACKAGE,
                id: packages[0].id,
                display_name: normalizeDisplayName(packages[0].display_name, PUBLIC_OFFER_KEY),
            }]
            : [],
        isLoggedIn: !!user,
    };
}
