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
