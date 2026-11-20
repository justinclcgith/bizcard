import { describe, it, expect, beforeEach } from 'vitest';
import { makeGas } from './fakeGas.mjs';

const TOKEN = 'secret-token-1234567890';
const IMG = { mime: 'image/jpeg', base64: Buffer.from('jpegdata').toString('base64') };

const fields = (over = {}) => ({
  name_zh: '王小明', name_en: 'Hsiao-Ming Wang', title_zh: '經理', title_en: 'Manager', department: '業務部',
  company_zh: '範例生技股份有限公司', company_en: 'Example Bio Inc.', company_short: '範例',
  mobile: '+886912000000', phone: '+886227123456', phone_ext: '123', fax: '', email: 'hm@example.com',
  website: '', address_zh: '', address_en: '', line_id: '', linkedin: '', other_social: '', ...over
});

let g;
beforeEach(() => { g = makeGas({ props: { APP_TOKEN: TOKEN } }); });

function save(cards, extra = {}) {
  return g.post({ action: 'saveCards', sourcePhoto: IMG, batch: { tags: ['展會'], event: 'BIO Asia 2026', metDate: '2026-11-19' }, cards, ...extra });
}

describe('setup', () => {
  it('建立四個工作表與雙列標題', () => {
    expect([...g.sheets.keys()].sort()).toEqual(['Contacts', 'Log', 'RecognitionLog', 'TitleHistory']);
    const c = g.sheets.get('Contacts');
    expect(c.cell(1, 1)).toBe('id');
    expect(c.cell(2, 2)).toBe('中文姓名');
  });
  it('重跑不重複建立', () => {
    g.ctx.setup();
    expect(g.sheets.get('Contacts').getLastColumn()).toBe(34);
  });
});

describe('saveCards', () => {
  it('新增聯絡人：欄位、批次設定、圖檔', () => {
    const r = save([{ tempId: 't1', fields: fields(), front: IMG, aiProvider: 'claude', aiModel: 'claude-opus-5-5' }]);
    expect(r.ok).toBe(true);
    const c = r.data.contacts[0].contact;
    expect(c.id).toMatch(/^c_20261119_/);
    expect(c.tags).toBe('展會');
    expect(c.event).toBe('BIO Asia 2026');
    expect(c.met_date).toBe('2026-11-19');
    expect(c.verified).toBe(true);
    const rows = g.sheets.get('Contacts').objects();
    expect(rows).toHaveLength(1);
    // 電話以文字保存，不被轉成數字
    expect(rows[0].mobile).toBe('+886912000000');
    expect(g.drive.items.get(c.front_image_id).name).toMatch(/^front_/);
    expect(g.drive.items.get(c.source_photo_id).name).toMatch(/^p_/);
  });

  it('多張一起存', () => {
    const r = save([
      { tempId: 'a', fields: fields(), front: IMG },
      { tempId: 'b', fields: fields({ name_zh: '陳大文', email: 'dw@x.com', mobile: '' }), front: IMG }
    ]);
    expect(r.data.contacts.map((x) => x.tempId)).toEqual(['a', 'b']);
    expect(g.sheets.get('Contacts').objects()).toHaveLength(2);
  });

  it('合併為同一人並記錄職稱變動', () => {
    const first = save([{ tempId: 't1', fields: fields(), front: IMG }]).data.contacts[0].contact;
    g.advance(60_000);
    const r = save([{ tempId: 't2', fields: fields({ title_zh: '協理', title_en: 'Director' }), front: IMG, mergeIntoId: first.id }],
      { batch: { metDate: '2026-12-01' } });
    const merged = r.data.contacts[0];
    expect(merged.merged).toBe(true);
    expect(merged.titleChanged).toBe(true);
    expect(merged.contact.title_zh).toBe('協理');
    expect(merged.contact.card_history).toBe(first.front_image_id);
    expect(g.sheets.get('Contacts').objects()).toHaveLength(1);
    const hist = g.sheets.get('TitleHistory').objects();
    expect(hist).toHaveLength(1);
    expect(hist[0]).toMatchObject({ contact_id: first.id, title_zh: '經理', valid_until: '2026-12-01', first_seen: '2026-11-19' });

    const detail = g.post({ action: 'getContact', id: first.id }).data;
    expect(detail.titleHistory).toHaveLength(1);
  });

  it('合併對象不存在時不留下圖檔', () => {
    const before = g.drive.items.size;
    const r = save([{ tempId: 't', fields: fields(), front: IMG, mergeIntoId: 'c_missing' }]);
    expect(r.error.code).toBe('NOT_FOUND');
    const trashed = [...g.drive.items.values()].filter((f) => f.trashed).length;
    expect(g.drive.items.size - before).toBeGreaterThan(0);
    expect(trashed).toBe(g.drive.items.size - before - 4); // 新建的 4 個資料夾（photos/cards 的年月）之外全部丟進垃圾桶
  });

  it('同一 requestId 重送不會重複新增', () => {
    const req = { action: 'saveCards', requestId: 'same', cards: [{ tempId: 't', fields: fields(), front: IMG }] };
    g.post(req); g.post(req);
    expect(g.sheets.get('Contacts').objects()).toHaveLength(1);
  });
});

