/** 掃描頁：拍照或選圖（可多選），依序辨識。 */
import { useState } from 'preact/hooks';
import { useLocation } from 'preact-iso';
import { createDraftFromFile, errorMessage, recognizeOrQueue } from '../lib/flow';
import { isConfigured, loadSettings } from '../lib/settings';
import { to } from '../lib/paths';

interface Item { name: string; state: 'waiting' | 'working' | 'done' | 'error'; message?: string; draftId?: string }

export function Scan() {
  const { route } = useLocation();
  const settings = loadSettings();
  const [items, setItems] = useState<Item[]>([]);
  const [busy, setBusy] = useState(false);

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    const list = Array.from(files);
    const init: Item[] = list.map((f, i) => ({ name: f.name || `照片 ${i + 1}`, state: 'waiting' }));
    setItems(init);
    setBusy(true);
    let firstReady: string | null = null;
    for (let i = 0; i < list.length; i++) {
      const update = (patch: Partial<Item>) =>
        setItems((cur) => cur.map((it, j) => (j === i ? { ...it, ...patch } : it)));
      update({ state: 'working', message: '縮圖並辨識中…' });
      try {
        const draft = await createDraftFromFile(list[i]!, settings.provider);
        const done = await recognizeOrQueue(draft);
        if (done.status === 'queued') {
          update({ state: 'done', message: '目前離線，已排入待辨識，連線後自動送出', draftId: done.localId });
        } else if (done.status === 'error') {
          update({ state: 'error', message: done.error, draftId: done.localId });
        } else {
          const n = done.status === 'compare'
            ? Math.max(done.compare?.claude?.cards.length ?? 0, done.compare?.gemini?.cards.length ?? 0)
            : done.cards.length;
          update({ state: 'done', message: n ? `偵測到 ${n} 張名片` : '未偵測到名片', draftId: done.localId });
          firstReady ??= done.localId;
        }
      } catch (e) {
        update({ state: 'error', message: errorMessage(e) });
      }
    }
    setBusy(false);
    if (list.length === 1 && firstReady) route(to(`review/${firstReady}`));
  }

  if (!isConfigured(settings)) {
    return (
      <section class="page">
        <h1>掃描名片</h1>
        <p class="notice">尚未設定後端。請先到 <a href={to('settings')}>設定</a> 輸入後端網址與存取權杖。</p>
      </section>
    );
  }

  return (
    <section class="page">
      <h1>掃描名片</h1>
      <p class="hint">可一次拍多張名片平放在桌上。辨識引擎：{
        settings.provider === 'compare' ? '比較模式（Claude + Gemini）' : settings.provider === 'gemini' ? 'Gemini' : 'Claude'}</p>
      <div class="scan-actions">
        <label class={busy ? 'big-button disabled' : 'big-button'}>
          📷 拍照
          <input type="file" accept="image/*" capture="environment" hidden disabled={busy}
            data-testid="input-camera" onChange={(e) => handleFiles((e.target as HTMLInputElement).files)} />
        </label>
        <label class={busy ? 'big-button secondary disabled' : 'big-button secondary'}>
          🖼️ 從相簿選擇
          <input type="file" accept="image/*" multiple hidden disabled={busy}
            data-testid="input-gallery" onChange={(e) => handleFiles((e.target as HTMLInputElement).files)} />
        </label>
      </div>
      {items.length > 0 && (
        <ul class="progress-list" aria-live="polite">
          {items.map((it, i) => (
            <li key={i} class={it.state}>
              <span class="name">{it.name}</span>
              <span class="msg">{it.state === 'waiting' ? '等待中' : it.message}</span>
              {it.draftId && (
                <a href={to(`review/${it.draftId}`)} class="button small">{it.state === 'error' ? '重試' : '確認'}</a>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
