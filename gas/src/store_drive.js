/**
 * Google Drive 圖檔存取（docs/03 §6）。
 */

function rootFolder_() {
  var id = PropertiesService.getScriptProperties().getProperty('DRIVE_FOLDER_ID');
  if (!id) throw new AppError('INTERNAL', '尚未執行 setup()，找不到 Drive 資料夾');
  return DriveApp.getFolderById(id);
}

function childFolder_(parent, name) {
  var it = parent.getFoldersByName(name);
  return it.hasNext() ? it.next() : parent.createFolder(name);
}

/** 存到 名片夾/<kind>/yyyy/MM/<name>，回傳檔案 ID。 */
function saveImage_(img, kind, name) {
  if (!img || !img.base64) throw new AppError('BAD_REQUEST', '缺少圖片');
  var mime = /^image\/(jpeg|png|webp)$/.test(img.mime || '') ? img.mime : 'image/jpeg';
  var now = new Date();
  var folder = childFolder_(
    childFolder_(childFolder_(rootFolder_(), kind), Utilities.formatDate(now, 'Asia/Taipei', 'yyyy')),
    Utilities.formatDate(now, 'Asia/Taipei', 'MM')
  );
  var blob = Utilities.newBlob(Utilities.base64Decode(img.base64), mime, name);
  return folder.createFile(blob).getId();
}

function stamp_() {
  return Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyyMMddHHmmss');
}

/** 檔案是否位於根資料夾底下（防止讀取其他 Drive 檔案）。 */
function isUnderRoot_(file) {
  var rootId = rootFolder_().getId();
  var queue = [];
  var parents = file.getParents();
  while (parents.hasNext()) queue.push(parents.next());
  var depth = 0;
  while (queue.length && depth < 6) {
    var next = [];
    for (var i = 0; i < queue.length; i++) {
      if (queue[i].getId() === rootId) return true;
      var p = queue[i].getParents();
      while (p.hasNext()) next.push(p.next());
    }
    queue = next;
    depth++;
  }
  return false;
}

function trashFiles_(ids) {
  ids.forEach(function (id) {
    try { DriveApp.getFileById(id).setTrashed(true); } catch (e) { /* 已不存在 */ }
  });
}

function handleGetImage(req) {
  var file;
  try {
    file = DriveApp.getFileById(String(req.fileId || ''));
  } catch (e) {
    throw new AppError('NOT_FOUND', '找不到圖片');
  }
  if (!isUnderRoot_(file)) throw new AppError('NOT_FOUND', '找不到圖片');
  if (req.size === 'thumb') {
    try {
      var thumb = file.getThumbnail();
      if (thumb) return { mime: thumb.getContentType() || 'image/png', base64: Utilities.base64Encode(thumb.getBytes()) };
    } catch (e) { /* 縮圖尚未產生，改回傳原圖 */ }
  }
  var blob = file.getBlob();
  return { mime: blob.getContentType(), base64: Utilities.base64Encode(blob.getBytes()) };
}
