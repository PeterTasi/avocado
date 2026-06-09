# AdaptLearn — CLAUDE.md

## Project Overview

AdaptLearn is an AI-powered adaptive learning platform for students. Students upload course materials (PDF, images, handwritten notes), and the system builds a knowledge graph, generates adaptive diagnostic quizzes, tracks mastery via spaced repetition (FSRS-5), and provides personalized study plans.

**Competition context:** This is a student learning website competition project. Correctness and feature completeness matter more than perfect abstraction.

> **DevLog:** chronological development & debugging history lives in `DEVLOG.md` (kept for the poster/report). Append a dated entry there when you finish notable work.
> **CLAUDE.md 精簡規則：** 完成的功能和修復的 bug 移到 DEVLOG.md；CLAUDE.md 只保留「目前狀態」與「未完成事項」。超過 400 行時主動瘦身。

---

## Tech Stack

| Layer | Technology |
|---|---|
| Backend language | Python 3.11 |
| Web framework | FastAPI + uvicorn |
| Frontend | React 18 + TypeScript + Tailwind CSS + Vite |
| UI components | Lucide icons, Recharts |
| LLM | Google Gemini API (`gemini-flash-latest` default) |
| Database | PostgreSQL via psycopg2 (connection pool, 10 conns) |
| Vector store | ChromaDB (concept semantic search) |
| PDF/image parsing | PyMuPDF (fitz) + Chandra OCR (`chandra-ocr`) |
| Local handwriting OCR | Ollama vision model (e.g. `qwen2.5vl:7b`), opt-in via `OLLAMA_OCR_MODEL` |
| Spaced repetition | FSRS-5 (`fsrs` library) |
| Rate limiting | slowapi |
| In-process cache | cachetools TTLCache |
| Linting | ruff |
| Type checking | mypy |
| Tests | pytest + unittest |
| Deployment | Render (free tier) |

---

## Project Structure

```
.
├── webapp/
│   ├── main.py                  # FastAPI app, all API routes
│   ├── frontend/
│   │   ├── src/
│   │   │   ├── App.tsx          # SPA root, view routing (home/setup/quiz/review/graph)
│   │   │   ├── components/      # React components
│   │   │   ├── hooks/useApi.ts  # All API fetch hooks
│   │   │   └── utils/
│   │   ├── package.json
│   │   └── vite.config.js
│   └── static/                  # Built frontend assets (served by FastAPI)
├── src/adaptlearn/
│   ├── config.py                # Settings dataclass, reads .env
│   ├── models.py                # Dataclasses: Course, Concept, Question, Attempt, ReviewItem, etc.
│   ├── database.py              # StudyRepository — all PostgreSQL queries (psycopg2)
│   ├── chandra_client.py        # Chandra OCR wrapper (handwriting-aware; vllm/hf backends — needs GPU)
│   ├── ollama_client.py         # Local Ollama vision-OCR wrapper (handwriting; opt-in, primary OCR path)
│   ├── gemini_client.py         # Gemini API wrapper (transcription, quiz gen, grading)
│   ├── pdf_parser.py            # File ingestion: PDF/TXT/image → text + OCR (Ollama→Chandra→Gemini)
│   ├── knowledge_graph.py       # LLM-driven concept graph extraction from text
│   ├── pipeline.py              # AdaptLearnService — orchestrates all modules
│   ├── quiz_engine.py           # Adaptive question generation targeting weak concepts
│   ├── review_scheduler.py      # FSRS-5 spaced repetition scheduler
│   ├── vector_store.py          # ChromaDB wrapper for concept similarity
│   ├── cross_course_linker.py   # Semantic cross-course concept linking
│   ├── class_heatmap.py         # Error-rate heatmap per concept/course
│   └── domain_templates.py      # Seed concept templates (e.g. linear algebra)
├── tests/                       # Regression tests
├── data/                        # Runtime: adaptlearn.db (unused legacy), chroma/ vector store
├── requirements.txt
├── render.yaml                  # Render deployment config
└── .env.example
```

---

## Environment Variables

See `.env.example`. Required:
- `DATABASE_URL` — PostgreSQL connection string
- `GEMINI_API_KEY` — enables LLM features (quiz gen, OCR, grading); app degrades gracefully without it

