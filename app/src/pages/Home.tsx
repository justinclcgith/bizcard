/** 首頁：待確認草稿、名片清單、搜尋、標籤篩選、公司分組（docs/01 F4）。 */
import { useEffect, useMemo, useState } from 'preact/hooks';
import { allContacts, listDrafts } from '../db/db';
import type { Draft } from '../db/db';
import { allTags, displayCompany, displayName, displayTitle, groupByCompany, searchContacts } from '../lib/contact';
import type { Contact } from '../lib/contact';
import { errorMessage, runQueued } from '../lib/flow';
import { to } from '../lib/paths';
import { isConfigured, loadSettings } from '../lib/settings';
import { syncAll } from '../lib/sync';

function draftLabel(d: Draft): string {
  switch (d.status) {
    case 'error': return '辨識失敗';
    case 'compare': return '待比較';
    case 'queued': return '待辨識（離線）';
    case 'recognizing': return '辨識中';
    default: return `${d.cards.length} 張待確認`;
  }
}

export function Home() {
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [contacts, setContacts] = useState<Contact[] | null>(null);
  const [q, setQ] = useState('');
  const [tag, setTag] = useState<string | null>(null);
  const [grouped, setGrouped] = useState(false);
  const [sync, setSync] = useState<{ state: 'idle' | 'busy' | 'error'; msg?: string }>({ state: 'idle' });
  const [flash] = useState(() => {
    try {
      const m = sessionStorage.getItem('bizcard.flash');
      sessionStorage.removeItem('bizcard.flash');
      return m;
    } catch { return null; }
  });

  async function reload() {
    setDrafts((await listDrafts()).reverse());
    setContacts(await allContacts());
  }

  async function doSync() {
    if (!isConfigured(loadSettings())) return;
    setSync({ state: 'busy' });
    try {
      await runQueued();
      const r = await syncAll();
      setSync({ state: 'idle', msg: r.conflicts ? `有 ${r.conflicts} 筆編輯與其他裝置衝突，已改用最新資料` : undefined });
    } catch (e) {
      setSync({ state: 'error', msg: errorMessage(e) });
    }
    await reload();
  }

  useEffect(() => {
    void reload().then(doSync);
    const onOnline = () => { void doSync(); };
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
  }, []);

  const tags = useMemo(() => allTags(contacts ?? []), [contacts]);
  const results = useMemo(() => searchContacts(contacts ?? [], q, tag), [contacts, q, tag]);
  const total = useMemo(() => (contacts ?? []).filter((c) => !c.deleted).length, [contacts]);

  const configured = isConfigured(loadSettings());

  return (
    <section class="page">
      <h1>名片夾 <small>{total} 位</small></h1>
      {flash && <p class="notice ok" data-testid="flash">{flash}</p>}
      {!configured && <p class="notice">尚未設定後端。請先到 <a href={to('settings')}>設定</a> 輸入後端網址與存取權杖。</p>}

      {drafts.length > 0 && (
        <details open class="drafts">
          <summary>待處理（{drafts.length}）</summary>
          <ul class="draft-list" data-testid="drafts">
            {drafts.map((d) => (
              <li key={d.localId}>
                <a href={to(`review/${d.localId}`)}>
                  {new Date(d.createdAt).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                  {' · '}{draftLabel(d)}
                </a>
              </li>
            ))}
          </ul>
        </details>
      )}

      <div class="search">
        <input type="search" placeholder="搜尋姓名、公司、電話、Email、標籤…" value={q} data-testid="search"
          onInput={(e) => setQ((e.target as HTMLInputElement).value)} aria-label="搜尋" />
        <button class="secondary small" onClick={doSync} disabled={sync.state === 'busy'} aria-label="同步" data-testid="sync">
          {sync.state === 'busy' ? '同步中…' : '↻'}
        </button>
      </div>
      {sync.msg && <p class={sync.state === 'error' ? 'notice error small' : 'notice small'}>{sync.state === 'error' ? `同步失敗：${sync.msg}（顯示本機資料）` : sync.msg}</p>}

      <div class="chips">
        <button class={grouped ? 'chip active' : 'chip'} onClick={() => setGrouped(!grouped)}>依公司</button>
        {tags.map((t) => (
          <button key={t} class={tag === t ? 'chip active' : 'chip'} onClick={() => setTag(tag === t ? null : t)}>#{t}</button>
        ))}
      </div>

      {contacts === null ? <p>載入中…</p> : results.length === 0 ? (
        <p class="muted">{total === 0 ? '還沒有名片，按下方「掃描」開始。' : '沒有符合的聯絡人。'}</p>
      ) : grouped ? (
        groupByCompany(results).map(([company, list]) => (
          <div key={company}>
            <h2 class="group-title">{company}（{list.length}）</h2>
            <ContactList list={list} showCompany={false} />
          </div>
        ))
      ) : <ContactList list={results} showCompany />}

      {total === 0 && <a class="big-button" href={to('scan')}>📷 掃描名片</a>}
    </section>
  );
}

function ContactList({ list, showCompany }: { list: Contact[]; showCompany: boolean }) {
  // 一次最多顯示 200 筆，避免大量 DOM；搜尋可再縮小範圍
  const shown = list.slice(0, 200);
  return (
    <>
      <ul class="contact-list" data-testid="contact-list">
        {shown.map((c) => (
          <li key={c.id}>
            <a href={to(`contact/${c.id}`)}>
              <strong>{displayName(c)}</strong>
              <span class="date">{c.met_date}</span>
              <span class="sub">{[showCompany ? displayCompany(c) : '', displayTitle(c)].filter(Boolean).join(' · ')}</span>
            </a>
          </li>
        ))}
      </ul>
      {list.length > shown.length && <p class="hint">另有 {list.length - shown.length} 位，請輸入關鍵字縮小範圍。</p>}
    </>
  );
}
