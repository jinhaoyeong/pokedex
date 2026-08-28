/**
 * Account tables had RLS enabled (0008) without policies. Catalog tables got
 * public SELECT policies, so Dex/search can still read. The Vercel connection
 * uses Supavisor (`postgres.<project-ref>` on port 6543), which does not
 * bypass RLS — so signed-in settings and vault queries fail.
 *
 * Policies allow any non-Data-API role (no JWT, or a role other than
 * anon/authenticated). PostgREST keeps using anon/authenticated and is denied.
 * Revoke table grants from those roles as extra defense.
 */
export const ACCOUNT_TABLES = [
  "users",
  "user_settings",
  "binder_cards",
  "portfolio_items",
  "portfolio_transactions",
  "watchlist_items",
] as const;

export const ACCOUNT_SERVER_POLICY_SQL = `
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
`.trim();
