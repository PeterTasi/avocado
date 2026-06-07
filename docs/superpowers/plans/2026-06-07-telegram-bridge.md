# Telegram 橋接 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建立一個個人工具，讓 Peter 透過 Telegram 接收 Claude Code 的完成通知，並能在離開電腦時派發 headless 任務（限定 Read/Grep/Glob/Edit/Write 權限）。

**Architecture:** 一個長輪詢的 Python 腳本（`bot.py`）讀取 Telegram `getUpdates`，過濾白名單 chat_id，spawn 受限的 `claude -p` headless 子程序並把結果回傳；一個 curl shell 腳本（`notify.sh`）掛進 `~/.claude/settings.json` 的 Stop / Notification hook，推播互動 session 的狀態。兩者共享同一個 `.env`（token + chat_id），用環境變數 `TELEGRAM_BRIDGE_CHILD=1` 避免重複通知。

**Tech Stack:** Python 3 標準庫（`urllib`、`json`、`subprocess`，零外部依賴）、bash + curl、`unittest`

**對應 spec：** `docs/superpowers/specs/2026-06-07-telegram-bridge-design.md`

**位置：** 全部檔案建立在 `~/.claude/telegram-bridge/`（個人工具，不進 AdaptLearn repo；本計畫文件本身存在 AdaptLearn repo 作開發紀錄）

---

## File Structure

```
~/.claude/telegram-bridge/
├── bot.py              # 長輪詢主程式 + 純函式（可單元測試）
├── notify.sh           # hook 用的 curl 推播腳本
├── .env.example        # 設定範本（進 git）
├── .env                # 實際 token/chat_id（gitignored，手動建立）
├── .gitignore          # 排除 .env / state.json / bot.log / __pycache__
├── README.md           # 建 bot、設定、啟動步驟
└── tests/
    └── test_bot.py     # bot.py 純函式的 unittest
```

`~/.claude/telegram-bridge/` 本身不是 git repo（個人工具目錄），但我們仍寫 `.gitignore` 並用 `git init` 建一個本地 repo 方便日後追蹤變更與避免誤傳敏感檔案。

---

## Task 1: 建立目錄骨架、.gitignore、.env.example

**Files:**
- Create: `~/.claude/telegram-bridge/.gitignore`
- Create: `~/.claude/telegram-bridge/.env.example`

- [ ] **Step 1: 建立目錄並初始化 git**

```bash
mkdir -p ~/.claude/telegram-bridge/tests
cd ~/.claude/telegram-bridge && git init
```

Expected: `Initialized empty Git repository in /Users/petertsai/.claude/telegram-bridge/.git/`

- [ ] **Step 2: 寫 `.gitignore`**

```
.env
state.json
bot.log
__pycache__/
*.pyc
```

- [ ] **Step 3: 寫 `.env.example`**

```
# Telegram Bot Token，從 @BotFather 取得
TELEGRAM_BOT_TOKEN=

# 你自己的 Telegram chat id（白名單，只有這個 chat 能下指令）
TELEGRAM_CHAT_ID=

# headless 任務執行時的工作目錄（預設專案路徑）
DEFAULT_PROJECT_DIR=/Users/petertsai/Documents/project

# headless 任務逾時秒數（預設 300）
TASK_TIMEOUT_SECONDS=300
```

- [ ] **Step 4: Commit**

```bash
cd ~/.claude/telegram-bridge
git add .gitignore .env.example
git commit -m "chore: scaffold telegram-bridge with gitignore and env template"
```

---

## Task 2: TDD — bot.py 純函式（env 解析、白名單、訊息截斷、offset 持久化）

這些函式不涉及網路或子程序，適合先寫測試再實作。

**Files:**
- Create: `~/.claude/telegram-bridge/bot.py`
- Test: `~/.claude/telegram-bridge/tests/test_bot.py`

- [ ] **Step 1: 寫失敗測試**

