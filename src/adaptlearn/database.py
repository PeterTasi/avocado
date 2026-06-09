from __future__ import annotations

import json
import logging
from collections import defaultdict
from contextlib import contextmanager
from datetime import datetime, timezone
from typing import Iterator

import psycopg2
import psycopg2.extras
import psycopg2.pool

from .models import Attempt, ClassNodeStats, Concept, ConceptDetail, ConceptEdge, Course, CrossCourseEdge, Question, ReviewItem

logger = logging.getLogger("adaptlearn.db")


class StudyRepository:
    def __init__(self, database_url: str) -> None:
        self._url = database_url
        self._pool: psycopg2.pool.ThreadedConnectionPool = (
            psycopg2.pool.ThreadedConnectionPool(minconn=1, maxconn=10, dsn=database_url)
        )
        # In-memory cache so get_active_course_id() immediately reflects ingest within the same process.
        self._active_course_id: str | None = None

    def __enter__(self) -> "StudyRepository":
        return self

    def __exit__(self, exc_type, exc_val, exc_tb) -> None:
        self.close()

    @contextmanager
    def _connect(self) -> Iterator[psycopg2.extras.RealDictCursor]:
        conn = self._pool.getconn()
        try:
            with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                yield cur
            conn.commit()
        except Exception:
            conn.rollback()
            raise
        finally:
            self._pool.putconn(conn)

    def close(self) -> None:
        self._pool.closeall()

    def initialize(self) -> None:
        with self._connect() as cur:
            cur.execute("""
                CREATE TABLE IF NOT EXISTS courses (
                    id TEXT PRIMARY KEY,
                    user_id TEXT NOT NULL DEFAULT 'default',
                    subject TEXT,
                    filename TEXT,
                    uploaded_at TEXT NOT NULL
                )
            """)
            cur.execute("""
                CREATE TABLE IF NOT EXISTS concepts (
                    id TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    chapter TEXT NOT NULL,
                    description TEXT NOT NULL,
                    prerequisites_json TEXT NOT NULL DEFAULT '[]',
                    course_id TEXT REFERENCES courses(id)
                )
            """)
            cur.execute("""
                CREATE TABLE IF NOT EXISTS concept_edges (
                    source_id TEXT NOT NULL,
                    target_id TEXT NOT NULL,
                    relation TEXT NOT NULL,
                    PRIMARY KEY (source_id, target_id, relation)
                )
            """)
            cur.execute("""
                CREATE TABLE IF NOT EXISTS cross_course_edges (
                    from_concept_id TEXT NOT NULL,
                    to_concept_id TEXT NOT NULL,
                    similarity DOUBLE PRECISION NOT NULL,
                    link_type TEXT NOT NULL DEFAULT 'semantic',
                    PRIMARY KEY (from_concept_id, to_concept_id)
                )
            """)
            cur.execute("""
                CREATE TABLE IF NOT EXISTS questions (
                    id TEXT PRIMARY KEY,
                    concept_id TEXT NOT NULL,
                    concept_name TEXT NOT NULL,
                    difficulty TEXT NOT NULL,
                    question_text TEXT NOT NULL,
                    answer_text TEXT NOT NULL,
                    rationale TEXT NOT NULL,
                    created_at TEXT NOT NULL
                )
            """)
            cur.execute("""
                CREATE TABLE IF NOT EXISTS attempts (
                    id BIGSERIAL PRIMARY KEY,
                    question_id TEXT NOT NULL,
                    concept_id TEXT NOT NULL,
                    user_answer TEXT NOT NULL,
                    is_correct SMALLINT NOT NULL,
                    score DOUBLE PRECISION NOT NULL,
                    feedback TEXT NOT NULL,
                    created_at TEXT NOT NULL
                )
            """)
            cur.execute("""
                CREATE TABLE IF NOT EXISTS review_plan (
                    concept_id TEXT PRIMARY KEY,
                    concept_name TEXT NOT NULL,
                    priority DOUBLE PRECISION NOT NULL,
                    next_review_at TEXT NOT NULL,
                    suggested_slot TEXT NOT NULL,
                    reason TEXT NOT NULL
                )
            """)
            cur.execute("""
                CREATE TABLE IF NOT EXISTS class_node_stats (
                    course_id TEXT NOT NULL,
                    concept_id TEXT NOT NULL,
                    error_rate DOUBLE PRECISION NOT NULL DEFAULT 0.0,
                    avg_attempts DOUBLE PRECISION NOT NULL DEFAULT 0.0,
                    stuck_count INTEGER NOT NULL DEFAULT 0,
                    sample_count INTEGER NOT NULL DEFAULT 0,
                    updated_at TEXT NOT NULL,
                    PRIMARY KEY (course_id, concept_id)
                )
            """)
            cur.execute("CREATE INDEX IF NOT EXISTS idx_attempts_concept_id ON attempts(concept_id)")
            cur.execute("CREATE INDEX IF NOT EXISTS idx_attempts_created_at ON attempts(created_at)")
            cur.execute("CREATE INDEX IF NOT EXISTS idx_questions_concept_id ON questions(concept_id)")
            cur.execute("CREATE INDEX IF NOT EXISTS idx_concept_edges_source ON concept_edges(source_id)")
            cur.execute("CREATE INDEX IF NOT EXISTS idx_concept_edges_target ON concept_edges(target_id)")
            cur.execute("CREATE INDEX IF NOT EXISTS idx_cross_course_from ON cross_course_edges(from_concept_id)")
            cur.execute("CREATE INDEX IF NOT EXISTS idx_cross_course_to ON cross_course_edges(to_concept_id)")
            cur.execute("CREATE INDEX IF NOT EXISTS idx_concepts_course_id ON concepts(course_id)")
            # Legacy migration: add course_id column if missing on existing databases
            cur.execute("""
                SELECT 1 FROM information_schema.columns
                WHERE table_name = 'concepts' AND column_name = 'course_id'
            """)
            if not cur.fetchone():
                cur.execute("ALTER TABLE concepts ADD COLUMN course_id TEXT REFERENCES courses(id)")
            # Migration: add retention/stability to review_plan if missing
            cur.execute("""
                SELECT 1 FROM information_schema.columns
                WHERE table_name = 'review_plan' AND column_name = 'retention'
            """)
            if not cur.fetchone():
                cur.execute("ALTER TABLE review_plan ADD COLUMN retention REAL NOT NULL DEFAULT 0.0")
                cur.execute("ALTER TABLE review_plan ADD COLUMN stability REAL NOT NULL DEFAULT 0.0")

        # P5: run versioned migrations after base schema is ready
        self._run_migrations()

    # ── P5: Migration system ───────────────────────────────────────

    def _run_migrations(self) -> None:
        with self._connect() as cur:
            cur.execute("""
                CREATE TABLE IF NOT EXISTS schema_version (
                    version INTEGER PRIMARY KEY,
                    applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
                )
            """)
            cur.execute("SELECT version FROM schema_version ORDER BY version")
            applied = {row["version"] for row in cur.fetchall()}

        migrations = [
            (1, self._migration_001_add_timestamptz),
            (2, self._migration_002_concept_details),
        ]
        for version, fn in migrations:
            if version not in applied:
                logger.info("Applying DB migration %d", version)
                fn()
                with self._connect() as cur:
                    cur.execute("INSERT INTO schema_version (version) VALUES (%s)", (version,))
                logger.info("DB migration %d applied successfully", version)

    def _migration_001_add_timestamptz(self) -> None:
        """Convert TEXT time columns to TIMESTAMPTZ for proper date arithmetic (P2)."""
        columns = [
            ("attempts", "created_at"),
            ("questions", "created_at"),
            ("courses", "uploaded_at"),
            ("review_plan", "next_review_at"),
            ("class_node_stats", "updated_at"),
        ]
        with self._connect() as cur:
            for table, col in columns:
                cur.execute("""
                    SELECT data_type FROM information_schema.columns
                    WHERE table_name = %s AND column_name = %s
                """, (table, col))
                row = cur.fetchone()
                if row and row["data_type"] != "timestamp with time zone":
                    cur.execute(f"""
                        ALTER TABLE {table}
                        ALTER COLUMN {col} TYPE TIMESTAMPTZ
                        USING {col}::timestamptz
                    """)
                    logger.info("Converted %s.%s to TIMESTAMPTZ", table, col)

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

    # ── P1: Course-scoped state management ────────────────────────

    def reset_course_state(self, course_id: str) -> None:
        """Delete all concept-derived data and attempts for a single course."""
        with self._connect() as cur:
            # Delete attempts first (they reference concept IDs)
            cur.execute("""
                DELETE FROM attempts
                WHERE concept_id IN (SELECT id FROM concepts WHERE course_id = %s)
            """, (course_id,))
            cur.execute("""
                DELETE FROM cross_course_edges
                WHERE from_concept_id IN (SELECT id FROM concepts WHERE course_id = %s)
                   OR to_concept_id IN (SELECT id FROM concepts WHERE course_id = %s)
            """, (course_id, course_id))
            cur.execute("DELETE FROM class_node_stats WHERE course_id = %s", (course_id,))
            cur.execute("""
                DELETE FROM concept_edges
                WHERE source_id IN (SELECT id FROM concepts WHERE course_id = %s)
            """, (course_id,))
            cur.execute("""
                DELETE FROM questions
                WHERE concept_id IN (SELECT id FROM concepts WHERE course_id = %s)
            """, (course_id,))
            cur.execute("""
                DELETE FROM review_plan
                WHERE concept_id IN (SELECT id FROM concepts WHERE course_id = %s)
            """, (course_id,))
            cur.execute("DELETE FROM concepts WHERE course_id = %s", (course_id,))

    def delete_course(self, course_id: str) -> None:
        """Remove the course record itself (call after reset_course_state)."""
        with self._connect() as cur:
            cur.execute("DELETE FROM courses WHERE id = %s", (course_id,))
            if self._active_course_id == course_id:
                self._active_course_id = None

    def set_active_course(self, course_id: str) -> None:
        """Mark a course as active within this process (called by ingest_material)."""
        self._active_course_id = course_id

    def get_active_course_id(self) -> str | None:
        """Return the active course id.

        Uses in-memory cache (set by ingest_material) when available so that
        get_active_course_id() immediately reflects the just-ingested course within
        the same process.  Falls back to DB query filtered to non-future timestamps
        (guards against migration artifact where old local-time strings were stored
        as UTC, making them appear to be in the future on UTC+N systems).
        """
        if self._active_course_id:
            return self._active_course_id
        with self._connect() as cur:
            cur.execute(
                "SELECT id FROM courses WHERE uploaded_at <= now() ORDER BY uploaded_at DESC LIMIT 1"
            )
            row = cur.fetchone()
        return row["id"] if row else None

    def reset_learning_state(self, include_attempts: bool = True) -> None:
        """Legacy global wipe — kept for tests; prefer reset_course_state for normal use."""
        with self._connect() as cur:
            cur.execute("DELETE FROM concept_edges")
            cur.execute("DELETE FROM concepts")
            cur.execute("DELETE FROM questions")
            cur.execute("DELETE FROM review_plan")
            if include_attempts:
                cur.execute("DELETE FROM attempts")

    def upsert_concepts(self, concepts: list[Concept]) -> None:
        if not concepts:
            return

        with self._connect() as cur:
            cur.executemany(
                """
                INSERT INTO concepts (id, name, chapter, description, prerequisites_json, course_id)
                VALUES (%s, %s, %s, %s, %s, %s)
                ON CONFLICT (id) DO UPDATE SET
                    name = EXCLUDED.name,
                    chapter = EXCLUDED.chapter,
                    description = EXCLUDED.description,
                    prerequisites_json = EXCLUDED.prerequisites_json,
                    course_id = EXCLUDED.course_id
                """,
                [
                    (
                        concept.id,
                        concept.name,
                        concept.chapter,
                        concept.description,
                        json.dumps(concept.prerequisites, ensure_ascii=False),
                        concept.course_id or None,
                    )
                    for concept in concepts
                ],
            )

    def list_concepts(self, course_id: str | None = None) -> list[Concept]:
        with self._connect() as cur:
            if course_id:
                cur.execute(
                    """
                    SELECT id, name, chapter, description, prerequisites_json
                    FROM concepts
                    WHERE course_id = %s
                    ORDER BY chapter, name
                    """,
                    (course_id,),
                )
            else:
                cur.execute(
                    """
                    SELECT id, name, chapter, description, prerequisites_json
                    FROM concepts
                    ORDER BY chapter, name
                    """
                )
            rows = cur.fetchall()

        concepts: list[Concept] = []
        for row in rows:
            raw_prereq = row["prerequisites_json"]
            prerequisites = json.loads(raw_prereq) if raw_prereq else []
            concepts.append(
                Concept(
                    id=row["id"],
                    name=row["name"],
                    chapter=row["chapter"],
                    description=row["description"],
                    prerequisites=prerequisites,
                )
            )
        return concepts

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

    def replace_edges(self, edges: list[ConceptEdge]) -> None:
        """Insert edges (UPSERT). Course-scoped deletion is handled by reset_course_state."""
        if not edges:
            return
        with self._connect() as cur:
            cur.executemany(
                """
                INSERT INTO concept_edges (source_id, target_id, relation)
                VALUES (%s, %s, %s)
                ON CONFLICT (source_id, target_id, relation) DO NOTHING
                """,
                [(edge.source_id, edge.target_id, edge.relation) for edge in edges],
            )

    def list_edges(self, course_id: str | None = None) -> list[ConceptEdge]:
        with self._connect() as cur:
            if course_id:
                cur.execute(
                    """
                    SELECT ce.source_id, ce.target_id, ce.relation
                    FROM concept_edges ce
                    WHERE ce.source_id IN (SELECT id FROM concepts WHERE course_id = %s)
                    ORDER BY ce.source_id, ce.target_id
                    """,
                    (course_id,),
                )
            else:
                cur.execute(
                    """
                    SELECT source_id, target_id, relation
                    FROM concept_edges
                    ORDER BY source_id, target_id
                    """
                )
            rows = cur.fetchall()
        return [ConceptEdge(source_id=row["source_id"], target_id=row["target_id"], relation=row["relation"]) for row in rows]

    def save_questions(self, questions: list[Question]) -> None:
        if not questions:
            return

        now = datetime.now(timezone.utc)
        with self._connect() as cur:
            cur.executemany(
                """
                INSERT INTO questions
                (id, concept_id, concept_name, difficulty, question_text, answer_text, rationale, created_at)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (id) DO UPDATE SET
                    concept_id = EXCLUDED.concept_id,
                    concept_name = EXCLUDED.concept_name,
                    difficulty = EXCLUDED.difficulty,
                    question_text = EXCLUDED.question_text,
                    answer_text = EXCLUDED.answer_text,
                    rationale = EXCLUDED.rationale
                """,
                [
                    (
                        question.id,
                        question.concept_id,
                        question.concept_name,
                        question.difficulty,
                        question.question_text,
                        question.answer_text,
                        question.rationale,
                        now,
                    )
                    for question in questions
                ],
            )

    def list_questions(self, limit: int = 50) -> list[Question]:
        with self._connect() as cur:
            cur.execute(
                """
                SELECT id, concept_id, concept_name, difficulty, question_text, answer_text, rationale
                FROM questions
                ORDER BY created_at DESC
                LIMIT %s
                """,
                (limit,),
            )
            rows = cur.fetchall()
        return [
            Question(
                id=row["id"],
                concept_id=row["concept_id"],
                concept_name=row["concept_name"],
                difficulty=row["difficulty"],
                question_text=row["question_text"],
                answer_text=row["answer_text"],
                rationale=row["rationale"],
            )
            for row in rows
        ]

    def get_question(self, question_id: str) -> Question | None:
        with self._connect() as cur:
            cur.execute(
                """
                SELECT id, concept_id, concept_name, difficulty, question_text, answer_text, rationale
                FROM questions
                WHERE id = %s
                """,
                (question_id,),
            )
            row = cur.fetchone()

        if not row:
            return None

        return Question(
            id=row["id"],
            concept_id=row["concept_id"],
            concept_name=row["concept_name"],
            difficulty=row["difficulty"],
            question_text=row["question_text"],
            answer_text=row["answer_text"],
            rationale=row["rationale"],
        )

    def save_attempt(self, attempt: Attempt) -> None:
        with self._connect() as cur:
            cur.execute(
                """
                INSERT INTO attempts
                (question_id, concept_id, user_answer, is_correct, score, feedback, created_at)
                VALUES (%s, %s, %s, %s, %s, %s, %s)
                """,
                (
                    attempt.question_id,
                    attempt.concept_id,
                    attempt.user_answer,
                    1 if attempt.is_correct else 0,
                    attempt.score,
                    attempt.feedback,
                    attempt.created_at,
                ),
            )

    def list_attempts(self, limit: int = 1000) -> list[Attempt]:
        with self._connect() as cur:
            cur.execute(
                """
                SELECT question_id, concept_id, user_answer, is_correct, score, feedback, created_at
                FROM attempts
                ORDER BY created_at DESC
                LIMIT %s
                """,
                (limit,),
            )
            rows = cur.fetchall()

        attempts: list[Attempt] = []
        for row in rows:
            attempts.append(
                Attempt(
                    question_id=row["question_id"],
                    concept_id=row["concept_id"],
                    user_answer=row["user_answer"],
                    is_correct=bool(row["is_correct"]),
                    score=float(row["score"]),
                    feedback=row["feedback"],
                    created_at=row["created_at"],
                )
            )
        return attempts

    def concept_score_summary(self, course_id: str | None = None) -> dict[str, dict]:
        """Return avg_score and attempt count per concept via SQL GROUP BY."""
        with self._connect() as cur:
            if course_id:
                cur.execute(
                    """
                    SELECT a.concept_id, AVG(a.score) AS avg_score, COUNT(*) AS cnt
                    FROM attempts a
                    JOIN concepts c ON c.id = a.concept_id
                    WHERE c.course_id = %s
                    GROUP BY a.concept_id
                    """,
                    (course_id,),
                )
            else:
                cur.execute(
                    """
                    SELECT concept_id, AVG(score) AS avg_score, COUNT(*) AS cnt
                    FROM attempts
                    GROUP BY concept_id
                    """
                )
            rows = cur.fetchall()
        return {
            row["concept_id"]: {"avg_score": float(row["avg_score"]), "count": int(row["cnt"])}
            for row in rows
        }

    def save_review_plan(self, review_items: list[ReviewItem]) -> None:
        with self._connect() as cur:
            cur.execute("DELETE FROM review_plan")
            if not review_items:
                return

            cur.executemany(
                """
                INSERT INTO review_plan
                (concept_id, concept_name, priority, next_review_at, suggested_slot, reason, retention, stability)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                """,
                [
                    (
                        item.concept_id,
                        item.concept_name,
                        item.priority,
                        item.next_review_at,
                        item.suggested_slot,
                        item.reason,
                        item.retention,
                        item.stability,
                    )
                    for item in review_items
                ],
            )

    def list_review_plan(self, limit: int = 200) -> list[ReviewItem]:
        with self._connect() as cur:
            cur.execute(
                """
                SELECT concept_id, concept_name, priority, next_review_at, suggested_slot, reason,
                       COALESCE(retention, 0.0) AS retention, COALESCE(stability, 0.0) AS stability
                FROM review_plan
                ORDER BY priority DESC
                LIMIT %s
                """,
                (limit,),
            )
            rows = cur.fetchall()

        review_items: list[ReviewItem] = []
        for row in rows:
            review_items.append(
                ReviewItem(
                    concept_id=row["concept_id"],
                    concept_name=row["concept_name"],
                    priority=float(row["priority"]),
                    next_review_at=row["next_review_at"],
                    suggested_slot=row["suggested_slot"],
                    reason=row["reason"],
                    retention=float(row["retention"]),
                    stability=float(row["stability"]),
                )
            )
        return review_items

    def get_metrics(self, course_id: str | None = None) -> dict[str, float]:
        with self._connect() as cur:
            if course_id:
                cur.execute("SELECT COUNT(*) AS cnt FROM concepts WHERE course_id = %s", (course_id,))
            else:
                cur.execute("SELECT COUNT(*) AS cnt FROM concepts")
            concept_count = cur.fetchone()["cnt"]

            if course_id:
                cur.execute("""
                    SELECT COUNT(*) AS cnt FROM attempts
                    WHERE concept_id IN (SELECT id FROM concepts WHERE course_id = %s)
                """, (course_id,))
            else:
                cur.execute("SELECT COUNT(*) AS cnt FROM attempts")
            attempt_count = cur.fetchone()["cnt"]

            if course_id:
                cur.execute("""
                    SELECT AVG(score) AS avg_score FROM attempts
                    WHERE concept_id IN (SELECT id FROM concepts WHERE course_id = %s)
                """, (course_id,))
            else:
                cur.execute("SELECT AVG(score) AS avg_score FROM attempts")
            avg_score = cur.fetchone()["avg_score"]

        return {
            "concept_count": float(concept_count),
            "attempt_count": float(attempt_count),
            "avg_score": float(avg_score) if avg_score is not None else 0.0,
        }

    # ── Course management ──────────────────────────────────────────

    def save_course(self, course: Course) -> None:
        with self._connect() as cur:
            cur.execute(
                """
                INSERT INTO courses (id, user_id, subject, filename, uploaded_at)
                VALUES (%s, %s, %s, %s, %s)
                ON CONFLICT (id) DO UPDATE SET
                    user_id = EXCLUDED.user_id,
                    subject = EXCLUDED.subject,
                    filename = EXCLUDED.filename,
                    uploaded_at = EXCLUDED.uploaded_at
                """,
                (course.id, course.user_id, course.subject, course.filename, course.uploaded_at),
            )

    def list_courses(self, user_id: str = "default") -> list[Course]:
        with self._connect() as cur:
            cur.execute(
                "SELECT id, user_id, subject, filename, uploaded_at FROM courses WHERE user_id = %s ORDER BY uploaded_at DESC",
                (user_id,),
            )
            rows = cur.fetchall()
        return [
            Course(
                id=row["id"],
                user_id=row["user_id"],
                subject=row["subject"] or "",
                filename=row["filename"] or "",
                uploaded_at=row["uploaded_at"],
            )
            for row in rows
        ]

    def get_course(self, course_id: str) -> Course | None:
        with self._connect() as cur:
            cur.execute(
                "SELECT id, user_id, subject, filename, uploaded_at FROM courses WHERE id = %s",
                (course_id,),
            )
            row = cur.fetchone()
        if not row:
            return None
        return Course(
            id=row["id"],
            user_id=row["user_id"],
            subject=row["subject"] or "",
            filename=row["filename"] or "",
            uploaded_at=row["uploaded_at"],
        )

    # ── Cross-course edges ─────────────────────────────────────────

    def save_cross_course_edges(self, edges: list[CrossCourseEdge]) -> None:
        if not edges:
            return
        with self._connect() as cur:
            cur.executemany(
                """
                INSERT INTO cross_course_edges (from_concept_id, to_concept_id, similarity, link_type)
                VALUES (%s, %s, %s, %s)
                ON CONFLICT (from_concept_id, to_concept_id) DO UPDATE SET
                    similarity = EXCLUDED.similarity,
                    link_type = EXCLUDED.link_type
                """,
                [(e.from_concept_id, e.to_concept_id, e.similarity, e.link_type) for e in edges],
            )

    def list_cross_course_edges(self) -> list[CrossCourseEdge]:
        with self._connect() as cur:
            cur.execute(
                "SELECT from_concept_id, to_concept_id, similarity, link_type FROM cross_course_edges ORDER BY similarity DESC"
            )
            rows = cur.fetchall()
        return [
            CrossCourseEdge(
                from_concept_id=row["from_concept_id"],
                to_concept_id=row["to_concept_id"],
                similarity=float(row["similarity"]),
                link_type=row["link_type"],
            )
            for row in rows
        ]

    # ── Class node stats (heatmap) ─────────────────────────────────

    def update_class_node_stats(self, course_id: str) -> list[ClassNodeStats]:
        """Recompute class-level stats for every concept in a course from attempts."""
        with self._connect() as cur:
            cur.execute(
                """
                SELECT c.id AS concept_id,
                       COUNT(a.id) AS total,
                       SUM(CASE WHEN a.is_correct = 0 THEN 1 ELSE 0 END) AS wrong,
                       AVG(CASE WHEN a.id IS NOT NULL THEN 1.0 ELSE 0.0 END) AS avg_att
                FROM concepts c
                LEFT JOIN attempts a ON a.concept_id = c.id
                WHERE c.course_id = %s
                GROUP BY c.id
                """,
                (course_id,),
            )
            rows = cur.fetchall()

            stats: list[ClassNodeStats] = []
            now = datetime.now(timezone.utc)
            for row in rows:
                total = int(row["total"] or 0)
                wrong = int(row["wrong"] or 0)
                error_rate = wrong / total if total > 0 else 0.0
                stat = ClassNodeStats(
                    course_id=course_id,
                    concept_id=row["concept_id"],
                    error_rate=round(error_rate, 4),
                    avg_attempts=float(row["avg_att"] or 0.0),
                    stuck_count=0,
                    sample_count=total,
                    updated_at=now,
                )
                stats.append(stat)

            if stats:
                cur.executemany(
                    """
                    INSERT INTO class_node_stats
                    (course_id, concept_id, error_rate, avg_attempts, stuck_count, sample_count, updated_at)
                    VALUES (%s, %s, %s, %s, %s, %s, %s)
                    ON CONFLICT (course_id, concept_id) DO UPDATE SET
                        error_rate = EXCLUDED.error_rate,
                        avg_attempts = EXCLUDED.avg_attempts,
                        stuck_count = EXCLUDED.stuck_count,
                        sample_count = EXCLUDED.sample_count,
                        updated_at = EXCLUDED.updated_at
                    """,
                    [
                        (s.course_id, s.concept_id, s.error_rate, s.avg_attempts,
                         s.stuck_count, s.sample_count, s.updated_at)
                        for s in stats
                    ],
                )

        return stats

    def list_class_node_stats(self, course_id: str) -> list[ClassNodeStats]:
        with self._connect() as cur:
            cur.execute(
                """
                SELECT course_id, concept_id, error_rate, avg_attempts, stuck_count, sample_count, updated_at
                FROM class_node_stats
                WHERE course_id = %s
                ORDER BY error_rate DESC
                """,
                (course_id,),
            )
            rows = cur.fetchall()
        return [
            ClassNodeStats(
                course_id=row["course_id"],
                concept_id=row["concept_id"],
                error_rate=float(row["error_rate"]),
                avg_attempts=float(row["avg_attempts"]),
                stuck_count=int(row["stuck_count"]),
                sample_count=int(row["sample_count"]),
                updated_at=row["updated_at"],
            )
            for row in rows
        ]

    # ── P2: Progress trend API ─────────────────────────────────────

    def concept_progress(self, course_id: str, days: int = 30) -> list[dict]:
        """Return daily avg_score per concept for the given number of past days."""
        with self._connect() as cur:
            cur.execute(
                """
                SELECT a.concept_id,
                       date_trunc('day', a.created_at) AS day,
                       AVG(a.score) AS avg_score,
                       COUNT(*) AS n
                FROM attempts a
                WHERE a.created_at >= now() - (%s || ' days')::interval
                  AND a.concept_id IN (SELECT id FROM concepts WHERE course_id = %s)
                GROUP BY a.concept_id, day
                ORDER BY a.concept_id, day
                """,
                (str(days), course_id),
            )
            rows = cur.fetchall()

        by_concept: dict[str, list[dict]] = defaultdict(list)
        for row in rows:
            day_val = row["day"]
            day_str = day_val.isoformat()[:10] if hasattr(day_val, "isoformat") else str(day_val)[:10]
            by_concept[row["concept_id"]].append({
                "day": day_str,
                "avg_score": round(float(row["avg_score"]), 3),
                "n": int(row["n"]),
            })

        return [
            {"concept_id": cid, "daily": daily}
            for cid, daily in by_concept.items()
        ]
