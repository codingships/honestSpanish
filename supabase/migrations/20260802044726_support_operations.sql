-- Make support a first-class, auditable operation without exposing internal notes.

ALTER TABLE public.support_tickets
    ADD COLUMN priority TEXT NOT NULL DEFAULT 'normal'
        CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
    ADD COLUMN assigned_admin_id UUID
        REFERENCES public.profiles(id) ON DELETE SET NULL;

UPDATE public.support_tickets
SET created_at = COALESCE(created_at, date_trunc('second', clock_timestamp())),
    updated_at = COALESCE(updated_at, created_at, date_trunc('second', clock_timestamp()))
WHERE created_at IS NULL OR updated_at IS NULL;

ALTER TABLE public.support_tickets
    ALTER COLUMN created_at SET DEFAULT NOW(),
    ALTER COLUMN created_at SET NOT NULL,
    ALTER COLUMN updated_at SET DEFAULT NOW(),
    ALTER COLUMN updated_at SET NOT NULL;

CREATE OR REPLACE FUNCTION private.set_support_ticket_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
    NEW.updated_at := GREATEST(
        pg_catalog.clock_timestamp(),
        OLD.updated_at + INTERVAL '1 microsecond'
    );
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS update_support_tickets_updated_at ON public.support_tickets;
CREATE TRIGGER update_support_tickets_updated_at
    BEFORE UPDATE ON public.support_tickets
    FOR EACH ROW EXECUTE FUNCTION private.set_support_ticket_updated_at();

CREATE INDEX support_tickets_admin_queue_idx
    ON public.support_tickets(status, priority, updated_at DESC, id);
CREATE INDEX support_tickets_assignee_queue_idx
    ON public.support_tickets(assigned_admin_id, status, updated_at DESC, id);

CREATE TABLE public.support_ticket_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ticket_id UUID NOT NULL REFERENCES public.support_tickets(id) ON DELETE CASCADE,
    sequence BIGINT NOT NULL CHECK (sequence > 0),
    actor_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    event_type TEXT NOT NULL CHECK (
        event_type IN ('created', 'internal_note', 'public_reply', 'admin_update')
    ),
    visibility TEXT NOT NULL CHECK (visibility IN ('internal', 'public')),
    body TEXT CHECK (body IS NULL OR char_length(btrim(body)) BETWEEN 1 AND 4000),
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT date_trunc('second', clock_timestamp()),
    CONSTRAINT support_ticket_event_body_contract CHECK (
        (event_type IN ('created', 'internal_note', 'public_reply') AND body IS NOT NULL)
        OR (event_type = 'admin_update' AND body IS NULL)
    ),
    CONSTRAINT support_ticket_event_visibility_contract CHECK (
        (event_type IN ('created', 'public_reply') AND visibility = 'public')
        OR (event_type IN ('internal_note', 'admin_update') AND visibility = 'internal')
    )
);

CREATE UNIQUE INDEX support_ticket_events_sequence_idx
    ON public.support_ticket_events(ticket_id, sequence);

CREATE UNIQUE INDEX support_ticket_events_one_created_idx
    ON public.support_ticket_events(ticket_id)
    WHERE event_type = 'created';

CREATE TABLE public.support_ticket_operations (
    request_id UUID PRIMARY KEY,
    ticket_id UUID NOT NULL REFERENCES public.support_tickets(id) ON DELETE CASCADE,
    admin_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    expected_status TEXT NOT NULL CHECK (expected_status IN ('open', 'triaged', 'closed')),
    expected_updated_at TIMESTAMPTZ NOT NULL,
    requested_status TEXT CHECK (requested_status IN ('open', 'triaged', 'closed')),
    requested_priority TEXT CHECK (requested_priority IN ('low', 'normal', 'high', 'urgent')),
    assignment_is_set BOOLEAN NOT NULL,
    requested_assigned_admin_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    message_kind TEXT CHECK (message_kind IN ('internal_note', 'public_reply')),
    message_body TEXT CHECK (
        message_body IS NULL OR char_length(btrim(message_body)) BETWEEN 1 AND 4000
    ),
    result JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT date_trunc('second', clock_timestamp()),
    CONSTRAINT support_ticket_operation_message_contract CHECK (
        (message_kind IS NULL AND message_body IS NULL)
        OR (message_kind IS NOT NULL AND message_body IS NOT NULL)
    )
);

