/**
 * 較完整的假 GAS 環境：記憶體中的試算表與 Drive，用來測試聯絡人相關動作。
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const SRC = path.resolve(__dirname, '../src');

class FakeRange {
  constructor(sheet, row, col, nr, nc) { Object.assign(this, { sheet, row, col, nr, nc }); }
  getValues() {
    const out = [];
    for (let r = 0; r < this.nr; r++) {
      const line = [];
      for (let c = 0; c < this.nc; c++) line.push(this.sheet.cell(this.row + r, this.col + c));
      out.push(line);
    }
    return out;
  }
  setValues(vals) {
    if (this.row + this.nr - 1 > this.sheet.maxRows) throw new Error('範圍超出工作表');
    vals.forEach((line, r) => line.forEach((v, c) => {
      // 模擬 Sheets：非純文字格式時，"+886…" 會被轉成數字
      const fmt = this.sheet.formats.get(`${this.row + r}:${this.col + c}`);
      let val = v;
      if (fmt !== '@' && typeof v === 'string' && /^\+?\d+$/.test(v)) val = Number(v);
      this.sheet.set(this.row + r, this.col + c, val);
    }));
    return this;
  }
  setNumberFormat(f) {
    for (let r = 0; r < this.nr; r++) for (let c = 0; c < this.nc; c++) this.sheet.formats.set(`${this.row + r}:${this.col + c}`, f);
    return this;
  }
  setFontColor() { return this; } setFontSize() { return this; } setFontWeight() { return this; } setBackground() { return this; }
}

class FakeSheet {
  constructor(name) { this.name = name; this.data = []; this.formats = new Map(); this.maxRows = 1000; }
  getName() { return this.name; }
  cell(r, c) { return (this.data[r - 1] || [])[c - 1] ?? ''; }
  set(r, c, v) { (this.data[r - 1] ||= [])[c - 1] = v; }
  getLastRow() {
    for (let i = this.data.length; i > 0; i--) if ((this.data[i - 1] || []).some((v) => v !== '' && v != null)) return i;
    return 0;
  }
  getLastColumn() { return Math.max(0, ...this.data.map((r) => (r ? r.length : 0))); }
  getMaxRows() { return this.maxRows; }
  insertRowsAfter(_after, n) { this.maxRows += n; }
  getRange(r, c, nr = 1, nc = 1) { return new FakeRange(this, r, c, nr, nc); }
  appendRow(vals) { const r = this.getLastRow() + 1; vals.forEach((v, i) => this.set(r, i + 1, v)); }
  setFrozenRows() {}
  /** 測試用：取得資料列物件 */
  objects() {
    const codes = this.data[0] || [];
    return this.data.slice(2).filter(Boolean).map((row) => Object.fromEntries(codes.map((c, i) => [c, row[i] ?? ''])));
  }
}

class FakeFolder {
  constructor(drive, id, name, parent) { Object.assign(this, { drive, id, name, parent, children: [] }); }
  getId() { return this.id; }
  getUrl() { return 'https://drive/' + this.id; }
  getFoldersByName(n) { return iter(this.children.filter((c) => c instanceof FakeFolder && c.name === n)); }
  createFolder(n) { const f = new FakeFolder(this.drive, this.drive.nextId('fo'), n, this); this.children.push(f); this.drive.items.set(f.id, f); return f; }
  createFile(blob) {
    const f = { id: this.drive.nextId('fi'), blob, parent: this, trashed: false,
      getId() { return this.id; }, getParents: () => iter([this]), getBlob() { return f.blob; },
      getThumbnail() { return null; }, setTrashed(t) { f.trashed = t; } };
    this.children.push(f); this.drive.items.set(f.id, f); return f;
  }
  getParents() { return iter(this.parent ? [this.parent] : []); }
}

function iter(arr) { let i = 0; return { hasNext: () => i < arr.length, next: () => arr[i++] }; }

