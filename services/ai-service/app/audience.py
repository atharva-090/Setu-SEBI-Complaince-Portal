"""Step 10a — Pattern C: the document's base applicability.

One AI call per document over its title and opening scope text yields the list
of entity types the document governs, expressed as a TEST over firm properties.
Every clause with no narrower audience inherits it as a floor.

Why this pattern first: it is the only one validated across both regulators, and
it is the only one that works on a document like the cloud framework, which has
one heading in 53 pages and states its applicability in prose instead.

The key move, and the reason this file exists at all: **the AI translates the
heading into a test, and from that point on the computer decides.** An audience
is a set of firms, and sets compare exactly. Everything after the call here —
normalisation, hashing, implication — is deterministic.
"""

from __future__ import annotations

import hashlib
import json
import re
from typing import Any

from .config import settings
from . import usage
from .llm import _client

# ─────────────────────────────────────────────────────────────────────────────
# The firm-property vocabulary
#
# Measured scale note: firm properties only SLICE the population — registration
# type, a few activity flags, a few size thresholds — so the realistic total is
# tens, not hundreds. At this size the whole list is sent and there is no
# retrieval to build. Build retrieval only if a filtered list passes ~40.
#
# `implies` is the fact-about-the-world table. The system cannot work out that
# only stock brokers can be QSBs — that appears in no circular. It is ticked once
# by a human when the property is approved, and stored forever. Without it,
# "Obligations of QSBs" and "Part II — Stock Brokers › Obligations of QSBs"
# normalise differently and produce two audience nodes where there should be one.
# ─────────────────────────────────────────────────────────────────────────────
CATEGORIES = [
    "stock_broker", "investment_adviser", "research_analyst", "merchant_banker",
    "portfolio_manager", "mutual_fund", "amc", "trustee_company", "aif",
    "depository", "depository_participant", "stock_exchange", "clearing_corporation",
    "custodian", "rta", "kra", "credit_rating_agency", "debenture_trustee",
    "venture_capital_fund", "collective_investment_scheme", "bank", "nbfc",
]

FIRM_PROPERTIES: list[dict[str, Any]] = [
    {"name": "regulator", "type": "enum", "values": ["sebi", "rbi"],
     "description": "which regulator registers the firm"},
    {"name": "category", "type": "enum", "values": CATEGORIES,
     "description": "the firm's registration type"},
    {"name": "is_mii", "type": "boolean",
     "description": "a Market Infrastructure Institution: exchange, clearing corporation or depository"},
    {"name": "is_qsb", "type": "boolean", "implies": ["category=='stock_broker'"],
     "description": "designated a Qualified Stock Broker"},
    {"name": "is_clearing_member", "type": "boolean", "implies": ["category=='stock_broker'"],
     "description": "clears its own trades"},
    {"name": "holds_client_funds", "type": "boolean",
     "description": "holds client money or securities"},
    {"name": "provides_internet_trading", "type": "boolean", "implies": ["category=='stock_broker'"],
     "description": "offers internet-based trading to clients"},
    {"name": "uses_cloud_services", "type": "boolean",
     "description": "runs regulated workloads on third-party cloud"},
    {"name": "outsources_it", "type": "boolean",
     "description": "outsources IT or IT-enabled services to a third party"},
    {"name": "is_listed", "type": "boolean", "description": "listed on a stock exchange"},
    {"name": "active_clients", "type": "number", "description": "count of active clients"},
    {"name": "aum", "type": "number", "description": "assets under management, in rupees"},
    # Pattern B is deferred, but the property it will compute exists now so a
    # CSCRF tier can be expressed the moment thresholds are built (decision 71).
    {"name": "re_category", "type": "enum",
     "values": ["mii", "qualified", "mid_size", "small_size", "self_certification"],
     "description": "CSCRF tier, DERIVED from thresholds — never self-declared"},
]

_BY_NAME = {p["name"]: p for p in FIRM_PROPERTIES}


