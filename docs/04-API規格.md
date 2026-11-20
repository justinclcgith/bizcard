# 04 API 規格（PWA ↔ GAS）

- 端點：GAS Web App 部署網址（個人帳號 `https://script.google.com/macros/s/<DEPLOYMENT_ID>/exec`；Google Workspace 帳號 `https://script.google.com/a/<網域>/macros/s/<DEPLOYMENT_ID>/exec`）
- 方法：`POST`，標頭 `Content-Type: text/plain;charset=utf-8`，body 為 JSON 字串。
- 共通請求欄位：`{ "token": "<APP_TOKEN>", "action": "<動作>", "requestId": "<uuid>", ...參數 }`
- 共通回應：`{ "ok": true, "data": {...} }` 或 `{ "ok": false, "error": { "code": "...", "message": "繁中說明" } }`
- 錯誤代碼：`UNAUTHORIZED`、`RATE_LIMITED`、`BAD_REQUEST`、`NOT_FOUND`、`AI_ERROR`、`AI_REFUSED`、`AI_TIMEOUT`、`CONFLICT`、`INTERNAL`

## ping
請求：`{}` → 回應：`{ version, sheetOk, driveOk, providers: ["claude","gemini"], defaultProvider }`

## recognize
請求：
```json
{ "image": { "mime": "image/jpeg", "base64": "...", "width": 2400, "height": 1800 },
  "provider": "claude" | "gemini" | "compare",
  "side": "front" | "back",
  "hint": { "region": [x0,y0,x1,y1] },
  "claudeEffort": "low" | "medium" | "high" }
```
- `claudeEffort`（選用）：覆寫 Script Properties 的 `CLAUDE_EFFORT`，供驗收評測比較 effort 使用；其他值忽略。
- `hint.region`（選用，0–1000 正規化座標）：使用者手動新增框後只辨識該區域時使用；GAS 不裁切，改在提示詞中要求只辨識該區域（PWA 也可直接送裁好的圖，優先採用此做法）。

回應（`provider` 為單一家時）：
```json
{ "provider": "claude", "model": "claude-opus-5-5", "latencyMs": 8200,
  "usage": { "inputTokens": 1800, "outputTokens": 900, "estCostUsd": 0.025 },
  "cards": [ <CardResult>, ... ],
  "warnings": [] }
```
`provider: "compare"` 時：`{ "results": { "claude": {...同上}, "gemini": {...同上} }, "compareGroupId": "..." }`

`CardResult` 格式見 docs/05 §3（欄位、`bbox`、`confidence`、`lowConfidenceFields`、`orientation`）。

## findDuplicates
請求：`{ "cards": [ { "tempId": "t1", "fields": {...} } ] }`
回應：`{ "matches": [ { "tempId": "t1", "candidates": [ { "contactId", "score", "reasons": ["email"], "contact": {...} } ] } ] }`

## saveCards
請求：
```json
{ "sourcePhoto": { "mime": "image/jpeg", "base64": "..." },
  "batch": { "tags": ["展會"], "event": "BIO Asia 2026", "metDate": "2026-11-19" },
  "cards": [
    { "tempId": "t1",
      "fields": { ...Contacts 欄位（不含系統欄位）... },
      "front": { "mime": "image/jpeg", "base64": "..." },
      "back": null,
      "aiProvider": "claude", "aiModel": "claude-opus-5-5",
      "mergeIntoId": null } ] }
```
- `mergeIntoId` 有值時：更新該聯絡人，依 docs/03 §2 寫 TitleHistory，舊 `front_image_id` 移入 `card_history`；空白的新欄位不覆蓋舊值。
- 原子性：先存所有圖檔，再以 `LockService` 鎖定後一次寫入 Sheets；寫入失敗時刪除本次新建的圖檔並回傳錯誤。
- `requestId` 去重：同一 `requestId` 10 分鐘內重送，直接回傳上次結果（CacheService），避免網路重試造成重複資料。

回應：`{ "contacts": [ { "tempId", "contact": {...完整 Contacts 列...}, "merged": true|false } ] }`

## list
請求：`{ "since": "2026-11-01T00:00:00+08:00" | null }`
回應：`{ "contacts": [...], "serverTime": "..." }`（`since` 為 null 時回傳全部；含 `deleted=true` 列）

## getContact
請求：`{ "id": "c_..." }` → 回應：`{ "contact": {...}, "titleHistory": [...] }`

## updateContact
請求：`{ "id": "c_...", "fields": {...要改的欄位...}, "baseUpdatedAt": "..." }`
- 後端 `updated_at` 比 `baseUpdatedAt` 新時回傳 `CONFLICT` 與最新資料。
- 手動編輯職稱/公司時**不**自動寫 TitleHistory（視為修正錯字）；詳情頁另提供「記錄為職稱變動」勾選，勾選時才寫。請求加 `"recordTitleChange": true`。

回應：`{ "contact": {...} }`

## deleteContact
請求：`{ "id": "c_..." }` → 軟刪除，回應 `{ "contact": {...} }`

## getImage
請求：`{ "fileId": "...", "size": "thumb" | "full" }` → 回應：`{ "mime": "image/jpeg", "base64": "..." }`
- `thumb`：長邊 400px。檔案必須位於 `DRIVE_FOLDER_ID` 底下，否則 `NOT_FOUND`（防止被拿來讀取其他 Drive 檔案）。

## stats
請求：`{ "month": "2026-11" }` → 回應：`{ "recognitions": 42, "cards": 120, "estCostUsd": 2.1, "byProvider": {...} }`
