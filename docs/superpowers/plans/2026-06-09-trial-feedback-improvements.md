# 朋友試用回饋改善 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 依朋友試用回饋改善 4 處：心智圖力導向佈局、概念卡片網格＋抽屜詳解、結構化深度詳解（lazy 生成）、學習內容中/英/中英語言選項。

**Architecture:** 後端新增「概念詳解 lazy 生成＋快取」（`concept_details` 表）與測驗語言參數；前端把概念清單改為卡片網格＋右側抽屜（spring 動畫＋酪梨蓋章），心智圖改自寫力導向佈局。語言只影響學習內容、UI 維持中文。不新增 npm 套件。

**Tech Stack:** FastAPI + psycopg2（PostgreSQL）、Google Gemini、React 18 + TS + React Query + Tailwind、KaTeX（既有 MathRenderer）、pytest。

**Spec:** `docs/superpowers/specs/2026-06-09-trial-feedback-improvements-design.md`

**語言碼約定：** 概念詳解 `lang ∈ {zh, en}`（中英對照＝前端分別請求 zh 與 en 後上下堆疊）。測驗 `language ∈ {zh, en, both}`（`both`＝單次雙語生成，不快取）。

---

## Phase 1 — 後端：概念深度詳解 lazy 生成＋快取（#3 + #4 概念語言）

> 可獨立交付：完成後 `GET /api/concepts/{id}/detail?lang=zh` 可用。

### Task 1: `ConceptDetail` 資料模型

**Files:**
- Modify: `src/adaptlearn/models.py`
- Test: `tests/test_models_concept_detail.py`

- [ ] **Step 1: Write the failing test**

```python
# tests/test_models_concept_detail.py
from adaptlearn.models import ConceptDetail


def test_concept_detail_defaults():
    d = ConceptDetail(concept_id="c-1", language="zh")
    assert d.concept_id == "c-1"
    assert d.language == "zh"
    assert d.definition == ""
    assert d.key_points == []
    assert d.example == ""
    assert d.common_mistakes == ""
    assert d.has_formula is False


def test_concept_detail_full():
    d = ConceptDetail(
        concept_id="c-2",
        language="en",
        definition="A definition.",
        key_points=["p1", "p2"],
        example="An example.",
        common_mistakes="A pitfall.",
        has_formula=True,
    )
    assert d.key_points == ["p1", "p2"]
    assert d.has_formula is True
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_models_concept_detail.py -v`
Expected: FAIL — `ImportError: cannot import name 'ConceptDetail'`

- [ ] **Step 3: Add the dataclass**

在 `src/adaptlearn/models.py` 既有 `Concept` dataclass 之後新增：

```python
@dataclass(slots=True)
class ConceptDetail:
    concept_id: str
    language: str  # "zh" | "en"
    definition: str = ""
    key_points: list[str] = field(default_factory=list)
    example: str = ""
    common_mistakes: str = ""
    has_formula: bool = False
```

（`field` 已在檔案頂端 `from dataclasses import dataclass, field` 匯入；若無則補上。）

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/test_models_concept_detail.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/adaptlearn/models.py tests/test_models_concept_detail.py
git commit -m "feat(models): 新增 ConceptDetail dataclass"
```

---

### Task 2: `concept_details` 表 migration ＋ get/save 查詢

**Files:**
- Modify: `src/adaptlearn/database.py:174` (migrations list)、新增兩個方法 ＋ migration function
- Test: `tests/test_database_concept_detail.py`

> 注意：本專案 integration 測試用真實 DB（CLAUDE.md：不要 mock psycopg2）。本測試需可連線的 `DATABASE_URL`，與既有 `tests/test_api_integration.py` 同條件。

- [ ] **Step 1: Write the failing test**

```python
# tests/test_database_concept_detail.py
import os
import uuid
import pytest
from adaptlearn.database import StudyRepository
from adaptlearn.models import ConceptDetail

pytestmark = pytest.mark.skipif(
    not os.getenv("DATABASE_URL"), reason="needs DATABASE_URL"
)


@pytest.fixture
def repo():
    r = StudyRepository(os.environ["DATABASE_URL"])
    r.initialize()
    yield r
    r.close()


def test_save_and_get_concept_detail(repo):
    cid = f"c-test-{uuid.uuid4().hex[:8]}"
    detail = ConceptDetail(
        concept_id=cid, language="zh",
        definition="定義", key_points=["重點1", "重點2"],
        example="範例", common_mistakes="誤區", has_formula=True,
    )
    repo.save_concept_detail(detail)
    got = repo.get_concept_detail(cid, "zh")
    assert got is not None
    assert got.definition == "定義"
    assert got.key_points == ["重點1", "重點2"]
    assert got.has_formula is True
    # 不同語言查不到
    assert repo.get_concept_detail(cid, "en") is None


def test_get_missing_returns_none(repo):
    assert repo.get_concept_detail("c-does-not-exist", "zh") is None
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_database_concept_detail.py -v`
Expected: FAIL — `AttributeError: 'StudyRepository' object has no attribute 'save_concept_detail'`

- [ ] **Step 3: Add migration + methods**

在 `database.py` 的 `migrations` list（約第 174 行）加入第 2 號 migration：

```python
        migrations = [
            (1, self._migration_001_add_timestamptz),
            (2, self._migration_002_concept_details),
        ]
```

在 `_migration_001_add_timestamptz` 之後新增 migration function：

```python
    def _migration_002_concept_details(self) -> None:
        """Lazy 概念深度詳解快取表（每概念 × 語言一列）。append-only，不動既有表。"""
        with self._connect() as cur:
            cur.execute("""
                CREATE TABLE IF NOT EXISTS concept_details (
                    concept_id TEXT NOT NULL,
                    language TEXT NOT NULL,
                    definition TEXT NOT NULL DEFAULT '',
                    key_points_json TEXT NOT NULL DEFAULT '[]',
                    example TEXT NOT NULL DEFAULT '',
                    common_mistakes TEXT NOT NULL DEFAULT '',
                    has_formula BOOLEAN NOT NULL DEFAULT FALSE,
                    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                    PRIMARY KEY (concept_id, language)
                )
            """)
