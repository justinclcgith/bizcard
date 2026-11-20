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
