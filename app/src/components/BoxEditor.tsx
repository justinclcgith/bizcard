/** 原圖上疊名片框：點選、拖曳四角調整、拖曳整框移動。 */
import { useEffect, useRef, useState } from 'preact/hooks';
import { dragCorner, moveBox } from '../lib/geometry';
import type { Corner } from '../lib/geometry';
import type { Box } from '../lib/types';

interface Props {
  src: string;
  width: number;
  height: number;
  boxes: Box[];
  selected: number | null;
  onSelect: (i: number) => void;
  onChange: (i: number, box: Box) => void;
}

type DragState =
  | { kind: 'corner'; index: number; corner: Corner }
  | { kind: 'move'; index: number; startY: number; startX: number; startBox: Box };

const CORNERS: Corner[] = ['tl', 'tr', 'bl', 'br'];

export function BoxEditor({ src, width, height, boxes, selected, onSelect, onChange }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [drag, setDrag] = useState<DragState | null>(null);

  const toNorm = (e: PointerEvent): { y: number; x: number } => {
    const r = svgRef.current!.getBoundingClientRect();
    return { y: ((e.clientY - r.top) / r.height) * 1000, x: ((e.clientX - r.left) / r.width) * 1000 };
  };

  useEffect(() => {
    if (!drag) return;
    const onMove = (e: PointerEvent) => {
      e.preventDefault();
      const p = toNorm(e);
      const box = boxes[drag.index];
      if (!box) return;
      if (drag.kind === 'corner') onChange(drag.index, dragCorner(box, drag.corner, p.y, p.x));
      else onChange(drag.index, moveBox(drag.startBox, p.y - drag.startY, p.x - drag.startX));
    };
    const onUp = () => setDrag(null);
    window.addEventListener('pointermove', onMove, { passive: false });
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, [drag, boxes, onChange]);

  const cornerPos = (b: Box, c: Corner) => ({
    cx: c === 'tl' || c === 'bl' ? b[1] : b[3],
    cy: c === 'tl' || c === 'tr' ? b[0] : b[2]
  });

  // SVG 用 0–1000 座標，但圖片不一定是正方形；把控制點畫成圓形需依比例修正
  const aspect = width / height;

  return (
    <div class="box-editor" style={{ aspectRatio: `${width} / ${height}` }}>
      <img src={src} alt="原始照片" draggable={false} />
      <svg ref={svgRef} viewBox="0 0 1000 1000" preserveAspectRatio="none" aria-label="名片位置框">
        {boxes.map((b, i) => {
          const isSel = i === selected;
          return (
            <g key={i} class={isSel ? 'box selected' : 'box'} data-testid={`box-${i + 1}`}>
              <rect
                x={b[1]} y={b[0]} width={b[3] - b[1]} height={b[2] - b[0]}
                onPointerDown={(e) => {
                  e.stopPropagation();
                  onSelect(i);
                  if (isSel) {
                    const p = toNorm(e as unknown as PointerEvent);
                    setDrag({ kind: 'move', index: i, startY: p.y, startX: p.x, startBox: b });
                  }
                }}
              />
              {isSel && CORNERS.map((c) => {
                const { cx, cy } = cornerPos(b, c);
                return (
                  <ellipse
                    key={c} cx={cx} cy={cy} rx={28} ry={28 * aspect}
                    class="handle" data-testid={`handle-${c}`}
                    onPointerDown={(e) => {
                      e.stopPropagation();
                      setDrag({ kind: 'corner', index: i, corner: c });
                    }}
                  />
                );
              })}
            </g>
          );
        })}
      </svg>
      {boxes.map((b, i) => (
        <span key={i} class={i === selected ? 'box-label selected' : 'box-label'}
          style={{ top: `${b[0] / 10}%`, left: `${b[1] / 10}%` }}>{i + 1}</span>
      ))}
    </div>
  );
}
