/**
 * Browser-side persistence for the scanner's "learning" layer (IndexedDB).
 *
 * Two stores, both zero-cost and growing from real usage:
 *  - `cardEmbeddings`: card art embedding/hash keyed by card id. This is the
 *    catalog index — it fills in organically as cards are scanned, so we never
 *    need a massive precomputed upload.
 *  - `scanMemory`: signatures of photos the user confirmed, mapped to the card
 *    they chose. New scans are matched against these first for instant hits.
 */

const DB_NAME = "pokedex-scan";
const DB_VERSION = 1;
const CARD_STORE = "cardEmbeddings";
const MEMORY_STORE = "scanMemory";
const MEMORY_LIMIT = 500;

export interface CardSignature {
  /** L2-normalized CLIP embedding, when the neural model produced one. */
  vector?: Float32Array;
  /** dHash serialized as a decimal string. */
  hash?: string;
}

export interface ScanMemory extends CardSignature {
  cardId: string;
  slug: string;
  name: string;
  addedAt: number;
}

let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDb(): Promise<IDBDatabase | null> {
  if (dbPromise) {
    return dbPromise;
  }
  dbPromise = new Promise((resolve) => {
    if (typeof indexedDB === "undefined") {
      resolve(null);
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(CARD_STORE)) {
        db.createObjectStore(CARD_STORE, { keyPath: "cardId" });
      }
      if (!db.objectStoreNames.contains(MEMORY_STORE)) {
        const store = db.createObjectStore(MEMORY_STORE, {
          keyPath: "id",
          autoIncrement: true,
        });
        store.createIndex("addedAt", "addedAt");
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
  });
  return dbPromise;
}

function tx(
  db: IDBDatabase,
  store: string,
  mode: IDBTransactionMode,
): IDBObjectStore {
  return db.transaction(store, mode).objectStore(store);
}

function promisifyRequest<T>(request: IDBRequest<T>): Promise<T | null> {
  return new Promise((resolve) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
  });
}

/** Look up a cached art signature for a card id. */
export async function getCardSignature(
  cardId: string,
): Promise<CardSignature | null> {
  const db = await openDb();
  if (!db) return null;
  const record = await promisifyRequest(
    tx(db, CARD_STORE, "readonly").get(cardId),
  );
  if (!record) return null;
  const { vector, hash } = record as { vector?: Float32Array; hash?: string };
  return { vector, hash };
}

/** Cache an art signature for a card id (merges with any existing fields). */
export async function putCardSignature(
  cardId: string,
  signature: CardSignature,
): Promise<void> {
  const db = await openDb();
  if (!db) return;
  const existing = (await getCardSignature(cardId)) ?? {};
  const merged = {
    cardId,
    vector: signature.vector ?? existing.vector,
    hash: signature.hash ?? existing.hash,
  };
  await promisifyRequest(tx(db, CARD_STORE, "readwrite").put(merged));
}

/** Record a confirmed photo → card mapping for future instant matching. */
export async function rememberScan(memory: ScanMemory): Promise<void> {
  const db = await openDb();
  if (!db) return;
  await promisifyRequest(tx(db, MEMORY_STORE, "readwrite").add(memory));
  await trimMemory(db);
}

/** Read back all remembered scans (most recent first, capped). */
export async function recallScans(): Promise<ScanMemory[]> {
  const db = await openDb();
  if (!db) return [];
  const all = await promisifyRequest(tx(db, MEMORY_STORE, "readonly").getAll());
  if (!Array.isArray(all)) return [];
  return (all as ScanMemory[]).sort((a, b) => b.addedAt - a.addedAt);
}

/** Keep the memory store bounded by evicting the oldest entries. */
async function trimMemory(db: IDBDatabase): Promise<void> {
  const store = tx(db, MEMORY_STORE, "readwrite");
  const count = await promisifyRequest(store.count());
  if (typeof count !== "number" || count <= MEMORY_LIMIT) {
    return;
  }
  const overflow = count - MEMORY_LIMIT;
  const index = store.index("addedAt");
  let removed = 0;
  index.openCursor().onsuccess = (event) => {
    const cursor = (event.target as IDBRequest<IDBCursorWithValue | null>)
      .result;
    if (!cursor || removed >= overflow) {
      return;
    }
    cursor.delete();
    removed += 1;
    cursor.continue();
  };
}
