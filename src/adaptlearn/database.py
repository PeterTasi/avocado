from __future__ import annotations

import json
import logging
import sqlite3
from contextlib import contextmanager
from datetime import datetime
from pathlib import Path
from threading import local

from .models import Attempt, ClassNodeStats, Concept, ConceptEdge, Course, CrossCourseEdge, Question, ReviewItem

logger = logging.getLogger("adaptlearn.db")


class StudyRepository:
    def __init__(self, db_path: Path) -> None:
        self.db_path = db_path
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self._local = local()

    def __enter__(self) -> "StudyRepository":
        return self

    def __exit__(self, exc_type, exc_val, exc_tb) -> None:
        self.close()

    @property
    def _conn(self) -> sqlite3.Connection:
        if not hasattr(self._local, "conn") or self._local.conn is None:
            self._local.conn = self._create_connection()
        return self._local.conn  # type: ignore[no-any-return]

    def _create_connection(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.db_path, check_same_thread=False)
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA synchronous=NORMAL")
        conn.execute("PRAGMA cache_size=-64000")
        conn.row_factory = sqlite3.Row
        return conn

    @contextmanager
    def _connect(self):
        conn = self._conn
        try:
            yield conn
            conn.commit()
        except Exception:
            conn.rollback()
            raise

    def close(self) -> None:
        if hasattr(self._local, "conn") and self._local.conn:
            self._local.conn.close()
            self._local.conn = None

    def initialize(self) -> None:
        with self._connect() as conn:
            conn.executescript(
                """
                CREATE TABLE IF NOT EXISTS courses (
                    id TEXT PRIMARY KEY,
                    user_id TEXT NOT NULL DEFAULT 'default',
                    subject TEXT,
                    filename TEXT,
                    uploaded_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
                );

                CREATE TABLE IF NOT EXISTS concepts (
                    id TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    chapter TEXT NOT NULL,
                    description TEXT NOT NULL,
                    prerequisites_json TEXT NOT NULL DEFAULT '[]',
                    course_id TEXT REFERENCES courses(id)
                );

                CREATE TABLE IF NOT EXISTS concept_edges (
                    source_id TEXT NOT NULL,
                    target_id TEXT NOT NULL,
                    relation TEXT NOT NULL,
                    PRIMARY KEY (source_id, target_id, relation)
                );

                CREATE TABLE IF NOT EXISTS cross_course_edges (
                    from_concept_id TEXT NOT NULL,
                    to_concept_id TEXT NOT NULL,
                    similarity REAL NOT NULL,
                    link_type TEXT NOT NULL DEFAULT 'semantic',
                    PRIMARY KEY (from_concept_id, to_concept_id)
                );

                CREATE TABLE IF NOT EXISTS questions (
                    id TEXT PRIMARY KEY,
                    concept_id TEXT NOT NULL,
                    concept_name TEXT NOT NULL,
                    difficulty TEXT NOT NULL,
                    question_text TEXT NOT NULL,
                    answer_text TEXT NOT NULL,
                    rationale TEXT NOT NULL,
                    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
                );

                CREATE TABLE IF NOT EXISTS attempts (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    question_id TEXT NOT NULL,
                    concept_id TEXT NOT NULL,
                    user_answer TEXT NOT NULL,
                    is_correct INTEGER NOT NULL,
                    score REAL NOT NULL,
                    feedback TEXT NOT NULL,
                    created_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS review_plan (
                    concept_id TEXT PRIMARY KEY,
                    concept_name TEXT NOT NULL,
                    priority REAL NOT NULL,
                    next_review_at TEXT NOT NULL,
                    suggested_slot TEXT NOT NULL,
                    reason TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS class_node_stats (
                    course_id TEXT NOT NULL,
                    concept_id TEXT NOT NULL,
                    error_rate REAL NOT NULL DEFAULT 0.0,
                    avg_attempts REAL NOT NULL DEFAULT 0.0,
                    stuck_count INTEGER NOT NULL DEFAULT 0,
                    sample_count INTEGER NOT NULL DEFAULT 0,
                    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    PRIMARY KEY (course_id, concept_id)
                );

                CREATE INDEX IF NOT EXISTS idx_attempts_concept_id ON attempts(concept_id);
                CREATE INDEX IF NOT EXISTS idx_attempts_created_at ON attempts(created_at);
                CREATE INDEX IF NOT EXISTS idx_questions_concept_id ON questions(concept_id);
                CREATE INDEX IF NOT EXISTS idx_concept_edges_source ON concept_edges(source_id);
                CREATE INDEX IF NOT EXISTS idx_concept_edges_target ON concept_edges(target_id);
                CREATE INDEX IF NOT EXISTS idx_concepts_course_id ON concepts(course_id);
                CREATE INDEX IF NOT EXISTS idx_cross_course_from ON cross_course_edges(from_concept_id);
                CREATE INDEX IF NOT EXISTS idx_cross_course_to ON cross_course_edges(to_concept_id);
                """
            )
            # Migration: add course_id column if missing (existing DBs)
            columns = {row[1] for row in conn.execute("PRAGMA table_info(concepts)").fetchall()}
            if "course_id" not in columns:
                conn.execute("ALTER TABLE concepts ADD COLUMN course_id TEXT REFERENCES courses(id)")

    def reset_learning_state(self, include_attempts: bool = True) -> None:
        with self._connect() as conn:
            conn.execute("DELETE FROM concept_edges")
            conn.execute("DELETE FROM concepts")
            conn.execute("DELETE FROM questions")
            conn.execute("DELETE FROM review_plan")
            if include_attempts:
                conn.execute("DELETE FROM attempts")

    def upsert_concepts(self, concepts: list[Concept]) -> None:
        if not concepts:
            return

        with self._connect() as conn:
            conn.executemany(
                """
                INSERT INTO concepts (id, name, chapter, description, prerequisites_json)
                VALUES (?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                    name = excluded.name,
                    chapter = excluded.chapter,
                    description = excluded.description,
                    prerequisites_json = excluded.prerequisites_json
                """,
                [
                    (
                        concept.id,
                        concept.name,
                        concept.chapter,
                        concept.description,
                        json.dumps(concept.prerequisites, ensure_ascii=False),
                    )
                    for concept in concepts
                ],
            )

    def list_concepts(self) -> list[Concept]:
        with self._connect() as conn:
            rows = conn.execute(
                """
                SELECT id, name, chapter, description, prerequisites_json
                FROM concepts
                ORDER BY chapter, name
                """
            ).fetchall()

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
        with self._connect() as conn:
            conn.execute("DELETE FROM concept_edges")
            if not edges:
                return
            conn.executemany(
                """
                INSERT OR REPLACE INTO concept_edges (source_id, target_id, relation)
                VALUES (?, ?, ?)
                """,
                [(edge.source_id, edge.target_id, edge.relation) for edge in edges],
            )

    def list_edges(self) -> list[ConceptEdge]:
        with self._connect() as conn:
            rows = conn.execute(
                """
                SELECT source_id, target_id, relation
                FROM concept_edges
                ORDER BY source_id, target_id
                """
            ).fetchall()
        return [ConceptEdge(source_id=row["source_id"], target_id=row["target_id"], relation=row["relation"]) for row in rows]

    def save_questions(self, questions: list[Question]) -> None:
        if not questions:
            return

        with self._connect() as conn:
            conn.executemany(
                """
                INSERT OR REPLACE INTO questions
                (id, concept_id, concept_name, difficulty, question_text, answer_text, rationale)
                VALUES (?, ?, ?, ?, ?, ?, ?)
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
                    )
                    for question in questions
                ],
            )

    def list_questions(self, limit: int = 50) -> list[Question]:
        with self._connect() as conn:
            rows = conn.execute(
                """
                SELECT id, concept_id, concept_name, difficulty, question_text, answer_text, rationale
                FROM questions
                ORDER BY created_at DESC
                LIMIT ?
                """,
                (limit,),
            ).fetchall()
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
        with self._connect() as conn:
            row = conn.execute(
                """
                SELECT id, concept_id, concept_name, difficulty, question_text, answer_text, rationale
                FROM questions
                WHERE id = ?
                """,
                (question_id,),
            ).fetchone()

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
        with self._connect() as conn:
            conn.execute(
                """
                INSERT INTO attempts
                (question_id, concept_id, user_answer, is_correct, score, feedback, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
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
        with self._connect() as conn:
            rows = conn.execute(
                """
                SELECT question_id, concept_id, user_answer, is_correct, score, feedback, created_at
                FROM attempts
                ORDER BY created_at DESC
                LIMIT ?
                """,
                (limit,),
            ).fetchall()

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
        with self._connect() as conn:
            conn.execute("DELETE FROM review_plan")
            if not review_items:
                return

            conn.executemany(
                """
                INSERT INTO review_plan
                (concept_id, concept_name, priority, next_review_at, suggested_slot, reason)
                VALUES (?, ?, ?, ?, ?, ?)
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
        with self._connect() as conn:
            rows = conn.execute(
                """
                SELECT concept_id, concept_name, priority, next_review_at, suggested_slot, reason
                FROM review_plan
                ORDER BY priority DESC
                LIMIT ?
                """,
                (limit,),
            ).fetchall()

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
        with self._connect() as conn:
            concept_count = conn.execute("SELECT COUNT(*) FROM concepts").fetchone()[0]
            attempt_count = conn.execute("SELECT COUNT(*) FROM attempts").fetchone()[0]
            avg_score = conn.execute("SELECT AVG(score) FROM attempts").fetchone()[0]

        return {
            "concept_count": float(concept_count),
            "attempt_count": float(attempt_count),
            "avg_score": float(avg_score) if avg_score is not None else 0.0,
        }

    # ── Course management ──────────────────────────────────────────

    def save_course(self, course: Course) -> None:
        with self._connect() as conn:
            conn.execute(
                """
                INSERT OR REPLACE INTO courses (id, user_id, subject, filename, uploaded_at)
                VALUES (?, ?, ?, ?, ?)
                """,
                (course.id, course.user_id, course.subject, course.filename, course.uploaded_at.isoformat(timespec="seconds")),
            )

    def list_courses(self, user_id: str = "default") -> list[Course]:
        with self._connect() as conn:
            rows = conn.execute(
                "SELECT id, user_id, subject, filename, uploaded_at FROM courses WHERE user_id = ? ORDER BY uploaded_at DESC",
                (user_id,),
            ).fetchall()
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
        with self._connect() as conn:
            row = conn.execute(
                "SELECT id, user_id, subject, filename, uploaded_at FROM courses WHERE id = ?",
                (course_id,),
            ).fetchone()
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
        with self._connect() as conn:
            conn.executemany(
                """
                INSERT OR REPLACE INTO cross_course_edges (from_concept_id, to_concept_id, similarity, link_type)
                VALUES (?, ?, ?, ?)
                """,
                [(e.from_concept_id, e.to_concept_id, e.similarity, e.link_type) for e in edges],
            )

    def list_cross_course_edges(self) -> list[CrossCourseEdge]:
        with self._connect() as conn:
            rows = conn.execute(
                "SELECT from_concept_id, to_concept_id, similarity, link_type FROM cross_course_edges ORDER BY similarity DESC"
            ).fetchall()
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
        with self._connect() as conn:
            rows = conn.execute(
                """
                SELECT c.id AS concept_id,
                       COUNT(a.id) AS total,
                       SUM(CASE WHEN a.is_correct = 0 THEN 1 ELSE 0 END) AS wrong,
                       AVG(CASE WHEN a.id IS NOT NULL THEN 1 ELSE 0 END) AS avg_att
                FROM concepts c
                LEFT JOIN attempts a ON a.concept_id = c.id
                WHERE c.course_id = ?
                GROUP BY c.id
                """,
                (course_id,),
            ).fetchall()

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
            conn_inner = self._conn
            try:
                conn_inner.executemany(
                    """
                    INSERT OR REPLACE INTO class_node_stats
                    (course_id, concept_id, error_rate, avg_attempts, stuck_count, sample_count, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                    """,
                    [
                        (s.course_id, s.concept_id, s.error_rate, s.avg_attempts,
                         s.stuck_count, s.sample_count, s.updated_at.isoformat(timespec="seconds"))
                        for s in stats
                    ],
                )
                conn_inner.commit()
            except Exception:
                conn_inner.rollback()
                raise

        return stats

    def list_class_node_stats(self, course_id: str) -> list[ClassNodeStats]:
        with self._connect() as conn:
            rows = conn.execute(
                """
                SELECT course_id, concept_id, error_rate, avg_attempts, stuck_count, sample_count, updated_at
                FROM class_node_stats
                WHERE course_id = ?
                ORDER BY error_rate DESC
                """,
                (course_id,),
            ).fetchall()
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
