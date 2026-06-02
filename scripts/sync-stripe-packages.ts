/**
 * Synchronize active Supabase packages with Stripe recurring Products/Prices.
 *
 * This script creates or reuses one Stripe Product per active package and
 * recurring Prices for 1, 3, and 6 month billing periods. Stripe prices are
 * immutable, so mismatched active prices are deactivated and replaced.
 *
 * Dry run:
 *   pnpm exec tsx scripts/sync-stripe-packages.ts
 *
 * Apply:
 *   pnpm exec tsx scripts/sync-stripe-packages.ts --apply
 */
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import Stripe from 'stripe';
import type { Database, Json } from '../src/types/database.types';

dotenv.config({ path: '.env', quiet: true });

const apply = process.argv.includes('--apply');
const supabaseUrl = process.env.PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const stripeSecretKey = process.env.STRIPE_SECRET_KEY;

if (!supabaseUrl || !supabaseServiceKey || !stripeSecretKey) {
    throw new Error('Missing PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, or STRIPE_SECRET_KEY');
}

const supabase = createClient<Database>(supabaseUrl, supabaseServiceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
});

const stripe = new Stripe(stripeSecretKey, {
    apiVersion: '2026-02-25.clover',
});

type PackageRow = Database['public']['Tables']['packages']['Row'];
type DurationMonths = 1 | 3 | 6;
const durations: DurationMonths[] = [1, 3, 6];
const discounts: Record<DurationMonths, number> = { 1: 1, 3: 0.9, 6: 0.8 };

function parseDisplayName(value: Json): Record<'es' | 'en' | 'ru', string> {
    if (typeof value === 'string') {
        try {
            const parsed = JSON.parse(value);
            return {
                es: String(parsed.es || value),
                en: String(parsed.en || parsed.es || value),
                ru: String(parsed.ru || parsed.es || value),
            };
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

async function ensureProduct(pkg: PackageRow): Promise<string> {
    const displayName = parseDisplayName(pkg.display_name);
    const name = displayName.es || pkg.name;

    if (pkg.stripe_product_id) {
        try {
            const product = await stripe.products.retrieve(pkg.stripe_product_id);
            if (!product.deleted) {
                if (apply && (product.name !== name || product.active !== Boolean(pkg.is_active))) {
                    await stripe.products.update(product.id, {
                        name,
                        active: Boolean(pkg.is_active),
                        metadata: {
                            package_id: pkg.id,
                            package_key: pkg.name,
                        },
                    });
                }
                return product.id;
            }
        } catch {
            console.log(`Stripe product missing for ${pkg.name}; replacement needed`);
        }
    }

    if (!apply) return '<new_product>';

    const product = await stripe.products.create({
        name,
        active: Boolean(pkg.is_active),
        metadata: {
            package_id: pkg.id,
            package_key: pkg.name,
        },
    });

    return product.id;
}

async function ensurePrice(input: {
    productId: string;
    packageId: string;
    packageKey: string;
    existingPriceId: string | null;
    amount: number;
    months: DurationMonths;
}): Promise<string> {
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

            if (apply && existingPrice.active) {
                await stripe.prices.update(existingPrice.id, { active: false });
            }
        } catch {
            console.log(`Stripe price missing for ${input.packageKey}/${input.months}m; replacement needed`);
        }
    }

    if (!apply) return '<new_price>';

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

async function main() {
    const { data: packages, error } = await supabase
        .from('packages')
        .select('*')
        .eq('is_active', true)
        .order('price_monthly', { ascending: true });

    if (error) throw error;
    if (!packages || packages.length === 0) throw new Error('No active packages found');

    console.log(apply ? 'Applying Stripe package sync' : 'Dry run: Stripe package sync');
    console.log(`Active packages: ${packages.map((pkg) => pkg.name).join(', ')}`);

    let stripeMode: 'live' | 'test' | 'unknown' = 'unknown';

    for (const pkg of packages) {
        const productId = await ensureProduct(pkg);
        const updates: Database['public']['Tables']['packages']['Update'] = {};

        console.log(`\n${pkg.name}: ${pkg.price_monthly / 100} EUR/month`);
        console.log(`  product: ${productId}`);

        for (const months of durations) {
            const key = `stripe_price_${months}m` as 'stripe_price_1m' | 'stripe_price_3m' | 'stripe_price_6m';
            const amount = Math.round(pkg.price_monthly * months * discounts[months]);
            const priceId = await ensurePrice({
                productId,
                packageId: pkg.id,
                packageKey: pkg.name,
                existingPriceId: pkg[key],
                amount,
                months,
            });

            updates[key] = priceId;
            console.log(`  ${months}m: ${(amount / 100).toFixed(2)} EUR -> ${priceId}`);

            if (apply && priceId !== '<new_price>' && stripeMode === 'unknown') {
                const price = await stripe.prices.retrieve(priceId);
                stripeMode = price.livemode ? 'live' : 'test';
            }
        }

        if (apply) {
            updates.stripe_product_id = productId;
            const { error: updateError } = await supabase
                .from('packages')
                .update(updates)
                .eq('id', pkg.id);

            if (updateError) throw updateError;
        }
    }

    if (apply) {
        console.log(`\nStripe mode: ${stripeMode}`);
        console.log('Supabase packages updated with recurring Stripe Price IDs.');
    } else {
        console.log('\nNo changes written. Re-run with --apply to create/update Stripe and Supabase.');
    }
}

main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
});
