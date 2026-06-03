from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import secrets
import sys
from contextlib import asynccontextmanager
from functools import wraps
from pathlib import Path
from typing import Any, Callable, TypeVar

from cachetools import TTLCache
from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from starlette.concurrency import run_in_threadpool
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.util import get_remote_address
from pydantic import BaseModel, Field

logger = logging.getLogger("adaptlearn.api")

# Configure structured logging for the entire adaptlearn namespace
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)

PROJECT_ROOT = Path(__file__).resolve().parents[1]
SRC_ROOT = PROJECT_ROOT / "src"
if str(SRC_ROOT) not in sys.path:
    sys.path.insert(0, str(SRC_ROOT))

# ruff: noqa: E402
from adaptlearn.config import Settings
from adaptlearn.pipeline import AdaptLearnService

STATIC_DIR = Path(__file__).resolve().parent / "static"

# --- Global state with lock for thread safety (🔴 Fix #2) ---
_service_lock = asyncio.Lock()
_settings = Settings()
_active_key = _settings.gemini_api_key
_service = AdaptLearnService(_settings, api_key=_active_key)


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("AdaptLearn API starting up")
    yield
    # Cleanup on shutdown (🔴 Fix #3 & #4)
    logger.info("AdaptLearn API shutting down, cleaning up resources")
    _service.close()


app = FastAPI(title="AdaptLearn Web API", version="0.1.0", lifespan=lifespan)
app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")

# CORS — allow GitHub Pages (and dev server) to call the API.
_cors_origins = [o.strip() for o in (_settings.allowed_origins or "").split(",") if o.strip()]
if _cors_origins:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=_cors_origins,
        allow_methods=["GET", "POST"],
        allow_headers=["X-API-Key", "Content-Type"],
    )

# Rate limiting (🟡 Fix #14)
limiter = Limiter(key_func=get_remote_address)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)


@app.middleware("http")
async def _auth_middleware(request: Request, call_next):
    """Enforce X-API-Key header when API_ACCESS_KEY is configured in .env.
    Health check and static assets are always allowed.
    """
    key = _settings.api_access_key
    path = request.url.path
    if key and path.startswith("/api/") and path != "/api/health":
        token = request.headers.get("x-api-key", "")
        if not token or not secrets.compare_digest(token, key):
            return JSONResponse(
                status_code=401,
                content={"detail": "API 金鑰無效或未提供 X-API-Key header。"},
            )
    return await call_next(request)

_cache: TTLCache[str, Any] = TTLCache(maxsize=128, ttl=30)
_cache_large: TTLCache[str, Any] = TTLCache(maxsize=32, ttl=60)

F = TypeVar("F", bound=Callable[..., Any])


def _cache_key(*args, **kwargs) -> str:
    key_data = json.dumps({"args": args, "kwargs": kwargs}, sort_keys=True, default=str)
    return hashlib.md5(key_data.encode()).hexdigest()


def cached(cache: TTLCache[str, Any] = None):
    def decorator(func: F) -> F:
        @wraps(func)
        def wrapper(*args, **kwargs):
            c = cache or _cache
            key = f"{func.__name__}:{_cache_key(*args, **kwargs)}"
            if key in c:
                return c[key]
            result = func(*args, **kwargs)
            c[key] = result
            return result
        return wrapper  # type: ignore
    return decorator


def invalidate_cache(*patterns: str) -> None:
    keys_to_delete = [
        k for k in list(_cache.keys()) + list(_cache_large.keys())
        if any(p in k for p in patterns)
    ]
    for k in keys_to_delete:
        _cache.pop(k, None)
        _cache_large.pop(k, None)


class ApiKeyRequest(BaseModel):
    api_key: str = ""


class GenerateRequest(BaseModel):
    question_count: int = Field(default=9, ge=1, le=30)


class GradeRequest(BaseModel):
    answer: str = Field(min_length=1)


def _get_service(api_key_override: str | None = None) -> AdaptLearnService:
    global _active_key
    global _service

    if api_key_override is None:
        return _service

    normalized = api_key_override.strip()
    if normalized != _active_key:
        logger.info("Switching API key, recreating service")
        old_service = _service
        _service = AdaptLearnService(_settings, api_key=normalized)
        _active_key = normalized
        old_service.close()
    return _service


def _serialize_question(question) -> dict[str, Any]:
    return {
        "id": question.id,
        "concept_id": question.concept_id,
        "concept_name": question.concept_name,
        "difficulty": question.difficulty,
        "question_text": question.question_text,
        "answer_text": question.answer_text,
        "rationale": question.rationale,
    }


def _serialize_review_item(item) -> dict[str, Any]:
    return {
        "concept_id": item.concept_id,
        "concept_name": item.concept_name,
        "priority": item.priority,
        "next_review_at": item.next_review_at.isoformat(timespec="seconds"),
        "suggested_slot": item.suggested_slot,
        "reason": item.reason,
    }


@app.get("/")
def index() -> FileResponse:
    return FileResponse(STATIC_DIR / "index.html")


@app.get("/api/health")
@cached(_cache)
def health() -> dict[str, Any]:
    service = _get_service()
    return {
        "status": "ok",
        "llm_enabled": service.llm_enabled,
        "metrics": service.get_metrics(),
    }


@app.post("/api/config/api-key")
@limiter.limit("20/minute")
def configure_api_key(request: Request, payload: ApiKeyRequest) -> dict[str, Any]:
    service = _get_service(payload.api_key)
    invalidate_cache("health", "concept", "mastery", "tonight", "graph", "review", "questions")
    return {"llm_enabled": service.llm_enabled}


