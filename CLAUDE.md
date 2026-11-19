# CLAUDE.md — 個人名片管理系統

## 專案概要
個人用名片管理 PWA。前端在 `app/`（Vite + TypeScript + Preact，部署到 GitHub Pages），後端在 `gas/`（Google Apps Script，部署到 JC 個人 Google 帳號的 Web App）。AI 辨識由 GAS 呼叫 Claude 或 Gemini。完整規格在 `docs/`，動手前先讀 `docs/02-架構設計.md` 與當前階段的 `docs/06-開發任務.md`。

## 絕對規則
1. **這是公開 repo。** 不得提交任何金鑰、GAS 部署網址、存取權杖、真實名片圖片或真實聯絡人資料。測試圖片放 `testdata/`（已列入 `.gitignore`），或由 JC 在 Drive 提供。
2. AI 金鑰只存在 GAS 的 Script Properties，前端永遠不直接呼叫 AI 服務。
3. 介面文字、錯誤訊息、文件一律使用**繁體中文（台灣用語）**；程式碼識別名稱用英文。
4. 辨識結果不得把繁體轉成簡體，也不得自行翻譯名片上的文字。
5. 不新增 `docs/` 沒寫到的功能；需求有疑問時在 PR 說明中列出，不要自行假設成定案。
6. 變更資料模型（Sheets 欄位、API 格式）時，同步更新 `docs/03-資料模型.md` 或 `docs/04-API規格.md`。

## 目標裝置
主要裝置是 Pixel 8 + Android Chrome。UI 以 412×915 CSS px 直向為基準設計，觸控目標至少 44px。

## 常用指令
```bash
cd app && npm ci           # 安裝
npm run dev                # 本機開發（需 .env.local 的 VITE_DEFAULT_GAS_URL 可留空，於設定頁輸入）
npm test                   # Vitest 單元測試
npm run build              # 產出 dist/
npm run lint && npm run typecheck
cd gas && npx clasp push   # 推送後端（需 JC 已 clasp login，見 docs/08）
node tools/eval/run.mjs    # 驗收用辨識評測（見 docs/07）
```

## 程式風格
- TypeScript strict；不使用 any（外部 JSON 先經驗證函式）。
- 純邏輯（正規化、比對重複、裁切座標換算、vCard 以外的格式化）放 `app/src/lib/` 並寫單元測試。
- GAS 程式碼為 V8 runtime 的純 JavaScript，檔案依職責拆分（見 docs/02 的 repo 結構）；GAS 端純函式放 `gas/src/lib_*.js` 並能在 Node 下以 Vitest 測試。
- 每個階段一個分支與 PR，PR 說明列出：完成的任務編號、測試結果、待 JC 確認事項。

## 完成定義
任務的「完成條件」全部達成、`npm test` / `lint` / `typecheck` 通過、相關文件已更新。
