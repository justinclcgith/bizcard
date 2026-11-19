/**
 * 聯絡人純邏輯：重複比對（docs/03 §5）、合併與職稱歷程（docs/03 §2）。
 * GAS 與 Node 皆可執行。
 */

var CONTACT_FIELDS = [
  'name_zh', 'name_en', 'title_zh', 'title_en', 'department', 'company_zh', 'company_en',
  'company_short', 'mobile', 'phone', 'phone_ext', 'fax', 'email', 'website', 'address_zh',
  'address_en', 'line_id', 'linkedin', 'other_social', 'tags', 'event', 'met_date', 'notes'
];

var TITLE_FIELDS = ['company_zh', 'company_en', 'department', 'title_zh', 'title_en'];

function splitMulti_(s) {
  return String(s || '').split(/\s*;\s*/).map(function (x) { return x.trim().toLowerCase(); }).filter(Boolean);
}

function normPersonName_(s) {
  return String(s || '').toLowerCase().replace(/[\s.,\-'’]/g, '');
}

function normCompany_(s) {
  return String(s || '').toLowerCase()
    .replace(/股份有限公司|有限公司|公司/g, '')
    .replace(/\b(inc|co|ltd|corp|corporation|limited|llc|company)\b\.?/g, '')
    .replace(/[\s.,()（）]/g, '');
}

function companyKeys_(c) {
  return [c.company_zh, c.company_en, c.company_short].map(normCompany_).filter(Boolean);
}

function sameCompany_(a, b) {
  var ka = companyKeys_(a);
  var kb = companyKeys_(b);
  return ka.some(function (x) { return kb.indexOf(x) >= 0; });
}

function intersects_(a, b) {
  return a.some(function (x) { return b.indexOf(x) >= 0; });
}

/**
 * 計算新名片與既有聯絡人是同一人的分數。
 * @return {{score: number, reasons: string[]}}
 */
function matchScore(incoming, existing) {
  var reasons = [];
  var score = 0;
  if (intersects_(splitMulti_(incoming.email), splitMulti_(existing.email))) {
    score = Math.max(score, 100); reasons.push('email');
  }
  if (intersects_(splitMulti_(incoming.mobile), splitMulti_(existing.mobile))) {
    score = Math.max(score, 90); reasons.push('mobile');
  }
  var zhSame = !!incoming.name_zh && normPersonName_(incoming.name_zh) === normPersonName_(existing.name_zh);
  var enSame = !!incoming.name_en && normPersonName_(incoming.name_en) === normPersonName_(existing.name_en);
  var coSame = sameCompany_(incoming, existing);
  if (zhSame && coSame) { score = Math.max(score, 70); reasons.push('name_zh+company'); }
  if (enSame && coSame) { score = Math.max(score, 70); reasons.push('name_en+company'); }
  // 姓名相同但公司不同：只在已有其他條件時加分（例如換公司但手機相同）
  var bothHaveCompany = companyKeys_(incoming).length > 0 && companyKeys_(existing).length > 0;
  if ((zhSame || enSame) && !coSame && bothHaveCompany && score > 0) { score = Math.min(100, score + 10); reasons.push('name'); }
  return { score: score, reasons: reasons };
}

/** 找出疑似同一人的前 3 位（分數 ≥ 60，排除已刪除）。 */
function findCandidates(incoming, contacts) {
  return contacts
    .filter(function (c) { return !isTrue_(c.deleted); })
    .map(function (c) {
      var m = matchScore(incoming, c);
      return { contactId: c.id, score: m.score, reasons: m.reasons, contact: c };
    })
    .filter(function (x) { return x.score >= 60; })
    .sort(function (a, b) { return b.score - a.score; })
    .slice(0, 3);
}

function isTrue_(v) {
  return v === true || v === 'TRUE' || v === 'true';
}

function normTitleVal_(s) {
  return String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

/** 職稱／公司／部門是否有變動（只比較新名片上有值的欄位）。 */
function titleChanged(existing, incoming) {
  return TITLE_FIELDS.some(function (k) {
    return !!incoming[k] && normTitleVal_(incoming[k]) !== normTitleVal_(existing[k]);
  });
}

/**
 * 把新名片合併進既有聯絡人。
 * - 新值非空才覆蓋；tags 取聯集；notes 以換行附加。
 * - 職稱變動時回傳 history（舊值）。
 * @return {{contact: Object, history: Object|null}}
 */
function mergeContact(existing, incoming, opts) {
  opts = opts || {};
  var out = {};
  Object.keys(existing).forEach(function (k) { out[k] = existing[k]; });

  var history = null;
  if (titleChanged(existing, incoming)) {
    history = {
      contact_id: existing.id,
      company_zh: existing.company_zh || '', company_en: existing.company_en || '',
      company_short: existing.company_short || '', department: existing.department || '',
      title_zh: existing.title_zh || '', title_en: existing.title_en || '',
      valid_until: incoming.met_date || opts.today || '',
      first_seen: existing.met_date || '',
      card_image_id: existing.front_image_id || ''
    };
  }

  CONTACT_FIELDS.forEach(function (k) {
    var v = incoming[k];
    if (v === undefined || v === null || v === '') return;
    if (k === 'tags') {
      out.tags = unionTags_(existing.tags, v);
    } else if (k === 'notes') {
      out.notes = existing.notes ? existing.notes + '\n' + v : v;
    } else if (k === 'met_date') {
      // 取得日期保留最新一次
      if (!existing.met_date || String(v) > String(existing.met_date)) out.met_date = v;
    } else {
      out[k] = v;
    }
  });

  // 職稱有變時，只出現在舊名片上的職稱欄位要清空（避免新舊混雜）
  if (history) {
    TITLE_FIELDS.forEach(function (k) {
      if (!incoming[k] && existing[k]) out[k] = '';
    });
  }

  if (opts.frontImageId) {
    if (existing.front_image_id) {
      out.card_history = existing.card_history
        ? existing.card_history + ' ; ' + existing.front_image_id
        : existing.front_image_id;
    }
    out.front_image_id = opts.frontImageId;
    out.back_image_id = opts.backImageId || '';
  }
  return { contact: out, history: history };
}

function unionTags_(a, b) {
  var seen = {};
  var out = [];
  [a, b].forEach(function (s) {
    String(s || '').split(/\s*[,，]\s*/).forEach(function (t) {
      t = t.trim();
      if (t && !seen[t]) { seen[t] = true; out.push(t); }
    });
  });
  return out.join(', ');
}

if (typeof module !== 'undefined') {
  module.exports = {
    CONTACT_FIELDS: CONTACT_FIELDS,
    matchScore: matchScore,
    findCandidates: findCandidates,
    titleChanged: titleChanged,
    mergeContact: mergeContact,
    unionTags: unionTags_
  };
}
