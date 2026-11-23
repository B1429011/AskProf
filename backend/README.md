# AskProf 正式 AI 後端

GitHub Pages 只能提供靜態檔案，不能安全保存 LLM API Key。因此正式版的學習分析必須由這個後端代理呼叫長庚 CGU LLM Gateway；瀏覽器只會收到分析結果。

## 啟動

在專案根目錄設定環境變數後執行：

```powershell
$env:CGU_API_KEY = "你的長庚 LLM Gateway API Key"
$env:CGU_MODEL = "gpt-5.6-luna"
$env:ASKPROF_ALLOWED_ORIGIN = "http://localhost:8787"
node backend/server.mjs
```

開啟 `http://localhost:8787/`，即可同時使用網站與 `/api/analyze-learning`。正式部署時請把 `CGU_API_KEY` 設為雲端平台的 secret，不能寫入前端、GitHub repository 或截圖。

可用 `CGU_MODEL` 依 Gateway `/v1/models` 回傳的模型清單調整。後端會限制請求大小、欄位長度與每個來源的請求頻率，並要求模型回傳固定 JSON 格式。
