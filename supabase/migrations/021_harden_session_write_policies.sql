-- Harden sessions write paths.
-- Direct student/teacher Data API writes bypass application checks for quota,
-- availability, cancellation windows, state transitions and fulfillment side effects.
-- Server API routes perform those checks and then write with service-role.

DROP POLICY IF EXISTS "Students can cancel own sessions" ON sessions;
DROP POLICY IF EXISTS "Teachers can create assigned sessions" ON sessions;
DROP POLICY IF EXISTS "Teachers can update assigned sessions" ON sessions;
DROP POLICY IF EXISTS "Teachers can view and update assigned sessions" ON sessions;

DROP POLICY IF EXISTS "Teachers can view assigned sessions" ON sessions;
CREATE POLICY "Teachers can view assigned sessions"
    ON sessions FOR SELECT
    USING (teacher_id = auth.uid());
