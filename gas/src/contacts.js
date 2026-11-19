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