```

在 `list_concepts` 方法附近新增查詢方法（檔案頂端已 `import json`）：

```python
    def get_concept_detail(self, concept_id: str, language: str) -> ConceptDetail | None:
        with self._connect() as cur:
            cur.execute(
                """
                SELECT concept_id, language, definition, key_points_json,
                       example, common_mistakes, has_formula
                FROM concept_details
                WHERE concept_id = %s AND language = %s
                """,
                (concept_id, language),
            )
            row = cur.fetchone()
        if not row:
            return None
        return ConceptDetail(
            concept_id=row["concept_id"],
            language=row["language"],
            definition=row["definition"],
            key_points=json.loads(row["key_points_json"]) if row["key_points_json"] else [],
            example=row["example"],
            common_mistakes=row["common_mistakes"],
            has_formula=bool(row["has_formula"]),
        )

    def save_concept_detail(self, detail: ConceptDetail) -> None:
        with self._connect() as cur:
            cur.execute(
                """
                INSERT INTO concept_details
                    (concept_id, language, definition, key_points_json,
                     example, common_mistakes, has_formula)
                VALUES (%s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (concept_id, language) DO UPDATE SET
                    definition = EXCLUDED.definition,
                    key_points_json = EXCLUDED.key_points_json,
                    example = EXCLUDED.example,
                    common_mistakes = EXCLUDED.common_mistakes,
                    has_formula = EXCLUDED.has_formula,
                    created_at = now()
                """,
                (
                    detail.concept_id,
                    detail.language,
                    detail.definition,
                    json.dumps(detail.key_points, ensure_ascii=False),
                    detail.example,
                    detail.common_mistakes,
                    detail.has_formula,
                ),
            )
```

確認 `database.py` 頂端 import 含 `ConceptDetail`：

```python
from .models import (  # 既有匯入後補上 ConceptDetail
    ConceptDetail,
)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/test_database_concept_detail.py -v`
Expected: PASS（若無 `DATABASE_URL` 則 SKIPPED — 屬正常，CI/本機有 DB 時再驗）

- [ ] **Step 5: Commit**

```bash
git add src/adaptlearn/database.py tests/test_database_concept_detail.py
git commit -m "feat(db): concept_details 快取表 + get/save（migration 002）"
```

---

### Task 3: Gemini `generate_concept_detail(concept, language)`

**Files:**
- Modify: `src/adaptlearn/gemini_client.py`
- Test: `tests/test_gemini_concept_detail.py`

- [ ] **Step 1: Write the failing test**

```python
# tests/test_gemini_concept_detail.py
from adaptlearn.gemini_client import GeminiClient


def _make_client_with_payload(monkeypatch, payload_str):
    client = GeminiClient(api_key="", model="x")
    client.enabled = True  # bypass real API
    monkeypatch.setattr(client, "_generate_content", lambda *_a, **_k: payload_str)
    return client


def test_generate_concept_detail_parses(monkeypatch):
    payload = (
        '{"definition":"細胞膜運輸是...","key_points":["被動運輸不耗能","主動運輸耗ATP"],'
        '"example":"腸道吸收葡萄糖","common_mistakes":"誤以為擴散不需蛋白質","has_formula":false}'
    )
    client = _make_client_with_payload(monkeypatch, payload)
    detail = client.generate_concept_detail(
        name="細胞膜運輸", chapter="細胞", description="物質進出細胞", language="zh"
    )
    assert detail["definition"].startswith("細胞膜運輸")
    assert detail["key_points"] == ["被動運輸不耗能", "主動運輸耗ATP"]
    assert detail["has_formula"] is False


def test_generate_concept_detail_degrades_on_empty(monkeypatch):
    client = _make_client_with_payload(monkeypatch, "")  # API 失敗回 ""
    detail = client.generate_concept_detail(
        name="X", chapter="Y", description="desc", language="en"
    )
    # 降級：至少有 definition（用 description 墊底），不丟例外
    assert detail["definition"]
    assert detail["key_points"] == []
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_gemini_concept_detail.py -v`
Expected: FAIL — `AttributeError: 'GeminiClient' object has no attribute 'generate_concept_detail'`

- [ ] **Step 3: Implement the method**

在 `gemini_client.py` 的 `generate_questions` 之後新增（沿用既有 `_generate_content` 與 `_parse_json_payload`）：

```python
    def generate_concept_detail(
        self, name: str, chapter: str, description: str, language: str
    ) -> dict[str, Any]:
        """生成單一概念的深度詳解（lazy）。失敗時優雅降級，不丟例外。"""
        fallback = {
            "definition": description or name,
            "key_points": [],
            "example": "",
            "common_mistakes": "",
            "has_formula": False,
        }
        if not self.enabled or not self._client:
            return fallback

        lang_rule = (
            "Write ALL fields in Traditional Chinese (繁體中文)."
            if language == "zh"
            else "Write ALL fields in English."
        )
        prompt = f"""
You are an expert tutor writing study notes for ONE concept.
{lang_rule}
For any math, wrap expressions in $...$ (e.g. $A^{{-1}}$) and set has_formula true.

Concept: {name}
Chapter: {chapter}
Short hint: {description}

Return ONLY valid JSON with schema:
{{
  "definition": "2-3 sentence complete definition",
  "key_points": ["exam-critical point", "..."],
  "example": "one concrete example or application",
  "common_mistakes": "a frequent misunderstanding and the correction",
  "has_formula": true|false
}}
""".strip()

        payload = _parse_json_payload(self._generate_content(prompt))
        if not isinstance(payload, dict):
            return fallback

        key_points = payload.get("key_points", [])
        if not isinstance(key_points, list):
            key_points = []
        return {
            "definition": str(payload.get("definition", "")).strip() or fallback["definition"],
            "key_points": [str(p).strip() for p in key_points if str(p).strip()],
            "example": str(payload.get("example", "")).strip(),
            "common_mistakes": str(payload.get("common_mistakes", "")).strip(),
            "has_formula": bool(payload.get("has_formula", False)),
        }
```

（`Any` 已於檔案頂端匯入；確認 `_parse_json_payload` 為模組層級函式，既有 `extract_concepts` 已使用。）

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/test_gemini_concept_detail.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/adaptlearn/gemini_client.py tests/test_gemini_concept_detail.py
git commit -m "feat(gemini): generate_concept_detail（含降級）"
```

---

### Task 4: Pipeline lazy 取／生詳解

**Files:**
- Modify: `src/adaptlearn/pipeline.py`
- Test: `tests/test_pipeline_concept_detail.py`

- [ ] **Step 1: Write the failing test**

