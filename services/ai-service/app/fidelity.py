"""Step 11d — the three validation lanes, and the unit contract.

Every lane here is DETERMINISTIC FIRST. Lane 3 is the interesting one and it is
the third instance of a principle this pipeline keeps arriving at:

    cheap deterministic check  ->  tripwire  ->  targeted AI adjudication with a
    SPECIFIC complaint  ->  verify the answer with the same check

The check is not a judge. It decides *who gets looked at*, and because it fires on
a small fraction of rules the verifier stays cheap and high-signal. Asking a model
"is this rule right?" gets a yes from the same model that wrote it; asking "the
rule uses 90 and the clause contains 180 and 15 — where did 90 come from?" is a
narrow, checkable question.

── The unit contract ────────────────────────────────────────────────────────

Units are CONSTRAINED but never CONVERTED at extraction. The instinct to
standardise time when the rule is written is right; doing it there is wrong:

    "at least once every half year"  ->  183 days

    6 calendar months from 31 Jan  ->  31 July
    183 days from 31 Jan           ->  2 August      two days apart

A firm audited on 1 August is compliant under one reading and in breach under the
other. Converting at extraction does not standardise — it silently picks an
interpretation and destroys the evidence that a choice was made. It also destroys
provenance, hands deterministic work to the least deterministic component, and
cements the cache.

So: three representations, one truth.

    STORED      what the circular said        "every 6 months"   never changes
    COMPARED    canonical form for matching   180 days           derived, disposable
    DISPLAYED   what the user reads           "half-yearly"      from the source

`to_days` below produces only the COMPARED form. It is a sort key for
fingerprints, not a date computation — which is why a month is 30 days here and
not 30.44 or "the same date next month". Nothing schedules an audit from this
number; it exists so that a circular writing "180 days" and one writing "six
months" for the same duty land on the same fingerprint instead of quietly
becoming two obligations.
"""

from __future__ import annotations

import re
from typing import Any

# ── the closed unit vocabulary ───────────────────────────────────────────────

UNITS = ("days", "months", "years", "hours", "rupees", "percent", "count")

#: Comparison factors only. See the module docstring — this is a sort key, not a
#: calendar. 30/360 is the convention that makes "six months" and "180 days"
#: agree, which is how SEBI writes the same duty in different circulars.
_DAYS_PER = {"hours": 1 / 24, "days": 1, "months": 30, "years": 360}

# Units that are commensurable with each other. Anything outside a group cannot
# be compared at all: a date is not a sum of rupees.
_DIMENSION = {
    "hours": "time", "days": "time", "months": "time", "years": "time",
    "rupees": "money", "percent": "ratio", "count": "count",
}


def to_days(value: float, unit: str) -> float | None:
    """The COMPARED representation of a time quantity. None for non-time units."""
    factor = _DAYS_PER.get((unit or "").lower())
    return None if factor is None else value * factor


def commensurable(a: str, b: str) -> bool:
    """Can these two units be compared at all?"""
    da, db = _DIMENSION.get((a or "").lower()), _DIMENSION.get((b or "").lower())
    return da is not None and da == db


# ── normalising the clause text, so the check does not cry wolf ──────────────

_WORD_NUMBERS = {
    "one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "seven": 7,
    "eight": 8, "nine": 9, "ten": 10, "eleven": 11, "twelve": 12, "fifteen": 15,
    "twenty": 20, "thirty": 30, "forty": 40, "forty-five": 45, "fifty": 50,
    "sixty": 60, "ninety": 90, "hundred": 100, "thousand": 1000,
}

#: A period phrase and the numbers it legitimately stands for. Both the count and
#: its day-equivalent are admitted: a rule may reasonably write "half-yearly" as
#: `months_since(x) <= 6` or as `days_since(x) <= 180`, and flagging either as an
#: invention would make the tripwire useless.
_PERIOD_PHRASES: list[tuple[str, tuple[float, ...]]] = [
    (r"half[-\s]?yearly|semi[-\s]?annual(?:ly)?|every\s+six\s+months|once\s+every\s+half\s+year",
     (6, 180)),
    (r"quarterly|every\s+quarter", (3, 90)),
    (r"annual(?:ly)?|yearly|once\s+a\s+year|every\s+year", (1, 12, 365, 360)),
    (r"monthly|every\s+month", (1, 30)),
    (r"fortnight(?:ly)?|every\s+two\s+weeks", (14, 2)),
    (r"weekly|every\s+week", (7, 1)),
    (r"daily|every\s+day|each\s+day", (1,)),
    (r"bi[-\s]?monthly", (2, 60)),
]

