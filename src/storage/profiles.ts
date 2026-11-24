import type { Profile } from '../model/profile';

const DB_NAME = 'timbre';
const DB_VERSION = 1;
const STORE = 'profiles';

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB is not available in this browser.'));
      return;
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Could not open the profile store.'));
  });

  return dbPromise;
}

/** Newest first. */
export async function listProfiles(): Promise<Profile[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const request = db.transaction(STORE, 'readonly').objectStore(STORE).getAll();
    request.onsuccess = () => {
      const profiles = (request.result as Profile[]).slice();
      profiles.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      resolve(profiles);
    };
    request.onerror = () => reject(request.error ?? new Error('Could not read profiles.'));
  });
}

export async function putProfile(profile: Profile): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const request = db.transaction(STORE, 'readwrite').objectStore(STORE).put(profile);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error ?? new Error('Could not save the profile.'));
  });
}

export async function removeProfile(id: string): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const request = db.transaction(STORE, 'readwrite').objectStore(STORE).delete(id);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error ?? new Error('Could not delete the profile.'));
  });
}
