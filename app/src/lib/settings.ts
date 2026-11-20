/** 手機端設定（localStorage）。讀寫都包 try/catch，私密模式下也不會壞。 */
import type { ProviderChoice } from './types';

export interface Settings {
  gasUrl: string;
  token: string;
  provider: ProviderChoice;
}

const KEY = 'bizcard.settings.v1';
const DEFAULTS: Settings = { gasUrl: '', token: '', provider: 'claude' };

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULTS };
    const v = JSON.parse(raw) as Partial<Settings>;
    return {
      gasUrl: typeof v.gasUrl === 'string' ? v.gasUrl : '',
      token: typeof v.token === 'string' ? v.token : '',
      provider: v.provider === 'gemini' || v.provider === 'compare' ? v.provider : 'claude'
    };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveSettings(s: Settings): boolean {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
    return true;
  } catch {
    return false;
  }
}

/** 只接受 Apps Script Web App 網址，避免把權杖送到別的地方。 */
/**
 * Apps Script 網頁應用程式網址。個人帳號為 /macros/s/<ID>/exec，
 * Google Workspace 帳號為 /a/macros/<網域>/s/<ID>/exec。
 */
const GAS_URL_RE = /^https:\/\/script\.google\.com\/(?:a\/macros\/[A-Za-z0-9.-]+|macros)\/s\/[A-Za-z0-9_-]+\/exec$/;
const GAS_URL_IN_TEXT = /https:\/\/script\.google\.com\/(?:a\/macros\/[A-Za-z0-9.-]+|macros)\/s\/[A-Za-z0-9_-]+\/exec/;

export function isValidGasUrl(url: string): boolean {
  return GAS_URL_RE.test(url.trim());
}

/**
 * 解析設定 QR code / 貼上的文字。正式格式是 {"url": "...", "token": "..."}，
 * 但也容忍記事 App 造成的彎引號、換行、前後多餘文字（例如整行執行記錄）。
 */
export function parseSetupPayload(text: string): { gasUrl: string; token: string } | null {
  const cleaned = text
    .replace(/[\u201C\u201D\u201E\u201F\u2033\uFF02]/g, '"')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/\s+/g, '');
  const url = cleaned.match(GAS_URL_IN_TEXT)?.[0];
  const token = cleaned.match(/"token"[:：]"([A-Za-z0-9_-]{20,})"/)?.[1];
  if (!url || !token) return null;
  return { gasUrl: url, token };
}

export function isConfigured(s: Settings): boolean {
  return isValidGasUrl(s.gasUrl) && s.token.length >= 20;
}
