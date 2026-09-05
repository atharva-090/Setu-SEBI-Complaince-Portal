"""Stage B — Step-1 Rule Drafter (scope §5 Stage B, prompts §9).

Two providers:
- real (any OpenAI-compatible endpoint): forced tool-call against the
  `emit_rules` schema, temperature 0. No registry, no corpus — one clause
  window in, slim rules out.
- mock (no LLM_API_KEY, or LLM_PROVIDER=mock): transparent regex heuristics so
  the whole ingestion spine runs end-to-end without a key. Mock drafts are
  pinned to confidence 0.55 → they land in state=REVIEW, never as trusted
  ACTIVE rules. The response carries drafter="mock" so nothing can pass as
  real extraction.

Embeddings mirror the same split: real API vs a deterministic hash-seeded unit
vector (same text → same vector) that keeps downstream plumbing testable.
"""

from __future__ import annotations

import hashlib
import json
import math
import random
import re
from typing import Any

from .config import settings
from . import fidelity
from .llm import _client

EMBED_DIM = 1536
CONFIDENCE_ACTIVE = 0.75  # scope §6: >= 0.75 → ACTIVE, else REVIEW

SYSTEM_PROMPT = """You convert a single regulatory clause into ONE OR MORE executable rules.
Output ONLY via the `emit_rules` function.
- Write each rule in BRE expression syntax using short, readable snake_case tokens.
- Allowed builtins: days_since(x), months_since(x), years_since(x), days_between(a,b),
  hours_between(a,b), months_between(a,b), count(x), exists(x), max(x), min(x), abs(x).
- Comparisons: <= >= == != < > ; combine with AND / OR ; parentheses allowed.
- A rule must evaluate to true when the entity is COMPLIANT.
- Copy numbers and units verbatim; never invent values. Convert word-numbers to digits
  ("six months" -> months_since(x) <= 6). Periods: half-yearly = 6 months, quarterly =
  3 months, annually = 12 months.
- Purely procedural/definitional text, or duties addressed to SEBI/exchanges rather than
  the regulated entity: emit NO rule for it.
- If the clause is a proof-style duty with nothing computable (maintain/appoint/formulate
  a policy, keep records), emit obligation_type "attestable" with exists(<token>).
- For each token used, give attribute_hints[token] = {data_type, meaning} — data_type in
  {date, number, boolean, string, document}, meaning = one line stating what the broker
  must supply.
- Give a `context` (short snake_case topic like cybersecurity_audit) and confidence 0-1.
Do not resolve or guess attribute IDs — tokens are placeholders."""

EMIT_RULES_TOOL = {
    "type": "function",
    "function": {
        "name": "emit_rules",
        "description": "Emit the executable rules drafted from this clause window.",
        "parameters": {
            "type": "object",
            "properties": {
                "rules": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "title": {"type": "string"},
                            "rule_expression": {"type": "string"},
                            "result_pass": {"type": "string"},
                            "result_fail": {"type": "string"},
                            "attribute_hints": {
                                "type": "object",
                                "additionalProperties": {
                                    "type": "object",
                                    "properties": {
                                        "data_type": {
                                            "enum": ["date", "number", "boolean", "string", "document"]
                                        },
                                        "meaning": {"type": "string"},
                                        "unit": {"type": "string"},
                                    },
                                    "required": ["data_type", "meaning"],
                                },
                            },
                            "obligation_type": {"enum": ["computable", "attestable"]},
                            "context": {"type": "string"},
                            "source_clause": {"type": "string"},
                            "confidence": {"type": "number"},
                        },
                        "required": [
                            "title", "rule_expression", "result_pass", "result_fail",
                            "attribute_hints", "obligation_type", "context",
                            "source_clause", "confidence",
                        ],
                    },
                }
            },
            "required": ["rules"],
        },
    },
}