def vocabulary() -> list[dict[str, Any]]:
    """The properties the model may choose from. It may not invent names."""
    return FIRM_PROPERTIES


# ─────────────────────────────────────────────────────────────────────────────
# 10c — normalisation
#
# Kills COSMETIC variation only, so that rung 3 (exact match) can be a string
# comparison. It deliberately does NOT decide that `category=='stock_broker' &&
# is_qsb==true` is a subset of `category=='stock_broker'` — those are genuinely
# different sets, and that is rung 4's job.
# ─────────────────────────────────────────────────────────────────────────────
_COND = re.compile(
    r"^\s*(?P<name>[a-z_][a-z0-9_]*)\s*(?P<op>==|!=|>=|<=|>|<|\bin\b)\s*(?P<value>.+?)\s*$",
    re.IGNORECASE,
)


def _canon_value(raw: str) -> str:
    v = raw.strip()
    if v.startswith("[") and v.endswith("]"):
        # A set: members sorted, so ['b','a'] and ['a','b'] are one audience.
        inner = [m.strip().strip("'\"") for m in v[1:-1].split(",") if m.strip()]
        return "[" + ", ".join(f"'{m}'" for m in sorted(set(inner))) + "]"
    low = v.lower()
    if low in ("true", "false"):
        return low
    if re.fullmatch(r"-?\d+(\.\d+)?", v):
        return v
    return "'" + v.strip("'\"") + "'"


def parse_conditions(predicate: str) -> list[str]:
    """Split a conjunction into canonical `name op value` conditions."""
    out: list[str] = []
    for part in re.split(r"&&|\bAND\b", predicate or "", flags=re.IGNORECASE):
        part = part.strip().strip("()")
        if not part:
            continue
        m = _COND.match(part)
        if not m:
            continue  # unparseable fragment: dropped, never guessed at
        name = m.group("name").lower()
        op = m.group("op").lower()
        out.append(f"{name} {op} {_canon_value(m.group('value'))}")
    return out


def normalise(predicate: str) -> tuple[str, list[str]]:
    """Return (normalised predicate, sorted conditions) with implied terms added.

    Implied terms are what make "Obligations of QSBs" in one circular and
    "Stock Brokers › Obligations of QSBs" in another resolve to ONE audience
    instead of two nodes with the rules split across them.
    """
    conditions = parse_conditions(predicate)
    implied: list[str] = []
    for cond in conditions:
        name, _, rest = cond.partition(" ")
        prop = _BY_NAME.get(name)
        if not prop or not prop.get("implies"):
            continue
        if rest.strip() != "== true":  # only a positive flag implies its host type
            continue
        for extra in prop["implies"]:
            implied.extend(parse_conditions(extra))
    merged = sorted(set(conditions) | set(implied))
    return " && ".join(merged), merged


def predicate_hash(predicate: str) -> str:
    normalised, _ = normalise(predicate)
    return hashlib.sha256(normalised.encode("utf-8")).hexdigest()


# ─────────────────────────────────────────────────────────────────────────────
# The AI call
# ─────────────────────────────────────────────────────────────────────────────
SYSTEM_PROMPT = """You read the opening of a financial-regulation circular and \
state WHO it applies to.

You are given the document title and its first few clauses. Return the list of \
regulated entity types the document governs, and a TEST over firm properties \
that selects exactly those firms.

RULES
- Use ONLY the property names given to you. Never invent a property.
- Join conditions with && . Use == != >= <= > < or `in` for a set.
- Prefer the narrowest test the text actually supports. "Master Circular for \
Stock Brokers" is category=='stock_broker' — not a list of every broker type.
- When a document governs many entity types, use `category in ['a','b',...]`.
- When it governs every entity a regulator registers ("all SEBI regulated \
entities", "REs"), use regulator=='sebi' (or 'rbi') rather than listing them.
- Do not add conditions the text does not state. An applicability floor that is \
too narrow silently hides rules from the firms that owe them.
- THE TITLE GOVERNS. A circular's addressee list names who it is ROUTED THROUGH, \
not who it binds: a circular addressed to "All Recognized Stock Exchanges / Stock \
Brokers through Recognized Stock Exchanges" is a circular for stock brokers, not \
for exchanges. Widen beyond the title only when the opening clauses actually \
state a wider scope.
"""

