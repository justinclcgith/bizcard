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
export function isValidGasUrl(url: string): boolean {
  return /^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(url.trim());
}

/** 解析設定 QR code / 貼上的 JSON：{"url": "...", "token": "..."} */
export function parseSetupPayload(text: string): { gasUrl: string; token: string } | null {
  try {
    const v = JSON.parse(text) as { url?: unknown; token?: unknown };
    if (typeof v.url !== 'string' || typeof v.token !== 'string') return null;
    if (!isValidGasUrl(v.url) || v.token.length < 20) return null;
    return { gasUrl: v.url.trim(), token: v.token.trim() };
  } catch {
    return null;
  }
}

export function isConfigured(s: Settings): boolean {
  return isValidGasUrl(s.gasUrl) && s.token.length >= 20;
}
