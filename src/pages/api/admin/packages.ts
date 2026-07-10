import type { APIContext, APIRoute } from 'astro';
import type Stripe from 'stripe';
import { z } from 'zod';
import { createSupabaseAdminClient } from '../../../lib/supabase-admin';
import { createSupabaseServerClient } from '../../../lib/supabase-server';
import {
    calculatePackageTotalCents,
    isPackageCheckoutReady,
    packagePriceField,
    PACKAGE_CURRENCY,
    type PackageDuration,
    type PackagePriceSnapshot,
} from '../../../lib/package-pricing';
import { assertStripePaymentReadiness, assertStripeRuntimeAccount } from '../../../lib/stripe-runtime-guard';
import type { Database, Json } from '../../../types/database.types';

type StripeClient = typeof import('../../../lib/stripe')['stripe'];

export const config = {
    runtime: 'nodejs',
};

const localizedTextSchema = z.object({
    es: z.string().trim().min(1).max(120),
    en: z.string().trim().min(1).max(120),
    ru: z.string().trim().min(1).max(120),
});

const updatePackageSchema = z.object({
    packageId: z.string().uuid(),
    displayName: localizedTextSchema,
    priceMonthlyEur: z.number().positive().max(10000),
    sessionsPerMonth: z.number().int().min(1).max(200),
    hasGroupSession: z.boolean(),
    hasDualTeacher: z.boolean(),
    isActive: z.boolean(),
});

const createPackageSchema = z.object({
    action: z.literal('create_package'),
    name: z.string().trim().regex(/^[a-z0-9][a-z0-9_-]{1,48}$/),
    displayName: localizedTextSchema,
    priceMonthlyEur: z.number().positive().max(10000),
    sessionsPerMonth: z.number().int().min(1).max(200),
    hasGroupSession: z.boolean().default(false),
    hasDualTeacher: z.boolean().default(false),
    isActive: z.boolean().default(false),
});

const syncStripeSchema = z.object({
    action: z.literal('sync_stripe'),
    packageId: z.string().uuid(),
    durations: z.array(z.union([z.literal(1), z.literal(3), z.literal(6)])).min(1).default([1, 3, 6]),
});

const jsonHeaders = { 'Content-Type': 'application/json' };

function jsonResponse(payload: unknown, status = 200): Response {
    return new Response(JSON.stringify(payload), {
        status,
        headers: jsonHeaders,
    });
}

function parsePayload<T>(schema: z.ZodType<T>, value: unknown): { data: T; error: null } | { data: null; error: Response } {
    const result = schema.safeParse(value);
    if (!result.success) {
        return {
            data: null,
            error: jsonResponse({
                error: 'Invalid package payload',
                details: result.error.issues.map((issue) => ({
                    path: issue.path.join('.'),
                    message: issue.message,
                })),
            }, 400),
        };
    }

    return { data: result.data, error: null };
}

async function readJsonBody(context: APIContext): Promise<{ data: unknown; error: null } | { data: null; error: Response }> {
    try {
        return { data: await context.request.json(), error: null };
    } catch {
        return { data: null, error: jsonResponse({ error: 'Invalid JSON body' }, 400) };
    }
}

async function requireAdmin(context: APIContext) {
    const supabase = createSupabaseServerClient(context);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { error: jsonResponse({ error: 'Unauthorized' }, 401), user: null };

    const { data: profile } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', user.id)
        .single();

    if (profile?.role !== 'admin') {
        return { error: jsonResponse({ error: 'Forbidden' }, 403), user: null };
    }

    return { error: null, user };
}

function centsFromEuro(value: number): number {
    return Math.round(value * 100);
}

function isStripeResourceMissing(error: unknown): boolean {
    return (error as { code?: unknown })?.code === 'resource_missing';
}

async function getStripeClient(): Promise<StripeClient> {
    const { stripe } = await import('../../../lib/stripe');
    return stripe;
}

