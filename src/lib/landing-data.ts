import type { APIContext } from 'astro';
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

const INERT_E2E_PACKAGES: readonly LandingPackage[] = [
    {
        id: '00000000-0000-4000-8000-000000000001',
        name: 'group',
        display_name: { es: 'Grupal Externo', en: 'External Group', ru: 'Групповые занятия' },
        price_monthly: 5000,
        sessions_per_month: 4,
        has_group_session: true,
        has_dual_teacher: false,
        stripe_price_1m: null,
        stripe_price_3m: null,
        stripe_price_6m: null,
    },
    {
        id: '00000000-0000-4000-8000-000000000002',
        name: 'standard',
        display_name: { es: 'Mensual Estándar', en: 'Standard Monthly', ru: 'Стандартный месяц' },
        price_monthly: 14500,
        sessions_per_month: 4,
        has_group_session: false,
        has_dual_teacher: false,
        stripe_price_1m: null,
        stripe_price_3m: null,
        stripe_price_6m: null,
    },
    {
        id: '00000000-0000-4000-8000-000000000003',
        name: 'hybrid',
        display_name: { es: 'Híbrido Mensual', en: 'Hybrid Monthly', ru: 'Гибридный месяц' },
        price_monthly: 15000,
        sessions_per_month: 4,
        has_group_session: true,
        has_dual_teacher: true,
        stripe_price_1m: null,
        stripe_price_3m: null,
        stripe_price_6m: null,
    },
    {
        id: '00000000-0000-4000-8000-000000000004',
        name: 'bootcamp',
        display_name: { es: 'Intensivo Bootcamp', en: 'Bootcamp Intensive', ru: 'Интенсив Bootcamp' },
        price_monthly: 34500,
        sessions_per_month: 20,
        has_group_session: false,
        has_dual_teacher: false,
        stripe_price_1m: null,
        stripe_price_3m: null,
        stripe_price_6m: null,
    },
];

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
        .select('id, name, display_name, price_monthly, sessions_per_month, has_group_session, has_dual_teacher, stripe_price_1m, stripe_price_3m, stripe_price_6m')
        .eq('is_active', true)
        .order('price_monthly', { ascending: true });

    if (packagesError) {
        console.error('Packages fetch error:', packagesError);
    }

    const { data: { user } } = await supabase.auth.getUser();

    return {
        packages: (packages || []).map((pkg) => ({
            ...pkg,
            display_name: normalizeDisplayName(pkg.display_name, pkg.name),
        })),
        isLoggedIn: !!user,
    };
}