# ─────────────────────────────────────────────────────────────────────────────
# Step 12's input — modifiers
#
# A modifier is a clause that changes ANOTHER clause's application rather than
# imposing a duty of its own. Step 12 cannot assemble what Step 11 never emitted,
# so this lane exists here even though the applying is done in the backend.
#
# ⚠️ Measured over the seven SEBI documents: 34 sentences cross-reference a
# paragraph and say something about its application, and roughly TWO of them
# narrow by a property of the firm. The rest narrow by transaction type,
# instrument type, scheme type or client type:
#
#     "Investment limits in 12.3.1 shall not be applicable on investments in
#      securitized debt instruments"                      <- instrument, not firm
#     "Paragraphs 8.4.5 and 8.4.6 shall apply to 'switch in' transactions"
#                                                          <- transaction, not firm
#
# So the model is asked to say WHICH KIND it is, rather than being pushed to
# force everything into a firm test. Claiming a firm is outside a rule when only
# one kind of its transactions is would be wrong in the dangerous direction.
# ─────────────────────────────────────────────────────────────────────────────

MODIFIER_SYSTEM_PROMPT = """You read ONE clause from an Indian securities-market \
circular and decide whether it MODIFIES another clause rather than imposing a duty.

A MODIFIER changes how another clause applies. Four kinds:
  restrict_scope   "the provisions of 9.5.1 shall apply only to brokers with
                    more than 5,000 clients"
  exempt           "nothing in 12.3 shall apply to brokers with fewer than 500
                    active clients"
  extend_scope     "9.5.1 shall also apply to clearing members"
  override_value   "for QSBs, the period in 9.5.1 shall be 90 days"

NOT a modifier: a clause that states a duty of its own, even if it cites another
paragraph for context. "As specified in para 45, brokers shall report daily" is a
DUTY, not a modifier.

For each modifier report:
  targets     the paragraph number it changes, exactly as written ("12.3.1")
  effect      one of the four above
  condition_kind
              "firm"  - the condition is a property of the FIRM (it is a QSB, it
                        holds client funds, it has >5,000 clients)
              "scope" - the condition is about transactions, instruments, schemes
                        or clients rather than the firm itself
  condition   when condition_kind is "firm", a test over firm properties using
              ONLY the names in AVAILABLE PROPERTIES
  scope_note  when condition_kind is "scope", one line saying what it narrows to
  value       for override_value only: the replacing value

Report NOTHING if the clause imposes a duty. Being wrong that a duty is a modifier
loses the duty entirely; being wrong the other way costs nothing."""

EMIT_MODIFIERS_TOOL = {
    "type": "function",
    "function": {
        "name": "emit_modifiers",
        "description": "Emit the modifiers this clause imposes on other clauses.",
        "parameters": {
            "type": "object",
            "properties": {
                "modifiers": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "targets": {"type": "string"},
                            "effect": {
                                "enum": [
                                    "restrict_scope", "exempt",
                                    "extend_scope", "override_value",
                                ]
                            },
                            "condition_kind": {"enum": ["firm", "scope"]},
                            "condition": {"type": "string"},
                            "scope_note": {"type": "string"},
                            "value": {"type": "string"},
                            "confidence": {"type": "number"},
                        },
                        "required": ["targets", "effect", "condition_kind", "confidence"],
                    },
                }
            },
            "required": ["modifiers"],
        },
    },
}

# ── mock modifier lane ───────────────────────────────────────────────────────
#
# Every shape below is one that actually occurs in the corpus; the sample sentence
# each was written against is quoted. The mock exists so assembly is runnable and
# testable without an API key.
# The cue word is OPTIONAL. SEBI writes "nothing in 12.3" and "the provisions of
# 9.5.1" as often as "paragraph 12.3", and requiring a cue missed all three of the
# design's own worked examples. The lead-in phrases below carry the context, so a
# bare number here is not a loose match.
_MOD_REF = (
    r"(?:(?:para(?:graph)?s?|clauses?|sub[-\s]?clauses?)\.?\s*)?(?:no\.?\s*)?"
    # NOT a percentage, and not a bare number introduced as a quantity.
    # "the above limit of 10% shall not be applicable to Silver ETFs" was read
    # as targeting paragraph 10, which matched 32 clauses. Step 12 refused it —
    # a modifier never fans out — but it should not have been offered one.
    r"(?<!limit of )(?<!than )(\d+(?:\.\d+)*)(?!\s*(?:%|per\s*cent|crore|lakh))"
)

