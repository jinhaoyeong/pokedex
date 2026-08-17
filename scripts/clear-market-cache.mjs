import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const dataDir = path.join(root, "data");
const targets = [
  path.join(dataDir, "market-page-cache", "open-source-market"),
  path.join(dataDir, "pokemon-prices-cache.sqlite"),
  path.join(dataDir, "pokemon-prices-cache.sqlite-shm"),
  path.join(dataDir, "pokemon-prices-cache.sqlite-wal"),
  path.join(dataDir, "pokemon-cards-cache.sqlite"),
  path.join(dataDir, "pokemon-cards-cache.sqlite-shm"),
  path.join(dataDir, "pokemon-cards-cache.sqlite-wal"),
  path.join(dataDir, "pokemon-search-cache.sqlite"),
  path.join(dataDir, "pokemon-search-cache.sqlite-shm"),
  path.join(dataDir, "pokemon-search-cache.sqlite-wal"),
  path.join(dataDir, "pokemon-psa-population.sqlite"),
  path.join(dataDir, "pokemon-psa-population.sqlite-shm"),
  path.join(dataDir, "pokemon-psa-population.sqlite-wal"),
];

function assertInsideDataDir(target) {
  const relative = path.relative(dataDir, target);

  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Refusing to remove outside data directory: ${target}`);
  }
}

let removed = 0;
const failed = [];

for (const target of targets) {
  assertInsideDataDir(target);

  if (!fs.existsSync(target)) {
    continue;
  }

  try {
    fs.rmSync(target, { recursive: true, force: true });
    removed += 1;
    console.log(`Removed ${path.relative(root, target)}`);
  } catch (error) {
    failed.push({ target, error });
    const reason = error instanceof Error ? error.message : String(error);
    console.warn(`Could not remove ${path.relative(root, target)}: ${reason}`);
  }
}

console.log(
  removed
    ? `Cleared ${removed} volatile market cache target${removed === 1 ? "" : "s"}.`
    : "No volatile market cache files were present.",
);

if (failed.length) {
  console.warn(
    "Some cache files are locked. Stop the local dev server and rerun npm run cache:clear-market.",
  );
  process.exitCode = 1;
}