#: "fees for 2 quarters", "within three weeks" — a quantity with a period WORD.
#: Handled explicitly rather than by allowing a blanket set of conversion factors,
#: which would explain away almost any number and leave the check toothless.
_QUANTIFIED_PERIOD: list[tuple[str, tuple[float, ...]]] = [
    (r"(\d+(?:\.\d+)?)\s*quarters?", (3, 90)),      # n quarters -> 3n months, 90n days
    (r"(\d+(?:\.\d+)?)\s*weeks?", (7, 0.25)),       # n weeks -> 7n days, n/4 months
    (r"(\d+(?:\.\d+)?)\s*fortnights?", (14, 0.5)),
    (r"(\d+(?:\.\d+)?)\s*(?:calendar\s+)?years?", (12, 360, 365)),
    (r"(\d+(?:\.\d+)?)\s*months?", (30,)),
    (r"(\d+(?:\.\d+)?)\s*weeks?", (7,)),
]

#: A number that POINTS somewhere rather than measuring anything.
#:
#: This rule earns its place: without it a rule that lifted `4` out of "as
#: specified in Annexure 4" passes the check, because 4 is in the text. With it,
#: 4 is removed from the pool and a whole failure class becomes visible.
_REFERENCE_NUMBER = re.compile(
    r"\b(?:annexure|appendix|schedule|form|regulation|rule|section|para(?:graph)?|"
    r"clause|table|chapter|part|circular|no\.?|number)\s*[-–]?\s*"
    r"([IVXivx]+|[A-Za-z]?\d+(?:\.\d+)*)",
    re.IGNORECASE,
)
#: Dates and years: "November 01, 2023", "1996". Not thresholds either.
_YEAR = re.compile(r"\b(?:19|20)\d{2}\b")
_FOOTNOTE = re.compile(r"(?<=[a-z\)])\d{1,3}\b")  # "Schedule453", "circular12"

_NUMBER = re.compile(r"\d+(?:,\d{3})*(?:\.\d+)?")


def text_numbers(text: str) -> set[float]:
    """The pool of numbers a rule's literals may legitimately come from.

    Normalised the SAME way the rule was, or the check cries wolf constantly:
    word numbers become digits, period phrases contribute the values they stand
    for, and pointers are stripped rather than counted as thresholds.
    """
    if not text:
        return set()
    body = text

    pool: set[float] = set()
    for pattern, values in _PERIOD_PHRASES:
        if re.search(pattern, body, re.IGNORECASE):
            pool.update(float(v) for v in values)
    for pattern, factors in _QUANTIFIED_PERIOD:
        for m in re.finditer(pattern, body, re.IGNORECASE):
            try:
                n = float(m.group(1))
            except ValueError:
                continue
            pool.update(n * f for f in factors)

    # Strip the pointers BEFORE harvesting digits.
    body = _REFERENCE_NUMBER.sub(" ", body)
    body = _YEAR.sub(" ", body)
    body = _FOOTNOTE.sub("", body)

    for word, value in _WORD_NUMBERS.items():
        if re.search(rf"\b{re.escape(word)}\b", body, re.IGNORECASE):
            pool.add(float(value))

    for m in _NUMBER.finditer(body):
        raw = m.group(0).replace(",", "")
        try:
            pool.add(float(raw))
        except ValueError:
            continue

    # A percentage written "10%" is also legitimately "0.1" in a rule.
    for m in re.finditer(r"(\d+(?:\.\d+)?)\s*(?:%|per\s*cent)", text, re.IGNORECASE):
        pool.add(float(m.group(1)) / 100)

    return pool


# Numbers a rule may use without the clause containing them: the arithmetic
# identities and the boolean-ish constants that appear in almost every expression.
_FREE = {0.0, 1.0}


def rule_literals(expression: str) -> list[float]:
    """Numeric literals in a drafted expression, in order."""
    out: list[float] = []
    for m in _NUMBER.finditer(expression or ""):
        try:
            out.append(float(m.group(0).replace(",", "")))
        except ValueError:
            continue
    return out


# ── Lane 3 — the tripwire ────────────────────────────────────────────────────

def number_fidelity(expression: str, clause_text: str) -> dict[str, Any]:
    """Does every literal in the rule trace to a number in the clause?

    Returns {ok, unexplained, pool, complaint}. `ok` False is a REFERRAL, not a
    rejection — the check decides who gets looked at.
    """
    pool = text_numbers(clause_text)
    literals = rule_literals(expression)
    unexplained = [
        v for v in literals
        if v not in _FREE and v not in pool and not _explained_by_units(v, pool)
    ]
    result: dict[str, Any] = {
        "ok": not unexplained,
        "unexplained": unexplained,
        "pool": sorted(pool),
        "literals": literals,
    }
    if unexplained:
        shown = ", ".join(f"{v:g}" for v in sorted(pool)[:8]) or "no numbers at all"
        result["complaint"] = (
            f"The rule uses {', '.join(f'{v:g}' for v in unexplained)}. "
            f"The clause contains {shown}. "
            f"Nothing in the clause explains where "
            f"{'they' if len(unexplained) > 1 else f'{unexplained[0]:g}'} came from."
        )
    return result


