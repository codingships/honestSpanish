-- =============================================
-- ESPAÑOL HONESTO - RLS SECURITY PATCH
-- =============================================
-- Soluciona permisos faltantes y cierra brechas (IDOR) en la base de datos viva.

-- 1. PROFILES: Permitir a los alumnos leer el perfil de los profesores que tienen asignados.
-- Sin esta política, un alumno no puede ver el nombre "Alejandro" en su interfaz web.
CREATE POLICY "Students can view their teachers" 
    ON profiles FOR SELECT 
    USING (
        EXISTS (
            SELECT 1 FROM student_teachers st 
            WHERE st.student_id = auth.uid() 
            AND st.teacher_id = profiles.id
        )
    );

-- 2. SESSIONS: Bloquear a los profesores para que no puedan agendar clases a alumnos que NO son suyos.
-- Borramos la política antigua demasiado permisiva
DROP POLICY IF EXISTS "Teachers can view and update assigned sessions" ON sessions;

-- Creamos la nueva política restrictiva:
-- USING: Solo pueden ver/borrar sesiones donde ellos son el profesor.
-- WITH CHECK: Solo pueden crear/actualizar sesiones si el student_id pertenece a su lista de alumnos asignados.
CREATE POLICY "Teachers can view and update assigned sessions" 
    ON sessions FOR ALL 
    USING (teacher_id = auth.uid())
    WITH CHECK (
        teacher_id = auth.uid() AND
        EXISTS (
            SELECT 1 FROM student_teachers st 
            WHERE st.teacher_id = auth.uid() 
            AND st.student_id = sessions.student_id
        )
    );
