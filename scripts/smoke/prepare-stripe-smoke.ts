import 'dotenv/config';

import { createClient } from '@supabase/supabase-js';
import Stripe from 'stripe';

const supabaseUrl = process.env.PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const stripeSecretKey = process.env.STRIPE_SECRET_KEY;

if (!supabaseUrl || !serviceRoleKey || !stripeSecretKey) {
    throw new Error('Missing required environment variables for Stripe smoke preparation.');
}

const supabase = createClient(supabaseUrl, serviceRoleKey);
const stripe = new Stripe(stripeSecretKey, { apiVersion: '2025-03-31.basil' });

type PackageRow = {
    id: string;
    name: string;
    display_name: unknown;
    price_monthly: number;
    sessions_per_month: number;
    stripe_product_id: string | null;
    stripe_price_1m: string | null;
    stripe_price_3m: string | null;
    stripe_price_6m: string | null;
    is_active: boolean;
};

type DurationConfig = {
    months: 1 | 3 | 6;
    amount: number;
    column: 'stripe_price_1m' | 'stripe_price_3m' | 'stripe_price_6m';
};

const DURATION_CONFIGS: DurationConfig[] = [
    { months: 1, amount: 1, column: 'stripe_price_1m' },
    { months: 3, amount: 3, column: 'stripe_price_3m' },
    { months: 6, amount: 6, column: 'stripe_price_6m' },
];

async function main() {
    const { data: packages, error } = await supabase
        .from('packages')
        .select('id,name,display_name,price_monthly,sessions_per_month,stripe_product_id,stripe_price_1m,stripe_price_3m,stripe_price_6m,is_active')
        .eq('is_active', true)
        .order('created_at', { ascending: true });

    if (error) {
        throw error;
    }

    if (!packages || packages.length === 0) {
        throw new Error('No active packages found to prepare for Stripe smoke.');
    }

    const results = [];

    for (const pkg of packages as PackageRow[]) {
        const product = await ensureProduct(pkg);
        const priceUpdates: Partial<Record<DurationConfig['column'], string>> = {};

        for (const config of DURATION_CONFIGS) {
            const amount = pkg.price_monthly * config.amount;
            const price = await ensureRecurringPrice(product.id, pkg, config.months, amount);
            priceUpdates[config.column] = price.id;
        }

        const { error: updateError } = await supabase
            .from('packages')
            .update({
                stripe_product_id: product.id,
                ...priceUpdates,
            })
            .eq('id', pkg.id);

        if (updateError) {
            throw updateError;
        }

        results.push({
            packageId: pkg.id,
            packageName: pkg.name,
            productId: product.id,
            ...priceUpdates,
        });
    }

    console.log(JSON.stringify({ prepared: results }, null, 2));
}

async function ensureProduct(pkg: PackageRow) {
    if (pkg.stripe_product_id) {
        try {
            const existing = await stripe.products.retrieve(pkg.stripe_product_id);
            if (!existing.deleted) {
                return existing;
            }
        } catch {
            // Fall through to discovery/creation if the stored product no longer exists.
        }
    }

    const products = await stripe.products.list({ active: true, limit: 100 });
    const existing = products.data.find((product) =>
        product.metadata?.package_id === pkg.id && product.metadata?.smoke_managed === 'true'
    );

    if (existing) {
        return existing;
    }

    return stripe.products.create({
        name: `${displayName(pkg)} [Smoke]`,
        metadata: {
            package_id: pkg.id,
            package_name: pkg.name,
            smoke_managed: 'true',
        },
    });
}

async function ensureRecurringPrice(productId: string, pkg: PackageRow, months: 1 | 3 | 6, unitAmount: number) {
    const prices = await stripe.prices.list({
        product: productId,
        active: true,
        limit: 100,
    });

    const existing = prices.data.find((price) =>
        price.recurring?.interval === 'month' &&
        price.recurring?.interval_count === months &&
        price.unit_amount === unitAmount &&
        price.metadata?.package_id === pkg.id &&
        price.metadata?.smoke_managed === 'true'
    );

    if (existing) {
        return existing;
    }

    return stripe.prices.create({
        product: productId,
        currency: 'eur',
        unit_amount: unitAmount,
        recurring: {
            interval: 'month',
            interval_count: months,
        },
        metadata: {
            package_id: pkg.id,
            package_name: pkg.name,
            duration_months: String(months),
            smoke_managed: 'true',
        },
    });
}

function displayName(pkg: PackageRow) {
    if (pkg.display_name && typeof pkg.display_name === 'object') {
        const translated = pkg.display_name as Record<string, string>;
        return translated.es || translated.en || translated.ru || pkg.name;
    }

    return pkg.name;
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
