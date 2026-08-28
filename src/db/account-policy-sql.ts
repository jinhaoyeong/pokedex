/**
 * Account tables had RLS enabled (0008) without policies. Catalog tables got
 * public SELECT policies, so Dex/search can still read. The Vercel connection
 * uses Supavisor (`postgres.<project-ref>` on port 6543), which does not
 * bypass RLS — so signed-in settings and vault queries fail.
 *
 * These tables are only used by the Next.js server (Drizzle), never PostgREST.
 * Disable RLS, revoke Data API roles, and keep a server policy in case RLS is
 * turned back on. PostgREST anon/authenticated stay denied.
 */

export const ACCOUNT_TABLES = [
  "users",
  "user_settings",
  "binder_cards",
  "portfolio_items",
  "portfolio_transactions",
  "watchlist_items",
  "price_snapshots",
  "market_observations",
] as const;

function sqlStringLiteral(value: string) {
  return `'${value.replaceAll("'", "''")}'`;
}

const TABLE_ARRAY_SQL = ACCOUNT_TABLES.map((table) => sqlStringLiteral(table)).join(",\n    ");

export const ACCOUNT_SERVER_POLICY_SQL = `
DO $$
DECLARE
  tbl text;
  r text;
  usr text := current_user;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    ${TABLE_ARRAY_SQL}
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

    BEGIN
      EXECUTE format('GRANT ALL ON TABLE public.%I TO %I', tbl, usr);
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;

    BEGIN
      EXECUTE format('ALTER TABLE public.%I NO FORCE ROW LEVEL SECURITY', tbl);
      EXECUTE format('ALTER TABLE public.%I DISABLE ROW LEVEL SECURITY', tbl);
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;

    BEGIN
      EXECUTE format('DROP POLICY IF EXISTS server_account_all ON public.%I', tbl);
      EXECUTE format(
        'CREATE POLICY server_account_all ON public.%I FOR ALL USING (coalesce(nullif(current_setting(''request.jwt.claim.role'', true), ''''), '''') NOT IN (''anon'', ''authenticated'')) WITH CHECK (coalesce(nullif(current_setting(''request.jwt.claim.role'', true), ''''), '''') NOT IN (''anon'', ''authenticated''))',
        tbl
      );
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
  END LOOP;
END $$;
`.trim();
