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
