import { describe, it, expect } from 'vitest';
import { externalBrowserUrl, isLineInApp } from '../src/lib/inApp';

describe('LINE 內建瀏覽器', () => {
  it('偵測', () => {
    expect(isLineInApp('Mozilla/5.0 (Linux; Android 16; Pixel 8) AppleWebKit/537.36 Chrome/142.0 Mobile Safari/537.36 Line/15.20.1/IAB')).toBe(true);
    expect(isLineInApp('Mozilla/5.0 (Linux; Android 16; Pixel 8) AppleWebKit/537.36 Chrome/142.0 Mobile Safari/537.36')).toBe(false);
    expect(isLineInApp('Mozilla/5.0 Online/1.0')).toBe(false);
  });
  it('加上 openExternalBrowser=1，保留原路徑與參數', () => {
    expect(externalBrowserUrl('https://x.github.io/bizcard/settings?a=1')).toBe('https://x.github.io/bizcard/settings?a=1&openExternalBrowser=1');
  });
});
