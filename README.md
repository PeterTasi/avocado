# AdaptLearn AI Diagnostic System

**2026/09/10** · Runner-up, 2026 CYCU AI Teaching & Learning Competition (Student Division)

**從教材建立知識圖譜，追溯可能的先修弱點，再透過診斷測驗與複習排程，知道下一步該讀什麼。**

## 52 秒專案展示

**[▶ 觀看有聲操作影片（MP4）](media/adaptlearn-demo-neural.mp4)** · 52 秒 · 中文旁白＋背景音樂 · 繁體中文字幕

「我到底為什麼不會，是從哪裡開始不會的？」影片以實際介面與示範資料，展示技能樹、先修弱點追溯、診斷測驗、複習安排與跨課程連結。

| 時間 | 展示內容 |
|---|---|
| 00:00 | 專案解決的問題 |
| 00:07 | 從教材整理出的概念 |
| 00:13 | 有先修關係的技能樹 |
| 00:18 | 點選概念，追溯可能的先修缺口 |
| 00:24 | 作答與批改回饋 |
| 00:34 | 個人化複習安排 |
| 00:41 | 跨課程知識連結 |
| 00:46 | 找出缺口，知道下一步該補什麼 |

## Core Features

AdaptLearn connects course materials, diagnostic questions, and learning history:

- Cross-context concept graph from uploaded course materials.
- Adaptive diagnostic quiz generation.
- Learning-history-based review scheduler.
- Linear algebra seed graph enhancement for better concept coverage.
- Red-yellow-green mastery heatmap and chapter summary.
- Tonight study dashboard with estimated pass-rate uplift.

## Tech Stack

- Python 3.11
- FastAPI (web backend API)
- React + Tailwind CSS + Lucide + Recharts (web frontend)
- Gemini API (LLM reasoning, question generation, grading)
- SQLite (attempt history and plans)
- ChromaDB (concept vector retrieval)
- PyMuPDF (PDF parsing)

## Project Structure

```text
.
├── webapp/
│   ├── main.py
│   ├── frontend/
│   │   ├── src/
│   │   ├── package.json
│   │   └── vite.config.js
│   └── static/
│       ├── index.html
│       └── assets/
├── requirements.txt
├── .env.example
├── data/
├── scripts/
└── src/adaptlearn/
    ├── config.py
    ├── database.py
    ├── gemini_client.py
    ├── knowledge_graph.py
    ├── models.py
    ├── pdf_parser.py
    ├── pipeline.py
    ├── quiz_engine.py
    ├── review_scheduler.py
    └── vector_store.py
```

## Quick Start

1. Create and activate a virtual environment.

```bash
python3.11 -m venv .venv
source .venv/bin/activate
```

2. Install dependencies.

```bash
pip install -r requirements.txt
```

3. Configure environment variables.

```bash
cp .env.example .env
```

Then set your `GEMINI_API_KEY` in `.env`.

If you expect long scanned PDFs, you can also raise the OCR page cap in `.env`:

```bash
MAX_OCR_PAGES=24
```

4. Build frontend assets.

```bash
cd webapp/frontend
npm install
npm run build
cd ../..
```

5. Run the web app (recommended).

```bash
uvicorn webapp.main:app --reload --host 0.0.0.0 --port 8000
```

Then open `http://localhost:8000`.

### Frontend Development Mode (optional)

```bash
cd webapp/frontend
npm install
npm run dev
```

Then open `http://localhost:5173`.

## Workflow

1. Upload a PDF/TXT/image material and build the concept graph.
2. Generate adaptive diagnostics for weak concepts.
3. Submit answers to get AI grading + feedback.
4. Recalculate the review schedule to get a prioritized tonight plan.

### Ingestion Modes

- `generic` (default): extract concepts from actual lecture text only.
- `linear-algebra`: explicitly enable linear algebra template fallback.
- `auto`: detect likely linear algebra course names before using template.

If a PDF has almost no selectable text (scanned handwriting), the app can try Gemini vision transcription when a Gemini API key is configured. Otherwise, use OCR first or choose an explicit template.

## Notes

- If Gemini key is empty, the app still runs with local heuristic fallback behavior.
- Handwritten images and scanned PDFs require Gemini vision transcription or an external OCR step before ingest.
- Scanned-PDF OCR page cap is configurable with `MAX_OCR_PAGES` in `.env`.
- Data is persisted in `data/adaptlearn.db` and Chroma storage under `data/chroma/`.

## Tests

Run the workflow regression tests:

```bash
python -m unittest discover -s tests -p "test_*.py"
```

## Share Architecture with Gemini

Generate a clean architecture handoff bundle:

```bash
./scripts/prepare_gemini_arch_pack.sh
```

Then upload the `gemini_arch_pack/` folder to Gemini.
It includes:

- `GEMINI_ARCHITECTURE_BRIEF.md`
- `GEMINI_REVIEW_PROMPT.txt`
- Core backend/frontend/test files needed for architecture review

## Suggested Next Milestones

1. Add chapter-level graph visualization and confidence heatmap.
2. Add exam outcome tracking dashboard (midterm/final deltas).
3. Improve adaptive item selection using IRT-style difficulty estimation.
4. Export study plans and progress reports as PDF.
