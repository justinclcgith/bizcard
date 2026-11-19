import { describe, it, expect } from 'vitest';
import { ApiError, callApi, parseCompare, parseRecognize, unwrap } from '../src/api/client';

const card = { fields: { name_zh: '王小明', email: 'a@b.com', bogus: 'x' }, box_2d: [1, 2, 3, 4], orientation: '90', side: 'front', lowConfidenceFields: ['emails'], warnings: [] };

describe('unwrap', () => {
  it('成功', () => expect(unwrap({ ok: true, data: 1 })).toBe(1));
  it('錯誤轉 ApiError', () => {
    try { unwrap({ ok: false, error: { code: 'UNAUTHORIZED', message: '存取權杖錯誤' } }); } catch (e) {
      expect(e).toBeInstanceOf(ApiError);
      expect((e as ApiError).code).toBe('UNAUTHORIZED');
      return;
    }
    throw new Error('應丟出例外');
  });
  it('格式錯誤', () => expect(() => unwrap('<html>')).toThrow(ApiError));
});

describe('parseRecognize', () => {
  it('補齊欄位、忽略多餘欄位', () => {
    const r = parseRecognize({ provider: 'claude', model: 'm', latencyMs: 5, usage: {}, cards: [card] });
    expect(r.cards[0]!.fields.name_zh).toBe('王小明');
    expect(r.cards[0]!.fields.mobile).toBe('');
    expect('bogus' in r.cards[0]!.fields).toBe(false);
    expect(r.cards[0]!.orientation).toBe('90');
  });
  it('不合法框改整張', () => {
    const r = parseRecognize({ cards: [{ ...card, box_2d: [1, 2] }] });
    expect(r.cards[0]!.box_2d).toEqual([0, 0, 1000, 1000]);
  });
});

describe('parseCompare', () => {
  it('一家失敗', () => {
    const r = parseCompare({ results: { claude: { cards: [card] }, gemini: { error: { code: 'AI_ERROR', message: '失敗' } } }, compareGroupId: 'g' });
    expect(r.results.gemini).toEqual({ error: { code: 'AI_ERROR', message: '失敗' } });
  });
});

describe('callApi', () => {
  it('以 text/plain 送出並帶權杖與 requestId', async () => {
    let sent: RequestInit | undefined;
    const fetchImpl = (async (_u: string, init: RequestInit) => {
      sent = init;
      return new Response(JSON.stringify({ ok: true, data: { pong: 1 } }));
    }) as unknown as typeof fetch;
    const d = await callApi('ping', {}, { gasUrl: 'https://script.google.com/macros/s/x/exec', token: 't', fetchImpl });
    expect(d).toEqual({ pong: 1 });
    expect((sent!.headers as Record<string, string>)['Content-Type']).toContain('text/plain');
    const body = JSON.parse(String(sent!.body));
    expect(body.token).toBe('t');
    expect(body.requestId).toBeTruthy();
  });
  it('網路錯誤', async () => {
    const fetchImpl = (async () => { throw new TypeError('fail'); }) as unknown as typeof fetch;
    await expect(callApi('ping', {}, { gasUrl: 'u', token: 't', fetchImpl })).rejects.toMatchObject({ code: 'NETWORK' });
  });
  it('未設定', async () => {
    (globalThis as { localStorage?: unknown }).localStorage = { getItem: () => null, setItem: () => {} };
    await expect(callApi('ping')).rejects.toMatchObject({ code: 'NOT_CONFIGURED' });
  });
});
