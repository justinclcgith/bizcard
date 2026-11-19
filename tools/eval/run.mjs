#!/usr/bin/env node
/**
 * 驗收評測（docs/07 §3）。
 *
 * 用法：
 *   BIZCARD_GAS_URL=... BIZCARD_TOKEN=... node tools/eval/run.mjs [--dir testdata] [--draft-truth] [--only claude-low]
 *
 * testdata/ 內容（不進 repo）：
 *   - 照片檔（jpg/png），檔名開頭 S / M / N 代表單張、多張、無名片組
 *   - truth.json：標準答案（格式見 README 或 truth.example.json）
 *
 * --draft-truth：以 Claude（effort medium）辨識全部照片，產生 truth.draft.json 給 JC 逐筆確認。
 */
import fs from 'node:fs';
import path from 'node:path';
import { scoreRun, THRESHOLDS } from './score.mjs';

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : def;
};
const DIR = path.resolve(opt('--dir', 'testdata'));
const URL = process.env.BIZCARD_GAS_URL;
const TOKEN = process.env.BIZCARD_TOKEN;
if (!URL || !TOKEN) {
  console.error('請設定環境變數 BIZCARD_GAS_URL 與 BIZCARD_TOKEN');
  process.exit(1);
}

export const CONFIGS = [
  { id: 'claude-low', label: 'Claude（effort low）', provider: 'claude', claudeEffort: 'low' },
  { id: 'claude-medium', label: 'Claude（effort medium）', provider: 'claude', claudeEffort: 'medium' },
  { id: 'gemini', label: 'Gemini', provider: 'gemini' }
];

const mimeOf = (f) => (/\.png$/i.test(f) ? 'image/png' : 'image/jpeg');
const groupOf = (f) => (/^[SMN]/i.test(f) ? f[0].toUpperCase() : 'S');

async function recognize(file, cfg) {
  const base64 = fs.readFileSync(path.join(DIR, file)).toString('base64');
  const body = {
    token: TOKEN, action: 'recognize', provider: cfg.provider,
    image: { mime: mimeOf(file), base64 },
    ...(cfg.claudeEffort ? { claudeEffort: cfg.claudeEffort } : {})
  };
  const t0 = Date.now();
  const res = await fetch(URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(body),
    redirect: 'follow'
  });
  const json = await res.json();
  if (!json.ok) return { error: json.error, latencyMs: Date.now() - t0 };
  // 以使用者感受到的往返時間計算延遲（含上傳）
  return { ...json.data, serverLatencyMs: json.data.latencyMs, latencyMs: Date.now() - t0 };
}

function fmtPct(v) { return v == null ? '—' : (v * 100).toFixed(1) + '%'; }
function fmtSec(v) { return v == null ? '—' : (v / 1000).toFixed(1) + ' 秒'; }
function mark(key, v) { return THRESHOLDS[key] ? (THRESHOLDS[key](v) ? '✅' : '❌') : ''; }

