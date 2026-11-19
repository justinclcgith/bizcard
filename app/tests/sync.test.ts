import 'fake-indexeddb/auto';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ApiError } from '../src/api/client';
import { parseContact } from '../src/lib/contact';

const api = vi.hoisted(() => ({
  listContacts: vi.fn(), updateContact: vi.fn(), deleteContact: vi.fn(), getImage: vi.fn()
}));
vi.mock('../src/api/client', async (orig) => ({ ...(await orig<typeof import('../src/api/client')>()), ...api }));

const { flushPending, removeContact, saveContactEdit, syncAll, loadImage } = await import('../src/lib/sync');
const db = await import('../src/db/db');

const c1 = parseContact({ id: 'c1', name_zh: '王小明', title_zh: '經理', updated_at: '2026-11-01T00:00:00+08:00' });
const offline = () => new ApiError('NETWORK', '目前沒有網路連線');

beforeEach(async () => {
  Object.values(api).forEach((f) => f.mockReset());
  const d = await db.getDb();
  for (const s of ['contacts', 'pendingChanges', 'meta', 'images'] as const) await d.clear(s);
});

describe('syncAll', () => {
  it('增量拉取並記下 serverTime', async () => {
    api.listContacts.mockResolvedValueOnce({ contacts: [c1], serverTime: 'T1' });
    expect(await syncAll()).toEqual({ pulled: 1, pushed: 0, conflicts: 0 });
    expect(api.listContacts).toHaveBeenLastCalledWith(null);
    expect((await db.allContacts()).map((c) => c.id)).toEqual(['c1']);
    api.listContacts.mockResolvedValueOnce({ contacts: [], serverTime: 'T2' });
    await syncAll();
    expect(api.listContacts).toHaveBeenLastCalledWith('T1');
    expect(await db.getMeta('lastSyncAt')).toBe('T2');
  });
  it('同時呼叫只跑一次', async () => {
    api.listContacts.mockResolvedValue({ contacts: [], serverTime: 'T' });
    await Promise.all([syncAll(), syncAll()]);
    expect(api.listContacts).toHaveBeenCalledTimes(1);
  });
});

describe('離線編輯與刪除', () => {
  it('離線編輯：先改本機並排入待同步，連線後送出', async () => {
    api.updateContact.mockRejectedValueOnce(offline());
    const r = await saveContactEdit(c1, { title_zh: '協理' }, true);
    expect(r.offline).toBe(true);
    expect((await db.getCachedContact('c1'))?.title_zh).toBe('協理');
    expect(await db.listPendingChanges()).toHaveLength(1);

    api.updateContact.mockResolvedValueOnce({ contact: { ...c1, title_zh: '協理', updated_at: 'T9' }, conflict: false });
    expect(await flushPending()).toEqual({ done: 1, conflicts: 0 });
    expect(api.updateContact).toHaveBeenLastCalledWith('c1', { title_zh: '協理' }, c1.updated_at, true);
    expect(await db.listPendingChanges()).toHaveLength(0);
  });
  it('仍離線時保留待同步；其他錯誤則丟棄', async () => {
    await db.addPendingChange({ kind: 'delete', id: 'c1', at: 1 });
    await db.addPendingChange({ kind: 'delete', id: 'c2', at: 2 });
    api.deleteContact.mockRejectedValueOnce(offline());
    expect((await flushPending()).done).toBe(0);
    expect(await db.listPendingChanges()).toHaveLength(2);
    api.deleteContact.mockRejectedValueOnce(new ApiError('NOT_FOUND', '找不到'))
      .mockResolvedValueOnce({ ...c1, id: 'c2', deleted: true });
    expect((await flushPending()).done).toBe(1);
    expect(await db.listPendingChanges()).toHaveLength(0);
  });
  it('衝突時採用後端版本並計數', async () => {
    await db.addPendingChange({ kind: 'update', id: 'c1', fields: { title_zh: 'x' }, baseUpdatedAt: 'old', recordTitleChange: false, at: 1 });
    api.updateContact.mockResolvedValueOnce({ contact: { ...c1, title_zh: '後端版本' }, conflict: true });
    expect(await flushPending()).toEqual({ done: 1, conflicts: 1 });
    expect((await db.getCachedContact('c1'))?.title_zh).toBe('後端版本');
  });
  it('離線刪除：本機標記已刪除', async () => {
    api.deleteContact.mockRejectedValueOnce(offline());
    expect(await removeContact(c1)).toEqual({ offline: true });
    expect((await db.getCachedContact('c1'))?.deleted).toBe(true);
  });
  it('非網路錯誤直接拋出', async () => {
    api.updateContact.mockRejectedValueOnce(new ApiError('UNAUTHORIZED', '權杖錯誤'));
    await expect(saveContactEdit(c1, { title_zh: 'y' }, false)).rejects.toThrow('權杖錯誤');
    expect(await db.listPendingChanges()).toHaveLength(0);
  });
});

describe('loadImage', () => {
  it('第二次讀快取', async () => {
    api.getImage.mockResolvedValueOnce(new Blob(['x'], { type: 'image/jpeg' }));
    expect(await loadImage('f1', 'thumb')).toBeTruthy();
    expect(await loadImage('f1', 'thumb')).toBeTruthy();
    expect(api.getImage).toHaveBeenCalledTimes(1);
    expect(await loadImage('', 'thumb')).toBeNull();
  });
});
