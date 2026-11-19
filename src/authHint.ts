// Does this device hold a signed-in Firebase user? Read straight from the IndexedDB that Firebase Auth writes, so the signed-out
// title, the intro and the sign-in cards can show without loading Auth or Firestore (no Google script, no auth iframe, no request).
// Any doubt answers true, so the app then starts Auth as it always did and never strands a signed-in device or a pending redirect.

const DB = 'firebaseLocalStorageDb';
const STORE = 'firebaseLocalStorage';

export async function mayHaveAuthSession(): Promise<boolean> {
  try {
    if (typeof indexedDB === 'undefined') return true;
    // A sign-in by redirect finishes on the next page load and needs Auth to read the result.
    for (let i = 0; i < sessionStorage.length; i++) if (sessionStorage.key(i)?.startsWith('firebase:pendingRedirect')) return true;
    if (typeof indexedDB.databases !== 'function') return true;
    const dbs = await indexedDB.databases();
    if (!dbs.some((d) => d.name === DB)) return false;
    return await new Promise<boolean>((resolve) => {
      const open = indexedDB.open(DB);
      open.onerror = () => resolve(true);
      open.onsuccess = () => {
        const db = open.result;
        if (!db.objectStoreNames.contains(STORE)) {
          db.close();
          resolve(false);
          return;
        }
        const req = db.transaction(STORE, 'readonly').objectStore(STORE).getAllKeys();
        req.onerror = () => {
          db.close();
          resolve(true);
        };
        req.onsuccess = () => {
          db.close();
          resolve(req.result.some((k) => String(k).startsWith('firebase:authUser:')));
        };
      };
    });
  } catch {
    return true;
  }
}
