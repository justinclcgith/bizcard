/** IndexedDB（docs/03 §7）。P3 先實作 drafts；其餘 store 先建立結構。 */
import { openDB } from 'idb';
import type { DBSchema, IDBPDatabase } from 'idb';
import type { Box, CardFields, Orientation, Provider } from '../lib/types';

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
  status: 'recognizing' | 'review' | 'compare' | 'error';
  provider: Provider | 'compare';
  cards: DraftCard[];
  /** 比較模式的兩家原始結果 */
  compare?: Partial<Record<Provider, { cards: DraftCard[]; error?: string; model: string }>>;
  error?: string;
  batch: { tags: string; event: string; metDate: string };
}

interface BizcardDB extends DBSchema {
  drafts: { key: string; value: Draft; indexes: { byCreated: number } };
  contacts: { key: string; value: Record<string, unknown> };
  photoQueue: { key: string; value: { localId: string; blob: Blob; createdAt: number; status: string } };
  pendingChanges: { key: number; value: Record<string, unknown>; autoIncrement: true };
  meta: { key: string; value: unknown };
}

let dbPromise: Promise<IDBPDatabase<BizcardDB>> | null = null;

export function getDb(): Promise<IDBPDatabase<BizcardDB>> {
  dbPromise ??= openDB<BizcardDB>('bizcard', 1, {
    upgrade(db) {
      const drafts = db.createObjectStore('drafts', { keyPath: 'localId' });
      drafts.createIndex('byCreated', 'createdAt');
      db.createObjectStore('contacts', { keyPath: 'id' });
      db.createObjectStore('photoQueue', { keyPath: 'localId' });
      db.createObjectStore('pendingChanges', { autoIncrement: true });
      db.createObjectStore('meta');
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
