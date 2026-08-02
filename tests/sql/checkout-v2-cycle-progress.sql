\set ON_ERROR_STOP on
SET TIME ZONE 'UTC';
SET lock_timeout = '5s';
SET statement_timeout = '20s';

BEGIN;
SET LOCAL session_replication_role = replica;

INSERT INTO public.profiles (id, email, full_name, role) VALUES
 ('cc000000-0000-4000-8000-000000000001','progress-admin@test.invalid','Admin','admin'),
 ('cc000000-0000-4000-8000-000000000002','progress-student-a@test.invalid','Student A','student'),
 ('cc000000-0000-4000-8000-000000000003','progress-student-b@test.invalid','Student B','student'),
 ('cc000000-0000-4000-8000-000000000004','progress-student-c@test.invalid','Student C','student'),
 ('cc000000-0000-4000-8000-000000000005','progress-student-d@test.invalid','Student D','student'),
 ('cc000000-0000-4000-8000-000000000006','progress-student-e@test.invalid','Student E','student'),
 ('cc000000-0000-4000-8000-000000000007','progress-teacher@test.invalid','Teacher','teacher'),
 ('cc000000-0000-4000-8000-000000000008','progress-teacher-b@test.invalid','Teacher B','teacher');

INSERT INTO public.packages (
 id,name,display_name,price_monthly,sessions_per_month,contract_schema_version,
 amount_cents,billing_interval_unit,billing_interval_count,sessions_per_period,class_duration_minutes
) VALUES (
 'cc100000-0000-4000-8000-000000000001','progress_v2','{"en":"Progress"}',25900,4,2,
 25900,'day',28,4,50
);

INSERT INTO public.subscriptions (
 id,student_id,package_id,status,starts_at,ends_at,sessions_total,
 contracted_sessions_per_period,sessions_used,stripe_subscription_id,
 contract_schema_version,billing_interval_unit,billing_interval_count,class_duration_minutes
) SELECT
 ('cc200000-0000-4000-8000-' || lpad(n::text,12,'0'))::UUID,
 ('cc000000-0000-4000-8000-' || lpad((n+1)::text,12,'0'))::UUID,
 'cc100000-0000-4000-8000-000000000001','active',DATE '2035-01-01',DATE '2035-01-29',
 4,4,CASE WHEN n=1 THEN 4 ELSE 0 END,'sub_progress_' || n,2,'day',28,50
FROM generate_series(1,5) AS n;

INSERT INTO public.payments (
 id,student_id,subscription_id,amount,currency,status,stripe_payment_intent_id,stripe_invoice_id
) SELECT
 ('cc300000-0000-4000-8000-' || lpad(n::text,12,'0'))::UUID,
 subscription.student_id,subscription.id,25900,'eur','succeeded',
 'pi_progress_' || n,'in_progress_' || n
FROM public.subscriptions AS subscription
CROSS JOIN LATERAL (
 SELECT right(subscription.id::TEXT, 1)::INTEGER AS n
) AS identity
WHERE subscription.id::TEXT LIKE 'cc200000-%';

INSERT INTO public.checkout_v2_cycles (
 id,subscription_id,cycle_number,cycle_kind,starts_at,ends_at,stripe_price_id,
 stripe_invoice_id,payment_id,materialization_state,sessions_materialized_at
) SELECT
 ('cc400000-0000-4000-8000-' || lpad(n::text,12,'0'))::UUID,
 ('cc200000-0000-4000-8000-' || lpad(n::text,12,'0'))::UUID,
 1,'initial',TIMESTAMPTZ '2035-01-01 10:00:00+00',TIMESTAMPTZ '2035-01-29 10:00:00+00',
 'price_progress_' || n,'in_progress_' || n,
 ('cc300000-0000-4000-8000-' || lpad(n::text,12,'0'))::UUID,
 CASE WHEN n=5 THEN 'pending' ELSE 'ready' END,
 CASE WHEN n=5 THEN NULL ELSE TIMESTAMPTZ '2034-12-20 10:00:00+00' END
FROM generate_series(1,5) AS n;

-- The newest cycle for subscription D remains pending and must not report 0/4.
INSERT INTO public.payments (
 id,student_id,subscription_id,amount,currency,status,stripe_payment_intent_id,stripe_invoice_id
) VALUES (
 'cc300000-0000-4000-8000-000000000006','cc000000-0000-4000-8000-000000000005',
 'cc200000-0000-4000-8000-000000000004',25900,'eur','succeeded',
 'pi_progress_6','in_progress_6'
);
INSERT INTO public.checkout_v2_cycles (
 id,subscription_id,cycle_number,cycle_kind,starts_at,ends_at,stripe_price_id,
 stripe_invoice_id,payment_id,materialization_state,sessions_materialized_at
) VALUES (
 'cc400000-0000-4000-8000-000000000006','cc200000-0000-4000-8000-000000000004',
 2,'renewal',TIMESTAMPTZ '2035-01-29 10:00:00+00',TIMESTAMPTZ '2035-02-26 10:00:00+00',
 'price_progress_6','in_progress_6','cc300000-0000-4000-8000-000000000006','pending',NULL
);

UPDATE public.payments AS payment
SET checkout_v2_cycle_id = cycle.id
FROM public.checkout_v2_cycles AS cycle
WHERE cycle.payment_id = payment.id
  AND payment.id::TEXT LIKE 'cc300000-%';

-- Subscription A: fully materialized, all four still scheduled.
INSERT INTO public.sessions (
 id,subscription_id,student_id,teacher_id,scheduled_at,duration_minutes,status,
 checkout_v2_cycle_id,checkout_v2_cycle_session_index
) SELECT
 ('cc510000-0000-4000-8000-' || lpad(n::text,12,'0'))::UUID,
 'cc200000-0000-4000-8000-000000000001','cc000000-0000-4000-8000-000000000002',
 'cc000000-0000-4000-8000-000000000007',TIMESTAMPTZ '2035-01-01 10:00:00+00' + (n-1)*INTERVAL '7 days',
 50,'scheduled','cc400000-0000-4000-8000-000000000001',n
