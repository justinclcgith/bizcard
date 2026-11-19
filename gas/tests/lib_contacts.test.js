import { describe, it, expect } from 'vitest';
import lib from '../src/lib_contacts.js';

const { matchScore, findCandidates, titleChanged, mergeContact, unionTags } = lib;

const base = {
  id: 'c1', name_zh: '王小明', name_en: 'Hsiao-Ming Wang', title_zh: '經理', title_en: 'Manager',
  department: '業務部', company_zh: '範例生技股份有限公司', company_en: 'Example Bio Inc.', company_short: '範例',
  mobile: '+886912000000', email: 'hm@example.com ; wang@gmail.com', tags: '客戶', met_date: '2025-05-01',
  notes: '', front_image_id: 'img1', card_history: '', deleted: false
};

describe('matchScore', () => {
  it('Email 相同 100', () => expect(matchScore({ email: 'WANG@gmail.com' }, base).score).toBe(100));
  it('手機相同 90', () => expect(matchScore({ mobile: '+886912000000' }, base)).toEqual({ score: 90, reasons: ['mobile'] }));
  it('中文姓名＋公司 70（公司字尾不同也算）', () => {
    expect(matchScore({ name_zh: '王小明', company_zh: '範例生技有限公司' }, base).score).toBe(70);
  });
  it('英文姓名＋公司 70（忽略大小寫與連字號）', () => {
    expect(matchScore({ name_en: 'hsiao ming wang', company_en: 'EXAMPLE BIO' }, base).score).toBe(70);
  });
  it('只有姓名相同、公司不同 → 0', () => {
    expect(matchScore({ name_zh: '王小明', company_zh: '別家公司' }, base).score).toBe(0);
  });
  it('換公司但手機相同 → 加分', () => {
    const r = matchScore({ name_zh: '王小明', company_zh: '別家公司', mobile: '+886912000000' }, base);
    expect(r.score).toBe(100);
    expect(r.reasons).toContain('name');
  });
});

describe('findCandidates', () => {
  it('排除已刪除、依分數排序、最多 3 筆', () => {
    const contacts = [
      { ...base, id: 'a', email: '' },
      { ...base, id: 'b' },
      { ...base, id: 'c', deleted: 'TRUE' },
      { ...base, id: 'd', email: '', mobile: '', name_zh: '別人' }
    ];
    const r = findCandidates({ name_zh: '王小明', company_zh: '範例生技', email: 'hm@example.com', mobile: '+886912000000' }, contacts);
    expect(r.map((x) => x.contactId)).toEqual(['b', 'a']);
  });
});

describe('titleChanged', () => {
  it('職稱不同', () => expect(titleChanged(base, { title_zh: '協理' })).toBe(true));
  it('空白不算變動', () => expect(titleChanged(base, { title_zh: '' })).toBe(false));
  it('大小寫與空白不算', () => expect(titleChanged(base, { title_en: ' manager ' })).toBe(false));
});

describe('mergeContact', () => {
  it('升職：寫歷程、更新職稱、舊名片圖移入歷次', () => {
    const { contact, history } = mergeContact(base,
      { name_zh: '王小明', title_zh: '協理', title_en: 'Director', met_date: '2026-11-19', tags: '展會, 客戶', mobile: '' },
      { frontImageId: 'img2', backImageId: 'img2b' });
    expect(history).toMatchObject({ contact_id: 'c1', title_zh: '經理', title_en: 'Manager', valid_until: '2026-11-19', first_seen: '2025-05-01', card_image_id: 'img1' });
    expect(contact.title_zh).toBe('協理');
    expect(contact.department).toBe('');
    expect(contact.mobile).toBe('+886912000000');
    expect(contact.tags).toBe('客戶, 展會');
    expect(contact.front_image_id).toBe('img2');
    expect(contact.card_history).toBe('img1');
    expect(contact.met_date).toBe('2026-11-19');
  });
  it('職稱沒變：不寫歷程', () => {
    const { history, contact } = mergeContact(base, { title_zh: '經理', notes: '再次見面' });
    expect(history).toBeNull();
    expect(contact.notes).toBe('再次見面');
  });
  it('舊的取得日期不覆蓋新的', () => {
    expect(mergeContact(base, { met_date: '2024-01-01' }).contact.met_date).toBe('2025-05-01');
  });
});

describe('unionTags', () => {
  it('全形逗號也可', () => expect(unionTags('A，B', 'B, C')).toBe('A, B, C'));
});
