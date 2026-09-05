"""Step 14 — canonical rewrite and the two fingerprints.

The question this answers is not "are these two strings the same?" but two
sharper ones:

    identity_hash   is this the SAME DUTY?          audience + data-points + shape
    full_hash       has ANYTHING about it changed?  identity + the literals

Identity match + full differs  =  an amendment. That single comparison is what
Step 15 files on, and it only works if two phrasings of one duty canonicalise to
the same string. So the tree is rewritten before it is serialised:

    1. COMPARISONS face one way   180 >= x   →   x <= 180
    2. COMMUTATIVE OPERANDS sorted   y AND x   →   x AND y
    3. STRUCTURE REPLACES PUNCTUATION   parens and whitespace stop existing
    4. SERIALISE deterministically

⚠️ The audience enters by ID, never by shape. By shape,
`category=='stock_broker'` and `category=='mutual_fund'` both mask to
`[category]==STR`, which reintroduces silent cross-population merging at the
category level — exactly the disease the audience was added to cure.
"""

from __future__ import annotations

import hashlib
from typing import Any

from .ast_parse import Node, parse_expression

# Flipping a comparison so the data-point sits on the left.
_MIRROR = {"<": ">", ">": "<", "<=": ">=", ">=": "<=", "==": "==", "!=": "!="}
# Operators whose operands have no meaningful order.
_COMMUTATIVE_KINDS = {"and", "or"}
_COMMUTATIVE_ARITH = {"+", "*"}

MASK_NUM = "NUM"
MASK_STR = "STR"


def _has_ref(node: Node) -> bool:
    if node.kind == "ref":
        return True
    return any(_has_ref(child) for child in node.children)


def canonicalise(node: Node) -> Node:
    """Rewrite the tree into its one canonical shape. Pure; returns a new tree."""
    children = [canonicalise(c) for c in node.children]

    if node.kind == "cmp" and len(children) == 2:
        left, right = children
        # A comparison says the same thing read either way. Put the side holding
        # the data-point on the left and mirror the operator, so "180 >= x" and
        # "x <= 180" stop being two different duties.
        if not _has_ref(left) and _has_ref(right):
            return Node(kind="cmp", op=_MIRROR[node.op or "=="], children=[right, left])
        return Node(kind="cmp", op=node.op, children=children)

    if node.kind in _COMMUTATIVE_KINDS:
        # Sorted by their own serialisation, so the order is stable and does not
        # depend on how the sentence happened to be written.
        return Node(kind=node.kind, op=node.op,
                    children=sorted(children, key=lambda c: serialise(c, mask=False)))

    if node.kind == "arith" and node.op in _COMMUTATIVE_ARITH:
        return Node(kind="arith", op=node.op,
                    children=sorted(children, key=lambda c: serialise(c, mask=False)))

    if node.kind == "set":
        # {a, b} and {b, a} are one set.
        return Node(kind="set",
                    children=sorted(children, key=lambda c: serialise(c, mask=False)))

    return Node(kind=node.kind, op=node.op, value=node.value, children=children)


def serialise(node: Node, *, mask: bool, ids: dict[str, int] | None = None) -> str:
    """Deterministic prefix form. Punctuation carries no meaning here — the
    nesting does — so parentheses and whitespace never appear."""
    ids = ids or {}
    if node.kind == "num":
        return MASK_NUM if mask else f"n:{node.value}"
    if node.kind == "str":
        return MASK_STR if mask else f"s:{node.value}"
    if node.kind == "bool":
        # A boolean is part of the SHAPE of a test, not a tunable value:
        # flipping true to false is a different duty, not an amended threshold.
        return f"b:{str(node.value).lower()}"
    if node.kind == "ref":
        name = str(node.value)
        # Names become ids. The topic spelling, the AI's naming whim and any
        # later cosmetic rename are all irrelevant to identity (14b).
        return f"#{ids[name]}" if name in ids else f"?{name}"
    inner = ",".join(serialise(c, mask=mask, ids=ids) for c in node.children)
    op = node.op
    if mask and node.kind == "call" and op in _TIME_FUNCTION_ALIAS:
        # In the MASKED form only, the time functions collapse to one name.
        #
        # "audit every 6 months" and "audit every 180 days" are the same DUTY
        # asked in different units, and identity deliberately excludes literals —
        # so leaving `months_since` and `days_since` as different shapes would
        # file the second as a new obligation instead of an amendment of the
        # first. The unmasked form is untouched: what the circular said is what
        # is stored and displayed.
        op = _TIME_FUNCTION_ALIAS[op]
    head = f"{node.kind}:{op}" if op else node.kind
    return f"{head}({inner})"


