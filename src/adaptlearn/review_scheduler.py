from __future__ import annotations

from collections import defaultdict
from datetime import datetime, timedelta

from .models import Attempt, Concept, ReviewItem


def build_review_plan(
    concepts: list[Concept],
    attempts: list[Attempt],
    now: datetime | None = None,
) -> list[ReviewItem]:
    if now is None:
        now = datetime.now()

    attempts_by_concept: dict[str, list[Attempt]] = defaultdict(list)
    for attempt in attempts:
        attempts_by_concept[attempt.concept_id].append(attempt)

    review_items: list[ReviewItem] = []
    for concept in concepts:
        history = sorted(attempts_by_concept.get(concept.id, []), key=lambda item: item.created_at)
        priority, interval_hours, reason = _score_concept(history, now)
        review_items.append(
            ReviewItem(
                concept_id=concept.id,
                concept_name=concept.name,
                priority=priority,
                next_review_at=now + timedelta(hours=interval_hours),
                suggested_slot=_suggest_slot(priority),
                reason=reason,
            )
        )

    review_items.sort(key=lambda item: item.priority, reverse=True)
    return review_items


def _score_concept(history: list[Attempt], now: datetime) -> tuple[float, int, str]:
    if not history:
        return 0.85, 6, "No attempt history yet, run diagnostics early."

    accuracy = sum(1.0 for item in history if item.is_correct) / len(history)
    mean_score = sum(item.score for item in history) / len(history)

    last_attempt = history[-1]
    days_since_last = max((now - last_attempt.created_at).total_seconds() / 86400.0, 0.0)
    forgetting_factor = min(days_since_last / 5.0, 1.0)

    wrong_streak = 0
    for item in reversed(history):
        if item.is_correct:
            break
        wrong_streak += 1
    streak_penalty = min(wrong_streak / 3.0, 1.0)

    weakness = 1.0 - mean_score
    error_rate = 1.0 - accuracy

    priority = min(
        1.0,
        (0.5 * weakness) + (0.25 * error_rate) + (0.2 * forgetting_factor) + (0.15 * streak_penalty),
    )

    if priority >= 0.8:
        interval_hours = 6
    elif priority >= 0.65:
        interval_hours = 12
    elif priority >= 0.5:
        interval_hours = 24
    elif priority >= 0.35:
        interval_hours = 48
    else:
        interval_hours = 96

    reason = (
        f"avg_score={mean_score:.2f}, accuracy={accuracy:.2f}, "
        f"days_since_last={days_since_last:.1f}, wrong_streak={wrong_streak}"
    )
    return priority, interval_hours, reason


def _suggest_slot(priority: float) -> str:
    if priority >= 0.75:
        return "19:30-21:00 (deep focus)"
    if priority >= 0.55:
        return "18:30-19:30 (moderate load)"
    if priority >= 0.35:
        return "21:00-21:30 (light review)"
    return "Weekend 10:00-10:30 (maintenance)"
