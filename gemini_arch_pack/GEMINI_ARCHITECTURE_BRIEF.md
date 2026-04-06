# AdaptLearn Architecture Brief for Gemini

Last updated: 2026-04-05

## 1. Product Scope

AdaptLearn is an AI-assisted learning diagnostics platform.

Core outcomes:
- Ingest PDF/TXT learning materials.
- Build a concept graph with dependencies.
- Generate adaptive diagnostics based on weak concepts.
- Grade answers and store learning history.
- Build review plans and a tonight-study dashboard.

## 2. Runtime Topology

- Backend API: FastAPI app in webapp/main.py.
- Frontend UI: React + Tailwind static build served from webapp/static.
- Domain layer: AdaptLearnService in src/adaptlearn/pipeline.py.
- LLM client: GeminiClient in src/adaptlearn/gemini_client.py.
- Storage:
  - SQLite for concepts, edges, questions, attempts, review plan.
  - ChromaDB for concept vector retrieval.

## 3. End-to-End Data Flow

1. User uploads material through POST /api/material/ingest.
2. Backend parses text with extract_text(...).
3. Service decides ingest mode:
   - text-extraction: use material text + concept extraction pipeline.
   - template-fallback: allowed only when explicit template mode and low text.
4. Concept graph and edges are produced.
5. Existing corpus state is reset for consistency.
6. Concepts and edges are stored in SQLite.
7. Concepts are upserted into ChromaDB, replacing prior vectors.
8. User requests diagnostics with POST /api/diagnostics/generate.
9. Weak concepts are selected from attempt history.
10. Questions are generated (LLM first, template fallback if needed).
11. User submits answer via POST /api/questions/{id}/grade.
12. Grading result is returned and attempt is stored.
13. Review plan can be recalculated via POST /api/review/recalculate.
14. Tonight dashboard is fetched from GET /api/tonight.

## 4. Main API Surface

Static:
- GET /

Operational:
- GET /api/health
- POST /api/config/api-key
- POST /api/material/ingest
- GET /api/concepts
- GET /api/graph
- GET /api/mastery/concepts
- GET /api/mastery/chapters
- POST /api/diagnostics/generate
- GET /api/questions
- POST /api/questions/{question_id}/grade
- POST /api/review/recalculate
- GET /api/review
- GET /api/tonight

## 5. Storage Model (High Level)

SQLite tables:
- concepts
- concept_edges
- questions
- attempts
- review_plan

Vector storage:
- Chroma collection: adaptlearn_concepts

## 6. Important Behavior Rules

- Generic mode is default and should be document-driven.
- Very low-text files in generic mode are rejected with OCR guidance.
- Template fallback is explicit or mode-driven, not silent by default.
- New material ingest resets prior learning corpus state.
- API layer uses short TTL caching and invalidates affected keys after mutations.

## 7. Current Quality Signals

- Regression tests exist in tests/test_service_workflow.py.
- Verified scenarios:
  - Generic ingest succeeds on readable text.
  - Generic ingest rejects near-empty text.
  - Diagnostic generation, grading, and review planning execute end-to-end.

## 8. Known Risks / Technical Debt

- Gemini SDK migration is completed (google.genai); still monitor model/response compatibility as APIs evolve.
- Frontend production bundle is relatively large and flagged by Vite warning.
- Caching layer is in-memory and single-process scope only.
- There is no full integration test that runs HTTP routes end-to-end with TestClient.

## 9. File Set to Provide Gemini

Always include:
- README.md
- webapp/main.py
- src/adaptlearn/pipeline.py
- src/adaptlearn/knowledge_graph.py
- src/adaptlearn/gemini_client.py
- src/adaptlearn/database.py
- src/adaptlearn/vector_store.py
- webapp/frontend/src/App.jsx
- tests/test_service_workflow.py

Do not include:
- .env
- data/adaptlearn.db
- data/chroma
- webapp/frontend/node_modules

## 10. Suggested Ask to Gemini

Use GEMINI_REVIEW_PROMPT.txt for a structured architecture review request.
