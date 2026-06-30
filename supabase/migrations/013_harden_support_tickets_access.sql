-- Keep support tickets API-only for reads.
-- Users create tickets through /api/support/alert; admins read/update them through
-- server-side admin endpoints that use the service role.

REVOKE ALL ON TABLE public.support_tickets FROM anon;
REVOKE ALL ON TABLE public.support_tickets FROM authenticated;
REVOKE ALL ON TABLE public.support_tickets FROM public;

GRANT INSERT ON TABLE public.support_tickets TO authenticated;

DROP POLICY IF EXISTS "Users can create own support tickets" ON public.support_tickets;
DROP POLICY IF EXISTS "Users can view own support tickets" ON public.support_tickets;
DROP POLICY IF EXISTS "Admins can manage support tickets" ON public.support_tickets;

CREATE POLICY "Users can create own support tickets"
    ON public.support_tickets FOR INSERT
    TO authenticated
    WITH CHECK ((select auth.uid()) = user_id);
