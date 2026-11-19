/** 呼叫 GAS 後端的唯一入口（docs/04）。 */
import { CARD_FIELD_KEYS, emptyFields } from '../lib/types';
import type {
  ApiErrorBody, Box, CardResult, CompareResult, Orientation, Provider, ProviderChoice, RecognizeResult
} from '../lib/types';
import { loadSettings } from '../lib/settings';
import { parseContact, parseHistory } from '../lib/contact';
import type { Contact, TitleHistoryEntry } from '../lib/contact';
import type { CardFields } from '../lib/types';

export class ApiError extends Error {
  constructor(public code: string, message: string) {
    super(message);
  }
}

const TIMEOUT_MS = 90_000;

function newRequestId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : String(Date.now()) + Math.random().toString(36).slice(2);
}

export async function callApi(action: string, params: Record<string, unknown> = {},
  opts: { gasUrl?: string; token?: string; fetchImpl?: typeof fetch } = {}): Promise<unknown> {
  const s = loadSettings();
  const url = opts.gasUrl ?? s.gasUrl;
  const token = opts.token ?? s.token;
  if (!url || !token) throw new ApiError('NOT_CONFIGURED', '請先到「設定」輸入後端網址與存取權杖');
  const f = opts.fetchImpl ?? fetch;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  let res: Response;
  try {
    res = await f(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ token, action, requestId: newRequestId(), ...params }),
      redirect: 'follow',
      signal: ctrl.signal
    });
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') {
      throw new ApiError('TIMEOUT', '後端回應逾時，請稍後再試');
    }
    throw new ApiError('NETWORK', typeof navigator !== 'undefined' && navigator.onLine === false
      ? '目前沒有網路連線' : '無法連線到後端，請確認網址是否正確');
  } finally {
    clearTimeout(timer);
  }
  let json: unknown;
  try {
    json = await res.json();
  } catch {
    throw new ApiError('BAD_RESPONSE', '後端回應格式錯誤，請確認網址是 Apps Script 部署網址');
  }
  return unwrap(json);
}

export function unwrap(json: unknown): unknown {
  if (!isObj(json) || typeof json.ok !== 'boolean') {
    throw new ApiError('BAD_RESPONSE', '後端回應格式錯誤');
  }
  if (!json.ok) {
    const err = isObj(json.error) ? json.error : {};
    throw new ApiError(str(err.code) || 'INTERNAL', str(err.message) || '後端發生錯誤');
  }
  return json.data;
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}
function num(v: unknown): number {
  return typeof v === 'number' && isFinite(v) ? v : 0;
}

const ORIENTATIONS: Orientation[] = ['0', '90', '180', '270'];

export function parseCard(v: unknown): CardResult {
  if (!isObj(v)) throw new ApiError('BAD_RESPONSE', '辨識結果格式錯誤');
  const fields = emptyFields();
  const rf = isObj(v.fields) ? v.fields : {};
  for (const k of CARD_FIELD_KEYS) fields[k] = str(rf[k]);
  const b = Array.isArray(v.box_2d) && v.box_2d.length === 4 ? v.box_2d.map(num) : [0, 0, 1000, 1000];
  const o = str(v.orientation) as Orientation;
  const side = v.side === 'front' || v.side === 'back' ? v.side : 'unknown';
  return {
    fields,
    box_2d: b as Box,
    orientation: ORIENTATIONS.includes(o) ? o : '0',
    side,
    lowConfidenceFields: Array.isArray(v.lowConfidenceFields) ? v.lowConfidenceFields.map(str).filter(Boolean) : [],
    warnings: Array.isArray(v.warnings) ? v.warnings.map(str).filter(Boolean) : []
  };
}

export function parseRecognize(v: unknown): RecognizeResult {
  if (!isObj(v) || !Array.isArray(v.cards)) throw new ApiError('BAD_RESPONSE', '辨識結果格式錯誤');
  const usage = isObj(v.usage) ? v.usage : {};
  return {
    provider: v.provider === 'gemini' ? 'gemini' : 'claude',
    model: str(v.model),
    latencyMs: num(v.latencyMs),
    usage: { inputTokens: num(usage.inputTokens), outputTokens: num(usage.outputTokens), estCostUsd: num(usage.estCostUsd) },
    cards: v.cards.map(parseCard),
    warnings: Array.isArray(v.warnings) ? v.warnings.map(str) : []
  };
}

export function parseCompare(v: unknown): CompareResult {
  if (!isObj(v) || !isObj(v.results)) throw new ApiError('BAD_RESPONSE', '比較結果格式錯誤');
  const results: CompareResult['results'] = {};
  for (const p of ['claude', 'gemini'] as Provider[]) {
    const r = v.results[p];
    if (!isObj(r)) continue;
    if (isObj(r.error)) {
      results[p] = { error: { code: str(r.error.code), message: str(r.error.message) } as ApiErrorBody };
    } else {
      results[p] = parseRecognize(r);
    }
  }
  return { results, compareGroupId: str(v.compareGroupId) };
}

export interface PingResult {
  version: string; sheetOk: boolean; driveOk: boolean; providers: string[]; defaultProvider: string;
}

