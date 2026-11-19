/** 「疑似同一人」對話框：並列差異，逐張選擇合併或新增（docs/01 F5、docs/03 §5）。 */
import { useState } from 'preact/hooks';
import type { DuplicateCandidate } from '../api/client';
import type { DraftCard } from '../db/db';
import { cardTitle } from '../lib/draftOps';
import { displayCompany, displayName, displayTitle } from '../lib/contact';
import { FIELD_LABELS } from '../lib/types';
import type { CardFieldKey } from '../lib/types';

const REASON_LABEL: Record<string, string> = {
  email: 'Email 相同', mobile: '手機相同', name_company: '姓名與公司相同', name: '姓名相同'
};
const DIFF_KEYS: CardFieldKey[] = ['name_zh', 'name_en', 'company_zh', 'company_en', 'title_zh', 'title_en', 'mobile', 'email'];

export function DuplicateDialog({ cards, candidates, onCancel, onConfirm }: {
  cards: DraftCard[];
  candidates: Record<string, DuplicateCandidate[]>;
  onCancel: () => void;
  onConfirm: (targets: Record<string, string | null>) => void;
}) {
  const withDup = cards.filter((c) => (candidates[c.tempId] ?? []).length > 0);
  // 預設：分數最高者合併（同一人換名片最常見），使用者可改成新增
  const [choice, setChoice] = useState<Record<string, string | null>>(() =>
    Object.fromEntries(withDup.map((c) => [c.tempId, candidates[c.tempId]![0]!.contactId])));

  return (
    <div class="dialog-backdrop" role="dialog" aria-modal="true" aria-labelledby="dup-title">
      <div class="dialog" data-testid="dup-dialog">
        <h2 id="dup-title">疑似已存在的聯絡人</h2>
        {withDup.map((c) => (
          <section key={c.tempId} class="dup-card">
            <h3>{cardTitle(c)}</h3>
            {candidates[c.tempId]!.map((m) => (
              <label key={m.contactId} class={choice[c.tempId] === m.contactId ? 'dup-option chosen' : 'dup-option'}>
                <input type="radio" name={`dup-${c.tempId}`} checked={choice[c.tempId] === m.contactId}
                  onChange={() => setChoice((x) => ({ ...x, [c.tempId]: m.contactId }))} />
                <span>
                  合併到 <strong>{displayName(m.contact)}</strong>
                  {displayCompany(m.contact) && `（${displayCompany(m.contact)}）`}
                  <span class="muted small"> · {m.reasons.map((r) => REASON_LABEL[r] ?? r).join('、')}</span>
                </span>
                <table class="diff">
                  <tbody>
                    {DIFF_KEYS.filter((k) => (m.contact[k] || c.fields[k]) && m.contact[k] !== c.fields[k]).map((k) => (
                      <tr key={k}><th>{FIELD_LABELS[k]}</th><td class="old">{m.contact[k] || '—'}</td><td class="new">{c.fields[k] || '—'}</td></tr>
                    ))}
                  </tbody>
                </table>
                {displayTitle(m.contact) !== displayTitle(c.fields) && (displayTitle(m.contact) || displayTitle(c.fields)) && (
                  <span class="hint">職稱或公司不同，合併時舊職稱會記入職稱歷程。</span>
                )}
              </label>
            ))}
            <label class={choice[c.tempId] === null ? 'dup-option chosen' : 'dup-option'}>
              <input type="radio" name={`dup-${c.tempId}`} checked={choice[c.tempId] === null}
                data-testid={`dup-new-${c.tempId}`}
                onChange={() => setChoice((x) => ({ ...x, [c.tempId]: null }))} />
              <span>不是同一人，新增聯絡人</span>
            </label>
          </section>
        ))}
        <div class="row dialog-actions">
          <button class="secondary" onClick={onCancel}>返回修改</button>
          <button data-testid="dup-confirm" onClick={() => onConfirm(choice)}>確定儲存</button>
        </div>
      </div>
    </div>
  );
}
