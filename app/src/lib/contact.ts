/** 聯絡人型別、驗證與搜尋（純函式）。 */
import { CARD_FIELD_KEYS } from './types';
import type { CardFields } from './types';

export const EXTRA_KEYS = ['tags', 'event', 'met_date', 'notes'] as const;
export const SYSTEM_KEYS = [
  'id', 'front_image_id', 'back_image_id', 'source_photo_id', 'card_history',
  'ai_provider', 'ai_model', 'created_at', 'updated_at'
] as const;

export type Contact = CardFields & Record<(typeof EXTRA_KEYS)[number] | (typeof SYSTEM_KEYS)[number], string> & {
  verified: boolean;
  deleted: boolean;
};

export interface TitleHistoryEntry {
  id: string; contact_id: string; company_zh: string; company_en: string; company_short: string;
  department: string; title_zh: string; title_en: string; valid_until: string; first_seen: string;
  card_image_id: string; recorded_at: string;
}

const s = (v: unknown): string => (typeof v === 'string' ? v : v == null ? '' : String(v));

export function parseContact(v: unknown): Contact {
  const o = (typeof v === 'object' && v !== null ? v : {}) as Record<string, unknown>;
  const c = {} as Contact;
  for (const k of [...CARD_FIELD_KEYS, ...EXTRA_KEYS, ...SYSTEM_KEYS]) (c as Record<string, unknown>)[k] = s(o[k]);
  c.verified = o.verified === true;
  c.deleted = o.deleted === true;
  if (!c.id) throw new Error('聯絡人資料缺少 ID');
  return c;
}

export function parseHistory(v: unknown): TitleHistoryEntry {
  const o = (typeof v === 'object' && v !== null ? v : {}) as Record<string, unknown>;
  const keys: Array<keyof TitleHistoryEntry> = ['id', 'contact_id', 'company_zh', 'company_en', 'company_short',
    'department', 'title_zh', 'title_en', 'valid_until', 'first_seen', 'card_image_id', 'recorded_at'];
  const h = {} as TitleHistoryEntry;
  for (const k of keys) h[k] = s(o[k]);
  return h;
}

export function displayName(c: Pick<Contact, 'name_zh' | 'name_en'>): string {
  return [c.name_zh, c.name_en].filter(Boolean).join(' ') || '（未填姓名）';
}

export function displayCompany(c: Pick<Contact, 'company_short' | 'company_zh' | 'company_en'>): string {
  return c.company_short || c.company_zh || c.company_en || '';
}

export function displayTitle(c: Pick<Contact, 'title_zh' | 'title_en'>): string {
  return [c.title_zh, c.title_en].filter(Boolean).join(' / ');
}

export function splitTags(tags: string): string[] {
  return tags.split(/\s*[,，]\s*/).map((t) => t.trim()).filter(Boolean);
}

const SEARCH_KEYS: Array<keyof Contact> = [
  'name_zh', 'name_en', 'company_zh', 'company_en', 'company_short', 'title_zh', 'title_en',
  'department', 'email', 'mobile', 'phone', 'tags', 'event', 'notes'
];

function norm(x: string): string {
  return x.toLowerCase().replace(/[\s\-()]/g, '');
}

/** 建立搜尋用字串（快取在物件外，避免每次重算）。 */
const indexCache = new WeakMap<Contact, string>();
function indexOf(c: Contact): string {
  let v = indexCache.get(c);
  if (!v) {
    v = norm(SEARCH_KEYS.map((k) => String(c[k] ?? '')).join('|'));
    // 電話也可用 09 開頭搜尋
    v += '|' + norm([c.mobile, c.phone].join(' ').replace(/\+886/g, '0'));
    indexCache.set(c, v);
  }
  return v;
}

/** 依關鍵字（空白分隔，全部符合）與標籤篩選，依取得日期新到舊排序。 */
export function searchContacts(contacts: Contact[], query: string, tag: string | null = null): Contact[] {
  const terms = query.split(/\s+/).map(norm).filter(Boolean);
  return contacts
    .filter((c) => !c.deleted)
    .filter((c) => !tag || splitTags(c.tags).includes(tag))
    .filter((c) => terms.every((t) => indexOf(c).includes(t)))
    .sort((a, b) => (b.met_date || b.created_at).localeCompare(a.met_date || a.created_at));
}

export function allTags(contacts: Contact[]): string[] {
  const counts = new Map<string, number>();
  for (const c of contacts) if (!c.deleted) for (const t of splitTags(c.tags)) counts.set(t, (counts.get(t) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([t]) => t);
}

export function groupByCompany(contacts: Contact[]): Array<[string, Contact[]]> {
  const m = new Map<string, Contact[]>();
  for (const c of contacts) {
    const k = displayCompany(c) || '（未填公司）';
    m.set(k, [...(m.get(k) ?? []), c]);
  }
  return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0], 'zh-Hant'));
}

/** 確認頁儲存前檢查：至少要有姓名、公司或 Email 其中之一。 */
export function isSavable(f: CardFields): boolean {
  return !!(f.name_zh || f.name_en || f.company_zh || f.company_en || f.email);
}

export const TITLE_KEYS = ['company_zh', 'company_en', 'department', 'title_zh', 'title_en'] as const;

export function titleFieldsChanged(before: Partial<Contact>, after: Partial<Contact>): boolean {
  return TITLE_KEYS.some((k) => (before[k] ?? '').trim() !== (after[k] ?? '').trim());
}

/** 電話撥號用 tel: 連結（多筆取第一筆）。 */
export function firstOf(multi: string): string {
  return multi.split(/\s*;\s*/)[0] ?? '';
}