# ─────────────────────────────────────────────────────────────────────────────
# The COMPARED representation — unit normalisation, and only here
#
# Units are constrained at extraction but never CONVERTED there: converting when
# the rule is written silently picks an interpretation ("half-yearly" is 183 days
# or six calendar months, two days apart on 31 January) and destroys the evidence
# that a choice was made. See fidelity.py for the full argument.
#
# Conversion belongs HERE, at canonicalisation, because this value is derived and
# disposable — recomputable with better rules at any time, from `hash_inputs`,
# without re-running the AI over anything.
#
#     STORED     "every 6 months"    the expression, untouched
#     COMPARED   180                 what the fingerprint sees
#     DISPLAYED  "half-yearly"       from the source
#
# Without it a circular writing "180 days" and one writing "six months" for the
# same duty produce different full hashes, and Step 15 files the second as a NEW
# obligation — one duty quietly becoming two.
#: Time functions that ask the same question in different units. Collapsed in
#: the masked shape so identity survives a change of unit; see serialise().
_TIME_FUNCTION_ALIAS = {
    "months_since": "days_since", "years_since": "days_since",
    "months_between": "days_between", "hours_between": "days_between",
}
_TIME_FUNCTION_UNIT = {
    "days_since": "days", "days_between": "days",
    "months_since": "months", "months_between": "months",
    "years_since": "years",
    "hours_between": "hours",
}
#: Comparison factors. A sort key, not a calendar — nothing schedules anything
#: from these. 30/360 is the convention that makes "six months" and "180 days"
#: agree, which is how SEBI writes one duty across two circulars.
_TO_DAYS = {"hours": 1 / 24, "days": 1, "months": 30, "years": 360}


def _unit_of_operand(node: Node) -> str | None:
    """The time unit an operand yields, if it yields one."""
    if node.kind == "call" and node.op:
        return _TIME_FUNCTION_UNIT.get(node.op)
    return None


def compared_literals(node: Node) -> list[Any]:
    """Literals in tree order, with time quantities normalised to days.

    A literal takes its unit from the OTHER side of the comparison it sits in:
    in `months_since(x) <= 6` the 6 is months, because `months_since` yields
    months. A literal with no time function opposite it is left exactly as it is —
    `active_clients > 5000` is a count and 5,000 stays 5,000.
    """
    out: list[Any] = []

    def walk(n: Node) -> None:
        if n.kind == "cmp" and len(n.children) == 2:
            left, right = n.children
            unit = _unit_of_operand(left) or _unit_of_operand(right)
            factor = _TO_DAYS.get(unit or "")
            for side in (left, right):
                if (
                    side.kind == "num"
                    and factor is not None
                    and isinstance(side.value, (int, float))
                    and not isinstance(side.value, bool)
                ):
                    value = side.value * factor
                    out.append(int(value) if float(value).is_integer() else value)
                else:
                    walk(side)
            return
        if n.kind in ("num", "str"):
            out.append(n.value)
            return
        for child in n.children:
            walk(child)

    walk(node)
    return out


def literals_in_tree_order(node: Node) -> list[Any]:
    out: list[Any] = []
    if node.kind in ("num", "str"):
        out.append(node.value)
    for child in node.children:
        out.extend(literals_in_tree_order(child))
    return out


def refs_in_tree(node: Node) -> list[str]:
    out: list[str] = []
    if node.kind == "ref":
        out.append(str(node.value))
    for child in node.children:
        out.extend(refs_in_tree(child))
    return out


