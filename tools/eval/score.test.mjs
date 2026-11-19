import { describe, it, expect } from 'vitest';
import { canon, matchCards, boxGood, compareFields, hasSimplified, scoreRun, THRESHOLDS } from './score.mjs';

const card = (box, fields, low = []) => ({ box_2d: box, fields, lowConfidenceFields: low });

describe('canon', () => {
  it('多值欄位視為集合', () => expect(canon('email', 'b@x.com ; A@x.com')).toBe(canon('email', 'a@x.com ; b@x.com')));
  it('英文姓名忽略大小寫與空白', () => expect(canon('name_en', 'Chih Ming LIN')).toBe(canon('name_en', 'chihming lin')));
  it('網址忽略協定', () => expect(canon('website', 'https://a.tw/')).toBe(canon('website', 'a.tw')));
});

describe('hasSimplified', () => {
  it('偵測簡體', () => expect(hasSimplified('业务经理')).toBe(true));
  it('繁體不誤判', () => expect(hasSimplified('業務經理 台北市信義區 研究開發部 葉 余 黃')).toBe(false));
});

describe('matchCards', () => {
  it('單張直接配對', () => expect(matchCards([card([0, 0, 10, 10], {})], [card([500, 500, 900, 900], {})])).toEqual([[0, 0]]));
  it('多張依 IoU 配對', () => {
    const t = [card([0, 0, 400, 400], {}), card([500, 500, 900, 900], {})];
    const p = [card([510, 505, 900, 905], {}), card([5, 0, 400, 395], {}), card([0, 600, 100, 700], {})];
    expect(matchCards(t, p).sort()).toEqual([[0, 1], [1, 0]]);
  });
});

describe('boxGood', () => {
  it('略大的框合格', () => expect(boxGood([100, 100, 500, 500], [95, 95, 505, 505])).toBe(true));
  it('切到名片不合格', () => expect(boxGood([100, 100, 500, 500], [150, 100, 500, 500])).toBe(false));
  it('太大不合格', () => expect(boxGood([100, 100, 500, 500], [0, 0, 600, 600])).toBe(false));
});

describe('compareFields', () => {
  it('統計錯誤與低信心', () => {
    const { rows } = compareFields(
      { name_zh: '王小明', email: 'a@b.com', mobile: '+886912000000' },
      { name_zh: '王小朋', email: 'a@b.com', mobile: '' },
      ['name_zh', 'mobiles']
    );
    const wrong = rows.filter((r) => !r.ok);
    expect(wrong.map((r) => r.field).sort()).toEqual(['mobile', 'name_zh']);
    expect(wrong.every((r) => r.flagged)).toBe(true);
  });
});

describe('scoreRun', () => {
  const truth = [
    { file: 'S1.jpg', group: 'S', cards: [card([0, 0, 1000, 1000], { name_zh: '王小明', email: 'a@b.com' })] },
    { file: 'M1.jpg', group: 'M', cards: [
      card([0, 0, 400, 400], { name_en: 'Amy', email: 'amy@x.com' }),
      card([500, 500, 900, 900], { name_en: 'Bob', email: 'bob@x.com' })
    ] },
    { file: 'N1.jpg', group: 'N', cards: [] }
  ];
  const results = {
    'S1.jpg': { latencyMs: 8000, usage: { estCostUsd: 0.02 }, cards: [card([10, 10, 990, 990], { name_zh: '王小明', email: 'a@b.com' })] },
    'M1.jpg': { latencyMs: 20000, usage: { estCostUsd: 0.03 }, cards: [card([0, 0, 400, 410], { name_en: 'Amy', email: 'amy@x.com' })] },
    'N1.jpg': { latencyMs: 5000, usage: { estCostUsd: 0.01 }, cards: [] }
  };
  const s = scoreRun(truth, results);
  it('召回率與誤報', () => {
    expect(s.A1).toBe(0.5);
    expect(s.A2).toEqual({ n: 0, m: 0 });
  });
  it('欄位正確率', () => {
    expect(s.A4.s).toBe(1);
    expect(s.A4.m).toBe(1);
  });
  it('延遲與費用', () => {
    expect(s.P1).toBe(8000);
    expect(s.C1).toBeCloseTo(0.06 / 3);
  });
  it('門檻判定', () => {
    expect(THRESHOLDS.A1(s.A1)).toBe(false);
    expect(THRESHOLDS.A4(s.A4)).toBe(true);
  });
  it('呼叫失敗計入', () => {
    const s2 = scoreRun(truth, { ...results, 'S1.jpg': { error: { message: 'x' } } });
    expect(s2.errors).toBe(1);
  });
});
