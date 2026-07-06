"""先修關係「向後引用」回歸測試（docs/fable5-review.md #2）。

LLM 輸出順序不保證拓撲序：概念 A 的 prerequisites 可能指向列表中
排在 A 後面的概念 B。單遍過濾會把這種先修默默丟掉。
"""

from adaptlearn.knowledge_graph import _build_edges, _records_to_concepts


def _records():
    return [
        {
            "name": "Eigenvalues Decomposition",
            "chapter": "Chapter 3",
            "description": "Spectral structure of matrices.",
            # 指向列表中「後面」才出現的概念 → 修復前會被濾掉
            "prerequisites": ["Determinant Expansion"],
        },
        {
            "name": "Determinant Expansion",
            "chapter": "Chapter 2",
            "description": "Cofactor expansion of determinants.",
            "prerequisites": [],
        },
    ]


def test_prerequisite_may_reference_later_concept():
    concepts = _records_to_concepts(_records(), max_concepts=10, course_id="t1")
    eig = next(c for c in concepts if c.name == "Eigenvalues Decomposition")
    assert "Determinant Expansion" in eig.prerequisites


def test_forward_reference_produces_edge():
    concepts = _records_to_concepts(_records(), max_concepts=10, course_id="t1")
    eig = next(c for c in concepts if c.name == "Eigenvalues Decomposition")
    det = next(c for c in concepts if c.name == "Determinant Expansion")
    edges = _build_edges(concepts)
    assert any(
        e.source_id == det.id and e.target_id == eig.id and e.relation == "prerequisite"
        for e in edges
    )
