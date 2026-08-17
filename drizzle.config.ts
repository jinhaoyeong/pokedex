import { defineConfig } from "drizzle-kit";
import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());

function firstNonEmptyEnv(...keys: string[]) {
  for (const key of keys) {
    const value = process.env[key]?.trim();

    if (value) {
      return value;
    }
  }

  return "";
}

// Migrations prefer the direct connection (DIRECT_URL, port 5432) when set,
// so DATABASE_URL can stay on the Supabase transaction pooler (6543) for the app.
export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: firstNonEmptyEnv("DIRECT_URL", "DATABASE_URL"),
  },
});
