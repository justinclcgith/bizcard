/** 確認頁：原圖疊框、框調整、欄位修正、比較模式選擇（docs/01 F3）。 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { useLocation, useRoute } from 'preact-iso';
import { BoxEditor } from '../components/BoxEditor';
import { CardForm } from '../components/CardForm';
import { CropPreview } from '../components/CropPreview';
import { deleteDraft, getDraft, saveDraft } from '../db/db';
import type { Draft, DraftCard } from '../db/db';
import { cardTitle, manualCard, mergeBack, toDraftCards } from '../lib/draftOps';
import { isSavable } from '../lib/contact';
import { checkDuplicates, commitDraft } from '../lib/saveFlow';
import type { DuplicateCandidate } from '../api/client';
import { DuplicateDialog } from '../components/DuplicateDialog';
import { BackConflicts } from '../components/BackConflicts';
import type { BackConflict } from '../components/BackConflicts';
import { errorMessage, recognizeCrop, runRecognition } from '../lib/flow';
import { pairByIoU, rotateBoxCW } from '../lib/geometry';
import { cropCard, prepareImage, rotateImage90 } from '../lib/image';
import { to } from '../lib/paths';
import type { Box, CardFieldKey, Orientation, Provider } from '../lib/types';

const ROTATE_NEXT: Record<Orientation, Orientation> = { '0': '90', '90': '180', '180': '270', '270': '0' };

function useObjectUrl(blob: Blob | undefined): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!blob) return;
    const u = URL.createObjectURL(blob);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [blob]);
  return url;
}

export function Review() {
  const { params } = useRoute();
  const { route } = useLocation();
  const id = params.id ?? '';
  const [draft, setDraft] = useState<Draft | null | undefined>(undefined);
  const [selected, setSelected] = useState<number | null>(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dups, setDups] = useState<Record<string, DuplicateCandidate[]> | null>(null);
  const [backConflicts, setBackConflicts] = useState<{ index: number; items: BackConflict[] } | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout>>();
  const photoUrl = useObjectUrl(draft?.photo.blob);

  useEffect(() => {
    getDraft(id).then((d) => setDraft(d ?? null)).catch(() => setDraft(null));
  }, [id]);

  /** 更新草稿並延遲存入 IndexedDB（防止誤關頁面遺失）。 */
  const update = useCallback((fn: (d: Draft) => Draft) => {
    setDraft((cur) => {
      if (!cur) return cur;
      const next = fn(cur);
      clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => { void saveDraft(next); }, 300);
      return next;
    });
  }, []);

  useEffect(() => () => clearTimeout(saveTimer.current), []);

  const updateCard = useCallback((i: number, fn: (c: DraftCard) => DraftCard) => {
    update((d) => ({ ...d, cards: d.cards.map((c, j) => (j === i ? fn(c) : c)) }));
  }, [update]);

  const onBoxChange = useCallback((i: number, box: Box) => updateCard(i, (c) => ({ ...c, box })), [updateCard]);

  if (draft === undefined) return <section class="page"><p>載入中…</p></section>;
  if (draft === null) {
    return <section class="page"><p class="notice">找不到這筆草稿，可能已儲存或刪除。</p><a href={to('scan')}>回到掃描</a></section>;
  }

  async function retry() {
    if (!draft) return;
    setBusy('重新辨識中…');
    setError(null);
    const next = await runRecognition({ ...draft, status: 'recognizing' });
    setDraft(next);
    setBusy(null);
  }

  async function rotatePhoto() {
    if (!draft) return;
    setBusy('旋轉中…');
    const photo = await rotateImage90(draft.photo);
    const next: Draft = { ...draft, photo, cards: draft.cards.map((c) => ({ ...c, box: rotateBoxCW(c.box) })) };
    setDraft(next);
    await saveDraft(next);
    setBusy(null);
  }

  async function reRecognize(i: number) {
    if (!draft) return;
    const card = draft.cards[i];
    if (!card) return;
    setBusy(`重新辨識第 ${i + 1} 張…`);
    setError(null);
    try {
      const crop = await cropCard(draft.photo, card.box, card.orientation);
      const provider: Provider = draft.provider === 'gemini' ? 'gemini' : 'claude';
      const r = await recognizeCrop(crop, provider);
      const first = r.cards[0];
      if (!first) setError('這個框內沒有辨識到名片');
      else updateCard(i, (c) => ({ ...c, fields: { ...first.fields }, lowConfidenceFields: first.lowConfidenceFields, provider, model: r.model }));
    } catch (e) {
      setError(errorMessage(e));
    }
    setBusy(null);
  }

  async function addBack(i: number, file: File | undefined) {
    if (!draft || !file) return;
    setBusy(`辨識第 ${i + 1} 張背面…`);
    setError(null);
    try {
      const img = await prepareImage(file, 1200);
      const card = draft.cards[i];
      if (!card) return;
      const provider: Provider = card.provider === 'gemini' ? 'gemini' : 'claude';
      const r = await recognizeCrop(img, provider, 'back');
      const first = r.cards[0];
      const back = { blob: img.blob, width: img.width, height: img.height };
      if (!first) {
        updateCard(i, (c) => ({ ...c, back }));
        setError('背面沒有辨識到文字，已保留背面圖片');
      } else {
        const { card: merged, conflicts } = mergeBack(card, first);
        updateCard(i, () => ({ ...merged, back }));
        if (conflicts.length) setBackConflicts({ index: i, items: conflicts });
      }
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  async function startSave() {
    if (!draft) return;
    const bad = draft.cards.findIndex((c) => !isSavable(c.fields));
    if (bad >= 0) {
      setSelected(bad);
      setError(`第 ${bad + 1} 張至少要填姓名、公司或 Email 其中之一`);
      return;
    }
    if (!draft.cards.length) { setError('沒有可儲存的名片'); return; }
    setBusy('比對是否已存在…');
    setError(null);
    try {
      const found = await checkDuplicates(draft);
      if (Object.values(found).some((x) => x.length)) {
        setDups(found);
        setBusy(null);
        return;
      }
      await doSave({});
    } catch (e) {
      setError(errorMessage(e));
      setBusy(null);
    }
  }

  async function doSave(targets: Record<string, string | null>) {
    if (!draft) return;
    setDups(null);
    setBusy('儲存中…');
    setError(null);
    try {
      clearTimeout(saveTimer.current);
      const r = await commitDraft(draft, targets);
      const merged = r.filter((x) => x.merged).length;
      const msg = `已儲存 ${r.length} 張${merged ? `（其中 ${merged} 張合併到既有聯絡人）` : ''}`;
      sessionStorage.setItem('bizcard.flash', msg);
      route(to(''));
    } catch (e) {
      setError(`儲存失敗：${errorMessage(e)}。草稿已保留，可稍後再試。`);
      setBusy(null);
    }
  }

  async function discard() {
    if (!draft) return;
    await deleteDraft(draft.localId);
    route(to('scan'));
  }

  if (draft.status === 'error' || draft.status === 'recognizing' || draft.status === 'queued') {
    return (
      <section class="page">
        <h1>確認名片</h1>
        {photoUrl && <img class="photo-thumb" src={photoUrl} alt="原始照片" />}
        <p class="notice error">{draft.status === 'error' ? `辨識失敗：${draft.error}` : draft.status === 'queued' ? '離線時拍攝，等待連線後辨識' : '辨識尚未完成'}</p>
        <div class="row">
          <button onClick={retry} disabled={!!busy}>{busy ?? '重新辨識'}</button>
          <button class="secondary" onClick={discard}>捨棄</button>
        </div>
      </section>
    );
  }

  if (draft.status === 'compare') {
    return <ComparePicker draft={draft} photoUrl={photoUrl} onPicked={(cards) => {
      const next: Draft = { ...draft, status: 'review', cards };
      setDraft(next);
      void saveDraft(next);
    }} />;
  }

  return (
    <section class="page review">
      <h1>確認名片 <small>{draft.cards.length} 張</small></h1>
      {photoUrl && (
        <BoxEditor
          src={photoUrl} width={draft.photo.width} height={draft.photo.height}
          boxes={draft.cards.map((c) => c.box)} selected={selected}
          onSelect={setSelected} onChange={onBoxChange}
        />
      )}
      <div class="row tools">
        <button class="secondary" onClick={rotatePhoto} disabled={!!busy}>↻ 旋轉照片</button>
        <button class="secondary" data-testid="add-box" disabled={!!busy} onClick={() => {
          update((d) => ({ ...d, cards: [...d.cards, manualCard()] }));
          setSelected(draft.cards.length);
        }}>＋ 新增框</button>
      </div>
      {busy && <p class="notice">{busy}</p>}
      {error && <p class="notice error">{error}</p>}
      {draft.cards.length === 0 && <p class="notice">未偵測到名片。可以按「新增框」手動框選，或重拍。</p>}

      <fieldset class="batch">
        <legend>整批設定</legend>
        <label class="field"><span>標籤（以逗號分隔）</span>
          <input value={draft.batch.tags} onInput={(e) => update((d) => ({ ...d, batch: { ...d.batch, tags: (e.target as HTMLInputElement).value } }))} /></label>
        <label class="field"><span>場合</span>
          <input value={draft.batch.event} placeholder="例：BIO Asia 2026" onInput={(e) => update((d) => ({ ...d, batch: { ...d.batch, event: (e.target as HTMLInputElement).value } }))} /></label>
        <label class="field"><span>取得日期</span>
          <input type="date" value={draft.batch.metDate} onInput={(e) => update((d) => ({ ...d, batch: { ...d.batch, metDate: (e.target as HTMLInputElement).value } }))} /></label>
      </fieldset>

      {draft.cards.map((c, i) => (
        <article key={c.tempId} class={i === selected ? 'card-item selected' : 'card-item'}
          data-testid={`card-${i + 1}`} onClick={() => setSelected(i)}>
          <header>
            <span class="badge">{i + 1}</span>
            <strong>{cardTitle(c)}</strong>
          </header>
          <CropPreview photo={draft.photo} box={c.box} orientation={c.orientation} index={i} />
          <div class="row small-tools">
            <button class="secondary small" onClick={() => updateCard(i, (x) => ({ ...x, orientation: ROTATE_NEXT[x.orientation] }))}>↻ 轉正</button>
            <button class="secondary small" disabled={!!busy} onClick={() => reRecognize(i)}>重新辨識此框</button>
            <label class={busy ? 'button secondary small disabled' : 'button secondary small'}>
              {c.back ? '重拍背面' : '加拍背面'}
              <input type="file" accept="image/*" capture="environment" hidden disabled={!!busy}
                data-testid={`back-${i + 1}`}
                onChange={(e) => { const t = e.target as HTMLInputElement; void addBack(i, t.files?.[0]); t.value = ''; }} />
            </label>
            <button class="danger small" data-testid={`delete-${i + 1}`} onClick={(e) => {
              e.stopPropagation();
              update((d) => ({ ...d, cards: d.cards.filter((_, j) => j !== i) }));
              setSelected(null);
            }}>刪除</button>
          </div>
          <CardForm index={i} fields={c.fields} lowConfidence={c.lowConfidenceFields}
            onChange={(k: CardFieldKey, v) => updateCard(i, (x) => ({ ...x, fields: { ...x.fields, [k]: v } }))} />
        </article>
      ))}

      <div class="sticky-actions">
        <button class="secondary" onClick={discard}>捨棄</button>
        <button data-testid="save" disabled={!!busy || !draft.cards.length} onClick={startSave}>{busy === '儲存中…' ? busy : `儲存 ${draft.cards.length} 張`}</button>
      </div>
      {dups && (
        <DuplicateDialog cards={draft.cards} candidates={dups} onCancel={() => setDups(null)} onConfirm={(t) => void doSave(t)} />
      )}
      {backConflicts && (
        <BackConflicts items={backConflicts.items} onDone={(picked) => {
          const i = backConflicts.index;
          updateCard(i, (c) => ({ ...c, fields: { ...c.fields, ...picked } }));
          setBackConflicts(null);
        }} />
      )}
    </section>
  );
}

/** 比較模式：兩家結果依位置配對並列，逐張選用。 */
function ComparePicker({ draft, photoUrl, onPicked }: {
  draft: Draft; photoUrl: string | null; onPicked: (cards: DraftCard[]) => void;
}) {
  const claude = draft.compare?.claude;
  const gemini = draft.compare?.gemini;
  const ca = claude?.cards ?? [];
  const gb = gemini?.cards ?? [];
  const pairs = useMemo(() => pairByIoU(ca.map((c) => c.box), gb.map((c) => c.box)), [draft.localId]);
  const [choice, setChoice] = useState<Array<Provider | 'none'>>(() =>
    pairs.map(([a]) => (a !== null ? 'claude' : 'gemini')));

  const pick = () => {
    const cards: DraftCard[] = [];
    pairs.forEach(([a, b], i) => {
      const c = choice[i] === 'claude' && a !== null ? ca[a] : choice[i] === 'gemini' && b !== null ? gb[b] : undefined;
      if (c) cards.push(c);
    });
    onPicked(cards.length ? cards : toDraftCards([], 'claude', ''));
  };

  return (
    <section class="page">
      <h1>比較辨識結果</h1>
      {photoUrl && <img class="photo-thumb" src={photoUrl} alt="原始照片" />}
      <p class="hint">Claude 偵測 {ca.length} 張{claude?.error ? `（失敗：${claude.error}）` : ''}；
        Gemini 偵測 {gb.length} 張{gemini?.error ? `（失敗：${gemini.error}）` : ''}。每列選一個結果使用。</p>
      {pairs.map(([a, b], i) => (
        <div key={i} class="compare-row" data-testid={`compare-row-${i + 1}`}>
          {(['claude', 'gemini'] as Provider[]).map((p) => {
            const c = p === 'claude' ? (a !== null ? ca[a] : undefined) : (b !== null ? gb[b] : undefined);
            return (
              <label key={p} class={choice[i] === p ? 'compare-cell chosen' : 'compare-cell'}>
                <input type="radio" name={`pick-${i}`} disabled={!c} checked={choice[i] === p}
                  onChange={() => setChoice((cur) => cur.map((x, j) => (j === i ? p : x)))} />
                <span class="provider">{p === 'claude' ? 'Claude' : 'Gemini'}</span>
                {c ? <CardSummary c={c} /> : <span class="muted">未偵測到</span>}
              </label>
            );
          })}
          <label class="compare-skip">
            <input type="radio" name={`pick-${i}`} checked={choice[i] === 'none'}
              onChange={() => setChoice((cur) => cur.map((x, j) => (j === i ? 'none' : x)))} /> 都不要
          </label>
        </div>
      ))}
      <div class="sticky-actions">
        <button onClick={pick} data-testid="use-picked">使用選擇的結果</button>
      </div>
    </section>
  );
}

function CardSummary({ c }: { c: DraftCard }) {
  const f = c.fields;
  return (
    <dl class="summary">
      <dt>姓名</dt><dd>{[f.name_zh, f.name_en].filter(Boolean).join(' / ') || '—'}</dd>
      <dt>公司</dt><dd>{f.company_zh || f.company_en || '—'}</dd>
      <dt>職稱</dt><dd>{[f.title_zh, f.title_en].filter(Boolean).join(' / ') || '—'}</dd>
      <dt>手機</dt><dd>{f.mobile || '—'}</dd>
      <dt>Email</dt><dd>{f.email || '—'}</dd>
    </dl>
  );
}