```python
# tests/test_bot.py
import json
import sys
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import bot


class TestLoadEnv(unittest.TestCase):
    def test_parses_key_value_pairs(self):
        with TemporaryDirectory() as tmp:
            env_path = Path(tmp) / ".env"
            env_path.write_text("TELEGRAM_BOT_TOKEN=abc123\nTELEGRAM_CHAT_ID=999\n")
            result = bot.load_env(env_path)
            self.assertEqual(result, {"TELEGRAM_BOT_TOKEN": "abc123", "TELEGRAM_CHAT_ID": "999"})

    def test_skips_comments_and_blank_lines(self):
        with TemporaryDirectory() as tmp:
            env_path = Path(tmp) / ".env"
            env_path.write_text("# comment\n\nKEY=value\n")
            result = bot.load_env(env_path)
            self.assertEqual(result, {"KEY": "value"})

    def test_missing_file_returns_empty_dict(self):
        result = bot.load_env(Path("/nonexistent/.env"))
        self.assertEqual(result, {})


class TestIsAuthorized(unittest.TestCase):
    def test_matching_chat_id_is_authorized(self):
        self.assertTrue(bot.is_authorized(12345, "12345"))

    def test_mismatched_chat_id_is_not_authorized(self):
        self.assertFalse(bot.is_authorized(99999, "12345"))

    def test_compares_as_strings(self):
        self.assertTrue(bot.is_authorized("12345", 12345))


class TestTruncateMessage(unittest.TestCase):
    def test_short_message_unchanged(self):
        self.assertEqual(bot.truncate_message("hello"), "hello")

    def test_long_message_truncated_with_note(self):
        long_text = "x" * 5000
        result = bot.truncate_message(long_text, limit=100)
        self.assertEqual(len(result), 100)
        self.assertTrue(result.endswith(bot.TRUNCATION_NOTE))

    def test_message_at_exact_limit_unchanged(self):
        text = "x" * 100
        self.assertEqual(bot.truncate_message(text, limit=100), text)


class TestOffsetPersistence(unittest.TestCase):
    def test_load_offset_returns_none_when_missing(self):
        with TemporaryDirectory() as tmp:
            state_path = Path(tmp) / "state.json"
            self.assertIsNone(bot.load_offset(state_path))

    def test_save_then_load_roundtrips(self):
        with TemporaryDirectory() as tmp:
            state_path = Path(tmp) / "state.json"
            bot.save_offset(state_path, 42)
            self.assertEqual(bot.load_offset(state_path), 42)

    def test_save_overwrites_previous_value(self):
        with TemporaryDirectory() as tmp:
            state_path = Path(tmp) / "state.json"
            bot.save_offset(state_path, 1)
            bot.save_offset(state_path, 2)
            self.assertEqual(bot.load_offset(state_path), 2)
            data = json.loads(state_path.read_text())
            self.assertEqual(data, {"offset": 2})


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: 執行測試，確認全部失敗（bot.py 還不存在）**

Run: `cd ~/.claude/telegram-bridge && python3 -m pytest tests/test_bot.py -v`
Expected: `ModuleNotFoundError: No module named 'bot'` 或 import 階段失敗

- [ ] **Step 3: 寫最小實作讓測試通過**

```python
#!/usr/bin/env python3
"""Telegram bridge for Claude Code: notifications + remote headless task dispatch."""
import json
import os
import subprocess
import time
import urllib.parse
import urllib.request
from pathlib import Path

BRIDGE_DIR = Path(__file__).resolve().parent
ENV_PATH = BRIDGE_DIR / ".env"
STATE_PATH = BRIDGE_DIR / "state.json"
LOG_PATH = BRIDGE_DIR / "bot.log"

TELEGRAM_MESSAGE_LIMIT = 4096
TRUNCATION_NOTE = "\n\n（已截斷，完整結果在電腦上）"

ALLOWED_TOOLS = "Read Grep Glob Edit Write"


def load_env(path):
    env = {}
    if not path.exists():
        return env
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        key, _, value = line.partition("=")
        env[key.strip()] = value.strip()
    return env


def is_authorized(chat_id, allowed_chat_id):
    return str(chat_id) == str(allowed_chat_id)


def truncate_message(text, limit=TELEGRAM_MESSAGE_LIMIT):
    if len(text) <= limit:
        return text
    cutoff = limit - len(TRUNCATION_NOTE)
    return text[:cutoff] + TRUNCATION_NOTE


def load_offset(state_path):
    if not state_path.exists():
        return None
    data = json.loads(state_path.read_text())
    return data.get("offset")


