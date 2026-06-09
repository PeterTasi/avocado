from __future__ import annotations

from collections import Counter
from uuid import uuid4

from .models import Concept, Question

DIFFICULTIES = ("basic", "intermediate", "advanced")


def build_questions_for_concepts(
    concepts: list[Concept],
    gemini_client,
    per_concept: int = 3,
    language: str = "zh",
) -> list[Question]:
    if not concepts:
        return []

    per_concept = max(1, min(per_concept, 3))
    llm_input = [
        {
            "name": concept.name,
            "chapter": concept.chapter,
            "description": concept.description,
        }
        for concept in concepts
    ]

    generated = gemini_client.generate_questions(concepts=llm_input, per_concept=per_concept, language=language)
    questions = _map_llm_questions(generated, concepts)

    counts = Counter(question.concept_id for question in questions)
    for concept in concepts:
        for difficulty in DIFFICULTIES[:per_concept]:
            if counts[concept.id] >= per_concept:
                break

            if any(
                question.concept_id == concept.id and question.difficulty == difficulty
                for question in questions
            ):
                continue

            questions.append(_template_question(concept, difficulty))
            counts[concept.id] += 1

    return questions


def _map_llm_questions(generated: list[dict], concepts: list[Concept]) -> list[Question]:
    if not generated:
        return []

    concept_map = {concept.name.lower(): concept for concept in concepts}
    questions: list[Question] = []

    for item in generated:
        concept_name = str(item.get("concept", "")).strip()
        question_text = str(item.get("question", "")).strip()
        answer_text = str(item.get("answer", "")).strip()
        rationale = str(item.get("rationale", "")).strip()
        difficulty = str(item.get("difficulty", "basic")).strip().lower() or "basic"

        if difficulty not in DIFFICULTIES:
            difficulty = "basic"

        if not concept_name or not question_text or not answer_text:
            continue

        concept = concept_map.get(concept_name.lower())
        if not concept:
            concept = _fuzzy_find_concept(concept_name, concepts)
        if not concept:
            continue

        questions.append(
            Question(
                id=str(uuid4()),
                concept_id=concept.id,
                concept_name=concept.name,
                difficulty=difficulty,
                question_text=question_text,
                answer_text=answer_text,
                rationale=rationale or "Explain from first principles and justify each step.",
            )
        )

    return questions


def _template_question(concept: Concept, difficulty: str) -> Question:
    if difficulty == "basic":
        question_text = f"Define '{concept.name}' and explain why it matters in {concept.chapter}."
        answer_text = f"A correct answer states the definition of {concept.name} and one practical implication in {concept.chapter}."
        rationale = "Start from the formal definition, then connect it to one concrete use case."
    elif difficulty == "intermediate":
        question_text = f"Given a typical problem in {concept.chapter}, explain how you would apply '{concept.name}' step by step."
        answer_text = f"A correct answer presents a valid procedure using {concept.name} with assumptions and intermediate steps."
        rationale = "Focus on method selection, not only final result."
    else:
        question_text = f"Provide a counterexample or edge case where misunderstanding '{concept.name}' leads to an incorrect conclusion."
        answer_text = "A correct answer shows a valid edge case, explains the mistake, and provides the corrected reasoning."
        rationale = "Demonstrate conceptual boundaries and failure modes."

    return Question(
        id=str(uuid4()),
        concept_id=concept.id,
        concept_name=concept.name,
        difficulty=difficulty,
        question_text=question_text,
        answer_text=answer_text,
        rationale=rationale,
    )


def _fuzzy_find_concept(target_name: str, concepts: list[Concept]) -> Concept | None:
    lowered_target = target_name.lower()
    for concept in concepts:
        lowered_name = concept.name.lower()
        if lowered_target in lowered_name or lowered_name in lowered_target:
            return concept
    return None