EMIT_AUDIENCE_TOOL = {
    "type": "function",
    "function": {
        "name": "emit_audience",
        "description": "Return the document's base applicability.",
        "parameters": {
            "type": "object",
            "properties": {
                "entities": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "entity types this document governs, in its own words",
                },
                "predicate": {
                    "type": "string",
                    "description": "the test, e.g. category=='stock_broker'",
                },
                "label": {"type": "string", "description": "short human name for the audience"},
                "confidence": {"type": "number"},
                "evidence": {
                    "type": "string",
                    "description": "the phrase in the text that states the applicability",
                },
            },
            "required": ["entities", "predicate", "label"],
        },
    },
}


def provider() -> str:
    if settings.llm_provider == "mock" or not settings.llm_api_key:
        return "mock"
    return settings.llm_provider


def _scope_text(title: str | None, clauses: list[str], limit: int = 10) -> str:
    head = "\n".join(c.strip() for c in clauses[:limit] if c and c.strip())
    return f"TITLE: {title or '(none)'}\n\nOPENING CLAUSES:\n{head}"


def _resolve_real(title: str | None, clauses: list[str]) -> dict[str, Any]:
    props = json.dumps(
        [{k: v for k, v in p.items() if k != "implies"} for p in FIRM_PROPERTIES]
    )
    user = f"{_scope_text(title, clauses)}\n\nAVAILABLE FIRM PROPERTIES:\n{props}"
    resp = _client().chat.completions.create(
        model=settings.llm_model_large,
        temperature=0,
        messages=[
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": user},
        ],
        tools=[EMIT_AUDIENCE_TOOL],
        tool_choice={"type": "function", "function": {"name": "emit_audience"}},
    )
    usage.record(settings.llm_model_large, getattr(resp, "usage", None))
    calls = resp.choices[0].message.tool_calls or []
    if not calls:
        return {}
    return json.loads(calls[0].function.arguments)


# ── mock resolver ────────────────────────────────────────────────────────────
# Transparent keyword mapping, confidence pinned low so nothing auto-approves.
# It exists so the pipeline is runnable and testable without an API key, not to
# be clever: every mapping below is a phrase that actually appears in the corpus.

_ENTITY_PHRASES: list[tuple[str, str]] = [
    (r"stock\s+broker", "stock_broker"),
    (r"\bqsb", "stock_broker"),
    # SEBI spells it "adviser"; circulars and headings both use "advisor" freely
    # ("Investment Advisors (IAs)/ Research Analysts (RAs)"), and missing the
    # variant made a two-entity heading look like a one-entity audience.
    (r"investment\s+advis[eo]r", "investment_adviser"),
    (r"research\s+analyst", "research_analyst"),
    (r"proxy\s+advis[eo]r", "investment_adviser"),
    (r"merchant\s+banker", "merchant_banker"),
    (r"portfolio\s+manager", "portfolio_manager"),
    (r"mutual\s+fund", "mutual_fund"),
    (r"asset\s+management\s+compan|\bamc", "amc"),
    (r"trustee\s+compan|board[s]?\s+of\s+trustees", "trustee_company"),
    (r"alternative\s+investment\s+fund|\baif\b", "aif"),
    (r"depositor(y|ies)\s+participant", "depository_participant"),
    (r"\bdepositor(y|ies)\b", "depository"),
    (r"stock\s+exchange", "stock_exchange"),
    (r"clearing\s+corporation", "clearing_corporation"),
    (r"custodian", "custodian"),
    (r"share\s+transfer\s+agent|registrar\s+to\s+an\s+issue|\brta\b", "rta"),
    (r"kyc\s+registration\s+agenc|\bkra\b", "kra"),
    (r"credit\s+rating\s+agenc", "credit_rating_agency"),
    (r"debenture\s+trustee", "debenture_trustee"),
    (r"venture\s+capital\s+fund", "venture_capital_fund"),
    (r"collective\s+investment\s+scheme", "collective_investment_scheme"),
    (r"commercial\s+bank|co-?operative\s+bank|payments?\s+bank|small\s+finance\s+bank",
     "bank"),
    (r"non-?banking\s+financial\s+compan|\bnbfc", "nbfc"),
]
_ALL_RE = re.compile(
    r"\bregulated\s+entit|\bREs\b|all\s+sebi\s+regulated", re.IGNORECASE
)
_RBI = re.compile(r"reserve\s+bank|\bRBI\b", re.IGNORECASE)
# Above this many distinct types, the document is addressing a regulator's whole
# universe and `regulator=='sebi'` is both truer and shorter than the list.
BROAD_ENTITY_COUNT = 8


