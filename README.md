# 語音介接 CLI 練習器

在瀏覽器裡練習 Cisco IOS 語音閘道器設定的模擬器，不需要安裝任何東西。

| 檔案 | 內容 |
|---|---|
| `index.html` | 首頁，連到兩個練習器 |
| `pri-cli-lab.html` | 中華電信 E1/T1 PRI 介接（LAB-RTR-A） |
| `fit50-cas-lab.html` | CN 與 FIT-50 介接，T1 CAS（LAB-RTR-B） |

## 使用方式

直接用瀏覽器開啟 `index.html`，或啟用 GitHub Pages 後從網址開啟。

- **Tab**：補齊指令，沒打字時列出可用指令
- **?**：列出可用參數
- **↑ ↓**：歷史指令；**Ctrl+Z**：回到特權模式
- 支援指令縮寫、`do`、`no`、`| include`、`| section`

重新整理頁面會清空練習進度。

## 注意

告警、信令、debug 輸出與對端反應都是為了練習而簡化的模擬，不代表設備或電信業者的實際行為。實際介接以設備上的 `show`、`debug` 結果為準。
