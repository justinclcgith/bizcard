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
  });
  it('解析設定 QR', () => {
    expect(parseSetupPayload(JSON.stringify({ url: URL_OK, token: TOKEN }))).toEqual({ gasUrl: URL_OK, token: TOKEN });
    expect(parseSetupPayload(JSON.stringify({ url: URL_OK, token: 'short' }))).toBeNull();
    expect(parseSetupPayload('not json')).toBeNull();
  });
});
