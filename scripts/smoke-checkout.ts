/**
 * Authenticated checkout smoke test.
 *
 * Creates a temporary Supabase student, signs in through the local app, calls
 * the real checkout endpoint, verifies that Stripe returns a Checkout URL, and
 * then deletes the temporary user/customer where possible.
 *
 * Run with the dev server active:
 *   pnpm exec tsx scripts/smoke-checkout.ts
 */
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import { chromium } from 'playwright';
import Stripe from 'stripe';
import type { Database } from '../src/types/database.types';

dotenv.config({ path: '.env', quiet: true });
dotenv.config({ path: '.env.test', override: true, quiet: true });

const supabaseUrl = process.env.PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.PUBLIC_SUPABASE_ANON_KEY;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
const baseUrl = process.env.TEST_BASE_URL || 'http://localhost:4321';

if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceKey || !stripeSecretKey) {
    throw new Error('Missing Supabase or Stripe environment variables');
}

const supabaseAdmin = createClient<Database>(supabaseUrl, supabaseServiceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
});

const stripe = new Stripe(stripeSecretKey, { apiVersion: '2026-02-25.clover' });

async function getCheckoutPriceId(): Promise<string> {
    const { data, error } = await supabaseAdmin
        .from('packages')
        .select('name, stripe_price_1m')
        .eq('is_active', true)
        .not('stripe_price_1m', 'is', null)
        .order('price_monthly', { ascending: true })
        .limit(1)
        .maybeSingle();

    if (error) throw error;
    if (!data?.stripe_price_1m) throw new Error('No active package has a 1 month Stripe Price ID');

    return data.stripe_price_1m;
}

async function createSmokeUser(email: string, password: string): Promise<string> {
    const { data, error } = await supabaseAdmin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { full_name: 'Checkout Smoke Student' },
    });

    if (error) throw error;
    if (!data.user) throw new Error('Supabase did not return a smoke user');

    const { error: profileError } = await supabaseAdmin
        .from('profiles')
        .upsert({
            id: data.user.id,
            email,
            full_name: 'Checkout Smoke Student',
            role: 'student',
            preferred_language: 'es',
            timezone: 'Europe/Madrid',
        }, { onConflict: 'id' });

    if (profileError) throw profileError;

    const { error: privateError } = await supabaseAdmin
        .from('profiles_private')
        .upsert({
            profile_id: data.user.id,
            current_level: 'A2',
        }, { onConflict: 'profile_id' });

    if (privateError && privateError.code !== '42P01') throw privateError;

    return data.user.id;
}

async function deleteSmokeUser(userId: string) {
    const { data: privateProfile } = await supabaseAdmin
        .from('profiles_private')
        .select('stripe_customer_id')
        .eq('profile_id', userId)
        .maybeSingle();

    if (privateProfile?.stripe_customer_id) {
        try {
            await stripe.customers.del(privateProfile.stripe_customer_id);
        } catch (error) {
            console.warn('Could not delete temporary Stripe customer:', error);
        }
    }

    await supabaseAdmin.from('profiles_private').delete().eq('profile_id', userId);
    await supabaseAdmin.from('profiles').delete().eq('id', userId);
    await supabaseAdmin.auth.admin.deleteUser(userId);
}

async function signInAndCreateCheckout(email: string, password: string, priceId: string) {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ baseURL: baseUrl });

    try {
        await page.goto('/es/login');
        await page.waitForFunction(() => {
            const island = document.querySelector('astro-island');
            return island && !island.hasAttribute('ssr');
        }, { timeout: 10000 });

        await page.fill('input[type="email"]', email);
        await page.fill('input[type="password"]', password);
        await page.click('button[type="submit"]');
        await page.waitForURL(/\/campus/, { timeout: 15000 });

        const response = await page.request.post('/api/create-checkout', {
            data: { priceId, lang: 'es' },
        });

        const json = await response.json() as { url?: string; error?: string };

        if (!response.ok()) {
            throw new Error(`Checkout endpoint failed (${response.status()}): ${json.error || 'unknown error'}`);
        }

        if (!json.url?.startsWith('https://checkout.stripe.com/')) {
            throw new Error('Checkout endpoint did not return a Stripe Checkout URL');
        }

        return json.url;
    } finally {
        await browser.close();
    }
}

async function main() {
    const email = `codex-checkout-smoke-${Date.now()}@example.com`;
    const password = `Smoke-${randomUUID()}-Aa1`;
    const priceId = await getCheckoutPriceId();
    let userId: string | null = null;

    try {
        userId = await createSmokeUser(email, password);
        const checkoutUrl = await signInAndCreateCheckout(email, password, priceId);
        const sessionId = checkoutUrl.match(/cs_(test|live)_[^#?/]*/)?.[0] || '<unknown>';

        console.log('Checkout smoke passed');
        console.log(`Stripe session: ${sessionId}`);
    } finally {
        if (userId) await deleteSmokeUser(userId);
    }
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