def _scan(text: str) -> list[str]:
    found: list[str] = []
    for pattern, category in _ENTITY_PHRASES:
        if re.search(pattern, text, re.IGNORECASE) and category not in found:
            found.append(category)
    return found


def _resolve_mock(title: str | None, clauses: list[str]) -> dict[str, Any]:
    blob = _scope_text(title, clauses, limit=14)
    regulator = "rbi" if _RBI.search(blob) else "sebi"

    # THE TITLE WINS, and this is a correctness rule rather than a preference.
    #
    # A circular's addressee list names who it is ROUTED THROUGH, not who it
    # binds. The stock brokers master circular is addressed to "All Recognized
    # Stock Exchanges / Stock Brokers through Recognized Stock Exchanges", and
    # scanning that yields five entity types for a document governing one.
    # Measured over the corpus, scanning the whole opening got 5 of 8 documents
    # wrong — every one too BROAD, which puts duties on firms that do not owe
    # them. The title states what the document is about; that is why B2 exists.
    title_text = (title or "").strip()
    if title_text:
        if _ALL_RE.search(title_text):
            return _build(_scan(title_text), True, regulator, title)
        found = _scan(title_text)
        if found:
            return _build(found, False, regulator, title)

    # Nothing named in the title (older circulars, RBI directions): fall back to
    # the addressee list and opening clauses, where breadth is the signal.
    found = _scan(blob)
    broad = bool(_ALL_RE.search(blob)) or len(found) >= BROAD_ENTITY_COUNT
    return _build(found, broad, regulator, title)


def _build(
    found: list[str], broad: bool, regulator: str, title: str | None
) -> dict[str, Any]:
    """Turn a scan result into a predicate. Shared by both passes above."""
    if broad:
        predicate = f"regulator=='{regulator}'"
        label = f"All {regulator.upper()} regulated entities"
        entities = found or ["regulated entities"]
    elif len(found) == 1:
        predicate = f"category=='{found[0]}'"
        label = found[0].replace("_", " ").title()
        entities = found
    elif found:
        members = ", ".join(f"'{c}'" for c in sorted(found))
        predicate = f"category in [{members}]"
        label = " / ".join(c.replace("_", " ").title() for c in sorted(found))
        entities = found
    else:
        # No entity type named. Say so rather than guessing a floor — a wrong
        # floor hides rules from the firms that owe them.
        return {
            "entities": [],
            "predicate": "",
            "label": "",
            "confidence": 0.0,
            "evidence": "",
            "provider": "mock",
        }

    return {
        "entities": entities,
        "predicate": predicate,
        "label": label,
        "confidence": 0.35,  # mock: always below any auto-approve threshold
        "evidence": (title or "")[:160],
        "provider": "mock",
    }


