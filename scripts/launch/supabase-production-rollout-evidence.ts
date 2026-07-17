import { z } from 'zod';

const aggregateCountSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const aggregateDurationSchema = z.number().int().positive().max(120);

const sparseProfileRoleCountsSchema = z.strictObject({
    student: aggregateCountSchema.optional(),
    teacher: aggregateCountSchema.optional(),
    admin: aggregateCountSchema.optional(),
});

const sparseSubscriptionStatusCountsSchema = z.strictObject({
    active: aggregateCountSchema.optional(),
    paused: aggregateCountSchema.optional(),
    cancelled: aggregateCountSchema.optional(),
    expired: aggregateCountSchema.optional(),
    pending: aggregateCountSchema.optional(),
});

const sparseSessionStatusCountsSchema = z.strictObject({
    scheduled: aggregateCountSchema.optional(),
    completed: aggregateCountSchema.optional(),
    cancelled: aggregateCountSchema.optional(),
    no_show: aggregateCountSchema.optional(),
});

const sparsePaymentStatusCountsSchema = z.strictObject({
    succeeded: aggregateCountSchema.optional(),
    pending: aggregateCountSchema.optional(),
    failed: aggregateCountSchema.optional(),
    refunded: aggregateCountSchema.optional(),
});

export const fixtureDistributionsAggregateSchema = z.strictObject({
    profiles_by_role: sparseProfileRoleCountsSchema,
    subscriptions_by_status: sparseSubscriptionStatusCountsSchema,
    sessions_by_status: sparseSessionStatusCountsSchema,
    payments_by_status: sparsePaymentStatusCountsSchema,
});

export const billingLegacyHazardAggregateSchema = z.strictObject({
    total_subscriptions: aggregateCountSchema,
    stripe_linked: aggregateCountSchema,
    active_stripe_linked: aggregateCountSchema,
    cancelled_stripe_linked: aggregateCountSchema,
    package_price_id_column_present: z.boolean(),
    stripe_linked_breakdown: z.array(z.strictObject({
        status: z.enum(['active', 'paused', 'cancelled', 'expired', 'pending']),
        package_key: z.string()
            .min(1)
            .max(80)
            .regex(/^[a-z0-9][a-z0-9_-]*$/u),
        duration_months: aggregateDurationSchema,
        fixture_count: aggregateCountSchema,
    })).max(100),
});

export const billingPackagePriceLinksAggregateSchema = z.strictObject({
    column_present: z.boolean(),
    stripe_linked_without_package_price: aggregateCountSchema,
    all_subscriptions_without_package_price: aggregateCountSchema,
});

const billingPackagePriceLinksContextSchema = z.strictObject({
    total_subscriptions: aggregateCountSchema,
    stripe_linked: aggregateCountSchema,
});

export const baselineHistoryEffectsAggregateSchema = z.strictObject({
    packages_updated_at_column_present: z.boolean(),
    fulfillment_jobs_table_present: z.boolean(),
    admin_audit_log_table_present: z.boolean(),
    support_tickets_table_present: z.boolean(),
    support_tickets_rls_enabled: z.boolean(),
    private_is_admin_present: z.boolean(),
    public_is_admin_present: z.boolean(),
    public_is_admin_public_execute_absent: z.boolean(),
    public_is_admin_anon_execute_absent: z.boolean(),
    public_is_admin_authenticated_execute_absent: z.boolean(),
    public_is_admin_service_role_execute_present: z.boolean(),
    pg_graphql_absent: z.boolean(),
});

export const processedAtPostureAggregateSchema = z.strictObject({
    column_default: z.enum(['now()', '<NULL>']),
    total: aggregateCountSchema,
    invalid_status: aggregateCountSchema,
    null_status: aggregateCountSchema,
    processing_with_processed_at: aggregateCountSchema,
});

export type ProcessedAtPostureAggregate = z.infer<typeof processedAtPostureAggregateSchema>;
export type BillingPackagePriceLinksAggregate = z.infer<typeof billingPackagePriceLinksAggregateSchema>;

export interface ProcessedAtPostureAssessment {
    complete: boolean;
    readyForFix: boolean;
    alreadyClosed: boolean;
    columnDefault: ProcessedAtPostureAggregate['column_default'] | null;
    counts: {
        total: number | null;
        invalidStatus: number | null;
        nullStatus: number | null;
        processingWithProcessedAt: number | null;
    };
    errors: string[];
    summary: string;
}

export interface BillingPackagePriceLinksAssessment {
    complete: boolean;
    ready: boolean;
    columnPresent: boolean | null;
    stripeLinkedWithoutPackagePrice: number | null;
    allSubscriptionsWithoutPackagePrice: number | null;
    errors: string[];
    summary: string;
}

