// 名片夾後端（由 gas/tools/bundle.mjs 自動產生，請勿手動修改）

// ===== ai_claude.js =====
/**
 * Claude Messages API（REST，GAS 無官方 SDK）。格式見 docs/05 §4。
 */

var CLAUDE_ENDPOINT = 'https://api.anthropic.com/v1/messages';

function buildClaudeRequest_(props, image, prompt, opts) {
  var key = props.getProperty('ANTHROPIC_API_KEY');
  if (!key) throw new AppError('AI_ERROR', '尚未設定 Claude 金鑰');
  var body = {
    model: props.getProperty('CLAUDE_MODEL') || 'claude-opus-5-5',
    max_tokens: 16000,
    fallbacks: 'default',
    output_config: {
      effort: (opts && opts.claudeEffort) || props.getProperty('CLAUDE_EFFORT') || 'low',
      format: { type: 'json_schema', schema: CARD_SCHEMA_V1 }
    },
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: image.mime, data: image.base64 } },
        { type: 'text', text: prompt }
      ]
    }]
  };
  return {
    url: CLAUDE_ENDPOINT,
    method: 'post',
    contentType: 'application/json',
    headers: {
      'x-api-key': key,
      'anthropic-version': '2026-10-21',
      'anthropic-beta': 'server-side-fallback-2026-07-01'
    },
    payload: JSON.stringify(body),
    muteHttpExceptions: true
  };
}

/** @return {{output: Object, model: string, usage: {input: number, output: number}}} */
function parseClaudeResponse_(resp) {
  var code = resp.getResponseCode();
  var json;
  try { json = JSON.parse(resp.getContentText()); } catch (e) { json = null; }
  if (code !== 200 || !json) {
    var msg = json && json.error ? json.error.type : ('HTTP ' + code);
    if (code === 429 || code === 529) throw new AppError('AI_ERROR', 'Claude 目前忙碌，請稍後再試（' + msg + '）');
    throw new AppError('AI_ERROR', 'Claude 呼叫失敗（' + msg + '）');
  }
  if (json.stop_reason === 'refusal') throw new AppError('AI_REFUSED', 'Claude 拒絕處理這張圖片');
  if (json.stop_reason === 'max_tokens') throw new AppError('AI_ERROR', 'Claude 輸出被截斷，請減少單張照片中的名片數');
  var text = (json.content || [])
    .filter(function (b) { return b.type === 'text'; })
    .map(function (b) { return b.text; })
    .join('');
  var output;
  try { output = JSON.parse(text); } catch (e) {
    throw new AppError('AI_ERROR', 'Claude 回傳格式無法解析');
  }
  return {
    output: output,
    model: json.model || '',
    usage: { input: (json.usage && json.usage.input_tokens) || 0, output: (json.usage && json.usage.output_tokens) || 0 }
  };
}

// ===== ai_gemini.js =====
/**
 * Gemini generateContent（REST）。格式見 docs/05 §5；模型 ID 與參數名稱於 P0.5 查證。
 */

function buildGeminiRequest_(props, image, prompt) {
  var key = props.getProperty('GEMINI_API_KEY');
  if (!key) throw new AppError('AI_ERROR', '尚未設定 Gemini 金鑰');
  var model = props.getProperty('GEMINI_MODEL') || 'gemini-3.6-flash';
  var body = {
    contents: [{
      role: 'user',
      parts: [
        { inline_data: { mime_type: image.mime, data: image.base64 } },
        { text: prompt }
      ]
    }],
    generationConfig: {
      responseMimeType: 'application/json',
      responseJsonSchema: CARD_SCHEMA_V1
    }
  };
  return {
    url: 'https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(model) + ':generateContent',
    method: 'post',
    contentType: 'application/json',
    headers: { 'x-goog-api-key': key },
    payload: JSON.stringify(body),
    muteHttpExceptions: true
  };
}

function parseGeminiResponse_(resp) {
  var code = resp.getResponseCode();
  var json;
  try { json = JSON.parse(resp.getContentText()); } catch (e) { json = null; }
  if (code !== 200 || !json) {
    var msg = json && json.error ? json.error.status : ('HTTP ' + code);
    throw new AppError('AI_ERROR', 'Gemini 呼叫失敗（' + msg + '）');
  }
  var cand = (json.candidates || [])[0];
  if (!cand) {
    if (json.promptFeedback && json.promptFeedback.blockReason) {
      throw new AppError('AI_REFUSED', 'Gemini 拒絕處理這張圖片');
    }
    throw new AppError('AI_ERROR', 'Gemini 沒有回傳結果');
  }
  if (cand.finishReason === 'SAFETY' || cand.finishReason === 'PROHIBITED_CONTENT') {
    throw new AppError('AI_REFUSED', 'Gemini 拒絕處理這張圖片');
  }
  if (cand.finishReason && cand.finishReason !== 'STOP') {
    throw new AppError('AI_ERROR', 'Gemini 未正常結束（' + cand.finishReason + '）');
  }
  var text = ((cand.content && cand.content.parts) || [])
    .filter(function (p) { return typeof p.text === 'string' && !p.thought; })
    .map(function (p) { return p.text; })
    .join('');
  var output;
  try { output = JSON.parse(text); } catch (e) {
    throw new AppError('AI_ERROR', 'Gemini 回傳格式無法解析');
  }
  var u = json.usageMetadata || {};
  return {
    output: output,
    model: json.modelVersion || '',
    usage: { input: u.promptTokenCount || 0, output: (u.candidatesTokenCount || 0) + (u.thoughtsTokenCount || 0) }
  };
}

// ===== contacts.js =====
/**
 * 聯絡人相關動作：findDuplicates、saveCards、list、getContact、updateContact、deleteContact、stats（docs/04）。
 */