def save_offset(state_path, offset):
    state_path.write_text(json.dumps({"offset": offset}))
```

- [ ] **Step 4: 執行測試，確認全部通過**

Run: `cd ~/.claude/telegram-bridge && python3 -m pytest tests/test_bot.py -v`
Expected: 全部 `PASSED`（11 個測試）

- [ ] **Step 5: Commit**

```bash
cd ~/.claude/telegram-bridge
git add bot.py tests/test_bot.py
git commit -m "feat: add bot.py pure helpers (env parsing, whitelist, truncation, offset) with tests"
```

---

## Task 3: Telegram API 包裝函式（送訊息、取更新）

這層涉及網路 I/O，不寫單元測試（會打到真實 API），改用 Task 8 的端對端驗證涵蓋。先確保函式簽名乾淨、好被主迴圈呼叫。

**Files:**
- Modify: `~/.claude/telegram-bridge/bot.py`

- [ ] **Step 1: 在 `bot.py` 補上 Telegram API 函式（接在 `save_offset` 之後）**

```python
def telegram_api(token, method, params=None):
    url = f"https://api.telegram.org/bot{token}/{method}"
    data = urllib.parse.urlencode(params).encode() if params else None
    with urllib.request.urlopen(url, data=data, timeout=35) as resp:
        return json.loads(resp.read().decode())


def send_message(token, chat_id, text):
    telegram_api(token, "sendMessage", {"chat_id": chat_id, "text": truncate_message(text)})


def get_updates(token, offset=None, timeout=30):
    params = {"timeout": timeout}
    if offset is not None:
        params["offset"] = offset
    result = telegram_api(token, "getUpdates", params)
    return result.get("result", [])
```

- [ ] **Step 2: 語法檢查（不執行網路呼叫）**

Run: `cd ~/.claude/telegram-bridge && python3 -c "import bot; print('ok')"`
Expected: `ok`

- [ ] **Step 3: Commit**

```bash
cd ~/.claude/telegram-bridge
git add bot.py
git commit -m "feat: add Telegram API wrappers (send_message, get_updates)"
```

---

## Task 4: headless 任務執行器

**Files:**
- Modify: `~/.claude/telegram-bridge/bot.py`

- [ ] **Step 1: 在 `bot.py` 補上 `run_headless_task`（接在 `get_updates` 之後）**

> **注意：** `claude` 在互動 shell 是 `npx @anthropic-ai/claude-code` 的 alias，子程序讀不到 shell alias，必須用完整指令。

```python
def run_headless_task(prompt, project_dir, timeout_seconds):
    env = os.environ.copy()
    env["TELEGRAM_BRIDGE_CHILD"] = "1"
    try:
        proc = subprocess.run(
            [
                "npx", "@anthropic-ai/claude-code",
                "-p", prompt,
                "--allowedTools", ALLOWED_TOOLS,
            ],
            cwd=project_dir,
            env=env,
            capture_output=True,
            text=True,
            timeout=timeout_seconds,
        )
        output = proc.stdout.strip()
        return output if output else "(無輸出)"
    except subprocess.TimeoutExpired:
        return "⏱ 任務逾時，已中止"
    except FileNotFoundError:
        return "❌ 找不到 claude CLI，請確認 npx / @anthropic-ai/claude-code 已安裝"
```

- [ ] **Step 2: 手動驗證子程序能跑起來**

Run:
```bash
cd ~/.claude/telegram-bridge && python3 -c "
import bot
print(bot.run_headless_task('用一句話說明這是什麼專案', '/Users/petertsai/Documents/project', 120))
"
```
Expected: 印出 Claude 對 AdaptLearn 專案的一句話描述（非 timeout / 非 FileNotFoundError 訊息）

- [ ] **Step 3: Commit**

```bash
cd ~/.claude/telegram-bridge
git add bot.py
git commit -m "feat: add headless task runner with restricted tool whitelist and timeout"
```

---

## Task 5: 主迴圈（輪詢、白名單、併發保護、log）

**Files:**
- Modify: `~/.claude/telegram-bridge/bot.py`

- [ ] **Step 1: 在 `bot.py` 補上 `log` 與 `main`（檔案最後，`if __name__ == "__main__"` 之前）**

```python
def log(message):
    timestamp = time.strftime("%Y-%m-%d %H:%M:%S")
    line = f"[{timestamp}] {message}"
    print(line)
    with open(LOG_PATH, "a") as f:
        f.write(line + "\n")