function parseDisplayName(value: Json): Record<'es' | 'en' | 'ru', string> {
    if (typeof value === 'string') {
        try {
            const parsed = JSON.parse(value);
            if (parsed && typeof parsed === 'object') {
                return {
                    es: String(parsed.es || ''),
                    en: String(parsed.en || parsed.es || ''),
                    ru: String(parsed.ru || parsed.es || ''),
                };
            }
        } catch {
            return { es: value, en: value, ru: value };
        }
    }

    if (value && typeof value === 'object' && !Array.isArray(value)) {
        const localized = value as { es?: Json; en?: Json; ru?: Json };
        return {
            es: String(localized.es || ''),
            en: String(localized.en || localized.es || ''),
            ru: String(localized.ru || localized.es || ''),
        };
    }

    return { es: '', en: '', ru: '' };
}

type PackagePriceRow = Database['public']['Tables']['package_prices']['Row'];

function serializePackage(
    pkg: Database['public']['Tables']['packages']['Row'],
    packagePrices: PackagePriceSnapshot[] = []
) {
    return {
        ...pkg,
        display_name: parseDisplayName(pkg.display_name),
        checkout_ready: isPackageCheckoutReady({
            ...pkg,
            package_prices: packagePrices,
        }),
    };
}

async function loadActivePackagePrices(
    supabaseAdmin: ReturnType<typeof createSupabaseAdminClient>,
    packageIds: string[]
): Promise<Map<string, PackagePriceSnapshot[]>> {
    const byPackage = new Map<string, PackagePriceSnapshot[]>();
    if (packageIds.length === 0) return byPackage;

    const { data, error } = await supabaseAdmin
        .from('package_prices')
        .select('package_id, catalog_version, package_key, duration_months, amount_cents, currency, sessions_per_month, sessions_per_period, has_group_session, has_dual_teacher, status, stripe_account_id, stripe_livemode, stripe_product_id, stripe_price_id')
        .eq('status', 'active')
        .in('package_id', packageIds);
    if (error) throw error;

    for (const row of (data ?? []) as PackagePriceRow[]) {
        const packageRows = byPackage.get(row.package_id) ?? [];
        packageRows.push(row);
        byPackage.set(row.package_id, packageRows);
    }
    return byPackage;
}

async function logAudit(
    supabaseAdmin: ReturnType<typeof createSupabaseAdminClient>,
    input: {
        adminId: string;
        action: string;
        entityType: string;
        entityId?: string | null;
        before?: Json | null;
        after?: Json | null;
    }
) {
    const { error } = await supabaseAdmin
        .from('admin_audit_log')
        .insert({
            admin_id: input.adminId,
            action: input.action,
            entity_type: input.entityType,
            entity_id: input.entityId ?? null,
            before: input.before ?? null,
            after: input.after ?? null,
        });

    if (error && error.code !== '42P01') {
        console.error('[AdminPackages] Failed to write audit log:', error);
    }
}

