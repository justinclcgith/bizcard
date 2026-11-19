/** 聯絡人詳情：名片圖、欄位、快速動作、職稱歷程、編輯、刪除（docs/01 F6.4、F6.5、F5）。 */
import { useEffect, useState } from 'preact/hooks';
import { useLocation, useRoute } from 'preact-iso';
import { getContact } from '../api/client';
import { CARD_FIELD_KEYS, FIELD_LABELS } from '../lib/types';
import type { CardFieldKey } from '../lib/types';
import { displayCompany, displayName, displayTitle, firstOf, titleFieldsChanged } from '../lib/contact';
import type { Contact as ContactT, TitleHistoryEntry } from '../lib/contact';
import { errorMessage } from '../lib/flow';
import { to } from '../lib/paths';
import { cachedContact, loadImage, removeContact, saveContactEdit } from '../lib/sync';

type EditKey = CardFieldKey | 'tags' | 'event' | 'met_date' | 'notes';
const EXTRA_LABELS: Record<'tags' | 'event' | 'met_date' | 'notes', string> = {
  tags: '標籤（逗號分隔）', event: '取得場合', met_date: '取得日期', notes: '備註'
};
const EDIT_KEYS: EditKey[] = [...CARD_FIELD_KEYS, 'tags', 'event', 'met_date', 'notes'];
const label = (k: EditKey): string => (k in EXTRA_LABELS ? EXTRA_LABELS[k as keyof typeof EXTRA_LABELS] : FIELD_LABELS[k as CardFieldKey]);

function useImage(fileId: string, size: 'thumb' | 'full'): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let u: string | null = null;
    let alive = true;
    void loadImage(fileId, size).then((b) => {
      if (alive && b) { u = URL.createObjectURL(b); setUrl(u); }
    });
    return () => { alive = false; if (u) URL.revokeObjectURL(u); };
  }, [fileId, size]);
  return url;
}

function CardImage({ fileId, alt, onZoom }: { fileId: string; alt: string; onZoom: () => void }) {
  const url = useImage(fileId, 'thumb');
  if (!fileId) return null;
  return url ? <img src={url} alt={alt} onClick={onZoom} data-testid="card-image" /> : <span class="muted small">{alt}載入中…</span>;
}

function Zoom({ fileId, onClose }: { fileId: string; onClose: () => void }) {
  const url = useImage(fileId, 'full');
  return (
    <div class="zoom" onClick={onClose} role="dialog" aria-label="名片大圖">
      {url ? <img src={url} alt="名片大圖" /> : <span style="color:#fff">載入中…</span>}
    </div>
  );
}

const mapsUrl = (addr: string) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(addr)}`;
const withScheme = (u: string) => (/^https?:\/\//i.test(u) ? u : `https://${u}`);

