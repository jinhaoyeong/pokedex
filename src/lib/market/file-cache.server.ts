import "server-only";

import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

const CACHE_ROOT = path.join(process.cwd(), "data", "market-page-cache");

function cachePath(namespace: string, key: string) {
  const hash = crypto.createHash("sha256").update(key).digest("hex");
  return path.join(CACHE_ROOT, namespace, `${hash}.json`);
}

export async function readMarketFileCache<T>(
  namespace: string,
  key: string,
  ttlMs: number,
): Promise<T | null> {
  try {
    const file = cachePath(namespace, key);
    const raw = await fs.readFile(file, "utf8");
    const parsed = JSON.parse(raw) as { savedAt: string; value: T };
    const savedAt = Date.parse(parsed.savedAt);

    if (!Number.isFinite(savedAt) || Date.now() - savedAt > ttlMs) {
      return null;
    }

    return parsed.value;
  } catch {
    return null;
  }
}

export async function writeMarketFileCache<T>(
  namespace: string,
  key: string,
  value: T,
): Promise<void> {
  const file = cachePath(namespace, key);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(
    file,
    JSON.stringify({ savedAt: new Date().toISOString(), value }, null, 2),
    "utf8",
  );
}