async function ensureStripeProduct(
    pkg: Database['public']['Tables']['packages']['Row'],
    appEnvironment: string
) {
    const stripe = await getStripeClient();
    const displayName = parseDisplayName(pkg.display_name);
    const metadata = {
        package_id: pkg.id,
        package_key: pkg.name,
        catalog_version: String(pkg.catalog_version),
        app_environment: appEnvironment,
    };

    if (pkg.stripe_product_id) {
        try {
            const existingProduct = await stripe.products.retrieve(pkg.stripe_product_id);
            if (!existingProduct.deleted) {
                const boundPackageId = existingProduct.metadata.package_id;
                const boundEnvironment = existingProduct.metadata.app_environment;
                if (
                    (boundPackageId && boundPackageId !== metadata.package_id)
                    || (boundEnvironment && boundEnvironment !== metadata.app_environment)
                    || (!boundPackageId && existingProduct.name !== (displayName.es || pkg.name))
                ) {
                    throw new Error('Existing Stripe Product is bound to a different catalog');
                }
                if (
                    existingProduct.name !== (displayName.es || pkg.name) ||
                    existingProduct.active !== Boolean(pkg.is_active) ||
                    existingProduct.metadata.package_id !== metadata.package_id ||
                    existingProduct.metadata.package_key !== metadata.package_key ||
                    existingProduct.metadata.catalog_version !== metadata.catalog_version ||
                    existingProduct.metadata.app_environment !== metadata.app_environment
                ) {
                    await stripe.products.update(existingProduct.id, {
                        name: displayName.es || pkg.name,
                        active: Boolean(pkg.is_active),
                        metadata,
                    });
                }
                return existingProduct.id;
            }
        } catch (error) {
            if (!isStripeResourceMissing(error)) throw error;
            console.warn('[AdminPackages] Stripe product missing, creating replacement:', error);
        }
    }

    // Recover a Product created by a previous partial attempt. Product creation
    // happens before the first atomic Price activation can persist its ID.
    const products = await stripe.products.list({ limit: 100 });
    const reusableProduct = products.data.find((candidate) => (
        !candidate.deleted
        && candidate.metadata.package_id === metadata.package_id
        && candidate.metadata.catalog_version === metadata.catalog_version
        && candidate.metadata.app_environment === metadata.app_environment
    ));
    if (reusableProduct && !reusableProduct.deleted) {
        if (
            reusableProduct.name !== (displayName.es || pkg.name)
            || reusableProduct.active !== Boolean(pkg.is_active)
            || reusableProduct.metadata.package_key !== metadata.package_key
        ) {
            await stripe.products.update(reusableProduct.id, {
                name: displayName.es || pkg.name,
                active: Boolean(pkg.is_active),
                metadata,
            });
        }
        return reusableProduct.id;
    }

    const product = await stripe.products.create({
        name: displayName.es || pkg.name,
        active: Boolean(pkg.is_active),
        metadata,
    }, {
        idempotencyKey: `product:${appEnvironment}:${pkg.id}:v${pkg.catalog_version}`,
    });

    return product.id;
}

