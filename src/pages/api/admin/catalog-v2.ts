import type { APIContext, APIRoute } from 'astro';
import { z } from 'zod';
import { requireAdminCapability } from '../../../lib/admin-access';
import {
    CATALOG_V2_CURRENCY,
    CATALOG_V2_INTERVAL_UNITS,
    buildGuaranteeSchedule,
    isCurrentCheckoutRuntimeCompatible,
    parseCatalogV2DisplayName,
    type CatalogV2IntervalUnit,
    type CatalogV2Terms,
} from '../../../lib/catalog-v2';
import {
    archiveCatalogStripeResources,
    ensureCatalogStripePricePair,
    ensureCatalogStripeProduct,
    type CatalogV2StripeClient,
} from '../../../lib/catalog-v2-stripe';
import { createSupabaseAdminClient } from '../../../lib/supabase-admin';
import { createSupabaseServerClient } from '../../../lib/supabase-server';
import { assertStripePaymentReadiness, assertStripeRuntimeAccount } from '../../../lib/stripe-runtime-guard';
import type { Database } from '../../../types/database.types';

export const config = { runtime: 'nodejs' };

type AdminClient = ReturnType<typeof createSupabaseAdminClient>;
type PackageRow = Database['public']['Tables']['packages']['Row'];
type DraftRow = Database['public']['Tables']['package_catalog_drafts']['Row'];
type PriceRow = Database['public']['Tables']['package_prices']['Row'];
type SnapshotRow = Database['public']['Tables']['checkout_v2_price_snapshots']['Row'];

const jsonHeaders = { 'Content-Type': 'application/json' };
const localizedTextSchema = z.object({
    es: z.string().trim().min(1).max(120),
    en: z.string().trim().min(1).max(120),
    ru: z.string().trim().min(1).max(120),
});
const intervalUnitSchema = z.enum(CATALOG_V2_INTERVAL_UNITS);

const termsSchema = z.object({
    displayName: localizedTextSchema,
    amountCents: z.number().int().min(1).max(1_000_000),
    billingIntervalUnit: intervalUnitSchema,
    billingIntervalCount: z.number().int().min(1),
    sessionsPerPeriod: z.number().int().min(1).max(200),
    classDurationMinutes: z.number().int().min(15).max(240),
    hasGroupSession: z.boolean().default(false),
    hasDualTeacher: z.boolean().default(false),
    isPubliclyListed: z.boolean().default(false),
}).superRefine((value, context) => {
    const maximum = value.billingIntervalUnit === 'day'
        ? 1095
        : value.billingIntervalUnit === 'week'
            ? 156
            : value.billingIntervalUnit === 'month'
                ? 36
                : 3;
    if (value.billingIntervalCount > maximum) {
        context.addIssue({
            code: 'custom',
            path: ['billingIntervalCount'],
            message: `Maximum interval count for ${value.billingIntervalUnit} is ${maximum}`,
        });
    }
    if (value.amountCents < value.sessionsPerPeriod) {
        context.addIssue({
            code: 'custom',
            path: ['amountCents'],
            message: 'The amount must allocate at least one cent to every class',
        });
    }
});

const createExistingDraftSchema = z.object({
    action: z.literal('create_draft'),
    packageId: z.string().uuid(),
});
const createNewDraftSchema = z.object({
    action: z.literal('create_draft'),
    packageKey: z.string().trim().regex(/^[a-z0-9][a-z0-9_-]{1,48}$/),
}).and(termsSchema);
const updateDraftSchema = z.object({
    action: z.literal('update_draft'),
    draftId: z.string().uuid(),
    expectedRevision: z.number().int().positive(),
}).and(termsSchema);
const discardDraftSchema = z.object({
    action: z.literal('discard_draft'),
    draftId: z.string().uuid(),
    expectedRevision: z.number().int().positive(),
});
const publishDraftSchema = z.object({
    action: z.literal('publish_draft'),
    draftId: z.string().uuid(),
    expectedRevision: z.number().int().positive(),
});
const retirePackageSchema = z.object({
    action: z.literal('retire_package'),
    packageId: z.string().uuid(),
});
const actionSchema = z.union([
    createExistingDraftSchema,
    createNewDraftSchema,
    updateDraftSchema,
    discardDraftSchema,
    publishDraftSchema,
    retirePackageSchema,
]);