@app.post("/api/material/ingest")
@limiter.limit("5/minute")
async def ingest_material(
    request: Request,
    file: UploadFile = File(...),
    course_name: str = Form("General Course"),
    template_mode: str = Form("generic"),
    api_key: str | None = Form(default=None),
) -> dict[str, Any]:
    if not file.filename:
        raise HTTPException(status_code=400, detail="缺少檔名，請重新上傳。")

    file_bytes = await file.read()
    if not file_bytes:
        raise HTTPException(status_code=400, detail="上傳檔案是空的，請確認內容。")

    service = _get_service(api_key_override=api_key)
    try:
        # ingest_material is synchronous and can run for many seconds (OCR + LLM calls).
        # Run it in a threadpool so the single uvicorn worker's event loop stays free to
        # answer health checks — otherwise a long ingest blocks the worker and the hosting
        # proxy (Render) returns a 502 Bad Gateway.
        result = await run_in_threadpool(
            service.ingest_material,
            file_name=file.filename,
            file_bytes=file_bytes,
            course_name=course_name.strip() or "Course",
            template_mode=template_mode,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"教材處理失敗：{exc}") from exc

    invalidate_cache("concept", "mastery", "tonight", "graph", "health", "review")
    return {"ok": True, **result}


@app.get("/api/concepts")
@cached(_cache_large)
def list_concepts() -> dict[str, Any]:
    concepts = _get_service().list_concepts()
    return {
        "items": [
            {
                "id": concept.id,
                "name": concept.name,
                "chapter": concept.chapter,
                "description": concept.description,
                "prerequisites": concept.prerequisites,
            }
            for concept in concepts
        ]
    }


@app.get("/api/graph")
@cached(_cache)
def get_graph() -> dict[str, str]:
    return {"dot": _get_service().get_graphviz()}


@app.get("/api/mastery/concepts")
@cached(_cache)
def concept_mastery() -> dict[str, Any]:
    return {"items": _get_service().get_concept_mastery()}


@app.get("/api/mastery/chapters")
@cached(_cache)
def chapter_mastery() -> dict[str, Any]:
    return {"items": _get_service().get_chapter_mastery()}


@app.post("/api/diagnostics/generate")
@limiter.limit("10/minute")
def generate_diagnostics(request: Request, payload: GenerateRequest) -> dict[str, Any]:
    questions = _get_service().generate_diagnostics(question_count=payload.question_count)
    invalidate_cache("questions")
    return {"items": [_serialize_question(question) for question in questions]}


@app.get("/api/questions")
@cached(_cache)
def list_questions(limit: int = 100) -> dict[str, Any]:
    questions = _get_service().list_questions(limit=max(1, min(limit, 500)))
    return {"items": [_serialize_question(question) for question in questions]}


@app.post("/api/questions/{question_id}/grade")
@limiter.limit("30/minute")
def grade_question(request: Request, question_id: str, payload: GradeRequest) -> dict[str, Any]:
    answer = payload.answer.strip()
    if not answer:
        raise HTTPException(status_code=400, detail="作答內容不可空白。")

    try:
        result = _get_service().grade_question(question_id=question_id, user_answer=answer)
        invalidate_cache("mastery", "tonight", "health", "review")
        return result
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@app.post("/api/review/recalculate")
@limiter.limit("10/minute")
def recalculate_review_plan(request: Request) -> dict[str, Any]:
    items = _get_service().build_and_save_review_plan()
    invalidate_cache("tonight", "review")
    return {"items": [_serialize_review_item(item) for item in items]}


@app.get("/api/review")
@cached(_cache)
def list_review_plan() -> dict[str, Any]:
    items = _get_service().list_review_plan()
    return {"items": [_serialize_review_item(item) for item in items]}


@app.get("/api/tonight")
@cached(_cache)
def tonight_dashboard(top_n: int = 5) -> dict[str, Any]:
    top_n = max(1, min(top_n, 20))
    return _get_service().get_tonight_study_dashboard(top_n=top_n)


# ── New endpoints: courses, cross-course, heatmap ──────────────────

@app.get("/api/courses")
@cached(_cache)
def list_courses() -> dict[str, Any]:
    courses = _get_service().list_courses()
    return {
        "items": [
            {
                "id": c.id,
                "subject": c.subject,
                "filename": c.filename,
                "uploaded_at": c.uploaded_at.isoformat(timespec="seconds"),
            }
            for c in courses
        ]
    }


@app.get("/api/cross-course-edges")
@cached(_cache)
def cross_course_edges() -> dict[str, Any]:
    edges = _get_service().list_cross_course_edges()
    return {
        "items": [
            {
                "from_concept_id": e.from_concept_id,
                "to_concept_id": e.to_concept_id,
                "similarity": e.similarity,
                "link_type": e.link_type,
            }
            for e in edges
        ]
    }


@app.get("/api/heatmap/{course_id}")
def class_heatmap(course_id: str) -> dict[str, Any]:
    return {"items": _get_service().get_class_heatmap(course_id)}


@app.get("/api/heatmap/{course_id}/weak")
def class_weak_concepts(course_id: str, top_n: int = 3) -> dict[str, Any]:
    top_n = max(1, min(top_n, 10))
    return {"items": _get_service().get_class_weak_concepts(course_id, top_n=top_n)}


@app.get("/{full_path:path}")
def spa_entry(full_path: str) -> FileResponse:
    if full_path.startswith("api/"):
        raise HTTPException(status_code=404, detail="Not found")
    return FileResponse(STATIC_DIR / "index.html")
