# AdaptLearn — CLAUDE.md

## Project Overview

AdaptLearn is an AI-powered adaptive learning platform for students. Students upload course materials (PDF, images, handwritten notes), and the system builds a knowledge graph, generates adaptive diagnostic quizzes, tracks mastery via spaced repetition (FSRS-5), and provides personalized study plans.

**Competition context:** This is a student learning website competition project. Correctness and feature completeness matter more than perfect abstraction.

> **DevLog:** chronological development & debugging history lives in `DEVLOG.md` (kept for the poster/report). Append a dated entry there when you finish notable work.

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
- `MAX_OCR_PAGES` — cap on scanned PDF pages sent to Gemini (default 12)
- `ALLOWED_ORIGINS` — comma-separated CORS origins
- `API_ACCESS_KEY` — if set, all `/api/*` routes require `X-API-Key` header
- `HEATMAP_UPLIFT_CAP`, `HEATMAP_UPLIFT_RATIO` — heatmap tuning
- `CHANDRA_METHOD` — `"vllm"` (default, needs running server) or `"hf"` (local model, ~10 GB download)
- `CHANDRA_VLLM_URL` — vLLM server URL for Chandra (default `http://localhost:8000/v1`)
- `OLLAMA_OCR_MODEL` — local Ollama vision model for primary on-device OCR (e.g. `qwen2.5vl:7b`); empty = disabled (so it is skipped on Render). Best for local demos: strong handwriting, no API cost, no proxy 502
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
| GET | `/api/graph` | Graphviz DOT string |
| GET | `/api/mastery/concepts` | Per-concept mastery scores |
| GET | `/api/mastery/chapters` | Per-chapter mastery |
| POST | `/api/diagnostics/generate` | Generate adaptive quiz questions |
| GET | `/api/questions` | List questions |
| POST | `/api/questions/{id}/grade` | Grade a student answer |
| POST | `/api/review/recalculate` | Rebuild FSRS review plan |
| GET | `/api/review` | Current review plan |
| GET | `/api/tonight` | Tonight study dashboard |
| GET | `/api/courses` | List uploaded courses |
| GET | `/api/cross-course-edges` | Semantic cross-course links |
| GET | `/api/heatmap/{course_id}` | Class error-rate heatmap |
| GET | `/api/heatmap/{course_id}/weak` | Top weak concepts |

---

## Database Schema (PostgreSQL)

Tables: `courses`, `concepts`, `concept_edges`, `cross_course_edges`, `questions`, `attempts`, `review_plan`, `class_node_stats`.

`StudyRepository` (`database.py`) manages all queries. Uses `ThreadedConnectionPool(minconn=1, maxconn=10)`. Schema is auto-created on startup via `initialize()`.

---

## File Ingestion Pipeline

`pdf_parser.py → pipeline.py (AdaptLearnService.ingest_material)`

Supported formats: `.pdf`, `.txt`, `.png`, `.jpg`, `.jpeg`, `.webp`, `.bmp`, `.tif`, `.tiff`

Flow:
1. Extract text from file (PyMuPDF for PDF, direct decode for TXT, bytes for images)
2. If text is too sparse (`< 40 chars`) → OCR fallback chain (first non-empty result wins):
   - **PDF:** **Ollama local vision OCR** (per-page images, on-device, opt-in via `OLLAMA_OCR_MODEL`, capped by `MAX_OCR_PAGES`) → **Chandra** (per-page images, also `MAX_OCR_PAGES`-capped) → **Gemini native PDF** (`GeminiClient.transcribe_pdf`, whole doc in ONE `application/pdf` call, no page cap) → **Gemini page-by-page vision** (`transcribe_images`, no cap).
   - **Image:** Ollama → Chandra → Gemini vision OCR.
   - `MAX_OCR_PAGES` only caps the **local** image paths (Ollama + Chandra, which render + infer on-device — they share one rendered page set). The Gemini paths are uncapped (pure API). When a doc exceeds the cap, local OCR is skipped (logged) and Gemini handles the full document.
3. Build knowledge graph via `knowledge_graph.py` (LLM extracts concepts + edges)
4. Optionally merge with domain seed templates (`domain_templates.py`)
5. Save to PostgreSQL + ChromaDB; discover cross-course links

