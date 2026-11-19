/**
 * 名片辨識結果正規化（純函式，GAS 與 Node 皆可執行）。
 * 規則見 docs/05-AI辨識設計.md §6。
 */

/** 全形英數與常用符號轉半形；中文不動。 */
function toHalfWidth(str) {
  if (!str) return '';
  return String(str)
    .replace(/[！-～]/g, function (ch) {
      return String.fromCharCode(ch.charCodeAt(0) - 0xFEE0);
    })
    .replace(/　/g, ' ');
}

function cleanText(str) {
  return toHalfWidth(str || '').replace(/\s+/g, ' ').trim();
}

/** 中文姓名移除空白（「王 小 明」→「王小明」）。 */
function normalizeNameZh(str) {
  return cleanText(str).replace(/\s+/g, '');
}

var EXT_PATTERN = /(?:#|ext\.?|ex\.?|x|分機|轉)\s*(\d{1,6})\s*$/i;

/**
 * 電話正規化為 E.164（台灣號碼補 +886），分機另外回傳。
 * @param {string} raw
 * @param {string=} extHint AI 已拆出的分機
 * @return {{number: string, ext: string}}
 */
function normalizePhone(raw, extHint) {
  var s = cleanText(raw);
  var ext = cleanText(extHint || '').replace(/\D/g, '');
  var m = s.match(EXT_PATTERN);
  if (m) {
    if (!ext) ext = m[1];
    s = s.slice(0, m.index);
  }
  var hasPlus = /^\s*\+/.test(s);
  // 去掉 +886 (0)2 這類寫法中的 (0)
  s = s.replace(/\(0\)/g, '');
  var digits = s.replace(/\D/g, '');
  if (!digits) return { number: '', ext: ext };

  var number;
  if (hasPlus) {
    number = '+' + digits;
  } else if (digits.indexOf('00') === 0) {
    number = '+' + digits.slice(2);
  } else if (digits.indexOf('886') === 0 && digits.length >= 11) {
    number = '+' + digits;
  } else if (digits.charAt(0) === '0') {
    number = '+886' + digits.slice(1);
  } else {
    // 無區碼的本地號碼，原樣保留數字
    number = digits;
  }
  // +8860x... → +886x...
  number = number.replace(/^\+8860/, '+886');
  return { number: number, ext: ext };
}

function normalizeEmail(raw) {
  var s = cleanText(raw).replace(/\s+/g, '').replace(/^mailto:/i, '').toLowerCase();
  var valid = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s);
  return { value: s, valid: valid };
}

