# 學習導航｜師生協作平台

這是 Codex 跨域創造黑客松的可操作網站原型，整合：

- 專輔預約、取消與提醒
- 教授探索與可預約時段
- 每學年系必修／系選修課表
- 個人已修、進行中與未修狀態
- 教授端新增、暫停與重新開放時段

## 本機預覽

```text
cd app
node server.mjs
```

開啟 `http://127.0.0.1:4173/`。

## GitHub Pages

此專案已附上 GitHub Actions 工作流程。將專案推到 GitHub 的 `main` 分支後，GitHub Actions 會自動把 `app/` 發佈成網站。

目前使用示範資料與瀏覽器 localStorage；正式版可再接校務系統、登入、資料庫、Email 與 Google Calendar。