FROM generate_series(1,4) AS n;

-- Subscription B: completed, no-show, late student cancellation, timely student cancellation.
INSERT INTO public.sessions (
 id,subscription_id,student_id,teacher_id,scheduled_at,duration_minutes,status,
 completed_at,no_show_at,cancelled_at,cancelled_by,cancellation_reason,
 checkout_v2_cycle_id,checkout_v2_cycle_session_index
) VALUES
 ('cc520000-0000-4000-8000-000000000001','cc200000-0000-4000-8000-000000000002','cc000000-0000-4000-8000-000000000003','cc000000-0000-4000-8000-000000000007','2035-01-01 12:00+00',50,'completed','2035-01-01 13:00+00',NULL,NULL,NULL,NULL,'cc400000-0000-4000-8000-000000000002',1),
 ('cc520000-0000-4000-8000-000000000002','cc200000-0000-4000-8000-000000000002','cc000000-0000-4000-8000-000000000003','cc000000-0000-4000-8000-000000000007','2035-01-08 12:00+00',50,'no_show',NULL,'2035-01-08 12:15+00',NULL,NULL,NULL,'cc400000-0000-4000-8000-000000000002',2),
 ('cc520000-0000-4000-8000-000000000003','cc200000-0000-4000-8000-000000000002','cc000000-0000-4000-8000-000000000003','cc000000-0000-4000-8000-000000000007','2035-01-15 12:00+00',50,'cancelled',NULL,NULL,'2035-01-14 13:00+00','cc000000-0000-4000-8000-000000000003','student request','cc400000-0000-4000-8000-000000000002',3),
 ('cc520000-0000-4000-8000-000000000004','cc200000-0000-4000-8000-000000000002','cc000000-0000-4000-8000-000000000003','cc000000-0000-4000-8000-000000000007','2035-01-22 12:00+00',50,'cancelled',NULL,NULL,'2035-01-21 11:00+00','cc000000-0000-4000-8000-000000000003','student request','cc400000-0000-4000-8000-000000000002',4);

-- Subscription C: teacher/admin cancellations, exact 24-hour student boundary, completed.
INSERT INTO public.sessions (
 id,subscription_id,student_id,teacher_id,scheduled_at,duration_minutes,status,
 completed_at,cancelled_at,cancelled_by,cancellation_reason,
 checkout_v2_cycle_id,checkout_v2_cycle_session_index
) VALUES
 ('cc530000-0000-4000-8000-000000000001','cc200000-0000-4000-8000-000000000003','cc000000-0000-4000-8000-000000000004','cc000000-0000-4000-8000-000000000007','2035-01-01 14:00+00',50,'cancelled',NULL,'2034-12-31 16:00+00','cc000000-0000-4000-8000-000000000007','teacher request','cc400000-0000-4000-8000-000000000003',1),
 ('cc530000-0000-4000-8000-000000000002','cc200000-0000-4000-8000-000000000003','cc000000-0000-4000-8000-000000000004','cc000000-0000-4000-8000-000000000007','2035-01-08 14:00+00',50,'cancelled',NULL,'2035-01-07 16:00+00','cc000000-0000-4000-8000-000000000001','academy request','cc400000-0000-4000-8000-000000000003',2),
 ('cc530000-0000-4000-8000-000000000003','cc200000-0000-4000-8000-000000000003','cc000000-0000-4000-8000-000000000004','cc000000-0000-4000-8000-000000000007','2035-01-15 14:00+00',50,'cancelled',NULL,'2035-01-14 14:00+00','cc000000-0000-4000-8000-000000000004','exact boundary','cc400000-0000-4000-8000-000000000003',3),
 ('cc530000-0000-4000-8000-000000000004','cc200000-0000-4000-8000-000000000003','cc000000-0000-4000-8000-000000000004','cc000000-0000-4000-8000-000000000007','2035-01-22 14:00+00',50,'completed','2035-01-22 15:00+00',NULL,NULL,NULL,'cc400000-0000-4000-8000-000000000003',4);

-- Subscription D first cycle proves cycle isolation; E is deliberately partial/pending.
INSERT INTO public.sessions (
 id,subscription_id,student_id,teacher_id,scheduled_at,duration_minutes,status,
 checkout_v2_cycle_id,checkout_v2_cycle_session_index
) SELECT
 ('cc540000-0000-4000-8000-' || lpad(n::text,12,'0'))::UUID,
 'cc200000-0000-4000-8000-000000000004','cc000000-0000-4000-8000-000000000005',
 'cc000000-0000-4000-8000-000000000007','2035-01-01 16:00+00'::TIMESTAMPTZ + (n-1)*INTERVAL '7 days',
 50,'scheduled','cc400000-0000-4000-8000-000000000004',n
FROM generate_series(1,4) AS n;
UPDATE public.sessions
SET status = 'completed',
    completed_at = scheduled_at + INTERVAL '50 minutes'
WHERE id = 'cc540000-0000-4000-8000-000000000001';
INSERT INTO public.sessions (
 id,subscription_id,student_id,teacher_id,scheduled_at,duration_minutes,status,
 checkout_v2_cycle_id,checkout_v2_cycle_session_index
) VALUES (
 'cc550000-0000-4000-8000-000000000001','cc200000-0000-4000-8000-000000000005',
 'cc000000-0000-4000-8000-000000000006','cc000000-0000-4000-8000-000000000007',
 '2035-01-01 18:00+00',50,'scheduled','cc400000-0000-4000-8000-000000000005',1
);

