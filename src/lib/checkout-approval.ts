import type { createSupabaseAdminClient } from './supabase-admin';

type AdminClient = ReturnType<typeof createSupabaseAdminClient>;

export interface CheckoutApproval {
    opportunityId: string;
    packageId: string;
    contactId: string;
    approvedAt: string;
}

interface CheckoutIdentity {
    userId: string;
    email: string | null | undefined;
    emailConfirmedAt: string | null | undefined;
}

function normalizedEmail(value: string | null | undefined): string | null {
    const email = value?.trim().toLowerCase();
    return email && email.includes('@') ? email : null;
}

async function findOwnedContact(
    supabaseAdmin: AdminClient,
    identity: CheckoutIdentity
): Promise<{ id: string } | null> {
    if (!identity.emailConfirmedAt) return null;

    const email = normalizedEmail(identity.email);
    if (!email) return null;

    const { data: profileContact, error: profileContactError } = await supabaseAdmin
        .from('crm_contacts')
        .select('id, profile_id, primary_email')
        .eq('profile_id', identity.userId)
        .limit(1)
        .maybeSingle();

    if (profileContactError) throw profileContactError;
    if (profileContact) return { id: profileContact.id };

    const { data: emailContact, error: emailContactError } = await supabaseAdmin
        .from('crm_contacts')
        .select('id, profile_id, primary_email')
        .eq('primary_email', email)
        .limit(1)
        .maybeSingle();

    if (emailContactError) throw emailContactError;
    if (!emailContact || (emailContact.profile_id && emailContact.profile_id !== identity.userId)) {
        return null;
    }

    return { id: emailContact.id };
}

export async function findCheckoutApproval(
    supabaseAdmin: AdminClient,
    identity: CheckoutIdentity,
    packageId?: string
): Promise<CheckoutApproval | null> {
    const contact = await findOwnedContact(supabaseAdmin, identity);
    if (!contact) return null;

    let query = supabaseAdmin
        .from('crm_opportunities')
        .select('id, contact_id, preferred_package_id, checkout_approved_at')
        .eq('contact_id', contact.id)
        .eq('stage', 'proposal')
        .not('checkout_approved_at', 'is', null)
        .is('converted_subscription_id', null)
        .order('checkout_approved_at', { ascending: false })
        .limit(1);

    if (packageId) {
        query = query.eq('preferred_package_id', packageId);
    }

    const { data, error } = await query.maybeSingle();
    if (error) throw error;
    if (!data?.preferred_package_id || !data.checkout_approved_at) return null;

    return {
        opportunityId: data.id,
        packageId: data.preferred_package_id,
        contactId: data.contact_id,
        approvedAt: data.checkout_approved_at,
    };
}