CREATE INDEX support_ticket_operations_ticket_idx
    ON public.support_ticket_operations(ticket_id, created_at DESC);

ALTER TABLE public.support_ticket_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.support_ticket_operations ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION private.guard_support_ticket_event_history()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF TG_OP = 'DELETE'
       AND NOT EXISTS (
            SELECT 1 FROM public.support_tickets AS ticket
            WHERE ticket.id = OLD.ticket_id
       ) THEN
        RETURN OLD;
    END IF;

    IF TG_OP = 'UPDATE'
       AND OLD.actor_id IS NOT NULL
       AND NEW.actor_id IS NULL
       AND (to_jsonb(NEW) - 'actor_id') = (to_jsonb(OLD) - 'actor_id')
       AND NOT EXISTS (
            SELECT 1 FROM public.profiles AS actor
            WHERE actor.id = OLD.actor_id
       ) THEN
        RETURN NEW;
    END IF;

    RAISE EXCEPTION 'support_ticket_history_is_immutable'
        USING ERRCODE = '23514';
END;
$$;

CREATE OR REPLACE FUNCTION private.guard_support_ticket_operation_history()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    admin_was_anonymized BOOLEAN := FALSE;
    assignee_was_anonymized BOOLEAN := FALSE;
BEGIN
    IF TG_OP = 'DELETE'
       AND NOT EXISTS (
            SELECT 1 FROM public.support_tickets AS ticket
            WHERE ticket.id = OLD.ticket_id
       ) THEN
        RETURN OLD;
    END IF;

    IF TG_OP = 'UPDATE' THEN
        admin_was_anonymized := OLD.admin_id IS NOT NULL AND NEW.admin_id IS NULL;
        assignee_was_anonymized := OLD.requested_assigned_admin_id IS NOT NULL
            AND NEW.requested_assigned_admin_id IS NULL;

        IF (admin_was_anonymized OR assignee_was_anonymized)
           AND (NEW.admin_id IS NOT DISTINCT FROM OLD.admin_id OR admin_was_anonymized)
           AND (
                NEW.requested_assigned_admin_id IS NOT DISTINCT FROM OLD.requested_assigned_admin_id
                OR assignee_was_anonymized
           )
           AND (to_jsonb(NEW) - ARRAY['admin_id', 'requested_assigned_admin_id'])
                = (to_jsonb(OLD) - ARRAY['admin_id', 'requested_assigned_admin_id'])
           AND (
                NOT admin_was_anonymized
                OR NOT EXISTS (
                    SELECT 1 FROM public.profiles AS actor
                    WHERE actor.id = OLD.admin_id
                )
           )
           AND (
                NOT assignee_was_anonymized
                OR NOT EXISTS (
                    SELECT 1 FROM public.profiles AS assignee
                    WHERE assignee.id = OLD.requested_assigned_admin_id
                )
           ) THEN
            RETURN NEW;
        END IF;
    END IF;

    RAISE EXCEPTION 'support_ticket_history_is_immutable'
        USING ERRCODE = '23514';
END;
$$;

CREATE TRIGGER guard_support_ticket_events_immutability
    BEFORE UPDATE OR DELETE ON public.support_ticket_events
    FOR EACH ROW EXECUTE FUNCTION private.guard_support_ticket_event_history();

CREATE TRIGGER guard_support_ticket_operations_immutability
    BEFORE UPDATE OR DELETE ON public.support_ticket_operations
    FOR EACH ROW EXECUTE FUNCTION private.guard_support_ticket_operation_history();

CREATE OR REPLACE FUNCTION private.record_support_ticket_creation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    INSERT INTO public.support_ticket_events (
        ticket_id, sequence, actor_id, event_type, visibility, body, metadata, created_at
    ) VALUES (
        NEW.id,
        1,
        NEW.user_id,
        'created',
        'public',
        NEW.message,
        pg_catalog.jsonb_build_object(
            'issue_type', NEW.issue_type,
            'issue_title', NEW.issue_title
        ),
        COALESCE(NEW.created_at, date_trunc('second', clock_timestamp()))
    );
    RETURN NEW;