UPDATE public.checkout_v2_cycles
SET starts_at = TIMESTAMPTZ '2035-01-01 14:00+00',
    ends_at = TIMESTAMPTZ '2035-01-29 14:00+00'
WHERE id = 'cc400000-0000-4000-8000-000000000003';

INSERT INTO public.checkout_v2_billing_state (
    subscription_id, first_session_id, first_class_at,
    renewal_anchor_at, stripe_renewal_anchor_at,
    anchor_state, anchor_revision, anchor_fixed_at
) VALUES (
    'cc200000-0000-4000-8000-000000000003',
    'cc530000-0000-4000-8000-000000000001',
    TIMESTAMPTZ '2035-01-01 14:00+00',
    TIMESTAMPTZ '2035-01-29 14:00+00',
    TIMESTAMPTZ '2035-01-29 14:00+00',
    'fixed', 1, TIMESTAMPTZ '2035-01-01 15:00+00'
);

SET LOCAL session_replication_role = origin;

DO $$
DECLARE
    effective_count INTEGER;
    effective_ids UUID[];
    root_ids UUID[];
    root_index_predicate TEXT;
BEGIN
    SELECT count(*), array_agg(id ORDER BY checkout_v2_cycle_session_index)
    INTO effective_count, effective_ids
    FROM private.checkout_v2_effective_cycle_sessions(
        'cc400000-0000-4000-8000-000000000001'
    );

    SELECT array_agg(id ORDER BY checkout_v2_cycle_session_index)
    INTO root_ids
    FROM public.sessions
    WHERE checkout_v2_cycle_id = 'cc400000-0000-4000-8000-000000000001'
      AND checkout_v2_replaces_session_id IS NULL;

    IF effective_count IS DISTINCT FROM 4 OR effective_ids IS DISTINCT FROM root_ids THEN
        RAISE EXCEPTION 'root_only_effective_projection_changed:%:%',
            effective_ids, root_ids;
    END IF;

    SELECT pg_catalog.pg_get_expr(index_row.indpred, index_row.indrelid)
    INTO root_index_predicate
    FROM pg_catalog.pg_index AS index_row
    WHERE index_row.indexrelid =
        'public.sessions_checkout_v2_cycle_position_unique_idx'::REGCLASS;

    IF root_index_predicate NOT LIKE '%checkout_v2_replaces_session_id IS NULL%' THEN
        RAISE EXCEPTION 'cycle_position_uniqueness_is_not_root_scoped:%',
            root_index_predicate;
    END IF;

    PERFORM pg_catalog.set_config('session_replication_role', 'replica', TRUE);
    DELETE FROM public.checkout_v2_billing_state
    WHERE subscription_id = 'cc200000-0000-4000-8000-000000000003';
    PERFORM pg_catalog.set_config('session_replication_role', 'origin', TRUE);

    BEGIN
        INSERT INTO public.sessions (
            id, subscription_id, student_id, teacher_id, scheduled_at,
            duration_minutes, status, created_at, checkout_v2_cycle_id,
            checkout_v2_cycle_session_index,
            checkout_v2_replaces_session_id,
            checkout_v2_replacement_request_id,
            checkout_v2_replacement_actor_id,
            checkout_v2_replacement_source_kind,
            checkout_v2_replacement_reason
        ) VALUES (
            'cc560000-0000-4000-8000-000000000003',
            'cc200000-0000-4000-8000-000000000003',
            'cc000000-0000-4000-8000-000000000004',
            'cc000000-0000-4000-8000-000000000007',
            '2035-02-01 14:00+00', 50, 'scheduled',
            (SELECT created_at + INTERVAL '1 second' FROM public.sessions
             WHERE id = 'cc530000-0000-4000-8000-000000000001'),
            'cc400000-0000-4000-8000-000000000003', 1,
            'cc530000-0000-4000-8000-000000000001',
            'cc570000-0000-4000-8000-000000000003',
            'cc000000-0000-4000-8000-000000000007',
            'teacher_cancellation',
            'replacement_after_teacher_cancellation'
        );
        RAISE EXCEPTION 'replacement_without_billing_state_was_allowed';
    EXCEPTION WHEN check_violation THEN
        IF SQLERRM <> 'checkout_v2_session_replacement_billing_state_is_missing' THEN
            RAISE;
        END IF;
    END;

    PERFORM pg_catalog.set_config('session_replication_role', 'replica', TRUE);
    INSERT INTO public.checkout_v2_billing_state (
        subscription_id, first_session_id, first_class_at,
        renewal_anchor_at, stripe_renewal_anchor_at,
        anchor_state, anchor_revision, anchor_fixed_at
    ) VALUES (
        'cc200000-0000-4000-8000-000000000003',
        'cc530000-0000-4000-8000-000000000001',
        TIMESTAMPTZ '2035-01-01 14:00+00',
        TIMESTAMPTZ '2035-01-29 14:00+00',
        TIMESTAMPTZ '2035-01-29 14:00+00',
        'fixed', 1, TIMESTAMPTZ '2035-01-01 15:00+00'
    );
    PERFORM pg_catalog.set_config('session_replication_role', 'origin', TRUE);

    BEGIN
        INSERT INTO public.sessions (
            id, subscription_id, student_id, teacher_id, scheduled_at,
            duration_minutes, status, created_at, checkout_v2_cycle_id,
            checkout_v2_cycle_session_index,
            checkout_v2_replacement_request_id
        ) VALUES (
            'cc560000-0000-4000-8000-000000000001',
            'cc200000-0000-4000-8000-000000000001',
            'cc000000-0000-4000-8000-000000000002',
            'cc000000-0000-4000-8000-000000000007',
            '2035-02-01 10:00+00', 50, 'scheduled', clock_timestamp(),
            'cc400000-0000-4000-8000-000000000001', 1,
            'cc570000-0000-4000-8000-000000000001'
        );
        RAISE EXCEPTION 'incoherent_replacement_shape_was_allowed';
    EXCEPTION WHEN check_violation THEN NULL;
    END;

    BEGIN
        INSERT INTO public.sessions (
            id, subscription_id, student_id, teacher_id, scheduled_at,
            duration_minutes, status, created_at, checkout_v2_cycle_id,
            checkout_v2_cycle_session_index,
            checkout_v2_replaces_session_id,
            checkout_v2_replacement_request_id,
            checkout_v2_replacement_actor_id,
            checkout_v2_replacement_source_kind,
            checkout_v2_replacement_reason
        ) VALUES (
            'cc560000-0000-4000-8000-000000000002',
            'cc200000-0000-4000-8000-000000000003',
            'cc000000-0000-4000-8000-000000000004',
            'cc000000-0000-4000-8000-000000000007',
            '2035-02-01 14:00+00', 50, 'scheduled',
            (SELECT created_at + INTERVAL '1 second' FROM public.sessions
             WHERE id = 'cc530000-0000-4000-8000-000000000001'),
            'cc400000-0000-4000-8000-000000000003', 1,
            'cc530000-0000-4000-8000-000000000001',
            'cc570000-0000-4000-8000-000000000002',
            'cc000000-0000-4000-8000-000000000007',
            'teacher_cancellation',
            'replacement_after_teacher_cancellation'
        );
        RAISE EXCEPTION 'direct_replacement_insert_was_allowed';
    EXCEPTION WHEN feature_not_supported THEN
        IF SQLERRM <> 'checkout_v2_session_replacement_insert_is_not_enabled' THEN
            RAISE;
        END IF;
    END;
