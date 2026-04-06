from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime


@dataclass(slots=True)
class Concept:
    id: str
    name: str
    chapter: str
    description: str
    prerequisites: list[str] = field(default_factory=list)


@dataclass(slots=True)
class ConceptEdge:
    source_id: str
    target_id: str
    relation: str = "related"


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
