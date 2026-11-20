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