def resolve_document_audience(
    title: str | None, clauses: list[str]
) -> dict[str, Any]:
    """Pattern C. Returns the raw AI answer plus the deterministic derivation.

    Normalisation and hashing happen HERE, in one place, so the backend ladder
    and the host-side harness can never disagree about what a predicate means.
    """
    raw = (
        _resolve_mock(title, clauses)
        if provider() == "mock"
        else {**_resolve_real(title, clauses), "provider": provider()}
    )
    predicate = (raw.get("predicate") or "").strip()
    if not predicate:
        return {**raw, "predicate": "", "normalised": "", "conditions": [],
                "predicate_hash": None, "resolved": False}

    normalised, conditions = normalise(predicate)
    if not conditions:
        # The model returned something that is not a test. Better to fail loudly
        # than to file every rule in the document under an unparseable audience.
        return {**raw, "normalised": "", "conditions": [], "predicate_hash": None,
                "resolved": False, "error": "predicate did not parse"}

    unknown = [c.split(" ")[0] for c in conditions if c.split(" ")[0] not in _BY_NAME]
    if unknown:
        return {**raw, "normalised": normalised, "conditions": conditions,
                "predicate_hash": None, "resolved": False,
                "error": f"unknown properties: {sorted(set(unknown))}"}

    return {
        **raw,
        "normalised": normalised,
        "conditions": conditions,
        "predicate_hash": hashlib.sha256(normalised.encode("utf-8")).hexdigest(),
        "resolved": True,
    }


# ─────────────────────────────────────────────────────────────────────────────
# Rung 4 — logical implication
#
# Only possible because audiences are stored as TESTS rather than names. For the
# common shape (conditions joined by AND), A implies B when every condition in B
# is satisfied by A. Numeric comparisons use interval containment, so
# `active_clients > 50000` implies `active_clients > 10000`.
# ─────────────────────────────────────────────────────────────────────────────
_NUMERIC_OPS = {">", ">=", "<", "<="}


def _split(cond: str) -> tuple[str, str, str]:
    name, op, value = cond.split(" ", 2)
    return name, op, value


def _condition_implies(a: str, b: str) -> bool:
    """Does condition `a` guarantee condition `b`?"""
    if a == b:
        return True
    an, ao, av = _split(a)
    bn, bo, bv = _split(b)
    if an != bn:
        return False

    # membership: a single value implies the set that contains it
    if bo == "in" and ao == "==":
        return av in [m.strip() for m in bv.strip("[]").split(",")]
    if bo == "in" and ao == "in":
        av_set = {m.strip() for m in av.strip("[]").split(",")}
        bv_set = {m.strip() for m in bv.strip("[]").split(",")}
        return av_set.issubset(bv_set)

    if ao in _NUMERIC_OPS and bo in _NUMERIC_OPS:
        try:
            an_v, bn_v = float(av), float(bv)
        except ValueError:
            return False
        if ao in (">", ">=") and bo in (">", ">="):
            return an_v > bn_v or (an_v == bn_v and (ao == bo or ao == ">"))
        if ao in ("<", "<=") and bo in ("<", "<="):
            return an_v < bn_v or (an_v == bn_v and (ao == bo or ao == "<"))
    return False


def implies(a_conditions: list[str], b_conditions: list[str]) -> bool:
    """Every firm matching A also matches B."""
    if not b_conditions:
        return True  # the empty test selects everyone
    if not a_conditions:
        return False
    return all(
        any(_condition_implies(a, b) for a in a_conditions) for b in b_conditions
    )


def compare(a_conditions: list[str], b_conditions: list[str]) -> str:
    """Rung 4's four computed outcomes."""
    ab = implies(a_conditions, b_conditions)
    ba = implies(b_conditions, a_conditions)
    if ab and ba:
        return "identical"
    if ab:
        return "narrower"   # A is a subset of B → nest A under B
    if ba:
        return "broader"    # A contains B → A becomes B's parent
    return "unrelated"


