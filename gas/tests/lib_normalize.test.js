import { describe, it, expect } from 'vitest';
import lib from '../src/lib_normalize.js';

const { toHalfWidth, normalizeNameZh, normalizePhone, normalizeEmail, normalizeUrl,
  normalizeBox, boxIoU, normalizeCard, normalizeRecognition } = lib;

describe('toHalfWidth', () => {
  it('轉換全形英數與符號', () => {
    expect(toHalfWidth('ＡＢＣ１２３＠ｍａｉｌ．ｃｏｍ')).toBe('ABC123@mail.com');
  });
  it('中文不變', () => {
    expect(toHalfWidth('普瑞默生技')).toBe('普瑞默生技');
  });
});

describe('normalizeNameZh', () => {
  it('移除姓名內空白', () => expect(normalizeNameZh('王 小 明')).toBe('王小明'));
  it('全形空白也移除', () => expect(normalizeNameZh('陳　大文 ')).toBe('陳大文'));
});

describe('normalizePhone', () => {
  it.each([
    ['0912-345-678', '+886912345678', ''],
    ['0912 345 678', '+886912345678', ''],
    ['(02)2712-3456', '+886227123456', ''],
    ['02-2712-3456#123', '+886227123456', '123'],
    ['02-2712-3456 ext. 88', '+886227123456', '88'],
    ['02-27123456 分機 501', '+886227123456', '501'],
    ['+886-2-2712-3456', '+886227123456', ''],
    ['+886 (0)2 2712 3456', '+886227123456', ''],
    ['+886-912-345-678', '+886912345678', ''],
    ['00886-2-27123456', '+886227123456', ''],
    ['886912345678', '+886912345678', ''],
    ['+1 (650) 555-0100', '+16505550100', ''],
    ['０９１２３４５６７８', '+886912345678', ''],
    ['03-5678901 轉 22', '+88635678901', '22']
  ])('%s', (raw, number, ext) => {
    expect(normalizePhone(raw)).toEqual({ number, ext });
  });
  it('AI 已拆出的分機優先', () => {
    expect(normalizePhone('02-2712-3456', '#7')).toEqual({ number: '+886227123456', ext: '7' });
  });
  it('空字串', () => expect(normalizePhone('')).toEqual({ number: '', ext: '' }));
});

describe('normalizeEmail', () => {
  it('轉小寫去空白', () => {
    expect(normalizeEmail(' John.Doe@PrimoBio.com ')).toEqual({ value: 'john.doe@primobio.com', valid: true });
  });
  it('全形與 mailto', () => {
    expect(normalizeEmail('mailto:ａｂｃ＠ｘ．ｔｗ')).toEqual({ value: 'abc@x.tw', valid: true });
  });
  it('不合格者標示無效', () => {
    expect(normalizeEmail('abc@xyz').valid).toBe(false);
  });
});

describe('normalizeUrl', () => {
  it('補 https', () => expect(normalizeUrl('www.primobio.com')).toBe('https://www.primobio.com'));
  it('保留 http', () => expect(normalizeUrl('http://a.tw')).toBe('http://a.tw'));
  it('空字串', () => expect(normalizeUrl('')).toBe(''));
});

describe('normalizeBox', () => {
  it('合法框原樣', () => expect(normalizeBox([10, 20, 500, 600])).toEqual({ box: [10, 20, 500, 600], valid: true }));
  it('超出範圍夾住', () => expect(normalizeBox([-5, 0, 1200, 900]).box).toEqual([0, 0, 1000, 900]));
  it('順序錯誤改整張', () => expect(normalizeBox([500, 0, 100, 900])).toEqual({ box: [0, 0, 1000, 1000], valid: false }));
  it('長度錯誤改整張', () => expect(normalizeBox([1, 2, 3]).valid).toBe(false));
});

describe('boxIoU', () => {
  it('完全相同為 1', () => expect(boxIoU([0, 0, 100, 100], [0, 0, 100, 100])).toBe(1));
  it('不相交為 0', () => expect(boxIoU([0, 0, 100, 100], [200, 200, 300, 300])).toBe(0));
});

const rawCard = (over = {}) => ({
  box_2d: [100, 100, 400, 500],
  orientation: '0',
  side: 'front',
  low_confidence_fields: [],
  fields: {
    name_zh: '林 志 明', name_en: 'Chih-Ming Lin', title_zh: '業務經理', title_en: 'Sales Manager',
    department: '', company_zh: '普瑞默生物科技股份有限公司', company_en: 'PrimoBio Inc.',
    company_short: 'PrimoBio', mobiles: ['0912-345-678'],
    phones: [{ number: '02-2712-3456#123', ext: '' }], faxes: ['02-2712-3457'],
    emails: ['CM.Lin@PrimoBio.com'], website: 'linkedin.com/in/cmlin',
    address_zh: '台北市', address_en: '', line_id: '', linkedin: '', other_social: [],
    ...over
  }
});

describe('normalizeCard', () => {
  it('轉換為 Contacts 欄位', () => {
    const c = normalizeCard(rawCard());
    expect(c.fields.name_zh).toBe('林志明');
    expect(c.fields.mobile).toBe('+886912345678');
    expect(c.fields.phone).toBe('+886227123456');
    expect(c.fields.phone_ext).toBe('123');
    expect(c.fields.fax).toBe('+886227123457');
    expect(c.fields.email).toBe('cm.lin@primobio.com');
    expect(c.fields.linkedin).toBe('https://linkedin.com/in/cmlin');
    expect(c.fields.website).toBe('');
    expect(c.warnings).toEqual([]);
  });
  it('無效 Email 加入低信心', () => {
    const c = normalizeCard(rawCard({ emails: ['abc@xyz'] }));
    expect(c.lowConfidenceFields).toContain('emails');
  });
  it('不合法方向改為 0', () => {
    expect(normalizeCard({ ...rawCard(), orientation: '45' }).orientation).toBe('0');
  });
});

describe('normalizeRecognition', () => {
  it('合併重疊框，保留欄位較多者', () => {
    const a = rawCard();
    const b = { ...rawCard({ name_en: '', title_en: '' }), box_2d: [105, 102, 402, 498] };
    const out = normalizeRecognition({ cards: [b, a] });
    expect(out).toHaveLength(1);
    expect(out[0].fields.name_en).toBe('Chih-Ming Lin');
  });
  it('空輸出', () => expect(normalizeRecognition({ cards: [] })).toEqual([]));
});