export function makeGas({ props = {}, fetchImpl = () => { throw new Error('no fetch'); } } = {}) {
  const store = { ...props };
  const cache = {};
  const sheets = new Map();
  const ss = {
    getId: () => 'SS1', getUrl: () => 'https://sheet', setSpreadsheetTimeZone() {},
    getSheetByName: (n) => sheets.get(n) || null,
    insertSheet: (n) => { const s = new FakeSheet(n); sheets.set(n, s); return s; },
    getSheets: () => [...sheets.values()], deleteSheet: (s) => sheets.delete(s.name)
  };
  let idSeq = 0;
  const drive = { items: new Map(), nextId: (p) => `${p}${++idSeq}` };
  const otherRoot = new FakeFolder(drive, 'other', 'other', null);
  drive.items.set('other', otherRoot);
  let clock = Date.parse('2026-11-19T10:00:00+08:00');
  const fmt = (d, _tz, pattern) => {
    const t = new Date(d.getTime() + 8 * 3600e3).toISOString();
    return pattern
      .replace("yyyy-MM-dd'T'HH:mm:ss'+08:00'", t.slice(0, 19) + '+08:00')
      .replace('yyyyMMddHHmmss', t.slice(0, 19).replace(/\D/g, ''))
      .replace('yyyyMMddHH', t.slice(0, 13).replace(/\D/g, ''))
      .replace('yyyyMMdd', t.slice(0, 10).replace(/\D/g, ''))
      .replace('yyyy-MM-dd', t.slice(0, 10)).replace('yyyy', t.slice(0, 4)).replace('MM', t.slice(5, 7));
  };
  const ctx = {
    console,
    Date: class extends Date { constructor(...a) { if (a.length) super(...a); else super(clock); } static now() { return clock; } },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => store[k] ?? null, setProperty: (k, v) => { store[k] = v; } }) },
    CacheService: { getScriptCache: () => ({ get: (k) => cache[k] ?? null, put: (k, v) => { cache[k] = v; } }) },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock() {} }) },
    SpreadsheetApp: { create: () => ss, openById: (id) => { if (id !== 'SS1') throw new Error('x'); return ss; } },
    DriveApp: {
      createFolder: (n) => { const f = new FakeFolder(drive, drive.nextId('fo'), n, null); drive.items.set(f.id, f); return f; },
      getFolderById: (id) => { const f = drive.items.get(id); if (!(f instanceof FakeFolder)) throw new Error('x'); return f; },
      getFileById: (id) => { const f = drive.items.get(id); if (!f || f instanceof FakeFolder) throw new Error('x'); return f; }
    },
    ScriptApp: { getProjectTriggers: () => [], newTrigger: () => ({ forSpreadsheet: () => ({ onEdit: () => ({ create() {} }) }) }) },
    Utilities: {
      formatDate: fmt,
      getUuid: () => `uuid-${++idSeq}-abcdef`,
      newBlob: (bytes, mime, name) => ({ bytes, mime, name, getBytes: () => bytes, getContentType: () => mime }),
      base64Decode: (s) => [...Buffer.from(s, 'base64')],
      base64Encode: (b) => Buffer.from(b).toString('base64'),
      base64EncodeWebSafe: (s) => Buffer.from(String(s)).toString('base64url'),
      computeDigest: (_a, s) => String(s), DigestAlgorithm: { SHA_256: 'x' }
    },
    UrlFetchApp: { fetch: (u, p) => fetchImpl(u, p), fetchAll: (rs) => rs.map((r) => fetchImpl(r.url, r)) },
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: (s) => ({ setMimeType: () => ({ body: s }) }) },
    Logger: { log() {} }
  };
  vm.createContext(ctx);
  for (const f of fs.readdirSync(SRC).filter((f) => f.endsWith('.js')).sort()) {
    vm.runInContext(fs.readFileSync(path.join(SRC, f), 'utf8'), ctx, { filename: f });
  }
  ctx.setup();
  const token = store.APP_TOKEN;
  return {
    ctx, store, sheets, drive, otherRoot,
    advance: (ms) => { clock += ms; },
    post: (obj) => JSON.parse(ctx.doPost({ postData: { contents: JSON.stringify({ token, ...obj }) } }).body)
  };
}