```python
# tests/test_pipeline_concept_detail.py
from adaptlearn.models import Concept, ConceptDetail


class _FakeRepo:
    def __init__(self):
        self.saved = []
        self._concepts = [Concept(id="c-1", name="細胞膜運輸", chapter="細胞", description="物質進出細胞")]
        self._cache = {}

    def list_concepts(self, course_id=None):
        return self._concepts

    def get_concept_detail(self, concept_id, language):
        return self._cache.get((concept_id, language))

    def save_concept_detail(self, detail):
        self.saved.append(detail)
        self._cache[(detail.concept_id, detail.language)] = detail


class _FakeGemini:
    def __init__(self):
        self.calls = 0

    def generate_concept_detail(self, name, chapter, description, language):
        self.calls += 1
        return {"definition": f"{name}-{language}", "key_points": ["k"],
                "example": "e", "common_mistakes": "m", "has_formula": False}


def _service():
    from adaptlearn.pipeline import AdaptLearnService
    svc = AdaptLearnService.__new__(AdaptLearnService)  # bypass __init__
    svc.repository = _FakeRepo()
    svc.gemini = _FakeGemini()
    return svc


def test_generates_and_caches_on_miss():
    svc = _service()
    d = svc.get_or_generate_concept_detail("c-1", "zh")
    assert isinstance(d, ConceptDetail)
    assert d.definition == "細胞膜運輸-zh"
    assert svc.gemini.calls == 1
    # 第二次走快取，不再呼叫 Gemini
    svc.get_or_generate_concept_detail("c-1", "zh")
    assert svc.gemini.calls == 1


def test_unknown_concept_raises():
    svc = _service()
    import pytest
    with pytest.raises(ValueError):
        svc.get_or_generate_concept_detail("c-missing", "zh")
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_pipeline_concept_detail.py -v`
Expected: FAIL — `AttributeError: ... has no attribute 'get_or_generate_concept_detail'`

- [ ] **Step 3: Implement the method**

在 `pipeline.py` 的 `AdaptLearnService` class 內新增（確認頂端 `from .models import ... ConceptDetail`；`self.repository` 與 `self.gemini` 為既有屬性名 — 實作前先 grep 確認確切名稱，必要時對齊）：

```python
    def get_or_generate_concept_detail(self, concept_id: str, language: str) -> ConceptDetail:
        """Lazy：先查快取，未命中才呼叫 Gemini 生成並存。"""
        if language not in ("zh", "en"):
            language = "zh"

        cached = self.repository.get_concept_detail(concept_id, language)
        if cached is not None:
            return cached

        concept = next(
            (c for c in self.repository.list_concepts() if c.id == concept_id), None
        )
        if concept is None:
            raise ValueError(f"找不到概念：{concept_id}")

        raw = self.gemini.generate_concept_detail(
            name=concept.name,
            chapter=concept.chapter,
            description=concept.description,
            language=language,
        )
        detail = ConceptDetail(
            concept_id=concept_id,
            language=language,
            definition=raw["definition"],
            key_points=raw["key_points"],
            example=raw["example"],
            common_mistakes=raw["common_mistakes"],
            has_formula=raw["has_formula"],
        )
        self.repository.save_concept_detail(detail)
        return detail
```

> ⚠️ 實作前務必 `grep -n "self\.repository\|self\.repo\|self\.gemini" src/adaptlearn/pipeline.py` 確認屬性命名，若為 `self.repo` 等則同步調整本方法與 Task 4 測試。

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/test_pipeline_concept_detail.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/adaptlearn/pipeline.py tests/test_pipeline_concept_detail.py
git commit -m "feat(pipeline): lazy get_or_generate_concept_detail"
```

---

### Task 5: API endpoint `GET /api/concepts/{id}/detail`

**Files:**
- Modify: `webapp/main.py`（在 `/api/concepts` 路由附近新增）

- [ ] **Step 1: Add the endpoint**

在 `webapp/main.py` 的 `list_concepts` 路由（約第 328 行）之後新增：

```python
@app.get("/api/concepts/{concept_id}/detail")
@limiter.limit("60/minute")
def get_concept_detail(request: Request, concept_id: str, lang: str = "zh") -> dict[str, Any]:
    language = lang if lang in ("zh", "en") else "zh"
    try:
        detail = _get_service().get_or_generate_concept_detail(concept_id, language)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return {
        "concept_id": detail.concept_id,
        "language": detail.language,
        "definition": detail.definition,
        "key_points": detail.key_points,
        "example": detail.example,
        "common_mistakes": detail.common_mistakes,
        "has_formula": detail.has_formula,
    }
```

> 不加 `@cached`：lazy 生成已在 DB 層快取；`@cached` 會讓不同 `lang` 共用快取出錯。`@limiter` 保護 Gemini 呼叫頻率。

- [ ] **Step 2: Smoke-test manually**

Run（需後端在跑且 DB 有概念）：
```bash
curl -s "http://localhost:8000/api/concepts/<某個真實 concept_id>/detail?lang=zh" | python3 -m json.tool
```
Expected: 回 JSON 含 `definition` / `key_points` 等欄位（首次約 2~5 秒，第二次秒回）。

- [ ] **Step 3: Commit**

```bash
git add webapp/main.py
git commit -m "feat(api): GET /api/concepts/{id}/detail（lazy 詳解）"
```

---

## Phase 2 — 後端：測驗語言參數（#4 測驗語言）

> 可獨立交付：完成後 `/api/diagnostics/generate` 接受 `language`。

### Task 6: `generate_questions` 加 `language`

**Files:**
- Modify: `src/adaptlearn/gemini_client.py`（`generate_questions`）、`src/adaptlearn/quiz_engine.py`（`build_questions_for_concepts`）
- Test: `tests/test_quiz_language.py`

- [ ] **Step 1: Write the failing test**

```python
# tests/test_quiz_language.py
from adaptlearn.gemini_client import GeminiClient


