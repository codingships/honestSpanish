import type { APIContext } from 'astro';
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
