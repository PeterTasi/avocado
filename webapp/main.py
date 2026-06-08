from __future__ import annotations

import hashlib
import json
import logging
import secrets
import sys
import threading
import time
import uuid
from contextlib import asynccontextmanager
from functools import wraps
from pathlib import Path
from typing import Any, Callable, TypeVar

from cachetools import TTLCache
from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
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

_settings = Settings()
_service = AdaptLearnService(_settings)


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


# --- Async ingest job store --------------------------------------------------
# A 50-page upload runs OCR/LLM for minutes. A synchronous request stays open that
# whole time and Render's proxy returns 502 once it exceeds the gateway timeout
# (cold-start spin-up compounds this). Instead, POST starts a background thread and
# returns a job_id immediately; the frontend polls for status. In-memory store is
# fine for a single-instance free tier — jobs are lost on restart (acceptable: the
# frontend surfaces a timeout/error).
MAX_UPLOAD_BYTES = 25 * 1024 * 1024  # 25 MB guard against OOM on the 512 MB free tier
_INGEST_JOB_TTL = 1800  # prune finished jobs after 30 min

_ingest_jobs: dict[str, dict[str, Any]] = {}
_ingest_jobs_lock = threading.Lock()


def _set_job(job_id: str, **fields: Any) -> None:
    with _ingest_jobs_lock:
        job = _ingest_jobs.setdefault(job_id, {})
        job.update(fields)
        job["updated_at"] = time.time()


def _get_job(job_id: str) -> dict[str, Any] | None:
    with _ingest_jobs_lock:
        job = _ingest_jobs.get(job_id)
        return dict(job) if job else None


def _prune_jobs() -> None:
    now = time.time()
    with _ingest_jobs_lock:
        stale = [
            k for k, v in _ingest_jobs.items()
            if v.get("status") in ("done", "error")
            and now - v.get("updated_at", now) > _INGEST_JOB_TTL
        ]
        for k in stale:
            _ingest_jobs.pop(k, None)


def _run_ingest_job(
    job_id: str,
    service: AdaptLearnService,
    file_name: str,
    file_bytes: bytes,
    course_name: str,
    template_mode: str,
) -> None:
    try:
        _set_job(job_id, status="processing", stage="解析教材內容")
        result = service.ingest_material(
            file_name=file_name,
            file_bytes=file_bytes,
            course_name=course_name,
            template_mode=template_mode,
            progress=lambda stage: _set_job(job_id, stage=stage),
        )
        invalidate_cache("concept", "mastery", "tonight", "graph", "health", "review")
        _set_job(job_id, status="done", stage="完成", result=result)
    except ValueError as exc:
        _set_job(job_id, status="error", error=str(exc))
    except Exception as exc:  # noqa: BLE001 — surface any failure to the poller
        logger.exception("ingest job %s failed", job_id)
        _set_job(job_id, status="error", error=f"教材處理失敗：{exc}")


class ApiKeyRequest(BaseModel):
    api_key: str = ""


class GenerateRequest(BaseModel):
    question_count: int = Field(default=9, ge=1, le=30)


class GradeRequest(BaseModel):
    answer: str = Field(min_length=1)


def _get_service(api_key_override: str | None = None) -> AdaptLearnService:
    if api_key_override is not None:
        normalized = api_key_override.strip()
        if normalized != _service.gemini.api_key:
            _service.set_api_key(normalized)
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
        "retention": item.retention,
        "stability": item.stability,
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
    if len(file_bytes) > MAX_UPLOAD_BYTES:
        size_mb = len(file_bytes) // (1024 * 1024)
        limit_mb = MAX_UPLOAD_BYTES // (1024 * 1024)
        raise HTTPException(
            status_code=413,
            detail=f"檔案太大（{size_mb} MB），目前上限 {limit_mb} MB。請壓縮 PDF 或拆分重點章節後再上傳。",
        )

    service = _get_service(api_key_override=api_key)

    # Ingest runs for minutes on large files — too long for a synchronous request without
    # tripping the proxy's 502 gateway timeout. Start a background thread and return a
    # job_id; the client polls /api/material/ingest/status/{job_id}.
    _prune_jobs()
    job_id = uuid.uuid4().hex
    _set_job(job_id, status="processing", stage="排隊中", filename=file.filename)
    threading.Thread(
        target=_run_ingest_job,
        args=(
            job_id,
            service,
            file.filename,
            file_bytes,
            course_name.strip() or "Course",
            template_mode,
        ),
        daemon=True,
    ).start()
    return JSONResponse(status_code=202, content={"job_id": job_id, "status": "processing"})


@app.get("/api/material/ingest/status/{job_id}")
@limiter.limit("120/minute")
def ingest_status(request: Request, job_id: str) -> dict[str, Any]:
    job = _get_job(job_id)
    if job is None:
        raise HTTPException(
            status_code=404, detail="找不到這個處理任務（可能已完成過期或伺服器重啟）。"
        )
    status = job.get("status", "processing")
    payload: dict[str, Any] = {"status": status, "stage": job.get("stage", "")}
    if status == "done":
        payload["ok"] = True
        payload.update(job.get("result") or {})
    elif status == "error":
        payload["detail"] = job.get("error", "教材處理失敗")
    return payload


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


@app.delete("/api/courses/{course_id}")
@limiter.limit("10/minute")
def delete_course(request: Request, course_id: str) -> dict[str, Any]:
    try:
        _get_service().clear_course(course_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    invalidate_cache("concept", "mastery", "tonight", "graph", "health", "review", "questions", "course")
    return {"ok": True, "deleted": True, "course_id": course_id}


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


@app.get("/api/progress/concepts")
@cached(_cache)
def concept_progress(days: int = 30) -> dict[str, Any]:
    days = max(1, min(days, 365))
    return {"items": _get_service().get_concept_progress(days=days)}


@app.get("/{full_path:path}")
def spa_entry(full_path: str) -> FileResponse:
    if full_path.startswith("api/"):
        raise HTTPException(status_code=404, detail="Not found")
    return FileResponse(STATIC_DIR / "index.html")