type TermsPayload = z.infer<typeof termsSchema>;
type PublishPayload = z.infer<typeof publishDraftSchema>;

class RouteFailure extends Error {
    constructor(readonly response: Response) {
        super(`Catalog V2 request failed with ${response.status}`);
    }
}

function jsonResponse(payload: unknown, status = 200): Response {
    return new Response(JSON.stringify(payload), { status, headers: jsonHeaders });
}

function maskStripeId(value: string | null | undefined): string | null {
    if (!value) return null;
    if (value.length <= 16) return `${value.slice(0, 8)}…`;
    return `${value.slice(0, 12)}…${value.slice(-4)}`;
}

function termsFromDraft(draft: DraftRow): CatalogV2Terms {
    return {
        packageKey: draft.package_key,
        amountCents: draft.amount_cents,
        currency: draft.currency,
        billingIntervalUnit: draft.billing_interval_unit as CatalogV2IntervalUnit,
        billingIntervalCount: draft.billing_interval_count,
        sessionsPerPeriod: draft.sessions_per_period,
        classDurationMinutes: draft.class_duration_minutes,
        hasGroupSession: draft.has_group_session,
        hasDualTeacher: draft.has_dual_teacher,
    };
}

function termsFromPayload(packageKey: string, payload: TermsPayload): CatalogV2Terms {
    return {
        packageKey,
        amountCents: payload.amountCents,
        currency: CATALOG_V2_CURRENCY,
        billingIntervalUnit: payload.billingIntervalUnit,
        billingIntervalCount: payload.billingIntervalCount,
        sessionsPerPeriod: payload.sessionsPerPeriod,
        classDurationMinutes: payload.classDurationMinutes,
        hasGroupSession: payload.hasGroupSession,
        hasDualTeacher: payload.hasDualTeacher,
    };
}

function serializeDraft(draft: DraftRow) {
    const terms = termsFromDraft(draft);
    return {
        id: draft.id,
        package_id: draft.package_id,
        package_key: draft.package_key,
        base_catalog_version: draft.base_catalog_version,
        revision: draft.revision,
        status: draft.status,
        display_name: parseCatalogV2DisplayName(draft.display_name),
        amount_cents: draft.amount_cents,
        currency: draft.currency,
        billing_interval_unit: draft.billing_interval_unit,
        billing_interval_count: draft.billing_interval_count,
        sessions_per_period: draft.sessions_per_period,
        class_duration_minutes: draft.class_duration_minutes,
        has_group_session: draft.has_group_session,
        has_dual_teacher: draft.has_dual_teacher,
        is_publicly_listed: draft.is_publicly_listed,
        checkout_compatible: isCurrentCheckoutRuntimeCompatible(terms),
        guarantee_schedule: buildGuaranteeSchedule(draft.amount_cents, draft.sessions_per_period),
        created_at: draft.created_at,
        updated_at: draft.updated_at,
        published_at: draft.published_at,
        discarded_at: draft.discarded_at,
    };
}