END $$;

DO $$
DECLARE
    identity_mutation TEXT;
BEGIN
    PERFORM pg_catalog.set_config('session_replication_role', 'replica', TRUE);
    INSERT INTO public.sessions (
        id, subscription_id, student_id, teacher_id, scheduled_at,
        duration_minutes, status, created_at, checkout_v2_cycle_id,
        checkout_v2_cycle_session_index, checkout_v2_replaces_session_id,
        checkout_v2_replacement_request_id, checkout_v2_replacement_actor_id,
        checkout_v2_replacement_source_kind, checkout_v2_replacement_reason
    ) VALUES
    (
        'cc560000-0000-4000-8000-000000000011',
        'cc200000-0000-4000-8000-000000000003',
        'cc000000-0000-4000-8000-000000000004',
        'cc000000-0000-4000-8000-000000000007',
        '2035-02-01 02:00+00', 50, 'scheduled',
        (SELECT created_at + INTERVAL '1 second' FROM public.sessions
         WHERE id='cc530000-0000-4000-8000-000000000001'),
        'cc400000-0000-4000-8000-000000000003', 1,
        'cc530000-0000-4000-8000-000000000001',
        'cc570000-0000-4000-8000-000000000011',
        'cc000000-0000-4000-8000-000000000007',
        'teacher_cancellation', 'replacement_after_teacher_cancellation'
    ),
    (
        'cc560000-0000-4000-8000-000000000012',
        'cc200000-0000-4000-8000-000000000003',
        'cc000000-0000-4000-8000-000000000004',
        'cc000000-0000-4000-8000-000000000007',
        '2035-02-02 02:00+00', 50, 'scheduled',
        (SELECT created_at + INTERVAL '1 second' FROM public.sessions
         WHERE id='cc530000-0000-4000-8000-000000000002'),
        'cc400000-0000-4000-8000-000000000003', 2,
        'cc530000-0000-4000-8000-000000000002',
        'cc570000-0000-4000-8000-000000000012',
        'cc000000-0000-4000-8000-000000000001',
        'admin_cancellation', 'replacement_after_admin_cancellation'
    ),
    (
        'cc560000-0000-4000-8000-000000000013',
        'cc200000-0000-4000-8000-000000000003',
        'cc000000-0000-4000-8000-000000000004',
        'cc000000-0000-4000-8000-000000000007',
        '2035-02-03 02:00+00', 50, 'scheduled',
        (SELECT created_at + INTERVAL '1 second' FROM public.sessions
         WHERE id='cc530000-0000-4000-8000-000000000003'),
        'cc400000-0000-4000-8000-000000000003', 3,
        'cc530000-0000-4000-8000-000000000003',
        'cc570000-0000-4000-8000-000000000013',
        'cc000000-0000-4000-8000-000000000004',
        'timely_student_cancellation',
        'replacement_after_timely_student_cancellation'
    );
    PERFORM pg_catalog.set_config('session_replication_role', 'origin', TRUE);

    IF (SELECT original_consumption_kind
        FROM public.checkout_v2_session_consumption
        WHERE session_id='cc560000-0000-4000-8000-000000000011')
            <> 'non_student_cancellation'
       OR (SELECT original_consumption_kind
           FROM public.checkout_v2_session_consumption
           WHERE session_id='cc560000-0000-4000-8000-000000000012')
            <> 'non_student_cancellation'
       OR (SELECT original_consumption_kind
           FROM public.checkout_v2_session_consumption
           WHERE session_id='cc560000-0000-4000-8000-000000000013')
            <> 'timely_student_cancellation' THEN
        RAISE EXCEPTION 'replacement_without_adjustment_lost_source_incident';
    END IF;

    FOREACH identity_mutation IN ARRAY ARRAY[
        'subscription_id = ''cc200000-0000-4000-8000-000000000002''::UUID',
        'student_id = ''cc000000-0000-4000-8000-000000000003''::UUID',
        'teacher_id = ''cc000000-0000-4000-8000-000000000008''::UUID',
        'checkout_v2_cycle_id = ''cc400000-0000-4000-8000-000000000002''::UUID',
        'checkout_v2_cycle_session_index = 2',
        'duration_minutes = 40',
        'created_at = created_at + INTERVAL ''1 second'''
    ] LOOP
        BEGIN
            EXECUTE 'UPDATE public.sessions SET ' || identity_mutation
                || ' WHERE id = ''cc560000-0000-4000-8000-000000000011''';
            RAISE EXCEPTION 'replacement_identity_mutation_was_allowed:%',
                identity_mutation;
        EXCEPTION WHEN check_violation THEN
            IF SQLERRM <> 'checkout_v2_session_replacement_identity_is_immutable' THEN
                RAISE;
            END IF;
        END;
    END LOOP;

    PERFORM pg_catalog.set_config('session_replication_role', 'replica', TRUE);
    DELETE FROM public.sessions
    WHERE id IN (
        'cc560000-0000-4000-8000-000000000011',
        'cc560000-0000-4000-8000-000000000012',
        'cc560000-0000-4000-8000-000000000013'
    );
    PERFORM pg_catalog.set_config('session_replication_role', 'origin', TRUE);