def _explained_by_units(value: float, pool: set[float]) -> bool:
    """A literal is also explained if it is a unit conversion of a pooled number.

    "two weeks" in the text and `days_since(x) <= 14` in the rule is a correct
    reading, not an invention.
    """
    for source in pool:
        if source == 0:
            continue
        for factor in (24, 7, 30, 12, 360, 365, 1 / 24, 1 / 7, 1 / 30, 1 / 12):
            if abs(source * factor - value) < 1e-9:
                return True
    return False


def admissible_correction(value: float, clause_text: str) -> bool:
    """The closed loop: a correction must pass the check that failed.

    So the model can only move a value toward something demonstrably present in
    the source. It cannot invent its way out of the flag — a correction that ALSO
    fails goes to a human instead.
    """
    pool = text_numbers(clause_text)
    return value in _FREE or value in pool or _explained_by_units(value, pool)


# ── Lane 1 — type check ──────────────────────────────────────────────────────

_FUNCTIONS = {
    "days_since", "months_since", "years_since", "days_between", "hours_between",
    "months_between", "count", "exists", "max", "min", "abs",
}
#: What each function returns, for comparison compatibility.
_RETURNS = {
    "days_since": "days", "months_since": "months", "years_since": "years",
    "days_between": "days", "hours_between": "hours", "months_between": "months",
    "count": "count", "exists": "boolean", "max": None, "min": None, "abs": None,
}

_CALL = re.compile(r"\b([a-z_][a-z0-9_]*)\s*\(")
_COMPARISON = re.compile(
    r"([a-z_][a-z0-9_]*\s*\([^()]*\)|[a-z_][a-z0-9_]*)\s*(<=|>=|==|!=|<|>)\s*"
    r"(\d+(?:\.\d+)?|[a-z_][a-z0-9_]*\s*\([^()]*\)|[a-z_][a-z0-9_]*)",
    re.IGNORECASE,
)


def type_check(expression: str, hints: dict[str, Any] | None = None) -> dict[str, Any]:
    """Lane 1. Structure, the allowed function list, and comparison compatibility.

    ⚠️ `months` against `days` is CONVERTED for comparison, never rejected — the
    design is explicit about it. A rule comparing a date to a sum of rupees is a
    different thing entirely and is rejected.
    """
    hints = hints or {}
    problems: list[str] = []

    used = {m.group(1) for m in _CALL.finditer(expression or "")}
    unknown = sorted(used - _FUNCTIONS)
    if unknown:
        problems.append(f"unknown function(s): {', '.join(unknown)}")

    for m in _COMPARISON.finditer(expression or ""):
        left, _op, right = m.group(1), m.group(2), m.group(3)
        lu, ru = _unit_of(left, hints), _unit_of(right, hints)
        if lu and ru and not commensurable(lu, ru):
            problems.append(f"cannot compare {lu} with {ru} ({left} {_op} {right})")

    missing = sorted(
        t for t in _identifiers(expression) if t not in hints and t not in _FUNCTIONS
    )
    if missing:
        problems.append(f"token(s) with no hint: {', '.join(missing)}")

    return {"ok": not problems, "problems": problems}


def _unit_of(operand: str, hints: dict[str, Any]) -> str | None:
    operand = (operand or "").strip()
    call = _CALL.match(operand)
    if call:
        return _RETURNS.get(call.group(1))
    if re.fullmatch(r"\d+(?:\.\d+)?", operand):
        return None  # a bare literal takes the other side's unit
    hint = hints.get(operand)
    if isinstance(hint, dict):
        return hint.get("unit") or None
    return None


def _identifiers(expression: str) -> set[str]:
    out = set()
    for m in re.finditer(r"\b([a-z_][a-z0-9_]*)\b", expression or "", re.IGNORECASE):
        name = m.group(1)
        if name in _FUNCTIONS or name.upper() in ("AND", "OR", "NOT", "TRUE", "FALSE"):
            continue
        if expression[m.end() : m.end() + 1].strip().startswith("("):
            continue
        out.add(name)
    return out


# ── Lane 2 — modifier cross-check ────────────────────────────────────────────

def modifier_targets_seen(target: str, scanned: list[str]) -> dict[str, Any]:
    """The AI's `targets` must appear among the citations the pattern scan found.

    Cheap, and it catches a real modification attached to the WRONG target —
    which would otherwise silently restrict a rule SEBI never mentioned.
    """
    want = (target or "").strip()
    seen = [s.strip() for s in scanned]
    ok = bool(want) and want in seen
    return {
        "ok": ok,
        "target": want,
        "scanned": seen,
        "complaint": None if ok else (
            f'the modifier targets "{want}", but the text of this clause mentions '
            f'{seen or "no paragraph at all"}'
        ),
    }
