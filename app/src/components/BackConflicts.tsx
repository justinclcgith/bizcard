/** 加拍背面後，正反面欄位不同時讓使用者選擇（docs/01 F3.4）。 */
import { useState } from 'preact/hooks';
import { FIELD_LABELS } from '../lib/types';
import type { CardFieldKey } from '../lib/types';

export interface BackConflict { key: CardFieldKey; front: string; back: string }

export function BackConflicts({ items, onDone }: {
  items: BackConflict[];
  onDone: (picked: Partial<Record<CardFieldKey, string>>) => void;
}) {
  const [pick, setPick] = useState<Record<string, 'front' | 'back'>>(() =>
    Object.fromEntries(items.map((x) => [x.key, 'front'])));
  return (
    <div class="dialog-backdrop" role="dialog" aria-modal="true" aria-labelledby="back-title">
      <div class="dialog" data-testid="back-conflicts">
        <h2 id="back-title">正反面內容不同</h2>
        <p class="hint">空白欄位已用背面內容補上。以下欄位請選擇要保留哪一面：</p>
        {items.map((x) => (
          <fieldset key={x.key}>
            <legend>{FIELD_LABELS[x.key]}</legend>
            {(['front', 'back'] as const).map((side) => (
              <label key={side} class="check">
                <input type="radio" name={`bc-${x.key}`} checked={pick[x.key] === side}
                  onChange={() => setPick((p) => ({ ...p, [x.key]: side }))} />
                <span>{side === 'front' ? '正面' : '背面'}：{x[side]}</span>
              </label>
            ))}
          </fieldset>
        ))}
        <div class="row dialog-actions">
          <button data-testid="back-done" onClick={() => onDone(Object.fromEntries(items.map((x) => [x.key, x[pick[x.key] ?? 'front']])))}>完成</button>
        </div>
      </div>
    </div>
  );
}
