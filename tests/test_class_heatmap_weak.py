"""弱點清單要帶概念名稱，前端才不會印出 c-xxxx 這種 ID。"""
from adaptlearn.class_heatmap import get_weak_concepts
from adaptlearn.models import ClassNodeStats, Concept


class _FakeRepo:
    def list_class_node_stats(self, course_id):
        return [
            ClassNodeStats(course_id=course_id, concept_id="c-a", error_rate=1.0, sample_count=1),
            ClassNodeStats(course_id=course_id, concept_id="c-b", error_rate=0.2, sample_count=3),
        ]

    def list_concepts(self, course_id=None):
        return [Concept(id="c-a", name="乘法規則", chapter="1", description="", prerequisites=[])]


def test_weak_concepts_carry_names():
    items = get_weak_concepts("course-1", _FakeRepo())
    assert [i["concept_id"] for i in items] == ["c-a"]
    assert items[0]["concept_name"] == "乘法規則"