_MOD_SHAPES: list[tuple[str, "re.Pattern[str]"]] = [
    # "Except for Paragraph 12.16.1.7 above, the above guidelines shall not apply
    #  to term deposits placed as margins"
    ("exempt", re.compile(
        r"(?:the\s+)?(?:provisions?|processes|guidelines|requirements?|criteria|limits?|"
        r"restrictions?)[^.]{0,80}?" + _MOD_REF + r"[^.]{0,60}?(?:shall\s+not\s+(?:be\s+)?"
        r"(?:apply|applicable)|is\s+not\s+applicable|are\s+not\s+applicable)", re.I)),
    ("exempt", re.compile(r"nothing\s+(?:contained\s+)?in\s+" + _MOD_REF, re.I)),
    # "The provisions of 9.5.1 shall apply only to brokers with >5,000 clients"
    ("restrict_scope", re.compile(
        r"(?:the\s+)?provisions?\s+(?:of|at|in)\s+" + _MOD_REF
        + r"[^.]{0,60}?shall\s+apply\s+only", re.I)),
    ("restrict_scope", re.compile(_MOD_REF + r"[^.]{0,40}?shall\s+apply\s+only", re.I)),
    # "The aforementioned provisions at para 20.5 and 20.6 shall also be applicable to..."
    ("extend_scope", re.compile(
        _MOD_REF + r"[^.]{0,60}?shall\s+also\s+(?:be\s+)?appl(?:y|icable)", re.I)),
    # "for QSBs, the period in 9.5.1 shall be 90 days"
    ("override_value", re.compile(
        r"for\s+[\w\s]{3,40},?\s+the\s+[\w\s]{2,30}?\s+(?:in|specified\s+in|under)\s+"
        + _MOD_REF + r"\s+shall\s+be\s+([\w.]+)", re.I)),
]

# The firm properties a modifier condition can name. Mirrors audience.py's
# vocabulary; kept as phrases because a modifier states the condition in prose.
# Deliberately the SAME vocabulary audience.py uses for headings. A precondition
# and a chapter heading naming the same property must produce the same condition
# string, or they normalise differently, rung 3 misses, and one group of firms
# ends up as two audience nodes with the rules split across them.
_MOD_FIRM: list[tuple[str, str]] = [
    (r"qualified\s+stock\s+broker|\bQSBs?\b", "is_qsb == true"),
    (r"clearing\s+member", "is_clearing_member == true"),
    (r"hold(?:s|ing)?\s+client\s+(?:funds?|monies|money|securities)",
     "holds_client_funds == true"),
    (r"internet[-\s]based\s+trading|internet\s+trading|\bIBT\b",
     "provides_internet_trading == true"),
    (r"\bcloud\b", "uses_cloud_services == true"),
    (r"outsourc", "outsources_it == true"),
    (r"market\s+infrastructure\s+institution|\bMIIs?\b", "is_mii == true"),
    (r"more\s+than\s+([\d,]+)\s+(?:active\s+)?clients", "active_clients > {}"),
    (r"fewer\s+than\s+([\d,]+)\s+(?:active\s+)?clients", "active_clients < {}"),
    (r"less\s+than\s+([\d,]+)\s+(?:active\s+)?clients", "active_clients < {}"),
]


def _mock_firm_condition(text: str) -> str | None:
    for pattern, template in _MOD_FIRM:
        m = re.search(pattern, text, re.IGNORECASE)
        if not m:
            continue
        if "{}" in template:
            return template.format(m.group(1).replace(",", ""))
        return template
    return None


# "Clause 1 of the Seventh Schedule of SEBI (Mutual Funds) Regulations, 1996"
# names a STATUTE, not a paragraph of this circular. Without this the target "1"
# resolved to an unrelated clause numbered 1 and the modifier was applied to the
# wrong rule — found on a live run. citations.py draws the same distinction for
# the same sentence shape; both readers have to make it.
_STATUTE_TAIL = re.compile(
    r"^\s*(?:of\s+)?(?:the\s+)?(?:[A-Z][\w&.'()\-]*\s+){0,6}"
    # The trailing \d* is not cosmetic: this corpus glues footnote markers
    # straight onto words, and "Seventh Schedule453" defeated a \b-anchored
    # match — the guard was written, shipped, and still let the bad target
    # through on the live run that was meant to confirm it.
    r"(?:Regulations?|Act|Rules|Schedules?|Guidelines|Bye[-\s]?laws)\d*\b",
    re.IGNORECASE,
)