describe('findDuplicates', () => {
  it('以 Email 找到同一人', () => {
    save([{ tempId: 't1', fields: fields(), front: IMG }]);
    const r = g.post({ action: 'findDuplicates', cards: [{ tempId: 'n1', fields: { name_zh: '王小明', email: 'HM@example.com' } }, { tempId: 'n2', fields: { name_zh: '路人' } }] });
    expect(r.data.matches[0].candidates[0]).toMatchObject({ score: 100, reasons: ['email'] });
    expect(r.data.matches[1].candidates).toEqual([]);
  });
});

describe('list / update / delete', () => {
  it('增量同步、衝突偵測、軟刪除', () => {
    const c = save([{ tempId: 't1', fields: fields(), front: IMG }]).data.contacts[0].contact;
    const all = g.post({ action: 'list', since: null }).data;
    expect(all.contacts).toHaveLength(1);
    expect(g.post({ action: 'list', since: all.serverTime }).data.contacts).toHaveLength(0);

    g.advance(60_000);
    const u = g.post({ action: 'updateContact', id: c.id, fields: { notes: '午餐聊過', id: 'hack' }, baseUpdatedAt: c.updated_at }).data;
    expect(u.contact.notes).toBe('午餐聊過');
    expect(u.contact.id).toBe(c.id);
    expect(g.post({ action: 'list', since: all.serverTime }).data.contacts).toHaveLength(1);

    // 用舊的 baseUpdatedAt 更新 → 衝突
    const conflict = g.post({ action: 'updateContact', id: c.id, fields: { notes: 'x' }, baseUpdatedAt: c.updated_at }).data;
    expect(conflict.conflict).toBe(true);

    g.advance(60_000);
    const d = g.post({ action: 'deleteContact', id: c.id }).data;
    expect(d.contact.deleted).toBe(true);
    expect(g.sheets.get('Contacts').objects()).toHaveLength(1);
  });

  it('手動改職稱時可選擇記錄為職稱變動', () => {
    const c = save([{ tempId: 't1', fields: fields(), front: IMG }]).data.contacts[0].contact;
    g.post({ action: 'updateContact', id: c.id, fields: { title_zh: '經理' } });
    g.post({ action: 'updateContact', id: c.id, fields: { title_zh: '副總' }, recordTitleChange: true });
    expect(g.sheets.get('TitleHistory').objects()).toHaveLength(1);
  });
});

