/**
 * 驗收評分（docs/07 §2–§3）。純函式，供 run.mjs 與單元測試使用。
 */
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { boxIoU } = require('../../gas/src/lib_normalize.js');

export const KEY_FIELDS = ['name_zh', 'name_en', 'company_zh', 'company_en', 'title_zh', 'title_en', 'mobile', 'email'];
export const ALL_FIELDS = [
  ...KEY_FIELDS, 'department', 'company_short', 'phone', 'phone_ext', 'fax', 'website',
  'address_zh', 'address_en', 'line_id', 'linkedin', 'other_social'
];
const ZH_FIELDS = ['name_zh', 'title_zh', 'company_zh', 'department', 'address_zh'];
const MULTI_FIELDS = ['mobile', 'phone', 'fax', 'email', 'other_social'];
// company_short 是 AI 建議值，不列入正確率
const SCORED_FIELDS = ALL_FIELDS.filter((f) => f !== 'company_short');

/** AI 低信心欄位名稱 → Contacts 欄位 */
const LOW_CONF_ALIAS = { mobiles: 'mobile', phones: 'phone', faxes: 'fax', emails: 'email' };

// 常見「簡體專用字」（對應繁體字不同），用來偵測被轉成簡體的情況
const SIMPLIFIED_CHARS = new Set(
  '们这为发国东业务经总区电话传网号码营销专长医药厂开关门问间听说读写书记计设识报纸农产实际宾馆饭钟时项头脑处级层县乡镇广场园诊疗检验机构车辆铁路桥湾岛岭峡边远进运过还选连迟违达迁导寻对' +
  '个来会动见学马鸟鱼龙龟齐麦齿兰丽严举义乐习买乱亏亲亿仅从众优伤伦体侦价侨侧俭债倾偿储关兴养兽写军农冯净减凤凭击创办劝动劳势勋医华协单卖卢卫厅历压厌厕双变号叹吓吗启吴员呜响哑唤啰喷团围图圆圣坏块坚坛坝坞坟坠垄垒垦垫'
);

export function normName(s) {
  return String(s || '').replace(/\s+/g, '').toLowerCase();
}

/** 欄位比對用的正規化：多值欄位視為集合，姓名忽略空白，Email 忽略大小寫。 */
export function canon(field, value) {
  const v = String(value || '').trim();
  if (MULTI_FIELDS.includes(field)) {
    return v.split(/\s*;\s*/).filter(Boolean).map((x) => x.toLowerCase().replace(/\s+/g, '')).sort().join(';');
  }
  if (field === 'name_zh' || field === 'name_en') return normName(v);
  if (field === 'website' || field === 'linkedin') return v.toLowerCase().replace(/^https?:\/\//, '').replace(/\/+$/, '');
  return v.replace(/\s+/g, ' ');
}

export function hasSimplified(s) {
  for (const ch of String(s || '')) if (SIMPLIFIED_CHARS.has(ch)) return true;
  return false;
}

/** 預測框與標準答案配對：IoU ≥ 0.5 的貪婪配對；單張照片且雙方各一張時直接配對。 */
export function matchCards(truthCards, predCards) {
  if (truthCards.length === 1 && predCards.length === 1) return [[0, 0]];
  const pairs = [];
  truthCards.forEach((t, ti) => predCards.forEach((p, pi) => {
    const iou = boxIoU(t.box_2d, p.box_2d);
    if (iou >= 0.5) pairs.push([iou, ti, pi]);
  }));
  pairs.sort((a, b) => b[0] - a[0]);
  const usedT = new Set();
  const usedP = new Set();
  const out = [];
  for (const [, ti, pi] of pairs) {
    if (usedT.has(ti) || usedP.has(pi)) continue;
    usedT.add(ti); usedP.add(pi); out.push([ti, pi]);
  }
  return out;
}

/** 框品質：預測框涵蓋真實框 ≥ 98%，且多餘背景 < 15%（以預測框面積計）。 */
export function boxGood(truthBox, predBox) {
  const area = (b) => Math.max(0, b[2] - b[0]) * Math.max(0, b[3] - b[1]);
  const inter = area([
    Math.max(truthBox[0], predBox[0]), Math.max(truthBox[1], predBox[1]),
    Math.min(truthBox[2], predBox[2]), Math.min(truthBox[3], predBox[3])
  ]);
  const covered = inter / (area(truthBox) || 1);
  const extra = (area(predBox) - inter) / (area(predBox) || 1);
  return covered >= 0.98 && extra < 0.15;
}

/** 比對一張名片的欄位。 */
export function compareFields(truth, pred, lowConf = []) {
  const low = new Set(lowConf.map((f) => LOW_CONF_ALIAS[f] || f));
  const rows = [];
  for (const f of SCORED_FIELDS) {
    const t = canon(f, truth[f]);
    const p = canon(f, pred[f]);
    if (!t && !p) continue;
    rows.push({ field: f, key: KEY_FIELDS.includes(f), ok: t === p, truth: truth[f] || '', pred: pred[f] || '', flagged: low.has(f) });
  }
  const simplified = ZH_FIELDS.filter((f) => hasSimplified(pred[f]) && !hasSimplified(truth[f]));
  return { rows, simplified };
}

function pct(n, d) { return d ? n / d : null; }
function p90(arr) {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil(s.length * 0.9) - 1)];
}