def _draft_mock_modifiers(window_text: str, clause_no: str | None) -> list[dict]:
    body = re.sub(r"\s+", " ", window_text.split("\n", 1)[-1])
    out: list[dict] = []
    for effect, pattern in _MOD_SHAPES:
        m = pattern.search(body)
        if not m:
            continue
        target = m.group(1)
        if clause_no and target == clause_no:
            continue  # a clause does not modify itself
        if _STATUTE_TAIL.match(body[m.end(1) : m.end(1) + 90]):
            continue  # names a statute, not a paragraph of this circular
        tail = body[m.end() : m.end() + 160]
        condition = _mock_firm_condition(tail) or _mock_firm_condition(body)
        entry = {
            "targets": target,
            "effect": effect,
            "confidence": 0.4,  # mock: always below auto-approve
            "raw": body[max(0, m.start() - 20) : m.end() + 120].strip(),
        }
        if condition:
            entry["condition_kind"] = "firm"
            entry["condition"] = condition
        else:
            entry["condition_kind"] = "scope"
            entry["scope_note"] = tail.strip()[:120] or body[:120]
        if effect == "override_value" and m.lastindex and m.lastindex >= 2:
            entry["value"] = m.group(2)
        out.append(entry)
        break  # one modifier per clause; a clause stating two is vanishingly rare
    return out


def _draft_real_modifiers(window_text: str, clause_no: str | None) -> list[dict]:
    from .audience import FIRM_PROPERTIES

    props = json.dumps(
        [{k: v for k, v in p.items() if k != "implies"} for p in FIRM_PROPERTIES]
    )
    resp = _client().chat.completions.create(
        model=settings.llm_model_large,
        temperature=0,
        messages=[
            {"role": "system", "content": MODIFIER_SYSTEM_PROMPT},
            {
                "role": "user",
                "content": f"CLAUSE {clause_no or ''}\n{window_text}\n\nAVAILABLE PROPERTIES\n{props}",
            },
        ],
        tools=[EMIT_MODIFIERS_TOOL],
        tool_choice={"type": "function", "function": {"name": "emit_modifiers"}},
    )
    calls = resp.choices[0].message.tool_calls or []
    if not calls:
        return []
    parsed = json.loads(calls[0].function.arguments).get("modifiers") or []
    for m in parsed:
        m.setdefault("raw", window_text[:160])
    return parsed


def draft_modifiers(window_text: str, clause_no: str | None) -> list[dict]:
    """Step 12's input: what this clause changes about OTHER clauses."""
    if provider() == "mock":
        return _draft_mock_modifiers(window_text, clause_no)
    return _draft_real_modifiers(window_text, clause_no)


def provider() -> str:
    if settings.llm_provider == "mock" or not settings.llm_api_key:
        return "mock"
    return settings.llm_provider


# ── real drafter ─────────────────────────────────────────────────────────────

def _draft_real(window_text: str, clause_no: str | None) -> list[dict[str, Any]]:
    user = f"CLAUSE WINDOW:\n{window_text}\n\nsource_clause: {clause_no or 'unknown'}"
    for attempt in (1, 2):
        resp = _client().chat.completions.create(
            model=settings.llm_model_large,
            temperature=0,
            messages=[
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": user},
            ],
            tools=[EMIT_RULES_TOOL],
            tool_choice={"type": "function", "function": {"name": "emit_rules"}},
        )
        calls = resp.choices[0].message.tool_calls or []
        if not calls:
            continue
        try:
            payload = json.loads(calls[0].function.arguments)
            rules = payload.get("rules", [])
            return [r for r in rules if str(r.get("rule_expression", "")).strip()]
        except json.JSONDecodeError:
            if attempt == 2:
                raise
    return []


# ── mock drafter (transparent heuristics; confidence pinned to REVIEW) ───────