function CONTACT_FIELDS_FOR_EDIT_() {
  return [
    'name_zh', 'name_en', 'title_zh', 'title_en', 'department', 'company_zh', 'company_en',
    'company_short', 'mobile', 'phone', 'phone_ext', 'fax', 'email', 'website', 'address_zh',
    'address_en', 'line_id', 'linkedin', 'other_social', 'tags', 'event', 'met_date', 'notes'
  ];
}

function pickFields_(src) {
  var out = {};
  CONTACT_FIELDS_FOR_EDIT_().forEach(function (k) {
    if (src && src[k] !== undefined && src[k] !== null) out[k] = String(src[k]).slice(0, 2000);
  });
  return out;
}

function handleFindDuplicates(req) {
  var cards = Array.isArray(req.cards) ? req.cards : [];
  var contacts = readTable_(sheet_('Contacts')).rows;
  return {
    matches: cards.map(function (c) {
      return {
        tempId: c.tempId,
        candidates: findCandidates(pickFields_(c.fields), contacts).map(function (m) {
          return { contactId: m.contactId, score: m.score, reasons: m.reasons, contact: stripInternal_(m.contact) };
        })
      };
    })
  };
}

function handleSaveCards(req) {
  var cards = Array.isArray(req.cards) ? req.cards : [];
  if (!cards.length) throw new AppError('BAD_REQUEST', '沒有要儲存的名片');
  var batch = req.batch || {};
  var created = [];
  var now = nowIso_();
  var today = todayTaipei_();

  // 先存圖（不需鎖），失敗時清掉已建立的檔案
  var images = [];
  try {
    var sourceId = req.sourcePhoto ? saveImage_(req.sourcePhoto, 'photos', 'p_' + stamp_() + '.jpg') : '';
    if (sourceId) created.push(sourceId);
    cards.forEach(function (c, i) {
      var tag = stamp_() + '_' + i;
      var front = c.front ? saveImage_(c.front, 'cards', 'front_' + tag + '.jpg') : '';
      if (front) created.push(front);
      var back = c.back ? saveImage_(c.back, 'cards', 'back_' + tag + '.jpg') : '';
      if (back) created.push(back);
      images.push({ front: front, back: back, source: sourceId });
    });
  } catch (err) {
    trashFiles_(created);
    throw err;
  }

  try {
    return withLock_(function () {
      var sh = sheet_('Contacts');
      var table = readTable_(sh);
      var histSh = sheet_('TitleHistory');
      var histCodes = readTable_(histSh).codes;
      var byId = {};
      table.rows.forEach(function (r) { byId[r.id] = r; });

      var results = cards.map(function (c, i) {
        var fields = pickFields_(c.fields);
        if (batch.tags) fields.tags = unionTags_(fields.tags, Array.isArray(batch.tags) ? batch.tags.join(', ') : batch.tags);
        if (batch.event && !fields.event) fields.event = String(batch.event);
        if (!fields.met_date) fields.met_date = batch.metDate || today;
        var provider = ['claude', 'gemini', 'manual'].indexOf(c.aiProvider) >= 0 ? c.aiProvider : 'manual';
        var img = images[i];

        var existing = c.mergeIntoId ? byId[c.mergeIntoId] : null;
        if (c.mergeIntoId && !existing) throw new AppError('NOT_FOUND', '找不到要合併的聯絡人');

        if (existing) {
          var merged = mergeContact(existing, fields, { frontImageId: img.front, backImageId: img.back, today: today });
          var row = merged.contact;
          row.source_photo_id = img.source || existing.source_photo_id;
          row.ai_provider = provider;
          row.ai_model = String(c.aiModel || '');
          row.verified = true;
          row.deleted = false;
          row.updated_at = now;
          writeObject_(sh, table.codes, existing._row, row);
          if (merged.history) {
            var h = merged.history;
            h.id = newId_('h');
            h.recorded_at = now;
            appendObject_(histSh, histCodes, h);
          }
          byId[existing.id] = row;
          return { tempId: c.tempId, contact: stripInternal_(row), merged: true, titleChanged: !!merged.history };
        }

        var contact = fields;
        contact.id = newId_('c');
        contact.front_image_id = img.front;
        contact.back_image_id = img.back;
        contact.source_photo_id = img.source;
        contact.card_history = '';
        contact.ai_provider = provider;
        contact.ai_model = String(c.aiModel || '');
        contact.verified = true;
        contact.created_at = now;
        contact.updated_at = now;
        contact.deleted = false;
        contact._row = appendObject_(sh, table.codes, contact);
        byId[contact.id] = contact;
        return { tempId: c.tempId, contact: stripInternal_(contact), merged: false, titleChanged: false };
      });
      return { contacts: results };
    });
  } catch (err) {
    trashFiles_(created);
    throw err;
  }
}

function handleList(req) {
  var since = req.since ? String(req.since) : '';
  var rows = readTable_(sheet_('Contacts')).rows;
  return {
    contacts: rows
      .filter(function (r) { return !since || String(r.updated_at) > since; })
      .map(stripInternal_),
    serverTime: nowIso_()
  };
}

function findRow_(id) {
  var sh = sheet_('Contacts');
  var t = readTable_(sh);
  for (var i = 0; i < t.rows.length; i++) {
    if (t.rows[i].id === id) return { sh: sh, codes: t.codes, row: t.rows[i] };
  }
  throw new AppError('NOT_FOUND', '找不到聯絡人');
}

function handleGetContact(req) {
  var found = findRow_(String(req.id || ''));
  var hist = readTable_(sheet_('TitleHistory')).rows
    .filter(function (h) { return h.contact_id === found.row.id; })
    .map(stripHistory_)
    .sort(function (a, b) { return String(b.valid_until).localeCompare(String(a.valid_until)); });
  return { contact: stripInternal_(found.row), titleHistory: hist };
}