async function ensureStripePrice(input: {
    productId: string;
    packageKey: string;
    packageId: string;
    catalogVersion: number;
    appEnvironment: string;
    livemode: boolean;
    existingPriceId: string | null;
    amount: number;
    months: PackageDuration;
}) {
    const stripe = await getStripeClient();

    const priceMatches = (price: Stripe.Price) => {
        const priceProductId = typeof price.product === 'string' ? price.product : price.product.id;
        return price.active
            && priceProductId === input.productId
            && price.unit_amount === input.amount
            && price.currency === PACKAGE_CURRENCY
            && price.recurring?.interval === 'month'
            && price.recurring?.interval_count === input.months
            && price.livemode === input.livemode;
    };

    const retrieveValidatedPrice = async (priceId: string): Promise<Stripe.Price> => {
        let price = await stripe.prices.retrieve(priceId);

        if (!price.metadata.package_key) {
            await stripe.prices.update(price.id, {
                metadata: { package_key: input.packageKey },
            });
            price = await stripe.prices.retrieve(price.id);
        }

        if (
            !priceMatches(price)
            || price.metadata.package_id !== input.packageId
            || price.metadata.package_key !== input.packageKey
            || price.metadata.catalog_version !== String(input.catalogVersion)
            || price.metadata.duration_months !== String(input.months)
            || price.metadata.app_environment !== input.appEnvironment
        ) {
            throw new Error('Stripe Price does not match the catalog offer after persistence');
        }

        return price;
    };

    if (input.existingPriceId) {
        try {
            const existingPrice = await stripe.prices.retrieve(input.existingPriceId);
            const existingProductId = typeof existingPrice.product === 'string'
                ? existingPrice.product
                : existingPrice.product.id;
            if (
                existingProductId !== input.productId
                || existingPrice.metadata.package_id !== input.packageId
                || existingPrice.metadata.catalog_version !== String(input.catalogVersion)
                || existingPrice.metadata.duration_months !== String(input.months)
                || existingPrice.metadata.app_environment !== input.appEnvironment
            ) {
                throw new Error('Existing Stripe Price is bound to a different catalog');
            }
            if (
                existingPrice.metadata.package_key
                && existingPrice.metadata.package_key !== input.packageKey
            ) {
                throw new Error('Existing Stripe Price is bound to a different package key');
            }
            if (priceMatches(existingPrice)) return retrieveValidatedPrice(existingPrice.id);
        } catch (error) {
            if (!isStripeResourceMissing(error)) throw error;
            console.warn('[AdminPackages] Existing Stripe price unavailable, creating new one:', error);
        }
    }

    // Recover a Price created by a previous attempt where Stripe succeeded but
    // the atomic Supabase activation did not.
    const candidates = await stripe.prices.list({
        product: input.productId,
        active: true,
        limit: 100,
    });
    const reusablePrice = candidates.data.find((candidate) => (
        priceMatches(candidate)
        && candidate.metadata.package_id === input.packageId
        && candidate.metadata.catalog_version === String(input.catalogVersion)
        && candidate.metadata.duration_months === String(input.months)
        && candidate.metadata.app_environment === input.appEnvironment
        && (!candidate.metadata.package_key || candidate.metadata.package_key === input.packageKey)
    ));
    if (reusablePrice) return retrieveValidatedPrice(reusablePrice.id);

    const price = await stripe.prices.create({
        product: input.productId,
        currency: PACKAGE_CURRENCY,
        unit_amount: input.amount,
        recurring: {
            interval: 'month',
            interval_count: input.months,
        },
        metadata: {
            package_id: input.packageId,
            package_key: input.packageKey,
            catalog_version: String(input.catalogVersion),
            duration_months: String(input.months),
            app_environment: input.appEnvironment,
        },
    }, {
        idempotencyKey: `price:${input.appEnvironment}:${input.packageId}:v${input.catalogVersion}:${input.months}m`,
    });

    return retrieveValidatedPrice(price.id);
}

export const GET: APIRoute = async (context) => {
    const auth = await requireAdmin(context);
    if (auth.error) return auth.error;

    const supabaseAdmin = createSupabaseAdminClient();
    const { data, error } = await supabaseAdmin
        .from('packages')
        .select('*')
        .order('price_monthly', { ascending: true });

    if (error) {
        return jsonResponse({ error: 'Could not load packages' }, 500);
    }

    let activePrices: Map<string, PackagePriceSnapshot[]>;
    try {
        activePrices = await loadActivePackagePrices(supabaseAdmin, (data ?? []).map((pkg) => pkg.id));
    } catch {
        return jsonResponse({ error: 'Could not verify package billing readiness' }, 500);
    }

    return jsonResponse({
        packages: (data ?? []).map((pkg) => serializePackage(pkg, activePrices.get(pkg.id) ?? [])),
    });
};

