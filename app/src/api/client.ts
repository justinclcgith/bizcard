/** 呼叫 GAS 後端的唯一入口（docs/04）。 */
import { CARD_FIELD_KEYS, emptyFields } from '../lib/types';
import type {
  ApiErrorBody, Box, CardResult, CompareResult, Orientation, Provider, ProviderChoice, RecognizeResult
} from '../lib/types';
import { loadSettings } from '../lib/settings';

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