function stripHistory_(h) {
  var out = {};
  Object.keys(h).forEach(function (k) { if (k.charAt(0) !== '_') out[k] = h[k]; });
  return out;
}

function handleUpdateContact(req) {
  return withLock_(function () {
    var found = findRow_(String(req.id || ''));
    var row = found.row;
    if (req.baseUpdatedAt && String(row.updated_at) > String(req.baseUpdatedAt)) {
      return { conflict: true, contact: stripInternal_(row) };
    }
    var fields = pickFields_(req.fields);
    var now = nowIso_();
    if (req.recordTitleChange && titleChanged(row, fields)) {
      var histSh = sheet_('TitleHistory');
      appendObject_(histSh, readTable_(histSh).codes, {
        id: newId_('h'), contact_id: row.id, company_zh: row.company_zh, company_en: row.company_en,
        company_short: row.company_short, department: row.department, title_zh: row.title_zh,
        title_en: row.title_en, valid_until: todayTaipei_(), first_seen: row.met_date,
        card_image_id: row.front_image_id, recorded_at: now
      });
    }
    Object.keys(fields).forEach(function (k) { row[k] = fields[k]; });
    row.updated_at = now;
    writeObject_(found.sh, found.codes, row._row, row);
    return { contact: stripInternal_(row) };
  });
}

function handleDeleteContact(req) {
  return withLock_(function () {
    var found = findRow_(String(req.id || ''));
    found.row.deleted = true;
    found.row.updated_at = nowIso_();
    writeObject_(found.sh, found.codes, found.row._row, found.row);
    return { contact: stripInternal_(found.row) };
  });
}

function handleStats(req) {
  var month = /^\d{4}-\d{2}$/.test(req.month || '') ? req.month : todayTaipei_().slice(0, 7);
  var rows = readTable_(sheet_('RecognitionLog')).rows.filter(function (r) {
    return String(r.ts).slice(0, 7) === month && r.status === 'ok';
  });
  var byProvider = {};
  var cost = 0;
  var cards = 0;
  rows.forEach(function (r) {
    var p = r.provider || 'unknown';
    byProvider[p] = byProvider[p] || { recognitions: 0, cards: 0, estCostUsd: 0 };
    byProvider[p].recognitions++;
    byProvider[p].cards += Number(r.cards_detected) || 0;
    byProvider[p].estCostUsd += Number(r.est_cost_usd) || 0;
    cost += Number(r.est_cost_usd) || 0;
    cards += Number(r.cards_detected) || 0;
  });
  return { month: month, recognitions: rows.length, cards: cards, estCostUsd: Math.round(cost * 10000) / 10000, byProvider: byProvider };
}

// ===== drive_api.js =====
/**
 * Drive REST API v3（以 drive.file 權限呼叫）。
 * DriveApp 需要「所有雲端硬碟檔案」權限，所以改用 REST：
 * 只能存取這個程式自己建立的檔案與資料夾。
 */

var DRIVE_API_ = 'https://www.googleapis.com/drive/v3/files';
var DRIVE_UPLOAD_ = 'https://www.googleapis.com/upload/drive/v3/files';
var FOLDER_MIME_ = 'application/vnd.google-apps.folder';

function driveFetch_(url, opts) {
  var params = {
    method: (opts && opts.method) || 'get',
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
    muteHttpExceptions: true
  };
  if (opts && opts.contentType) params.contentType = opts.contentType;
  if (opts && opts.payload !== undefined) params.payload = opts.payload;
  var res = UrlFetchApp.fetch(url, params);
  var code = res.getResponseCode();
  if (code === 404) return null;
  if (code >= 300) throw new Error('Drive API ' + code + '：' + String(res.getContentText()).slice(0, 300));
  return res;
}

function driveJson_(url, opts) {
  var res = driveFetch_(url, opts);
  return res ? JSON.parse(res.getContentText() || '{}') : null;
}

/** 取得檔案中繼資料；不存在、已丟垃圾桶或無權限時回傳 null。 */
function driveGet_(id) {
  if (!id || !/^[\w-]+$/.test(String(id))) return null;
  var f = driveJson_(DRIVE_API_ + '/' + id + '?fields=id,name,mimeType,parents,trashed,thumbnailLink');
  return f && !f.trashed ? f : null;
}

function driveCreateFolder_(name, parentId) {
  var meta = { name: name, mimeType: FOLDER_MIME_ };
  if (parentId) meta.parents = [parentId];
  return driveJson_(DRIVE_API_ + '?fields=id', {
    method: 'post', contentType: 'application/json', payload: JSON.stringify(meta)
  }).id;
}

