import { describe, it, expect, beforeEach } from 'vitest';
import { isConfigured, isValidGasUrl, loadSettings, parseSetupPayload, saveSettings } from '../src/lib/settings';

const URL_OK = 'https://script.google.com/macros/s/AKfycbx_abc-123/exec';
const TOKEN = 'abcdefghijklmnopqrstuvwxyz0123456789';

class MemStorage {
  m = new Map<string, string>();
  getItem(k: string) { return this.m.get(k) ?? null; }
  setItem(k: string, v: string) { this.m.set(k, v); }
  removeItem(k: string) { this.m.delete(k); }
}

beforeEach(() => { (globalThis as { localStorage?: unknown }).localStorage = new MemStorage(); });

describe('settings', () => {
  it('預設值', () => expect(loadSettings()).toEqual({ gasUrl: '', token: '', provider: 'claude' }));
  it('存取', () => {
    saveSettings({ gasUrl: URL_OK, token: TOKEN, provider: 'compare' });
    expect(loadSettings().provider).toBe('compare');
    expect(isConfigured(loadSettings())).toBe(true);
  });
  it('localStorage 壞掉時不丟例外', () => {
    (globalThis as { localStorage?: unknown }).localStorage = { getItem() { throw new Error('x'); }, setItem() { throw new Error('x'); } };
    expect(loadSettings().gasUrl).toBe('');
    expect(saveSettings({ gasUrl: '', token: '', provider: 'claude' })).toBe(false);
  });
  it('只接受 Apps Script 網址', () => {
    expect(isValidGasUrl(URL_OK)).toBe(true);
    expect(isValidGasUrl('https://evil.example.com/macros/s/x/exec')).toBe(false);
    expect(isValidGasUrl('http://script.google.com/macros/s/x/exec')).toBe(false);
    // Google Workspace 帳號的網址
    expect(isValidGasUrl('https://script.google.com/a/macros/example.com/s/AKfy_1-2/exec')).toBe(true);
    expect(isValidGasUrl('https://script.google.com/a/macros/example.com/s/AKfy/exec?x=1')).toBe(false);
  });
  it('解析設定 QR', () => {
    expect(parseSetupPayload(JSON.stringify({ url: URL_OK, token: TOKEN }))).toEqual({ gasUrl: URL_OK, token: TOKEN });
    expect(parseSetupPayload(JSON.stringify({ url: URL_OK, token: 'short' }))).toBeNull();
    expect(parseSetupPayload('not json')).toBeNull();
  });
  it('容忍記事 App 造成的格式變化', () => {
    const ws = 'https://script.google.com/a/macros/example.com/s/AKfycbx_abc-123/exec';
    const want = { gasUrl: ws, token: TOKEN };
    // 彎引號
    expect(parseSetupPayload(`{\u201Curl\u201D:\u201C${ws}\u201D,\u201Ctoken\u201D:\u201C${TOKEN}\u201D}`)).toEqual(want);
    // 前面帶執行記錄文字、中間斷行、空白
    expect(parseSetupPayload(`下午3:38 資訊 手機設定（請勿貼到公開的地方）：{"url":"${ws.slice(0, 30)}\n${ws.slice(30)}", "token": "${TOKEN}"}\n`)).toEqual(want);
    // 全形冒號、零寬字元
    expect(parseSetupPayload(`{"url"："${ws}","token"："\u200B${TOKEN}"}`)).toEqual(want);
    // 網址不是 Apps Script
    expect(parseSetupPayload(JSON.stringify({ url: 'https://evil.example.com/macros/s/x/exec', token: TOKEN }))).toBeNull();
  });
});