export const PATCH: APIRoute = async (context) => {
    const auth = await requireAdmin(context);
    if (auth.error || !auth.user) return auth.error;

    const rawBody = await readJsonBody(context);
    if (rawBody.error) return rawBody.error;

    const parsed = parsePayload(updatePackageSchema, rawBody.data);
    if (parsed.error) return parsed.error;
    const payload = parsed.data;
    const supabaseAdmin = createSupabaseAdminClient();

    const { data: before, error: beforeError } = await supabaseAdmin
        .from('packages')
        .select('*')
        .eq('id', payload.packageId)
        .single();

    if (beforeError || !before) {
        return jsonResponse({ error: 'Package not found' }, 404);
    }

    const nextPriceMonthly = centsFromEuro(payload.priceMonthlyEur);
    const nextDisplayName = payload.displayName;
    const currentDisplayName = parseDisplayName(before.display_name);
    const catalogChanged = before.price_monthly !== nextPriceMonthly
        || before.sessions_per_month !== payload.sessionsPerMonth
        || Boolean(before.has_group_session) !== payload.hasGroupSession
        || Boolean(before.has_dual_teacher) !== payload.hasDualTeacher
        || JSON.stringify(currentDisplayName) !== JSON.stringify(nextDisplayName);
    const updateData: Database['public']['Tables']['packages']['Update'] = {
        display_name: nextDisplayName,
        price_monthly: nextPriceMonthly,
        sessions_per_month: payload.sessionsPerMonth,
        has_group_session: payload.hasGroupSession,
        has_dual_teacher: payload.hasDualTeacher,
        is_active: payload.isActive,
    };

    if (catalogChanged) {
        updateData.stripe_price_1m = null;
        updateData.stripe_price_3m = null;
        updateData.stripe_price_6m = null;
    }

    const { data: updated, error } = await supabaseAdmin
        .from('packages')
        .update(updateData)
        .eq('id', payload.packageId)
        .select('*')
        .single();

    if (error || !updated) {
        return jsonResponse({ error: 'Could not update package' }, 500);
    }

    await logAudit(supabaseAdmin, {
        adminId: auth.user.id,
        action: 'package.update',
        entityType: 'package',
        entityId: payload.packageId,
        before: before as Json,
        after: updated as Json,
    });

    let activePrices: Map<string, PackagePriceSnapshot[]>;
    try {
        activePrices = catalogChanged
            ? new Map()
            : await loadActivePackagePrices(supabaseAdmin, [updated.id]);
    } catch {
        return jsonResponse({ error: 'Package saved but billing readiness could not be verified' }, 500);
    }

    return jsonResponse({ package: serializePackage(updated, activePrices.get(updated.id) ?? []) });
};