async function loadCatalogState(admin: AdminClient) {
    const [packagesResult, draftsResult, pricesResult] = await Promise.all([
        admin.from('packages')
            .select('*')
            .eq('contract_schema_version', 2)
            .order('created_at', { ascending: true }),
        admin.from('package_catalog_drafts')
            .select('*')
            .order('created_at', { ascending: false }),
        admin.from('package_prices')
            .select('*')
            .eq('contract_schema_version', 2)
            .order('catalog_version', { ascending: false }),
    ]);
    if (packagesResult.error || draftsResult.error || pricesResult.error) {
        throw new RouteFailure(jsonResponse({ error: 'Could not load the versioned catalogue' }, 500));
    }

    const packages = (packagesResult.data ?? []) as PackageRow[];
    const drafts = (draftsResult.data ?? []) as DraftRow[];
    const prices = (pricesResult.data ?? []) as PriceRow[];
    const snapshotsResult = prices.length > 0
        ? await admin.from('checkout_v2_price_snapshots')
            .select('*')
            .in('package_price_id', prices.map((price) => price.id))
        : { data: [] as SnapshotRow[], error: null };
    if (snapshotsResult.error) {
        throw new RouteFailure(jsonResponse({ error: 'Could not load checkout price snapshots' }, 500));
    }
    const snapshots = (snapshotsResult.data ?? []) as SnapshotRow[];
    const snapshotByPriceId = new Map(snapshots.map((snapshot) => [snapshot.package_price_id, snapshot]));

    return {
        packages: packages.map((pkg) => {
            const history = prices.filter((price) => price.package_id === pkg.id);
            const activePrice = history.find((price) => price.status === 'active') ?? null;
            const activeSnapshot = activePrice ? snapshotByPriceId.get(activePrice.id) ?? null : null;
            const openDraft = drafts.find((draft) => draft.package_id === pkg.id && draft.status === 'draft') ?? null;
            const terms: CatalogV2Terms = {
                packageKey: pkg.name,
                amountCents: pkg.amount_cents ?? 0,
                currency: CATALOG_V2_CURRENCY,
                billingIntervalUnit: (pkg.billing_interval_unit ?? 'day') as CatalogV2IntervalUnit,
                billingIntervalCount: pkg.billing_interval_count ?? 0,
                sessionsPerPeriod: pkg.sessions_per_period ?? 0,
                classDurationMinutes: pkg.class_duration_minutes ?? 0,
                hasGroupSession: Boolean(pkg.has_group_session),
                hasDualTeacher: Boolean(pkg.has_dual_teacher),
            };
            const checkoutCompatible = isCurrentCheckoutRuntimeCompatible(terms);

            return {
                id: pkg.id,
                package_key: pkg.name,
                catalog_version: pkg.catalog_version,
                display_name: parseCatalogV2DisplayName(pkg.display_name),
                amount_cents: pkg.amount_cents,
                currency: CATALOG_V2_CURRENCY,
                billing_interval_unit: pkg.billing_interval_unit,
                billing_interval_count: pkg.billing_interval_count,
                sessions_per_period: pkg.sessions_per_period,
                class_duration_minutes: pkg.class_duration_minutes,
                has_group_session: Boolean(pkg.has_group_session),
                has_dual_teacher: Boolean(pkg.has_dual_teacher),
                is_active: Boolean(pkg.is_active),
                is_publicly_listed: pkg.is_publicly_listed,
                checkout_compatible: checkoutCompatible,
                sellable_now: Boolean(
                    pkg.is_active
                    && pkg.is_publicly_listed
                    && checkoutCompatible
                    && activePrice
                    && activeSnapshot
                ),
                stripe_product: maskStripeId(pkg.stripe_product_id),
                active_price: activePrice ? {
                    id: activePrice.id,
                    catalog_version: activePrice.catalog_version,
                    recurring_stripe_price: maskStripeId(activePrice.stripe_price_id),
                    initial_stripe_price: maskStripeId(activeSnapshot?.initial_stripe_price_id),
                } : null,
                draft: openDraft ? serializeDraft(openDraft) : null,
                history: history.map((price) => ({
                    id: price.id,
                    catalog_version: price.catalog_version,
                    amount_cents: price.amount_cents,
                    billing_interval_unit: price.billing_interval_unit,
                    billing_interval_count: price.billing_interval_count,
                    sessions_per_period: price.sessions_per_period,
                    class_duration_minutes: price.class_duration_minutes,
                    status: price.status,
                    activated_at: price.activated_at,
                    retired_at: price.retired_at,
                })),
            };
        }),
    };
}