Optional:
- `GEMINI_MODEL` — defaults to `gemini-flash-latest`
- `MAX_OCR_PAGES` — cap on scanned PDF pages sent to local OCR (default 12); Gemini paths are uncapped
- `ALLOWED_ORIGINS` — comma-separated CORS origins
- `API_ACCESS_KEY` — if set, all `/api/*` routes require `X-API-Key` header
- `HEATMAP_UPLIFT_CAP`, `HEATMAP_UPLIFT_RATIO` — heatmap tuning
- `CHANDRA_METHOD` — `"vllm"` (default, needs running server) or `"hf"` (local model, ~10 GB download)
- `CHANDRA_VLLM_URL` — vLLM server URL for Chandra (default `http://localhost:8000/v1`)
- `OLLAMA_OCR_MODEL` — local Ollama vision model for primary on-device OCR (e.g. `qwen2.5vl:7b`); empty = disabled. Best for local demos: strong handwriting, no API cost, no proxy 502
- `OLLAMA_URL` — Ollama server URL (default `http://localhost:11434`)

---

## Running Locally

```bash
# Backend
source .venv/bin/activate
uvicorn webapp.main:app --reload --host 0.0.0.0 --port 8000

# Frontend (dev mode with hot reload)
cd webapp/frontend && npm run dev   # serves at http://localhost:5173

# Frontend (production build — required before running backend-only)
cd webapp/frontend && npm run build
```

---

