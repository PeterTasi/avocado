from __future__ import annotations

import json
import logging
from contextlib import contextmanager
from datetime import datetime
from typing import Iterator

import psycopg2
import psycopg2.extras
import psycopg2.pool

from .models import Attempt, ClassNodeStats, Concept, ConceptEdge, Course, CrossCourseEdge, Question, ReviewItem

logger = logging.getLogger("adaptlearn.db")


class StudyRepository:
    def __init__(self, database_url: str) -> None:
        self._url = database_url
        self._pool: psycopg2.pool.ThreadedConnectionPool = (
            psycopg2.pool.ThreadedConnectionPool(minconn=1, maxconn=10, dsn=database_url)
        )

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

    def initialize(self) -> None:  # noqa: PLR0912
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
            # Migration: add course_id column if missing on existing databases
            cur.execute("""
                SELECT 1 FROM information_schema.columns
                WHERE table_name = 'concepts' AND column_name = 'course_id'
            """)
            if not cur.fetchone():
                cur.execute("ALTER TABLE concepts ADD COLUMN course_id TEXT REFERENCES courses(id)")

    def reset_learning_state(self, include_attempts: bool = True) -> None:
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

    def list_concepts(self) -> list[Concept]:
        with self._connect() as cur:
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

    def replace_edges(self, edges: list[ConceptEdge]) -> None:
        with self._connect() as cur:
            cur.execute("DELETE FROM concept_edges")
            if not edges:
                return
            cur.executemany(
                """
                INSERT INTO concept_edges (source_id, target_id, relation)
                VALUES (%s, %s, %s)
                """,
                [(edge.source_id, edge.target_id, edge.relation) for edge in edges],
            )

    def list_edges(self) -> list[ConceptEdge]:
        with self._connect() as cur:
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

        now = datetime.now().isoformat(timespec="seconds")
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
                    attempt.created_at.isoformat(timespec="seconds"),
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
                    created_at=datetime.fromisoformat(row["created_at"]),
                )
            )
        return attempts

    def save_review_plan(self, review_items: list[ReviewItem]) -> None:
        with self._connect() as cur:
            cur.execute("DELETE FROM review_plan")
            if not review_items:
                return

            cur.executemany(
                """
                INSERT INTO review_plan
                (concept_id, concept_name, priority, next_review_at, suggested_slot, reason)
                VALUES (%s, %s, %s, %s, %s, %s)
                """,
                [
                    (
                        item.concept_id,
                        item.concept_name,
                        item.priority,
                        item.next_review_at.isoformat(timespec="seconds"),
                        item.suggested_slot,
                        item.reason,
                    )
                    for item in review_items
                ],
            )

    def list_review_plan(self, limit: int = 200) -> list[ReviewItem]:
        with self._connect() as cur:
            cur.execute(
                """
                SELECT concept_id, concept_name, priority, next_review_at, suggested_slot, reason
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
                    next_review_at=datetime.fromisoformat(row["next_review_at"]),
                    suggested_slot=row["suggested_slot"],
                    reason=row["reason"],
                )
            )
        return review_items

    def get_metrics(self) -> dict[str, float]:
        with self._connect() as cur:
            cur.execute("SELECT COUNT(*) AS cnt FROM concepts")
            concept_count = cur.fetchone()["cnt"]
            cur.execute("SELECT COUNT(*) AS cnt FROM attempts")
            attempt_count = cur.fetchone()["cnt"]
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
                (course.id, course.user_id, course.subject, course.filename, course.uploaded_at.isoformat(timespec="seconds")),
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
                uploaded_at=datetime.fromisoformat(row["uploaded_at"]),
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
            uploaded_at=datetime.fromisoformat(row["uploaded_at"]),
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
            now = datetime.now()
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
                         s.stuck_count, s.sample_count, s.updated_at.isoformat(timespec="seconds"))
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
                updated_at=datetime.fromisoformat(row["updated_at"]),
            )
            for row in rows
        ]