function rpcFailure(error: { code?: string | null } | null, fallback: string): RouteFailure {
    const code = error?.code ?? 'unknown';
    const status = code === '40001' || code === '23505'
        ? 409
        : code === 'P0002'
            ? 404
            : code === '42501'
                ? 403
                : code === '22023' || code === '23514'
                    ? 400
                    : 500;
    return new RouteFailure(jsonResponse({ error: fallback, code }, status));
}

async function getStripeClient(): Promise<CatalogV2StripeClient> {
    return (await import('../../../lib/stripe')).stripe;
}

async function retiredStripeIds(admin: AdminClient, packageId: string): Promise<Set<string>> {
    const { data: prices, error } = await admin.from('package_prices')
        .select('id, stripe_price_id')
        .eq('package_id', packageId)
        .eq('status', 'retired');
    if (error) throw rpcFailure(error, 'Could not load retired Stripe prices');
    const typedPrices = (prices ?? []) as Pick<PriceRow, 'id' | 'stripe_price_id'>[];
    const ids = new Set(typedPrices.map((price) => price.stripe_price_id));
    if (typedPrices.length === 0) return ids;

    const { data: snapshots, error: snapshotsError } = await admin
        .from('checkout_v2_price_snapshots')
        .select('initial_stripe_price_id, recurring_stripe_price_id')
        .in('package_price_id', typedPrices.map((price) => price.id));
    if (snapshotsError) throw rpcFailure(snapshotsError, 'Could not load retired checkout prices');
    for (const snapshot of snapshots ?? []) {
        ids.add(snapshot.initial_stripe_price_id);
        ids.add(snapshot.recurring_stripe_price_id);
    }
    return ids;
}

async function publishDraft(
    context: APIContext,
    admin: AdminClient,
    actorId: string,
    payload: PublishPayload,
) {
    const { data: draft, error: draftError } = await admin.from('package_catalog_drafts')
        .select('*')
        .eq('id', payload.draftId)
        .single();
    if (draftError || !draft) throw rpcFailure(draftError, 'Catalogue draft not found');
    const typedDraft = draft as DraftRow;
    if (typedDraft.revision !== payload.expectedRevision) {
        throw new RouteFailure(jsonResponse({ error: 'The draft changed; reload before publishing', code: 'stale_revision' }, 409));
    }
    if (typedDraft.status === 'discarded') {
        throw new RouteFailure(jsonResponse({ error: 'Discarded drafts cannot be published' }, 409));
    }

    const { data: pkg, error: packageError } = await admin.from('packages')
        .select('*')
        .eq('id', typedDraft.package_id)
        .eq('contract_schema_version', 2)
        .single();
    if (packageError || !pkg) throw rpcFailure(packageError, 'Versioned package not found');
    const typedPackage = pkg as PackageRow;

    if (typedDraft.status === 'published') {
        const warnings = await archiveCatalogStripeResources({
            stripe: await getStripeClient(),
            priceIds: await retiredStripeIds(admin, typedPackage.id),
        });
        return { changed: false, warnings };
    }
    if (typedPackage.catalog_version !== typedDraft.base_catalog_version) {
        throw new RouteFailure(jsonResponse({ error: 'The package changed; discard this stale draft', code: 'stale_catalog' }, 409));
    }

    const draftTerms = termsFromDraft(typedDraft);
    const checkoutCompatible = isCurrentCheckoutRuntimeCompatible(draftTerms);
    if (typedDraft.is_publicly_listed && !checkoutCompatible) {
        throw new RouteFailure(jsonResponse({
            error: 'This package can be published internally, but cannot be publicly listed until checkout supports its exact terms',
            code: 'checkout_contract_not_implemented',
        }, 409));
    }

    const stripe = await getStripeClient();
    const account = await stripe.accounts.retrieve();
    const runtime = assertStripeRuntimeAccount(context, account);
    if (runtime.livemode) assertStripePaymentReadiness(account);
    const targetCatalogVersion = typedDraft.base_catalog_version + 1;
    const identity = {
        appEnvironment: runtime.appEnvironment,
        packageId: typedPackage.id,
        packageKey: typedPackage.name,
    };
    const product = await ensureCatalogStripeProduct({
        stripe,
        identity,
        displayName: parseCatalogV2DisplayName(typedDraft.display_name),
        existingProductId: typedPackage.stripe_product_id,
        targetCatalogVersion,
    });
    const pair = await ensureCatalogStripePricePair(stripe, {
        ...identity,
        amountCents: typedDraft.amount_cents,
        billingIntervalCount: typedDraft.billing_interval_count,
        billingIntervalUnit: typedDraft.billing_interval_unit as CatalogV2IntervalUnit,
        catalogVersion: targetCatalogVersion,
        currency: CATALOG_V2_CURRENCY,
        draftId: typedDraft.id,
        draftRevision: typedDraft.revision,
        livemode: runtime.livemode,
        productId: product.id,
    });

    const { error: publishError } = await admin.rpc('publish_package_catalog_draft', {
        p_actor_id: actorId,
        p_draft_id: typedDraft.id,
        p_expected_revision: typedDraft.revision,
        p_initial_stripe_price_id: pair.initial.id,
        p_recurring_stripe_price_id: pair.recurring.id,
        p_stripe_account_id: runtime.accountId,
        p_stripe_livemode: runtime.livemode,
        p_stripe_product_id: product.id,
    });
    if (publishError) {
        console.error('[CatalogV2] Stripe objects reserved; database publication failed', {
            code: publishError.code ?? 'unknown',
            draftId: typedDraft.id,
        });
        throw rpcFailure(publishError, 'Publication did not activate; retry this same draft safely');
    }

    const warnings = await archiveCatalogStripeResources({
        stripe,
        priceIds: await retiredStripeIds(admin, typedPackage.id),
    });
    return { changed: true, warnings };
}