_NUM_WORDS = {
    "one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "seven": 7,
    "eight": 8, "nine": 9, "ten": 10, "twelve": 12, "fifteen": 15, "twenty": 20,
    "twenty-one": 21, "twenty one": 21, "thirty": 30, "forty-five": 45, "sixty": 60,
    "ninety": 90, "hundred": 100,
}
_STOP = {
    "the", "of", "and", "to", "a", "in", "for", "by", "shall", "be", "as", "or",
    "with", "an", "on", "at", "such", "their", "any", "all", "its", "is", "are",
    "stock", "brokers", "broker", "every", "each",
}


def _n(word: str) -> int | None:
    word = word.strip().lower().replace("-", " ")
    if word.isdigit():
        return int(word)
    return _NUM_WORDS.get(word) or _NUM_WORDS.get(word.replace(" ", "-"))


def _slug(text: str, max_words: int = 3) -> str:
    words = [w for w in re.findall(r"[a-z]+", text.lower()) if w not in _STOP]
    return "_".join(words[:max_words]) or "clause"


_PERIOD = re.compile(
    r"(?:at least once (?:in )?(?:every )?|once (?:in )?every |every )"
    r"([\w-]+(?: [\w-]+)?)\s+(day|month|year)s?",
    re.IGNORECASE,
)
_WITHIN = re.compile(
    r"within\s+([\w-]+(?: [\w-]+)?)\s+(?:calendar |working )?(day|hour|month)s?",
    re.IGNORECASE,
)
_MIN = re.compile(r"not (?:be )?less than\s+([\w.-]+)|minimum(?: of)?\s+(\d[\w.]*)", re.IGNORECASE)
_MAX = re.compile(r"(?:shall |should )?not exceed(?:ing)?\s+([\w.-]+)", re.IGNORECASE)
_HALF_YEARLY = re.compile(r"half[- ]yearly|semi[- ]annual", re.IGNORECASE)
_QUARTERLY = re.compile(r"quarterly", re.IGNORECASE)
_ANNUAL = re.compile(r"\bannual(?:ly)?\b|once a year", re.IGNORECASE)


def _draft_mock(window_text: str, clause_no: str | None) -> list[dict[str, Any]]:
    body = window_text.split("\n", 1)[-1]
    slug = _slug(body)
    title = re.split(r"(?<=[.;])\s", body.strip(), 1)[0][:140]
    context = _slug(window_text.split("\n", 1)[0] if window_text.startswith("[") else body, 2)

    expression: str | None = None
    hints: dict[str, Any] = {}
    obligation_type = "computable"

    if m := _PERIOD.search(body):
        n = _n(m.group(1))
        if n:
            unit = m.group(2).lower()
            token = f"{slug}_last_date"
            fn = {"day": "days_since", "month": "months_since", "year": "years_since"}[unit]
            expression = f"{fn}({token}) <= {n}"
            hints[token] = {"data_type": "date", "meaning": f"date of the last {title[:60].lower()}"}
    if expression is None and (m := _WITHIN.search(body)):
        n = _n(m.group(1))
        if n:
            unit = m.group(2).lower()
            fn = {"day": "days_between", "hour": "hours_between", "month": "months_between"}[unit]
            a, b = f"{slug}_event_date", f"{slug}_action_date"
            expression = f"{fn}({a}, {b}) <= {n}"
            hints[a] = {"data_type": "date", "meaning": f"date the {slug.replace('_', ' ')} trigger event occurred"}
            hints[b] = {"data_type": "date", "meaning": f"date the required action was completed"}
    if expression is None and _HALF_YEARLY.search(body):
        token = f"{slug}_last_date"
        expression = f"months_since({token}) <= 6"
        hints[token] = {"data_type": "date", "meaning": f"date of the last {slug.replace('_', ' ')}"}
    if expression is None and _QUARTERLY.search(body):
        token = f"{slug}_last_date"
        expression = f"months_since({token}) <= 3"
        hints[token] = {"data_type": "date", "meaning": f"date of the last {slug.replace('_', ' ')}"}
    if expression is None and _ANNUAL.search(body):
        token = f"{slug}_last_date"
        expression = f"months_since({token}) <= 12"
        hints[token] = {"data_type": "date", "meaning": f"date of the last {slug.replace('_', ' ')}"}
    if expression is None and (m := _MIN.search(body)):
        raw = next(g for g in m.groups() if g)
        n = _n(re.sub(r"[^\w.-]", "", raw))
        if n is not None:
            token = f"{slug}_value"
            expression = f"{token} >= {n}"
            hints[token] = {"data_type": "number", "meaning": f"current value of {slug.replace('_', ' ')}"}
    if expression is None and (m := _MAX.search(body)):
        n = _n(re.sub(r"[^\w.-]", "", m.group(1)))
        if n is not None:
            token = f"{slug}_value"
            expression = f"{token} <= {n}"
            hints[token] = {"data_type": "number", "meaning": f"current value of {slug.replace('_', ' ')}"}
    if expression is None:
        token = f"{slug}_evidence"
        expression = f"exists({token})"
        obligation_type = "attestable"
        hints[token] = {"data_type": "document", "meaning": f"evidence that: {title[:90].lower()}"}

    return [{
        "title": title,
        "rule_expression": expression,
        "result_pass": "Compliant",
        "result_fail": "Non-Compliant",
        "attribute_hints": hints,
        "obligation_type": obligation_type,
        "context": context,
        "source_clause": clause_no or "unknown",
        "precondition": _mock_precondition(body),
        "confidence": 0.55,  # always REVIEW — mock output is a placeholder draft
    }]