/**
 * 對一組引擎設定的所有結果評分。
 * @param photos truth.json 的 photos
 * @param results { [file]: { cards, latencyMs, usage, error? } }
 */
export function scoreRun(photos, results) {
  const acc = {
    mTruth: 0, mMatched: 0, fpM: 0, fpN: 0, boxTotal: 0, boxGood: 0,
    keyS: [0, 0], keyM: [0, 0], all: [0, 0], wrong: 0, wrongFlagged: 0, simplified: 0,
    latS: [], latM: [], cost: 0, truthCards: 0, errors: 0, details: []
  };
  for (const photo of photos) {
    const r = results[photo.file];
    acc.truthCards += photo.cards.length;
    if (!r || r.error) {
      acc.errors++;
      acc.details.push({ file: photo.file, error: r ? r.error.message : '沒有結果' });
      if (photo.group === 'M') acc.mTruth += photo.cards.length;
      continue;
    }
    acc.cost += (r.usage && r.usage.estCostUsd) || 0;
    if (photo.group === 'S') acc.latS.push(r.latencyMs);
    if (photo.group === 'M') acc.latM.push(r.latencyMs);

    const matches = matchCards(photo.cards, r.cards);
    const matchedP = new Set(matches.map(([, pi]) => pi));
    const fp = r.cards.length - matchedP.size;
    if (photo.group === 'N') acc.fpN += r.cards.length;
    if (photo.group === 'M') {
      acc.mTruth += photo.cards.length;
      acc.mMatched += matches.length;
      acc.fpM += fp;
    }
    const missed = photo.cards.length - matches.length;
    if (missed > 0) acc.details.push({ file: photo.file, missed });
    if (fp > 0 && photo.group !== 'N') acc.details.push({ file: photo.file, falsePositives: fp });

    for (const [ti, pi] of matches) {
      const t = photo.cards[ti];
      const p = r.cards[pi];
      if (photo.group === 'M') {
        acc.boxTotal++;
        if (boxGood(t.box_2d, p.box_2d)) acc.boxGood++;
      }
      const { rows, simplified } = compareFields(t.fields, p.fields, p.lowConfidenceFields);
      acc.simplified += simplified.length;
      for (const row of rows) {
        acc.all[1]++; if (row.ok) acc.all[0]++;
        if (row.key) {
          const k = photo.group === 'M' ? acc.keyM : acc.keyS;
          k[1]++; if (row.ok) k[0]++;
        }
        if (!row.ok) {
          acc.wrong++; if (row.flagged) acc.wrongFlagged++;
          acc.details.push({ file: photo.file, card: ti + 1, field: row.field, truth: row.truth, pred: row.pred, flagged: row.flagged });
        }
      }
      if (simplified.length) acc.details.push({ file: photo.file, card: ti + 1, simplifiedFields: simplified });
    }
  }
  return {
    A1: pct(acc.mMatched, acc.mTruth),
    A2: { n: acc.fpN, m: acc.fpM },
    A3: pct(acc.boxGood, acc.boxTotal),
    A4: { s: pct(...acc.keyS), m: pct(...acc.keyM) },
    A5: pct(...acc.all),
    A6: acc.simplified,
    A7: pct(acc.wrongFlagged, acc.wrong),
    P1: p90(acc.latS),
    P2: p90(acc.latM),
    C1: pct(acc.cost, acc.truthCards),
    errors: acc.errors,
    details: acc.details
  };
}

export const THRESHOLDS = {
  A1: (v) => v != null && v >= 0.95,
  A2: (v) => v.n === 0 && v.m <= 1,
  A3: (v) => v != null && v >= 0.9,
  A4: (v) => v.s != null && v.s >= 0.97 && (v.m == null || v.m >= 0.93),
  A5: (v) => v != null && v >= 0.9,
  A6: (v) => v === 0,
  P1: (v) => v != null && v <= 15000,
  P2: (v) => v == null || v <= 30000
};
