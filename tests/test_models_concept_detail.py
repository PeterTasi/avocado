from adaptlearn.models import ConceptDetail


def test_concept_detail_defaults():
    d = ConceptDetail(concept_id="c-1", language="zh")
    assert d.concept_id == "c-1"
    assert d.language == "zh"
    assert d.definition == ""
    assert d.key_points == []
    assert d.example == ""
    assert d.common_mistakes == ""
    assert d.has_formula is False


def test_concept_detail_full():
    d = ConceptDetail(
        concept_id="c-2",
        language="en",
        definition="A definition.",
        key_points=["p1", "p2"],
        example="An example.",
        common_mistakes="A pitfall.",
        has_formula=True,
    )
    assert d.key_points == ["p1", "p2"]
    assert d.has_formula is True
