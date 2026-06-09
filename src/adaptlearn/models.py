from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime


@dataclass(slots=True)
class Course:
    id: str
    user_id: str = "default"
    subject: str = ""
    filename: str = ""
    uploaded_at: datetime = field(default_factory=datetime.now)


@dataclass(slots=True)
class Concept:
    id: str
    name: str
    chapter: str
    description: str
    prerequisites: list[str] = field(default_factory=list)
    course_id: str = ""


@dataclass(slots=True)
class ConceptEdge:
    source_id: str
    target_id: str
    relation: str = "related"


@dataclass(slots=True)
class CrossCourseEdge:
    from_concept_id: str
    to_concept_id: str
    similarity: float = 0.0
    link_type: str = "semantic"


@dataclass(slots=True)
class Question:
    id: str
    concept_id: str
    concept_name: str
    difficulty: str
    question_text: str
    answer_text: str
    rationale: str


@dataclass(slots=True)
class Attempt:
    question_id: str
    concept_id: str
    user_answer: str
    is_correct: bool
    score: float
    feedback: str
    created_at: datetime


@dataclass(slots=True)
class ReviewItem:
    concept_id: str
    concept_name: str
    priority: float
    next_review_at: datetime
    suggested_slot: str
    reason: str
    retention: float = 0.0
    stability: float = 0.0


@dataclass(slots=True)
class ConceptDetail:
    concept_id: str
    language: str  # "zh" | "en"
    definition: str = ""
    key_points: list[str] = field(default_factory=list)
    example: str = ""
    common_mistakes: str = ""
    has_formula: bool = False


@dataclass(slots=True)
class ClassNodeStats:
    course_id: str
    concept_id: str
    error_rate: float = 0.0
    avg_attempts: float = 0.0
    stuck_count: int = 0
    sample_count: int = 0
    updated_at: datetime = field(default_factory=datetime.now)