def test_generate_questions_passes_language(monkeypatch):
    captured = {}
    client = GeminiClient(api_key="", model="x")
    client.enabled = True

    def fake_gen(prompt):
        captured["prompt"] = prompt
        return "[]"

    monkeypatch.setattr(client, "_generate_content", fake_gen)
    client.generate_questions(concepts=[{"name": "X", "chapter": "Y", "description": "d"}],
                              per_concept=1, language="en")
    assert "English" in captured["prompt"]

    client.generate_questions(concepts=[{"name": "X", "chapter": "Y", "description": "d"}],
                              per_concept=1, language="both")
    assert "bilingual" in captured["prompt"].lower() or "中英" in captured["prompt"]
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_quiz_language.py -v`
Expected: FAIL — `generate_questions()` 不接受 `language` 參數（TypeError）

- [ ] **Step 3: Add `language` to generate_questions**

修改 `gemini_client.py` 的 `generate_questions` 簽名與 prompt 語言規則：

```python
    def generate_questions(
        self,
        concepts: list[dict[str, str]],
        per_concept: int = 3,
        language: str = "zh",
    ) -> list[dict[str, str]]:
        if not self.enabled or not self._client or not concepts:
            return []

        if language == "en":
            lang_rule = "Write questions, answers, and rationale in English."
        elif language == "both":
            lang_rule = (
                "Write each question, answer, and rationale BILINGUALLY: "
                "first the English version, then the Traditional Chinese (繁體中文) version, "
                "separated by a newline."
            )
        else:
            lang_rule = "Write questions, answers, and rationale in Traditional Chinese (繁體中文)."

        concept_json = json.dumps(concepts, ensure_ascii=False)
        prompt = f"""
You are an adaptive tutor. Generate {per_concept} diagnostic questions per concept across difficulty levels.
{lang_rule}
For any mathematical expressions, wrap them in $...$ (e.g. $A^{{-1}}$, $\\lambda_1$).

Return ONLY valid JSON array with schema:
[
  {{
    "concept": "concept name",
    "difficulty": "basic|intermediate|advanced",
    "question": "question text",
    "answer": "reference answer",
    "rationale": "how to solve and why"
  }}
]

Concepts:
{concept_json}
""".strip()
        # ...（以下解析邏輯維持原樣）
```

（保留原本 `_parse_json_payload(...)` 之後的清洗迴圈不變。）

- [ ] **Step 4: Thread `language` through quiz_engine**

修改 `quiz_engine.py` 的 `build_questions_for_concepts`：

```python
def build_questions_for_concepts(
    concepts: list[Concept],
    gemini_client,
    per_concept: int = 3,
    language: str = "zh",
) -> list[Question]:
    ...
    generated = gemini_client.generate_questions(
        concepts=llm_input, per_concept=per_concept, language=language
    )
    ...
```

- [ ] **Step 5: Run test to verify it passes**

Run: `python -m pytest tests/test_quiz_language.py -v`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/adaptlearn/gemini_client.py src/adaptlearn/quiz_engine.py tests/test_quiz_language.py
git commit -m "feat(quiz): generate_questions 支援 zh/en/both 語言"
```

---

### Task 7: Service ＋ API 串接測驗語言

**Files:**
- Modify: `src/adaptlearn/pipeline.py`（`generate_diagnostics`）、`webapp/main.py`（`GenerateRequest` + 路由）

- [ ] **Step 1: Thread language into generate_diagnostics**

在 `pipeline.py` 找到 `generate_diagnostics`（grep 確認簽名），加入 `language` 參數並傳給 `build_questions_for_concepts`：

```python
    def generate_diagnostics(self, question_count: int = 9, language: str = "zh") -> list[Question]:
        # ...既有挑選 weak concepts 的邏輯不變...
        questions = build_questions_for_concepts(
            concepts=selected,            # 沿用既有變數名
            gemini_client=self.gemini,    # 沿用既有屬性名
            per_concept=per_concept,      # 沿用既有變數名
            language=language,
        )
        # ...既有存檔/回傳邏輯不變...
        return questions
```

> ⚠️ 實作前 grep `def generate_diagnostics` 取得真實內文，只新增 `language` 的傳遞，勿改動挑題邏輯。

- [ ] **Step 2: Add language to API request model + route**

修改 `webapp/main.py` 的 `GenerateRequest` 與路由：

```python
class GenerateRequest(BaseModel):
    question_count: int = Field(default=9, ge=1, le=30)
    language: str = Field(default="zh")
```

```python
@app.post("/api/diagnostics/generate")
@limiter.limit("10/minute")
def generate_diagnostics(request: Request, payload: GenerateRequest) -> dict[str, Any]:
    lang = payload.language if payload.language in ("zh", "en", "both") else "zh"
    questions = _get_service().generate_diagnostics(
        question_count=payload.question_count, language=lang
    )
    invalidate_cache("questions")
    return {"items": [_serialize_question(question) for question in questions]}
```

- [ ] **Step 3: Smoke-test manually**

Run:
```bash
curl -s -X POST http://localhost:8000/api/diagnostics/generate \
  -H "Content-Type: application/json" \
  -d '{"question_count":3,"language":"en"}' | python3 -m json.tool
```
Expected: 回英文題目。

- [ ] **Step 4: Commit**

```bash
git add src/adaptlearn/pipeline.py webapp/main.py
git commit -m "feat(api): diagnostics 生成支援 language 參數"
```

---

## Phase 3 — 前端：概念卡片網格 ＋ 抽屜詳解（#2 + #3 + #4 概念語言）

> 完成後概念頁可點卡片開抽屜看詳解、切換語言。前端改動後皆需 `npm run build`。

### Task 8: `useConceptDetail` hook

**Files:**
- Modify: `webapp/frontend/src/hooks/useApi.ts`

- [ ] **Step 1: Add the hook + type**

在 `useApi.ts` 適當位置（型別區）新增介面，並在 hooks 區新增 query hook（沿用既有 `apiFetch` 與 React Query 風格）：

```typescript
export interface ConceptDetail {
  concept_id: string;
  language: string;
  definition: string;
  key_points: string[];
  example: string;
  common_mistakes: string;
  has_formula: boolean;
}

export function useConceptDetail(conceptId: string | null, lang: "zh" | "en") {
  return useQuery({
    queryKey: ["concept-detail", conceptId, lang],
    enabled: !!conceptId,
    staleTime: Infinity, // 後端已快取，不需重抓
    queryFn: async () => {
      return apiFetch(`/api/concepts/${conceptId}/detail?lang=${lang}`) as Promise<ConceptDetail>;
    },
  });
}
```

> 確認 `useQuery` 已在檔案頂端從 `@tanstack/react-query` 匯入（既有 hooks 已使用）。

- [ ] **Step 2: Type-check**

Run: `cd webapp/frontend && npx tsc --noEmit`
Expected: 無錯誤

- [ ] **Step 3: Commit**

```bash
git add webapp/frontend/src/hooks/useApi.ts
git commit -m "feat(fe): useConceptDetail hook"
```

---

### Task 9: 抽屜動畫 CSS（spring / scrim / stagger / 酪梨蓋章）

**Files:**
- Modify: `webapp/frontend/src/index.css`