/** 找子資料夾，沒有就建立。 */
function driveChildFolder_(parentId, name) {
  var q = "'" + parentId + "' in parents and name = '" + String(name).replace(/'/g, "\\'") +
    "' and mimeType = '" + FOLDER_MIME_ + "' and trashed = false";
  var r = driveJson_(DRIVE_API_ + '?fields=files(id)&q=' + encodeURIComponent(q));
  if (r && r.files && r.files.length) return r.files[0].id;
  return driveCreateFolder_(name, parentId);
}

/** multipart 上傳，回傳新檔案 ID。 */
function driveUpload_(parentId, name, mime, bytes) {
  var boundary = 'bizcard' + Utilities.getUuid().replace(/-/g, '');
  var head = '--' + boundary + '\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n' +
    JSON.stringify({ name: name, parents: [parentId] }) +
    '\r\n--' + boundary + '\r\nContent-Type: ' + mime + '\r\n\r\n';
  var tail = '\r\n--' + boundary + '--';
  var payload = Utilities.newBlob(head).getBytes().concat(bytes, Utilities.newBlob(tail).getBytes());
  return driveJson_(DRIVE_UPLOAD_ + '?uploadType=multipart&fields=id', {
    method: 'post', contentType: 'multipart/related; boundary=' + boundary, payload: payload
  }).id;
}

/** 下載檔案內容（Blob）。 */
function driveDownload_(id) {
  var res = driveFetch_(DRIVE_API_ + '/' + id + '?alt=media');
  return res ? res.getBlob() : null;
}

function driveTrash_(id) {
  driveFetch_(DRIVE_API_ + '/' + id, { method: 'patch', contentType: 'application/json', payload: JSON.stringify({ trashed: true }) });
}

// ===== lib_contacts.js =====
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

// ===== lib_normalize.js =====
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

// ===== main.js =====
/**
 * Web App 進入點：doPost → 驗證 APP_TOKEN → 依 action 分派。
 * 規格見 docs/04-API規格.md。
 */

var APP_VERSION = '0.1.0';
var MAX_AUTH_FAILS_PER_HOUR = 20;
var REQUEST_CACHE_SECONDS = 600;

/** action 名稱 → 處理函式。用函式回傳，避免 GAS 檔案載入順序影響。 */
function getActions_() {
  return {
    ping: handlePing,
    recognize: handleRecognize,
    findDuplicates: handleFindDuplicates,
    saveCards: handleSaveCards,
    list: handleList,
    getContact: handleGetContact,
    updateContact: handleUpdateContact,
    deleteContact: handleDeleteContact,
    getImage: handleGetImage,
    stats: handleStats
  };
}

function doPost(e) {
  var req;
  try {
    req = JSON.parse((e && e.postData && e.postData.contents) || '');
  } catch (err) {
    return jsonOut_(fail_('BAD_REQUEST', '請求格式不是有效的 JSON'));
  }
  return jsonOut_(dispatch_(req || {}));
}

/** 所有 GET 一律拒絕，避免以瀏覽器直接開網址探測。 */
function doGet() {
  return jsonOut_(fail_('BAD_REQUEST', '請使用 App 存取'));
}

function dispatch_(req) {
  var props = PropertiesService.getScriptProperties();
  var cache = CacheService.getScriptCache();

  if (cache.get('lockout')) {
    return fail_('RATE_LIMITED', '驗證失敗次數過多，請一小時後再試');
  }
  if (!safeEquals_(String(req.token || ''), props.getProperty('APP_TOKEN') || '')) {
    recordAuthFail_(cache);
    return fail_('UNAUTHORIZED', '存取權杖錯誤');
  }

  var actions = getActions_();
  var handler = Object.prototype.hasOwnProperty.call(actions, req.action) ? actions[req.action] : null;
  if (!handler) return fail_('BAD_REQUEST', '不支援的動作：' + String(req.action));

  var cacheKey = req.requestId ? 'req_' + String(req.requestId).slice(0, 80) : null;
  if (cacheKey) {
    var cached = cache.get(cacheKey);
    if (cached) return JSON.parse(cached);
  }

  var result;
  try {
    result = ok_(handler(req));
  } catch (err) {
    result = errorToResult_(err);
    logEvent_('error', req.action, err);
  }

  if (cacheKey && result.ok) {
    var s = JSON.stringify(result);
    // CacheService 單筆上限 100KB，太大的結果不快取
    if (s.length < 90000) cache.put(cacheKey, s, REQUEST_CACHE_SECONDS);
  }
  return result;
}

/** 由處理函式丟出，帶錯誤代碼。 */
function AppError(code, message) {
  this.code = code;
  this.message = message;
}

function errorToResult_(err) {
  if (err instanceof AppError) return fail_(err.code, err.message);
  return fail_('INTERNAL', '伺服器發生錯誤，請稍後再試');
}

function handlePing() {
  var props = PropertiesService.getScriptProperties();
  var sheetOk = false;
  var driveOk = false;
  try { sheetOk = !!openDb_().getSheetByName('Contacts'); } catch (e) { /* 未執行 setup */ }
  try { driveOk = !!driveGet_(props.getProperty('DRIVE_FOLDER_ID')); } catch (e) { /* 未執行 setup */ }
  var providers = [];
  if (props.getProperty('ANTHROPIC_API_KEY')) providers.push('claude');
  if (props.getProperty('GEMINI_API_KEY')) providers.push('gemini');
  return {
    version: APP_VERSION,
    sheetOk: sheetOk,
    driveOk: driveOk,
    providers: providers,
    defaultProvider: props.getProperty('DEFAULT_PROVIDER') || 'claude'
  };
}

function recordAuthFail_(cache) {
  var key = 'authfail_' + Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyyMMddHH');
  var n = Number(cache.get(key) || 0) + 1;
  cache.put(key, String(n), 3600);
  if (n >= MAX_AUTH_FAILS_PER_HOUR) {
    cache.put('lockout', '1', 3600);
    logEvent_('security', 'lockout', '一小時內驗證失敗 ' + n + ' 次，暫停服務一小時');
  }
}

/** 固定時間字串比較。 */
function safeEquals_(a, b) {
  if (!b) return false;
  var diff = a.length ^ b.length;
  for (var i = 0; i < b.length; i++) {
    diff |= (a.charCodeAt(i % (a.length || 1)) || 0) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

function ok_(data) { return { ok: true, data: data }; }
function fail_(code, message) { return { ok: false, error: { code: code, message: message } }; }

function jsonOut_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/** 寫入 Log 工作表；不得包含金鑰或權杖。 */
function logEvent_(level, where, detail) {
  try {
    var sh = openDb_().getSheetByName('Log');
    if (!sh) return;
    var msg = detail && detail.stack ? String(detail.stack).slice(0, 500) : String(detail).slice(0, 500);
    sh.appendRow([new Date(), level, where, msg]);
  } catch (e) { /* 記錄失敗不影響主流程 */ }
}

/** 產生新的 APP_TOKEN（在編輯器手動執行，從執行記錄複製）。 */
function generateToken() {
  var bytes = Utilities.getUuid() + Utilities.getUuid();
  var token = Utilities.base64EncodeWebSafe(
    Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, bytes + Date.now())
  ).replace(/=+$/, '').slice(0, 40);
  Logger.log('新的 APP_TOKEN：' + token);
  return token;
}

/**
 * 印出手機設定用的 JSON（{"url","token"}），在編輯器手動執行、從執行記錄複製，
 * 再到手機設定頁按「從剪貼簿貼上設定」。
 * 從編輯器執行時 ScriptApp.getService().getUrl() 會回傳測試用的 /dev 網址（手機無法使用），
 * 所以網址以指令碼屬性 WEBAPP_URL 為準：請把「部署」後複製的 /exec 網址填進去。
 */
function showSetupInfo() {
  var props = PropertiesService.getScriptProperties();
  var token = props.getProperty('APP_TOKEN');
  if (!token) throw new Error('尚未設定 APP_TOKEN');
  var url = String(props.getProperty('WEBAPP_URL') || '').trim();
  if (!/\/exec$/.test(url)) {
    throw new Error('請先把「部署 → 管理部署作業」裡的網頁應用程式網址（/exec 結尾）填入指令碼屬性 WEBAPP_URL，再執行一次。');
  }
  var payload = JSON.stringify({ url: url, token: token });
  Logger.log('手機設定（請勿貼到公開的地方）：' + payload);
  return payload;
}

// ===== recognize.js =====
/**
 * recognize 動作：提示詞、Schema、引擎分派、紀錄（docs/05）。
 */

var PROMPT_VERSION = 'v1';

var PROMPT_V1 = [
  '你是名片辨識系統。圖片中可能有 0 到 20 張名片，可能是正面或背面，可能歪斜或倒置。',
  '',
  '請找出圖片中每一張「完整或大部分可見」的名片，依由上到下、由左到右的順序，對每張輸出：',
  '1. box_2d：名片外框 [ymin, xmin, ymax, xmax]，以整張圖片寬高正規化為 0–1000 的整數。框要包住整張名片，寧可略大不要切到。',
  '2. orientation：讓文字轉正需要順時針旋轉的角度："0" / "90" / "180" / "270"。',
  '3. fields：名片上的資訊。規則：',
  '   - 完全照名片上的字抄寫，繁體中文保持繁體，不要翻譯，不要轉成簡體。',
  '   - 名片上同時有中文與英文時分別填入 *_zh 與 *_en；只有一種語言時只填那一種，另一個留空字串。',
  '   - 姓名：name_zh 為中文姓名（不含職稱），name_en 為英文姓名（保留原大小寫）。',
  '   - 電話：所有號碼依名片原樣抄寫到 mobiles / phones / faxes，分機寫在 ext。手機是 09 開頭或標示 Mobile/M/手機 的號碼。',
  '   - company_short：依常見稱呼建議公司簡稱（例如「台灣積體電路製造股份有限公司」→「台積電」，「PrimoBio Inc.」→「PrimoBio」），沒有把握時用英文名稱的主要字詞或中文名稱去掉「股份有限公司」等字尾。',
  '   - 看不清楚或沒有的欄位填空字串，不要猜。',
  '4. low_confidence_fields：你不確定的欄位名稱清單（例如字太小、反光、手寫）。',
  '5. side："front"（有姓名的一面）、"back"（只有公司資訊或另一語言）、"unknown"。',
  '',
  '只輸出符合 Schema 的 JSON。圖片中沒有名片時，cards 為空陣列。'
].join('\n');

var BACK_SIDE_SUFFIX = '\n\n這是某張名片的背面，請照同樣規則輸出，box_2d 可為整張圖。';

function strProp_() { return { type: 'string' }; }
function strArr_() { return { type: 'array', items: { type: 'string' } }; }

var CARD_SCHEMA_V1 = {
  type: 'object',
  additionalProperties: false,
  required: ['cards'],
  properties: {
    cards: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['box_2d', 'orientation', 'side', 'fields', 'low_confidence_fields'],
        properties: {
          box_2d: { type: 'array', items: { type: 'integer' } },
          orientation: { type: 'string', enum: ['0', '90', '180', '270'] },
          side: { type: 'string', enum: ['front', 'back', 'unknown'] },
          low_confidence_fields: strArr_(),
          fields: {
            type: 'object',
            additionalProperties: false,
            required: ['name_zh', 'name_en', 'title_zh', 'title_en', 'department',
              'company_zh', 'company_en', 'company_short', 'mobiles', 'phones', 'faxes',
              'emails', 'website', 'address_zh', 'address_en', 'line_id', 'linkedin', 'other_social'],
            properties: {
              name_zh: strProp_(), name_en: strProp_(),
              title_zh: strProp_(), title_en: strProp_(),
              department: strProp_(),
              company_zh: strProp_(), company_en: strProp_(), company_short: strProp_(),
              mobiles: strArr_(),
              phones: {
                type: 'array',
                items: {
                  type: 'object', additionalProperties: false, required: ['number', 'ext'],
                  properties: { number: strProp_(), ext: strProp_() }
                }
              },
              faxes: strArr_(),
              emails: strArr_(),
              website: strProp_(),
              address_zh: strProp_(), address_en: strProp_(),
              line_id: strProp_(), linkedin: strProp_(),
              other_social: strArr_()
            }
          }
        }
      }
    }
  }
};