END;
$$;

CREATE TRIGGER record_support_ticket_creation_trigger
    AFTER INSERT ON public.support_tickets
    FOR EACH ROW EXECUTE FUNCTION private.record_support_ticket_creation();

INSERT INTO public.support_ticket_events (
    ticket_id, sequence, actor_id, event_type, visibility, body, metadata, created_at
)
SELECT
    ticket.id,
    1,
    ticket.user_id,
    'created',
    'public',
    ticket.message,
    pg_catalog.jsonb_build_object(
        'issue_type', ticket.issue_type,
        'issue_title', ticket.issue_title,
        'backfilled', TRUE
    ),
    COALESCE(ticket.created_at, date_trunc('second', clock_timestamp()))
FROM public.support_tickets AS ticket
WHERE NOT EXISTS (
    SELECT 1
    FROM public.support_ticket_events AS event
    WHERE event.ticket_id = ticket.id
      AND event.event_type = 'created'
);

INSERT INTO public.support_ticket_events (
    ticket_id, sequence, actor_id, event_type, visibility, body, metadata, created_at
)
SELECT
    ticket.id,
    2,
    NULL,
    'internal_note',
    'internal',
    btrim(ticket.admin_notes),
    pg_catalog.jsonb_build_object('legacy_admin_notes_backfill', TRUE),
    COALESCE(ticket.updated_at, ticket.created_at, date_trunc('second', clock_timestamp()))
FROM public.support_tickets AS ticket
WHERE NULLIF(btrim(ticket.admin_notes), '') IS NOT NULL;

