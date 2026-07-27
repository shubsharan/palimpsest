from __future__ import annotations

from palimpsest.generation.entities import regenerate_entities


def test_repeated_entity_tokens_receive_one_collision_free_identity() -> None:
    text = "Alice met Bob. Alice thanked Bob in London."
    result = regenerate_entities(text, seed_hex="11" * 32)
    assert result.text != text
    assert result.mapping["alice"] == result.mapping["alice"]
    assert result.mapping["bob"] == result.mapping["bob"]
    assert len(set(result.mapping.values())) == len(result.mapping)
    assert not set(result.mapping).intersection(result.mapping.values())
