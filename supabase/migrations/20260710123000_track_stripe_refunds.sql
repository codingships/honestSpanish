ALTER TABLE public.payments
    ADD COLUMN IF NOT EXISTS amount_refunded INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS stripe_refund_id TEXT,
    ADD COLUMN IF NOT EXISTS refunded_at TIMESTAMPTZ;

DO $$
BEGIN
    ALTER TABLE public.payments
        ADD CONSTRAINT payments_amount_refunded_check
        CHECK (amount_refunded >= 0 AND amount_refunded <= amount);
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS payments_stripe_payment_intent_idx
    ON public.payments (stripe_payment_intent_id)
    WHERE stripe_payment_intent_id IS NOT NULL;

COMMENT ON COLUMN public.payments.amount_refunded IS 'Cumulative refunded amount in the payment currency minor unit, synchronized from Stripe.';
COMMENT ON COLUMN public.payments.stripe_refund_id IS 'Most recent Stripe refund identifier observed for this payment.';
COMMENT ON COLUMN public.payments.refunded_at IS 'Timestamp of the most recent refund synchronization.';
