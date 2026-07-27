from __future__ import annotations

import hashlib
from dataclasses import dataclass
from functools import lru_cache

import spacy

from .cipher import apply_mapping
from .seeds import derive_seed
from .text import word_tokens

ENTITY_LABELS = {"PERSON", "GPE", "LOC", "ORG", "FAC", "NORP"}
TITLE_WORDS = {"mr", "mrs", "ms", "miss", "dr", "sir", "lady", "lord", "captain", "professor"}
REPLACEMENTS = {
    "PERSON": [
        "Adrian",
        "Beatrice",
        "Cedric",
        "Daphne",
        "Edmund",
        "Flora",
        "Gideon",
        "Helena",
        "Isolde",
        "Julian",
        "Kendra",
        "Lionel",
        "Marina",
        "Nolan",
        "Opal",
        "Percival",
        "Quentin",
        "Rosalind",
        "Silas",
        "Theodora",
        "Ulysses",
        "Vera",
        "Walter",
        "Yvette",
    ],
    "PLACE": [
        "Alderwick",
        "Briarford",
        "Cedarvale",
        "Dunmere",
        "Eastmarsh",
        "Foxhaven",
        "Graymont",
        "Highstead",
        "Ironmere",
        "Juniper",
        "Kingswell",
        "Larkspur",
        "Morrowdale",
        "Northwick",
        "Oakminster",
        "Pinehurst",
    ],
    "OTHER": [
        "Argent",
        "Bellweather",
        "Crownfield",
        "Dovetail",
        "Evergreen",
        "Fairwater",
        "Goldcrest",
        "Hearthstone",
        "Ivory",
        "Keystone",
        "Longbridge",
        "Moonrise",
        "Nightjar",
        "Orchard",
        "Redwood",
        "Starling",
    ],
}


@dataclass(frozen=True)
class EntityRegenerationResult:
    text: str
    mapping: dict[str, str]
    entities: tuple[dict[str, object], ...]


@lru_cache(maxsize=1)
def _nlp():
    return spacy.load(
        "en_core_web_sm",
        disable=["parser", "lemmatizer", "textcat"],
    )


def _replacement_pool(label: str) -> list[str]:
    if label == "PERSON":
        roots = REPLACEMENTS["PERSON"]
        suffixes = ["", "son", "sen", "ley", "ford", "well", "mont", "mere"]
    elif label in {"GPE", "LOC", "FAC", "NORP"}:
        roots = REPLACEMENTS["PLACE"]
        suffixes = ["", "shire", "stead", "haven", "wick", "bridge", "vale", "moor"]
    else:
        roots = REPLACEMENTS["OTHER"]
        suffixes = ["", "house", "guild", "circle", "company", "society", "press", "works"]
    derived = [f"{root}{suffix}".casefold() for suffix in suffixes for root in roots]
    derived.extend(
        f"{left}{right}".casefold() for left in roots for right in roots if left != right
    )
    return list(dict.fromkeys(derived))


def regenerate_entities(
    text: str,
    *,
    seed_hex: str,
    review_patch: dict[str, object] | None = None,
) -> EntityRegenerationResult:
    document = _nlp()(text)
    proposed: dict[str, str] = {}
    roles: list[dict[str, object]] = []
    for entity_index, entity in enumerate(document.ents):
        if entity.label_ not in ENTITY_LABELS:
            continue
        aliases: list[str] = []
        for token in entity:
            normalized = token.text.casefold()
            if not token.is_alpha or token.pos_ != "PROPN" or normalized in TITLE_WORDS:
                continue
            proposed.setdefault(normalized, entity.label_)
            aliases.append(normalized)
        if aliases:
            roles.append(
                {
                    "roleId": f"entity-{entity_index:05d}",
                    "entityClass": entity.label_,
                    "aliases": sorted(set(aliases)),
                }
            )
    patch = review_patch or {"add": {}, "drop": [], "join": []}
    additions = patch.get("add")
    drops = patch.get("drop")
    if not isinstance(additions, dict) or not isinstance(drops, list):
        raise ValueError("Entity review patch requires object add and array drop fields.")
    for source in drops:
        if not isinstance(source, str):
            raise ValueError("Entity review drop entries must be strings.")
        proposed.pop(source, None)
    for source, label in additions.items():
        if not isinstance(source, str) or not isinstance(label, str) or label not in ENTITY_LABELS:
            raise ValueError("Entity review additions require supported string type/label pairs.")
        proposed[source] = label
        if not any(source in role["aliases"] for role in roles):
            roles.append(
                {
                    "roleId": f"entity-review-{len(roles):05d}",
                    "entityClass": label,
                    "aliases": [source],
                }
            )
    mapping: dict[str, str] = {}
    used = set(proposed)
    for source, label in sorted(proposed.items()):
        pool = _replacement_pool(label)
        digest = hashlib.sha256(derive_seed(seed_hex, f"entity:{label}") + source.encode()).digest()
        start = int.from_bytes(digest[:8], "big") % len(pool)
        for offset in range(len(pool)):
            candidate = pool[(start + offset) % len(pool)].casefold()
            if candidate not in used:
                mapping[source] = candidate
                used.add(candidate)
                break
        else:
            raise ValueError(f"Entity replacement pool is exhausted for {label}.")
    possessive_mapping = {}
    for token in word_tokens(text):
        assert token.normalized is not None
        for suffix in ("'s", "\u2019s"):
            if token.normalized.endswith(suffix):
                base = token.normalized[: -len(suffix)]
                if base in mapping:
                    possessive_mapping[token.normalized] = f"{mapping[base]}{suffix}"
    mapping.update(possessive_mapping)
    regenerated_roles = []
    for role in roles:
        aliases = [alias for alias in role["aliases"] if alias in mapping]
        if not aliases:
            continue
        replacements = sorted({mapping[alias] for alias in aliases})
        regenerated_roles.append({**role, "aliases": aliases, "replacementAliases": replacements})
    identity = {
        token.normalized: token.normalized
        for token in word_tokens(text)
        if token.normalized is not None
    }
    regenerated = apply_mapping(text, {**identity, **mapping})
    return EntityRegenerationResult(
        text=regenerated,
        mapping=dict(sorted(mapping.items())),
        entities=tuple(regenerated_roles),
    )