async function retirePackage(
    context: APIContext,
    admin: AdminClient,
    actorId: string,
    packageId: string,
) {
    const { data: pkg, error: packageError } = await admin.from('packages')
        .select('id, stripe_product_id, contract_schema_version')
        .eq('id', packageId)
        .single();
    if (packageError || !pkg || pkg.contract_schema_version !== 2) {
        throw rpcFailure(packageError, 'Versioned package not found');
    }
    const { error } = await admin.rpc('retire_versioned_package', {
        p_actor_id: actorId,
        p_package_id: packageId,
    });
    if (error) throw rpcFailure(error, 'Could not retire the package');

    let stripe: CatalogV2StripeClient;
    try {
        stripe = await getStripeClient();
        const account = await stripe.accounts.retrieve();
        assertStripeRuntimeAccount(context, account);
    } catch {
        return { warnings: ['stripe:runtime'] };
    }

    const warnings = await archiveCatalogStripeResources({
        stripe,
        priceIds: await retiredStripeIds(admin, packageId),
        productId: pkg.stripe_product_id,
        retireProduct: true,
    });
    return { warnings };
}

async function parseAction(context: APIContext) {
    let value: unknown;
    try {
        value = await context.request.json();
    } catch {
        throw new RouteFailure(jsonResponse({ error: 'Invalid JSON body' }, 400));
    }
    const parsed = actionSchema.safeParse(value);
    if (!parsed.success) {
        throw new RouteFailure(jsonResponse({
            error: 'Invalid catalogue action',
            details: parsed.error.issues.map((issue) => ({
                path: issue.path.join('.'),
                message: issue.message,
            })),
        }, 400));
    }
    return parsed.data;
}

export const GET: APIRoute = async (context) => {
    const auth = await requireAdminCapability(context, 'catalog.read');
    if (auth.error) return auth.error;

    try {
        const server = createSupabaseServerClient(context);
        const [{ data: canWrite, error: capabilityError }, catalog] = await Promise.all([
            server.rpc('has_my_admin_capability', { p_capability: 'catalog.write' }),
            loadCatalogState(createSupabaseAdminClient()),
        ]);
        return jsonResponse({
            ...catalog,
            can_write: capabilityError ? false : canWrite === true,
        });
    } catch (error) {
        return error instanceof RouteFailure
            ? error.response
            : jsonResponse({ error: 'Could not load the versioned catalogue' }, 500);
    }
};