export function assessProcessedAtPosture(value: unknown): ProcessedAtPostureAssessment {
    const parsed = processedAtPostureAggregateSchema.safeParse(value);
    if (!parsed.success) {
        const missing = value === undefined || value === null;
        const errors = describeIssues(parsed.error.issues);
        return {
            complete: false,
            readyForFix: false,
            alreadyClosed: false,
            columnDefault: null,
            counts: {
                total: null,
                invalidStatus: null,
                nullStatus: null,
                processingWithProcessedAt: null,
            },
            errors,
            summary: missing
                ? 'missing processed_at_posture evidence'
                : `incomplete processed_at_posture evidence: ${errors.join(', ')}`,
        };
    }

    const posture = parsed.data;
    const zeroHazards = posture.invalid_status === 0
        && posture.null_status === 0
        && posture.processing_with_processed_at === 0;
    const counts = {
        total: posture.total,
        invalidStatus: posture.invalid_status,
        nullStatus: posture.null_status,
        processingWithProcessedAt: posture.processing_with_processed_at,
    };
    const countSummary = `total=${posture.total}; invalid_status=${posture.invalid_status}; `
        + `null_status=${posture.null_status}; processing_with_processed_at=${posture.processing_with_processed_at}`;

    return {
        complete: true,
        readyForFix: posture.column_default === 'now()' && zeroHazards,
        alreadyClosed: posture.column_default === '<NULL>' && zeroHazards,
        columnDefault: posture.column_default,
        counts,
        errors: zeroHazards ? [] : ['processed_at row-state hazard counts must all be zero'],
        summary: zeroHazards
            ? `complete processed_at_posture evidence: default=${posture.column_default}; ${countSummary}`
            : `unsafe processed_at_posture evidence: default=${posture.column_default}; ${countSummary}`,
    };
}

export function assessBillingPackagePriceLinks(
    value: unknown,
    context: unknown,
): BillingPackagePriceLinksAssessment {
    const parsed = billingPackagePriceLinksAggregateSchema.safeParse(value);
    if (!parsed.success) {
        const missing = value === undefined || value === null;
        const errors = describeIssues(parsed.error.issues);
        return {
            complete: false,
            ready: false,
            columnPresent: null,
            stripeLinkedWithoutPackagePrice: null,
            allSubscriptionsWithoutPackagePrice: null,
            errors,
            summary: missing
                ? 'missing billing_package_price_links evidence'
                : `incomplete billing_package_price_links evidence: ${errors.join(', ')}`,
        };
    }

    const links = parsed.data;
    const parsedContext = billingPackagePriceLinksContextSchema.safeParse(context);
    if (!parsedContext.success) {
        const errors = describeIssues(parsedContext.error.issues).map((issue) => `context.${issue}`);
        return {
            complete: false,
            ready: false,
            columnPresent: links.column_present,
            stripeLinkedWithoutPackagePrice: links.stripe_linked_without_package_price,
            allSubscriptionsWithoutPackagePrice: links.all_subscriptions_without_package_price,
            errors,
            summary: `incomplete billing_package_price_links evidence: ${errors.join(', ')}`,
        };
    }

    const billing = parsedContext.data;
    const errors: string[] = [];
    if (billing.stripe_linked > billing.total_subscriptions) {
        errors.push('stripe_linked exceeds total_subscriptions');
    }
    if (links.stripe_linked_without_package_price > links.all_subscriptions_without_package_price) {
        errors.push('stripe_linked_without_package_price exceeds all_subscriptions_without_package_price');
    }
    if (links.all_subscriptions_without_package_price > billing.total_subscriptions) {
        errors.push('all_subscriptions_without_package_price exceeds total_subscriptions');
    }
    if (links.stripe_linked_without_package_price > billing.stripe_linked) {
        errors.push('stripe_linked_without_package_price exceeds stripe_linked');
    }
    if (!links.column_present) {
        if (links.all_subscriptions_without_package_price !== billing.total_subscriptions) {
            errors.push('absent package_price_id column requires every subscription to be counted as missing');
        }
        if (links.stripe_linked_without_package_price !== billing.stripe_linked) {
            errors.push('absent package_price_id column requires every Stripe-linked subscription to be counted as missing');
        }
    }
    if (errors.length > 0) {
        return {
            complete: false,
            ready: false,
            columnPresent: links.column_present,
            stripeLinkedWithoutPackagePrice: links.stripe_linked_without_package_price,
            allSubscriptionsWithoutPackagePrice: links.all_subscriptions_without_package_price,
            errors,
            summary: `incomplete billing_package_price_links evidence: ${errors.join(', ')}`,
        };
    }

    const ready = links.stripe_linked_without_package_price === 0;
    return {
        complete: true,
        ready,
        columnPresent: links.column_present,
        stripeLinkedWithoutPackagePrice: links.stripe_linked_without_package_price,
        allSubscriptionsWithoutPackagePrice: links.all_subscriptions_without_package_price,
        errors: ready ? [] : ['Stripe-linked subscriptions without package_price_id remain'],
        summary: `${ready ? 'complete' : 'blocking'} billing_package_price_links evidence: `
            + `column_present=${links.column_present}; `
            + `stripe_linked_without_package_price=${links.stripe_linked_without_package_price}; `
            + `all_subscriptions_without_package_price=${links.all_subscriptions_without_package_price}`,
    };
}

function describeIssues(issues: z.core.$ZodIssue[]): string[] {
    return issues.map((issue) => {
        const field = issue.path.join('.') || '<root>';
        return `${field}:${issue.code}`;
    });
}