CREATE OR REPLACE FUNCTION public.admin_mutate_support_ticket(
    p_request_id UUID,
    p_ticket_id UUID,
    p_admin_id UUID,
    p_expected_status TEXT,
    p_expected_updated_at TIMESTAMPTZ,
    p_new_status TEXT DEFAULT NULL,
    p_new_priority TEXT DEFAULT NULL,
    p_assignment_is_set BOOLEAN DEFAULT FALSE,
    p_assigned_admin_id UUID DEFAULT NULL,
    p_message_kind TEXT DEFAULT NULL,
    p_message_body TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    existing_operation public.support_ticket_operations%ROWTYPE;
    ticket_before public.support_tickets%ROWTYPE;
    ticket_after public.support_tickets%ROWTYPE;
    event_row public.support_ticket_events%ROWTYPE;
    normalized_body TEXT := NULLIF(btrim(p_message_body), '');
    target_status TEXT;
    target_priority TEXT;
    target_assignee UUID;
    event_type TEXT;
    event_visibility TEXT;
    event_body TEXT;
    next_event_sequence BIGINT;
    operation_result JSONB;
BEGIN
    IF p_request_id IS NULL OR p_ticket_id IS NULL OR p_admin_id IS NULL
       OR p_expected_updated_at IS NULL THEN
        RAISE EXCEPTION 'support_ticket_required_identifier_missing'
            USING ERRCODE = '22023';
    END IF;

    IF p_expected_status IS NULL
       OR p_expected_status NOT IN ('open', 'triaged', 'closed')
       OR (p_new_status IS NOT NULL AND p_new_status NOT IN ('open', 'triaged', 'closed'))
       OR (p_new_priority IS NOT NULL AND p_new_priority NOT IN ('low', 'normal', 'high', 'urgent'))
       OR (NOT p_assignment_is_set AND p_assigned_admin_id IS NOT NULL)
       OR (p_message_kind IS NOT NULL AND p_message_kind NOT IN ('internal_note', 'public_reply'))
       OR ((p_message_kind IS NULL) IS DISTINCT FROM (normalized_body IS NULL))
       OR (normalized_body IS NOT NULL AND char_length(normalized_body) > 4000) THEN
        RAISE EXCEPTION 'support_ticket_mutation_is_invalid'
            USING ERRCODE = '22023';
    END IF;

    PERFORM pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(p_request_id::TEXT, 58171)
    );

    SELECT * INTO existing_operation
    FROM public.support_ticket_operations AS operation
    WHERE operation.request_id = p_request_id;

    IF existing_operation.request_id IS NOT NULL THEN
        IF existing_operation.ticket_id IS DISTINCT FROM p_ticket_id
           OR existing_operation.admin_id IS DISTINCT FROM p_admin_id
           OR existing_operation.expected_status IS DISTINCT FROM p_expected_status
           OR existing_operation.expected_updated_at IS DISTINCT FROM p_expected_updated_at
           OR existing_operation.requested_status IS DISTINCT FROM p_new_status
           OR existing_operation.requested_priority IS DISTINCT FROM p_new_priority
           OR existing_operation.assignment_is_set IS DISTINCT FROM p_assignment_is_set
           OR existing_operation.requested_assigned_admin_id IS DISTINCT FROM p_assigned_admin_id
           OR existing_operation.message_kind IS DISTINCT FROM p_message_kind
           OR existing_operation.message_body IS DISTINCT FROM normalized_body THEN
            RAISE EXCEPTION 'support_ticket_request_id_conflicts'
                USING ERRCODE = '23505';
        END IF;

        RETURN existing_operation.result || pg_catalog.jsonb_build_object('replayed', TRUE);
    END IF;

    PERFORM 1 FROM public.profiles AS actor
    WHERE actor.id = p_admin_id AND actor.role = 'admin'
    FOR SHARE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'support_ticket_actor_is_not_admin'
            USING ERRCODE = '42501';
    END IF;

    IF p_assignment_is_set AND p_assigned_admin_id IS NOT NULL THEN
        PERFORM 1 FROM public.profiles AS assignee
        WHERE assignee.id = p_assigned_admin_id AND assignee.role = 'admin'
        FOR SHARE;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'support_ticket_assignee_is_not_admin'
                USING ERRCODE = '23514';
        END IF;
    END IF;

    SELECT * INTO ticket_before
    FROM public.support_tickets AS ticket
    WHERE ticket.id = p_ticket_id
    FOR UPDATE;

    IF ticket_before.id IS NULL THEN
        RAISE EXCEPTION 'support_ticket_not_found'
            USING ERRCODE = 'P0002';
    END IF;

    IF ticket_before.status IS DISTINCT FROM p_expected_status
       OR ticket_before.updated_at IS DISTINCT FROM p_expected_updated_at THEN
        RAISE EXCEPTION 'support_ticket_state_conflict'
            USING ERRCODE = '40001';
    END IF;

    target_status := COALESCE(p_new_status, ticket_before.status);
    target_priority := COALESCE(p_new_priority, ticket_before.priority);
    target_assignee := CASE
        WHEN p_assignment_is_set THEN p_assigned_admin_id
        ELSE ticket_before.assigned_admin_id
    END;

    IF target_status IS NOT DISTINCT FROM ticket_before.status
       AND target_priority IS NOT DISTINCT FROM ticket_before.priority
       AND target_assignee IS NOT DISTINCT FROM ticket_before.assigned_admin_id
       AND normalized_body IS NULL THEN
        RAISE EXCEPTION 'support_ticket_mutation_has_no_effect'
            USING ERRCODE = '22023';
    END IF;

    UPDATE public.support_tickets
    SET status = target_status,
        priority = target_priority,
        assigned_admin_id = target_assignee
    WHERE id = p_ticket_id
      AND status = p_expected_status
      AND updated_at = p_expected_updated_at
    RETURNING * INTO ticket_after;

    IF ticket_after.id IS NULL THEN
        RAISE EXCEPTION 'support_ticket_state_conflict'
            USING ERRCODE = '40001';
    END IF;

    event_type := COALESCE(p_message_kind, 'admin_update');
    event_visibility := CASE WHEN p_message_kind = 'public_reply' THEN 'public' ELSE 'internal' END;
    event_body := CASE WHEN p_message_kind IS NOT NULL THEN normalized_body ELSE NULL END;

    SELECT COALESCE(MAX(event.sequence), 0) + 1 INTO next_event_sequence
    FROM public.support_ticket_events AS event
    WHERE event.ticket_id = p_ticket_id;

    INSERT INTO public.support_ticket_events (
        ticket_id, sequence, actor_id, event_type, visibility, body, metadata
    ) VALUES (
        p_ticket_id,
        next_event_sequence,
        p_admin_id,
        event_type,
        event_visibility,
        event_body,
        CASE WHEN p_message_kind = 'public_reply' THEN
            pg_catalog.jsonb_build_object(
                'before_status', ticket_before.status,
                'after_status', ticket_after.status
            )
        ELSE
            pg_catalog.jsonb_build_object(
                'before_status', ticket_before.status,
                'after_status', ticket_after.status,
                'before_priority', ticket_before.priority,
                'after_priority', ticket_after.priority,
                'before_assigned', ticket_before.assigned_admin_id IS NOT NULL,
                'after_assigned', ticket_after.assigned_admin_id IS NOT NULL,
                'assignment_changed',
                    ticket_before.assigned_admin_id IS DISTINCT FROM ticket_after.assigned_admin_id
            )
        END
    )
    RETURNING * INTO event_row;

    operation_result := pg_catalog.jsonb_build_object(
        'ticket', pg_catalog.jsonb_build_object(
            'id', ticket_after.id,
            'user_id', ticket_after.user_id,
            'issue_type', ticket_after.issue_type,
            'issue_title', ticket_after.issue_title,
            'status', ticket_after.status,
            'priority', ticket_after.priority,
            'updated_at', ticket_after.updated_at
        ),
        'event', pg_catalog.jsonb_build_object(
            'id', event_row.id,
            'event_type', event_row.event_type,
            'body', event_row.body
        ),
        'replayed', FALSE,
        'notifyStudent', (
            ticket_before.status IS DISTINCT FROM ticket_after.status
            OR p_message_kind = 'public_reply'
        ),
        'publicMessage', CASE WHEN p_message_kind = 'public_reply' THEN normalized_body ELSE NULL END
    );

    INSERT INTO public.support_ticket_operations (
        request_id, ticket_id, admin_id, expected_status, expected_updated_at, requested_status,
        requested_priority, assignment_is_set, requested_assigned_admin_id,
        message_kind, message_body, result
    ) VALUES (
        p_request_id, p_ticket_id, p_admin_id, p_expected_status, p_expected_updated_at, p_new_status,
        p_new_priority, p_assignment_is_set, p_assigned_admin_id,
        p_message_kind, normalized_body, operation_result
    );

    INSERT INTO public.admin_audit_log (
        admin_id, action, entity_type, entity_id, before, after
    ) VALUES (
        p_admin_id,
        'support_ticket.mutate',
        'support_ticket',
        p_ticket_id::TEXT,
        pg_catalog.jsonb_build_object(
            'status', ticket_before.status,
            'priority', ticket_before.priority,
            'assigned', ticket_before.assigned_admin_id IS NOT NULL,
            'updated_at', ticket_before.updated_at
        ),
        pg_catalog.jsonb_build_object(
            'status', ticket_after.status,
            'priority', ticket_after.priority,
            'assigned', ticket_after.assigned_admin_id IS NOT NULL,
            'updated_at', ticket_after.updated_at,
            'event_id', event_row.id,
            'request_id', p_request_id
        )
    );

    RETURN operation_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_my_support_tickets(
    p_limit INTEGER DEFAULT 50,
    p_offset INTEGER DEFAULT 0
)
RETURNS TABLE (
    id UUID,
    issue_type TEXT,
    issue_title TEXT,
    message TEXT,
    status TEXT,
    priority TEXT,
    created_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    caller_id UUID := auth.uid();
BEGIN
    IF caller_id IS NULL THEN
        RAISE EXCEPTION 'support_ticket_authentication_required'
            USING ERRCODE = '42501';
    END IF;

    RETURN QUERY
    SELECT ticket.id, ticket.issue_type, ticket.issue_title, ticket.message,
        ticket.status, ticket.priority, ticket.created_at, ticket.updated_at
    FROM public.support_tickets AS ticket
    WHERE ticket.user_id = caller_id
    ORDER BY ticket.created_at DESC, ticket.id DESC
    LIMIT LEAST(GREATEST(COALESCE(p_limit, 50), 1), 100)
    OFFSET GREATEST(COALESCE(p_offset, 0), 0);
END;
$$;

CREATE OR REPLACE FUNCTION public.get_my_support_ticket_events(
    p_ticket_id UUID,
    p_limit INTEGER DEFAULT 20,
    p_before_sequence BIGINT DEFAULT NULL
)
RETURNS TABLE (
    id UUID,
    ticket_id UUID,
    sequence BIGINT,
    event_type TEXT,
    body TEXT,
    created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    caller_id UUID := auth.uid();
BEGIN
    IF caller_id IS NULL THEN
        RAISE EXCEPTION 'support_ticket_authentication_required'
            USING ERRCODE = '42501';
    END IF;

    IF p_ticket_id IS NULL OR NOT EXISTS (
        SELECT 1 FROM public.support_tickets AS owned_ticket
        WHERE owned_ticket.id = p_ticket_id
          AND owned_ticket.user_id = caller_id
    ) THEN
        RAISE EXCEPTION 'support_ticket_not_found'
            USING ERRCODE = 'P0002';
    END IF;

    RETURN QUERY
    SELECT event.id, event.ticket_id, event.sequence, event.event_type, event.body, event.created_at
    FROM public.support_ticket_events AS event
    WHERE event.ticket_id = p_ticket_id
      AND event.visibility = 'public'
      AND (p_before_sequence IS NULL OR event.sequence < p_before_sequence)
    ORDER BY event.sequence DESC
    LIMIT LEAST(GREATEST(COALESCE(p_limit, 20), 1), 100);
END;
$$;

CREATE OR REPLACE FUNCTION private.can_read_support_ticket_event(
    p_ticket_id UUID,
    p_visibility TEXT
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT (SELECT private.is_admin())
        OR (
            p_visibility = 'public'
            AND EXISTS (
                SELECT 1 FROM public.support_tickets AS ticket
                WHERE ticket.id = p_ticket_id
                  AND ticket.user_id = (SELECT auth.uid())
            )
        );
$$;

CREATE POLICY "Admins can read support ticket history"
    ON public.support_ticket_events FOR SELECT TO authenticated
    USING ((SELECT private.is_admin()));

CREATE POLICY "Students can read own public support ticket history"
    ON public.support_ticket_events FOR SELECT TO authenticated
    USING ((SELECT private.can_read_support_ticket_event(ticket_id, visibility)));

REVOKE ALL ON TABLE public.support_tickets FROM PUBLIC, anon, authenticated, service_role;
GRANT INSERT (
    id, user_id, issue_type, issue_title, message, page_url, user_agent, context
) ON TABLE public.support_tickets TO authenticated;
GRANT SELECT, INSERT ON TABLE public.support_tickets TO service_role;

REVOKE ALL ON TABLE public.support_ticket_events,
    public.support_ticket_operations FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.support_ticket_events TO authenticated, service_role;
GRANT SELECT ON TABLE public.support_ticket_operations TO service_role;

REVOKE ALL ON FUNCTION private.guard_support_ticket_event_history(),
    private.guard_support_ticket_operation_history(),
    private.record_support_ticket_creation(),
    private.set_support_ticket_updated_at() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.can_read_support_ticket_event(UUID, TEXT)
    FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.can_read_support_ticket_event(UUID, TEXT)
    TO authenticated;
REVOKE ALL ON FUNCTION public.admin_mutate_support_ticket(
    UUID, UUID, UUID, TEXT, TIMESTAMPTZ, TEXT, TEXT, BOOLEAN, UUID, TEXT, TEXT
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_mutate_support_ticket(
    UUID, UUID, UUID, TEXT, TIMESTAMPTZ, TEXT, TEXT, BOOLEAN, UUID, TEXT, TEXT
) TO service_role;

REVOKE ALL ON FUNCTION public.get_my_support_tickets(INTEGER, INTEGER)
    FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_my_support_tickets(INTEGER, INTEGER)
    TO authenticated;
REVOKE ALL ON FUNCTION public.get_my_support_ticket_events(UUID, INTEGER, BIGINT)
    FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_my_support_ticket_events(UUID, INTEGER, BIGINT)
    TO authenticated;

COMMENT ON TABLE public.support_ticket_events IS
    'Immutable support history. Public replies are student-visible; internal notes never are.';
COMMENT ON FUNCTION public.admin_mutate_support_ticket(
    UUID, UUID, UUID, TEXT, TIMESTAMPTZ, TEXT, TEXT, BOOLEAN, UUID, TEXT, TEXT
) IS 'Idempotent service-role-only support mutation with state CAS, history and audit in one transaction.';
