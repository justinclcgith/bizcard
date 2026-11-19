/** 確認頁「儲存」：裁切 → 重複比對 → 送出 → 更新本機快取（docs/02 §2.1）。 */
import { findDuplicates, saveCards } from '../api/client';
import type { DuplicateCandidate, SaveCardInput } from '../api/client';
import { deleteDraft, putContacts, saveDraft } from '../db/db';
import type { Draft } from '../db/db';
import { splitTags } from './contact';
import type { Contact } from './contact';
import { blobToBase64, cropCard } from './image';

export async function checkDuplicates(draft: Draft): Promise<Record<string, DuplicateCandidate[]>> {
  return findDuplicates(draft.cards.map((c) => ({ tempId: c.tempId, fields: c.fields })));
}

/**
 * @param mergeTargets tempId → 要合併的聯絡人 ID（沒有則新增）
 */
export async function commitDraft(draft: Draft, mergeTargets: Record<string, string | null>): Promise<Array<{ contact: Contact; merged: boolean; titleChanged: boolean }>> {
  // 同一份草稿重試時沿用同一個 requestId，後端會回傳上次結果而不重複新增
  const requestId = `save_${draft.localId}_${draft.cards.map((c) => c.tempId).join('.')}`.slice(0, 80);
  const cards: SaveCardInput[] = [];
  for (const c of draft.cards) {
    const front = await cropCard(draft.photo, c.box, c.orientation);
    cards.push({
      tempId: c.tempId,
      fields: { ...c.fields },
      front: { mime: 'image/jpeg', base64: await blobToBase64(front.blob) },
      back: c.back ? { mime: 'image/jpeg', base64: await blobToBase64(c.back.blob) } : null,
      aiProvider: c.provider,
      aiModel: c.model,
      mergeIntoId: mergeTargets[c.tempId] ?? null
    });
  }
  const sourcePhoto = { mime: 'image/jpeg', base64: await blobToBase64(draft.photo.blob) };
  const batch = { tags: splitTags(draft.batch.tags), event: draft.batch.event.trim(), metDate: draft.batch.metDate };
  await saveDraft(draft);
  const result = await saveCards(sourcePhoto, batch, cards, requestId);
  await putContacts(result.map((r) => r.contact));
  await deleteDraft(draft.localId);
  return result;
}