END $$;

DO $$
BEGIN
    PERFORM pg_catalog.set_config('session_replication_role', 'replica', TRUE);
    UPDATE public.sessions
    SET
        status = 'cancelled',
        cancelled_at = scheduled_at - INTERVAL '2 hours',
        cancelled_by = teacher_id,
        cancellation_reason = 'replacement lineage fixture'
    WHERE id = 'cc510000-0000-4000-8000-000000000001';

    INSERT INTO public.sessions (
        id, subscription_id, student_id, teacher_id, scheduled_at,
        duration_minutes, status, created_at, checkout_v2_cycle_id,
        checkout_v2_cycle_session_index, checkout_v2_replaces_session_id,
        checkout_v2_replacement_request_id, checkout_v2_replacement_actor_id,
        checkout_v2_replacement_source_kind, checkout_v2_replacement_reason
    ) SELECT
        'cc560000-0000-4000-8000-000000000021',
        source.subscription_id, source.student_id, source.teacher_id,
        source.scheduled_at, source.duration_minutes, 'scheduled',
        source.created_at + INTERVAL '1 second', source.checkout_v2_cycle_id,
        source.checkout_v2_cycle_session_index, source.id,
        'cc570000-0000-4000-8000-000000000021', source.teacher_id,
        'teacher_cancellation', 'replacement_after_teacher_cancellation'
    FROM public.sessions AS source
    WHERE source.id = 'cc510000-0000-4000-8000-000000000001';

    INSERT INTO public.checkout_v2_billing_state (
        subscription_id, first_session_id, first_class_at,
        renewal_anchor_at, stripe_renewal_anchor_at,
        anchor_state, anchor_revision
    ) VALUES (
        'cc200000-0000-4000-8000-000000000001',
        'cc510000-0000-4000-8000-000000000001',
        TIMESTAMPTZ '2035-01-01 10:00+00',
        TIMESTAMPTZ '2035-01-29 10:00+00',
        TIMESTAMPTZ '2035-01-29 10:00+00',
        'provisional', 1
    );
    PERFORM pg_catalog.set_config('session_replication_role', 'origin', TRUE);

    PERFORM private.assert_checkout_v2_first_session_coherence_upgrade_safe();
    IF (SELECT first_session_id FROM public.checkout_v2_billing_state
        WHERE subscription_id='cc200000-0000-4000-8000-000000000001')
            IS DISTINCT FROM 'cc510000-0000-4000-8000-000000000001'::UUID
       OR (SELECT id FROM private.checkout_v2_effective_cycle_sessions(
            'cc400000-0000-4000-8000-000000000001'
          ) WHERE checkout_v2_cycle_session_index=1)
            IS DISTINCT FROM 'cc560000-0000-4000-8000-000000000021'::UUID THEN
        RAISE EXCEPTION 'first_session_coherence_did_not_preserve_root_identity';
    END IF;

    PERFORM pg_catalog.set_config('session_replication_role', 'replica', TRUE);
    DELETE FROM public.checkout_v2_billing_state
    WHERE subscription_id='cc200000-0000-4000-8000-000000000001';
    DELETE FROM public.sessions
    WHERE id='cc560000-0000-4000-8000-000000000021';
    UPDATE public.sessions
    SET status='scheduled', cancelled_at=NULL,
        cancelled_by=NULL, cancellation_reason=NULL
    WHERE id='cc510000-0000-4000-8000-000000000001';
    PERFORM pg_catalog.set_config('session_replication_role', 'origin', TRUE);
END $$;

DO $$
BEGIN
    IF has_function_privilege(
            'anon',
            'private.checkout_v2_effective_cycle_sessions(uuid)',
            'EXECUTE'
       )
       OR has_function_privilege(
            'authenticated',
            'private.checkout_v2_effective_cycle_sessions(uuid)',
            'EXECUTE'
       )
       OR NOT has_function_privilege(
            'service_role',
            'private.checkout_v2_effective_cycle_sessions(uuid)',
            'EXECUTE'
       ) THEN
        RAISE EXCEPTION 'effective_session_helper_grants_are_wrong';
    END IF;
END $$;

DO $$
BEGIN
 BEGIN
  UPDATE public.sessions
  SET status = 'cancelled',
      cancelled_at = scheduled_at - INTERVAL '1 hour',
      cancelled_by = student_id,
      cancellation_reason = 'guarantee_refund'
  WHERE id = 'cc540000-0000-4000-8000-000000000002';
  RAISE EXCEPTION 'forged_guarantee_refund_was_allowed';
 EXCEPTION WHEN check_violation THEN
  IF SQLERRM <> 'checkout_v2_guarantee_refund_provenance_is_invalid' THEN
   RAISE;
  END IF;
 END;

 IF (SELECT status FROM public.sessions
     WHERE id = 'cc540000-0000-4000-8000-000000000002') <> 'scheduled' THEN
  RAISE EXCEPTION 'forged_guarantee_refund_changed_the_session';
 END IF;
