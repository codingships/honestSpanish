import { describe, expect, it } from 'vitest';
import {
    assessBillingPackagePriceLinks,
    assessProcessedAtPosture,
} from '../../scripts/launch/supabase-production-rollout-evidence';

describe('Supabase production rollout aggregate evidence', () => {
    describe('processed_at posture', () => {
        it('fails closed when the aggregate is missing or incomplete', () => {
            expect(assessProcessedAtPosture(undefined)).toMatchObject({
                complete: false,
                readyForFix: false,
                alreadyClosed: false,
                columnDefault: null,
                summary: 'missing processed_at_posture evidence',
            });

            expect(assessProcessedAtPosture({
                column_default: 'now()',
                total: 184,
                invalid_status: 0,
                processing_with_processed_at: 0,
            })).toMatchObject({
                complete: false,
                readyForFix: false,
                alreadyClosed: false,
            });
            expect(assessProcessedAtPosture({
                column_default: 'unexpected default',
                total: 184,
                invalid_status: 0,
                null_status: 0,
                processing_with_processed_at: 0,
            }).summary).toContain('incomplete processed_at_posture evidence');
        });

        it('distinguishes the exact ready and already-closed defaults', () => {
            expect(assessProcessedAtPosture(processedAtPosture('now()'))).toMatchObject({
                complete: true,
                readyForFix: true,
                alreadyClosed: false,
                columnDefault: 'now()',
                errors: [],
            });
            expect(assessProcessedAtPosture(processedAtPosture('<NULL>'))).toMatchObject({
                complete: true,
                readyForFix: false,
                alreadyClosed: true,
                columnDefault: '<NULL>',
                errors: [],
            });
        });

        it.each([
            'invalid_status',
            'null_status',
            'processing_with_processed_at',
        ] as const)('blocks when %s is nonzero', (field) => {
            const posture = processedAtPosture('now()');
            posture[field] = 1;
            expect(assessProcessedAtPosture(posture)).toMatchObject({
                complete: true,
                readyForFix: false,
                alreadyClosed: false,
            });
            expect(assessProcessedAtPosture(posture).summary).toContain('unsafe processed_at_posture evidence');
        });

        it('rejects negative, nonnumeric and extra count evidence', () => {
            for (const posture of [
                { ...processedAtPosture('now()'), total: -1 },
                { ...processedAtPosture('now()'), null_status: '0' },
                { ...processedAtPosture('now()'), extra_count: 0 },
            ]) {
                expect(assessProcessedAtPosture(posture)).toMatchObject({
                    complete: false,
                    readyForFix: false,
                    alreadyClosed: false,
                });
            }
        });
    });

    describe('billing package-price links', () => {
        it('fails closed when the aggregate is missing or incomplete', () => {
            expect(assessBillingPackagePriceLinks(undefined, billingContext())).toMatchObject({
                complete: false,
                ready: false,
                columnPresent: null,
                stripeLinkedWithoutPackagePrice: null,
                summary: 'missing billing_package_price_links evidence',
            });
            expect(assessBillingPackagePriceLinks({
                stripe_linked_without_package_price: 0,
                all_subscriptions_without_package_price: 0,
            }, billingContext())).toMatchObject({ complete: false, ready: false });
            expect(assessBillingPackagePriceLinks({
                column_present: false,
                stripe_linked_without_package_price: 0,
            }, billingContext()).summary).toContain('incomplete billing_package_price_links evidence');
        });

        it('requires complete explicit evidence before zero can be ready', () => {
            expect(assessBillingPackagePriceLinks({
                column_present: true,
                stripe_linked_without_package_price: 0,
                all_subscriptions_without_package_price: 0,
            }, billingContext())).toMatchObject({
                complete: true,
                ready: true,
                columnPresent: true,
                stripeLinkedWithoutPackagePrice: 0,
                allSubscriptionsWithoutPackagePrice: 0,
                errors: [],
            });
        });

        it('fails closed when the package-price aggregate contradicts billing totals', () => {
            expect(assessBillingPackagePriceLinks({
                column_present: false,
                stripe_linked_without_package_price: 0,
                all_subscriptions_without_package_price: 84,
            }, billingContext())).toMatchObject({
                complete: false,
                ready: false,
            });
            expect(assessBillingPackagePriceLinks({
                column_present: false,
                stripe_linked_without_package_price: 27,
                all_subscriptions_without_package_price: 84,
            }, undefined)).toMatchObject({
                complete: false,
                ready: false,
            });
        });

        it('blocks nonzero links and rejects impossible or malformed counts', () => {
            expect(assessBillingPackagePriceLinks({
                column_present: false,
                stripe_linked_without_package_price: 27,
                all_subscriptions_without_package_price: 84,
            }, billingContext())).toMatchObject({ complete: true, ready: false });

            for (const evidence of [
                {
                    column_present: false,
                    stripe_linked_without_package_price: 85,
                    all_subscriptions_without_package_price: 84,
                },
                {
                    column_present: 'false',
                    stripe_linked_without_package_price: 0,
                    all_subscriptions_without_package_price: 84,
                },
                {
                    column_present: false,
                    stripe_linked_without_package_price: -1,
                    all_subscriptions_without_package_price: 84,
                },
                {
                    column_present: false,
                    stripe_linked_without_package_price: 0,
                    all_subscriptions_without_package_price: 84,
                    customer_email: 'private@example.test',
                },
            ]) {
                expect(assessBillingPackagePriceLinks(evidence, billingContext())).toMatchObject({
                    complete: false,
                    ready: false,
                });
            }
        });
    });
});

function processedAtPosture(columnDefault: 'now()' | '<NULL>') {
    return {
        column_default: columnDefault,
        total: 184,
        invalid_status: 0,
        null_status: 0,
        processing_with_processed_at: 0,
    };
}

function billingContext() {
    return { total_subscriptions: 84, stripe_linked: 27 };
}
