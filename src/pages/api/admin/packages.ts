import type { APIContext, APIRoute } from 'astro';
import { z } from 'zod';
import { stripe } from '../../../lib/stripe';
import { createSupabaseAdminClient } from '../../../lib/supabase-admin';
import { createSupabaseServerClient } from '../../../lib/supabase-server';
import type { Database, Json } from '../../../types/database.types';

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

function serializePackage(pkg: Database['public']['Tables']['packages']['Row']) {
    return {
        ...pkg,
        display_name: parseDisplayName(pkg.display_name),
        checkout_ready: Boolean(pkg.is_active && pkg.stripe_price_1m && pkg.stripe_price_3m && pkg.stripe_price_6m),
    };
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

async function ensureStripeProduct(pkg: Database['public']['Tables']['packages']['Row']) {
    const displayName = parseDisplayName(pkg.display_name);

    if (pkg.stripe_product_id) {
        try {
            const existingProduct = await stripe.products.retrieve(pkg.stripe_product_id);
            if (!existingProduct.deleted) {
                if (
                    existingProduct.name !== (displayName.es || pkg.name) ||
                    existingProduct.active !== Boolean(pkg.is_active)
                ) {
                    await stripe.products.update(existingProduct.id, {
                        name: displayName.es || pkg.name,
                        active: Boolean(pkg.is_active),
                        metadata: {
                            package_id: pkg.id,
                            package_key: pkg.name,
                        },
                    });
                }
                return existingProduct.id;
            }
        } catch (error) {
            console.warn('[AdminPackages] Stripe product missing, creating replacement:', error);
        }
    }

    const product = await stripe.products.create({
        name: displayName.es || pkg.name,
        active: Boolean(pkg.is_active),
        metadata: {
            package_id: pkg.id,
            package_key: pkg.name,
        },
    });

    return product.id;
}

async function ensureStripePrice(input: {
    productId: string;
    packageKey: string;
    packageId: string;
    existingPriceId: string | null;
    amount: number;
    months: 1 | 3 | 6;
}) {
    if (input.existingPriceId) {
        try {
            const existingPrice = await stripe.prices.retrieve(input.existingPriceId);
            if (
                existingPrice.active &&
                existingPrice.unit_amount === input.amount &&
                existingPrice.currency === 'eur' &&
                existingPrice.recurring?.interval === 'month' &&
                existingPrice.recurring?.interval_count === input.months
            ) {
                return existingPrice.id;
            }

            if (existingPrice.active) {
                await stripe.prices.update(existingPrice.id, { active: false });
            }
        } catch (error) {
            console.warn('[AdminPackages] Existing Stripe price unavailable, creating new one:', error);
        }
    }

    const price = await stripe.prices.create({
        product: input.productId,
        currency: 'eur',
        unit_amount: input.amount,
        recurring: {
            interval: 'month',
            interval_count: input.months,
        },
        metadata: {
            package_id: input.packageId,
            package_key: input.packageKey,
            duration_months: String(input.months),
        },
    });

    return price.id;
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

    return jsonResponse({
        packages: (data ?? []).map(serializePackage),
    });
};

export const PATCH: APIRoute = async (context) => {
    const auth = await requireAdmin(context);
    if (auth.error || !auth.user) return auth.error;

    const parsed = parsePayload(updatePackageSchema, await context.request.json());
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
    const priceChanged = before.price_monthly !== nextPriceMonthly;
    const updateData: Database['public']['Tables']['packages']['Update'] = {
        display_name: payload.displayName,
        price_monthly: nextPriceMonthly,
        sessions_per_month: payload.sessionsPerMonth,
        has_group_session: payload.hasGroupSession,
        has_dual_teacher: payload.hasDualTeacher,
        is_active: payload.isActive,
    };

    if (priceChanged) {
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

    return jsonResponse({ package: serializePackage(updated) });
};

export const POST: APIRoute = async (context) => {
    const auth = await requireAdmin(context);
    if (auth.error || !auth.user) return auth.error;

    const body = await context.request.json();
    const supabaseAdmin = createSupabaseAdminClient();

    if (body?.action === 'create_package') {
        const parsed = parsePayload(createPackageSchema, body);
        if (parsed.error) return parsed.error;
        const payload = parsed.data;
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
    const { data: pkg, error: packageError } = await supabaseAdmin
        .from('packages')
        .select('*')
        .eq('id', payload.packageId)
        .single();

    if (packageError || !pkg) {
        return jsonResponse({ error: 'Package not found' }, 404);
    }

    const productId = await ensureStripeProduct(pkg);
    const discounts: Record<1 | 3 | 6, number> = { 1: 1, 3: 0.9, 6: 0.8 };
    const priceUpdates: Database['public']['Tables']['packages']['Update'] = {
        stripe_product_id: productId,
    };

    for (const months of payload.durations) {
        const key = `stripe_price_${months}m` as 'stripe_price_1m' | 'stripe_price_3m' | 'stripe_price_6m';
        priceUpdates[key] = await ensureStripePrice({
            productId,
            packageId: pkg.id,
            packageKey: pkg.name,
            existingPriceId: pkg[key],
            amount: Math.round(pkg.price_monthly * months * discounts[months]),
            months,
        });
    }

    const { data: updated, error: updateError } = await supabaseAdmin
        .from('packages')
        .update(priceUpdates)
        .eq('id', pkg.id)
        .select('*')
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

    return jsonResponse({ package: serializePackage(updated) });
};