/** 用函式回傳，避免 GAS 檔案載入順序影響。 */
function getProviders_() {
  return {
    claude: { build: buildClaudeRequest_, parse: parseClaudeResponse_ },
    gemini: { build: buildGeminiRequest_, parse: parseGeminiResponse_ }
  };
}

function handleRecognize(req) {
  var image = req.image || {};
  if (!image.base64 || !/^image\/(jpeg|png|webp)$/.test(image.mime || '')) {
    throw new AppError('BAD_REQUEST', '缺少圖片或圖片格式不支援');
  }
  var props = PropertiesService.getScriptProperties();
  var PROVIDERS = getProviders_();
  var provider = req.provider || props.getProperty('DEFAULT_PROVIDER') || 'claude';
  var opts = { claudeEffort: ['low', 'medium', 'high'].indexOf(req.claudeEffort) >= 0 ? req.claudeEffort : null };
  var prompt = PROMPT_V1 + (req.side === 'back' ? BACK_SIDE_SUFFIX : '');
  var photoBytes = Math.floor(image.base64.length * 3 / 4);

  if (provider === 'compare') {
    var names = ['claude', 'gemini'];
    var groupId = Utilities.getUuid();
    var started = Date.now();
    var results = {};
    var ready = [];
    var requests = [];
    names.forEach(function (n) {
      try {
        requests.push(PROVIDERS[n].build(props, image, prompt, opts));
        ready.push(n);
      } catch (err) {
        results[n] = { error: { code: err.code || 'INTERNAL', message: err.message || '辨識失敗' } };
      }
    });
    var responses = requests.length ? UrlFetchApp.fetchAll(requests) : [];
    var latency = Date.now() - started;
    ready.forEach(function (n, i) {
      try {
        results[n] = finishResult_(n, PROVIDERS[n].parse(responses[i]), latency, photoBytes, groupId, props);
      } catch (err) {
        logRecognition_(n, '', photoBytes, 0, latency, null, 'error', err.code || 'INTERNAL', groupId);
        results[n] = { error: { code: err.code || 'INTERNAL', message: err.message || '辨識失敗' } };
      }
    });
    return { results: results, compareGroupId: groupId };
  }

  var p = Object.prototype.hasOwnProperty.call(PROVIDERS, provider) ? PROVIDERS[provider] : null;
  if (!p) throw new AppError('BAD_REQUEST', '不支援的辨識引擎：' + provider);
  var t0 = Date.now();
  var parsed;
  try {
    var request = p.build(props, image, prompt, opts);
    parsed = p.parse(UrlFetchApp.fetch(request.url, request));
  } catch (err) {
    logRecognition_(provider, '', photoBytes, 0, Date.now() - t0, null, 'error', err.code || 'INTERNAL', '');
    throw err;
  }
  return finishResult_(provider, parsed, Date.now() - t0, photoBytes, '', props);
}