# "where the broker holds client funds, it shall..." — a duty gated on a
# property of the FIRM. Step 13d promotes exactly this into the audience,
# because who a rule reaches belongs in the lattice, not buried in an expression
# where neither the overlap check nor the firm asking "why me?" can see it.
#
# ⚠️ Measured over the SEBI corpus: 71 clauses open with a conditional lead-in
# and exactly ONE of them is gated on a firm property. The rest condition on
# transactions, instruments and circumstances — the same split D3 found for
# modifiers. So this deliberately emits NOTHING unless a firm property is
# nameable: forcing the other 70 into an audience would claim a firm is outside
# a rule when only one kind of its business is.
_PRECONDITION_LEAD = re.compile(
    r"\b(?:where|in\s+case(?:\s+of)?|if|for)\s+(?:a|an|the|any)?\s*"
    r"(?:stock\s+)?(?:broker|intermediar\w+|entit\w+|compan\w+|firm|member|"
    r"adviser|analyst|AMC|fund|RE)\w*\s+"
    r"(?:is|are|has|have|holds?|provides?|offers?|uses?|maintains?|acts?)\b[^.;]{0,90}",
    re.IGNORECASE,
)


def _mock_precondition(body: str) -> str | None:
    for m in _PRECONDITION_LEAD.finditer(body):
        condition = _mock_firm_condition(m.group(0))
        if condition:
            return condition
    return None


def draft_rules(window_text: str, clause_no: str | None) -> list[dict[str, Any]]:
    if provider() == "mock":
        return _draft_mock(window_text, clause_no)
    return _draft_real(window_text, clause_no)


# ── embeddings ────────────────────────────────────────────────────────────────

def embed_texts(texts: list[str]) -> tuple[list[list[float]], bool]:
    """Returns (vectors, is_mock)."""
    if provider() == "mock":
        return [_pseudo_embedding(t) for t in texts], True
    resp = _client().embeddings.create(model=settings.embedding_model, input=texts)
    return [item.embedding for item in resp.data], False


def _pseudo_embedding(text: str) -> list[float]:
    seed = int.from_bytes(hashlib.sha256(text.strip().lower().encode()).digest()[:8], "big")
    rng = random.Random(seed)
    vec = [rng.gauss(0, 1) for _ in range(EMBED_DIM)]
    norm = math.sqrt(sum(v * v for v in vec)) or 1.0
    return [v / norm for v in vec]


# ─────────────────────────────────────────────────────────────────────────────
# Lane 3, step 3 — the targeted verifier
#
# A failure is not a rejection. It is a REFERRAL, and the verifier is told
# exactly what is wrong: a narrow, checkable question beats "is this rule
# right?", which the same model that wrote it will usually answer yes to.
#
# Three outcomes:
#     JUSTIFIED    accept, and store the explanation as provenance
#     WRONG        correct it, drop confidence, route to REVIEW
#     CANNOT TELL  route to REVIEW with both readings shown
#
# And the loop closes: a correction must pass the check that failed. The model
# can only move a value toward something demonstrably present in the source; it
# cannot invent its way out of the flag. A correction that ALSO fails goes to a
# human instead.
# ─────────────────────────────────────────────────────────────────────────────

