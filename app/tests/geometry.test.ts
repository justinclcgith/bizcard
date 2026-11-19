import { describe, it, expect } from 'vitest';
import { boxToPixels, dragCorner, fitLongEdge, moveBox, pairByIoU, rotateBoxCW, rotatedSize } from '../src/lib/geometry';
import type { Box } from '../src/lib/types';

describe('fitLongEdge', () => {
  it('橫式縮到 2400', () => expect(fitLongEdge(4000, 3000, 2400)).toEqual({ width: 2400, height: 1800 }));
  it('直式縮到 2400', () => expect(fitLongEdge(3000, 4000, 2400)).toEqual({ width: 1800, height: 2400 }));
  it('小圖不放大', () => expect(fitLongEdge(800, 600, 2400)).toEqual({ width: 800, height: 600 }));
});

describe('boxToPixels', () => {
  it('換算並外擴 2%', () => {
    expect(boxToPixels([100, 200, 600, 700], 2000, 1000)).toEqual({ x: 380, y: 90, width: 1040, height: 520 });
  });
  it('外擴不超出圖片', () => {
    const r = boxToPixels([0, 0, 1000, 1000], 1000, 500);
    expect(r).toEqual({ x: 0, y: 0, width: 1000, height: 500 });
  });
});

describe('rotatedSize', () => {
  it('90 度互換寬高', () => expect(rotatedSize(400, 300, '90')).toEqual({ width: 300, height: 400 }));
  it('180 度不變', () => expect(rotatedSize(400, 300, '180')).toEqual({ width: 400, height: 300 }));
});

describe('dragCorner', () => {
  const b: Box = [100, 100, 500, 500];
  it('拖左上角', () => expect(dragCorner(b, 'tl', 50, 80)).toEqual([50, 80, 500, 500]));
  it('拖右下角', () => expect(dragCorner(b, 'br', 600, 700)).toEqual([100, 100, 600, 700]));
  it('不能翻轉或小於最小尺寸', () => expect(dragCorner(b, 'tl', 900, 900)).toEqual([480, 480, 500, 500]));
  it('夾在 0–1000', () => expect(dragCorner(b, 'br', 1500, -50)).toEqual([100, 100, 1000, 120]));
});

describe('moveBox', () => {
  it('平移', () => expect(moveBox([100, 100, 300, 300], 50, -50)).toEqual([150, 50, 350, 250]));
  it('不超出邊界', () => expect(moveBox([100, 100, 300, 300], 900, 900)).toEqual([800, 800, 1000, 1000]));
});

describe('rotateBoxCW', () => {
  it('順時針 90 度', () => expect(rotateBoxCW([100, 200, 300, 600])).toEqual([200, 700, 600, 900]));
  it('轉四次回原位', () => {
    let b: Box = [100, 200, 300, 600];
    for (let i = 0; i < 4; i++) b = rotateBoxCW(b);
    expect(b).toEqual([100, 200, 300, 600]);
  });
});

describe('pairByIoU', () => {
  it('配對並保留未配對者', () => {
    const a: Box[] = [[0, 0, 400, 400], [500, 500, 900, 900]];
    const b: Box[] = [[510, 500, 900, 910], [0, 600, 100, 700]];
    expect(pairByIoU(a, b)).toEqual([[0, null], [1, 0], [null, 1]]);
  });
});
