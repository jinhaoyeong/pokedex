-- Signed-in Clerk account tables: RLS was enabled without policies, so the
-- Supabase transaction pooler role could not SELECT/INSERT users or settings.
-- Create tables if missing, disable RLS on server-only tables, revoke
-- PostgREST roles, and keep a permissive server_account_all policy if RLS
-- cannot be turned off.

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
    'users',
    'user_settings',
    'binder_cards',
    'portfolio_items',
    'portfolio_transactions',
    'watchlist_items',
    'price_snapshots',
    'market_observations'
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