# ─────────────────────────────────────────────────────────────────────────────
# Step 10b — Pattern A: chapter scoping
#
# Pattern C gives every clause a floor. Pattern A NARROWS it where a document
# scopes by chapter:
#
#     18.    Enhanced obligations and responsibilities on Qualified Stock Brokers
#       18.5   Enhanced obligations and responsibilities for QSBs:
#         18.5.1  ...rule...
#
# One heading scopes ~200 clauses by inheritance, which is what makes the step
# cheap: resolving the heading resolves everything beneath it for free.
#
# ⚠️ The cheap phrase gate was designed, measured and DELETED (decision 63). It
# scored 0 of 148 and 0 of 64 headings on the two large documents, because it
# was written against an invented example heading that appears nowhere in the
# corpus. And the asymmetry ran the wrong way: a false positive costs one AI
# call that answers "no, it's a topic"; a false negative means a section
# silently inherits the wrong audience and EVERY rule beneath it is misfiled.
# So every heading is sent.
# ─────────────────────────────────────────────────────────────────────────────

HEADING_SYSTEM_PROMPT = """You classify headings from Indian securities-market circulars.

Your ONLY job: decide whether this heading names a TYPE OF FIRM, and if so, \
express it as a test that can be run against a firm's profile.

WHAT COUNTS AS A TYPE OF FIRM (an audience):
  "Obligations of Qualified Stock Brokers"          -> yes, a kind of firm
  "Provisions applicable to clearing members"       -> yes
  "Brokers offering algorithmic trading to clients" -> yes

WHAT DOES NOT COUNT (a topic):
  "Cyber security and cyber resilience"             -> subject matter
  "Audit requirements"                              -> subject matter
  "Algorithmic trading"                             -> subject matter
  "Definitions"                                     -> subject matter

The distinction is WHO vs WHAT. "Algorithmic trading" is a subject. "Brokers \
offering algorithmic trading" is a group of firms. Words alone will not tell \
you - read what the section is addressing.

RULES FOR THE TEST:
- Use ONLY the properties listed in AVAILABLE PROPERTIES.
- Report ONLY the condition THIS heading adds. Do not repeat the parent's \
conditions - they are applied automatically.
- If nothing in the list can express it, name the property you would need under \
`new_property`. This is a last resort; check the list carefully first.
- If this heading steps OUT of its parent rather than narrowing it (a section on \
"all intermediaries" inside a chapter on QSBs), set `relation` to "independent".
"""

EMIT_HEADING_TOOL = {
    "type": "function",
    "function": {
        "name": "emit_heading_audience",
        "description": "Classify one heading as an audience or a topic.",
        "parameters": {
            "type": "object",
            "properties": {
                "is_audience": {"type": "boolean"},
                "label": {"type": "string", "description": "short human name"},
                "condition": {
                    "type": "string",
                    "description": "ONLY the condition this heading adds, e.g. is_qsb==true",
                },
                "relation": {"type": "string", "enum": ["narrows", "independent"]},
                "new_property": {"type": "string"},
                "confidence": {"type": "number"},
                "why": {"type": "string"},
            },
            "required": ["is_audience", "confidence"],
        },
    },
}


def _heading_user_prompt(
    heading: str, ancestry: list[str], opening: str, parent_predicate: str | None
) -> str:
    trail = "\n".join(
        f"{'  ' * i}{'|- ' if i else ''}{h}" for i, h in enumerate([*ancestry, heading])
    )
    props = json.dumps(
        [{k: v for k, v in p.items() if k != "implies"} for p in FIRM_PROPERTIES]
    )
    return (
        f"HEADING\n  {heading}\n\n"
        f"WHERE IT SITS\n{trail}\n\n"
        f"OPENING LINES OF THIS SECTION\n  {(opening or '(none)')[:900]}\n\n"
        f"PARENT AUDIENCE (already applied - do not restate)\n"
        f"  {parent_predicate or '(none)'}\n\n"
        f"AVAILABLE PROPERTIES\n{props}"
    )


