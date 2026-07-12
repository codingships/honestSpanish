-- Prevent exact duplicate and partially overlapping recurring availability
-- blocks at the database boundary. The exclusion constraint is evaluated in
-- the insert transaction, so concurrent requests cannot both succeed.
CREATE EXTENSION IF NOT EXISTS btree_gist;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM public.teacher_availability AS first_slot
        JOIN public.teacher_availability AS second_slot
          ON first_slot.teacher_id = second_slot.teacher_id
         AND first_slot.day_of_week = second_slot.day_of_week
         AND first_slot.id < second_slot.id
         AND first_slot.start_time < second_slot.end_time
         AND second_slot.start_time < first_slot.end_time
        WHERE first_slot.is_active = TRUE
          AND second_slot.is_active = TRUE
    ) THEN
        RAISE EXCEPTION USING
            ERRCODE = '23514',
            MESSAGE = 'Cannot add teacher availability overlap constraint: active overlaps exist';
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'teacher_availability_no_active_overlap'
          AND conrelid = 'public.teacher_availability'::regclass
    ) THEN
        ALTER TABLE public.teacher_availability
            ADD CONSTRAINT teacher_availability_no_active_overlap
            EXCLUDE USING gist (
                teacher_id WITH =,
                day_of_week WITH =,
                (numrange(
                    EXTRACT(EPOCH FROM start_time),
                    EXTRACT(EPOCH FROM end_time),
                    '[)'
                )) WITH &&
            )
            WHERE (is_active = TRUE);
    END IF;
END $$;

-- The original constraint also covered inactive history and prevented a slot
-- from being re-created after a soft delete. The exclusion constraint above
-- now provides the stricter, correctly scoped invariant.
ALTER TABLE public.teacher_availability
    DROP CONSTRAINT IF EXISTS teacher_availability_teacher_id_day_of_week_start_time_key;

DROP TRIGGER IF EXISTS update_teacher_availability_updated_at
    ON public.teacher_availability;
CREATE TRIGGER update_teacher_availability_updated_at
    BEFORE UPDATE ON public.teacher_availability
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- Restore operational indexes from the historical schema and cover every
-- currently unindexed foreign key reported for the release-candidate model.
CREATE INDEX IF NOT EXISTS idx_teacher_availability_teacher
    ON public.teacher_availability(teacher_id);
CREATE INDEX IF NOT EXISTS idx_teacher_availability_day
    ON public.teacher_availability(day_of_week);
CREATE INDEX IF NOT EXISTS idx_sessions_status
    ON public.sessions(status);
CREATE INDEX IF NOT EXISTS payments_stripe_payment_intent_idx
    ON public.payments(stripe_payment_intent_id)
    WHERE stripe_payment_intent_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS checkout_intents_contact_idx
    ON public.checkout_intents(contact_id);
CREATE INDEX IF NOT EXISTS idx_fulfillment_jobs_student
    ON public.fulfillment_jobs(student_id);
CREATE INDEX IF NOT EXISTS idx_fulfillment_jobs_subscription
    ON public.fulfillment_jobs(subscription_id);
CREATE INDEX IF NOT EXISTS package_prices_created_by_idx
    ON public.package_prices(created_by);
CREATE INDEX IF NOT EXISTS payments_subscription_idx
    ON public.payments(subscription_id);
CREATE INDEX IF NOT EXISTS sessions_cancelled_by_idx
    ON public.sessions(cancelled_by);
CREATE INDEX IF NOT EXISTS sessions_subscription_idx
    ON public.sessions(subscription_id);
CREATE INDEX IF NOT EXISTS student_teachers_teacher_idx
    ON public.student_teachers(teacher_id);
CREATE INDEX IF NOT EXISTS subscriptions_package_idx
    ON public.subscriptions(package_id);

-- The smoke tables are deliberately staging-only. Keep this migration usable
-- in production by creating their FK indexes only where the table exists.
DO $$
BEGIN
    IF to_regclass('public.staging_integration_smoke_runs') IS NOT NULL THEN
        CREATE INDEX IF NOT EXISTS staging_integration_smoke_runs_student_idx
            ON public.staging_integration_smoke_runs(student_id);
        CREATE INDEX IF NOT EXISTS staging_integration_smoke_runs_teacher_idx
            ON public.staging_integration_smoke_runs(teacher_id);
        CREATE INDEX IF NOT EXISTS staging_integration_smoke_runs_subscription_idx
            ON public.staging_integration_smoke_runs(subscription_id);
        CREATE INDEX IF NOT EXISTS staging_integration_smoke_runs_session_idx
            ON public.staging_integration_smoke_runs(session_id);
        CREATE INDEX IF NOT EXISTS staging_integration_smoke_runs_fulfillment_job_idx
            ON public.staging_integration_smoke_runs(fulfillment_job_id);
        CREATE INDEX IF NOT EXISTS staging_integration_smoke_runs_cancellation_job_idx
            ON public.staging_integration_smoke_runs(cancellation_job_id);
    END IF;
END $$;