export async function ping(opts?: { gasUrl: string; token: string }): Promise<PingResult> {
  const d = await callApi('ping', {}, opts);
  if (!isObj(d)) throw new ApiError('BAD_RESPONSE', '後端回應格式錯誤');
  return {
    version: str(d.version), sheetOk: d.sheetOk === true, driveOk: d.driveOk === true,
    providers: Array.isArray(d.providers) ? d.providers.map(str) : [], defaultProvider: str(d.defaultProvider)
  };
}

export async function recognize(base64: string, provider: ProviderChoice,
  side: 'front' | 'back' = 'front'): Promise<RecognizeResult | CompareResult> {
  const d = await callApi('recognize', { provider, side, image: { mime: 'image/jpeg', base64 } });
  return provider === 'compare' ? parseCompare(d) : parseRecognize(d);
}

// ---- P4：儲存、同步、聯絡人 ----

export interface DuplicateCandidate { contactId: string; score: number; reasons: string[]; contact: Contact }

export async function findDuplicates(cards: Array<{ tempId: string; fields: CardFields }>): Promise<Record<string, DuplicateCandidate[]>> {
  const d = await callApi('findDuplicates', { cards });
  const out: Record<string, DuplicateCandidate[]> = {};
  if (!isObj(d) || !Array.isArray(d.matches)) throw new ApiError('BAD_RESPONSE', '比對結果格式錯誤');
  for (const m of d.matches) {
    if (!isObj(m) || !Array.isArray(m.candidates)) continue;
    out[str(m.tempId)] = m.candidates.filter(isObj).map((c) => ({
      contactId: str(c.contactId), score: num(c.score),
      reasons: Array.isArray(c.reasons) ? c.reasons.map(str) : [], contact: parseContact(c.contact)
    }));
  }
  return out;
}

export interface SaveCardInput {
  tempId: string;
  fields: Record<string, string>;
  front: { mime: string; base64: string };
  back: { mime: string; base64: string } | null;
  aiProvider: string;
  aiModel: string;
  mergeIntoId: string | null;
}

export async function saveCards(sourcePhoto: { mime: string; base64: string }, batch: { tags: string[]; event: string; metDate: string },
  cards: SaveCardInput[], requestId: string): Promise<Array<{ tempId: string; contact: Contact; merged: boolean; titleChanged: boolean }>> {
  const d = await callApi('saveCards', { sourcePhoto, batch, cards, requestId });
  if (!isObj(d) || !Array.isArray(d.contacts)) throw new ApiError('BAD_RESPONSE', '儲存結果格式錯誤');
  return d.contacts.filter(isObj).map((x) => ({
    tempId: str(x.tempId), contact: parseContact(x.contact), merged: x.merged === true, titleChanged: x.titleChanged === true
  }));
}

export async function listContacts(since: string | null): Promise<{ contacts: Contact[]; serverTime: string }> {
  const d = await callApi('list', { since });
  if (!isObj(d) || !Array.isArray(d.contacts)) throw new ApiError('BAD_RESPONSE', '同步資料格式錯誤');
  return { contacts: d.contacts.map(parseContact), serverTime: str(d.serverTime) };
}

export async function getContact(id: string): Promise<{ contact: Contact; titleHistory: TitleHistoryEntry[] }> {
  const d = await callApi('getContact', { id });
  if (!isObj(d)) throw new ApiError('BAD_RESPONSE', '聯絡人資料格式錯誤');
  return { contact: parseContact(d.contact), titleHistory: Array.isArray(d.titleHistory) ? d.titleHistory.map(parseHistory) : [] };
}

export async function updateContact(id: string, fields: Record<string, string>, baseUpdatedAt: string,
  recordTitleChange: boolean): Promise<{ contact: Contact; conflict: boolean }> {
  const d = await callApi('updateContact', { id, fields, baseUpdatedAt, recordTitleChange });
  if (!isObj(d)) throw new ApiError('BAD_RESPONSE', '更新結果格式錯誤');
  return { contact: parseContact(d.contact), conflict: d.conflict === true };
}

export async function deleteContact(id: string): Promise<Contact> {
  const d = await callApi('deleteContact', { id });
  if (!isObj(d)) throw new ApiError('BAD_RESPONSE', '刪除結果格式錯誤');
  return parseContact(d.contact);
}

export async function getImage(fileId: string, size: 'thumb' | 'full'): Promise<Blob> {
  const d = await callApi('getImage', { fileId, size });
  if (!isObj(d) || typeof d.base64 !== 'string') throw new ApiError('BAD_RESPONSE', '圖片格式錯誤');
  const bin = atob(d.base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: str(d.mime) || 'image/jpeg' });
}

export interface Stats { month: string; recognitions: number; cards: number; estCostUsd: number }

export async function getStats(month: string): Promise<Stats> {
  const d = await callApi('stats', { month });
  if (!isObj(d)) throw new ApiError('BAD_RESPONSE', '統計資料格式錯誤');
  return { month: str(d.month), recognitions: num(d.recognitions), cards: num(d.cards), estCostUsd: num(d.estCostUsd) };
}