END $$;

DO $$
DECLARE p public.checkout_v2_cycle_progress%ROWTYPE;
BEGIN
 SELECT * INTO p FROM public.checkout_v2_cycle_progress WHERE cycle_id='cc400000-0000-4000-8000-000000000001';
 IF p.progress_state <> 'ready' OR p.sessions_consumed <> 0 OR p.sessions_remaining <> 4
    OR p.sessions_scheduled <> 4 OR p.sessions_materialized <> 4 THEN
   RAISE EXCEPTION 'scheduled_purchase_is_not_zero_of_four:%', row_to_json(p);
 END IF;
 IF (SELECT sessions_used FROM public.subscriptions WHERE id='cc200000-0000-4000-8000-000000000001') <> 4 THEN
   RAISE EXCEPTION 'sessions_used_fixture_changed';
 END IF;

 SELECT * INTO p FROM public.checkout_v2_cycle_progress WHERE cycle_id='cc400000-0000-4000-8000-000000000002';
 IF p.sessions_consumed <> 3 OR p.sessions_remaining <> 1 OR p.sessions_completed <> 1
    OR p.sessions_no_show <> 1 OR p.sessions_late_student_cancelled <> 1 THEN
   RAISE EXCEPTION 'outcome_consumption_is_wrong:%', row_to_json(p);
 END IF;

 IF (SELECT consumption_kind FROM public.checkout_v2_session_consumption WHERE session_id='cc530000-0000-4000-8000-000000000003') <> 'timely_student_cancellation'
    OR (SELECT student_credit_consumed FROM public.checkout_v2_session_consumption WHERE session_id='cc530000-0000-4000-8000-000000000003') THEN
   RAISE EXCEPTION 'exact_24_hour_boundary_consumed';
 END IF;
 IF EXISTS (SELECT 1 FROM public.checkout_v2_session_consumption WHERE session_id IN ('cc530000-0000-4000-8000-000000000001','cc530000-0000-4000-8000-000000000002') AND student_credit_consumed) THEN
   RAISE EXCEPTION 'non_student_cancellation_consumed';
 END IF;
 IF (SELECT sessions_consumed FROM public.checkout_v2_cycle_progress
     WHERE cycle_id='cc400000-0000-4000-8000-000000000004') <> 1
    OR (SELECT sessions_remaining FROM public.checkout_v2_cycle_progress
        WHERE cycle_id='cc400000-0000-4000-8000-000000000004') <> 3 THEN
   RAISE EXCEPTION 'guarantee_window_progress_is_wrong';
 END IF;

 SELECT * INTO p FROM public.checkout_v2_cycle_progress WHERE cycle_id='cc400000-0000-4000-8000-000000000005';
 IF p.progress_state <> 'inconsistent' OR p.sessions_materialized <> 1 OR p.sessions_consumed IS NOT NULL OR p.sessions_remaining IS NOT NULL THEN
   RAISE EXCEPTION 'partial_pending_cycle_not_inconsistent:%', row_to_json(p);
 END IF;

 SELECT * INTO p FROM public.get_checkout_v2_subscription_progress('cc200000-0000-4000-8000-000000000004');
 IF p.cycle_number <> 2 OR p.progress_state <> 'pending' OR p.sessions_materialized <> 0
    OR p.sessions_consumed IS NOT NULL OR p.sessions_remaining IS NOT NULL THEN
   RAISE EXCEPTION 'latest_pending_cycle_looks_like_zero_of_four:%', row_to_json(p);
 END IF;
 IF (SELECT progress_state FROM public.checkout_v2_cycle_progress
    WHERE cycle_id='cc400000-0000-4000-8000-000000000004') <> 'ready'
    OR (SELECT sessions_remaining FROM public.checkout_v2_cycle_progress
        WHERE cycle_id='cc400000-0000-4000-8000-000000000004') <> 3 THEN
   RAISE EXCEPTION 'cycle_progress_is_not_isolated';
 END IF;
END $$;

DO $$
DECLARE
    rows_returned INTEGER;
    generated_batch UUID[];
BEGIN
 SELECT count(*) INTO rows_returned
 FROM public.get_checkout_v2_subscriptions_progress(ARRAY[
   'cc200000-0000-4000-8000-000000000002'::UUID,
   'cc200000-0000-4000-8000-000000000002'::UUID,
   'cc200000-0000-4000-8000-000000000004'::UUID,
   'ffffffff-ffff-4fff-8fff-ffffffffffff'::UUID,
   NULL::UUID
 ]);
 IF rows_returned <> 2
    OR (SELECT cycle_number FROM public.get_checkout_v2_subscriptions_progress(
        ARRAY['cc200000-0000-4000-8000-000000000004'::UUID])) <> 2 THEN
   RAISE EXCEPTION 'batch_progress_does_not_deduplicate_or_select_latest';
 END IF;

 IF EXISTS (SELECT 1 FROM public.get_checkout_v2_subscriptions_progress(ARRAY[]::UUID[]))
    OR EXISTS (SELECT 1 FROM public.get_checkout_v2_subscriptions_progress(NULL)) THEN
   RAISE EXCEPTION 'empty_batch_progress_is_not_empty';
 END IF;

 SELECT array_agg(
   ('dd000000-0000-4000-8000-' || lpad(n::TEXT, 12, '0'))::UUID
   ORDER BY n
 ) INTO generated_batch
 FROM generate_series(1, 1001) AS n;
 IF EXISTS (SELECT 1 FROM public.get_checkout_v2_subscriptions_progress(generated_batch)) THEN
   RAISE EXCEPTION 'unknown_large_batch_returned_rows';
 END IF;

 BEGIN
   PERFORM public.get_checkout_v2_subscriptions_progress(
     array_fill('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'::UUID, ARRAY[5001])
   );
   RAISE EXCEPTION 'oversized_batch_was_allowed';
 EXCEPTION WHEN invalid_parameter_value THEN NULL;
 END;
