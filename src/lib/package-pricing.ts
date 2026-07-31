export const PACKAGE_CURRENCY = 'eur' as const;
export const PACKAGE_CURRENCY_CODE = 'EUR' as const;

export const VERSIONED_CONTRACT_SCHEMA_VERSION = 2 as const;
export const INITIAL_INDIVIDUAL_OFFER = Object.freeze({
    contractSchemaVersion: VERSIONED_CONTRACT_SCHEMA_VERSION,
    packageKey: 'individual_4x50_28d',
    amountCents: 25900,
    currency: PACKAGE_CURRENCY,
    billingIntervalUnit: 'day',
    billingIntervalCount: 28,
    sessionsPerPeriod: 4,
    classDurationMinutes: 50,
} as const);

export type BillingIntervalUnit = 'day' | 'week' | 'month' | 'year';

export interface VersionedPackageContractSnapshot {
    contract_schema_version: number;
    package_key: string;
    amount_cents: number;
    currency: string;
    billing_interval_unit: BillingIntervalUnit | null;
    billing_interval_count: number | null;
    sessions_per_period: number;
    class_duration_minutes: number | null;
}

export const PACKAGE_DURATIONS = [1, 3, 6] as const;
export type PackageDuration = typeof PACKAGE_DURATIONS[number];

export interface PackagePriceSnapshot {
    catalog_version: number;
    package_key: string;
    duration_months: number | null;
    amount_cents: number;
    currency: string;
    sessions_per_month: number | null;
    sessions_per_period: number;
    has_group_session: boolean;
    has_dual_teacher: boolean;
    status: string;
    stripe_account_id: string | null;
    stripe_livemode: boolean;
    stripe_product_id: string;
    stripe_price_id: string;
    contract_schema_version?: number;
    billing_interval_unit?: string | null;
    billing_interval_count?: number | null;
    class_duration_minutes?: number | null;
}

export interface PackageCatalogSnapshot {
    name: string;
    catalog_version: number;
    price_monthly: number;
    sessions_per_month: number;
    has_group_session: boolean | null;
    has_dual_teacher: boolean | null;
    is_active: boolean | null;
    stripe_product_id: string | null;
    stripe_price_1m: string | null;
    stripe_price_3m: string | null;
    stripe_price_6m: string | null;
    package_prices: readonly PackagePriceSnapshot[] | null;
    contract_schema_version?: number;
    amount_cents?: number | null;
    billing_interval_unit?: string | null;
    billing_interval_count?: number | null;
    sessions_per_period?: number | null;
    class_duration_minutes?: number | null;
}

export function isVersionedPackageContractSnapshot(
    value: VersionedPackageContractSnapshot
): boolean {
    return value.contract_schema_version === VERSIONED_CONTRACT_SCHEMA_VERSION
        && value.package_key.trim().length > 0
        && Number.isInteger(value.amount_cents)
        && value.amount_cents > 0
        && value.currency === PACKAGE_CURRENCY
        && ['day', 'week', 'month', 'year'].includes(value.billing_interval_unit ?? '')
        && Number.isInteger(value.billing_interval_count)
        && (value.billing_interval_count ?? 0) > 0
        && Number.isInteger(value.sessions_per_period)
        && value.sessions_per_period > 0
        && Number.isInteger(value.class_duration_minutes)
        && (value.class_duration_minutes ?? 0) > 0;
}

export function isInitialIndividualOfferSnapshot(
    value: VersionedPackageContractSnapshot
): boolean {
    return isVersionedPackageContractSnapshot(value)
        && value.package_key === INITIAL_INDIVIDUAL_OFFER.packageKey
        && value.amount_cents === INITIAL_INDIVIDUAL_OFFER.amountCents
        && value.billing_interval_unit === INITIAL_INDIVIDUAL_OFFER.billingIntervalUnit
        && value.billing_interval_count === INITIAL_INDIVIDUAL_OFFER.billingIntervalCount
        && value.sessions_per_period === INITIAL_INDIVIDUAL_OFFER.sessionsPerPeriod
        && value.class_duration_minutes === INITIAL_INDIVIDUAL_OFFER.classDurationMinutes;
}

// Percentage of one monthly price charged for the complete period.
// 1 month: 1 x 100%; 3 months: 3 x 90%; 6 months: 6 x 80%.
const PERIOD_PRICE_PERCENTAGES: Record<PackageDuration, number> = {
    1: 100,
    3: 270,
    6: 480,
};

export function isPackageDuration(value: unknown): value is PackageDuration {
    return typeof value === 'number'
        && PACKAGE_DURATIONS.includes(value as PackageDuration);
}

export function packagePriceField(duration: PackageDuration) {
    return `stripe_price_${duration}m` as const;
}

