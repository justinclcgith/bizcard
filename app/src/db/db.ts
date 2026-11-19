/** IndexedDB（docs/03 §7）。 */
import { openDB } from 'idb';
import type { DBSchema, IDBPDatabase } from 'idb';
import type { Box, CardFields, Orientation, Provider } from '../lib/types';
import type { Contact } from '../lib/contact';

export interface DraftCard {
  tempId: string;
  box: Box;
  orientation: Orientation;
  fields: CardFields;
  lowConfidenceFields: string[];
  provider: Provider | 'manual';
  model: string;
  back?: { blob: Blob; width: number; height: number } | null;
}

export interface Draft {
  localId: string;
  createdAt: number;
  photo: { blob: Blob; width: number; height: number };
  /** queued：離線時拍的照片，連線後自動辨識 */
  status: 'recognizing' | 'review' | 'compare' | 'error' | 'queued';
  provider: Provider | 'compare';
  cards: DraftCard[];
  /** 比較模式的兩家原始結果 */
  compare?: Partial<Record<Provider, { cards: DraftCard[]; error?: string; model: string }>>;
  error?: string;
  batch: { tags: string; event: string; metDate: string };
}

interface BizcardDB extends DBSchema {
  drafts: { key: string; value: Draft; indexes: { byCreated: number } };
  contacts: { key: string; value: Contact };
  images: { key: [string, string]; value: { fileId: string; size: 'thumb' | 'full'; blob: Blob } };
  photoQueue: { key: string; value: { localId: string; blob: Blob; createdAt: number; status: string } };
  pendingChanges: { key: number; value: PendingChange };
  meta: { key: string; value: unknown };
}

export type PendingChange =
  | { kind: 'update'; id: string; fields: Record<string, string>; baseUpdatedAt: string; recordTitleChange: boolean; at: number }
  | { kind: 'delete'; id: string; at: number };

let dbPromise: Promise<IDBPDatabase<BizcardDB>> | null = null;

export function getDb(): Promise<IDBPDatabase<BizcardDB>> {
  dbPromise ??= openDB<BizcardDB>('bizcard', 2, {
    upgrade(db, oldVersion) {
      if (oldVersion < 1) {
        const drafts = db.createObjectStore('drafts', { keyPath: 'localId' });
        drafts.createIndex('byCreated', 'createdAt');
        db.createObjectStore('contacts', { keyPath: 'id' });
        db.createObjectStore('photoQueue', { keyPath: 'localId' });
        db.createObjectStore('pendingChanges', { autoIncrement: true });
        db.createObjectStore('meta');
      }
      if (oldVersion < 2) {
        db.createObjectStore('images', { keyPath: ['fileId', 'size'] });
      }
    }
  });
  return dbPromise;
}

export async function saveDraft(d: Draft): Promise<void> {
  await (await getDb()).put('drafts', d);
}

export async function getDraft(id: string): Promise<Draft | undefined> {
  return (await getDb()).get('drafts', id);
}

export async function listDrafts(): Promise<Draft[]> {
  return (await getDb()).getAllFromIndex('drafts', 'byCreated');
}

export async function deleteDraft(id: string): Promise<void> {
  await (await getDb()).delete('drafts', id);
}

export function newLocalId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

export function todayTaipei(): string {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Taipei' }).format(new Date());
}

// ---- 聯絡人快取 ----
export async function allContacts(): Promise<Contact[]> {
  return (await getDb()).getAll('contacts');
}

export async function getCachedContact(id: string): Promise<Contact | undefined> {
  return (await getDb()).get('contacts', id);
}

export async function putContacts(list: Contact[]): Promise<void> {
  const db = await getDb();
  const tx = db.transaction('contacts', 'readwrite');
  await Promise.all([...list.map((c) => tx.store.put(c)), tx.done]);
}

export async function getMeta<T>(key: string): Promise<T | undefined> {
  return (await getDb()).get('meta', key) as Promise<T | undefined>;
}

export async function setMeta(key: string, value: unknown): Promise<void> {
  await (await getDb()).put('meta', value, key);
}

export async function addPendingChange(c: PendingChange): Promise<void> {
  await (await getDb()).add('pendingChanges', c);
}

export async function listPendingChanges(): Promise<Array<{ key: number; value: PendingChange }>> {
  const db = await getDb();
  const keys = await db.getAllKeys('pendingChanges');
  const values = await db.getAll('pendingChanges');
  return keys.map((k, i) => ({ key: k, value: values[i]! }));
}

export async function removePendingChange(key: number): Promise<void> {
  await (await getDb()).delete('pendingChanges', key);
}

export async function getCachedImage(fileId: string, size: 'thumb' | 'full'): Promise<Blob | undefined> {
  return (await (await getDb()).get('images', [fileId, size]))?.blob;
}

export async function putCachedImage(fileId: string, size: 'thumb' | 'full', blob: Blob): Promise<void> {
  await (await getDb()).put('images', { fileId, size, blob });
}
