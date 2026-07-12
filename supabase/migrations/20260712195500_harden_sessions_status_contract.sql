LOCK TABLE public.sessions IN ACCESS EXCLUSIVE MODE;

DO $migration$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM public.sessions
        WHERE status IS NULL
           OR status NOT IN ('scheduled', 'completed', 'cancelled', 'no_show')
    ) THEN
        RAISE EXCEPTION 'invalid_sessions_status_values';
    END IF;
END
$migration$;

ALTER TABLE public.sessions
    DROP CONSTRAINT IF EXISTS sessions_status_check;

ALTER TABLE public.sessions
    ADD CONSTRAINT sessions_status_check
    CHECK (status IN ('scheduled', 'completed', 'cancelled', 'no_show'));

ALTER TABLE public.sessions
    ALTER COLUMN status SET DEFAULT 'scheduled',
    ALTER COLUMN status SET NOT NULL;
