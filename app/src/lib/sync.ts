/** 與後端同步：送出離線變更 → 增量拉取（docs/02 §2.2、§2.3）。 */
import { ApiError, deleteContact, getImage, listContacts, updateContact } from '../api/client';
import {
  addPendingChange, getCachedContact, getCachedImage, getMeta, listPendingChanges,
  putCachedImage, putContacts, removePendingChange, setMeta
} from '../db/db';
import type { Contact } from './contact';

export interface SyncResult { pulled: number; pushed: number; conflicts: number }

let running: Promise<SyncResult> | null = null;

/** 同時只跑一個同步。 */
export function syncAll(): Promise<SyncResult> {
  running ??= doSync().finally(() => { running = null; });
  return running;
}

async function doSync(): Promise<SyncResult> {
  const pushed = await flushPending();
  const since = (await getMeta<string>('lastSyncAt')) ?? null;
  const { contacts, serverTime } = await listContacts(since);
  if (contacts.length) await putContacts(contacts);
  if (serverTime) await setMeta('lastSyncAt', serverTime);
  return { pulled: contacts.length, pushed: pushed.done, conflicts: pushed.conflicts };
}

/** 送出離線時累積的編輯與刪除。網路仍不通時保留待下次。 */
export async function flushPending(): Promise<{ done: number; conflicts: number }> {
  let done = 0;
  let conflicts = 0;
  for (const { key, value } of await listPendingChanges()) {
    try {
      if (value.kind === 'update') {
        const r = await updateContact(value.id, value.fields, value.baseUpdatedAt, value.recordTitleChange);
        if (r.conflict) conflicts++;
        await putContacts([r.contact]);
      } else {
        await putContacts([await deleteContact(value.id)]);
      }
      await removePendingChange(key);
      done++;
    } catch (e) {
      if (e instanceof ApiError && (e.code === 'NETWORK' || e.code === 'TIMEOUT')) break;
      // 其他錯誤（例如聯絡人已不存在）丟棄這筆變更，避免卡住
      await removePendingChange(key);
    }
  }
  return { done, conflicts };
}

function isOfflineError(e: unknown): boolean {
  return e instanceof ApiError && (e.code === 'NETWORK' || e.code === 'TIMEOUT');
}

/**
 * 編輯聯絡人：線上直接送出；離線時先更新本機並排入待同步。
 * @return conflict=true 表示後端已有較新的資料（已改用後端版本）
 */
export async function saveContactEdit(before: Contact, fields: Record<string, string>,
  recordTitleChange: boolean): Promise<{ contact: Contact; offline: boolean; conflict: boolean }> {
  try {
    const r = await updateContact(before.id, fields, before.updated_at, recordTitleChange);
    await putContacts([r.contact]);
    return { contact: r.contact, offline: false, conflict: r.conflict };
  } catch (e) {
    if (!isOfflineError(e)) throw e;
    const local = { ...before, ...fields } as Contact;
    await putContacts([local]);
    await addPendingChange({ kind: 'update', id: before.id, fields, baseUpdatedAt: before.updated_at, recordTitleChange, at: Date.now() });
    return { contact: local, offline: true, conflict: false };
  }
}

export async function removeContact(c: Contact): Promise<{ offline: boolean }> {
  try {
    await putContacts([await deleteContact(c.id)]);
    return { offline: false };
  } catch (e) {
    if (!isOfflineError(e)) throw e;
    await putContacts([{ ...c, deleted: true }]);
    await addPendingChange({ kind: 'delete', id: c.id, at: Date.now() });
    return { offline: true };
  }
}

/** 取得名片圖（先看本機快取）。 */
export async function loadImage(fileId: string, size: 'thumb' | 'full'): Promise<Blob | null> {
  if (!fileId) return null;
  const cached = await getCachedImage(fileId, size);
  if (cached) return cached;
  try {
    const blob = await getImage(fileId, size);
    await putCachedImage(fileId, size, blob);
    return blob;
  } catch {
    return null;
  }
}

export async function cachedContact(id: string): Promise<Contact | undefined> {
  return getCachedContact(id);
}
