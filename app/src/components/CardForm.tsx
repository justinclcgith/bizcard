/** 單張名片欄位表單；低信心欄位以醒目顏色提示。 */
import { useState } from 'preact/hooks';
import { CARD_FIELD_KEYS, FIELD_LABELS, LOW_CONF_ALIAS } from '../lib/types';
import type { CardFieldKey, CardFields } from '../lib/types';

const PRIMARY: CardFieldKey[] = [
  'name_zh', 'name_en', 'company_short', 'company_zh', 'company_en',
  'title_zh', 'title_en', 'mobile', 'email'
];

export function CardForm({ fields, lowConfidence, onChange, index }: {
  fields: CardFields; lowConfidence: string[]; index: number;
  onChange: (key: CardFieldKey, value: string) => void;
}) {
  const [more, setMore] = useState(false);
  const low = new Set(lowConfidence.map((f) => LOW_CONF_ALIAS[f] ?? f));
  const keys = more ? CARD_FIELD_KEYS : PRIMARY;

  return (
    <div class="card-form">
      {keys.map((k) => (
        <label key={k} class={low.has(k) ? 'field low' : 'field'}>
          <span>{FIELD_LABELS[k]}{low.has(k) && <em class="low-tag">請確認</em>}</span>
          <input
            value={fields[k]}
            inputMode={k === 'mobile' || k === 'phone' || k === 'fax' || k === 'phone_ext' ? 'tel'
              : k === 'email' ? 'email' : k === 'website' || k === 'linkedin' ? 'url' : 'text'}
            data-testid={`field-${index + 1}-${k}`}
            onInput={(e) => onChange(k, (e.target as HTMLInputElement).value)}
          />
        </label>
      ))}
      <button type="button" class="link" onClick={() => setMore(!more)}>
        {more ? '收合欄位' : '顯示全部欄位'}
      </button>
    </div>
  );
}
