/** 影像處理（瀏覽器 Canvas）。尺寸計算放在 geometry.ts 以便測試。 */
import { boxToPixels, fitLongEdge, rotatedSize } from './geometry';
import type { Box, Orientation } from './types';

export interface PreparedImage {
  blob: Blob;
  width: number;
  height: number;
}

export const UPLOAD_MAX_LONG = 2400;
export const CROP_MAX_LONG = 1200;
const JPEG_QUALITY = 0.85;

function canvasOf(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function toJpeg(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('圖片轉檔失敗'))), 'image/jpeg', JPEG_QUALITY);
  });
}

/** 依 EXIF 轉正、縮到長邊 maxLong、轉 JPEG。 */
export async function prepareImage(file: Blob, maxLong = UPLOAD_MAX_LONG): Promise<PreparedImage> {
  const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const { width, height } = fitLongEdge(bmp.width, bmp.height, maxLong);
  const c = canvasOf(width, height);
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('無法建立畫布');
  ctx.drawImage(bmp, 0, 0, width, height);
  bmp.close();
  return { blob: await toJpeg(c), width, height };
}

function drawRotated(src: CanvasImageSource, sx: number, sy: number, sw: number, sh: number,
  orientation: Orientation, maxLong: number): HTMLCanvasElement {
  const scaled = fitLongEdge(sw, sh, maxLong);
  const out = rotatedSize(scaled.width, scaled.height, orientation);
  const c = canvasOf(out.width, out.height);
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('無法建立畫布');
  ctx.translate(out.width / 2, out.height / 2);
  ctx.rotate((Number(orientation) * Math.PI) / 180);
  ctx.drawImage(src, sx, sy, sw, sh, -scaled.width / 2, -scaled.height / 2, scaled.width, scaled.height);
  return c;
}

/** 整張照片順時針旋轉 90°。 */
export async function rotateImage90(img: PreparedImage): Promise<PreparedImage> {
  const bmp = await createImageBitmap(img.blob);
  const c = drawRotated(bmp, 0, 0, bmp.width, bmp.height, '90', Number.MAX_SAFE_INTEGER);
  bmp.close();
  return { blob: await toJpeg(c), width: c.width, height: c.height };
}

/** 依框裁出單張名片並轉正。 */
export async function cropCard(img: PreparedImage, box: Box, orientation: Orientation,
  maxLong = CROP_MAX_LONG): Promise<PreparedImage> {
  const bmp = await createImageBitmap(img.blob);
  const r = boxToPixels(box, bmp.width, bmp.height);
  const c = drawRotated(bmp, r.x, r.y, Math.max(1, r.width), Math.max(1, r.height), orientation, maxLong);
  bmp.close();
  return { blob: await toJpeg(c), width: c.width, height: c.height };
}

export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const s = String(reader.result);
      resolve(s.slice(s.indexOf(',') + 1));
    };
    reader.onerror = () => reject(reader.error ?? new Error('讀取圖片失敗'));
    reader.readAsDataURL(blob);
  });
}
