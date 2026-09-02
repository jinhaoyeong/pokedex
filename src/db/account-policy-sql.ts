/**
 * Account tables had RLS enabled (0008) without policies. Catalog tables got
 * public SELECT policies, so Dex/search can still read. The Vercel connection
 * uses Supavisor (`postgres.<project-ref>` on port 6543), which does not
 * bypass RLS — so signed-in settings and vault queries fail.
 *
 * These tables are only used by the Next.js server (Drizzle), never PostgREST.
 * Ensure the tables exist, disable RLS, revoke Data API roles, and keep a
 * permissive server policy if RLS cannot be disabled. PostgREST
 * anon/authenticated stay denied.
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
  "market_estimate_diagnostics",
] as const;

function sqlStringLiteral(value: string) {
  return `'${value.replaceAll("'", "''")}'`;
}

const TABLE_ARRAY_SQL = ACCOUNT_TABLES.map((table) => sqlStringLiteral(table)).join(",\n    ");

/** Create Clerk account tables if migrations were never applied on this database. */
export const ACCOUNT_ENSURE_TABLES_SQL = `
CREATE TABLE IF NOT EXISTS public.users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  clerk_user_id text NOT NULL,
  email text,
  display_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS users_clerk_user_id_unique ON public.users (clerk_user_id);

CREATE TABLE IF NOT EXISTS public.user_settings (
  clerk_id text PRIMARY KEY NOT NULL REFERENCES public.users(clerk_user_id) ON DELETE CASCADE,
  preferred_currency text NOT NULL DEFAULT 'MYR',
  layout_preferences jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.binder_cards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  clerk_id text NOT NULL REFERENCES public.users(clerk_user_id) ON DELETE CASCADE,
  card_id text NOT NULL,
  name text NOT NULL DEFAULT '',
  image_url text NOT NULL DEFAULT '/icon.svg',
  market_price numeric(12, 2),
  quantity integer NOT NULL DEFAULT 1,
  notes text,
  added_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS binder_cards_clerk_card_unique ON public.binder_cards (clerk_id, card_id);
CREATE INDEX IF NOT EXISTS binder_cards_clerk_id_idx ON public.binder_cards (clerk_id);

CREATE TABLE IF NOT EXISTS public.market_observations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  card_slug text NOT NULL,
  source text NOT NULL,
  kind text NOT NULL,
  grade text NOT NULL DEFAULT 'Ungraded',
  contributor_key text NOT NULL DEFAULT '',
  set_code text,
  collector_number text,
  language text,
  card_name text,
  price_usd numeric(12, 2),
  currency text NOT NULL DEFAULT 'USD',
  metadata jsonb,
  observed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.market_observations ADD COLUMN IF NOT EXISTS grade text NOT NULL DEFAULT 'Ungraded';
ALTER TABLE public.market_observations ADD COLUMN IF NOT EXISTS contributor_key text NOT NULL DEFAULT '';
ALTER TABLE public.market_observations ADD COLUMN IF NOT EXISTS set_code text;
ALTER TABLE public.market_observations ADD COLUMN IF NOT EXISTS collector_number text;
ALTER TABLE public.market_observations ADD COLUMN IF NOT EXISTS language text;
ALTER TABLE public.market_observations ADD COLUMN IF NOT EXISTS card_name text;
CREATE INDEX IF NOT EXISTS market_observations_card_observed_idx ON public.market_observations (card_slug, observed_at);
CREATE INDEX IF NOT EXISTS market_observations_card_grade_idx ON public.market_observations (card_slug, grade, kind);
CREATE UNIQUE INDEX IF NOT EXISTS market_observations_contributor_unique
  ON public.market_observations (contributor_key, card_slug, grade, kind);
CREATE INDEX IF NOT EXISTS market_observations_print_idx
  ON public.market_observations (set_code, collector_number, language);

CREATE TABLE IF NOT EXISTS public.market_estimate_diagnostics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  fingerprint text NOT NULL,
  card_slug text NOT NULL,
  grade text NOT NULL,
  reason_code text NOT NULL,
  outcome text NOT NULL,
  evidence jsonb,
  occurrence_count integer NOT NULL DEFAULT 1,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  review_status text NOT NULL DEFAULT 'pending'
);
CREATE UNIQUE INDEX IF NOT EXISTS market_estimate_diagnostics_fingerprint_unique
  ON public.market_estimate_diagnostics (fingerprint);
CREATE INDEX IF NOT EXISTS market_estimate_diagnostics_card_idx
  ON public.market_estimate_diagnostics (card_slug, grade);
CREATE INDEX IF NOT EXISTS market_estimate_diagnostics_review_idx
  ON public.market_estimate_diagnostics (review_status, last_seen_at);
`.trim();

export const ACCOUNT_SERVER_POLICY_SQL = `
DO $$
DECLARE
  tbl text;
  r text;
  usr text := current_user;
  is_owner boolean;
  rls_on boolean;
  has_policy boolean;
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
      RAISE WARNING 'account policy: GRANT % to % failed: %', tbl, usr, SQLERRM;
    END;

    BEGIN
      EXECUTE format('ALTER TABLE public.%I NO FORCE ROW LEVEL SECURITY', tbl);
      EXECUTE format('ALTER TABLE public.%I DISABLE ROW LEVEL SECURITY', tbl);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'account policy: DISABLE RLS on % failed: %', tbl, SQLERRM;
    END;

    BEGIN
      EXECUTE format('DROP POLICY IF EXISTS server_account_all ON public.%I', tbl);
      EXECUTE format(
        'CREATE POLICY server_account_all ON public.%I FOR ALL USING (true) WITH CHECK (true)',
        tbl
      );
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'account policy: CREATE POLICY on % failed: %', tbl, SQLERRM;
    END;

    SELECT
      c.relowner = (SELECT oid FROM pg_roles WHERE rolname = usr),
      c.relrowsecurity
    INTO is_owner, rls_on
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = tbl;

    SELECT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public' AND tablename = tbl AND policyname = 'server_account_all'
    ) INTO has_policy;

    IF tbl IN ('users', 'user_settings', 'binder_cards')
       AND rls_on
       AND NOT is_owner
       AND NOT has_policy THEN
      RAISE EXCEPTION 'Cannot access public.%: RLS is enabled and role % cannot disable it or create a policy', tbl, usr;
    END IF;
  END LOOP;
END $$;
`.trim();