function finishResult_(provider, parsed, latencyMs, photoBytes, groupId, props) {
  var cards = normalizeRecognition(parsed.output);
  var cost = estimateCost_(provider, parsed.usage, props);
  logRecognition_(provider, parsed.model, photoBytes, cards.length, latencyMs, parsed.usage, 'ok', '', groupId, cost);
  return {
    provider: provider,
    model: parsed.model,
    promptVersion: PROMPT_VERSION,
    latencyMs: latencyMs,
    usage: { inputTokens: parsed.usage.input, outputTokens: parsed.usage.output, estCostUsd: cost },
    cards: cards,
    warnings: []
  };
}

function estimateCost_(provider, usage, props) {
  var key = provider === 'claude' ? 'CLAUDE' : 'GEMINI';
  var pin = Number(props.getProperty('PRICE_' + key + '_IN') || 0);
  var pout = Number(props.getProperty('PRICE_' + key + '_OUT') || 0);
  return Math.round(((usage.input * pin + usage.output * pout) / 1e6) * 1e6) / 1e6;
}

function logRecognition_(provider, model, photoBytes, cards, latency, usage, status, errorCode, groupId, cost) {
  try {
    var sh = openDb_().getSheetByName('RecognitionLog');
    if (!sh) return;
    sh.appendRow([
      new Date(), provider, model || '', photoBytes, cards, latency,
      usage ? usage.input : '', usage ? usage.output : '', cost || '', status, errorCode || '', groupId || ''
    ]);
  } catch (e) { /* 記錄失敗不影響主流程 */ }
}

// ===== setup.js =====
/**
 * 一次性建立試算表與 Drive 資料夾結構（docs/03-資料模型.md）。
 * 重複執行不會重複建立；缺少的工作表或欄位會補上。
 */

var SHEET_SCHEMAS = {
  Contacts: [
    ['id', 'ID'], ['name_zh', '中文姓名'], ['name_en', '英文姓名'],
    ['title_zh', '中文職稱'], ['title_en', '英文職稱'], ['department', '部門'],
    ['company_zh', '公司中文全名'], ['company_en', '公司英文全名'], ['company_short', '公司簡稱'],
    ['mobile', '手機'], ['phone', '市話'], ['phone_ext', '分機'], ['fax', '傳真'],
    ['email', 'Email'], ['website', '網址'], ['address_zh', '中文地址'], ['address_en', '英文地址'],
    ['line_id', 'LINE ID'], ['linkedin', 'LinkedIn'], ['other_social', '其他社群'],
    ['tags', '標籤'], ['event', '場合'], ['met_date', '取得日期'], ['notes', '備註'],
    ['front_image_id', '正面圖 Drive ID'], ['back_image_id', '背面圖 Drive ID'],
    ['source_photo_id', '原始照片 Drive ID'], ['card_history', '歷次名片圖'],
    ['ai_provider', '辨識引擎'], ['ai_model', '辨識模型'], ['verified', '已人工確認'],
    ['created_at', '建立時間'], ['updated_at', '更新時間'], ['deleted', '已刪除']
  ],
  TitleHistory: [
    ['id', 'ID'], ['contact_id', '聯絡人 ID'], ['company_zh', '當時公司中文'],
    ['company_en', '當時公司英文'], ['company_short', '當時公司簡稱'], ['department', '當時部門'],
    ['title_zh', '當時中文職稱'], ['title_en', '當時英文職稱'], ['valid_until', '記錄至'],
    ['first_seen', '首次取得'], ['card_image_id', '當時名片圖'], ['recorded_at', '寫入時間']
  ],
  RecognitionLog: [
    ['ts', '時間'], ['provider', '引擎'], ['model', '模型'], ['photo_bytes', '照片大小'],
    ['cards_detected', '偵測張數'], ['latency_ms', '耗時毫秒'], ['input_tokens', '輸入 tokens'],
    ['output_tokens', '輸出 tokens'], ['est_cost_usd', '估計費用 USD'], ['status', '狀態'],
    ['error_code', '錯誤代碼'], ['compare_group_id', '比較群組']
  ],
  Log: [['ts', '時間'], ['level', '等級'], ['where', '位置'], ['detail', '內容']]
};