function report(scores, photos) {
  const date = new Date().toISOString().slice(0, 10);
  const nS = photos.filter((p) => p.group === 'S').length;
  const nM = photos.filter((p) => p.group === 'M').length;
  const nCards = photos.reduce((a, p) => a + p.cards.length, 0);
  const cols = Object.keys(scores);
  const row = (name, key, fmt) => `| ${name} | ${cols.map((c) => `${fmt(scores[c][key])} ${mark(key, scores[c][key])}`).join(' | ')} |`;
  const lines = [
    `# 辨識驗收評測報告 ${date}`,
    '',
    `測試集：單張 ${nS} 張照片、多張 ${nM} 張照片，合計 ${nCards} 張名片。`,
    '',
    `| 指標 | ${cols.map((c) => CONFIGS.find((x) => x.id === c).label).join(' | ')} |`,
    `|---|${cols.map(() => '---').join('|')}|`,
    row('A1 多張偵測召回率（≥95%）', 'A1', fmtPct),
    row('A2 誤報（N 組 0、M 組 ≤1）', 'A2', (v) => `N:${v.n} / M:${v.m}`),
    row('A3 框品質（≥90%）', 'A3', fmtPct),
    row('A4 關鍵欄位（單 ≥97%／多 ≥93%）', 'A4', (v) => `單 ${fmtPct(v.s)}／多 ${fmtPct(v.m)}`),
    row('A5 全部欄位（≥90%）', 'A5', fmtPct),
    row('A6 簡體或翻譯（0）', 'A6', (v) => String(v)),
    row('A7 錯誤欄位有低信心標示（參考）', 'A7', fmtPct),
    row('P1 單張延遲 P90（≤15 秒）', 'P1', fmtSec),
    row('P2 多張延遲 P90（≤30 秒）', 'P2', fmtSec),
    row('C1 每張名片平均費用（USD）', 'C1', (v) => (v == null ? '—' : '$' + v.toFixed(4))),
    row('呼叫失敗次數', 'errors', String),
    ''
  ];
  for (const c of cols) {
    lines.push(`## 錯誤明細：${CONFIGS.find((x) => x.id === c).label}`, '');
    const d = scores[c].details;
    if (!d.length) { lines.push('無。', ''); continue; }
    lines.push('| 照片 | 名片 | 欄位 | 標準答案 | 辨識結果 | 低信心 |', '|---|---|---|---|---|---|');
    for (const x of d) {
      if (x.error) lines.push(`| ${x.file} | | 呼叫失敗 | | ${x.error} | |`);
      else if (x.missed) lines.push(`| ${x.file} | | 漏偵測 ${x.missed} 張 | | | |`);
      else if (x.falsePositives) lines.push(`| ${x.file} | | 多偵測 ${x.falsePositives} 張 | | | |`);
      else if (x.simplifiedFields) lines.push(`| ${x.file} | ${x.card} | 簡體字：${x.simplifiedFields.join(', ')} | | | |`);
      else lines.push(`| ${x.file} | ${x.card} | ${x.field} | ${x.truth} | ${x.pred} | ${x.flagged ? '是' : ''} |`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

async function draftTruth(files) {
  const photos = [];
  for (const file of files) {
    process.stdout.write(`辨識 ${file} … `);
    const r = await recognize(file, CONFIGS[1]);
    if (r.error) { console.log('失敗：' + r.error.message); continue; }
    console.log(`${r.cards.length} 張`);
    photos.push({ file, group: groupOf(file), cards: r.cards.map((c) => ({ box_2d: c.box_2d, fields: c.fields })) });
  }
  const out = path.join(DIR, 'truth.draft.json');
  fs.writeFileSync(out, JSON.stringify({ photos }, null, 2));
  console.log(`已寫入 ${out}，請 JC 逐筆確認後另存為 truth.json`);
}

async function main() {
  const files = fs.readdirSync(DIR).filter((f) => /\.(jpe?g|png)$/i.test(f)).sort();
  if (args.includes('--draft-truth')) return draftTruth(files);

  const truth = JSON.parse(fs.readFileSync(path.join(DIR, 'truth.json'), 'utf8'));
  const only = opt('--only', null);
  const configs = only ? CONFIGS.filter((c) => c.id === only) : CONFIGS;
  const scores = {};
  for (const cfg of configs) {
    console.log(`== ${cfg.label}`);
    const results = {};
    for (const photo of truth.photos) {
      process.stdout.write(`  ${photo.file} … `);
      results[photo.file] = await recognize(photo.file, cfg);
      const r = results[photo.file];
      console.log(r.error ? '失敗：' + r.error.message : `${r.cards.length} 張，${(r.latencyMs / 1000).toFixed(1)} 秒`);
    }
    fs.writeFileSync(path.join(DIR, `raw-${cfg.id}.json`), JSON.stringify(results, null, 2));
    scores[cfg.id] = scoreRun(truth.photos, results);
  }
  const out = path.join(DIR, `eval-report-${new Date().toISOString().slice(0, 10)}.md`);
  fs.writeFileSync(out, report(scores, truth.photos));
  console.log(`報告：${out}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