VERIFIER_SYSTEM_PROMPT = """You adjudicate ONE specific complaint about ONE drafted rule.

You are NOT re-drafting the rule. You may change only the numeric literal named in
the complaint.

You may NOT change: the expression structure, the tokens or their meanings, the
rule type, or anything about a rule that was not flagged.

Answer one question: is the flagged number justified by this clause?
  justified    - it is correct; explain the derivation
  wrong        - give the value that IS correct, and it must appear in the clause
  cannot_tell  - say so; a human will look

Do not guess. "cannot_tell" is a real answer and a better one than a plausible
invention."""

VERIFY_TOOL = {
    "type": "function",
    "function": {
        "name": "adjudicate",
        "description": "Answer the complaint about this rule's number.",
        "parameters": {
            "type": "object",
            "properties": {
                "verdict": {"enum": ["justified", "wrong", "cannot_tell"]},
                "correct_value": {"type": "number"},
                "explanation": {"type": "string"},
            },
            "required": ["verdict", "explanation"],
        },
    },
}


def _verify_real(expression: str, clause_text: str, complaint: str) -> dict[str, Any]:
    resp = _client().chat.completions.create(
        model=settings.llm_model_large,
        temperature=0,
        messages=[
            {"role": "system", "content": VERIFIER_SYSTEM_PROMPT},
            {
                "role": "user",
                "content": (
                    f"THE CLAUSE\n{clause_text[:2000]}\n\n"
                    f"THE DRAFTED RULE\n{expression}\n\n"
                    f"THE COMPLAINT\n{complaint}"
                ),
            },
        ],
        tools=[VERIFY_TOOL],
        tool_choice={"type": "function", "function": {"name": "adjudicate"}},
    )
    calls = resp.choices[0].message.tool_calls or []
    return json.loads(calls[0].function.arguments) if calls else {}


def _verify_mock(expression: str, clause_text: str, complaint: str) -> dict[str, Any]:
    """Without a model there is no adjudication to do.

    It answers `cannot_tell`, which routes the rule to REVIEW. That is the honest
    mock: pretending to justify or to correct would manufacture provenance for a
    number nobody checked, which is worse than an unanswered flag.
    """
    return {
        "verdict": "cannot_tell",
        "explanation": "no model configured; the flag stands and a human decides",
    }


def verify_number(
    expression: str, clause_text: str, complaint: str, flagged: list[float] | None = None
) -> dict[str, Any]:
    """Adjudicate a number-fidelity flag, then re-run the check on the answer."""
    raw = (
        _verify_mock(expression, clause_text, complaint)
        if provider() == "mock"
        else {**_verify_real(expression, clause_text, complaint), "provider": provider()}
    )
    verdict = raw.get("verdict") or "cannot_tell"
    out: dict[str, Any] = {
        "verdict": verdict,
        "explanation": raw.get("explanation") or "",
        "expression": expression,
        "corrected": False,
        "provider": provider(),
    }

    if verdict != "wrong":
        return out

    value = raw.get("correct_value")
    if value is None:
        out["verdict"] = "cannot_tell"
        out["explanation"] = "said the number was wrong but proposed no replacement"
        return out

    # ⚠️ THE CLOSED LOOP. The correction has to pass the check that failed.
    if not fidelity.admissible_correction(float(value), clause_text):
        out["verdict"] = "cannot_tell"
        out["explanation"] = (
            f"proposed {value:g}, which the clause does not contain either — "
            f"a correction that also fails the check is refused, not applied"
        )
        return out

    old = flagged[0] if flagged else None
    if old is not None:
        out["expression"] = re.sub(
            rf"(?<![\w.]){re.escape(_fmt(old))}(?![\w.])", _fmt(float(value)), expression, count=1
        )
    out["corrected"] = out["expression"] != expression
    return out


def _fmt(value: float) -> str:
    return str(int(value)) if float(value).is_integer() else str(value)