END $$;

DO $$
DECLARE ledger_before BIGINT; used_before INTEGER;
BEGIN
 SELECT count(*) INTO ledger_before FROM public.teacher_compensation_ledger;
 SELECT sessions_used INTO used_before FROM public.subscriptions WHERE id='cc200000-0000-4000-8000-000000000002';

 INSERT INTO public.checkout_v2_session_credit_adjustments (
   request_id,session_id,subscription_id,cycle_id,session_index,admin_id,reason
 ) VALUES (
   'cc600000-0000-4000-8000-000000000001','cc520000-0000-4000-8000-000000000002',
   'cc200000-0000-4000-8000-000000000002','cc400000-0000-4000-8000-000000000002',2,
   'cc000000-0000-4000-8000-000000000001','Restore credit after reviewed no-show incident'
 );

 IF (SELECT sessions_consumed FROM public.checkout_v2_cycle_progress WHERE cycle_id='cc400000-0000-4000-8000-000000000002') <> 2
    OR (SELECT sessions_restored FROM public.checkout_v2_cycle_progress WHERE cycle_id='cc400000-0000-4000-8000-000000000002') <> 1
    OR (SELECT consumption_kind FROM public.checkout_v2_session_consumption WHERE session_id='cc520000-0000-4000-8000-000000000002') <> 'restored_no_show'
    OR (SELECT count(*) FROM public.teacher_compensation_ledger) <> ledger_before
    OR (SELECT sessions_used FROM public.subscriptions WHERE id='cc200000-0000-4000-8000-000000000002') <> used_before THEN
   RAISE EXCEPTION 'restoration_changed_unrelated_ledgers_or_wrong_progress';
 END IF;

 PERFORM pg_catalog.set_config('session_replication_role', 'replica', TRUE);
 INSERT INTO public.sessions (
   id,subscription_id,student_id,teacher_id,scheduled_at,duration_minutes,status,created_at,
   checkout_v2_cycle_id,checkout_v2_cycle_session_index,
   checkout_v2_replaces_session_id,checkout_v2_replacement_request_id,
   checkout_v2_replacement_actor_id,checkout_v2_replacement_source_kind,
   checkout_v2_replacement_reason,checkout_v2_replacement_credit_adjustment_id
 ) VALUES (
   'cc560000-0000-4000-8000-000000000003','cc200000-0000-4000-8000-000000000002',
   'cc000000-0000-4000-8000-000000000003','cc000000-0000-4000-8000-000000000007',
   '2035-01-10 02:00+00',50,'scheduled',
   (SELECT created_at + INTERVAL '1 second' FROM public.sessions
    WHERE id='cc520000-0000-4000-8000-000000000002'),
   'cc400000-0000-4000-8000-000000000002',2,
   'cc520000-0000-4000-8000-000000000002','cc570000-0000-4000-8000-000000000003',
   'cc000000-0000-4000-8000-000000000001','restored_no_show',
   'replacement_after_restored_no_show','cc600000-0000-4000-8000-000000000001'
 );
 PERFORM pg_catalog.set_config('session_replication_role', 'origin', TRUE);

 IF (SELECT session_id FROM public.checkout_v2_session_consumption
     WHERE cycle_id='cc400000-0000-4000-8000-000000000002' AND session_index=2)
       <> 'cc560000-0000-4000-8000-000000000003'::UUID
    OR (SELECT original_consumption_kind FROM public.checkout_v2_session_consumption
        WHERE session_id='cc560000-0000-4000-8000-000000000003') <> 'no_show'
    OR (SELECT consumption_kind FROM public.checkout_v2_session_consumption
        WHERE session_id='cc560000-0000-4000-8000-000000000003') <> 'scheduled'
    OR NOT (SELECT credit_restored FROM public.checkout_v2_session_consumption
            WHERE session_id='cc560000-0000-4000-8000-000000000003')
    OR (SELECT student_credit_consumed FROM public.checkout_v2_session_consumption
        WHERE session_id='cc560000-0000-4000-8000-000000000003')
    OR (SELECT sessions_consumed FROM public.checkout_v2_cycle_progress
        WHERE cycle_id='cc400000-0000-4000-8000-000000000002') <> 2 THEN
   RAISE EXCEPTION 'scheduled_replacement_lost_restored_incident_semantics';
 END IF;

 PERFORM pg_catalog.set_config('session_replication_role', 'replica', TRUE);
 UPDATE public.sessions
 SET status='completed', completed_at=scheduled_at + INTERVAL '50 minutes'
 WHERE id='cc560000-0000-4000-8000-000000000003';
 PERFORM pg_catalog.set_config('session_replication_role', 'origin', TRUE);

 IF NOT (SELECT student_credit_consumed FROM public.checkout_v2_session_consumption
         WHERE session_id='cc560000-0000-4000-8000-000000000003')
    OR (SELECT sessions_consumed FROM public.checkout_v2_cycle_progress
        WHERE cycle_id='cc400000-0000-4000-8000-000000000002') <> 3
    OR (SELECT sessions_restored FROM public.checkout_v2_cycle_progress
        WHERE cycle_id='cc400000-0000-4000-8000-000000000002') <> 1 THEN
   RAISE EXCEPTION 'completed_replacement_did_not_consume_restored_position';
 END IF;

 PERFORM pg_catalog.set_config('session_replication_role', 'replica', TRUE);
 DELETE FROM public.sessions WHERE id='cc560000-0000-4000-8000-000000000003';
 PERFORM pg_catalog.set_config('session_replication_role', 'origin', TRUE);

 BEGIN
   UPDATE public.checkout_v2_session_credit_adjustments SET reason='Changed reason' WHERE request_id='cc600000-0000-4000-8000-000000000001';
   RAISE EXCEPTION 'adjustment_update_was_allowed';
 EXCEPTION WHEN check_violation THEN NULL;
 END;
 BEGIN
   DELETE FROM public.checkout_v2_session_credit_adjustments WHERE request_id='cc600000-0000-4000-8000-000000000001';
   RAISE EXCEPTION 'adjustment_delete_was_allowed';
 EXCEPTION WHEN check_violation THEN NULL;
 END;
 BEGIN
   INSERT INTO public.checkout_v2_session_credit_adjustments(request_id,session_id,subscription_id,cycle_id,session_index,admin_id,reason)
   VALUES('cc600000-0000-4000-8000-000000000002','cc510000-0000-4000-8000-000000000001','cc200000-0000-4000-8000-000000000001','cc400000-0000-4000-8000-000000000001',1,'cc000000-0000-4000-8000-000000000001','Scheduled is ineligible');
   RAISE EXCEPTION 'ineligible_adjustment_was_allowed';
 EXCEPTION WHEN check_violation THEN NULL;
 END;
 BEGIN
   INSERT INTO public.checkout_v2_session_credit_adjustments(request_id,session_id,subscription_id,cycle_id,session_index,admin_id,reason)
   VALUES('cc600000-0000-4000-8000-000000000003','cc520000-0000-4000-8000-000000000003','cc200000-0000-4000-8000-000000000001','cc400000-0000-4000-8000-000000000002',3,'cc000000-0000-4000-8000-000000000001','Mismatched subscription');
   RAISE EXCEPTION 'misbound_adjustment_was_allowed';
 EXCEPTION WHEN check_violation THEN NULL;
 END;