OCR `source_type` values: `pdf-text` (native), `pdf-ollama-ocr` (local Ollama), `pdf-chandra-ocr`, `pdf-ocr` (Gemini native/vision), `image-ollama-ocr`, `image-chandra-ocr`, `image-ocr` (Gemini), `txt`.

### OCR internals (quick map — check here before re-opening the files)

- **Entry:** `pdf_parser.extract_material_text(file_name, file_bytes, gemini_client, chandra_client, ollama_client, ocr_context, max_ocr_pages)` → `ExtractedMaterial(text, source_type, ocr_used)`.
- **PDF order** (`pdf_parser._extract_pdf_material`): native text (PyMuPDF) if ≥ 40 chars, else Ollama → Chandra → Gemini native PDF → Gemini vision. Ollama + Chandra share one rendered page set and the `MAX_OCR_PAGES` cap; over-cap → local skipped (logged) → Gemini.
- **Image order** (`pdf_parser._transcribe_with_fallback`): Ollama → Chandra → Gemini.
- **Clients** (all expose `enabled` + `transcribe_images`): `ollama_client.OllamaClient` (stdlib `urllib` → Ollama `/api/generate`; opt-in via `OLLAMA_OCR_MODEL`; errors → `""` so it falls back), `chandra_client.ChandraClient` (vllm/hf — needs GPU, can't run in-process on Render free), `gemini_client.GeminiClient` (also `transcribe_pdf` for native PDF; 120 s `HttpOptions` timeout; API errors degrade to `""` via `_API_ERRORS`).
- **Wiring:** `pipeline.AdaptLearnService.__init__` builds `self.gemini/chandra/ollama`; `ingest_material` calls `extract_material_text` then `build_knowledge_graph`.
- **502 fix (only live after a push redeploy):** route `ingest_material` runs the sync ingest via `run_in_threadpool` (event loop stays free for health checks); Gemini calls capped at 120 s; frontend `useApi.ts errorMessage()` shows clean status-code messages instead of leaking proxy HTML.
- **Render reality:** no GPU / no Ollama → Chandra + Ollama disabled → Gemini is the only working OCR. Local demo → set `OLLAMA_OCR_MODEL` for best handwriting.

---

## UI Redesign (pending)

The entire frontend UI needs a full redesign. Current UI is functional but not polished enough for competition. When the user asks to redesign the UI, do a complete overhaul of all views (home, setup/教材, quiz/測驗, review/複習, graph/圖譜) with a more modern, visually appealing design.

Known UI issues to fix during redesign:
- Setup page text incorrectly says "手寫圖片與掃描 PDF 需要可用的 Gemini API 金鑰，否則請先做 OCR" — should reflect actual priority: Chandra OCR first, Gemini vision as fallback

---

## Planned Features (in-progress)

### 1. Handwritten Note Recognition ✅ DONE
- **Local demo (recommended): `ollama_client.OllamaClient`** runs a local Ollama vision model (e.g. `qwen2.5vl:7b`, same Qwen-VL family as Chandra) as the **primary** OCR — strongest handwriting, zero API cost, no proxy 502, offline. Opt-in via `OLLAMA_OCR_MODEL` (`ollama pull qwen2.5vl:7b` first). For OCR-ing a long doc fully on-device, raise `MAX_OCR_PAGES` (else over-cap docs fall through to Gemini).
- Integrated `chandra-ocr` (datalab-to/chandra on GitHub) — handwriting-aware document intelligence
- `src/adaptlearn/chandra_client.py` wraps `InferenceManager`; supports `vllm` and `hf` backends. **Needs a GPU** (HF backend ≈ 16–24 GB VRAM for Qwen3-VL; vllm needs a server) so it can't run in-process on Render free. The Datalab **hosted Chandra API** (datalab.to, ~$5 free credits) is the no-GPU cloud alternative if you ever want managed Chandra.
- `pdf_parser.py` OCR order is Ollama → Chandra → Gemini; `source_type` values include `image-chandra-ocr`, `pdf-chandra-ocr`, `image-ollama-ocr`, `pdf-ollama-ocr`
- Configure via `OLLAMA_OCR_MODEL` / `OLLAMA_URL`, or `CHANDRA_METHOD` / `CHANDRA_VLLM_URL` in `.env`

### 2. Learning Progress Tracking Algorithm
- New endpoint(s) to expose per-concept progress over time (not just current mastery)
- Track attempt history timelines; surface trend signals (improving / declining / plateaued)
- Extend `models.py` and `database.py` as needed; expose via new API routes

### 3. Mind Map Visualization ✅ DONE (frontend)
- The 圖譜 (Graph) view now renders a **radial SVG mind map** instead of the old force-directed graph.
- Components: `MindMapCanvas.tsx` + `MindMapLegend` (replace `ForceGraphCanvas.tsx`).
- Layout: centre node = course name → first ring = chapters (coloured by hue) → outer ring = concept pills (coloured by mastery status).
- Edges: trunk lines (centre→chapter), branch lines (chapter→concept), prerequisite/progression curved Bezier arrows between concepts.
- Interaction: mouse-drag pan, scroll-wheel zoom, click concept pill to see detail panel.
- No new npm dependencies — pure SVG + React. `react-force-graph-2d` still in package.json but no longer used in the main graph view.

---

## Known Bugs

### Bug 1: OCR failure silently falls back to a generic template ✅ FIXED
- When a handwritten/scanned upload yielded `< 40` chars AND OCR produced nothing, `pipeline.ingest_material` quietly substituted the linear-algebra seed template, so the student saw 16 canned concepts and assumed their notes were processed — they weren't.
- **Fix applied:** in the `template-fallback` branch, `pipeline.ingest_material` now sets `ocr_failed: true` plus a clear Chinese `ocr_message`, and also surfaces `llm_last_error`. `SetupPanel.tsx` renders a distinct **red** warning (separate from the amber `llm_degraded` notice) and the success status line turns neutral when `ocr_failed` is true, so template-fallback no longer looks like a successful ingest.

### Bug 2: Gemini error handling doesn't match the new `google-genai` SDK ✅ FIXED
- `_API_ERRORS` was built only from `google.api_core.exceptions` (old SDK), so new-SDK failures (`google.genai.errors.APIError` / `ClientError` / `ServerError` — invalid key, quota, bad model) hit `except Exception: raise` and became HTTP 500 instead of degrading.
- **Fix applied:** `gemini_client.py` now defensively imports `google.genai.errors` and includes `APIError` (base of `ClientError`/`ServerError`) in `_API_ERRORS`; the old `api_core` types are kept for backward compat. Verified with an invalid key: a 401 is caught, logged, `last_error` set, and `extract_concepts` returns `[]` instead of raising.

### Bug 3: Handwritten PDF on Render produces template concepts instead of real OCR — ✅ RESOLVED (was a blocked API key)
- **Resolution (2026-06-03):** the original Render key was service-blocked because the Generative Language API was not enabled on its project. Enabling the API on a project (`my-project-avocado-498303`) and generating a fresh AI Studio key fixed it — the new `AQ.` key now lists models successfully via the `google-genai` SDK (`x-goog-api-key` path), so the raw-curl `ACCESS_TOKEN_TYPE_UNSUPPORTED` quirk does not affect the actual app. Action items: paste the working key into Render `GEMINI_API_KEY`, optionally set `GEMINI_MODEL=gemini-2.5-flash`, redeploy, and re-test the handwritten PDF. Investigation detail kept below.

- **Code fixes applied (good hygiene, but NOT the root cause):** `requirements.txt` bumped `google-genai>=0.3.0 → >=1.20.0`; Bug 1 + Bug 2 fixes mean a Gemini failure is now caught and the template-fallback is loudly flagged instead of masquerading as success.
- **Confirmed root cause (2026-06-03, via curl tests against the live key):** the Render `GEMINI_API_KEY` is a new-format `AQ.`-prefixed AI Studio key, and it does NOT work:
  - `?key=` (query param) and `x-goog-api-key` header (what the SDK uses) both return `401 ACCESS_TOKEN_TYPE_UNSUPPORTED` — this is Google's *acknowledged* compatibility bug with `AQ.` keys (see forum; Google's workaround is "generate a non-`AQ.` key").
  - `Authorization: Bearer` returns `401 API_KEY_SERVICE_BLOCKED` — the key is recognized but blocked from the Generative Language API (API not enabled on its project, billing off, or key auto-blocked as leaked).
  - Net: `AQ.` ≠ invalid format, but this specific key is both compat-broken (for the SDK path) and service-blocked. No SDK version fixes a blocked key.
