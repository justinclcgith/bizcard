import { describe, it, expect } from 'vitest';
import { cardTitle, manualCard, mergeBack } from '../src/lib/draftOps';
import { emptyFields } from '../src/lib/types';
import type { CardResult } from '../src/lib/types';

describe('mergeBack', () => {
  it('補空白欄位、回報衝突', () => {
    const front = { ...manualCard(), fields: { ...emptyFields(), name_zh: '王小明', title_en: 'Manager' } };
    const back: CardResult = { fields: { ...emptyFields(), name_en: 'Ming Wang', title_en: 'Senior Manager' }, box_2d: [0, 0, 1000, 1000], orientation: '0', side: 'back', lowConfidenceFields: [], warnings: [] };
    const { card, conflicts } = mergeBack(front, back);
    expect(card.fields.name_en).toBe('Ming Wang');
    expect(card.fields.title_en).toBe('Manager');
    expect(conflicts).toEqual([{ key: 'title_en', front: 'Manager', back: 'Senior Manager' }]);
  });
});

describe('cardTitle', () => {
  it('姓名與公司簡稱', () => {
    const c = { ...manualCard(), fields: { ...emptyFields(), name_zh: '王小明', name_en: 'Ming', company_short: 'PrimoBio' } };
    expect(cardTitle(c)).toBe('王小明 Ming｜PrimoBio');
  });
  it('空白卡', () => expect(cardTitle(manualCard())).toBe('（未辨識姓名）'));
});