## API Routes (webapp/main.py)

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/health` | Status + metrics |
| POST | `/api/config/api-key` | Switch Gemini API key at runtime |
| POST | `/api/material/ingest` | Upload file → build concept graph |
| GET | `/api/concepts` | List all concepts |
| GET | `/api/concepts/{id}/detail` | 概念深度詳解（lazy 生成+快取，`?lang=zh\|en`；定義/重點/範例/誤區/公式旗標） |
| GET | `/api/graph` | Graphviz DOT string |
| GET | `/api/mastery/concepts` | Per-concept mastery scores |
| GET | `/api/mastery/chapters` | Per-chapter mastery |
| POST | `/api/diagnostics/generate` | Generate adaptive quiz questions（body 可帶 `language: zh\|en\|both`） |
| GET | `/api/questions` | List questions |
| POST | `/api/questions/{id}/grade` | Grade a student answer |
| POST | `/api/review/recalculate` | Rebuild FSRS review plan |
| GET | `/api/review` | Current review plan |
| GET | `/api/tonight` | Tonight study dashboard |
| GET | `/api/courses` | List uploaded courses |
| GET | `/api/cross-course-edges` | Semantic cross-course links |
| GET | `/api/heatmap/{course_id}` | Class error-rate heatmap |
| GET | `/api/heatmap/{course_id}/weak` | Top weak concepts |
| GET | `/api/progress/concepts?days=30` | Per-concept progress trend (improving/declining/plateaued) |

---

## Database Schema (PostgreSQL)

Tables: `courses`, `concepts`, `concept_edges`, `cross_course_edges`, `questions`, `attempts`, `review_plan`, `class_node_stats`, `concept_details`, `schema_version`.

> `concept_details`（migration 002）：概念深度詳解快取，PK `(concept_id, language)`，欄位 definition / key_points_json / example / common_mistakes / has_formula。lazy 生成（點開概念卡才生），不在 ingest 預生。

`StudyRepository` (`database.py`) manages all queries. Uses `ThreadedConnectionPool(minconn=1, maxconn=10)`. Schema is auto-created on startup via `initialize()`; migrations run via `_run_migrations()`.

---

## File Ingestion Pipeline

`pdf_parser.py → pipeline.py (AdaptLearnService.ingest_material)`

Supported formats: `.pdf`, `.txt`, `.png`, `.jpg`, `.jpeg`, `.webp`, `.bmp`, `.tif`, `.tiff`

Flow:
1. Extract text from file (PyMuPDF for PDF, direct decode for TXT, bytes for images)
2. If text is too sparse (`< 40 chars`) → OCR fallback chain (first non-empty result wins):
   - **PDF:** Ollama → Chandra → Gemini native PDF (whole doc, no page cap) → Gemini page-by-page vision
   - **Image:** Ollama → Chandra → Gemini vision OCR
   - `MAX_OCR_PAGES` only caps local paths (Ollama + Chandra). Gemini paths are uncapped.
3. Build knowledge graph via `knowledge_graph.py` (LLM extracts concepts + edges, scoped to `course_id`)
4. Save to PostgreSQL + ChromaDB; discover cross-course links

### OCR internals (quick map — check here before re-opening the files)

- **Entry:** `pdf_parser.extract_material_text(...)` → `ExtractedMaterial(text, source_type, ocr_used)`
- **Clients** (all expose `enabled` + `transcribe_images`): `OllamaClient` (opt-in via `OLLAMA_OCR_MODEL`; errors → `""` fallback), `ChandraClient` (needs GPU), `GeminiClient` (also `transcribe_pdf`; 120s timeout; API errors degrade to `""`)
- **Wiring:** `pipeline.AdaptLearnService.__init__` builds `self.gemini/chandra/ollama`; `ingest_material` calls `extract_material_text` then `build_knowledge_graph`
- **Render reality:** no GPU / no Ollama → Gemini is the only working OCR. Local demo → set `OLLAMA_OCR_MODEL=qwen2.5vl:7b`
- **ingest is async-safe:** runs sync work via `run_in_threadpool` (event loop stays free for health checks)

---

## Key Algorithms

**Spaced repetition:** FSRS-5 (`review_scheduler.py`). Each concept is a `Card`; attempt history is replayed to reconstruct card state; `retrievability` drives `priority` (0=fresh, 1=forgotten).

**Adaptive question selection** (`pipeline.py _select_weak_concepts`): ranks concepts by `1 - avg_score`; untested concepts get priority 1.0.

**Pass probability estimate** (`pipeline.py _estimate_pass_probability`):
`P = 0.32 + 0.46·avg_score + 0.16·accuracy + 0.06·experience_bonus` — empirical placeholder, not validated.

**Mastery bands:** green ≥ 0.75, yellow ≥ 0.5, red < 0.5.

---

## Frontend Views (App.tsx)

SPA with 5 views + landing screen (`showLanding` gate, default true — replays each page load):

| Key | Path | Component |
|---|---|---|
| `home` | `/` | Dashboard — DailyProgressRing, InsightFeed, MetricCardsGrid |
| `setup` | `/setup` | SetupPanel — file upload, course config |
| `quiz` | `/quiz` | QuizPanel — adaptive quiz |
| `review` | `/review` | StudyPlansPanel + TonightPanel |
| `graph` | `/graph` | KnowledgeGraphPanel + ClassHeatmapPanel |

`LandingScreen.tsx` (full-screen, stagger entry) renders before the nav. `PixelAvocadoLogo.tsx` used in landing and top-nav (`size={104}` / `size={30}`).

---

## Testing

```bash
python -m pytest tests/
# or
python -m unittest discover -s tests -p "test_*.py"
```

Tests live in `tests/`. Integration tests may require a real database (do not mock psycopg2).

---

## Deployment (Render)

Defined in `render.yaml`: one free PostgreSQL + one Python web service. Build: `pip install -r requirements.txt`. Start: `uvicorn webapp.main:app --host 0.0.0.0 --port $PORT`.

Frontend assets must be built locally (`npm run build`) and committed to `webapp/static/` before deploying — there is no Node.js build step on Render.

---

## Conventions

- Python: ruff for lint/format (see `pyproject.toml`), mypy for type checking (`mypy.ini`)
- All Chinese error messages face users; English messages face developers/logs
- New backend modules go in `src/adaptlearn/`; wire them into `AdaptLearnService` in `pipeline.py`
- New API endpoints go in `webapp/main.py`; follow the `@cached` / `@limiter.limit` pattern
- Frontend API calls go through `hooks/useApi.ts`
- No silent caps: if a function limits results, log what was dropped

---

## UI/UX Design Language — 明亮專業（LeetCode-inspired）

設計方向：白底中性灰 + 釘住頂欄 + 結構化網格 + 顏色只用在有意義的狀態。像素裝飾（酪梨 logo、答對粒子、圖譜中心節點、熱力格子）保留記憶點，每頁最多 1~2 個。

### 色彩系統（定義於 `index.css`）

```
背景：--bg-app #f5f6f8 / --bg-surface #ffffff / --bg-subtle #f7f8fa / --bg-sunken #f0f1f4
邊框：--border #e6e8ec / --border-strong #d7dade / --border-hover #c2c7cf
文字：--text-primary #16181d / --text-secondary #5a616b / --text-muted #8b929c
品牌強調：--accent #4f46e5（indigo）/ --accent-soft #eef0fe
語意色：--high #0ea472（綠）/ --medium #d98a04（琥珀）/ --low #e11d48（玫紅）
Easing：--ease-out / --ease-in-out / --ease-drawer（自訂 cubic-bezier，Emil 推薦）
```

### 字型

- UI / 標題：`Plus Jakarta Sans`（`.font-display`，letter-spacing -0.02em）
- 數字/統計：`DM Mono`（`.stat-value`，tabular-nums）
- 中文：`Noto Sans TC`

### 核心 utility classes

- 卡片：`.card` / `.card-flat` / `.card-subtle` / `.card-interactive`（hover 上浮，`@media (hover:hover)`）
- 按鈕：`.btn-primary` / `.btn-secondary` / `.btn-ghost`（`:active` scale(0.97)）
- 輸入：`.input`（focus accent ring）
- 標籤/狀態：`.pill` / `.tag-high|medium|low` / `.status-dot`
- 統計卡：`.stat-card`（左側 3px accent-bar）
- 掌握度條：`.mastery-bar-track` / `.mastery-bar-fill`（紅→琥珀→綠漸層）
- 像素裝飾：`.pixel-border` / `.pixel-grid-bg` / `.pixel-particle`

### 頂欄結構

`top-nav`：sticky、白底半透明 + backdrop blur + 1px 下邊框。左 `PixelAvocadoLogo(size=30)` + wordmark、中 nav tabs（active 底部 2px indigo indicator）、右狀態 pill。內容容器：`max-w-[1200px] mx-auto px-6`。

---

## 待處理事項

> 競賽核心 Demo 亮點（知識圖譜路徑尋找、遺忘曲線、掌握度趨勢、手寫 OCR）皆已完成。
> 剩餘項目全為賽後 / 選配，詳見 `plan.md`。

### 未完成（賽後 / 選配）

| # | 狀態 | 說明 |
|---|------|------|
| Bug 5 B | 選配 | 後端 `session_id` scope（需 DB schema migration）。方案 A（前端 modal）+ 方案 C（清除課程資料 DELETE endpoint）皆已完成，競賽夠用 |
| P6 | 賽後 | ChromaDB 存本地碟，Render free redeploy 後向量庫歸零 |
| A1 | 賽後 | 全域單例 → 完整多租戶（短期解已決策不做） |
| A4 | 賽後 | 拆 God object（`database.py` 806 行 / `pipeline.py` 628 行 / `App.tsx` 803 行 / `SetupPanel.tsx` 388 行 — react-doctor 標記 too-large，2026-06-08 加課程清單後增大）— 競賽期間勿動，純可維護性問題、不影響功能 |

---

# 工作規則

## CLAUDE.md 精簡規則

- 完成的功能（✅ DONE）和修復的 Bug（✅ FIXED）→ 記錄到 DEVLOG.md，從 CLAUDE.md 刪除
- CLAUDE.md 只保留「目前狀態」、「尚未完成事項」與「永久參考資料」（Tech Stack、API Routes 等）
- 超過 400 行時主動瘦身，不要累積歷史紀錄

## 模型分工
- 架構規劃、技術選型 → 用 Opus（/model opus）
- 寫程式、debug、實作 → 用 Sonnet（/model sonnet）

## 開始新功能前必做
1. 先切換到 Opus
2. 更新 plan.md（功能目標、技術方案、影響範圍）
3. 更新 devlog.md（日期 + 決策紀錄）
4. 確認後再切回 Sonnet 開始實作

## 強制檢查點
每當使用者說「開始做 X」「新增 X 功能」「來做 X」，
在寫任何程式碼之前，先提醒使用者：
「需要先切換到 Opus 規劃嗎？plan.md 還沒更新。」

## ⚠️ 更改程式碼前必須先說計畫（強制）

**在動任何一行程式碼之前，必須先向使用者說明以下內容：**

1. **目標：** 要解決什麼問題 / 實作什麼功能
2. **影響範圍：** 會動到哪些檔案（列出完整路徑）
3. **實作步驟：** 分步驟說明修改順序與邏輯
4. **風險提示：** 有沒有破壞性變更、需要 migration、或影響其他功能的地方

**等使用者確認「可以開始」之後，才能開始寫程式碼。**

> 這條規則沒有例外。就算是「小修正」「一行改動」「只改 CSS」也必須先說計畫。

## Git 工作流規則

### 分支命名
- 新功能：`feat/功能名稱`
- 修 bug：`fix/問題描述`
- UI 調整：`ui/頁面名稱`
- 比賽衝刺：`demo/功能名稱`

### 完成一個功能後自動執行
1. `git add .`
2. `git commit -m "類型(範圍): 描述"` — 用繁中描述
3. `git push origin 當前分支`

### Commit 訊息格式範例
feat(ocr): 新增手寫辨識 API 串接
fix(auth): 修正登入頁表單驗證
ui(landing): LandingScreen 像素酪梨 logo 完成

### 何時建新分支
使用者說「開始做 X」或「來實作 X」時，
先執行 `git checkout -b feat/X`，再開始寫程式。

### 何時 merge 回 main
使用者說「這個功能完成了」或「可以合併了」時，
執行 merge 並 push main。