- **Fix (Google Cloud / Render, no code change):**
  1. Enable **Generative Language API** + **billing** on the key's GCP project; ensure the key has no API restrictions.
  2. Generate a fresh key (the old one was exposed in plaintext during debugging — treat as leaked). Prefer "Create API key in new project" which auto-enables the API.
  3. Verify BEFORE deploying: `curl "https://generativelanguage.googleapis.com/v1beta/models?key=<NEWKEY>"` must return a `models` list. If a new `AQ.` key still 401s on `?key=`, regenerate until you get a non-`AQ.` key (Google's own workaround).
  4. Paste the working key into Render `GEMINI_API_KEY` → redeploy.
- Note: Chandra always fails on Render (`CHANDRA_METHOD=vllm` → `localhost:8000`, no vLLM server) — expected; the Gemini fallback is what must work.

### Bug 4: Stale test uses removed `Settings(database_path=...)` field — ✅ FIXED
- `tests/test_unit.py::test_scanned_pdf_uses_configurable_ocr_page_limit` called `Settings(database_path=..., ...)`, but `Settings` switched to `database_url` in the SQLite→PostgreSQL migration, so it failed with `TypeError: unexpected keyword argument 'database_path'`.
- **Fix applied:** the field was renamed to `database_url=_TEST_DB_URL` (consistent with the other fixtures). The `TypeError` is gone; the service-based test still needs a live PostgreSQL (`DATABASE_URL`) to run, like most unit tests.
- **Test coverage added (`TestNativePdfTranscription`):** new regression tests at the `pdf_parser` level (no DB required) lock in the native-PDF behavior from commit `141a6bd`: a Gemini client exposing `transcribe_pdf` bypasses `MAX_OCR_PAGES` (28 pages, cap 1 → accepted, `source_type="pdf-ocr"`), while a client without it still enforces the cap. The page limit only gates the per-page image OCR path (Chandra), not native PDF transcription.

---

## Key Algorithms

**Spaced repetition:** FSRS-5 (`review_scheduler.py`). Each concept is a `Card`; attempt history is replayed to reconstruct card state; `retrievability` drives `priority` (0=fresh, 1=forgotten).

**Adaptive question selection** (`pipeline.py _select_weak_concepts`): ranks concepts by `1 - avg_score`; untested concepts get priority 1.0.

**Pass probability estimate** (`pipeline.py _estimate_pass_probability`):
`P = 0.32 + 0.46·avg_score + 0.16·accuracy + 0.06·experience_bonus` — empirical placeholder, not validated.

**Mastery bands:** green ≥ 0.75, yellow ≥ 0.5, red < 0.5.

---

## Frontend Views (App.tsx)

> **入口 gate（第二批規劃中）：** app 啟動先顯示全螢幕 `LandingScreen`（`showLanding` 預設 true，不渲染頂欄），
> 點「開始學習」後才淡入下方 5-view 主儀表板。詳見 plan.md 第二批。

SPA with 5 views routed via `window.history`:

| Key | Path | Component |
|---|---|---|
| `home` | `/` | Dashboard — DailyProgressRing, InsightFeed, MetricCardsGrid |
| `setup` | `/setup` | SetupPanel — file upload, course config |
| `quiz` | `/quiz` | QuizPanel — adaptive quiz |
| `review` | `/review` | StudyPlansPanel + TonightPanel |
| `graph` | `/graph` | KnowledgeGraphPanel + ClassHeatmapPanel |

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

## UI/UX Redesign — 明亮專業（LeetCode-inspired）(2026-06)

> **方向轉折（2026-06-04）：** 初版走深色「Synaptic」科技風，使用者回饋仍有「廉價科技感」+ 版面問題。
> 改採 **LeetCode 式明亮專業** 主題：白底中性灰 + 釘住頂欄 + 結構化網格 + 顏色只用在有意義的狀態。
> 廉價感根源已定位並移除：霓虹漸層大字、過度毛玻璃、超大圓角浮島、行銷式 Hero。
>
> **像素風點綴方向（2026-06-04）：** 明亮專業底 + 少量像素裝飾，讓競賽作品有記憶點。
> 像素元素只用在「裝飾性位置」（空狀態插圖、答對粒子、圖譜中心節點、熱力格子），不改正文字型。
> 每頁最多 1~2 個像素元素。技術手法：純 SVG `<rect>` 格子圖、`box-shadow` 階梯邊框、4×4 方塊粒子。

### 設計語言規範（定義於 `index.css`）

**色彩系統（light tokens）：**
```
背景：--bg-app #f5f6f8 / --bg-surface #ffffff / --bg-subtle #f7f8fa / --bg-sunken #f0f1f4
邊框：--border #e6e8ec / --border-strong #d7dade / --border-hover #c2c7cf
文字：--text-primary #16181d / --text-secondary #5a616b / --text-muted #8b929c
品牌強調（節制使用）：--accent #4f46e5（indigo）/ --accent-soft #eef0fe
語意色（只用於掌握度/難度）：--high #0ea472（綠）/ --medium #d98a04（琥珀）/ --low #e11d48（玫紅）
陰影：--shadow-sm / --shadow-card / --shadow-pop（light 適用，極淡）
```

**字型：**
- UI / 標題：`Plus Jakarta Sans`（`.font-display` letter-spacing -0.02em）
- 數字/統計：`DM Mono`（`.stat-value` / `.font-mono-data`，tabular-nums）
- 中文：`Noto Sans TC`
- （已移除 Syne — 對亮色乾淨風格過於 display）

**核心 utility classes：**
- 卡片：`.card` / `.card-flat` / `.card-subtle` / `.card-interactive`（hover 上浮）
- 按鈕：`.btn-primary`（indigo）/ `.btn-secondary` / `.btn-ghost`
- 輸入：`.input`（focus 有 accent ring）
- 標籤/狀態：`.pill` / `.tag-high|medium|low` / `.status-dot(.live/.signal/.weak/.neural)`
- 統計卡：`.stat-card`（左側 3px accent-bar）
- 掌握度條：`.mastery-bar-track` / `.mastery-bar-fill`（紅→琥珀→綠漸層）

### 結構：釘住頂欄（取代浮島 nav）

- `top-nav`：sticky、全寬、白底半透明 + 1px 下邊框 + backdrop blur
- 左 Logo+wordmark、中 nav tabs（active 有底部 2px indigo indicator）、右 狀態 pill + 進度環 + 學生模式
- 內容容器：`max-w-[1200px] mx-auto px-6`，響應式 mobile 另有橫向 tab bar

### ⚠️ 遷移機制：`.legacy-surface`（暫時性）

未改造的子頁面（setup/quiz/review/graph 內的舊元件）仍用 `text-white`，在白底會看不見。
過渡期把這些子頁面內容包在 `.legacy-surface`（暗色包裹層，局部還原舊深色 glass 樣式）保持可讀。
**每個子頁面改造成亮色元件後，就移除它外層的 `.legacy-surface` 包裹。** 全部完成後可刪掉這段 CSS。

### 各頁面重設計方向

| 頁面 | 主要改動 |
|------|---------|
| **Home** ✅ | 亮色儀表板：問候卡（date pill + blob 裝飾）+ 動態統計卡（text-5xl + trend badge）+ 工作流程 timeline + next-up 卡 + AI 洞察（左側彩色 border + SVG 空狀態插圖） |
| **Setup** | 大型拖曳上傳區（`.upload-zone`）+ 3 步驟進度條 + **🎮 像素風上傳空狀態插圖** |
| **Quiz** | 圓弧進度（`.quiz-arc-*`）+ **🎮 `.pixel-particle` 方塊答對特效** + 空測驗像素插圖 |
| **Review** | 三節點保留率視覺 + 掌握度漸層條（`.mastery-bar-*`）+ **🎮 掌握度 100% 像素星星彩蛋** |
| **Graph** | SVG edge 電流動畫 + **🎮 中心節點 `.pixel-border`（方塊感）** + 熱力格子（無圓角，GitHub 貢獻圖風） |

### 競賽加分視覺細節（CSS 已備好）

1. 首頁統計數字 `CountUp`（easeOutCubic，0→真實值，0.8s）✅
2. Nav active 底部 indigo indicator
3. 上傳 `.scan-line` 處理掃描線 + `.upload-zone` hover
4. 測驗答對 `.pixel-particle`（4×4 方塊，向上飄散）— 替代圓形 `.particle`
5. 圖譜 `.graph-edge-animated`（stroke-dashoffset 流動）
6. 頁面切換 `.view-enter`（opacity + translateY）✅
7. 卡片 hover 上浮（`.card-interactive` / `.stat-card`）✅
8. **🎮 像素風空狀態插圖**（Setup / Quiz 空狀態，純 SVG `<rect>` 格子畫法）
9. **🎮 圖譜中心節點 `.pixel-border`**（box-shadow 模擬階梯邊框，無圓角）
10. **🎮 熱力格子**（ClassHeatmapPanel，2px gap 無圓角，hover tooltip）

### 實作進度追蹤

- [x] `index.css` — 全面改寫為 light 主題 + tokens + utility classes + `.legacy-surface` 過渡層（2026-06-04）
- [x] `App.tsx` — 釘住頂欄 + 亮色首頁儀表板 + `CountUp` 元件 + date pill + 工作流程 timeline + next-up 卡（2026-06-04）
- [x] `DailyProgressRing.tsx` — SVG arc 進度環（更平滑，帶 transition 動畫）（2026-06-04）
- [x] `InsightFeed.tsx` — 左側彩色 border + SVG 空狀態插圖（2026-06-04）
- [x] `SetupPanel.tsx` — 改亮色元件 + 上傳區 + 進度步驟條 + 🎮 像素風插圖 → 移除 legacy-surface（2026-06-04）
- [x] `QuizPanel.tsx` — 改亮色 + 圓弧進度 + 🎮 `.pixel-particle` 答對方塊特效 → 移除 legacy-surface（2026-06-04）
- [x] `StudyPanels.tsx` + `MasteryTable.tsx` — 改亮色 + 掌握度漸層條 + 🎮 100% 星星彩蛋 → 移除 legacy-surface（2026-06-04）
- [x] `MindMapCanvas.tsx` + `KnowledgeGraphPanel.tsx` — 亮色 + edge 動畫 + 🎮 中心節點 pixel-border → 移除 legacy-surface（2026-06-04）
- [x] `ClassHeatmapPanel.tsx` — 🎮 熱力格子（無圓角，2px gap，GitHub 貢獻圖風）（2026-06-04）

### 第二批：登入頁 + 像素酪梨 logo + Emil 級動效打磨（2026-06-04 規劃，待 Sonnet 實作）

> 設計與逐任務步驟見 `plan.md`「🟢 本回合優先（第二批）」。依 Emil Kowalski 設計工程哲學
> （`.agents/skills/emil-design-eng/SKILL.md`）：自訂 easing、按壓 `scale(0.97)`、絕不從 `scale(0)` 入場、
> 進場慢/離場快、stagger、只動 `transform`/`opacity`、補 `prefers-reduced-motion`。

- **新品牌資產 — 像素酪梨 logo**：`components/PixelAvocadoLogo.tsx`（純 SVG `<rect>`）。
  ⚠️ **目前是 AI 暫時版，使用者將自行設計最終版本**（2026-06-04）。
  替換時保持 `export function PixelAvocadoLogo({ size, className, withPulse })`，頂欄 `size={30}`、登入頁 `size={104}`。
- **新入口頁 — 全螢幕極簡登入**：`components/LandingScreen.tsx`。`showLanding` gate（預設 true，**每次重整都顯示入場**）：
  大酪梨 logo → 字標 → tagline → 單一「開始學習 →」按鈕 → 「已支援 PDF・手寫・圖片」。stagger 入場、離場較快後淡入主儀表板。
  landing 期間不渲染頂欄。

- [x] `index.css` — 加 `--ease-out/--ease-in-out/--ease-drawer` token；按鈕 `:active` 改 `scale(0.97)`；消滅 `transition: all`；hover 加 `@media (hover:hover)`；補 `prefers-reduced-motion`（2026-06-04）
- [x] `PixelAvocadoLogo.tsx`（新）— AI 暫時版像素酪梨，使用者將替換為自製版（2026-06-04）
- [x] `LandingScreen.tsx`（新）— 全螢幕極簡入口頁 + stagger 入場 + 快速離場（2026-06-04）
- [x] `App.tsx` — `showLanding` gate（landing 不渲染頂欄）+ 頂欄換酪梨 logo + 首頁 stat-card stagger 入場（2026-06-04）
- [x] `App.tsx` — fix: Landing 點「開始學習」改為導向首頁（而非上次 URL）；首頁 stat cards 用 `sessionUploaded` gate 防殘留資料（2026-06-04）
- [ ] `PixelAvocadoLogo.tsx` — 使用者自製最終版 logo（待完成）
- [ ] 子頁面遷移（第一批 5 項）維持原計畫，本回合不動



# 工作規則

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