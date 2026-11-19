/** 把辨識結果轉成草稿卡片（純函式）。 */
import type { DraftCard } from '../db/db';
import type { CardResult, Provider } from './types';
import { emptyFields } from './types';
import { DEFAULT_NEW_BOX } from './geometry';

let seq = 0;
export function tempId(): string {
  seq += 1;
  return `t${Date.now().toString(36)}${seq}`;
}

export function toDraftCards(cards: CardResult[], provider: Provider, model: string): DraftCard[] {
  return cards.map((c) => ({
    tempId: tempId(),
    box: c.box_2d,
    orientation: c.orientation,
    fields: { ...c.fields },
    lowConfidenceFields: [...c.lowConfidenceFields],
    provider,
    model,
    back: null
  }));
}

export function manualCard(): DraftCard {
  return {
    tempId: tempId(), box: [...DEFAULT_NEW_BOX], orientation: '0', fields: emptyFields(),
    lowConfidenceFields: [], provider: 'manual', model: '', back: null
  };
}

/** 合併背面辨識結果：只補空白欄位，衝突欄位回傳讓使用者選。 */
export function mergeBack(front: DraftCard, back: CardResult): { card: DraftCard; conflicts: Array<{ key: keyof DraftCard['fields']; front: string; back: string }> } {
  const fields = { ...front.fields };
  const conflicts: Array<{ key: keyof DraftCard['fields']; front: string; back: string }> = [];
  for (const k of Object.keys(fields) as Array<keyof typeof fields>) {
    const b = back.fields[k];
    if (!b) continue;
    if (!fields[k]) fields[k] = b;
    else if (fields[k] !== b) conflicts.push({ key: k, front: fields[k], back: b });
  }
  return { card: { ...front, fields }, conflicts };
}

/** 卡片摘要文字（列表與比較畫面用）。 */
export function cardTitle(c: DraftCard): string {
  const f = c.fields;
  const name = [f.name_zh, f.name_en].filter(Boolean).join(' ');
  const co = f.company_short || f.company_zh || f.company_en;
  return [name || '（未辨識姓名）', co].filter(Boolean).join('｜');
}