var HEADER_ROWS = 2;

/**
 * 在「綁定試算表的 Apps Script」中執行（擴充功能 → Apps Script）。
 * 只使用這份試算表（spreadsheets.currentonly）與程式自己建立的 Drive 資料夾（drive.file）。
 */
function setup() {
  var props = PropertiesService.getScriptProperties();

  var ss = openDb_();
  ss.setSpreadsheetTimeZone('Asia/Taipei');
  Object.keys(SHEET_SCHEMAS).forEach(function (name) {
    ensureSheet_(ss, name, SHEET_SCHEMAS[name]);
  });
  var defaultSheet = ss.getSheetByName('工作表1') || ss.getSheetByName('Sheet1');
  if (defaultSheet && ss.getSheets().length > 1) ss.deleteSheet(defaultSheet);

  var root = getOrCreateRootFolder_(props);
  ['cards', 'photos', 'backup'].forEach(function (n) { driveChildFolder_(root, n); });

  Logger.log('完成。試算表：' + ss.getUrl());
  Logger.log('Drive 資料夾：https://drive.google.com/drive/folders/' + root);
}

function ensureSheet_(ss, name, schema) {
  var sh = ss.getSheetByName(name) || ss.insertSheet(name);
  var codes = schema.map(function (c) { return c[0]; });
  var labels = schema.map(function (c) { return c[1]; });
  var lastCol = sh.getLastColumn();
  var existing = lastCol > 0 ? sh.getRange(1, 1, 1, lastCol).getValues()[0] : [];
  if (existing.length === 0 || existing[0] === '') {
    sh.getRange(1, 1, 2, codes.length).setValues([codes, labels]);
  } else {
    // 補上缺少的欄位（附加在最右邊，不移動既有欄位）
    codes.forEach(function (code, i) {
      if (existing.indexOf(code) < 0) {
        var col = sh.getLastColumn() + 1;
        sh.getRange(1, col, 2, 1).setValues([[code], [labels[i]]]);
      }
    });
  }
  sh.setFrozenRows(HEADER_ROWS);
  sh.getRange(1, 1, 1, sh.getLastColumn()).setFontColor('#999999').setFontSize(8);
  sh.getRange(2, 1, 1, sh.getLastColumn()).setFontWeight('bold').setBackground('#eef3f8');
}

/** 名片夾根資料夾（由程式建立，drive.file 才能存取）。 */
function getOrCreateRootFolder_(props) {
  var id = props.getProperty('DRIVE_FOLDER_ID');
  if (id && driveGet_(id)) return id;
  var folder = driveCreateFolder_('名片夾', null);
  props.setProperty('DRIVE_FOLDER_ID', folder);
  return folder;
}

/**
 * 簡單觸發器：在試算表手動編輯時自動執行，不需要額外授權。
 */
function onEdit(e) {
  onContactsEdit(e);
}

/** Contacts 被手動編輯時更新 updated_at（docs/01 F4.4）。 */
function onContactsEdit(e) {
  var sh = e.range.getSheet();
  if (sh.getName() !== 'Contacts' || e.range.getRow() <= HEADER_ROWS) return;
  var codes = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  var col = codes.indexOf('updated_at') + 1;
  if (col <= 0) return;
  // 編輯的就是 updated_at 本身時不處理，避免迴圈
  if (e.range.getColumn() <= col && col <= e.range.getLastColumn()) return;
  var now = Utilities.formatDate(new Date(), 'Asia/Taipei', "yyyy-MM-dd'T'HH:mm:ss'+08:00'");
  var rows = e.range.getNumRows();
  var values = [];
  for (var i = 0; i < rows; i++) values.push([now]);
  sh.getRange(e.range.getRow(), col, rows, 1).setValues(values);
}

// ===== store_drive.js =====
/**
 * Google Drive 圖檔存取（docs/03 §6）。透過 drive_api.js，只用 drive.file 權限。
 */

function rootFolderId_() {
  var id = PropertiesService.getScriptProperties().getProperty('DRIVE_FOLDER_ID');
  if (!id) throw new AppError('INTERNAL', '尚未執行 setup()，找不到 Drive 資料夾');
  return id;
}

/** 存到 名片夾/<kind>/yyyy/MM/<name>，回傳檔案 ID。 */
function saveImage_(img, kind, name) {
  if (!img || !img.base64) throw new AppError('BAD_REQUEST', '缺少圖片');
  var mime = /^image\/(jpeg|png|webp)$/.test(img.mime || '') ? img.mime : 'image/jpeg';
  var now = new Date();
  var folder = driveChildFolder_(
    driveChildFolder_(driveChildFolder_(rootFolderId_(), kind), Utilities.formatDate(now, 'Asia/Taipei', 'yyyy')),
    Utilities.formatDate(now, 'Asia/Taipei', 'MM')
  );
  return driveUpload_(folder, name, mime, Utilities.base64Decode(img.base64));
}

