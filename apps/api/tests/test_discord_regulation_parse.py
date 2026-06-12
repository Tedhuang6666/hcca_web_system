from api.services.discord_regulation import (
    _cn_to_int,
    _is_subsequence,
    _strip_leading_particle,
    parse_citations,
)


def test_cn_to_int_basic():
    assert _cn_to_int("三") == 3
    assert _cn_to_int("十") == 10
    assert _cn_to_int("二十一") == 21
    assert _cn_to_int("一百零三") == 103
    assert _cn_to_int("5") == 5
    assert _cn_to_int("公") is None


def test_parse_citations_and_deduplicate():
    citations = parse_citations(
        "依公民投票法第十條之一第二項第三款，又見公民投票法第十條之一第二項第三款"
    )
    assert len(citations) == 1
    assert citations[0].law == "公民投票法"
    assert citations[0].legal_number == "10-1"
    assert citations[0].paragraph == "2"
    assert citations[0].subparagraph == "3"


def test_particle_and_subsequence_helpers():
    assert _strip_leading_particle("違反組織章程") == "組織章程"
    assert _is_subsequence(
        "選罷委條例",
        "國立新竹高級中學班級聯合自治會選舉及罷免事務委員會組織自治條例",
    )
