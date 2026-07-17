-- Add DB-level semantic guards for profile relationships used by campus operations.
-- This complements API checks and catches service-role/admin/script writes.

CREATE OR REPLACE FUNCTION private.enforce_profile_role_links()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private, pg_temp
AS $$
DECLARE
    student_role public.user_role;
    teacher_role public.user_role;
BEGIN
    IF TG_TABLE_NAME = 'student_teachers' THEN
        SELECT role INTO student_role FROM public.profiles WHERE id = NEW.student_id;
        IF student_role IS DISTINCT FROM 'student'::public.user_role THEN
            RAISE EXCEPTION 'studentId must belong to a student profile' USING ERRCODE = '23514';
        END IF;

        SELECT role INTO teacher_role FROM public.profiles WHERE id = NEW.teacher_id;
        IF teacher_role IS DISTINCT FROM 'teacher'::public.user_role THEN
            RAISE EXCEPTION 'teacherId must belong to a teacher profile' USING ERRCODE = '23514';
        END IF;

    ELSIF TG_TABLE_NAME = 'sessions' THEN
        SELECT role INTO student_role FROM public.profiles WHERE id = NEW.student_id;
        IF student_role IS DISTINCT FROM 'student'::public.user_role THEN
            RAISE EXCEPTION 'studentId must belong to a student profile' USING ERRCODE = '23514';
        END IF;

        IF NEW.teacher_id IS NOT NULL THEN
            SELECT role INTO teacher_role FROM public.profiles WHERE id = NEW.teacher_id;
            IF teacher_role IS DISTINCT FROM 'teacher'::public.user_role THEN
                RAISE EXCEPTION 'teacherId must belong to a teacher profile' USING ERRCODE = '23514';
            END IF;
        END IF;

    ELSIF TG_TABLE_NAME IN ('subscriptions', 'payments', 'fulfillment_jobs') THEN
        IF NEW.student_id IS NOT NULL THEN
            SELECT role INTO student_role FROM public.profiles WHERE id = NEW.student_id;
            IF student_role IS DISTINCT FROM 'student'::public.user_role THEN
                RAISE EXCEPTION 'studentId must belong to a student profile' USING ERRCODE = '23514';
            END IF;
        END IF;

    ELSIF TG_TABLE_NAME = 'teacher_availability' THEN
        SELECT role INTO teacher_role FROM public.profiles WHERE id = NEW.teacher_id;
        IF teacher_role IS DISTINCT FROM 'teacher'::public.user_role THEN
            RAISE EXCEPTION 'teacherId must belong to a teacher profile' USING ERRCODE = '23514';
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.enforce_profile_role_links() FROM public;
REVOKE ALL ON FUNCTION private.enforce_profile_role_links() FROM anon;
REVOKE ALL ON FUNCTION private.enforce_profile_role_links() FROM authenticated;
GRANT EXECUTE ON FUNCTION private.enforce_profile_role_links() TO service_role;

DROP TRIGGER IF EXISTS enforce_student_teacher_profile_roles ON public.student_teachers;
CREATE TRIGGER enforce_student_teacher_profile_roles
    BEFORE INSERT OR UPDATE OF student_id, teacher_id ON public.student_teachers
    FOR EACH ROW EXECUTE FUNCTION private.enforce_profile_role_links();

DROP TRIGGER IF EXISTS enforce_session_profile_roles ON public.sessions;
CREATE TRIGGER enforce_session_profile_roles
    BEFORE INSERT OR UPDATE OF student_id, teacher_id ON public.sessions
    FOR EACH ROW EXECUTE FUNCTION private.enforce_profile_role_links();

DROP TRIGGER IF EXISTS enforce_subscription_student_role ON public.subscriptions;
CREATE TRIGGER enforce_subscription_student_role
    BEFORE INSERT OR UPDATE OF student_id ON public.subscriptions
    FOR EACH ROW EXECUTE FUNCTION private.enforce_profile_role_links();

DROP TRIGGER IF EXISTS enforce_payment_student_role ON public.payments;
CREATE TRIGGER enforce_payment_student_role
    BEFORE INSERT OR UPDATE OF student_id ON public.payments
    FOR EACH ROW EXECUTE FUNCTION private.enforce_profile_role_links();

DROP TRIGGER IF EXISTS enforce_fulfillment_job_student_role ON public.fulfillment_jobs;
CREATE TRIGGER enforce_fulfillment_job_student_role
    BEFORE INSERT OR UPDATE OF student_id ON public.fulfillment_jobs
    FOR EACH ROW EXECUTE FUNCTION private.enforce_profile_role_links();

DROP TRIGGER IF EXISTS enforce_teacher_availability_teacher_role ON public.teacher_availability;
CREATE TRIGGER enforce_teacher_availability_teacher_role
    BEFORE INSERT OR UPDATE OF teacher_id ON public.teacher_availability
    FOR EACH ROW EXECUTE FUNCTION private.enforce_profile_role_links();
