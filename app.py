from __future__ import annotations

import sys
from pathlib import Path

import altair as alt
import pandas as pd
import streamlit as st

PROJECT_ROOT = Path(__file__).resolve().parent
SRC_ROOT = PROJECT_ROOT / "src"
if str(SRC_ROOT) not in sys.path:
    sys.path.insert(0, str(SRC_ROOT))

from adaptlearn.config import Settings
from adaptlearn.pipeline import AdaptLearnService


def init_session() -> None:
    defaults = {
        "api_key": "",
        "course_name": "General Course",
        "template_mode": "generic",
        "question_ids": [],
        "question_index": 0,
        "feedback_by_question": {},
    }
    for key, value in defaults.items():
        if key not in st.session_state:
            st.session_state[key] = value

    if "service" not in st.session_state:
        st.session_state["service"] = AdaptLearnService(Settings(), api_key=st.session_state["api_key"])


def reset_service() -> None:
    st.session_state["service"] = AdaptLearnService(Settings(), api_key=st.session_state["api_key"])


def main() -> None:
    st.set_page_config(page_title="AdaptLearn MVP", layout="wide")
    init_session()

    service: AdaptLearnService = st.session_state["service"]

    st.title("AdaptLearn AI Diagnostic System (MVP)")
    st.caption("From material parsing to adaptive diagnosis and review scheduling.")

    with st.sidebar:
        st.subheader("Configuration")

        entered_key = st.text_input(
            "Gemini API key",
            value=st.session_state["api_key"],
            type="password",
            help="Optional. If empty, local fallback logic is used.",
        )

        if st.button("Apply API key", use_container_width=True):
            st.session_state["api_key"] = entered_key.strip()
            reset_service()
            st.success("API key updated.")

        st.session_state["course_name"] = st.text_input(
            "Course name",
            value=st.session_state["course_name"],
            help="Used as context for concept extraction and diagnostics.",
        )

        st.session_state["template_mode"] = st.selectbox(
            "Template mode",
            options=["generic", "linear-algebra", "auto"],
            index=["generic", "linear-algebra", "auto"].index(st.session_state.get("template_mode", "generic")),
            help="generic = fully material-driven. linear-algebra = explicit template fallback.",
        )

        metrics = service.get_metrics()
        st.subheader("Progress")
        st.metric("Concepts", int(metrics["concept_count"]))
        st.metric("Attempts", int(metrics["attempt_count"]))
        st.metric("Accuracy", f"{metrics['accuracy'] * 100:.1f}%")
        st.caption(f"LLM enabled: {'Yes' if service.llm_enabled else 'No'}")

    tab_material, tab_quiz, tab_review = st.tabs(
        ["1) Material & Graph", "2) Adaptive Quiz", "3) Review Plan"]
    )

    with tab_material:
        st.subheader("Upload Material")
        uploaded = st.file_uploader("Upload lecture material", type=["pdf", "txt"])

        if st.button("Build concept graph", disabled=uploaded is None):
            if uploaded is None:
                st.warning("Upload a PDF or TXT file first.")
            else:
                with st.spinner("Parsing material and building graph..."):
                    try:
                        result = service.ingest_material(
                            file_name=uploaded.name,
                            file_bytes=uploaded.getvalue(),
                            course_name=st.session_state["course_name"],
                            template_mode=st.session_state["template_mode"],
                        )
                    except Exception as exc:
                        st.error(str(exc))
                    else:
                        st.success(
                            "Graph built successfully. "
                            f"Concepts: {result['concept_count']} | Edges: {result['edge_count']}"
                        )
                        if result.get("ingest_mode") == "text-extraction":
                            st.caption("Ingestion mode: text extraction from uploaded material.")
                        if result.get("ingest_mode") == "template-fallback":
                            st.info(
                                "Detected very little selectable text in the file. "
                                "Using explicit template fallback mode."
                            )
                        if bool(result.get("used_seed_template")) and result.get("ingest_mode") == "text-extraction":
                            st.caption("Course template merged to enrich concept coverage.")

        concepts = service.list_concepts()
        if concepts:
            concept_df = pd.DataFrame(
                [
                    {
                        "id": concept.id,
                        "name": concept.name,
                        "chapter": concept.chapter,
                        "description": concept.description,
                        "prerequisites": ", ".join(concept.prerequisites),
                    }
                    for concept in concepts
                ]
            )
            st.dataframe(concept_df, use_container_width=True, hide_index=True)

            st.subheader("Concept Graph")
            st.graphviz_chart(service.get_graphviz(), use_container_width=True)

            concept_mastery = service.get_concept_mastery()
            if concept_mastery:
                st.subheader("Mastery Heatmap (Red-Yellow-Green)")
                mastery_df = pd.DataFrame(concept_mastery)
                heatmap = (
                    alt.Chart(mastery_df)
                    .mark_rect()
                    .encode(
                        x=alt.X("chapter:N", title="Chapter"),
                        y=alt.Y("name:N", title="Concept"),
                        color=alt.Color(
                            "mastery:Q",
                            title="Mastery",
                            scale=alt.Scale(
                                domain=[0.0, 0.5, 1.0],
                                range=["#d73027", "#fee08b", "#1a9850"],
                            ),
                        ),
                        tooltip=[
                            alt.Tooltip("chapter:N", title="Chapter"),
                            alt.Tooltip("name:N", title="Concept"),
                            alt.Tooltip("mastery:Q", title="Mastery", format=".2f"),
                            alt.Tooltip("attempts:Q", title="Attempts"),
                            alt.Tooltip("status:N", title="Status"),
                        ],
                    )
                    .properties(height=min(680, max(220, 24 * len(mastery_df))))
                )
                st.altair_chart(heatmap, use_container_width=True)

                chapter_mastery = service.get_chapter_mastery()
                if chapter_mastery:
                    st.subheader("Chapter Mastery Summary")
                    st.dataframe(
                        pd.DataFrame(chapter_mastery),
                        use_container_width=True,
                        hide_index=True,
                    )

            st.subheader("Concept Retrieval (Chroma)")
            query = st.text_input("Search related concepts")
            if st.button("Retrieve related", disabled=not query.strip()):
                related = service.search_related_concepts(query=query, n_results=5)
                if related:
                    st.dataframe(pd.DataFrame(related), use_container_width=True, hide_index=True)
                else:
                    st.info("No related concept found or vector store is unavailable.")
        else:
            st.info("No concepts yet. Upload material and click 'Build concept graph'.")

    with tab_quiz:
        st.subheader("Adaptive Diagnostic Questions")

        if st.button("Generate adaptive set", use_container_width=False):
            questions = service.generate_diagnostics(question_count=9)
            st.session_state["question_ids"] = [question.id for question in questions]
            st.session_state["question_index"] = 0
            st.session_state["feedback_by_question"] = {}

            if questions:
                st.success(f"Generated {len(questions)} questions.")
            else:
                st.warning("No questions generated. Build graph first.")

        question_ids: list[str] = st.session_state["question_ids"]
        if question_ids:
            index = st.session_state["question_index"]
            index = max(0, min(index, len(question_ids) - 1))
            st.session_state["question_index"] = index

            question = service.get_question(question_ids[index])
            if question:
                st.markdown(f"### Question {index + 1}/{len(question_ids)}")
                st.caption(f"Concept: {question.concept_name} | Difficulty: {question.difficulty}")
                st.write(question.question_text)

                answer_key = f"answer_{question.id}"
                answer = st.text_area("Your answer", key=answer_key, height=140)

                col_prev, col_submit, col_next = st.columns(3)
                with col_prev:
                    if st.button("Previous", disabled=index == 0, key=f"prev_{question.id}"):
                        st.session_state["question_index"] -= 1
                        st.rerun()

                with col_submit:
                    if st.button("Submit answer", key=f"submit_{question.id}"):
                        if not answer.strip():
                            st.warning("Type your answer before submitting.")
                        else:
                            result = service.grade_question(question.id, answer.strip())
                            st.session_state["feedback_by_question"][question.id] = result
                            st.rerun()

                with col_next:
                    if st.button("Next", disabled=index >= len(question_ids) - 1, key=f"next_{question.id}"):
                        st.session_state["question_index"] += 1
                        st.rerun()

                feedback = st.session_state["feedback_by_question"].get(question.id)
                if feedback:
                    if feedback["is_correct"]:
                        st.success(f"Score: {feedback['score']:.2f}")
                    else:
                        st.error(f"Score: {feedback['score']:.2f}")
                    st.write(feedback["feedback"])
                    with st.expander("Reference answer"):
                        st.write(feedback["expected_answer"])
                        st.caption(feedback["rationale"])
            else:
                st.warning("Question data missing. Regenerate diagnostics.")
        else:
            st.info("Generate an adaptive set to start answering.")

    with tab_review:
        st.subheader("Review Scheduler")
        if st.button("Recalculate review plan"):
            plan = service.build_and_save_review_plan()
            st.success(f"Generated plan for {len(plan)} concepts.")

        review_items = service.list_review_plan()
        if review_items:
            plan_df = pd.DataFrame(
                [
                    {
                        "concept": item.concept_name,
                        "priority": round(item.priority, 3),
                        "next_review_at": item.next_review_at.strftime("%Y-%m-%d %H:%M"),
                        "suggested_slot": item.suggested_slot,
                        "reason": item.reason,
                    }
                    for item in review_items
                ]
            )
            st.dataframe(plan_df, use_container_width=True, hide_index=True)

            st.subheader("Tonight Focus List")
            for idx, item in enumerate(review_items[:5], start=1):
                st.write(f"{idx}. {item.concept_name} | priority={item.priority:.2f} | {item.suggested_slot}")
                st.caption(item.reason)
        else:
            st.info("No review plan yet. Run diagnostics first, then recalculate plan.")

        st.subheader("Tonight Exam Boost Dashboard")
        dashboard = service.get_tonight_study_dashboard(top_n=5)

        col_before, col_uplift, col_after = st.columns(3)
        with col_before:
            st.metric("Current pass probability", f"{dashboard['before'] * 100:.1f}%")
        with col_uplift:
            st.metric("Estimated uplift tonight", f"+{dashboard['uplift'] * 100:.1f}%")
        with col_after:
            st.metric("Projected pass probability", f"{dashboard['after'] * 100:.1f}%")

        chapters = dashboard.get("chapters", [])
        if chapters:
            st.caption("Recommended chapters tonight: " + ", ".join(chapters))

        focus_items = dashboard.get("focus_items", [])
        if focus_items:
            st.dataframe(pd.DataFrame(focus_items), use_container_width=True, hide_index=True)
        else:
            st.info("No focus items yet. Build graph and generate attempts first.")


if __name__ == "__main__":
    main()
