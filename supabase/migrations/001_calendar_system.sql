-- =============================================
-- CALENDAR SYSTEM MIGRATION
-- =============================================

-- 1. TEACHER AVAILABILITY (horarios recurrentes del profesor)
CREATE TABLE IF NOT EXISTS teacher_availability (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    teacher_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    day_of_week INTEGER NOT NULL CHECK (day_of_week BETWEEN 0 AND 6), -- 0=Domingo, 1=Lunes...
    start_time TIME NOT NULL,
    end_time TIME NOT NULL,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT valid_time_range CHECK (start_time < end_time),
    UNIQUE(teacher_id, day_of_week, start_time) -- Evitar duplicados
);

-- 2. ALTERACIONES A SESSIONS (añadir campos faltantes)
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS cancelled_by UUID REFERENCES profiles(id);
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS cancellation_reason TEXT;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;

-- 3. ÍNDICES
CREATE INDEX IF NOT EXISTS idx_teacher_availability_teacher ON teacher_availability(teacher_id);
CREATE INDEX IF NOT EXISTS idx_teacher_availability_day ON teacher_availability(day_of_week);
CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status);
CREATE INDEX IF NOT EXISTS idx_sessions_scheduled ON sessions(scheduled_at);

-- 4. RLS POLICIES PARA teacher_availability
ALTER TABLE teacher_availability ENABLE ROW LEVEL SECURITY;

-- Profesores pueden ver y gestionar su propia disponibilidad
CREATE POLICY "Teachers can manage own availability"
    ON teacher_availability FOR ALL
    USING (teacher_id = auth.uid());

-- Estudiantes pueden ver disponibilidad de sus profesores asignados
CREATE POLICY "Students can view assigned teacher availability"
    ON teacher_availability FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM student_teachers st
            WHERE st.student_id = auth.uid()
            AND st.teacher_id = teacher_availability.teacher_id
        )
    );

-- Admins pueden gestionar toda la disponibilidad
CREATE POLICY "Admins can manage all availability"
    ON teacher_availability FOR ALL
    USING (
        EXISTS (
            SELECT 1 FROM profiles
            WHERE id = auth.uid() AND role = 'admin'
        )
    );

-- 5. TRIGGER para updated_at
CREATE TRIGGER update_teacher_availability_updated_at
    BEFORE UPDATE ON teacher_availability
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- 6. FUNCIÓN para obtener slots disponibles de un profesor en una fecha
CREATE OR REPLACE FUNCTION get_available_slots(
    p_teacher_id UUID,
    p_date DATE,
    p_duration_minutes INTEGER DEFAULT 60
)
RETURNS TABLE (
    slot_start TIMESTAMPTZ,
    slot_end TIMESTAMPTZ
) AS $$
DECLARE
    v_day_of_week INTEGER;
    v_timezone TEXT := 'Europe/Madrid';
BEGIN
    v_day_of_week := EXTRACT(DOW FROM p_date);
    
    RETURN QUERY
    WITH availability_slots AS (
        -- Obtener bloques de disponibilidad para ese día
        SELECT 
            (p_date + ta.start_time) AT TIME ZONE v_timezone AS block_start,
            (p_date + ta.end_time) AT TIME ZONE v_timezone AS block_end
        FROM teacher_availability ta
        WHERE ta.teacher_id = p_teacher_id
        AND ta.day_of_week = v_day_of_week
        AND ta.is_active = TRUE
    ),
    existing_sessions AS (
        -- Obtener sesiones ya programadas ese día
        SELECT 
            s.scheduled_at AS session_start,
            s.scheduled_at + (s.duration_minutes || ' minutes')::INTERVAL AS session_end
        FROM sessions s
        WHERE s.teacher_id = p_teacher_id
        AND DATE(s.scheduled_at AT TIME ZONE v_timezone) = p_date
        AND s.status NOT IN ('cancelled')
    ),
    time_slots AS (
        -- Generar slots de 1 hora dentro de cada bloque
        SELECT 
            generate_series(
                a.block_start,
                a.block_end - (p_duration_minutes || ' minutes')::INTERVAL,
                (p_duration_minutes || ' minutes')::INTERVAL
            ) AS slot_start
        FROM availability_slots a
    )
    SELECT 
        ts.slot_start,
        ts.slot_start + (p_duration_minutes || ' minutes')::INTERVAL AS slot_end
    FROM time_slots ts
    WHERE NOT EXISTS (
        -- Excluir slots que se solapan con sesiones existentes
        SELECT 1 FROM existing_sessions es
        WHERE ts.slot_start < es.session_end
        AND ts.slot_start + (p_duration_minutes || ' minutes')::INTERVAL > es.session_start
    )
    ORDER BY ts.slot_start;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
