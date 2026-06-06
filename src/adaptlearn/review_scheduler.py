from __future__ import annotations

from collections import defaultdict
from datetime import datetime, timedelta, timezone

from fsrs import Card, Rating, Scheduler, State

from .models import Attempt, Concept, ReviewItem

# One shared scheduler instance using default FSRS-5 parameters.
_SCHEDULER = Scheduler()


# ── Public API ────────────────────────────────────────────────────────────────

def build_review_plan(
    concepts: list[Concept],
    attempts: list[Attempt],
    now: datetime | None = None,
) -> list[ReviewItem]:
    if now is None:
        now = datetime.now()
    now_utc = _to_utc(now)

    attempts_by_concept: dict[str, list[Attempt]] = defaultdict(list)
    for attempt in attempts:
        attempts_by_concept[attempt.concept_id].append(attempt)

    review_items: list[ReviewItem] = []
    for concept in concepts:
        history = sorted(
            attempts_by_concept.get(concept.id, []),
            key=lambda a: a.created_at,
        )
        card, retrievability, reason = _build_fsrs_card(history, now_utc)

        # priority = how urgently the concept needs review (0 = fresh, 1 = forgotten)
        priority = round(min(1.0, 1.0 - retrievability), 4)
        # strip timezone so ReviewItem remains naive (compatible with existing DB layer)
        next_review_at = card.due.replace(tzinfo=None)

        review_items.append(
            ReviewItem(
                concept_id=concept.id,
                concept_name=concept.name,
                priority=priority,
                next_review_at=next_review_at,
                suggested_slot=_suggest_slot(priority),
                reason=reason,
                retention=round(retrievability, 4),
                stability=round(float(card.stability or 0.0), 4),
            )
        )

    review_items.sort(key=lambda item: item.priority, reverse=True)
    return review_items


# ── FSRS core ─────────────────────────────────────────────────────────────────

def _build_fsrs_card(
    history: list[Attempt],
    now_utc: datetime,
) -> tuple[Card, float, str]:
    """
    Replay the attempt history through FSRS to reconstruct the current card
    state.  Returns (card, retrievability, human-readable reason string).
    """
    card = Card()

    if not history:
        # Unseen concept — schedule first review in 6 hours and treat as
        # high-priority (retrievability 0 means it hasn't been consolidated).
        card.due = now_utc + timedelta(hours=6)
        return card, 0.0, "尚無作答紀錄，建議盡早初次測驗"

    for attempt in history:
        rating = _score_to_rating(attempt.score, attempt.is_correct)
        review_dt = _to_utc(attempt.created_at)
        card, _ = _SCHEDULER.review_card(card, rating, review_datetime=review_dt)

    retrievability = _SCHEDULER.get_card_retrievability(card, current_datetime=now_utc)
    days_since = max(
        (now_utc - _to_utc(history[-1].created_at)).total_seconds() / 86400, 0.0
    )
    state_name = State(card.state).name
    reason = (
        f"FSRS state={state_name}, "
        f"stability={card.stability:.2f}, "
        f"difficulty={card.difficulty:.2f}, "
        f"retrievability={retrievability:.1%}, "
        f"days_since_last={days_since:.1f}"
    )
    return card, retrievability, reason


# ── Helpers ───────────────────────────────────────────────────────────────────

def _score_to_rating(score: float, is_correct: bool) -> Rating:
    """Map a 0–1 score to an FSRS Rating (Again / Hard / Good / Easy)."""
    if not is_correct or score < 0.45:
        return Rating.Again
    if score < 0.65:
        return Rating.Hard
    if score < 0.85:
        return Rating.Good
    return Rating.Easy


def _to_utc(dt: datetime) -> datetime:
    """Return a UTC-aware datetime; naive datetimes are assumed to be UTC."""
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def _suggest_slot(priority: float) -> str:
    if priority >= 0.75:
        return "19:30-21:00 (deep focus)"
    if priority >= 0.55:
        return "18:30-19:30 (moderate load)"
    if priority >= 0.35:
        return "21:00-21:30 (light review)"
    return "Weekend 10:00-10:30 (maintenance)"