def main():
    env = load_env(ENV_PATH)
    token = env.get("TELEGRAM_BOT_TOKEN")
    allowed_chat_id = env.get("TELEGRAM_CHAT_ID")
    if not token or not allowed_chat_id:
        raise SystemExit("缺少 TELEGRAM_BOT_TOKEN 或 TELEGRAM_CHAT_ID，請檢查 .env")

    project_dir = env.get("DEFAULT_PROJECT_DIR", str(Path.home()))
    timeout_seconds = int(env.get("TASK_TIMEOUT_SECONDS", "300"))

    offset = load_offset(STATE_PATH)
    busy = False

    log(f"Bot 啟動。白名單 chat_id={allowed_chat_id}，專案目錄={project_dir}")

    while True:
        try:
            updates = get_updates(token, offset)
        except Exception as exc:
            log(f"getUpdates 失敗：{exc}")
            time.sleep(5)
            continue

        for update in updates:
            offset = update["update_id"] + 1
            save_offset(STATE_PATH, offset)

            message = update.get("message")
            if not message or "text" not in message:
                continue

            chat_id = message["chat"]["id"]
            text = message["text"]

            if not is_authorized(chat_id, allowed_chat_id):
                log(f"忽略未授權 chat_id={chat_id} 的訊息：{text!r}")
                continue

            if busy:
                send_message(token, chat_id, "⏳ 任務進行中，請稍候再傳")
                continue

            busy = True
            try:
                send_message(token, chat_id, f"🚀 收到，開始處理：{text}")
                result = run_headless_task(text, project_dir, timeout_seconds)
                send_message(token, chat_id, result)
            except Exception as exc:
                log(f"任務執行失敗：{exc}")
                send_message(token, chat_id, f"❌ 任務執行失敗：{exc}")
            finally:
                busy = False


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: 語法與 import 檢查**

Run: `cd ~/.claude/telegram-bridge && python3 -c "import bot; print('ok')"`
Expected: `ok`

- [ ] **Step 3: 跑單元測試確認沒有破壞 Task 2 的東西**

Run: `cd ~/.claude/telegram-bridge && python3 -m pytest tests/test_bot.py -v`
Expected: 全部 `PASSED`

- [ ] **Step 4: Commit**

```bash
cd ~/.claude/telegram-bridge
git add bot.py
git commit -m "feat: add main polling loop with whitelist filtering, concurrency guard, and logging"
```

---

## Task 6: notify.sh + 掛 hook

**Files:**
- Create: `~/.claude/telegram-bridge/notify.sh`
- Modify: `~/.claude/settings.json`

- [ ] **Step 1: 寫 `notify.sh`**

```bash
#!/usr/bin/env bash
set -euo pipefail

# 子程序內的 hook 不發通知，避免和 bot.py 的回傳訊息重複
if [ "${TELEGRAM_BRIDGE_CHILD:-}" = "1" ]; then
  exit 0
fi

BRIDGE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="$BRIDGE_DIR/.env"

[ -f "$ENV_FILE" ] || exit 0

set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

[ -n "${TELEGRAM_BOT_TOKEN:-}" ] && [ -n "${TELEGRAM_CHAT_ID:-}" ] || exit 0

MESSAGE="${1:-Claude Code 通知}"

curl -s -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
  -d "chat_id=${TELEGRAM_CHAT_ID}" \
  -d "text=${MESSAGE}" > /dev/null
```

- [ ] **Step 2: 設成可執行**

```bash
chmod +x ~/.claude/telegram-bridge/notify.sh
```

- [ ] **Step 3: 在 `~/.claude/settings.json` 的 `hooks` 物件加上 `Stop` 與 `Notification`**

把現有的 `"hooks": { "PreToolUse": [...] }` 改成（在 `PreToolUse` 同層級加兩個新 key）：

