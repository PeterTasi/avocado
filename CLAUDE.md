# AdaptLearn — CLAUDE.md

## Project Overview

AdaptLearn is an AI-powered adaptive learning platform for students. Students upload course materials (PDF, images, handwritten notes), and the system builds a knowledge graph, generates adaptive diagnostic quizzes, tracks mastery via spaced repetition (FSRS-5), and provides personalized study plans.

**Competition context:** This is a student learning website competition project. Correctness and feature completeness matter more than perfect abstraction.

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
│   ├── chandra_client.py        # Chandra OCR wrapper (handwriting-aware; vllm/hf backends)
│   ├── gemini_client.py         # Gemini API wrapper (transcription, quiz gen, grading)
│   ├── pdf_parser.py            # File ingestion: PDF/TXT/image → text + OCR (Chandra→Gemini)
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
2. If text is too sparse (`< 40 chars`) → OCR fallback chain: **Chandra OCR first → Gemini vision OCR second**
3. Build knowledge graph via `knowledge_graph.py` (LLM extracts concepts + edges)
4. Optionally merge with domain seed templates (`domain_templates.py`)
5. Save to PostgreSQL + ChromaDB; discover cross-course links

OCR `source_type` values: `pdf-text` (native), `pdf-chandra-ocr`, `pdf-ocr` (Gemini), `image-chandra-ocr`, `image-ocr` (Gemini), `txt`.

---

## UI Redesign (pending)

The entire frontend UI needs a full redesign. Current UI is functional but not polished enough for competition. When the user asks to redesign the UI, do a complete overhaul of all views (home, setup/教材, quiz/測驗, review/複習, graph/圖譜) with a more modern, visually appealing design.

Known UI issues to fix during redesign:
- Setup page text incorrectly says "手寫圖片與掃描 PDF 需要可用的 Gemini API 金鑰，否則請先做 OCR" — should reflect actual priority: Chandra OCR first, Gemini vision as fallback

---

## Planned Features (in-progress)

### 1. Handwritten Note Recognition ✅ DONE
- Integrated `chandra-ocr` (datalab-to/chandra on GitHub) — handwriting-aware document intelligence
- `src/adaptlearn/chandra_client.py` wraps `InferenceManager`; supports `vllm` and `hf` backends
- `pdf_parser.py` uses Chandra first, falls back to Gemini; new `source_type` values: `image-chandra-ocr`, `pdf-chandra-ocr`
- Configure via `CHANDRA_METHOD` / `CHANDRA_VLLM_URL` in `.env`

### 2. Learning Progress Tracking Algorithm
- New endpoint(s) to expose per-concept progress over time (not just current mastery)
- Track attempt history timelines; surface trend signals (improving / declining / plateaued)
- Extend `models.py` and `database.py` as needed; expose via new API routes

### 3. Mind Map Generation
- After material ingestion, auto-generate a mind map from the concept graph
- Output format TBD (JSON tree for frontend rendering, or Mermaid/DOT string)
- Add `POST /api/mindmap/{course_id}` endpoint
- Frontend: new view or panel in the graph page

---

## Known Bugs

### Bug 1: OCR failure silently falls back to a generic template ✅ FIXED
- When a handwritten/scanned upload yielded `< 40` chars AND OCR produced nothing, `pipeline.ingest_material` quietly substituted the linear-algebra seed template, so the student saw 16 canned concepts and assumed their notes were processed — they weren't.
- **Fix applied:** in the `template-fallback` branch, `pipeline.ingest_material` now sets `ocr_failed: true` plus a clear Chinese `ocr_message`, and also surfaces `llm_last_error`. `SetupPanel.tsx` renders a distinct **red** warning (separate from the amber `llm_degraded` notice) and the success status line turns neutral when `ocr_failed` is true, so template-fallback no longer looks like a successful ingest.

### Bug 2: Gemini error handling doesn't match the new `google-genai` SDK ✅ FIXED
- `_API_ERRORS` was built only from `google.api_core.exceptions` (old SDK), so new-SDK failures (`google.genai.errors.APIError` / `ClientError` / `ServerError` — invalid key, quota, bad model) hit `except Exception: raise` and became HTTP 500 instead of degrading.
- **Fix applied:** `gemini_client.py` now defensively imports `google.genai.errors` and includes `APIError` (base of `ClientError`/`ServerError`) in `_API_ERRORS`; the old `api_core` types are kept for backward compat. Verified with an invalid key: a 401 is caught, logged, `last_error` set, and `extract_concepts` returns `[]` instead of raising.

### Bug 3: Handwritten PDF on Render produces template concepts instead of real OCR — ⚠️ ROOT CAUSE CONFIRMED (it's the API key, not the SDK)
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
