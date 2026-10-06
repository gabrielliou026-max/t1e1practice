# 設定流程檢查紀錄

依 Cisco 語音閘道的標準設定觀念（CCNA Voice／Collaboration，CVOICE）檢查補充文件 01（CN to FIT50, T1-CAS）、02（CN to FIT50, T1-CCS）與練習器的設定流程。

- 檢查日期：2026-10-06
- 狀態：**只做紀錄，文件與模擬器都還沒修改**

## 一、文件與設定流程本身（實機也適用）

### 可能直接打不通，建議優先確認

| # | 項目 | 說明 | 建議 |
|---|---|---|---|
| 1 | SIP 沒有綁定 Loopback0 | SIGMA trunk 指向 Loopback0，但文件沒有綁定 SIP 來源介面。沒有綁定時 SIP／RTP 會用實體介面 IP 送出，SIGMA 可能因來源不符而拒絕，或單向無聲。 | `voice service voip` → `sip` → `bind control source-interface Loopback0`、`bind media source-interface Loopback0`。若現場已設定，文件註明即可。 |
| 2 | Loopback0 要有路由 | SIGMA 要連得到 3.x.x.2，Loopback 要被宣告出去。 | 例如 Loopback0 下 `ip ospf 1 area 0`。最早的模擬器設定有這行，改成學生自己設定 Loopback 時被拿掉了。 |
| 3 | CCS 的 switch-type 用 primary-net5 | NET5 是歐規 E1（ETSI）。T1 PRI 接 PBX 常見的是 `primary-ni`、`primary-5ess`、`primary-dms100` 或 `primary-qsig`。 | 確認 FIT-50 端實際設定，兩邊不一致 Layer 2 不會起來。 |
| 4 | ISDN 主從關係只寫觀念 | 文件寫「預設為從（user 端）」，但沒給指令。若 FIT-50 也是 user 端，Layer 2 起不來。 | 文件補上 `isdn protocol-emulate network`，作為 Layer 2 起不來時的排查步驟。 |

### 不會讓通話失敗，但不符合標準做法

| # | 項目 | 說明 | 建議 |
|---|---|---|---|
| 5 | dial-peer 100 用 `.T` | CAS 逐位收號，`.T` 會等數字間隔逾時（預設 10 秒）才送出，撥號後延遲明顯；而且什麼號碼都吃，SIGMA 送來沒有對應的號碼時會被送回 SIGMA，形成迴圈。 | 改成明確 pattern，例如 SIGMA 內線用 `3602..`。 |
| 6 | D 通道 `encapsulation ppp` | 語音 PRI 的 D 通道用預設 HDLC 即可，PPP 是 ISDN 數據撥接用的。設了不會壞。 | 可從文件拿掉，或註明非必要。 |
| 7 | PRI 來電沒有 inbound dial-peer | 標準做法是建 `incoming called-number .` 加 `direct-inward-dial` 的 POTS dial-peer，否則落到預設 dial-peer 0，參數不可控。中華電信 PRI 練習同樣適用。 | 文件與練習補上 inbound dial-peer。 |
| 8 | `compand-type u-law` 是預設值 | T1 語音埠預設就是 u-law。 | 可保留，用來教 G.711 a-law／u-law 要與對端一致。 |
| 9 | 文件錯字 | 02 步驟 1 `isdn switch-type primary-net`（沒寫完，IOS 會當縮寫接受）；步驟 3 `pri-group timelots`（應為 timeslots，會報錯）。 | 修正文件。 |

## 二、模擬器與實機不一樣的地方

| # | 項目 | 說明 | 建議 |
|---|---|---|---|
| 10 | ISDN 來電誤報 `.T` 延遲 | CCS 的 FIT-50 來電也顯示「`.T` 會等逾時」。ISDN SETUP 一次帶完整號碼，不會等逾時。**這是 bug。** | 提示只在 CAS 顯示（`fit50-lab.html` 的 `simB`）。 |
| 11 | 拆 pri-group 前要先 shutdown voice-port | 比照文件 02 拆 ds0-group 的步驟自訂的規則，無法確認實機拆 pri-group 是否有同樣要求。 | 確認實機行為後決定保留或放寬。 |
| 12 | 拆語音埠時自動清掉 dial-peer 的 port | 簡化行為，不同 IOS 版本可能會擋下來要求先移除。 | 拆除流程改成先在 dial-peer 900 下 `no port`，各版本都適用。 |
| 13 | 沒有模擬 SIP 綁定與 Loopback 路由 | 即第 1、2 點，學生練不到。 | 加入任務與檢查。 |

## 待決定

- 第 1、2 點：確認現場設備是否已設定，再決定寫進文件或加入練習。
- 第 3、4 點：與 FIT-50 端設定確認。
- 模擬器修改（第 10–13 點，以及 5、6、7 的練習調整）：等確認後再做。