def _classify_real(
    heading: str, ancestry: list[str], opening: str, parent_predicate: str | None
) -> dict[str, Any]:
    resp = _client().chat.completions.create(
        # The SMALL model. One heading is a short WHO-or-WHAT judgement against a
        # fixed property list, and there are 365 of them on the master circular
        # against one Pattern C call -- so this is where the heading budget goes.
        # Pattern C, which every clause in the document inherits from, stays on
        # the large model.
        model=settings.llm_model_small,
        temperature=0,
        messages=[
            {"role": "system", "content": HEADING_SYSTEM_PROMPT},
            {
                "role": "user",
                "content": _heading_user_prompt(heading, ancestry, opening, parent_predicate),
            },
        ],
        tools=[EMIT_HEADING_TOOL],
        tool_choice={"type": "function", "function": {"name": "emit_heading_audience"}},
    )
    usage.record(settings.llm_model_small, getattr(resp, "usage", None))
    calls = resp.choices[0].message.tool_calls or []
    return json.loads(calls[0].function.arguments) if calls else {}


# ── mock classifier ──────────────────────────────────────────────────────────
#
# Phrase -> property, for the properties a HEADING can plausibly assert. Every
# phrase below occurs in the corpus; the mock exists so the pipeline is runnable
# and testable without an API key, and its confidence is pinned low so nothing
# it produces can auto-approve.
_HEADING_PROPERTIES: list[tuple[str, str]] = [
    (r"qualified\s+stock\s+broker|\bQSBs?\b", "is_qsb == true"),
    (r"clearing\s+member", "is_clearing_member == true"),
    (r"internet[-\s]based\s+trading|internet\s+trading|\bIBT\b", "provides_internet_trading == true"),
    (r"client\s+(?:funds?|monies|money|securities)", "holds_client_funds == true"),
    (r"\bcloud\b", "uses_cloud_services == true"),
    (r"outsourc", "outsources_it == true"),
    (r"listed\s+(?:compan|entit)", "is_listed == true"),
    (r"market\s+infrastructure\s+institution|\bMIIs?\b", "is_mii == true"),
]

# A heading that names a topic, however many firm words it contains. These are
# the WHAT side of the WHO/WHAT split, and they are checked FIRST: "Cyber
# security for Stock Brokers" is a topic within an audience, not a new one.
_TOPIC_HEADING = re.compile(
    r"^\s*(?:definitions?|interpretation|background|introduction|objectives?|"
    r"scope|applicability|abbreviations?|glossar|annexure|appendix|schedule|"
    r"chapter|part|index|contents?|preamble|repeal|rescission|"
    r"effective\s+date|commencement)\b",
    re.IGNORECASE,
)
# A heading that is really a sentence fragment carried over from the body. The
# segmenter produces these, and they are not headings at all.
_FRAGMENT = re.compile(
    r"^\s*(?:notwithstanding|provided|in\s+terms\s+of|as\s+per|however|it\s+is|"
    r"the\s+said|accordingly|further|pursuant)\b",
    re.IGNORECASE,
)


