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
