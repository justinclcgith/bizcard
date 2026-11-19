/** 與 docs/03、docs/04 對應的型別。 */

/** [ymin, xmin, ymax, xmax]，0–1000 正規化 */
export type Box = [number, number, number, number];
export type Orientation = '0' | '90' | '180' | '270';
export type Provider = 'claude' | 'gemini';
export type ProviderChoice = Provider | 'compare';

export const CARD_FIELD_KEYS = [
  'name_zh', 'name_en', 'title_zh', 'title_en', 'department',
  'company_zh', 'company_en', 'company_short',
  'mobile', 'phone', 'phone_ext', 'fax', 'email', 'website',
  'address_zh', 'address_en', 'line_id', 'linkedin', 'other_social'
] as const;

export type CardFieldKey = (typeof CARD_FIELD_KEYS)[number];
export type CardFields = Record<CardFieldKey, string>;

export const FIELD_LABELS: Record<CardFieldKey, string> = {
  name_zh: '中文姓名', name_en: '英文姓名',
  title_zh: '中文職稱', title_en: '英文職稱', department: '部門',
  company_zh: '公司中文全名', company_en: '公司英文全名', company_short: '公司簡稱',
  mobile: '手機', phone: '市話', phone_ext: '分機', fax: '傳真',
  email: 'Email', website: '網址', address_zh: '中文地址', address_en: '英文地址',
  line_id: 'LINE ID', linkedin: 'LinkedIn', other_social: '其他社群'
};

/** AI 低信心欄位名稱 → 表單欄位 */
export const LOW_CONF_ALIAS: Record<string, CardFieldKey> = {
  mobiles: 'mobile', phones: 'phone', faxes: 'fax', emails: 'email'
};

export interface CardResult {
  fields: CardFields;
  box_2d: Box;
  orientation: Orientation;
  side: 'front' | 'back' | 'unknown';
  lowConfidenceFields: string[];
  warnings: string[];
}

export interface RecognizeResult {
  provider: Provider;
  model: string;
  latencyMs: number;
  usage: { inputTokens: number; outputTokens: number; estCostUsd: number };
  cards: CardResult[];
  warnings: string[];
}

export interface CompareResult {
  results: Partial<Record<Provider, RecognizeResult | { error: ApiErrorBody }>>;
  compareGroupId: string;
}

export interface ApiErrorBody { code: string; message: string }

export function emptyFields(): CardFields {
  const f = {} as CardFields;
  for (const k of CARD_FIELD_KEYS) f[k] = '';
  return f;
}
