import dns from "node:dns";

try {
  dns.setDefaultResultOrder("ipv4first");
} catch {
  // Node without setDefaultResultOrder
}

const DATABASE_URL_KEYS = [
  "DATABASE_URL",
  "POSTGRES_URL",
  "POSTGRES_PRISMA_URL",
  "POSTGRES_URL_NON_POOLING",
] as const;

const PROJECT_REF_ENV_KEYS = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "SUPABASE_URL",
  "DATABASE_URL",
  "POSTGRES_URL",
  "POSTGRES_PRISMA_URL",
  "POSTGRES_URL_NON_POOLING",
  "DIRECT_URL",
] as const;

export function isSupabaseHost(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return (
      host.endsWith(".supabase.co") ||
      host.endsWith(".supabase.com") ||
      host.includes("pooler.supabase")
    );
  } catch {
    return false;
  }
}

export function isPooledSupabaseUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.hostname.toLowerCase().includes("pooler.supabase") || parsed.port === "6543";
  } catch {
    return false;
  }
}

export function extractSupabaseProjectRef(
  value: string | undefined,
): string | null {
  if (!value?.trim()) {
    return null;
  }

  try {
    const parsed = new URL(value);
    const host = parsed.hostname.toLowerCase();
    const hosted = host.match(/^([a-z0-9]+)\.supabase\.co$/i);
    if (hosted) {
      return hosted[1];
    }

    const dbHost = host.match(/^db\.([a-z0-9]+)\.supabase\.co$/i);
    if (dbHost) {
      return dbHost[1];
    }

    const user = decodeURIComponent(parsed.username);
    const userRef = user.match(/^postgres\.([a-z0-9]+)$/i);
    if (userRef) {
      return userRef[1];
    }
  } catch {
    const hosted = value.match(/https?:\/\/([a-z0-9]+)\.supabase\.co/i);
    if (hosted) {
      return hosted[1];
    }
  }

  return null;
}

export function resolveSupabaseProjectRef(
  env: NodeJS.Dict<string | undefined> = process.env,
): string | null {
  for (const key of PROJECT_REF_ENV_KEYS) {
    const ref = extractSupabaseProjectRef(env[key]);
    if (ref) {
      return ref;
    }
  }

  return null;
}

/**
 * The transaction pooler requires `postgres.<project-ref>` as the database
 * user. A copied URI that still uses `postgres` fails with "Tenant or user
 * not found".
 */
export function rewriteSupabasePoolerUsername(
  url: string,
  env: NodeJS.Dict<string | undefined> = process.env,
): string {
  try {
    const parsed = new URL(url);
    if (!parsed.hostname.toLowerCase().includes("pooler.supabase")) {
      return url;
    }

    const user = decodeURIComponent(parsed.username);
    if (!user || user.includes(".")) {
      return url;
    }

    const ref = resolveSupabaseProjectRef(env);
    if (!ref) {
      return url;
    }

    parsed.username = `${user}.${ref}`;
    return parsed.toString();
  } catch {
    return url;
  }
}

export function resolveDatabaseUrl(env: NodeJS.Dict<string | undefined> = process.env): string {
  const values = DATABASE_URL_KEYS.map((key) => env[key]?.trim()).filter(
    (value): value is string => Boolean(value),
  );

  const resolved = values.find((url) => isPooledSupabaseUrl(url)) ?? values[0] ?? "";
  return resolved ? rewriteSupabasePoolerUsername(resolved, env) : "";
}

export function buildPostgresOptions(
  url: string,
  env: NodeJS.Dict<string | undefined> = process.env,
) {
  const poolMax = Number.parseInt(env.DATABASE_POOL_MAX ?? "", 10);
  const onVercel = Boolean(env.VERCEL);
  const supabase = isSupabaseHost(url);

  return {
    prepare: false as const,
    max: Number.isFinite(poolMax) && poolMax > 0 ? poolMax : onVercel ? 3 : 10,
    idle_timeout: 20,
    connect_timeout: supabase ? 10 : 5,
    ssl: supabase ? ("require" as const) : undefined,
  };
}

export function isRetryableDbError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /connect|timeout|ECONN|ENOTFOUND|EAI_AGAIN|SSL|closed|terminat|too many clients|row-level security|42501|permission denied|Tenant or user not found/i.test(
    message,
  );
}