- [ ] **Step 1: Add easing + drawer classes**

在 `index.css` 的 `:root` easing 區補上 spring（若 `--ease-drawer` 已存在則保留），並新增抽屜相關 class：

```css
:root {
  --ease-spring: cubic-bezier(.34, 1.56, .64, 1);
}

/* 概念抽屜 */
.concept-scrim {
  position: absolute; inset: 0;
  background: rgba(16, 24, 40, .18);
  opacity: 0; pointer-events: none;
  transition: opacity .4s var(--ease-out, ease);
}
.concept-stage.open .concept-scrim { opacity: 1; pointer-events: auto; }

.concept-grid {
  transition: filter .45s ease, transform .45s ease, opacity .45s ease;
}
.concept-stage.open .concept-grid {
  filter: blur(2px); transform: scale(.985); opacity: .55;
}

.concept-drawer {
  position: absolute; top: 0; right: 0; bottom: 0;
  width: min(420px, 88%);
  background: var(--bg-surface); border-left: 1px solid var(--border);
  box-shadow: -18px 0 40px rgba(16, 24, 40, .12);
  transform: translateX(100%);
  transition: transform .55s var(--ease-spring);
  display: flex; flex-direction: column;
}
.concept-stage.open .concept-drawer { transform: translateX(0); }

/* 酪梨 logo 蓋章進場 */
.concept-drawer-avo {
  transform: scale(0) rotate(-18deg); transform-origin: bottom center;
}
.concept-stage.open .concept-drawer-avo {
  animation: avo-stamp .5s var(--ease-spring) .08s forwards;
}
@keyframes avo-stamp {
  60% { transform: scale(1.12) rotate(4deg); }
  100% { transform: scale(1) rotate(0); }
}

/* 區塊接力浮現 */
.concept-block { opacity: 0; transform: translateY(8px); }
.concept-stage.open .concept-block { animation: concept-rise .45s var(--ease-spring) forwards; }
.concept-stage.open .concept-block:nth-child(1) { animation-delay: .16s; }
.concept-stage.open .concept-block:nth-child(2) { animation-delay: .23s; }
.concept-stage.open .concept-block:nth-child(3) { animation-delay: .30s; }
.concept-stage.open .concept-block:nth-child(4) { animation-delay: .37s; }
@keyframes concept-rise { to { opacity: 1; transform: none; } }

@media (prefers-reduced-motion: reduce) {
  .concept-drawer, .concept-grid, .concept-drawer-avo, .concept-block { transition: none; animation: none; }
  .concept-drawer-avo, .concept-block { transform: none; opacity: 1; }
}
```

- [ ] **Step 2: Build to verify CSS compiles**

Run: `cd webapp/frontend && npm run build`
Expected: build 成功、零錯誤

- [ ] **Step 3: Commit**

```bash
git add webapp/frontend/src/index.css
git commit -m "ui(concept): 抽屜 spring/scrim/stagger/酪梨蓋章 CSS"
```

---

### Task 10: `ConceptDrawer` 元件

**Files:**
- Create: `webapp/frontend/src/components/ConceptDrawer.tsx`

- [ ] **Step 1: Create the drawer component**

```tsx
// webapp/frontend/src/components/ConceptDrawer.tsx
import { useEffect } from "react";
import type { Concept } from "../hooks/useApi";
import { useConceptDetail } from "../hooks/useApi";
import { PixelAvocadoLogo } from "./PixelAvocadoLogo";
import { MathRenderer } from "./MathRenderer";

type Lang = "zh" | "en" | "both";

interface Props {
  concept: Concept | null;
  lang: Lang;
  statusColor: string; // 該概念掌握度狀態色（綠/琥珀/紅）
  onClose: () => void;
}

const LABELS = {
  zh: { def: "核心定義", points: "關鍵重點", example: "範例", mistakes: "常見誤區" },
  en: { def: "Definition", points: "Key Points", example: "Example", mistakes: "Common Mistakes" },
};

export function ConceptDrawer({ concept, lang, statusColor, onClose }: Props) {
  // Esc 關閉
  useEffect(() => {
    if (!concept) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [concept, onClose]);

  // 中英對照分別抓 zh / en（後端各自快取）
  const wantZh = lang === "zh" || lang === "both";
  const wantEn = lang === "en" || lang === "both";
  const zh = useConceptDetail(wantZh && concept ? concept.id : null, "zh");
  const en = useConceptDetail(wantEn && concept ? concept.id : null, "en");

  const renderDetail = (d: typeof zh.data, l: "zh" | "en") => {
    if (!d) return null;
    const t = LABELS[l];
    const text = (s: string) => (d.has_formula ? <MathRenderer content={s} /> : <>{s}</>);
    return (
      <>
        <div className="concept-block">
          <p className="mb-1 text-[10px] font-bold uppercase tracking-wide text-[color:var(--text-muted)]">{t.def}</p>
          <p className="text-sm leading-6 text-[color:var(--text-secondary)]">{text(d.definition)}</p>
        </div>
        {d.key_points.length > 0 && (
          <div className="concept-block">
            <p className="mb-1 text-[10px] font-bold uppercase tracking-wide text-[color:var(--text-muted)]">{t.points}</p>
            <ul className="list-disc pl-5 text-sm leading-7 text-[color:var(--text-secondary)]">
              {d.key_points.map((p, i) => <li key={i}>{text(p)}</li>)}
            </ul>
          </div>
        )}
        {d.example && (
          <div className="concept-block">
            <p className="mb-1 text-[10px] font-bold uppercase tracking-wide text-[color:var(--text-muted)]">{t.example}</p>
            <p className="text-sm leading-6 text-[color:var(--text-secondary)]">{text(d.example)}</p>
          </div>
        )}
        {d.common_mistakes && (
          <div className="concept-block rounded-lg border border-[color:var(--low)] bg-[color:var(--low-soft,#fef2f4)] px-3 py-2">
            <p className="mb-1 text-[10px] font-bold uppercase tracking-wide text-[color:var(--low)]">{t.mistakes}</p>
            <p className="text-sm leading-6 text-[color:var(--low)]">{text(d.common_mistakes)}</p>
          </div>
        )}
      </>
    );
  };

  const loading = (wantZh && zh.isLoading) || (wantEn && en.isLoading);

  return (
    <>
      <div className="concept-scrim" onClick={onClose} />
      <aside className="concept-drawer" aria-hidden={!concept}>
        <div className="relative border-b border-[color:var(--border)] px-4 py-4"
             style={{ background: `linear-gradient(120deg, ${statusColor}22, transparent 70%)` }}>
          <button onClick={onClose}
            className="absolute right-3 top-3 flex h-6 w-6 items-center justify-center rounded-md bg-[color:var(--bg-sunken)] text-[color:var(--text-secondary)]">✕</button>
          <div className="flex items-center gap-2">
            <span className="concept-drawer-avo inline-flex"><PixelAvocadoLogo size={30} /></span>
            <span className="font-display text-base font-bold">{concept?.name}</span>
          </div>
          <p className="mt-1 text-xs text-[color:var(--accent)]">{concept?.chapter}</p>
          <p className="absolute right-3 top-9 text-[10px] text-[color:var(--text-muted)]">Esc 關閉</p>
        </div>

        <div className="flex-1 space-y-4 overflow-auto px-4 py-4">
          {loading && <p className="text-xs text-[color:var(--text-muted)]">生成中…（首次約數秒）</p>}
          {!loading && wantEn && renderDetail(en.data, "en")}
          {!loading && wantEn && wantZh && <hr className="border-[color:var(--border)]" />}
          {!loading && wantZh && renderDetail(zh.data, "zh")}
        </div>
      </aside>
    </>
  );
}
```