function normalizeUrl(raw) {
  var s = cleanText(raw).replace(/\s+/g, '');
  if (!s) return '';
  if (!/^https?:\/\//i.test(s)) s = 'https://' + s;
  return s;
}

function isLinkedInUrl(s) {
  return /linkedin\.com\//i.test(s || '');
}

/** box_2d：[ymin, xmin, ymax, xmax]，0–1000。不合法時回傳整張圖。 */
function normalizeBox(box) {
  var full = [0, 0, 1000, 1000];
  if (!Array.isArray(box) || box.length !== 4) return { box: full, valid: false };
  var b = box.map(function (v) {
    var n = Math.round(Number(v));
    if (!isFinite(n)) return NaN;
    return Math.min(1000, Math.max(0, n));
  });
  if (b.some(function (v) { return isNaN(v); })) return { box: full, valid: false };
  if (!(b[0] < b[2] && b[1] < b[3])) return { box: full, valid: false };
  return { box: b, valid: true };
}

/** 兩個 box_2d 的 IoU。 */
function boxIoU(a, b) {
  var y0 = Math.max(a[0], b[0]);
  var x0 = Math.max(a[1], b[1]);
  var y1 = Math.min(a[2], b[2]);
  var x1 = Math.min(a[3], b[3]);
  var inter = Math.max(0, y1 - y0) * Math.max(0, x1 - x0);
  var areaA = (a[2] - a[0]) * (a[3] - a[1]);
  var areaB = (b[2] - b[0]) * (b[3] - b[1]);
  var union = areaA + areaB - inter;
  return union > 0 ? inter / union : 0;
}

function joinList(arr) {
  var seen = {};
  var out = [];
  (arr || []).forEach(function (v) {
    if (v && !seen[v]) {
      seen[v] = true;
      out.push(v);
    }
  });
  return out.join(' ; ');
}

function countFilled(fields) {
  return Object.keys(fields).filter(function (k) {
    return fields[k] !== '' && fields[k] != null;
  }).length;
}

/**
 * 把 AI 回傳的一張卡（CARD_SCHEMA_V1）轉成 Contacts 欄位。
 * @return {{fields: Object, box_2d: number[], orientation: string, side: string,
 *           lowConfidenceFields: string[], warnings: string[]}}
 */
function normalizeCard(raw) {
  var f = (raw && raw.fields) || {};
  var warnings = [];
  var low = ((raw && raw.low_confidence_fields) || []).slice();

  var boxRes = normalizeBox(raw && raw.box_2d);
  if (!boxRes.valid) warnings.push('位置框格式不正確，已改為整張圖片');

  var mobiles = (f.mobiles || []).map(function (p) { return normalizePhone(p).number; });
  var phones = [];
  var phoneExt = '';
  (f.phones || []).forEach(function (p) {
    var r = normalizePhone(p && p.number, p && p.ext);
    if (r.number) phones.push(r.number);
    if (r.ext && !phoneExt) phoneExt = r.ext;
  });
  var faxes = (f.faxes || []).map(function (p) { return normalizePhone(p).number; });

  var emails = [];
  (f.emails || []).forEach(function (e) {
    var r = normalizeEmail(e);
    if (!r.value) return;
    emails.push(r.value);
    if (!r.valid && low.indexOf('emails') < 0) low.push('emails');
  });

  var website = normalizeUrl(f.website);
  var linkedin = cleanText(f.linkedin);
  if (isLinkedInUrl(website) && !linkedin) {
    linkedin = website;
    website = '';
  }
  if (linkedin && /linkedin\.com\//i.test(linkedin)) linkedin = normalizeUrl(linkedin);

  var fields = {
    name_zh: normalizeNameZh(f.name_zh),
    name_en: cleanText(f.name_en),
    title_zh: cleanText(f.title_zh),
    title_en: cleanText(f.title_en),
    department: cleanText(f.department),
    company_zh: cleanText(f.company_zh),
    company_en: cleanText(f.company_en),
    company_short: cleanText(f.company_short),
    mobile: joinList(mobiles),
    phone: joinList(phones),
    phone_ext: phoneExt,
    fax: joinList(faxes),
    email: joinList(emails),
    website: website,
    address_zh: cleanText(f.address_zh),
    address_en: cleanText(f.address_en),
    line_id: cleanText(f.line_id),
    linkedin: linkedin,
    other_social: joinList((f.other_social || []).map(cleanText))
  };

  return {
    fields: fields,
    box_2d: boxRes.box,
    orientation: ['0', '90', '180', '270'].indexOf(String(raw && raw.orientation)) >= 0
      ? String(raw.orientation) : '0',
    side: ['front', 'back'].indexOf(raw && raw.side) >= 0 ? raw.side : 'unknown',
    lowConfidenceFields: low,
    warnings: warnings
  };
}

/** 正規化整份 AI 輸出，並合併 IoU > 0.7 的重複框。 */
function normalizeRecognition(output) {
  var cards = ((output && output.cards) || []).map(normalizeCard);
  var kept = [];
  cards.forEach(function (c) {
    for (var i = 0; i < kept.length; i++) {
      if (boxIoU(kept[i].box_2d, c.box_2d) > 0.7) {
        if (countFilled(c.fields) > countFilled(kept[i].fields)) kept[i] = c;
        return;
      }
    }
    kept.push(c);
  });
  return kept;
}

if (typeof module !== 'undefined') {
  module.exports = {
    toHalfWidth: toHalfWidth,
    normalizeNameZh: normalizeNameZh,
    normalizePhone: normalizePhone,
    normalizeEmail: normalizeEmail,
    normalizeUrl: normalizeUrl,
    normalizeBox: normalizeBox,
    boxIoU: boxIoU,
    normalizeCard: normalizeCard,
    normalizeRecognition: normalizeRecognition
  };
}
