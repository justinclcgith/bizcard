import { describe, it, expect } from 'vitest';
import {
  allTags, displayCompany, displayName, firstOf, groupByCompany, isSavable, parseContact,
  searchContacts, splitTags, titleFieldsChanged
} from '../src/lib/contact';
import type { Contact } from '../src/lib/contact';
import { emptyFields } from '../src/lib/types';

let seq = 0;
function mk(over: Record<string, unknown>): Contact {
  return parseContact({ id: `c${++seq}`, created_at: '2026-01-01T00:00:00+08:00', ...over });
}

describe('parseContact', () => {
  it('缺 ID 丟錯、未知欄位忽略、布林只認 true', () => {
    expect(() => parseContact({ name_zh: 'x' })).toThrow();
    const c = parseContact({ id: 'a', name_zh: '王', bogus: 1, verified: 'TRUE', deleted: true, mobile: 912 });
    expect(c.verified).toBe(false);
    expect(c.deleted).toBe(true);
    expect(c.mobile).toBe('912');
    expect('bogus' in c).toBe(false);
  });
});

describe('顯示', () => {
  it('姓名與公司簡稱優先', () => {
    expect(displayName(mk({ name_zh: '王小明', name_en: 'Wang' }))).toBe('王小明 Wang');
    expect(displayName(mk({}))).toBe('（未填姓名）');
    expect(displayCompany(mk({ company_zh: '範例股份有限公司', company_short: '範例' }))).toBe('範例');
    expect(displayCompany(mk({ company_en: 'Ex Inc.' }))).toBe('Ex Inc.');
  });
  it('標籤可用全形逗號', () => {
    expect(splitTags('展會， 客戶,  ,VIP')).toEqual(['展會', '客戶', 'VIP']);
  });
  it('多筆值取第一筆', () => {
    expect(firstOf('+886912000000 ; +886922000000')).toBe('+886912000000');
    expect(firstOf('')).toBe('');
  });
});

describe('searchContacts', () => {
  const list = [
    mk({ name_zh: '王小明', name_en: 'Hsiao-Ming Wang', company_short: '範例', mobile: '+886912345678', tags: '展會,客戶', met_date: '2026-10-01' }),
    mk({ name_zh: '陳大文', company_en: 'Acme Corp', email: 'chen@acme.com', tags: '客戶', met_date: '2026-11-01' }),
    mk({ name_zh: '林美玲', deleted: true, tags: '展會' })
  ];
  it('排除已刪除、依取得日期新到舊', () => {
    expect(searchContacts(list, '').map((c) => c.name_zh)).toEqual(['陳大文', '王小明']);
  });
  it('中英、大小寫、多關鍵字皆需符合', () => {
    expect(searchContacts(list, 'wang').map((c) => c.name_zh)).toEqual(['王小明']);
    expect(searchContacts(list, 'ACME 陳').length).toBe(1);
    expect(searchContacts(list, 'acme 王').length).toBe(0);
  });
  it('電話可用 09 開頭或含連字號搜尋', () => {
    expect(searchContacts(list, '0912-345').length).toBe(1);
    expect(searchContacts(list, '912345678').length).toBe(1);
  });
  it('標籤篩選', () => {
    expect(searchContacts(list, '', '展會').map((c) => c.name_zh)).toEqual(['王小明']);
    expect(allTags(list)).toEqual(['客戶', '展會']);
  });
  it('3,000 筆搜尋在 300ms 內（docs/06 P4.4）', () => {
    const many = Array.from({ length: 3000 }, (_, i) => mk({
      name_zh: `測試${i}`, name_en: `Person ${i}`, company_zh: `公司${i % 97}`, email: `p${i}@ex${i % 13}.com`,
      mobile: `+8869${String(10000000 + i)}`, tags: i % 5 ? '客戶' : '展會', notes: '備註內容'.repeat(5)
    }));
    searchContacts(many, '暖身');
    const t0 = performance.now();
    for (const q of ['測試29', 'ex7', '0910001', '公司5 客']) searchContacts(many, q);
    searchContacts(many, '', '展會');
    expect(performance.now() - t0).toBeLessThan(300);
  });
});

describe('groupByCompany', () => {
  it('依簡稱分組，無公司歸一組', () => {
    const g = groupByCompany([mk({ company_short: '乙' }), mk({ company_zh: '甲公司' }), mk({ company_short: '乙' }), mk({})]);
    expect(g.map(([k, v]) => [k, v.length])).toContainEqual(['乙', 2]);
    expect(g.map(([k]) => k)).toContain('（未填公司）');
  });
});

describe('isSavable / titleFieldsChanged', () => {
  it('至少要有姓名、公司或 Email', () => {
    expect(isSavable(emptyFields())).toBe(false);
    expect(isSavable({ ...emptyFields(), email: 'a@b.c' })).toBe(true);
  });
  it('只看公司、部門、職稱，忽略前後空白', () => {
    const c = mk({ title_zh: '經理', company_zh: 'A' });
    expect(titleFieldsChanged(c, { ...c, title_zh: ' 經理 ' })).toBe(false);
    expect(titleFieldsChanged(c, { ...c, title_zh: '協理' })).toBe(true);
    expect(titleFieldsChanged(c, { ...c, mobile: '+886900000000' })).toBe(false);
  });
});