> 實作前確認 `MathRenderer` 的 prop 名稱（grep `MathRenderer`），若非 `content` 則對齊；`PixelAvocadoLogo` 為既有 default/named export，依實際匯出方式調整 import。`--low-soft` 若 `index.css` 未定義則用 fallback（上方已給 `#fef2f4`）。

- [ ] **Step 2: Type-check**

Run: `cd webapp/frontend && npx tsc --noEmit`
Expected: 無錯誤（如有 export 名稱不符，依錯誤修正 import）

- [ ] **Step 3: Commit**

```bash
git add webapp/frontend/src/components/ConceptDrawer.tsx
git commit -m "feat(fe): ConceptDrawer 抽屜詳解元件（Esc 關閉、中英堆疊）"
```

---

### Task 11: `ConceptSection` 改卡片網格 ＋ 語言切換 ＋ 接抽屜

**Files:**
- Modify: `webapp/frontend/src/components/ConceptSection.tsx`

- [ ] **Step 1: Rewrite as grid + drawer host**

完整取代 `ConceptSection.tsx` 內容（沿用既有 `Props`，新增掌握度傳入以決定狀態色——若呼叫端尚未傳，預設灰）：

```tsx
import { useMemo, useState } from "react";
import type { Concept, ConceptMastery } from "../hooks/useApi";
import { ConceptDrawer } from "./ConceptDrawer";

type Lang = "zh" | "en" | "both";

interface Props {
  concepts: Concept[];
  search: string;
  sessionUploaded: boolean;
  isError: boolean;
  masteryItems?: ConceptMastery[];
}

const STATUS_COLOR: Record<string, string> = {
  high: "var(--high)", medium: "var(--medium)", low: "var(--low)", new: "var(--text-muted)",
};

export function ConceptSection({ concepts, search, sessionUploaded, isError, masteryItems = [] }: Props) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [lang, setLang] = useState<Lang>("zh");

  const statusByName = useMemo(() => {
    const m = new Map<string, string>();
    for (const it of masteryItems) m.set(it.name.toLowerCase(), it.status);
    return m;
  }, [masteryItems]);

  const filtered = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    if (!keyword) return concepts;
    return concepts.filter((c) =>
      `${c.name} ${c.chapter} ${c.description}`.toLowerCase().includes(keyword));
  }, [concepts, search]);

  const openConcept = useMemo(
    () => filtered.find((c) => c.id === openId) ?? null, [filtered, openId]);
  const openStatus = openConcept ? (statusByName.get(openConcept.name.toLowerCase()) ?? "new") : "new";

  return (
    <div className="mt-5">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-[color:var(--text-primary)]">已抽取概念</p>
          <p className="mt-0.5 text-xs text-[color:var(--text-muted)]">點概念卡查看深度詳解</p>
        </div>
        {/* 概念頁語言切換（與測驗頁獨立） */}
        <div className="inline-flex rounded-lg border border-[color:var(--border)] bg-[color:var(--bg-sunken)] p-0.5 text-[11px]">
          {(["zh", "en", "both"] as Lang[]).map((l) => (
            <button key={l} onClick={() => setLang(l)}
              className={`rounded-md px-2.5 py-1 font-semibold transition ${lang === l ? "bg-white text-[color:var(--accent)] shadow-sm" : "text-[color:var(--text-secondary)]"}`}>
              {l === "zh" ? "中文" : l === "en" ? "EN" : "中英"}
            </button>
          ))}
        </div>
      </div>

      <div className={`concept-stage relative ${openId ? "open" : ""}`}>
        {isError ? (
          <p className="rounded-xl border border-[color:var(--low)] bg-[color:var(--low-soft,#fef2f4)] px-4 py-3 text-xs text-[color:var(--low)]">
            ⚠ 無法讀取概念資料，請確認後端連線後重試。
          </p>
        ) : !sessionUploaded ? (
          <p className="text-xs text-[color:var(--text-muted)]">尚未上傳教材。匯入講義後，這裡會顯示自動抽取的概念。</p>
        ) : filtered.length === 0 ? (
          <p className="text-xs text-[color:var(--text-muted)]">目前沒有可顯示的概念。</p>
        ) : (
          <div className="concept-grid grid grid-cols-2 gap-2 md:grid-cols-3">
            {filtered.map((c) => {
              const status = statusByName.get(c.name.toLowerCase()) ?? "new";
              return (
                <button key={c.id} onClick={() => setOpenId(c.id)}
                  className="card-interactive relative overflow-hidden rounded-xl p-3 text-left">
                  <span className="absolute right-3 top-3 h-2 w-2 rounded-full"
                        style={{ background: STATUS_COLOR[status] }} />
                  <p className="pr-4 text-sm font-medium text-[color:var(--text-primary)]">{c.name}</p>
                  <p className="mt-1 text-[11px] text-[color:var(--text-muted)]">{c.chapter}</p>
                </button>
              );
            })}
          </div>
        )}

        <ConceptDrawer
          concept={openConcept}
          lang={lang}
          statusColor={STATUS_COLOR[openStatus]}
          onClose={() => setOpenId(null)}
        />
      </div>
    </div>
  );
}
```

