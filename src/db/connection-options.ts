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
  "SUPABASE_POOLER_URL",
] as const;

const PROJECT_REF_ENV_KEYS = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "SUPABASE_URL",
  "DATABASE_URL",
  "POSTGRES_URL",
  "POSTGRES_PRISMA_URL",
  "POSTGRES_URL_NON_POOLING",
  "DIRECT_URL",
  "SUPABASE_POOLER_URL",
] as const;

/** Vercel city codes → AWS regions used by Supavisor (`aws-0-<region>.pooler.supabase.com`). */
const VERCEL_REGION_TO_AWS: Record<string, string> = {
  sin1: "ap-southeast-1",
  syd1: "ap-southeast-2",
  hnd1: "ap-northeast-1",
  kix1: "ap-northeast-3",
  icn1: "ap-northeast-2",
  iad1: "us-east-1",
  cle1: "us-east-2",
  sfo1: "us-west-1",
  pdx1: "us-west-2",
  lhr1: "eu-west-2",
  dub1: "eu-west-1",
  cdg1: "eu-west-3",
  fra1: "eu-central-1",
  arn1: "eu-north-1",
  gru1: "sa-east-1",
};

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

export function extractSupabasePoolerRegion(value: string | undefined): string | null {
  if (!value?.trim()) {
    return null;
  }

  try {
    const host = new URL(value).hostname.toLowerCase();
    const matched = host.match(/^aws-(?:\d+-)?([a-z0-9-]+)\.pooler\.supabase\./i);
    return matched?.[1] ?? null;
  } catch {
    return null;
  }
}

export function resolveSupabasePoolerRegion(
  env: NodeJS.Dict<string | undefined> = process.env,
): string | null {
  const explicit = env.SUPABASE_REGION?.trim().replace(/^aws-(?:\d+-)?/, "") ?? "";
  if (explicit) {
    return explicit;
  }

  for (const key of PROJECT_REF_ENV_KEYS) {
    const region = extractSupabasePoolerRegion(env[key]);
    if (region) {
      return region;
    }
  }

  const vercelRegion = env.VERCEL_REGION?.trim().toLowerCase();
  if (vercelRegion && VERCEL_REGION_TO_AWS[vercelRegion]) {
    return VERCEL_REGION_TO_AWS[vercelRegion];
  }

  return null;
}

function withProjectRefUsername(user: string, projectRef: string | null): string {
  const normalized = user.trim() || "postgres";
  if (!projectRef || normalized.includes(".")) {
    return normalized;
  }

  return `${normalized}.${projectRef}`;
}

/**
 * The transaction pooler requires `postgres.<project-ref>` as the database
 * user. A copied URI that still uses `postgres` fails with "Tenant or user
 * not found". Direct `db.<ref>.supabase.co` hosts need the same username
 * when rewritten onto port 6543.
 */
export function rewriteSupabasePoolerUsername(
  url: string,
  env: NodeJS.Dict<string | undefined> = process.env,
): string {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    const usesPoolerUser =
      host.includes("pooler.supabase") || parsed.port === "6543" || host.startsWith("db.");

    if (!usesPoolerUser) {
      return url;
    }

    const user = decodeURIComponent(parsed.username);
    if (!user || user.includes(".")) {
      return url;
    }

    const ref = resolveSupabaseProjectRef(env) ?? extractSupabaseProjectRef(url);
    if (!ref) {
      return url;
    }

    parsed.username = withProjectRefUsername(user, ref);
    return parsed.toString();
  } catch {
    return url;
  }
}

/**
 * Vercel is IPv4-only. Direct `db.<ref>.supabase.co:5432` is IPv6-only unless
 * the project has the IPv4 add-on, so signed-in Settings fail to sync.
 * Prefer the shared Supavisor host when the region is known; otherwise use
 * the dedicated pooler port (6543) on the same db host.
 */
export function rewriteSupabaseDirectToPooler(
  url: string,
  env: NodeJS.Dict<string | undefined> = process.env,
): string {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();

    if (host.includes("pooler.supabase")) {
      return url;
    }

    const dbHost = host.match(/^db\.([a-z0-9]+)\.supabase\.co$/i);
    if (!dbHost) {
      return url;
    }

    const projectRef = dbHost[1];
    const user = withProjectRefUsername(
      decodeURIComponent(parsed.username),
      projectRef,
    );
    const region = resolveSupabasePoolerRegion(env);

    if (region) {
      parsed.hostname = `aws-0-${region}.pooler.supabase.com`;
      parsed.port = "6543";
      parsed.username = user;
      parsed.protocol = "postgresql:";
      return parsed.toString();
    }

    if (parsed.port !== "6543") {
      parsed.port = "6543";
    }
    parsed.username = user;
    return parsed.toString();
  } catch {
    return url;
  }
}

export function normalizeSupabaseRuntimeUrl(
  url: string,
  env: NodeJS.Dict<string | undefined> = process.env,
): string {
  return rewriteSupabaseDirectToPooler(rewriteSupabasePoolerUsername(url, env), env);
}

export function resolveDatabaseUrl(env: NodeJS.Dict<string | undefined> = process.env): string {
  const values = DATABASE_URL_KEYS.map((key) => env[key]?.trim()).filter(
    (value): value is string => Boolean(value),
  );

  const resolved = values.find((url) => isPooledSupabaseUrl(url)) ?? values[0] ?? "";
  return resolved ? normalizeSupabaseRuntimeUrl(resolved, env) : "";
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
  return /connect|timeout|ECONN|ENETUNREACH|ENOTFOUND|EAI_AGAIN|SSL|closed|terminat|too many clients|row-level security|42501|permission denied|Tenant or user not found|Could not sync Clerk user|Cannot access public\.users|account table/i.test(
    message,
  );
}