export function calculatePackageTotalCents(
    monthlyPriceCents: number,
    duration: PackageDuration
): number {
    if (!Number.isInteger(monthlyPriceCents) || monthlyPriceCents < 0) {
        throw new Error('Monthly package price must be a non-negative integer in cents');
    }

    return Math.round((monthlyPriceCents * PERIOD_PRICE_PERCENTAGES[duration]) / 100);
}

export function calculatePackageMonthlyEquivalentCents(
    monthlyPriceCents: number,
    duration: PackageDuration
): number {
    return Math.round(calculatePackageTotalCents(monthlyPriceCents, duration) / duration);
}

export function calculatePackageSavingsCents(
    monthlyPriceCents: number,
    duration: PackageDuration
): number {
    return (monthlyPriceCents * duration) - calculatePackageTotalCents(monthlyPriceCents, duration);
}

export function calculateSessionsPerPeriod(
    sessionsPerMonth: number,
    duration: PackageDuration
): number {
    if (!Number.isInteger(sessionsPerMonth) || sessionsPerMonth < 0) {
        throw new Error('Sessions per month must be a non-negative integer');
    }

    return sessionsPerMonth * duration;
}

/**
 * Returns the exact immutable offers that make a package safe for checkout.
 * Every surface (Admin, CRM and Campus) must use this same contractual rule.
 */
export function getCheckoutReadyPackageOffers(
    pkg: PackageCatalogSnapshot
): Map<PackageDuration, PackagePriceSnapshot> | null {
    if (!pkg.is_active || !pkg.stripe_product_id) return null;

    const expectedPriceIds = new Map<PackageDuration, string | null>([
        [1, pkg.stripe_price_1m],
        [3, pkg.stripe_price_3m],
        [6, pkg.stripe_price_6m],
    ]);
    if ([...expectedPriceIds.values()].some((priceId) => !priceId)) return null;

    const activeVersionOffers = (pkg.package_prices ?? []).filter((offer) => (
        offer.status === 'active'
        && offer.catalog_version === pkg.catalog_version
    ));
    if (activeVersionOffers.length !== PACKAGE_DURATIONS.length) return null;

    const offers = new Map<PackageDuration, PackagePriceSnapshot>();
    for (const duration of PACKAGE_DURATIONS) {
        const matchingOffers = activeVersionOffers.filter((offer) => (
            offer.duration_months === duration
            && offer.package_key === pkg.name
            && offer.amount_cents === calculatePackageTotalCents(pkg.price_monthly, duration)
            && offer.currency === PACKAGE_CURRENCY
            && offer.sessions_per_month === pkg.sessions_per_month
            && offer.sessions_per_period === calculateSessionsPerPeriod(pkg.sessions_per_month, duration)
            && offer.has_group_session === Boolean(pkg.has_group_session)
            && offer.has_dual_teacher === Boolean(pkg.has_dual_teacher)
            && offer.stripe_product_id === pkg.stripe_product_id
            && offer.stripe_price_id === expectedPriceIds.get(duration)
            && Boolean(offer.stripe_account_id)
            && typeof offer.stripe_livemode === 'boolean'
        ));
        if (matchingOffers.length !== 1) return null;
        offers.set(duration, matchingOffers[0]);
    }

    const accountIds = new Set([...offers.values()].map((offer) => offer.stripe_account_id));
    const modes = new Set([...offers.values()].map((offer) => offer.stripe_livemode));
    return accountIds.size === 1 && modes.size === 1 ? offers : null;
}

export function isPackageCheckoutReady(pkg: PackageCatalogSnapshot): boolean {
    return getCheckoutReadyPackageOffers(pkg) !== null;
}

/**
 * Group-dependent offers cannot enter checkout until the campus has a real
 * group roster/quota model; hybrid also needs a guaranteed two-teacher
 * onboarding path before its contractual promise is sellable.
 */
export function isPackageKeyCheckoutEligible(packageKey: string): boolean {
    return packageKey !== 'group' && packageKey !== 'hybrid';
}

export function isPackageCheckoutEligible(pkg: PackageCatalogSnapshot): boolean {
    return isPackageKeyCheckoutEligible(pkg.name) && isPackageCheckoutReady(pkg);
}

export function formatPackagePrice(
    amountCents: number,
    lang: 'es' | 'en' | 'ru' = 'es'
): string {
    const locale = lang === 'en' ? 'en-GB' : lang === 'ru' ? 'ru-RU' : 'es-ES';
    const hasFraction = amountCents % 100 !== 0;

    return new Intl.NumberFormat(locale, {
        style: 'currency',
        currency: PACKAGE_CURRENCY_CODE,
        minimumFractionDigits: hasFraction ? 2 : 0,
        maximumFractionDigits: 2,
    }).format(amountCents / 100);
}