export const POST: APIRoute = async (context) => {
    const auth = await requireAdminCapability(context, 'catalog.write');
    if (auth.error || !auth.user) return auth.error;

    try {
        const action = await parseAction(context);
        const admin = createSupabaseAdminClient();
        let operation: { changed?: boolean; warnings?: string[] } = {};

        if (action.action === 'create_draft') {
            const existing = 'packageId' in action;
            const { error } = await admin.rpc('create_package_catalog_draft', existing ? {
                p_actor_id: auth.user.id,
                p_package_id: action.packageId,
            } : {
                p_actor_id: auth.user.id,
                p_amount_cents: action.amountCents,
                p_billing_interval_count: action.billingIntervalCount,
                p_billing_interval_unit: action.billingIntervalUnit,
                p_class_duration_minutes: action.classDurationMinutes,
                p_display_name: action.displayName,
                p_has_dual_teacher: action.hasDualTeacher,
                p_has_group_session: action.hasGroupSession,
                p_is_publicly_listed: action.isPubliclyListed,
                p_package_key: action.packageKey,
                p_sessions_per_period: action.sessionsPerPeriod,
            });
            if (error) throw rpcFailure(error, existing ? 'Could not create a new package version' : 'Could not create the package draft');
        } else if (action.action === 'update_draft') {
            const { data: draftIdentity, error: identityError } = await admin
                .from('package_catalog_drafts')
                .select('package_key')
                .eq('id', action.draftId)
                .single();
            if (identityError || !draftIdentity) {
                throw rpcFailure(identityError, 'Catalogue draft not found');
            }
            const terms = termsFromPayload(draftIdentity.package_key, action);
            if (action.isPubliclyListed && !isCurrentCheckoutRuntimeCompatible(terms)) {
                throw new RouteFailure(jsonResponse({
                    error: 'Public listing is disabled until checkout supports these exact terms',
                    code: 'checkout_contract_not_implemented',
                }, 409));
            }
            const { error } = await admin.rpc('update_package_catalog_draft', {
                p_actor_id: auth.user.id,
                p_amount_cents: action.amountCents,
                p_billing_interval_count: action.billingIntervalCount,
                p_billing_interval_unit: action.billingIntervalUnit,
                p_class_duration_minutes: action.classDurationMinutes,
                p_display_name: action.displayName,
                p_draft_id: action.draftId,
                p_expected_revision: action.expectedRevision,
                p_has_dual_teacher: action.hasDualTeacher,
                p_has_group_session: action.hasGroupSession,
                p_is_publicly_listed: action.isPubliclyListed,
                p_sessions_per_period: action.sessionsPerPeriod,
            });
            if (error) throw rpcFailure(error, 'Could not update the catalogue draft');
        } else if (action.action === 'discard_draft') {
            const { error } = await admin.rpc('discard_package_catalog_draft', {
                p_actor_id: auth.user.id,
                p_draft_id: action.draftId,
                p_expected_revision: action.expectedRevision,
            });
            if (error) throw rpcFailure(error, 'Could not discard the catalogue draft');
        } else if (action.action === 'publish_draft') {
            operation = await publishDraft(context, admin, auth.user.id, action);
        } else {
            operation = await retirePackage(context, admin, auth.user.id, action.packageId);
        }

        return jsonResponse({
            ...(await loadCatalogState(admin)),
            operation,
        });
    } catch (error) {
        if (error instanceof RouteFailure) return error.response;
        console.error('[CatalogV2] Managed catalogue operation failed', {
            name: error instanceof Error ? error.name : 'unknown',
            code: (error as { code?: unknown })?.code ?? 'unknown',
        });
        return jsonResponse({ error: 'Catalogue operation failed safely before completion' }, 502);
    }
};