END $$;

DO $$
BEGIN
 IF NOT (SELECT relrowsecurity FROM pg_catalog.pg_class WHERE oid='public.checkout_v2_session_credit_adjustments'::REGCLASS)
    OR EXISTS (SELECT 1 FROM pg_catalog.pg_policy WHERE polrelid='public.checkout_v2_session_credit_adjustments'::REGCLASS)
    OR has_table_privilege('anon','public.checkout_v2_session_credit_adjustments','SELECT')
    OR has_table_privilege('authenticated','public.checkout_v2_cycle_progress','SELECT')
    OR has_table_privilege('service_role','public.checkout_v2_session_credit_adjustments','INSERT')
     OR NOT has_table_privilege('service_role','public.checkout_v2_session_credit_adjustments','SELECT')
     OR NOT has_table_privilege('service_role','public.checkout_v2_session_consumption','SELECT')
     OR NOT has_table_privilege('service_role','public.checkout_v2_cycle_progress','SELECT')
     OR NOT has_table_privilege('service_role','public.sessions','SELECT')
     OR NOT has_table_privilege('service_role','public.subscriptions','SELECT')
     OR NOT has_table_privilege('service_role','public.checkout_v2_cycles','SELECT')
     OR NOT has_table_privilege('service_role','public.checkout_v2_guarantee_operations','SELECT') THEN
   RAISE EXCEPTION 'checkout_v2_progress_grants_are_wrong';
 END IF;
 IF has_function_privilege('anon','public.get_checkout_v2_subscription_progress(uuid)','EXECUTE')
    OR has_function_privilege('authenticated','public.get_checkout_v2_subscription_progress(uuid)','EXECUTE')
    OR NOT has_function_privilege('service_role','public.get_checkout_v2_subscription_progress(uuid)','EXECUTE')
    OR has_function_privilege('anon','public.get_checkout_v2_subscriptions_progress(uuid[])','EXECUTE')
    OR has_function_privilege('authenticated','public.get_checkout_v2_subscriptions_progress(uuid[])','EXECUTE')
    OR NOT has_function_privilege('service_role','public.get_checkout_v2_subscriptions_progress(uuid[])','EXECUTE') THEN
   RAISE EXCEPTION 'checkout_v2_progress_function_grants_are_wrong';
 END IF;
 IF (SELECT reloptions FROM pg_catalog.pg_class WHERE oid='public.checkout_v2_session_consumption'::REGCLASS) IS DISTINCT FROM ARRAY['security_invoker=true']::TEXT[]
    OR (SELECT reloptions FROM pg_catalog.pg_class WHERE oid='public.checkout_v2_cycle_progress'::REGCLASS) IS DISTINCT FROM ARRAY['security_invoker=true']::TEXT[] THEN
   RAISE EXCEPTION 'checkout_v2_progress_views_are_not_security_invoker';
 END IF;
END $$;

SET LOCAL ROLE service_role;
DO $$
DECLARE
    single_progress RECORD;
    batch_rows INTEGER;
BEGIN
    SELECT * INTO single_progress
    FROM public.get_checkout_v2_subscription_progress(
        'cc200000-0000-4000-8000-000000000002'
    );

    IF single_progress.subscription_id IS DISTINCT FROM
            'cc200000-0000-4000-8000-000000000002'::UUID
       OR single_progress.sessions_consumed IS DISTINCT FROM 2 THEN
        RAISE EXCEPTION 'service_role_single_progress_rpc_failed:%',
            pg_catalog.row_to_json(single_progress);
    END IF;

    SELECT count(*) INTO batch_rows
    FROM public.get_checkout_v2_subscriptions_progress(ARRAY[
        'cc200000-0000-4000-8000-000000000002'::UUID,
        'cc200000-0000-4000-8000-000000000004'::UUID
    ]);

    IF batch_rows IS DISTINCT FROM 2
       OR (SELECT progress_state
           FROM public.get_checkout_v2_subscriptions_progress(ARRAY[
               'cc200000-0000-4000-8000-000000000004'::UUID
           ])) IS DISTINCT FROM 'pending' THEN
        RAISE EXCEPTION 'service_role_batch_progress_rpc_failed';
    END IF;
END $$;
RESET ROLE;

ROLLBACK;
