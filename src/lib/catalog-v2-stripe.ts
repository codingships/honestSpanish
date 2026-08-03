import type Stripe from 'stripe';
import type { CatalogV2IntervalUnit, CatalogV2LocalizedText } from './catalog-v2';

export type CatalogV2StripeClient = typeof import('./stripe')['stripe'];

type CatalogStripeIdentity = {
    appEnvironment: string;
    packageId: string;
    packageKey: string;
};

type CatalogPriceInput = CatalogStripeIdentity & {
    amountCents: number;
    billingIntervalCount: number;
    billingIntervalUnit: CatalogV2IntervalUnit;
    catalogVersion: number;
    currency: 'eur';
    draftId: string;
    draftRevision: number;
    livemode: boolean;
    productId: string;
};

export type CatalogPricePair = {
    initial: Stripe.Price;
    recurring: Stripe.Price;
};

const PAGE_LIMIT = 100;
const MAX_PAGES = 10;

function isMissingStripeResource(error: unknown): boolean {
    return (error as { code?: unknown })?.code === 'resource_missing';
}

function productName(displayName: CatalogV2LocalizedText, packageKey: string): string {
    return displayName.es.trim() || displayName.en.trim() || packageKey;
}

function productMatchesIdentity(
    product: Stripe.Product,
    identity: CatalogStripeIdentity,
): boolean {
    return product.metadata.package_id === identity.packageId
        && product.metadata.app_environment === identity.appEnvironment
        && (!product.metadata.package_key || product.metadata.package_key === identity.packageKey);
}

async function listCatalogProducts(
    stripe: CatalogV2StripeClient,
    identity: CatalogStripeIdentity,
): Promise<Stripe.Product[]> {
    const matches: Stripe.Product[] = [];
    let startingAfter: string | undefined;

    for (let page = 0; page < MAX_PAGES; page += 1) {
        const result = await stripe.products.list({
            active: true,
            limit: PAGE_LIMIT,
            ...(startingAfter ? { starting_after: startingAfter } : {}),
        });
        matches.push(...result.data.filter((candidate) => productMatchesIdentity(candidate, identity)));
        if (!result.has_more || result.data.length === 0) return matches;
        startingAfter = result.data[result.data.length - 1]?.id;
    }

    throw new Error('Stripe Product recovery exceeded the bounded catalogue scan');
}

export async function ensureCatalogStripeProduct(input: {
    stripe: CatalogV2StripeClient;
    identity: CatalogStripeIdentity;
    displayName: CatalogV2LocalizedText;
    existingProductId: string | null;
    targetCatalogVersion: number;
}): Promise<Stripe.Product> {
    const { stripe, identity } = input;
    const metadata = {
        app_environment: identity.appEnvironment,
        catalog_generation: 'v2',
        current_catalog_version: String(input.targetCatalogVersion),
        package_id: identity.packageId,
        package_key: identity.packageKey,
    };
    const name = productName(input.displayName, identity.packageKey);

    let product: Stripe.Product | null = null;
    if (input.existingProductId) {
        try {
            const retrieved = await stripe.products.retrieve(input.existingProductId);
            if (!retrieved.deleted) product = retrieved;
        } catch (error) {
            if (!isMissingStripeResource(error)) throw error;
        }
    }

    if (product && !productMatchesIdentity(product, identity)) {
        throw new Error('Existing Stripe Product is bound to a different catalogue');
    }
    if (!product) {
        const recovered = await listCatalogProducts(stripe, identity);
        if (recovered.length > 1) {
            throw new Error('Multiple Stripe Products are bound to the same catalogue identity');
        }
        product = recovered[0] ?? null;
    }

    if (!product) {
        product = await stripe.products.create({ name, active: true, metadata }, {
            idempotencyKey: `catalog-v2:product:${identity.appEnvironment}:${identity.packageId}`,
        });
    } else if (
        !product.active
        || product.name !== name
        || Object.entries(metadata).some(([key, value]) => product?.metadata[key] !== value)
    ) {
        product = await stripe.products.update(product.id, { name, active: true, metadata });
    }

    if (!productMatchesIdentity(product, identity) || !product.active || product.name !== name) {
        throw new Error('Stripe Product does not match the catalogue after persistence');
    }
    return product;
}

