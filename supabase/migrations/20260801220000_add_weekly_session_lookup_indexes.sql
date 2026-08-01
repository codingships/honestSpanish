-- Weekly calendar reads are scoped by owner and ordered inside a Madrid-derived UTC range.
CREATE INDEX IF NOT EXISTS idx_sessions_teacher_scheduled_at
    ON public.sessions (teacher_id, scheduled_at);

CREATE INDEX IF NOT EXISTS idx_sessions_student_scheduled_at
    ON public.sessions (student_id, scheduled_at);
