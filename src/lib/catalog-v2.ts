import {
    INITIAL_INDIVIDUAL_OFFER,
    isInitialIndividualOfferSnapshot,
} from './package-pricing';

export const CATALOG_V2_CURRENCY = 'eur' as const;
export const CATALOG_V2_INTERVAL_UNITS = ['day', 'week', 'month', 'year'] as const;

export type CatalogV2IntervalUnit = typeof CATALOG_V2_INTERVAL_UNITS[number];
export type CatalogV2LocalizedText = { es: string; en: string; ru: string };

export type CatalogV2Terms = {
    packageKey: string;
    amountCents: number;
    currency: string;
    billingIntervalUnit: CatalogV2IntervalUnit;
    billingIntervalCount: number;
    sessionsPerPeriod: number;
    classDurationMinutes: number;
    hasGroupSession: boolean;
    hasDualTeacher: boolean;
};

export type GuaranteeStep = {
    consumedSessions: number;
    consumedAmountCents: number;
    refundableAmountCents: number;
};

/**
 * Assign every cent of a package to one session. Remainder cents are assigned
 * deterministically to the earliest sessions, so every partial refund can be
 * reproduced from the immutable commercial snapshot without floating point.
 */
export function allocateSessionAmounts(amountCents: number, sessionsPerPeriod: number): number[] {
    if (!Number.isSafeInteger(amountCents) || amountCents < 1) {
        throw new Error('Package amount must be a positive integer of cents');
    }
    if (
        !Number.isSafeInteger(sessionsPerPeriod)
        || sessionsPerPeriod < 1
        || sessionsPerPeriod > 200
        || amountCents < sessionsPerPeriod
    ) {
        throw new Error('Package sessions cannot be allocated exactly');
    }

    const base = Math.floor(amountCents / sessionsPerPeriod);
    const remainder = amountCents % sessionsPerPeriod;
    return Array.from(
        { length: sessionsPerPeriod },
        (_, index) => base + (index < remainder ? 1 : 0),
    );
}

export function buildGuaranteeSchedule(
    amountCents: number,
    sessionsPerPeriod: number,
): GuaranteeStep[] {
    const sessionAmounts = allocateSessionAmounts(amountCents, sessionsPerPeriod);
    let consumedAmountCents = 0;

    return sessionAmounts.map((sessionAmount, index) => {
        consumedAmountCents += sessionAmount;
        return {
            consumedSessions: index + 1,
            consumedAmountCents,
            refundableAmountCents: amountCents - consumedAmountCents,
        };
    });
}

export function isCurrentCheckoutRuntimeCompatible(terms: CatalogV2Terms): boolean {
    return !terms.hasGroupSession
        && !terms.hasDualTeacher
        && terms.currency === INITIAL_INDIVIDUAL_OFFER.currency
        && isInitialIndividualOfferSnapshot({
            contract_schema_version: INITIAL_INDIVIDUAL_OFFER.contractSchemaVersion,
            package_key: terms.packageKey,
            amount_cents: terms.amountCents,
            currency: terms.currency,
            billing_interval_unit: terms.billingIntervalUnit,
            billing_interval_count: terms.billingIntervalCount,
            sessions_per_period: terms.sessionsPerPeriod,
            class_duration_minutes: terms.classDurationMinutes,
        });
}

export function parseCatalogV2DisplayName(value: unknown): CatalogV2LocalizedText {
    if (typeof value === 'string') {
        try {
            return parseCatalogV2DisplayName(JSON.parse(value));
        } catch {
            return { es: value, en: value, ru: value };
        }
    }
    if (value && typeof value === 'object' && !Array.isArray(value)) {
        const localized = value as Partial<Record<keyof CatalogV2LocalizedText, unknown>>;
        const es = typeof localized.es === 'string' ? localized.es : '';
        return {
            es,
            en: typeof localized.en === 'string' ? localized.en : es,
            ru: typeof localized.ru === 'string' ? localized.ru : es,
        };
    }
    return { es: '', en: '', ru: '' };
}