function priceMetadata(input: CatalogPriceInput, role: 'initial' | 'recurring') {
    return {
        app_environment: input.appEnvironment,
        billing_role: role,
        catalog_draft_id: input.draftId,
        catalog_draft_revision: String(input.draftRevision),
        catalog_generation: 'v2',
        catalog_version: String(input.catalogVersion),
        package_id: input.packageId,
        package_key: input.packageKey,
    };
}

function priceMatches(
    price: Stripe.Price,
    input: CatalogPriceInput,
    role: 'initial' | 'recurring',
): boolean {
    const productId = typeof price.product === 'string' ? price.product : price.product.id;
    const recurringMatches = role === 'initial'
        ? price.type === 'one_time' && price.recurring === null
        : price.type === 'recurring'
            && price.recurring?.interval === input.billingIntervalUnit
            && price.recurring.interval_count === input.billingIntervalCount;
    const metadata = priceMetadata(input, role);

    return price.active
        && price.livemode === input.livemode
        && productId === input.productId
        && price.unit_amount === input.amountCents
        && price.currency === input.currency
        && recurringMatches
        && Object.entries(metadata).every(([key, value]) => price.metadata[key] === value);
}

async function listCatalogPrices(
    stripe: CatalogV2StripeClient,
    input: CatalogPriceInput,
): Promise<Stripe.Price[]> {
    const prices: Stripe.Price[] = [];
    let startingAfter: string | undefined;

    for (let page = 0; page < MAX_PAGES; page += 1) {
        const result = await stripe.prices.list({
            active: true,
            product: input.productId,
            limit: PAGE_LIMIT,
            ...(startingAfter ? { starting_after: startingAfter } : {}),
        });
        prices.push(...result.data);
        if (!result.has_more || result.data.length === 0) return prices;
        startingAfter = result.data[result.data.length - 1]?.id;
    }

    throw new Error('Stripe Price recovery exceeded the bounded catalogue scan');
}

async function ensurePrice(
    stripe: CatalogV2StripeClient,
    input: CatalogPriceInput,
    role: 'initial' | 'recurring',
    candidates: Stripe.Price[],
): Promise<Stripe.Price> {
    const matches = candidates.filter((candidate) => priceMatches(candidate, input, role));
    if (matches.length > 1) {
        throw new Error(`Multiple Stripe ${role} Prices match the same catalogue draft`);
    }
    if (matches[0]) return matches[0];

    const created = await stripe.prices.create({
        product: input.productId,
        currency: input.currency,
        unit_amount: input.amountCents,
        ...(role === 'recurring'
            ? {
                recurring: {
                    interval: input.billingIntervalUnit,
                    interval_count: input.billingIntervalCount,
                },
            }
            : {}),
        metadata: priceMetadata(input, role),
    }, {
        idempotencyKey: [
            'catalog-v2',
            'price',
            input.appEnvironment,
            input.draftId,
            `r${input.draftRevision}`,
            role,
        ].join(':'),
    });
    const persisted = await stripe.prices.retrieve(created.id);
    if (!priceMatches(persisted, input, role)) {
        throw new Error(`Stripe ${role} Price does not match the catalogue after persistence`);
    }
    return persisted;
}

export async function ensureCatalogStripePricePair(
    stripe: CatalogV2StripeClient,
    input: CatalogPriceInput,
): Promise<CatalogPricePair> {
    const candidates = await listCatalogPrices(stripe, input);
    const initial = await ensurePrice(stripe, input, 'initial', candidates);
    const recurring = await ensurePrice(stripe, input, 'recurring', candidates);

    if (initial.id === recurring.id) {
        throw new Error('Stripe initial and recurring Prices must be distinct');
    }
    return { initial, recurring };
}

export async function archiveCatalogStripeResources(input: {
    stripe: CatalogV2StripeClient;
    priceIds: Iterable<string>;
    productId?: string | null;
    retireProduct?: boolean;
}): Promise<string[]> {
    const warnings: string[] = [];
    for (const priceId of new Set(input.priceIds)) {
        try {
            await input.stripe.prices.update(priceId, { active: false });
        } catch {
            warnings.push(`price:${priceId.slice(0, 12)}`);
        }
    }

    if (input.retireProduct && input.productId) {
        try {
            await input.stripe.products.update(input.productId, { active: false });
        } catch {
            warnings.push(`product:${input.productId.slice(0, 12)}`);
        }
    }
    return warnings;
}
