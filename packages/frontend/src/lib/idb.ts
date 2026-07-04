/**
 * IndexedDB 存储层（原生 API 封装，无第三方依赖）
 * 
 * 三个 store：
 * - voices: 自建音色（design/clone），全局共享
 * - voice_samples: 复刻样本音频 Blob，全局共享
 * - projects: 项目自动保存
 */

const DB_NAME = 'webframes';
const DB_VERSION = 1;

let dbPromise: Promise<IDBDatabase> | null = null;

function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('voices')) {
        db.createObjectStore('voices', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('voice_samples')) {
        db.createObjectStore('voice_samples', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('projects')) {
        db.createObjectStore('projects', { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx<T>(
  storeName: string,
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return openDB().then(
    db =>
      new Promise<T>((resolve, reject) => {
        const transaction = db.transaction(storeName, mode);
        const store = transaction.objectStore(storeName);
        const request = fn(store);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      }),
  );
}

// ==================== Voices ====================

export async function idbGetAllVoices<T>(): Promise<T[]> {
  return tx<T[]>('voices', 'readonly', s => s.getAll() as IDBRequest<T[]>);
}

export async function idbPutVoice<T extends { id: string }>(voice: T): Promise<void> {
  await tx('voices', 'readwrite', s => s.put(voice));
}

export async function idbDeleteVoice(id: string): Promise<void> {
  await tx('voices', 'readwrite', s => s.delete(id));
}

export async function idbGetVoice<T>(id: string): Promise<T | undefined> {
  return tx<T | undefined>('voices', 'readonly', s => s.get(id) as IDBRequest<T | undefined>);
}

// ==================== Voice Samples ====================

export async function idbGetAllSamples<T>(): Promise<T[]> {
  return tx<T[]>('voice_samples', 'readonly', s => s.getAll() as IDBRequest<T[]>);
}

export async function idbPutSample<T extends { id: string }>(sample: T): Promise<void> {
  await tx('voice_samples', 'readwrite', s => s.put(sample));
}

export async function idbGetSample<T>(id: string): Promise<T | undefined> {
  return tx<T | undefined>('voice_samples', 'readonly', s => s.get(id) as IDBRequest<T | undefined>);
}

export async function idbDeleteSample(id: string): Promise<void> {
  await tx('voice_samples', 'readwrite', s => s.delete(id));
}

// ==================== Projects ====================

export async function idbGetAllProjects<T>(): Promise<T[]> {
  return tx<T[]>('projects', 'readonly', s => s.getAll() as IDBRequest<T[]>);
}

export async function idbPutProject<T extends { id: string }>(project: T): Promise<void> {
  await tx('projects', 'readwrite', s => s.put(project));
}

export async function idbGetProject<T>(id: string): Promise<T | undefined> {
  return tx<T | undefined>('projects', 'readonly', s => s.get(id) as IDBRequest<T | undefined>);
}

export async function idbDeleteProject(id: string): Promise<void> {
  await tx('projects', 'readwrite', s => s.delete(id));
}