> `concept-stage` 需 `position: relative` 且抽屜為 `absolute` 覆蓋於其上——若概念區塊高度不足以容納抽屜，於呼叫端容器給最小高度（例如 `min-h-[420px]`），或在 Task 11 的 `.concept-stage` 外層加 `min-height`。實作時目視調整。

- [ ] **Step 2: Pass masteryItems from caller**

grep 找 `ConceptSection` 使用處（`grep -rn "ConceptSection" webapp/frontend/src`），把已有的 mastery 資料傳入 `masteryItems`（多半在概念頁/圖譜頁已有 `useConceptMastery`）。若呼叫端暫無，可先不傳（狀態色預設灰），不阻塞。

- [ ] **Step 3: Build**

Run: `cd webapp/frontend && npm run build`
Expected: 成功、零錯誤

- [ ] **Step 4: Manual check**

開 dev server（`npm run dev`），上傳一份教材 → 概念頁點任一卡 → 抽屜滑出、酪梨蓋章、區塊接力浮現、Esc 可關、語言切換 EN/中英正常。

- [ ] **Step 5: Commit**

```bash
git add webapp/frontend/src/components/ConceptSection.tsx
git commit -m "feat(fe): 概念清單改卡片網格 + 抽屜 + 語言切換"
```

---

## Phase 4 — 前端：測驗語言切換（#4 測驗語言）

### Task 12: 測驗頁語言切換

**Files:**
- Modify: `webapp/frontend/src/hooks/useApi.ts`（`useGenerateDiagnostics`）、`webapp/frontend/src/components/QuizPanel.tsx`

- [ ] **Step 1: Let the mutation accept language**

修改 `useApi.ts` 的 `useGenerateDiagnostics`，把輸入改為物件含 `language`：

```typescript
export function useGenerateDiagnostics() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ questionCount, language }: { questionCount: number; language: "zh" | "en" | "both" }) => {
      return apiFetch("/api/diagnostics/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question_count: questionCount, language }),
      }) as Promise<{ items: Question[] }>;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["questions"] });
    },
  });
}
```

- [ ] **Step 2: Add language toggle in QuizPanel + pass to mutation**

在 `QuizPanel.tsx`：grep 現有 `useGenerateDiagnostics`/`mutate` 呼叫，新增本地 state 與切換 UI（與概念頁獨立），並把 `language` 帶進 `mutate`：

```tsx
const [quizLang, setQuizLang] = useState<"zh" | "en" | "both">("zh");
// ...既有 generate 觸發處改為：
generate.mutate({ questionCount: count, language: quizLang });
```

語言切換 UI（放在生成測驗按鈕附近，沿用概念頁同款三段樣式）：

```tsx
<div className="inline-flex rounded-lg border border-[color:var(--border)] bg-[color:var(--bg-sunken)] p-0.5 text-[11px]">
  {(["zh", "en", "both"] as const).map((l) => (
    <button key={l} onClick={() => setQuizLang(l)}
      className={`rounded-md px-2.5 py-1 font-semibold transition ${quizLang === l ? "bg-white text-[color:var(--accent)] shadow-sm" : "text-[color:var(--text-secondary)]"}`}>
      {l === "zh" ? "中文" : l === "en" ? "EN" : "中英"}
    </button>
  ))}
</div>
```

> grep 確認 `QuizPanel` 內 `mutate` 既有呼叫的變數名（`count` 等），對齊修改；若原本傳純數字，改為物件即可。

- [ ] **Step 3: Build + type-check**

Run: `cd webapp/frontend && npx tsc --noEmit && npm run build`
Expected: 成功、零錯誤

- [ ] **Step 4: Manual check**

測驗頁切 EN → 生成測驗 → 題目為英文；切「中英」→ 題目雙語。

- [ ] **Step 5: Commit**

```bash
git add webapp/frontend/src/hooks/useApi.ts webapp/frontend/src/components/QuizPanel.tsx
git commit -m "feat(fe): 測驗頁語言切換（zh/en/both）"
```

---

## Phase 5 — 心智圖力導向佈局（#1）

### Task 13: 自寫力導向佈局取代固定半徑放射

**Files:**
- Modify: `webapp/frontend/src/components/MindMapCanvas.tsx`（`buildLayout`，約第 95-148 行）

- [ ] **Step 1: Replace buildLayout with force simulation**

改寫 `buildLayout`：以現有放射座標當初始值，跑斥力＋邊吸引＋向心力迭代，收斂後 clamp 進畫布。回傳型別（`{ concepts, chapters }`）與既有欄位（`id,name,chapter,x,y,status,mastery,chapterColor` / 章節 `id,name,x,y,color`）**完全不變**，下游渲染零改動。