export function Contact() {
  const { params } = useRoute();
  const { route } = useLocation();
  const id = params.id ?? '';
  const [c, setC] = useState<ContactT | null | undefined>(undefined);
  const [history, setHistory] = useState<TitleHistoryEntry[] | null>(null);
  const [editing, setEditing] = useState<Record<string, string> | null>(null);
  const [recordTitle, setRecordTitle] = useState(true);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [zoom, setZoom] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ text: string; error?: boolean } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    void cachedContact(id).then((x) => { if (alive) setC((cur) => cur ?? x ?? undefined); });
    getContact(id)
      .then((r) => { if (alive) { setC(r.contact); setHistory(r.titleHistory); } })
      .catch(() => { void cachedContact(id).then((x) => { if (alive) setC(x ?? null); }); });
    return () => { alive = false; };
  }, [id]);

  if (c === undefined) return <section class="page"><p>載入中…</p></section>;
  if (c === null) return <section class="page"><p class="notice">找不到這位聯絡人。</p><a href={to('')}>回名片夾</a></section>;

  async function save() {
    if (!c || !editing) return;
    const changed: Record<string, string> = {};
    for (const k of EDIT_KEYS) if ((editing[k] ?? '') !== (c[k] ?? '')) changed[k] = editing[k] ?? '';
    if (!Object.keys(changed).length) { setEditing(null); return; }
    setBusy(true);
    try {
      const r = await saveContactEdit(c, changed, titleFieldsChanged(c, editing) && recordTitle);
      setC(r.contact);
      setEditing(null);
      setMsg(r.offline ? { text: '目前離線，變更已存在手機，連線後自動同步' }
        : r.conflict ? { text: '其他裝置已修改過這筆資料，已改為顯示最新內容，請確認後再編輯', error: true }
        : { text: '已儲存' });
      if (!r.offline && !r.conflict) {
        getContact(c.id).then((x) => setHistory(x.titleHistory)).catch(() => undefined);
      }
    } catch (e) {
      setMsg({ text: `儲存失敗：${errorMessage(e)}`, error: true });
    }
    setBusy(false);
  }

  async function doDelete() {
    if (!c) return;
    setBusy(true);
    try {
      await removeContact(c);
      try { sessionStorage.setItem('bizcard.flash', `已刪除 ${displayName(c)}`); } catch { /* 無妨 */ }
      route(to(''));
    } catch (e) {
      setMsg({ text: `刪除失敗：${errorMessage(e)}`, error: true });
      setBusy(false);
    }
  }

  if (editing) {
    const titleChanged = titleFieldsChanged(c, editing);
    return (
      <section class="page">
        <h1>編輯聯絡人</h1>
        {EDIT_KEYS.map((k) => (
          <label key={k} class="field">
            <span>{label(k)}</span>
            <input value={editing[k] ?? ''} type={k === 'met_date' ? 'date' : 'text'} data-testid={`edit-${k}`}
              onInput={(e) => { const v = (e.target as HTMLInputElement).value; setEditing((x) => ({ ...x, [k]: v })); }} />
          </label>
        ))}
        {titleChanged && (
          <label class="check">
            <input type="checkbox" checked={recordTitle} data-testid="record-title"
              onChange={(e) => setRecordTitle((e.target as HTMLInputElement).checked)} />
            <span>這是職稱或公司異動（舊職稱記入職稱歷程）；取消勾選表示只是修正錯字</span>
          </label>
        )}
        <div class="sticky-actions">
          <button class="secondary" onClick={() => setEditing(null)} disabled={busy}>取消</button>
          <button onClick={save} disabled={busy} data-testid="edit-save">{busy ? '儲存中…' : '儲存'}</button>
        </div>
      </section>
    );
  }

  const tel = firstOf(c.mobile) || firstOf(c.phone);
  const email = firstOf(c.email);
  const addr = c.address_zh || c.address_en;
  const web = c.linkedin || firstOf(c.website);
  const pastTitles = (history ?? []).slice().sort((a, b) => b.recorded_at.localeCompare(a.recorded_at));

  return (
    <section class="page">
      <h1 data-testid="contact-name">{displayName(c)}</h1>
      <p class="muted">{[displayCompany(c), c.department, displayTitle(c)].filter(Boolean).join(' · ')}</p>
      {msg && <p class={msg.error ? 'notice error' : 'notice ok'}>{msg.text}</p>}

      <div class="detail-images">
        <CardImage fileId={c.front_image_id} alt="正面" onZoom={() => setZoom(c.front_image_id)} />
        <CardImage fileId={c.back_image_id} alt="背面" onZoom={() => setZoom(c.back_image_id)} />
      </div>

      <div class="detail-actions">
        <a class={tel ? 'button secondary' : 'button secondary disabled'} href={tel ? `tel:${tel}` : undefined} data-testid="act-tel"><span>📞</span>撥號</a>
        <a class={email ? 'button secondary' : 'button secondary disabled'} href={email ? `mailto:${email}` : undefined} data-testid="act-mail"><span>✉️</span>寄信</a>
        <a class={addr ? 'button secondary' : 'button secondary disabled'} href={addr ? mapsUrl(addr) : undefined} target="_blank" rel="noopener" data-testid="act-map"><span>🗺️</span>地圖</a>
        <a class={web ? 'button secondary' : 'button secondary disabled'} href={web ? withScheme(web) : undefined} target="_blank" rel="noopener" data-testid="act-web"><span>{c.linkedin ? '💼' : '🌐'}</span>{c.linkedin ? 'LinkedIn' : '網站'}</a>
      </div>

      <dl class="detail-fields">
        {EDIT_KEYS.filter((k) => c[k]).map((k) => (
          <>
            <dt key={`t-${k}`}>{label(k).replace('（逗號分隔）', '')}</dt>
            <dd key={`d-${k}`}><FieldValue k={k} v={c[k]} /></dd>
          </>
        ))}
      </dl>

      <h2>職稱歷程</h2>
      {history === null ? <p class="muted small">離線中，無法載入職稱歷程</p> : (
        <ol class="timeline" data-testid="timeline">
          <li><strong>{displayTitle(c) || '（未填職稱）'}</strong>　{displayCompany(c)}<br /><span class="muted small">目前</span></li>
          {pastTitles.map((h) => (
            <li key={h.id}>
              {[h.title_zh, h.title_en].filter(Boolean).join(' / ') || '（未填職稱）'}　{h.company_short || h.company_zh || h.company_en}
              {h.department && ` · ${h.department}`}<br />
              <span class="muted small">{h.first_seen ? `${h.first_seen} 起` : ''}{h.valid_until ? ` 至 ${h.valid_until}` : ''}</span>
            </li>
          ))}
        </ol>
      )}

      <div class="row" style="margin-top:24px">
        <button onClick={() => setEditing(Object.fromEntries(EDIT_KEYS.map((k) => [k, c[k] ?? ''])))} data-testid="edit">編輯</button>
        {confirmDelete ? (
          <>
            <button class="danger" onClick={doDelete} disabled={busy} data-testid="delete-confirm">確定刪除</button>
            <button class="secondary" onClick={() => setConfirmDelete(false)}>取消</button>
          </>
        ) : <button class="danger" onClick={() => setConfirmDelete(true)} data-testid="delete">刪除</button>}
      </div>
      <p class="hint">建立於 {c.created_at.slice(0, 10)}，最後更新 {c.updated_at.slice(0, 16).replace('T', ' ')}</p>

      {zoom && <Zoom fileId={zoom} onClose={() => setZoom(null)} />}
    </section>
  );
}

function FieldValue({ k, v }: { k: EditKey; v: string }) {
  const parts = v.split(/\s*;\s*/).filter(Boolean);
  return (
    <>
      {parts.map((p, i) => {
        const sep = i ? '；' : '';
        if (k === 'mobile' || k === 'phone') return <span key={i}>{sep}<a href={`tel:${p}`}>{p}</a></span>;
        if (k === 'email') return <span key={i}>{sep}<a href={`mailto:${p}`}>{p}</a></span>;
        if (k === 'website' || k === 'linkedin') return <span key={i}>{sep}<a href={withScheme(p)} target="_blank" rel="noopener">{p}</a></span>;
        if (k === 'address_zh' || k === 'address_en') return <span key={i}>{sep}<a href={mapsUrl(p)} target="_blank" rel="noopener">{p}</a></span>;
        return <span key={i}>{sep}{p}</span>;
      })}
    </>
  );
}
