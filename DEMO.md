# AdaptLearn 競賽展示指南

> 比賽現場快速對照用。完整技術說明見 README.md。

---

## 零、首次設定（只需做一次）

### 第一步：安裝 Python 依賴

```bash
cd /path/to/project          # 進入專案根目錄

# 建立虛擬環境（若 .venv 不存在）
python3.11 -m venv .venv

# 啟動虛擬環境
source .venv/bin/activate    # macOS / Linux
# .venv\Scripts\activate     # Windows

# 安裝所有套件
pip install -r requirements.txt
```

### 第二步：建置前端（React → 靜態檔）

```bash
cd webapp/frontend
npm install        # 安裝 Node.js 依賴（只需一次）
npm run build      # 編譯到 webapp/static/（每次改前端後重做）
cd ../..           # 回到專案根目錄
```

### 第三步：設定環境變數

```bash
cp .env.example .env   # 複製範本
```

用文字編輯器打開 `.env`，填入：

| 變數 | 說明 | 必填 |
|------|------|------|
| `DATABASE_URL` | PostgreSQL 連線字串，例：`postgresql://user:pass@localhost/adaptlearn` | ✅ |
| `GEMINI_API_KEY` | Google Gemini API 金鑰（無金鑰可用備援模式） | 建議 |
| `CHANDRA_METHOD` | `vllm`（需執行伺服器）或 `hf`（本機下載模型） | 選用 |
| `CHANDRA_VLLM_URL` | Chandra vLLM 伺服器位址（預設 `http://localhost:8000/v1`） | 選用 |

### 第四步：初始化資料庫

```bash
source .venv/bin/activate
python scripts/init_db.py   # 建立所有資料表（若資料庫已初始化可略過）
```

---

## 一、本機啟動

### 1. 啟動後端（含前端）

```bash
cd /path/to/project
source .venv/bin/activate
uvicorn webapp.main:app --reload --host 0.0.0.0 --port 8000
```

打開 **http://localhost:8000** 即可看到完整系統。

> **macOS 快捷**：直接雙擊 `start_adaptlearn_web.command` 檔案，自動啟動後端。

### 2. 若需前端熱更新開發模式

```bash
# 終端機一：啟動後端
source .venv/bin/activate
uvicorn webapp.main:app --reload --port 8000

# 終端機二：啟動前端開發伺服器
cd webapp/frontend
npm run dev    # 在 http://localhost:5173 預覽，修改立即生效
```

### 3. 若需 Gemini AI 功能

在右側面板「匯入教材與課程配置」→「Gemini API 金鑰」欄位填入 key，  
或先執行：

```bash
curl -X POST http://localhost:8000/api/config/api-key \
  -H "Content-Type: application/json" \
  -d '{"api_key": "YOUR_GEMINI_KEY"}'
```

### 4. 啟用 Chandra 手寫辨識 OCR（選用）

**方案 A：本機 HF 模型**（需下載約 10 GB 模型，第一次慢）

```bash
pip install chandra-ocr[hf]
# 在 .env 設定：
CHANDRA_METHOD=hf
```

**方案 B：vLLM 伺服器**（需另外架設 GPU 伺服器）

```bash
# 安裝 vLLM 伺服器端（在 GPU 機器上）：
pip install chandra-ocr
chandra_vllm   # 啟動 vLLM，預設 port 8000

# 在 .env 設定（你的應用程式那台）：
CHANDRA_METHOD=vllm
CHANDRA_VLLM_URL=http://<GPU伺服器IP>:8000/v1
```

啟用後，上傳**手寫筆記圖片**時會自動優先使用 Chandra；若 Chandra 失敗則退回 Gemini。

---

## 二、展示流程（建議順序）

### Step 1：總覽頁
- 頂部導覽顯示 **AdaptLearn · 自適應學習儀表板**
- 左側顯示「引擎狀態」：有 key 為 *Gemini 已啟用*，無 key 為 *備援模式*
- 重點：玻璃擬態 UI、行動優先的響應式版面

### Step 2：上傳教材建立知識圖譜
1. 點「匯入教材與課程配置」區塊
2. 選課程名稱（例：線性代數）、模板（通用 or 線性代數）
3. 選 PDF 或 TXT → 點「建立知識圖譜」
4. 等待成功後 → 「已抽取概念」列表自動更新

### Step 3：自適應測驗
1. 滾至「自適應測驗」
2. 設定題數（建議 6–9 題），點「產生題目」
3. 作答後點「送出作答」→ 即時 AI 評分 + 回饋

### Step 4：複習排程
1. 點上方「複習計畫」分頁 / 滾動至複習排程區塊
2. 展示「今晚衝刺計畫」：預估通過率提升
3. 展示「複習排程」：哪些概念排在下次複習

### Step 5：知識圖譜
1. 點「知識圖譜」分頁
2. 展示概念節點與關聯線（先修、進展、跨課等）
3. 可點「複製 DOT」展示 Graphviz 格式輸出

### Step 6：班級熱力圖（可選）
- 若有多課程紀錄，左下方「班級知識熱力圖」顯示班級共同弱點
- 教師視角：錯誤率 + 建議優先補強項目

---

## 三、技術亮點（口述重點）

| 面向 | 說明 |
|------|------|
| **AI 骨幹** | Google Gemini 2.5 Flash — 概念抽取、題目生成、語意評分 |
| **手寫辨識** | Chandra OCR（datalab-to/chandra）— 支援手寫筆記、複雜表格、數學公式，90+ 語言 |
| **OCR 容錯** | 優先 Chandra → 自動退回 Gemini Vision，任一可用即正常運作 |
| **知識結構** | DOT 格式知識圖譜，涵蓋先修、進展、跨課等價、泛化等 8 種關係 |
| **遺忘曲線** | FSRS-5 間隔重複演算法排定每位同學的複習優先序 |
| **前端** | React 18 + Vite + Tailwind CSS，玻璃擬態(Glassmorphism)介面 |
| **後端** | FastAPI + PostgreSQL，API 語意清晰、前後端完整分離 |
| **語系** | 全介面繁體中文，`zh-TW` 日期格式 |

---

## 四、常見 QA

**Q：沒有 Gemini Key 能展示什麼？**  
A：可展示 UI、上傳教材（備援模式用啟發式抽取）、測驗與評分（靜態答案）、複習排程邏輯。AI 題目品質會下降但流程完整。

**Q：如何重置資料？**  
```bash
rm data/chroma/chroma.sqlite3
# 重新啟動後自動建立空白資料庫
```

**Q：如何查看 API 文件？**  
打開 http://localhost:8000/docs（Swagger UI 自動產生）

---

## 五、停止服務

在終端機按 `Ctrl+C` 即可停止 uvicorn。