def _sha(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def fingerprint(
    expression: str,
    *,
    audience_id: int | None,
    attribute_ids: dict[str, int] | None = None,
    obligation_text: str | None = None,
) -> dict[str, Any]:
    """The two hashes, plus everything needed to recompute them.

    `attribute_ids` maps a reference name ("Cyber.last_audit_date") to its
    registry id. Unmapped refs serialise as `?name` rather than being dropped —
    a missing id must be visible, not silently hashed away.

    When the expression does not parse (attestable prose: "shall maintain
    adequate systems and procedures" has no operators and no data-points) this
    falls back to `audience_id + attribute_ids + hash of the normalised
    sentence`. That fallback is genuinely weaker and will generate more review
    traffic. There is no way around it: prose cannot be diffed structurally, and
    the alternative to a weak hash is not a better hash, it is a human.
    """
    attribute_ids = attribute_ids or {}
    parsed = parse_expression(expression or "")

    if not parsed.valid or parsed.tree is None:
        ids = sorted(set(attribute_ids.values()))
        sentence = " ".join((obligation_text or expression or "").lower().split())
        identity_core = f"a:{audience_id}|attestable|ids:{ids}|{_sha(sentence)[:16]}"
        return {
            "structural": False,
            "valid": False,
            "error": parsed.error,
            "canonical_tree": None,
            "identity_core": identity_core,
            "full_core": identity_core,
            "identity_hash": _sha(identity_core),
            "full_hash": _sha(identity_core),
            "attribute_ids": ids,
            "literals": [],
            "audience_id": audience_id,
        }

    tree = canonicalise(parsed.tree)
    masked = serialise(tree, mask=True, ids=attribute_ids)
    unmasked = serialise(tree, mask=False, ids=attribute_ids)
    literals = literals_in_tree_order(tree)
    # The full hash sees the COMPARED form. `literals` is kept as written and
    # travels in hash_inputs, so the stored rule still says what the circular said.
    compared = compared_literals(tree)
    ids = sorted({attribute_ids[r] for r in refs_in_tree(tree) if r in attribute_ids})

    # The audience is part of identity BY ID. Without it the QSB 180-day rule and
    # the non-QSB 90-day rule both mask to the same string and Step 15 files the
    # second as an amendment of the first — two live duties silently collapsing
    # into one wrong one. Decisions 74, 75.
    identity_core = f"a:{audience_id}|{masked}"
    full_core = f"{identity_core}|{'|'.join(str(v) for v in compared)}"

    return {
        "structural": True,
        "valid": True,
        "error": None,
        "ref_ids": {r: attribute_ids[r] for r in refs_in_tree(tree) if r in attribute_ids},
        "constraints": extract_constraints(tree, attribute_ids),
        "canonical_tree": tree.to_dict(),
        "canonical_expression": unmasked,
        "identity_core": identity_core,
        "full_core": full_core,
        "identity_hash": _sha(identity_core),
        "full_hash": _sha(full_core),
        "attribute_ids": ids,
        "literals": literals,
        "compared_literals": compared,
        "audience_id": audience_id,
    }



# ─────────────────────────────────────────────────────────────────────────────
# Step 17's input — numeric constraints, extracted from the canonical tree
#
# A contradiction is two ACTIVE rules no single firm can satisfy, and in practice
# that is almost always two different numbers for the same duty: two deadlines,
# two thresholds, two frequencies. Extracting those here rather than in the
# consistency checker keeps ONE tree walker in the codebase.
#
# `shape` is the serialised left-hand side. Two constraints are comparable only
# when their shapes are identical, which is what stops `days_between(x, today)
# <= 180` being compared against a bare `x <= 180` — same attribute, different
# quantity, and treating them as one would invent contradictions.
# ─────────────────────────────────────────────────────────────────────────────
_NUMERIC_CMP = {"<", "<=", ">", ">=", "==", "!="}


def extract_constraints(tree: Node, ids: dict[str, int]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []

    def walk(node: Node, negated: bool) -> None:
        if node.kind == "not":
            for child in node.children:
                walk(child, not negated)
            return
        if node.kind == "or":
            # An OR branch is not a constraint the rule always imposes, so its
            # children are deliberately not collected: `a <= 1 OR a >= 9` is
            # satisfiable and must not read as two conflicting demands.
            return
        if node.kind == "cmp" and node.op in _NUMERIC_CMP and len(node.children) == 2:
            left, right = node.children
            if right.kind == "num" and not negated:
                refs = sorted({ids[r] for r in refs_in_tree(left) if r in ids})
                if refs:
                    # Every attribute on the left is a bucket key. Comparability
                    # is decided by SHAPE, not by the attribute list: two
                    # constraints conflict only when their left-hand sides are
                    # character-identical, which is what stops
                    # `days_between(#4471, today) <= 180` being weighed against a
                    # bare `#4471 <= 180` — same attribute, different quantity.
                    out.append({
                        "attribute_ids": refs,
                        "shape": serialise(left, mask=False, ids=ids),
                        "op": node.op,
                        "value": right.value,
                    })
            return
        for child in node.children:
            walk(child, negated)

    walk(tree, False)
    return out


def hash_inputs(result: dict[str, Any]) -> dict[str, Any]:
    """What gets stored in `obligations.hash_inputs`.

    The hash is built from registry ids, and Step 13's cold-start clustering
    renumbers those — so every hash in the database goes stale the moment
    attributes merge. Storing the inputs makes that a RE-DERIVATION rather than
    a re-ingest. The hash is recomputable, never a permanent key (14d).
    """
    return {
        "audience_id": result.get("audience_id"),
        "attribute_ids": result.get("attribute_ids", []),
        "canonical_tree": result.get("canonical_tree"),
        "literals": result.get("literals", []),
        # Kept so a changed conversion table is a RE-DERIVATION, not a re-ingest.
        "compared_literals": result.get("compared_literals", []),
        "structural": result.get("structural", False),
        "identity_core": result.get("identity_core"),
        # The tree stays id-free so a registry renumber does not change it; the
        # map that was used lives beside it, and changes.
        "ref_ids": result.get("ref_ids", {}),
        # Step 17 reads these instead of re-walking the tree.
        "constraints": result.get("constraints", []),
    }
