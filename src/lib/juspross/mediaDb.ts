/** Guarda en el navegador (IndexedDB) los archivos de las imágenes y videos creados. */
const DB = "juspross-media";
const STORE = "blobs";

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") return reject(new Error("IndexedDB no disponible"));
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE, { keyPath: "id" });
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

async function run<T>(
  mode: IDBTransactionMode,
  fn: (s: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await open();
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const req = fn(tx.objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    tx.oncomplete = () => db.close();
  });
}

export async function putBlob(id: string, blob: Blob): Promise<void> {
  await run("readwrite", (s) => s.put({ id, blob }));
}
export async function getBlob(id: string): Promise<Blob | null> {
  const r = (await run("readonly", (s) => s.get(id))) as { blob?: Blob } | undefined;
  return r?.blob ?? null;
}
export async function delBlob(id: string): Promise<void> {
  await run("readwrite", (s) => s.delete(id));
}
export async function clearBlobs(): Promise<void> {
  await run("readwrite", (s) => s.clear());
}
