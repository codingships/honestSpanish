import { stripe } from './stripe';
import type { StripeRuntimeContext } from './stripe-runtime-guard';

interface StripeCustomerSnapshot {
    stripe_customer_id: string | null;
    stripe_customer_account_id: string | null;
    stripe_customer_livemode: boolean | null;
}

export async function validatedStripeCustomerId(input: {
    profile: StripeCustomerSnapshot | null;
    userId: string;
    confirmedEmail: string;
    runtime: StripeRuntimeContext;
}): Promise<string | null> {
    const customerId = input.profile?.stripe_customer_id;
    if (!customerId) return null;
    if (
        input.profile?.stripe_customer_account_id !== input.runtime.accountId
        || input.profile?.stripe_customer_livemode !== input.runtime.livemode
    ) {
        return null;
    }

    try {
        const customer = await stripe.customers.retrieve(customerId);
        if (
            customer.deleted
            || customer.metadata.supabase_user_id !== input.userId
        ) {
            return null;
        }
        if (customer.email?.trim().toLowerCase() !== input.confirmedEmail.trim().toLowerCase()) {
            await stripe.customers.update(customer.id, { email: input.confirmedEmail });
        }
        return customer.id;
    } catch (error) {
        if ((error as { code?: unknown })?.code === 'resource_missing') return null;
        throw error;
    }
}