def _classify_mock(
    heading: str, ancestry: list[str], opening: str, parent_predicate: str | None
) -> dict[str, Any]:
    text = re.sub(r"\s+", " ", heading or "").strip()
    if not text or _TOPIC_HEADING.match(text) or _FRAGMENT.match(text):
        return {"is_audience": False, "confidence": 0.3, "why": "topic or fragment"}

    # A property flag beats a category name. "Enhanced obligations ... on
    # Qualified Stock Brokers" contains "stock broker" too, and taking the
    # category would produce an audience identical to the document floor —
    # losing the narrowing that is the whole point of Pattern A.
    for pattern, condition in _HEADING_PROPERTIES:
        if re.search(pattern, text, re.IGNORECASE):
            return {
                "is_audience": True,
                "label": text[:80],
                "condition": condition,
                "relation": "narrows",
                "confidence": 0.35,
                "why": f"heading names firms by {condition.split(' ')[0]}",
                "provider": "mock",
            }

    found = _scan(text)
    if len(found) == 1:
        return {
            "is_audience": True,
            "label": text[:80],
            "condition": f"category == '{found[0]}'",
            "relation": "narrows",
            "confidence": 0.35,
            "why": f"heading names {found[0]}",
            "provider": "mock",
        }
    # Several entity types in one heading is almost always a routing list or a
    # sentence, not a chapter scope. Left to the review queue rather than guessed.
    return {"is_audience": False, "confidence": 0.3, "why": "no single firm type named"}


# ── composition ──────────────────────────────────────────────────────────────

def compose(parent_conditions: list[str], added: str, relation: str) -> dict[str, Any]:
    """Parent + the condition this heading adds -> the full test.

    **The composition is ours, not the AI's.** The model makes one small
    judgement — what does this heading add — and the arithmetic of inheritance
    happens here in code, where it cannot drift.

    A conflict (the same property forced to two different values) means the
    heading did NOT narrow its parent. That is refused rather than filed: a
    contradictory audience matches no firm at all, so every rule beneath it
    would be addressed to nobody — and Step 17 would report it as a dead rule
    long after the damage was done.
    """
    own = parse_conditions(added)
    if not own:
        return {"ok": False, "error": "the added condition did not parse"}

    parent = list(parent_conditions) if relation != "independent" else []
    by_prop: dict[str, str] = {}
    for cond in [*parent, *own]:
        name, _, rest = cond.partition(" ")
        op, _, value = rest.partition(" ")
        if op != "==":
            continue
        if name in by_prop and by_prop[name] != value:
            return {
                "ok": False,
                "error": (
                    f"'{name}' cannot be both {by_prop[name]} and {value} - this heading "
                    f"does not narrow its parent, it contradicts it"
                ),
            }
        by_prop[name] = value

    normalised, conditions = normalise(" && ".join([*parent, *own]))
    unknown = [c.split(" ")[0] for c in conditions if c.split(" ")[0] not in _BY_NAME]
    if unknown:
        return {"ok": False, "error": f"unknown properties: {sorted(set(unknown))}"}
    return {
        "ok": True,
        "normalised": normalised,
        "conditions": conditions,
        "predicate_hash": hashlib.sha256(normalised.encode("utf-8")).hexdigest(),
    }


def classify_heading(
    heading: str,
    ancestry: list[str] | None = None,
    opening: str = "",
    parent_predicate: str | None = None,
    parent_conditions: list[str] | None = None,
) -> dict[str, Any]:
    """Classify one heading, and compose the full test if it is an audience."""
    ancestry = ancestry or []
    raw = (
        _classify_mock(heading, ancestry, opening, parent_predicate)
        if provider() == "mock"
        else {
            **_classify_real(heading, ancestry, opening, parent_predicate),
            "provider": provider(),
        }
    )
    if not raw.get("is_audience") or not (raw.get("condition") or "").strip():
        return {
            **raw,
            "heading": heading,
            "is_audience": False,
            "resolved": False,
            "normalised": "",
            "conditions": [],
            "predicate_hash": None,
        }

    composed = compose(
        parent_conditions or [], raw["condition"], raw.get("relation") or "narrows"
    )
    if not composed.get("ok"):
        return {
            **raw,
            "heading": heading,
            "resolved": False,
            "normalised": "",
            "conditions": [],
            "predicate_hash": None,
            "error": composed.get("error"),
        }
    return {
        **raw,
        "heading": heading,
        "resolved": True,
        "normalised": composed["normalised"],
        "conditions": composed["conditions"],
        "predicate_hash": composed["predicate_hash"],
    }
