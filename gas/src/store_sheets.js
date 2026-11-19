/**
 * Google Sheets 存取。第 1 列欄位代碼、第 2 列中文標題、第 3 列起資料（docs/03）。
 */

var DATA_START_ROW = 3;

function openDb_() {
  var id = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
  if (!id) throw new AppError('INTERNAL', '尚未執行 setup()，找不到試算表');
  return SpreadsheetApp.openById(id);
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
