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

export function resolveDatabaseUrl(env: NodeJS.Dict<string | undefined> = process.env): string {
  const values = DATABASE_URL_KEYS.map((key) => env[key]?.trim()).filter(
    (value): value is string => Boolean(value),
  );

  return values.find((url) => isPooledSupabaseUrl(url)) ?? values[0] ?? "";
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
