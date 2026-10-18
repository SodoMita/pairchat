// Browser-only store. Persist encrypted transcripts, non-extractable identity
// keys and TOFU pins. Commit transactions before returning; never fall back to
// a silently different identity when storage is unavailable.
import { generateIdentityKeypair, type IdentityKeypair } from "./crypto";
import { validWire, type WireMessage } from "./protocol";
const DB_NAME = "chatterbox-e2ee";
const HISTORY_LIMIT = 500;

async function openDatabase(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") throw new Error("Local key storage is unavailable");
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 2);
    const timeout = setTimeout(() => reject(new Error("Local storage is blocked")), 8000);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("identity-keys")) db.createObjectStore("identity-keys");
      if (!db.objectStoreNames.contains("pins")) db.createObjectStore("pins");
      if (!db.objectStoreNames.contains("transcripts")) db.createObjectStore("transcripts", { keyPath: "storageId" }).createIndex("scope", "scope");
    };
    request.onsuccess = () => { clearTimeout(timeout); request.result.onversionchange = () => request.result.close(); resolve(request.result); };
    request.onerror = () => { clearTimeout(timeout); reject(request.error); };
    request.onblocked = () => { clearTimeout(timeout); reject(new Error("Close older tabs to upgrade local storage")); };
  });
}

async function atomic<T>(storeName: string, operation: (store: IDBObjectStore, result: (value: T) => void) => void): Promise<T> {
  const db = await openDatabase();
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(storeName, "readwrite");
    let output: T;
    tx.oncomplete = () => { db.close(); resolve(output); };
    tx.onerror = tx.onabort = () => { db.close(); reject(tx.error ?? new Error("Local transaction failed")); };
    try { operation(tx.objectStore(storeName), value => { output = value; }); }
    catch (e) { tx.abort(); db.close(); reject(e); }
  });
}

export async function loadOrCreateIdentityKeypair(storageId: string): Promise<IdentityKeypair> {
  const candidate = await generateIdentityKeypair();
  return atomic("identity-keys", (store, done) => {
    const request = store.get(storageId);
    request.onsuccess = () => {
      const existing = request.result as IdentityKeypair | undefined;
      if (existing?.privateKey?.type === "private" && existing.privateKey.algorithm.name === "X25519") {
        done({ privateKey: existing.privateKey, publicKey: new Uint8Array(existing.publicKey) });
      } else if (existing) { store.transaction.abort(); }
      else { store.put(candidate, storageId); done(candidate); }
    };
  });
}

export async function loadIdentity(storageId: string): Promise<IdentityKeypair | null> {
  return atomic("identity-keys", (store, done) => {
    const request = store.get(storageId);
    request.onsuccess = () => done(request.result ?? null);
  });
}
export async function loadPartnerPin(storageId: string): Promise<string | null> {
  return atomic("pins", (store, done) => {
    const request = store.get(storageId);
    request.onsuccess = () => done(typeof request.result === "string" ? request.result : null);
  });
}

export async function pinPartner(storageId: string, publicKey: string): Promise<void> {
  const matches = await atomic<boolean>("pins", (store, done) => {
    const request = store.get(storageId);
    request.onsuccess = () => {
      if (request.result && request.result !== publicKey) { done(false); return; }
      store.put(publicKey, storageId);
      done(true);
    };
  });
  if (!matches) throw new Error("The partner's encryption key changed. Start a new chat.");
}

export async function saveEnvelope(message: WireMessage): Promise<void> {
  if (!validWire(message, message.scope)) throw new Error("Invalid encrypted transcript");
  await atomic<void>("transcripts", (store, done) => {
    store.put({ ...message, storageId: `${message.scope}/${message.id}` });
    const request = store.index("scope").getAll(IDBKeyRange.only(message.scope));
    request.onsuccess = () => {
      const rows = request.result as (WireMessage & { storageId: string })[];
      rows.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      for (const row of rows.slice(0, Math.max(0, rows.length - HISTORY_LIMIT))) store.delete(row.storageId);
      done();
    };
  });
}
export async function loadHistory(scope: string): Promise<WireMessage[]> {
  return atomic("transcripts", (store, done) => {
    const request = store.index("scope").getAll(IDBKeyRange.only(scope));
    request.onsuccess = () => done((request.result as WireMessage[]).filter(m => validWire(m, scope)).sort((a, b) => a.createdAt.localeCompare(b.createdAt)));
  });
}
export async function deleteHistory(scope: string): Promise<void> {
  await atomic<void>("transcripts", (store, done) => {
    const request = store.index("scope").openKeyCursor(IDBKeyRange.only(scope));
    request.onsuccess = () => { const cursor = request.result; if (cursor) { store.delete(cursor.primaryKey); cursor.continue(); } else done(); };
  });
}
