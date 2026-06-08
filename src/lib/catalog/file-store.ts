import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const CATALOG_DIR = path.join(process.cwd(), "data", "catalog");

export async function readCatalogJson<T>(filename: string): Promise<T | null> {
  try {
    const raw = await readFile(path.join(CATALOG_DIR, filename), "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export async function writeCatalogJson<T>(filename: string, payload: T): Promise<void> {
  await mkdir(CATALOG_DIR, { recursive: true });
  await writeFile(path.join(CATALOG_DIR, filename), `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

export function catalogDataPath(filename: string) {
  return path.join(CATALOG_DIR, filename);
}
