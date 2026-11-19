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
  try { SpreadsheetApp.openById(props.getProperty('SHEET_ID')); sheetOk = true; } catch (e) { /* 未設定 */ }
  try { DriveApp.getFolderById(props.getProperty('DRIVE_FOLDER_ID')); driveOk = true; } catch (e) { /* 未設定 */ }
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
    var id = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
    if (!id) return;
    var sh = SpreadsheetApp.openById(id).getSheetByName('Log');
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
 * 再到手機設定頁按「從剪貼簿貼上設定」。需先完成「網頁應用程式」部署。
 */
function showSetupInfo() {
  var url = ScriptApp.getService().getUrl();
  var token = PropertiesService.getScriptProperties().getProperty('APP_TOKEN');
  if (!url) throw new Error('尚未部署為網頁應用程式');
  if (!token) throw new Error('尚未設定 APP_TOKEN');
  var payload = JSON.stringify({ url: url, token: token });
  Logger.log('手機設定（請勿貼到公開的地方）：' + payload);
  return payload;
}