describe('getImage', () => {
  it('只能讀名片夾底下的檔案', () => {
    const c = save([{ tempId: 't1', fields: fields(), front: IMG }]).data.contacts[0].contact;
    const img = g.post({ action: 'getImage', fileId: c.front_image_id, size: 'full' }).data;
    expect(Buffer.from(img.base64, 'base64').toString()).toBe('jpegdata');
    // 程式建立但不在名片夾底下的檔案
    const outside = g.drive.add({ name: 'x.jpg', mimeType: 'image/jpeg', parents: ['elsewhere'], bytes: [1] });
    expect(g.post({ action: 'getImage', fileId: outside.id }).error.code).toBe('NOT_FOUND');
    // drive.file 權限看不到的檔案（使用者其他檔案）
    const foreign = g.drive.add({ name: 'y.jpg', mimeType: 'image/jpeg', parents: [g.store.DRIVE_FOLDER_ID], bytes: [1], foreign: true });
    expect(g.post({ action: 'getImage', fileId: foreign.id }).error.code).toBe('NOT_FOUND');
    // 資料夾不是圖片；格式錯誤的 ID 不送出
    expect(g.post({ action: 'getImage', fileId: g.store.DRIVE_FOLDER_ID }).error.code).toBe('NOT_FOUND');
    expect(g.post({ action: 'getImage', fileId: '../x?y' }).error.code).toBe('NOT_FOUND');
  });
});

describe('權限與 Drive 結構', () => {
  it('manifest 只要求最小權限', async () => {
    const fs = await import('node:fs');
    const m = JSON.parse(fs.readFileSync(new URL('../appsscript.json', import.meta.url), 'utf8'));
    expect(m.oauthScopes.sort()).toEqual([
      'https://www.googleapis.com/auth/drive.file',
      'https://www.googleapis.com/auth/script.external_request',
      'https://www.googleapis.com/auth/spreadsheets.currentonly'
    ]);
  });
  it('setup 建立 名片夾/{cards,photos,backup}，重跑不重複', () => {
    const folders = () => [...g.drive.items.values()].filter((f) => f.mimeType === 'application/vnd.google-apps.folder').map((f) => f.name).sort();
    expect(folders()).toEqual(['backup', 'cards', 'photos', '名片夾']);
    g.ctx.setup();
    expect(folders()).toEqual(['backup', 'cards', 'photos', '名片夾']);
  });
  it('圖片存在 名片夾/cards/yyyy/MM', () => {
    const c = save([{ tempId: 't1', fields: fields(), front: IMG }]).data.contacts[0].contact;
    const path = [];
    let f = g.drive.items.get(c.front_image_id);
    while (f) { path.unshift(f.name); f = g.drive.items.get(f.parents[0]); }
    expect(path.slice(0, 4)).toEqual(['名片夾', 'cards', '2026', '11']);
  });
  it('試算表手動編輯會更新 updated_at（簡單觸發器 onEdit）', () => {
    save([{ tempId: 't1', fields: fields(), front: IMG }]);
    const sh = g.sheets.get('Contacts');
    const before = sh.objects()[0].updated_at;
    g.advance(60_000);
    const col = sh.data[0].indexOf('title_zh') + 1;
    g.ctx.onEdit({ range: { getSheet: () => sh, getRow: () => 3, getColumn: () => col, getLastColumn: () => col, getNumRows: () => 1 } });
    expect(sh.objects()[0].updated_at > before).toBe(true);
  });
});

describe('stats', () => {
  it('彙總本月辨識', () => {
    const log = g.sheets.get('RecognitionLog');
    log.appendRow(['2026-11-19T10:00:00+08:00', 'claude', 'm', 1, 3, 100, 10, 10, 0.02, 'ok', '', '']);
    log.appendRow(['2026-11-19T11:00:00+08:00', 'gemini', 'm', 1, 2, 100, 10, 10, 0.01, 'ok', '', '']);
    log.appendRow(['2026-10-01T11:00:00+08:00', 'gemini', 'm', 1, 2, 100, 10, 10, 0.01, 'ok', '', '']);
    const s = g.post({ action: 'stats', month: '2026-11' }).data;
    expect(s).toMatchObject({ recognitions: 2, cards: 5, estCostUsd: 0.03 });
    expect(s.byProvider.claude.cards).toBe(3);
  });
});
