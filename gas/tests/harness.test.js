/**
 * 以假的 GAS 服務載入全部 gas/src/*.js，測試 doPost 路由、驗證與辨識流程。
 */
import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const SRC = path.resolve(__dirname, '../src');

function makeContext({ props = {}, fetchImpl } = {}) {
  const store = { ...props };
  const cache = {};
  const logRows = [];
  const fetched = [];
  const sheet = { appendRow: (r) => logRows.push(r) };
  const ctx = {
    console,
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (k) => (k in store ? store[k] : null),
        setProperty: (k, v) => { store[k] = v; }
      })
    },
    CacheService: {
      getScriptCache: () => ({
        get: (k) => (k in cache ? cache[k] : null),
        put: (k, v) => { cache[k] = v; }
      })
    },
    SpreadsheetApp: { getActiveSpreadsheet: () => ({ getSheetByName: () => sheet }) },
    ScriptApp: { getOAuthToken: () => 'oauth' },
    Utilities: {
      formatDate: () => '2026111912',
      getUuid: () => 'uuid-1',
      base64EncodeWebSafe: (s) => Buffer.from(String(s)).toString('base64url'),
      computeDigest: (_a, s) => String(s),
      DigestAlgorithm: { SHA_256: 'sha256' }
    },
    UrlFetchApp: {
      fetch: (url, params) => {
        // Drive API（ping 檢查資料夾）不列入 AI 呼叫紀錄
        if (url.startsWith('https://www.googleapis.com/drive/')) {
          return { getResponseCode: () => 200, getContentText: () => JSON.stringify({ id: 'folder', mimeType: 'application/vnd.google-apps.folder', trashed: false }) };
        }
        fetched.push({ url, params });
        return fetchImpl(url, params);
      },
      fetchAll: (reqs) => reqs.map((r) => { fetched.push({ url: r.url, params: r }); return fetchImpl(r.url, r); })
    },
    ContentService: {
      MimeType: { JSON: 'json' },
      createTextOutput: (s) => ({ setMimeType: () => ({ body: s }) })
    },
    Logger: { log: () => {} }
  };
  vm.createContext(ctx);
  for (const f of fs.readdirSync(SRC).filter((f) => f.endsWith('.js')).sort().reverse()) {
    vm.runInContext(fs.readFileSync(path.join(SRC, f), 'utf8'), ctx, { filename: f });
  }
  const post = (obj) => JSON.parse(ctx.doPost({ postData: { contents: JSON.stringify(obj) } }).body);
  return { ctx, post, store, logRows, fetched, cache };
}

const httpResp = (code, obj) => ({ getResponseCode: () => code, getContentText: () => JSON.stringify(obj) });

const aiOutput = {
  cards: [{
    box_2d: [100, 100, 400, 500], orientation: '0', side: 'front', low_confidence_fields: [],
    fields: {
      name_zh: '林志明', name_en: 'Chih-Ming Lin', title_zh: '經理', title_en: 'Manager', department: '',
      company_zh: '普瑞默生物科技股份有限公司', company_en: 'PrimoBio Inc.', company_short: 'PrimoBio',
      mobiles: ['0912345678'], phones: [], faxes: [], emails: ['A@B.COM'], website: '',
      address_zh: '', address_en: '', line_id: '', linkedin: '', other_social: []
    }
  }]
};

const claudeOk = () => httpResp(200, {
  model: 'claude-opus-5-5', stop_reason: 'end_turn',
  content: [{ type: 'text', text: JSON.stringify(aiOutput) }],
  usage: { input_tokens: 2000, output_tokens: 500 }
});
const geminiOk = () => httpResp(200, {
  modelVersion: 'gemini-3.6-flash',
  candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(aiOutput) }] } }],
  usageMetadata: { promptTokenCount: 1500, candidatesTokenCount: 400 }
});

const PROPS = {
  APP_TOKEN: 'secret-token-1234567890', DRIVE_FOLDER_ID: 'd1',
  ANTHROPIC_API_KEY: 'ak', GEMINI_API_KEY: 'gk', PRICE_CLAUDE_IN: '4', PRICE_CLAUDE_OUT: '20'
};
const img = { mime: 'image/jpeg', base64: 'AAAA' };

describe('doPost 驗證與路由', () => {
  let h;
  beforeEach(() => { h = makeContext({ props: PROPS, fetchImpl: () => claudeOk() }); });

  it('錯誤權杖回傳 UNAUTHORIZED', () => {
    expect(h.post({ token: 'bad', action: 'ping' }).error.code).toBe('UNAUTHORIZED');
  });
  it('連續失敗 20 次後鎖定', () => {
    for (let i = 0; i < 20; i++) h.post({ token: 'bad', action: 'ping' });
    expect(h.post({ token: PROPS.APP_TOKEN, action: 'ping' }).error.code).toBe('RATE_LIMITED');
  });
  it('未設定 APP_TOKEN 時一律拒絕', () => {
    const h2 = makeContext({ props: {}, fetchImpl: () => claudeOk() });
    expect(h2.post({ token: '', action: 'ping' }).error.code).toBe('UNAUTHORIZED');
  });
  it('不支援的動作', () => {
    expect(h.post({ token: PROPS.APP_TOKEN, action: 'toString' }).error.code).toBe('BAD_REQUEST');
  });
  it('非 JSON 請求', () => {
    const r = JSON.parse(h.ctx.doPost({ postData: { contents: 'not json' } }).body);
    expect(r.error.code).toBe('BAD_REQUEST');
  });
  it('ping 回報設定狀態', () => {
    const r = h.post({ token: PROPS.APP_TOKEN, action: 'ping' });
    expect(r.ok).toBe(true);
    expect(r.data.providers).toEqual(['claude', 'gemini']);
    expect(r.data.sheetOk).toBe(true);
  });
});

