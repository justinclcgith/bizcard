/** 依框即時裁切預覽（停止調整 250ms 後更新）。 */
import { useEffect, useState } from 'preact/hooks';
import { cropCard } from '../lib/image';
import type { PreparedImage } from '../lib/image';
import type { Box, Orientation } from '../lib/types';

export function CropPreview({ photo, box, orientation, index }: {
  photo: PreparedImage; box: Box; orientation: Orientation; index: number;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const key = box.join(',') + orientation;

  useEffect(() => {
    let cancelled = false;
    let made: string | null = null;
    const t = setTimeout(async () => {
      try {
        const c = await cropCard(photo, box, orientation, 600);
        if (cancelled) return;
        made = URL.createObjectURL(c.blob);
        setUrl(made);
      } catch {
        /* 預覽失敗不影響編輯 */
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
      if (made) URL.revokeObjectURL(made);
    };
  }, [photo.blob, key]);

  return (
    <div class="crop-preview">
      {url
        ? <img src={url} alt={`第 ${index + 1} 張名片裁切預覽`} data-testid={`crop-${index + 1}`} data-box={key} />
        : <div class="crop-placeholder">產生預覽中…</div>}
    </div>
  );
}
