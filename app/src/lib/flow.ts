/** 拍照 → 縮圖 → 草稿 → 辨識 的流程。 */
import { ApiError, recognize } from '../api/client';
import { getDraft, newLocalId, saveDraft, todayTaipei } from '../db/db';
import type { Draft } from '../db/db';
import { toDraftCards } from './draftOps';
import { blobToBase64, prepareImage } from './image';
import type { PreparedImage } from './image';
import type { CompareResult, Provider, ProviderChoice, RecognizeResult } from './types';

export async function createDraftFromFile(file: Blob, provider: ProviderChoice): Promise<Draft> {
  const photo = await prepareImage(file);
  const draft: Draft = {
    localId: newLocalId('d'),
    createdAt: Date.now(),
    photo,
    status: 'recognizing',
    provider,
    cards: [],
    batch: { tags: '', event: '', metDate: todayTaipei() }
  };
  await saveDraft(draft);
  return draft;
}

export function errorMessage(e: unknown): string {
  if (e instanceof ApiError) return e.message;
  if (e instanceof Error) return e.message;
  return '發生未知錯誤';
}

/** 對草稿執行辨識並存檔，回傳更新後草稿（失敗時 status = error，原圖保留）。 */
export async function runRecognition(draft: Draft): Promise<Draft> {
  const base64 = await blobToBase64(draft.photo.blob);
  let next: Draft;
  try {
    const r = await recognize(base64, draft.provider);
    next = applyResult(draft, r);
  } catch (e) {
    next = { ...draft, status: 'error', error: errorMessage(e) };
  }
  await saveDraft(next);
  return next;
}

export function applyResult(draft: Draft, r: RecognizeResult | CompareResult): Draft {
  if ('results' in r) {
    const compare: NonNullable<Draft['compare']> = {};
    for (const p of ['claude', 'gemini'] as Provider[]) {
      const x = r.results[p];
      if (!x) continue;
      compare[p] = 'error' in x
        ? { cards: [], error: x.error.message, model: '' }
        : { cards: toDraftCards(x.cards, p, x.model), model: x.model };
    }
    return { ...draft, status: 'compare', compare, error: undefined };
  }
  return { ...draft, status: 'review', cards: toDraftCards(r.cards, r.provider, r.model), error: undefined };
}

/** 單一框重新辨識：送裁好的圖，取第一張結果。 */
export async function recognizeCrop(crop: PreparedImage, provider: Provider, side: 'front' | 'back' = 'front') {
  const base64 = await blobToBase64(crop.blob);
  const r = await recognize(base64, provider, side);
  if ('results' in r) throw new Error('不支援');
  return r;
}

export async function reloadDraft(id: string): Promise<Draft | undefined> {
  return getDraft(id);
}