```tsx
function buildLayout(graph: ParsedGraph, masteryByName: Map<string, ConceptMastery>): Layout {
  const byChapter = new Map<string, GraphNode[]>();
  for (const node of graph.nodes) {
    const ch = node.chapter || "核心概念";
    if (!byChapter.has(ch)) byChapter.set(ch, []);
    byChapter.get(ch)!.push(node);
  }
  const chapterNames = Array.from(byChapter.keys());
  const N = chapterNames.length;

  // 1) 初始座標：沿用放射狀（收斂快又穩）
  type P = { id: string; x: number; y: number; r: number; chapter: string; isChapter: boolean };
  const pts: P[] = [];
  const colorByChapter = new Map<string, string>();

  chapterNames.forEach((chapter, i) => {
    const baseAngle = (2 * Math.PI * i) / Math.max(1, N) - Math.PI / 2;
    const color = CHAPTER_PALETTE[i % CHAPTER_PALETTE.length];
    colorByChapter.set(chapter, color);
    pts.push({ id: `__ch__${chapter}`, x: CX + R_CHAPTER * Math.cos(baseAngle),
               y: CY + R_CHAPTER * Math.sin(baseAngle), r: 26, chapter, isChapter: true });
    const nodes = byChapter.get(chapter)!;
    const M = nodes.length;
    nodes.forEach((node, j) => {
      const fanHalf = Math.min((Math.PI / 3) * (M / 4 + 0.4), Math.PI * 0.6);
      const angle = M === 1 ? baseAngle : baseAngle + fanHalf * ((j / (M - 1)) * 2 - 1);
      pts.push({ id: node.id, x: CX + R_CONCEPT * Math.cos(angle),
                 y: CY + R_CONCEPT * Math.sin(angle),
                 r: pillWidth(displayName(node.name)) / 2 + 14, chapter, isChapter: false });
    });
  });

  // edges：概念↔所屬章節 + graph.edges（prerequisite/progression）
  const idIndex = new Map(pts.map((p, i) => [p.id, i]));
  const links: [number, number][] = [];
  for (const p of pts) {
    if (!p.isChapter) {
      const ci = idIndex.get(`__ch__${p.chapter}`);
      const pi = idIndex.get(p.id);
      if (ci != null && pi != null) links.push([ci, pi]);
    }
  }
  for (const e of graph.edges) {
    const a = idIndex.get(e.source), b = idIndex.get(e.target);
    if (a != null && b != null) links.push([a, b]);
  }

  // 2) 模擬：斥力(反平方) + 邊吸引 + 弱向心
  const ITER = 280, REPULSE = 5200, SPRING = 0.02, CENTER = 0.012, MIN_D = 1;
  for (let it = 0; it < ITER; it++) {
    const fx = new Array(pts.length).fill(0);
    const fy = new Array(pts.length).fill(0);
    for (let i = 0; i < pts.length; i++) {
      for (let k = i + 1; k < pts.length; k++) {
        let dx = pts[i].x - pts[k].x, dy = pts[i].y - pts[k].y;
        let d2 = dx * dx + dy * dy || MIN_D;
        const minSep = pts[i].r + pts[k].r;
        const force = REPULSE / d2;            // 反平方斥力
        const d = Math.sqrt(d2);
        const boost = d < minSep ? 2.2 : 1;    // 已重疊者加強推開
        const ux = dx / d, uy = dy / d;
        fx[i] += ux * force * boost; fy[i] += uy * force * boost;
        fx[k] -= ux * force * boost; fy[k] -= uy * force * boost;
      }
    }
    for (const [a, b] of links) {            // 邊吸引
      const dx = pts[b].x - pts[a].x, dy = pts[b].y - pts[a].y;
      fx[a] += dx * SPRING; fy[a] += dy * SPRING;
      fx[b] -= dx * SPRING; fy[b] -= dy * SPRING;
    }
    const damp = 0.85;
    for (let i = 0; i < pts.length; i++) {
      fx[i] += (CX - pts[i].x) * CENTER;     // 向心
      fy[i] += (CY - pts[i].y) * CENTER;
      pts[i].x += fx[i] * damp; pts[i].y += fy[i] * damp;
    }
  }

  // 3) clamp 進畫布
  const PAD = 60;
  for (const p of pts) {
    p.x = Math.max(PAD, Math.min(SVG_W - PAD, p.x));
    p.y = Math.max(PAD, Math.min(SVG_H - PAD, p.y));
  }

  // 4) 還原成既有 Layout 結構
  const concepts: ConceptNode[] = [];
  const chapters: ChapterNode[] = [];
  for (const p of pts) {
    if (p.isChapter) {
      chapters.push({ id: p.id, name: p.chapter, x: p.x, y: p.y, color: colorByChapter.get(p.chapter)! });
    } else {
      const node = graph.nodes.find((n) => n.id === p.id)!;
      const m = masteryByName.get(node.name.toLowerCase());
      concepts.push({ id: p.id, name: node.name, chapter: p.chapter, x: p.x, y: p.y,
        status: m?.status ?? "new", mastery: m?.mastery ?? 0, chapterColor: colorByChapter.get(p.chapter)! });
    }
  }
  return { concepts, chapters };
}
```

> 確認 `ParsedGraph` 的 edge 欄位名（grep `interface ParsedGraph` / `source`/`target`）。若邊欄位為 `source_id`/`target_id`，對齊上方 `e.source`/`e.target`。`CHAPTER_PALETTE`、`pillWidth`、`displayName`、`R_CHAPTER`、`R_CONCEPT`、`CX`、`CY`、`SVG_W`、`SVG_H` 皆為既有常數。

- [ ] **Step 2: Build + type-check**

Run: `cd webapp/frontend && npx tsc --noEmit && npm run build`
Expected: 成功、零錯誤

- [ ] **Step 3: Manual check**

圖譜頁：節點**不再重疊**、同章節群聚、連線清楚；path-finding 高亮、pan/zoom 仍正常；多次重整佈局穩定（不亂飄）。若仍有重疊或太散，微調 `REPULSE`/`SPRING`/`ITER`。

- [ ] **Step 4: Commit**

```bash
git add webapp/frontend/src/components/MindMapCanvas.tsx
git commit -m "feat(graph): 心智圖改自寫力導向佈局，解節點重疊"
```

---

## Phase 6 — 收尾

### Task 14: 全量測試 ＋ 文件更新

- [ ] **Step 1: Run backend tests**

Run: `python -m pytest tests/ -v`
Expected: 新增測試全 PASS；既有失敗測試（plan.md 記錄的 OCR 頁數訊息、integration async）維持原狀，不在本案範圍。

- [ ] **Step 2: Final frontend build**

Run: `cd webapp/frontend && npm run build`
Expected: 成功；`webapp/static/` 產物已更新。

- [ ] **Step 3: Update DEVLOG + CLAUDE.md/plan.md**

- `DEVLOG.md`：加 2026-06-09 條目，記錄 4 項改善完成。
- `plan.md`：移除「朋友試用過後想增加或更改的功能」段落（已完成）。
- `CLAUDE.md`：API Routes 表加入 `GET /api/concepts/{id}/detail`；資料庫 schema 段補 `concept_details` 表。

- [ ] **Step 4: Commit + push built assets**

```bash
git add webapp/static DEVLOG.md plan.md CLAUDE.md
git commit -m "docs: 試用回饋 4 項改善完成，更新 DEVLOG/CLAUDE/plan + build 產物"
```

---

## Self-Review 對照

- **#1 心智圖** → Task 13 ✅
- **#2 卡片網格＋抽屜** → Task 9/10/11 ✅
- **#3 深度詳解（A/B/C/E＋D 公式、lazy）** → Task 1-5, 10 ✅
- **#4 語言（概念/測驗獨立、中/EN/中英、UI 中文）** → 概念 Task 8/10/11；測驗 Task 6/7/12 ✅
- **抽屜動畫巧思（spring/scrim/酪梨蓋章/stagger/Esc＋提示）** → Task 9/10 ✅
- **DB migration（append-only）** → Task 2 ✅
- **Gemini 降級** → Task 3（fallback）✅
- **不加 npm 套件** → Task 13 自寫力導向 ✅
- **lazy 不拖慢 ingest** → ingest 未改動；詳解只在 Task 5 endpoint 觸發 ✅