```json
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "/Users/petertsai/.claude/hooks/rtk-rewrite.sh"
          }
        ]
      }
    ],
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "/Users/petertsai/.claude/telegram-bridge/notify.sh '✅ Claude Code 任務完成，等你回覆'"
          }
        ]
      }
    ],
    "Notification": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "/Users/petertsai/.claude/telegram-bridge/notify.sh '⚠️ Claude Code 需要你確認操作'"
          }
        ]
      }
    ]
  },
```

用 Edit 工具修改 `~/Users/petertsai/.claude/settings.json`，只新增 `Stop` 與 `Notification` 兩個 key，不動 `PreToolUse`。

- [ ] **Step 4: 驗證 JSON 格式正確**

Run: `python3 -c "import json; json.load(open('/Users/petertsai/.claude/settings.json')); print('valid json')"`
Expected: `valid json`

- [ ] **Step 5: 手動測試 notify.sh 能發送（此時 .env 應已在 Task 7 填好；若還沒填，先跳過此驗證，留到 Task 8 一併做）**

Run: `~/.claude/telegram-bridge/notify.sh '🧪 測試訊息'`
Expected: 手機 Telegram 收到「🧪 測試訊息」

- [ ] **Step 6: Commit（telegram-bridge 內的變更；settings.json 不在這個 repo，獨立 commit 由 Step 7 處理）**

```bash
cd ~/.claude/telegram-bridge
git add notify.sh
git commit -m "feat: add notify.sh for hook-based Telegram push notifications"
```

- [ ] **Step 7: 對 `~/.claude/settings.json` 的修改另外 commit（這是全域 Claude 設定，不在任何專案 repo 內，跳過 git）**

不需要 git 操作；確認 Step 4 的 JSON 驗證通過即代表此步驟完成。

---

## Task 7: README — 設定與啟動步驟

**Files:**
- Create: `~/.claude/telegram-bridge/README.md`

- [ ] **Step 1: 寫 `README.md`**

```markdown
# Telegram Bridge for Claude Code

個人工具：透過 Telegram 接收 Claude Code 通知，並能在離開電腦時派發 headless 任務。

## 設定步驟

### 1. 建立 Telegram Bot

1. 在 Telegram 搜尋 `@BotFather`，傳 `/newbot`
2. 依指示輸入 bot 名稱與 username
3. 取得 **Bot Token**（格式類似 `123456789:ABCdefGhIJKlmnOpQRstuVwxyZ`）

### 2. 取得你的 chat_id

1. 對你剛建立的 bot 傳一則任意訊息（例如「hi」）
2. 瀏覽器打開：`https://api.telegram.org/bot<你的TOKEN>/getUpdates`
3. 在回傳的 JSON 裡找 `"chat":{"id": ...}`，那個數字就是你的 **chat_id**

### 3. 設定 `.env`

```bash
cd ~/.claude/telegram-bridge
cp .env.example .env
```

編輯 `.env`，填入：
- `TELEGRAM_BOT_TOKEN` — 步驟 1 取得的 token
- `TELEGRAM_CHAT_ID` — 步驟 2 取得的 chat_id
- `DEFAULT_PROJECT_DIR` — headless 任務執行的工作目錄（預設 `/Users/petertsai/Documents/project`）
- `TASK_TIMEOUT_SECONDS` — 單一任務逾時秒數（預設 300）

### 4. 確認 hook 已掛上

`~/.claude/settings.json` 的 `hooks` 應包含 `Stop` 與 `Notification`，指向 `notify.sh`（此計畫的 Task 6 已自動設定）。

### 5. 啟動

```bash
cd ~/.claude/telegram-bridge
python3 bot.py
```

看到 `Bot 啟動。白名單 chat_id=...` 代表成功。關閉終端機視窗即停止（這是手動模式，不會常駐）。

## 使用方式

- **通知：** 互動 session 跑完一回合或需要權限確認時，手機會自動收到推播
- **派發任務：** 直接傳訊息給你的 bot，例如「幫我看一下 quiz_engine 的弱概念排序邏輯」。bot 會在 `DEFAULT_PROJECT_DIR` 跑一個 headless Claude Code 任務（**只能讀檔、改檔，不能執行指令**），完成後把結果傳回來

## 安全限制