export const POST: APIRoute = async (context) => {
    const auth = await requireAdmin(context);
    if (auth.error || !auth.user) return auth.error;

    const rawBody = await readJsonBody(context);
    if (rawBody.error) return rawBody.error;
    const body = rawBody.data;

    if (body && typeof body === 'object' && 'action' in body && body.action === 'create_package') {
        const parsed = parsePayload(createPackageSchema, body);
        if (parsed.error) return parsed.error;
        const payload = parsed.data;
        const supabaseAdmin = createSupabaseAdminClient();
        const { data: created, error } = await supabaseAdmin
            .from('packages')
            .insert({
                name: payload.name,
                display_name: payload.displayName,
                price_monthly: centsFromEuro(payload.priceMonthlyEur),
                sessions_per_month: payload.sessionsPerMonth,
                has_group_session: payload.hasGroupSession,
                has_dual_teacher: payload.hasDualTeacher,
                is_active: payload.isActive,
            })
            .select('*')
            .single();

        if (error || !created) {
            return jsonResponse({ error: error?.code === '23505' ? 'Package key already exists' : 'Could not create package' }, 400);
        }

        await logAudit(supabaseAdmin, {
            adminId: auth.user.id,
            action: 'package.create',
            entityType: 'package',
            entityId: created.id,
            after: created as Json,
        });

        return jsonResponse({ package: serializePackage(created) }, 201);
    }

    const parsed = parsePayload(syncStripeSchema, body);
    if (parsed.error) return parsed.error;
    const payload = parsed.data;
    const supabaseAdmin = createSupabaseAdminClient();
    const { data: pkg, error: packageError } = await supabaseAdmin
        .from('packages')
        .select('*')
        .eq('id', payload.packageId)
        .single();

    if (packageError || !pkg) {
        return jsonResponse({ error: 'Package not found' }, 404);
    }

    const stripe = await getStripeClient();
    const account = await stripe.accounts.retrieve();
    const stripeRuntime = assertStripeRuntimeAccount(context, account);
    if (stripeRuntime.livemode) assertStripePaymentReadiness(account);

    const { data: retiredPriceRows, error: retiredPricesError } = await supabaseAdmin
        .from('package_prices')
        .select('duration_months, stripe_price_id, stripe_account_id, stripe_livemode, retired_at')
        .eq('package_id', pkg.id)
        .eq('status', 'retired')
        .order('retired_at', { ascending: false });
    if (retiredPricesError) {
        return jsonResponse({ error: 'Could not load Stripe price history' }, 500);
    }
    const productId = await ensureStripeProduct(pkg, stripeRuntime.appEnvironment);
    const activeReplacementByDuration = new Map<PackageDuration, string>();

    for (const months of payload.durations) {
        const key = packagePriceField(months);
        const currentPriceId = pkg[key];
        const expectedAmount = calculatePackageTotalCents(pkg.price_monthly, months);
        const stripePrice = await ensureStripePrice({
            productId,
            packageId: pkg.id,
            packageKey: pkg.name,
            catalogVersion: pkg.catalog_version,
            appEnvironment: stripeRuntime.appEnvironment,
            livemode: stripeRuntime.livemode,
            existingPriceId: currentPriceId,
            amount: expectedAmount,
            months,
        });

        if (stripePrice.livemode !== stripeRuntime.livemode) {
            return jsonResponse({ error: 'Stripe Price mode does not match this environment' }, 409);
        }

        const { error: activationError } = await supabaseAdmin.rpc('activate_package_price', {
            p_package_id: pkg.id,
            p_catalog_version: pkg.catalog_version,
            p_duration_months: months,
            p_amount_cents: expectedAmount,
            p_currency: PACKAGE_CURRENCY,
            p_stripe_account_id: stripeRuntime.accountId,
            p_stripe_livemode: stripeRuntime.livemode,
            p_stripe_product_id: productId,
            p_stripe_price_id: stripePrice.id,
            p_activated_by: auth.user.id,
        });

        if (activationError) {
            console.error('[AdminPackages] Stripe Price created but activation failed:', activationError);
            return jsonResponse({ error: 'Stripe price could not be activated in the catalog' }, 409);
        }
        activeReplacementByDuration.set(months, stripePrice.id);
    }

    // Retry every retired Price for the synchronized durations on every run.
    // A transient Stripe failure must not leave an obsolete offer active forever.
    for (const retiredPrice of retiredPriceRows ?? []) {
        if (
            (retiredPrice.duration_months !== 1
                && retiredPrice.duration_months !== 3
                && retiredPrice.duration_months !== 6)
            || !payload.durations.includes(retiredPrice.duration_months)
            || retiredPrice.stripe_livemode !== stripeRuntime.livemode
            || (retiredPrice.stripe_account_id && retiredPrice.stripe_account_id !== stripeRuntime.accountId)
            || activeReplacementByDuration.get(retiredPrice.duration_months) === retiredPrice.stripe_price_id
        ) continue;

        try {
            await stripe.prices.update(retiredPrice.stripe_price_id, { active: false });
        } catch (archiveError) {
            console.warn('[AdminPackages] Retired Stripe Price could not be archived and will be retried:', archiveError);
        }
    }

    const { data: updated, error: updateError } = await supabaseAdmin
        .from('packages')
        .select('*')
        .eq('id', pkg.id)
        .single();

    if (updateError || !updated) {
        return jsonResponse({ error: 'Stripe prices created but DB update failed' }, 500);
    }

    await logAudit(supabaseAdmin, {
        adminId: auth.user.id,
        action: 'package.stripe_sync',
        entityType: 'package',
        entityId: pkg.id,
        before: pkg as Json,
        after: updated as Json,
    });

    let activePrices: Map<string, PackagePriceSnapshot[]>;
    try {
        activePrices = await loadActivePackagePrices(supabaseAdmin, [updated.id]);
    } catch {
        return jsonResponse({ error: 'Stripe synchronized but billing readiness could not be verified' }, 500);
    }

    return jsonResponse({ package: serializePackage(updated, activePrices.get(updated.id) ?? []) });
};
