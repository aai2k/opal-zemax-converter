import type { Glass } from "../core/agf.ts";

export interface StoredCatalog {
  name: string;
  fileName: string;
  glasses: Glass[];
  addedAt: number;
}

const DB = "opal-zemax-converter";
const STORE = "catalogs";

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "name" });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const req = fn(t.objectStore(STORE));
    t.oncomplete = () => {
      db.close();
      resolve(req ? req.result : undefined);
    };
    t.onerror = () => reject(t.error);
  });
}

export async function loadCatalogs(): Promise<StoredCatalog[]> {
  try {
    return ((await tx("readonly", (s) => s.getAll())) as StoredCatalog[] | undefined) ?? [];
  } catch {
    return [];
  }
}

export async function saveCatalogs(cats: StoredCatalog[]): Promise<void> {
  try {
    await tx("readwrite", (s) => {
      for (const c of cats) s.put(c);
    });
  } catch {
    // storage unavailable (private mode): catalogs stay in memory for this session
  }
}

export async function deleteCatalog(name: string): Promise<void> {
  try {
    await tx("readwrite", (s) => s.delete(name));
  } catch {
    // ignore
  }
}

export async function clearCatalogs(): Promise<void> {
  try {
    await tx("readwrite", (s) => s.clear());
  } catch {
    // ignore
  }
}
