-- Signed-in Clerk account tables: RLS was enabled without policies, so the
-- Supabase transaction pooler role could not SELECT/INSERT users or settings.
-- Keep PostgREST (anon/authenticated) denied; allow server-side Drizzle.
DO $$
DECLARE
  tbl text;
  r text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'users',
    'user_settings',
    'binder_cards',
    'portfolio_items',
    'portfolio_transactions',
    'watchlist_items'
  ]
  LOOP
    IF to_regclass('public.' || tbl) IS NULL THEN
      CONTINUE;
    END IF;

    FOREACH r IN ARRAY ARRAY['anon', 'authenticated']
    LOOP
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
        EXECUTE format('REVOKE ALL ON TABLE public.%I FROM %I', tbl, r);
      END IF;
    END LOOP;

    EXECUTE format('DROP POLICY IF EXISTS server_account_all ON public.%I', tbl);
    EXECUTE format(
      'CREATE POLICY server_account_all ON public.%I FOR ALL USING (coalesce(nullif(current_setting(''request.jwt.claim.role'', true), ''''), '''') NOT IN (''anon'', ''authenticated'')) WITH CHECK (coalesce(nullif(current_setting(''request.jwt.claim.role'', true), ''''), '''') NOT IN (''anon'', ''authenticated''))',
      tbl
    );
  END LOOP;
END $$;
