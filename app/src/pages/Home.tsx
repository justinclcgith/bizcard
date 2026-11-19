/** 首頁：P3 先列出待確認草稿；名片夾清單於 P4 實作。 */
import { useEffect, useState } from 'preact/hooks';
import { listDrafts } from '../db/db';
import type { Draft } from '../db/db';
import { to } from '../lib/paths';

export function Home() {
  const [drafts, setDrafts] = useState<Draft[] | null>(null);
  useEffect(() => { listDrafts().then((d) => setDrafts(d.reverse())).catch(() => setDrafts([])); }, []);

  return (
    <section class="page">
      <h1>名片夾</h1>
      {drafts && drafts.length > 0 && (
        <>
          <h2>待確認（{drafts.length}）</h2>
          <ul class="draft-list">
            {drafts.map((d) => (
              <li key={d.localId}>
                <a href={to(`review/${d.localId}`)}>
                  {new Date(d.createdAt).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' })}
                  {' · '}
                  {d.status === 'error' ? '辨識失敗' : d.status === 'compare' ? '待比較' : `${d.cards.length} 張`}
                </a>
              </li>
            ))}
          </ul>
        </>
      )}
      <p class="muted">已儲存的名片清單與搜尋將在下一階段提供。</p>
      <a class="big-button" href={to('scan')}>📷 掃描名片</a>
    </section>
  );
}
