# Telegram 橋接 — Claude Code 遠端通知與任務派發

**日期：** 2026-06-07
**狀態：** 設計定案，待實作
**作者：** Peter + Claude (Opus 規劃)

---

## 1. 目標

讓 Peter 離開電腦時，能透過 Telegram：

1. **接收通知** — 在鍵盤前跑的 Claude Code 互動 session 跑完一回合（Stop）、或需要權限確認（Notification）時，主動推播到手機。
2. **派發新任務** — 在外面想到一件事，用 Telegram 傳一句話（例如「幫我看一下 quiz_engine 的弱概念排序邏輯」），電腦上的 Claude Code 以 headless 模式跑這個任務，完成後把結果回傳到手機。

這是 **Peter 個人的 Claude Code 工具**，與 AdaptLearn 競賽專案本身無關。因此程式碼放在 `~/.claude/telegram-bridge/`，不進 AdaptLearn repo。本設計文件進 git 僅作開發紀錄。

---

## 2. 範圍

### 包含
- 單向通知（Stop / Notification hook → Telegram）
- 雙向派發（Telegram 訊息 → headless `claude -p` → 結果回傳）
- 手動啟動的長輪詢 bot（先驗證流程，不做 launchd 常駐）

### 不包含（YAGNI / 賽後選配）
- 在「進行中的互動對話」插話續控（技術難度高，本期不做）
- launchd / 開機自動常駐（先手動 `python bot.py`，驗證可用再說）
- Webhook 模式（需公開 HTTPS 端點，筆電情境不務實）
- 多使用者 / 多 chat 支援（只服務 Peter 一個 chat_id）

---

## 3. 架構

位置：`~/.claude/telegram-bridge/`

```
~/.claude/telegram-bridge/
├── bot.py              # 長輪詢 + headless 任務派發
├── notify.sh           # curl 發 Telegram（給 hook 用）
├── .env                # TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID（gitignored）
├── .env.example        # 範本（可進 git）
├── .gitignore          # 排除 .env 與 state
├── state.json          # getUpdates offset 持久化（gitignored）
├── bot.log             # 執行日誌（gitignored）
└── README.md           # 建 bot、設定、啟動步驟
```

### 元件職責

| 元件 | 做什麼 | 怎麼用 | 依賴 |
|---|---|---|---|
| `bot.py` | 長輪詢 `getUpdates`；白名單過濾；spawn headless claude；結果回傳；併發保護 | `python bot.py` | `requests`（或 urllib 零依賴）、`.env`、`claude` CLI |
| `notify.sh` | 用 curl 打 `sendMessage`，發一則訊息到固定 chat | hook 自動呼叫，或手動 `notify.sh "訊息"` | curl、`.env` |
| `.env` | 存 token + chat_id | 兩個元件讀取 | — |

---

## 4. 資料流

### 4.1 通知流（單向）

```
互動 session 跑完一回合
   → Claude Code 觸發 Stop hook
   → ~/.claude/settings.json 設定的 hook 指令呼叫 notify.sh
   → notify.sh curl sendMessage
   → Peter 手機收到「✅ 任務完成，等你回覆」
```

Notification hook（需權限確認時）同理，訊息改為「⚠️ 需要你確認操作」。

### 4.2 派發流（雙向）

```
Peter 手機傳「幫我看 X」
   → Telegram 伺服器
   → bot.py getUpdates 收到
   → 檢查 chat_id 在白名單？否 → 記 log 並忽略
   → 檢查目前是否有任務在跑？是 → 回「⏳ 進行中，稍候」
   → spawn: claude -p "<訊息>" --allowedTools "Read Grep Glob Edit Write"
            （cwd = 設定的預設專案目錄；env 帶 TELEGRAM_BRIDGE_CHILD=1）
   → 等待（含 timeout）
   → 取 stdout，截斷/分段成 ≤4096 字
   → sendMessage 回傳結果
   → 更新 offset 到 state.json
```

---

## 5. 四個關鍵設計決策

### 5.1 遠端權限：可讀 + 可改檔，不開 Bash

headless `claude -p` 沒有互動式權限確認，所以必須事先用 `--allowedTools` 釘死能力範圍。

**決定：** `--allowedTools "Read Grep Glob Edit Write"`

