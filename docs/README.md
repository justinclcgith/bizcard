# 個人名片管理系統（名片夾 PWA）— 開發文件包

版本：v1.0（2026-11-19）　擁有者：JC　狀態：待 JC 確認

這個資料夾是交給 Claude Code 開發用的完整文件包。開新 repo 後，把整個資料夾內容複製到 repo 根目錄即可開工（`CLAUDE.md` 放 repo 根目錄，`docs/` 原樣保留）。

## 一句話說明

在 Pixel 8 的 Chrome 上安裝成 App 的 PWA：拍照或載入圖片，雲端 AI（Claude / Gemini 可切換）一次辨識單張或多張名片並回傳位置框，手機裁出單張圖讓使用者確認後，由 Google Apps Script 後端寫入個人 Google 帳號的 Sheets（資料）與 Drive（圖檔）。

## 文件清單

| 檔案 | 內容 |
|---|---|
| `CLAUDE.md` | 給 Claude Code 的工作守則（放 repo 根目錄） |
| `docs/00-決議紀錄.md` | 規劃階段 JC 做過的所有決議與理由 |
| `docs/01-需求規格.md` | 使用情境、功能需求、非功能需求、範圍外項目 |
| `docs/02-架構設計.md` | 系統元件、資料流、安全設計、技術選型、repo 結構 |
| `docs/03-資料模型.md` | Google Sheets 工作表與欄位定義、Drive 資料夾結構、IndexedDB |
| `docs/04-API規格.md` | PWA ↔ GAS 後端的所有動作與 JSON 格式 |
| `docs/05-AI辨識設計.md` | 提示詞、輸出 JSON Schema、Claude 與 Gemini 呼叫方式、正規化規則 |
| `docs/06-開發任務.md` | 分階段任務清單（P0–P7），每項附完成條件 |
| `docs/07-驗收標準.md` | 驗收測試集、量化指標、測試步驟與報告格式 |
| `docs/08-部署與設定.md` | JC 需要親自做的帳號、金鑰、部署步驟 |