- 只回應 `.env` 裡設定的 `TELEGRAM_CHAT_ID`，其他人傳訊息會被忽略並記錄在 `bot.log`
- headless 任務的工具白名單為 `Read Grep Glob Edit Write`，**不含 Bash**：不能 git push / 刪檔 / 裝套件 / 任意執行
- 一次只跑一個任務，忙碌時會回覆「⏳ 任務進行中」

## 疑難排解

- **`bot.log`** — 記錄所有忽略的訊息與錯誤
- **`state.json`** — 記錄已處理訊息的 offset，刪除它會讓 bot 重新處理歷史訊息（一般不需要動）
- 若 `claude` 子程序失敗，確認 `npx @anthropic-ai/claude-code -p "test" --allowedTools "Read"` 能在終端機正常執行
```

- [ ] **Step 2: Commit**

```bash
cd ~/.claude/telegram-bridge
git add README.md
git commit -m "docs: add setup and usage instructions"
```

---

## Task 8: 端對端驗證（對照 spec 驗收標準）

不寫自動化測試（需要真實 Telegram bot + 真實網路），改為手動走過 spec 第 9 節的驗收清單。

**Files:** 無新檔案；本任務是執行與觀察。

- [ ] **Step 1: 啟動 bot**

Run: `cd ~/.claude/telegram-bridge && python3 bot.py`
Expected: 終端機印出 `Bot 啟動。白名單 chat_id=<你的chat_id>，專案目錄=/Users/petertsai/Documents/project`

- [ ] **Step 2: 驗證雙向派發**

用手機傳「列出 AdaptLearn 有哪些 API 路由」給 bot。
Expected: 先收到「🚀 收到，開始處理」，幾十秒後收到實際結果（提到 `/api/health`、`/api/courses` 等路由）

- [ ] **Step 3: 驗證白名單過濾**

用另一支手機 / 朋友的 Telegram 帳號傳訊息給同一個 bot（若沒有，可改用瀏覽器呼叫 `sendMessage` 模擬不同 chat_id，或跳過此步並改為檢查程式邏輯）。
Expected: bot 不回應，且 `bot.log` 出現 `忽略未授權 chat_id=... 的訊息`

- [ ] **Step 4: 驗證互動 session 的 Stop 通知**

在終端機開一個新的互動 Claude Code session，問它一個簡單問題並等它回完。
Expected: 手機收到「✅ Claude Code 任務完成，等你回覆」**且只有一則**（不是兩則）

- [ ] **Step 5: 驗證子程序去重（不重複通知）**

回顧 Step 2 的派發結果：手機應該只收到「🚀 收到」+「結果」兩則，**沒有**額外的「✅ Claude Code 任務完成」通知混進來。
Expected: 沒有來自子程序 Stop hook 的多餘訊息（因為 `TELEGRAM_BRIDGE_CHILD=1` 讓 notify.sh 提前 exit）

- [ ] **Step 6: 驗證併發保護**

派發一個任務後，立刻再傳第二則訊息。
Expected: 第二則收到「⏳ 任務進行中，請稍候再傳」，不會同時跑兩個 headless 任務

- [ ] **Step 7: 驗證 offset 持久化**

按 `Ctrl+C` 停掉 bot，確認 `state.json` 有內容後重新執行 `python3 bot.py`。
Expected: 不會重新處理 Step 2~6 的舊訊息（沒有重複回覆）

- [ ] **Step 8: 驗證 timeout（選做，會花費較長時間）**

把 `.env` 的 `TASK_TIMEOUT_SECONDS` 暫時改成 `5`，傳一個會花較久時間的任務。
Expected: 約 5 秒後收到「⏱ 任務逾時，已中止」。測試完記得把 `TASK_TIMEOUT_SECONDS` 改回 `300`

- [ ] **Step 9: 在這個 AdaptLearn repo 的 spec 文件勾選驗收項目並 commit**

打開 `docs/superpowers/specs/2026-06-07-telegram-bridge-design.md`，把第 9 節「驗收標準」中已驗證通過的項目改成 `[x]`，然後：

```bash
cd /Users/petertsai/Documents/project
git add docs/superpowers/specs/2026-06-07-telegram-bridge-design.md
git commit -m "docs(telegram): 標記端對端驗收項目已通過"
```