- ✅ 手機能「幫我修這個 bug」「加個註解」並實際改程式碼
- ❌ 不能跑 Bash → 不能 `git push` / `rm` / 裝套件 / 任意執行
- 風險上限：token 外洩時，攻擊者最多能讀檔與改檔（cwd 限定的專案目錄內），無法執行任意指令

> 若日後想開放唯讀 Bash（git status / npm test），再加白名單，但本期不做。

### 5.2 重複通知去重

`claude -p` 子程序跑完時，**Stop hook 也會在子程序內觸發**，會呼叫 notify.sh 再發一則 → 與 bot.py 自己回傳的結果重複。

**決定：** bot.py spawn 子程序時帶環境變數 `TELEGRAM_BRIDGE_CHILD=1`。notify.sh 開頭檢查，若該變數存在就直接 exit 0（不發訊息）。如此子程序內的 hook 通知被抑制，只剩 bot.py 回傳一則。

### 5.3 併發保護

**決定：** bot.py 用單一旗標（in-flight boolean / 簡單鎖）確保一次只跑一個任務。任務進行中收到新訊息 → 回「⏳ 任務進行中，請稍候再傳」，不排隊、不併發 spawn。

### 5.4 雜項韌性

- **訊息長度：** Telegram 單則上限 4096 字。結果超過就截斷並標註「（已截斷，完整結果在電腦上）」；或分段發送（實作時取簡單者，先截斷）。
- **offset 持久化：** 每次處理完訊息把 `update_id + 1` 寫入 `state.json`，重啟不重跑舊訊息。
- **timeout：** headless 任務設上限（預設 300 秒，可設定）。超時 → kill 子程序，回「⏱ 任務逾時」。

---

## 6. 安全模型

| 威脅 | 緩解 |
|---|---|
| 陌生人對 bot 傳訊 | 只回應白名單 `TELEGRAM_CHAT_ID`；其餘記 log 後忽略 |
| Token 外洩 | `.env` gitignored，永不進任何 repo；外洩時能力受 `--allowedTools` 限制（不能執行指令） |
| 遠端破壞性操作 | 不開 Bash，無法 push / rm / 裝套件 |
| 子程序失控 | timeout + kill；cwd 限定單一專案目錄 |
| 日誌洩密 | bot.log gitignored |

**已知殘餘風險：** 在限定目錄內可讀取/修改檔案。Peter 已知情並接受（個人開發機）。

---

## 7. 設定步驟（README 內容大綱）

1. **建 bot：** Telegram 找 `@BotFather` → `/newbot` → 取得 Bot Token
2. **取 chat_id：** 對自己的 bot 傳任意訊息 → 開 `https://api.telegram.org/bot<TOKEN>/getUpdates` → 找 `chat.id`
3. **填 `.env`：** 複製 `.env.example` → 填入 token 與 chat_id
4. **設定預設專案目錄：** `.env` 加 `DEFAULT_PROJECT_DIR`（headless 任務的 cwd）
5. **掛 hook：** 編輯 `~/.claude/settings.json`，在 Stop / Notification 加 notify.sh
6. **啟動：** `cd ~/.claude/telegram-bridge && python bot.py`
7. **測試：** 手機傳「列出目前的 concepts 有哪些」驗證雙向流程

---

## 8. 實作注意事項

- **`claude` 是 alias：** 目前 `claude` 在 shell 是 `npx @anthropic-ai/claude-code` 的 alias，**非互動子程序讀不到 alias**。bot.py 必須用完整指令（`npx @anthropic-ai/claude-code -p ...`）或解析出實際 binary 路徑。實作時確認。
- **零外部依賴優先：** bot.py 可用標準庫 `urllib` 取代 `requests`，避免在 `~/.claude/` 額外裝套件；若用 `requests` 需註明安裝方式。
- **`.env` 讀取：** 簡單手寫 parser 或 `python-dotenv`；傾向手寫避免依賴。

---

## 9. 驗收標準

- [ ] 手機傳訊 → 電腦跑 headless claude → 結果回傳手機
- [ ] 非白名單 chat_id 的訊息被忽略且記 log
- [ ] 互動 session 跑完 → 手機收到 Stop 通知
- [ ] 子程序內的 Stop hook 不會造成重複通知
- [ ] 任務進行中傳第二則 → 收到「進行中」回覆
- [ ] bot 重啟後不重跑舊訊息
- [ ] 逾時任務被 kill 並回報
- [ ] `.env` / `state.json` / `bot.log` 都在 .gitignore 內