describe('recognize', () => {
  it('Claude：請求格式與正規化結果', () => {
    const h = makeContext({ props: PROPS, fetchImpl: () => claudeOk() });
    const r = h.post({ token: PROPS.APP_TOKEN, action: 'recognize', provider: 'claude', image: img });
    expect(r.ok).toBe(true);
    expect(r.data.cards[0].fields.mobile).toBe('+886912345678');
    expect(r.data.cards[0].fields.email).toBe('a@b.com');
    expect(r.data.usage.estCostUsd).toBeCloseTo(0.018, 6);
    const sent = h.fetched[0].params;
    expect(sent.headers['anthropic-version']).toBe('2026-10-21');
    const body = JSON.parse(sent.payload);
    expect(body.model).toBe('claude-opus-5-5');
    expect(body.output_config.format.type).toBe('json_schema');
    expect(body.messages[0].content[0].type).toBe('image');
    expect(body.temperature).toBeUndefined();
    expect(h.logRows.at(-1)[1]).toBe('claude');
  });

  it('claudeEffort 覆寫（評測用，僅接受 low/medium/high）', () => {
    const h = makeContext({ props: PROPS, fetchImpl: () => claudeOk() });
    h.post({ token: PROPS.APP_TOKEN, action: 'recognize', provider: 'claude', image: img, claudeEffort: 'medium' });
    h.post({ token: PROPS.APP_TOKEN, action: 'recognize', provider: 'claude', image: img, claudeEffort: 'max' });
    expect(JSON.parse(h.fetched[0].params.payload).output_config.effort).toBe('medium');
    expect(JSON.parse(h.fetched[1].params.payload).output_config.effort).toBe('low');
  });

  it('Claude 拒絕時回傳 AI_REFUSED', () => {
    const h = makeContext({ props: PROPS, fetchImpl: () => httpResp(200, { stop_reason: 'refusal', content: [] }) });
    const r = h.post({ token: PROPS.APP_TOKEN, action: 'recognize', provider: 'claude', image: img });
    expect(r.error.code).toBe('AI_REFUSED');
  });

  it('Gemini：請求格式與結果', () => {
    const h = makeContext({ props: PROPS, fetchImpl: () => geminiOk() });
    const r = h.post({ token: PROPS.APP_TOKEN, action: 'recognize', provider: 'gemini', image: img });
    expect(r.ok).toBe(true);
    expect(r.data.cards).toHaveLength(1);
    expect(h.fetched[0].url).toContain('gemini-3.6-flash:generateContent');
    expect(h.fetched[0].params.headers['x-goog-api-key']).toBe('gk');
  });

  it('比較模式：一家失敗仍回傳另一家', () => {
    const h = makeContext({
      props: PROPS,
      fetchImpl: (url) => (url.includes('anthropic') ? claudeOk() : httpResp(500, { error: { status: 'INTERNAL' } }))
    });
    const r = h.post({ token: PROPS.APP_TOKEN, action: 'recognize', provider: 'compare', image: img });
    expect(r.ok).toBe(true);
    expect(r.data.results.claude.cards).toHaveLength(1);
    expect(r.data.results.gemini.error.code).toBe('AI_ERROR');
  });

  it('比較模式：缺 Gemini 金鑰不影響 Claude', () => {
    const h = makeContext({ props: { ...PROPS, GEMINI_API_KEY: null }, fetchImpl: () => claudeOk() });
    const r = h.post({ token: PROPS.APP_TOKEN, action: 'recognize', provider: 'compare', image: img });
    expect(r.data.results.claude.cards).toHaveLength(1);
    expect(r.data.results.gemini.error.message).toContain('Gemini 金鑰');
  });

  it('缺圖片回傳 BAD_REQUEST', () => {
    const h = makeContext({ props: PROPS, fetchImpl: () => claudeOk() });
    expect(h.post({ token: PROPS.APP_TOKEN, action: 'recognize' }).error.code).toBe('BAD_REQUEST');
  });

  it('同一 requestId 重送回傳快取結果，不再呼叫 AI', () => {
    const h = makeContext({ props: PROPS, fetchImpl: () => claudeOk() });
    const req = { token: PROPS.APP_TOKEN, action: 'recognize', provider: 'claude', image: img, requestId: 'r1' };
    h.post(req);
    h.post(req);
    expect(h.fetched).toHaveLength(1);
  });
});
