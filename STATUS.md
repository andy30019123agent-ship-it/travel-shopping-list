# STATUS — 免稅不是免費（出國購物清單 App）

> 最後更新：2026-06-20（台北）｜ 啟動觸發語：**「繼續購物清單 App 專案」**（資料夾 travel-shopping-list）

## 現況（一句話）
日本/韓國出國購物清單＋比價 App（Expo），真實價格、AI 翻譯、拍照辨識、熱門品、購物點地圖都已上線，功能相當完整。

## 上次做到哪
- 清單（待買/記帳雙分頁）、勾選已買、台幣加總、本機儲存。
- 真實比價：日本=前端直連樂天、韓國=Cloudflare Worker 查 Naver；AI 翻譯（中→日/韓）。
- 拍照「AI 產品辨識」（gpt-4.1-nano）＋識物卡（客觀資訊/主打效果分層+免責）。
- 熱門必買（KV 動態＋每週 AI 候選＋手機後台 Alpine.js）、品牌目錄 A-Z。
- 購物點地圖（Google/Naver Places）、預算進度、計算機。

## 下一步（1–3 件）
1. Andy 持續試用 → 滿意後打包成 iOS App 上架（需 Apple Developer US$99/年，簽名審核要本人操作）。
2. （可選）每週自動更新熱門若要真正無人值守 → 改 Cloudflare Worker Cron。
3. 冷門品牌翻錯時靠使用者改搜尋字（已知限制）。

## 怎麼啟動 / 在哪
- 資料夾：`~/Desktop/agent/travel-shopping-list/`；repo 同名；後端 Worker 在 `worker/`（menshui-price.andy30019123agent.workers.dev）。
- 線上預覽：https://andy30019123agent-ship-it.github.io/travel-shopping-list/
- 金鑰：全在 Cloudflare Secret（樂天/Naver/OpenAI/Google Maps/ADMIN_TOKEN），不入版控。
- 部署：Expo web export → `pwa-postbuild.sh` → `npx gh-pages -d dist --dotfiles`（注意 `.nojekyll`、baseUrl）。
- 詳細脈絡與大量踩雷紀錄：專案記憶 `project_travel_shopping_list.md`。
