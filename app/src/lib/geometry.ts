/** 位置框與裁切座標換算（純函式）。 */
import type { Box, Orientation } from './types';

export function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/** 縮圖後尺寸：長邊不超過 maxLong，不放大。 */
export function fitLongEdge(w: number, h: number, maxLong: number): { width: number; height: number } {
  const long = Math.max(w, h);
  if (long <= maxLong) return { width: w, height: h };
  const s = maxLong / long;
  return { width: Math.round(w * s), height: Math.round(h * s) };
}

/** 0–1000 正規化框 → 像素矩形，各邊外擴 margin（佔框寬高的比例），並夾在圖片內。 */
export function boxToPixels(box: Box, imgW: number, imgH: number, margin = 0.02) {
  const [y0, x0, y1, x1] = box;
  const bw = ((x1 - x0) / 1000) * imgW;
  const bh = ((y1 - y0) / 1000) * imgH;
  const left = clamp((x0 / 1000) * imgW - bw * margin, 0, imgW);
  const top = clamp((y0 / 1000) * imgH - bh * margin, 0, imgH);
  const right = clamp((x1 / 1000) * imgW + bw * margin, 0, imgW);
  const bottom = clamp((y1 / 1000) * imgH + bh * margin, 0, imgH);
  return { x: Math.round(left), y: Math.round(top), width: Math.round(right - left), height: Math.round(bottom - top) };
}

/** 旋轉後輸出尺寸。 */
export function rotatedSize(w: number, h: number, orientation: Orientation) {
  return orientation === '90' || orientation === '270' ? { width: h, height: w } : { width: w, height: h };
}

export type Corner = 'tl' | 'tr' | 'bl' | 'br';

/** 拖曳框的某個角到新位置（0–1000），保持最小尺寸。 */
export function dragCorner(box: Box, corner: Corner, y: number, x: number, minSize = 20): Box {
  let [y0, x0, y1, x1] = box;
  const cy = clamp(Math.round(y), 0, 1000);
  const cx = clamp(Math.round(x), 0, 1000);
  if (corner === 'tl' || corner === 'tr') y0 = Math.min(cy, y1 - minSize);
  if (corner === 'bl' || corner === 'br') y1 = Math.max(cy, y0 + minSize);
  if (corner === 'tl' || corner === 'bl') x0 = Math.min(cx, x1 - minSize);
  if (corner === 'tr' || corner === 'br') x1 = Math.max(cx, x0 + minSize);
  return [clamp(y0, 0, 1000), clamp(x0, 0, 1000), clamp(y1, 0, 1000), clamp(x1, 0, 1000)];
}

/** 整個框平移，不超出圖片。 */
export function moveBox(box: Box, dy: number, dx: number): Box {
  const [y0, x0, y1, x1] = box;
  const h = y1 - y0;
  const w = x1 - x0;
  const ny0 = clamp(Math.round(y0 + dy), 0, 1000 - h);
  const nx0 = clamp(Math.round(x0 + dx), 0, 1000 - w);
  return [ny0, nx0, ny0 + h, nx0 + w];
}

export function boxIoU(a: Box, b: Box): number {
  const inter = Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0])) *
    Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]));
  const area = (r: Box) => (r[2] - r[0]) * (r[3] - r[1]);
  const union = area(a) + area(b) - inter;
  return union > 0 ? inter / union : 0;
}

/** 兩組結果依 IoU 配對（比較模式用），回傳 [aIndex|null, bIndex|null] 列表，依 a 的順序。 */
export function pairByIoU(a: Box[], b: Box[], threshold = 0.3): Array<[number | null, number | null]> {
  const cand: Array<[number, number, number]> = [];
  a.forEach((ba, i) => b.forEach((bb, j) => {
    const v = boxIoU(ba, bb);
    if (v >= threshold) cand.push([v, i, j]);
  }));
  cand.sort((x, y) => y[0] - x[0]);
  const ua = new Map<number, number>();
  const ub = new Set<number>();
  for (const [, i, j] of cand) {
    if (ua.has(i) || ub.has(j)) continue;
    ua.set(i, j);
    ub.add(j);
  }
  const out: Array<[number | null, number | null]> = a.map((_, i) => [i, ua.get(i) ?? null]);
  b.forEach((_, j) => { if (!ub.has(j)) out.push([null, j]); });
  return out;
}

/** 新增框的預設位置：畫面中央、寬 50%、高 30%。 */
export const DEFAULT_NEW_BOX: Box = [350, 250, 650, 750];

/** 旋轉照片 90° 後，框的新座標（順時針）。 */
export function rotateBoxCW(box: Box): Box {
  const [y0, x0, y1, x1] = box;
  return [x0, 1000 - y1, x1, 1000 - y0];
}