function stamp_() {
  return Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyyMMddHHmmss');
}

/** 檔案是否位於根資料夾底下（防止讀取其他 Drive 檔案）。 */
function isUnderRoot_(file) {
  var rootId = rootFolderId_();
  var queue = (file.parents || []).slice();
  for (var depth = 0; queue.length && depth < 6; depth++) {
    var next = [];
    for (var i = 0; i < queue.length; i++) {
      if (queue[i] === rootId) return true;
      var p = driveGet_(queue[i]);
      if (p && p.parents) next = next.concat(p.parents);
    }
    queue = next;
  }
  return false;
}

function trashFiles_(ids) {
  ids.forEach(function (id) {
    try { driveTrash_(id); } catch (e) { /* 已不存在 */ }
  });
}

function handleGetImage(req) {
  var file = null;
  try { file = driveGet_(String(req.fileId || '')); } catch (e) { file = null; }
  if (!file || file.mimeType === FOLDER_MIME_ || !isUnderRoot_(file)) throw new AppError('NOT_FOUND', '找不到圖片');
  if (req.size === 'thumb' && file.thumbnailLink) {
    try {
      var t = UrlFetchApp.fetch(file.thumbnailLink, {
        headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }, muteHttpExceptions: true
      });
      if (t.getResponseCode() === 200) {
        var tb = t.getBlob();
        return { mime: tb.getContentType() || 'image/png', base64: Utilities.base64Encode(tb.getBytes()) };
      }
    } catch (e) { /* 縮圖尚未產生，改回傳原圖 */ }
  }
  var blob = driveDownload_(file.id);
  if (!blob) throw new AppError('NOT_FOUND', '找不到圖片');
  return { mime: blob.getContentType() || 'image/jpeg', base64: Utilities.base64Encode(blob.getBytes()) };
}

// ===== store_sheets.js =====
/**
 * Google Sheets 存取。第 1 列欄位代碼、第 2 列中文標題、第 3 列起資料（docs/03）。
 */

var DATA_START_ROW = 3;

/** 資料庫就是這個 Apps Script 綁定的試算表（spreadsheets.currentonly）。 */
function openDb_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new AppError('INTERNAL', '後端程式必須從試算表的「擴充功能 → Apps Script」建立');
  return ss;
}

function sheet_(name) {
  var sh = openDb_().getSheetByName(name);
  if (!sh) throw new AppError('INTERNAL', '找不到工作表：' + name);
  return sh;
}

function cellToString_(v) {
  if (v instanceof Date) {
    return Utilities.formatDate(v, 'Asia/Taipei', "yyyy-MM-dd'T'HH:mm:ss'+08:00'");
  }
  if (v === null || v === undefined) return '';
  return v;
}

/** 讀整張表：回傳欄位代碼與物件列（附 _row 列號）。 */
function readTable_(sh) {
  var lastCol = sh.getLastColumn();
  var lastRow = sh.getLastRow();
  var codes = lastCol ? sh.getRange(1, 1, 1, lastCol).getValues()[0].map(String) : [];
  var rows = [];
  if (lastRow >= DATA_START_ROW) {
    var values = sh.getRange(DATA_START_ROW, 1, lastRow - DATA_START_ROW + 1, lastCol).getValues();
    values.forEach(function (vals, i) {
      if (vals.every(function (v) { return v === '' || v === null; })) return;
      var o = { _row: DATA_START_ROW + i };
      codes.forEach(function (c, j) { if (c) o[c] = cellToString_(vals[j]); });
      rows.push(o);
    });
  }
  return { codes: codes, rows: rows };
}

function toRowValues_(codes, obj) {
  return codes.map(function (c) {
    var v = obj[c];
    if (v === undefined || v === null) return '';
    if (v === true) return 'TRUE';
    if (v === false) return 'FALSE';
    return String(v);
  });
}

/**
 * 寫入一列。先把該列設為純文字格式，避免 +886… 被當成數字、日期被自動轉換。
 */
function setRowText_(sh, row, codes, obj) {
  if (row > sh.getMaxRows()) sh.insertRowsAfter(sh.getMaxRows(), 100);
  var range = sh.getRange(row, 1, 1, codes.length);
  range.setNumberFormat('@');
  range.setValues([toRowValues_(codes, obj)]);
}

function appendObject_(sh, codes, obj) {
  var row = Math.max(sh.getLastRow() + 1, DATA_START_ROW);
  setRowText_(sh, row, codes, obj);
  return row;
}

function writeObject_(sh, codes, row, obj) {
  setRowText_(sh, row, codes, obj);
}

function stripInternal_(o) {
  var out = {};
  Object.keys(o).forEach(function (k) { if (k.charAt(0) !== '_') out[k] = o[k]; });
  out.verified = o.verified === true || o.verified === 'TRUE' || o.verified === 'true';
  out.deleted = o.deleted === true || o.deleted === 'TRUE' || o.deleted === 'true';
  return out;
}

function nowIso_() {
  return Utilities.formatDate(new Date(), 'Asia/Taipei', "yyyy-MM-dd'T'HH:mm:ss'+08:00'");
}

function todayTaipei_() {
  return Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyy-MM-dd');
}

function newId_(prefix) {
  var rand = Utilities.getUuid().replace(/-/g, '').slice(0, 6);
  return prefix + '_' + Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyyMMdd') + '_' + rand;
}

function withLock_(fn) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) throw new AppError('INTERNAL', '系統忙碌中，請稍後再試');
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}
