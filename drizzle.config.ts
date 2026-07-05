import { defineConfig } from "drizzle-kit";

// Migrations prefer the direct connection (DIRECT_URL, port 5432) when set,
// so DATABASE_URL can stay on the Supabase transaction pooler (6543) for the app.
export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DIRECT_URL ?? process.env.DATABASE_URL ?? "",
  },
});
