/**
 * 把 gas/src/*.js 合併成單一檔案 gas/dist/Code.gs，
 * 方便不用 clasp、直接在 Apps Script 編輯器貼上（docs/08 方式 B）。
 * 用法：node gas/tools/bundle.mjs（加 --check 只檢查是否需要重新產生）
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(root, 'src');
const OUT = path.join(root, 'dist', 'Code.gs');

export function buildBundle() {
  const files = fs.readdirSync(SRC).filter((f) => f.endsWith('.js')).sort();
  const parts = files.map((f) => `// ===== ${f} =====\n${fs.readFileSync(path.join(SRC, f), 'utf8').trimEnd()}\n`);
  return `// 名片夾後端（由 gas/tools/bundle.mjs 自動產生，請勿手動修改）\n\n${parts.join('\n')}`;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const text = buildBundle();
  if (process.argv.includes('--check')) {
    const cur = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : '';
    if (cur !== text) { console.error('gas/dist/Code.gs 不是最新，請執行 node gas/tools/bundle.mjs'); process.exit(1); }
  } else {
    fs.mkdirSync(path.dirname(OUT), { recursive: true });
    fs.writeFileSync(OUT, text);
    console.log(`已產生 ${path.relative(process.cwd(), OUT)}（${text.length} 字元）`);
  }
}
