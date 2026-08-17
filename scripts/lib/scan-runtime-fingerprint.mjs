import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const RUNTIME_DIRECTORY = path.join("src", "lib", "scan");
const RUNTIME_FILES = [
  path.join("src", "components", "search", "scan-button.tsx"),
  path.join("src", "app", "api", "visual-search", "route.ts"),
];

function posixPath(filePath) {
  return filePath.split(path.sep).join("/");
}

function framedLength(value) {
  const frame = Buffer.allocUnsafe(8);
  frame.writeBigUInt64BE(BigInt(value));
  return frame;
}

function filesUnder(directory, root) {
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...filesUnder(absolutePath, root));
    } else if (entry.isFile()) {
      files.push(posixPath(path.relative(root, absolutePath)));
    }
  }
  return files;
}

export function sha256File(filePath) {
  return createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

/**
 * Hash every scanner runtime source with an unambiguous path/byte framing.
 * Relative POSIX paths are sorted so the digest is stable across platforms.
 */
export function computeScanRuntimeFingerprint(rootDirectory) {
  const root = path.resolve(rootDirectory);
  const scanDirectory = path.join(root, RUNTIME_DIRECTORY);
  if (!fs.statSync(scanDirectory).isDirectory()) {
    throw new Error(`${posixPath(RUNTIME_DIRECTORY)} is not a directory`);
  }

  const sourcePaths = [
    ...filesUnder(scanDirectory, root),
    ...RUNTIME_FILES.map(posixPath),
  ].sort();
  const uniquePaths = [...new Set(sourcePaths)];
  const hash = createHash("sha256");
  const files = [];

  hash.update("pokedex-scan-runtime-fingerprint-v1\0", "utf8");
  for (const relativePath of uniquePaths) {
    const absolutePath = path.join(root, ...relativePath.split("/"));
    const contents = fs.readFileSync(absolutePath);
    const pathBytes = Buffer.from(relativePath, "utf8");
    hash.update(framedLength(pathBytes.length));
    hash.update(pathBytes);
    hash.update(framedLength(contents.length));
    hash.update(contents);
    files.push({ path: relativePath, bytes: contents.length });
  }

  return {
    schemaVersion: 1,
    algorithm: "sha256",
    digest: hash.digest("hex"),
    files,
  };
}
