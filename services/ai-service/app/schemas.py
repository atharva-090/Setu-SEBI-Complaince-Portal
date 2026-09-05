"""Pydantic contracts for the AI-service endpoints (consumed by the backend)."""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel


class CitationOut(BaseModel):
    """One reference string found in a clause (Step 16 extraction). Nothing here
    is resolved — `target_type` says only whether an edge is even possible."""
    raw: str
    cue: str
    number: str
    kind: str  # definitional | exemption | amends | supersedes | trigger | reference
    target_type: str  # internal | statute | annexure
    target_container: str | None = None
    target_doc: str | None = None
    range_to: str | None = None
    char_start: int = 0
    char_end: int = 0
    context: str = ""


class ClauseOut(BaseModel):
    idx: int
    kind: str  # container | clause | preamble | toc
    clause_no: str | None
    heading: str | None
    parent_idx: int | None
    page: int
    depth: int
    char_start: int
    char_end: int
    text: str
    is_leaf: bool
    normative: bool  # keyword signal (UI/ordering tag) — not the send gate
    junk: bool  # provable junk → not sent to the drafter
    is_title: bool = False  # carries the document's subject line
    title_text: str | None = None  # the subject line — Pattern C's input
    path: str
    window_text: str | None  # set for every clause we send (i.e. not junk)
    citations: list[CitationOut] = []  # Step 16 — parked here, resolved after filing


class ValidationOut(BaseModel):
    """Step 11d. Three deterministic lanes; lane 3 may refer to a verifier.

    `verdict` is only set when the tripwire fired and the verifier was asked."""
    type_ok: bool = True
    type_problems: list[str] = []
    numbers_ok: bool = True
    unexplained: list[float] = []
    pool: list[float] = []
    complaint: str | None = None
    verdict: str | None = None  # justified | wrong | cannot_tell
    explanation: str | None = None
    corrected: bool = False


class ComposeRequest(BaseModel):
    """Step 12 needs the SAME normalisation Step 10 uses, or a modifier-narrowed
    audience and a heading-narrowed one describing the same set of firms would
    hash differently and split the rules across two nodes."""
    parent_conditions: list[str] = []
    added: str
    relation: str = "narrows"


class ComposeResponse(BaseModel):
    ok: bool
    normalised: str = ""
    conditions: list[str] = []
    predicate_hash: str | None = None
    error: str | None = None


class ModifierOut(BaseModel):
    """Step 12's input: what this clause changes about ANOTHER clause.

    `condition_kind` is the load-bearing field. Measured on the SEBI corpus,
    roughly two of thirty-four real modifiers narrow by a property of the FIRM;
    the rest narrow by transaction, instrument, scheme or client type. Only the
    first kind may touch a rule's audience."""
    targets: str
    effect: str  # restrict_scope | exempt | extend_scope | override_value
    condition_kind: str  # firm | scope
    condition: str | None = None
    scope_note: str | None = None
    value: str | None = None
    confidence: float = 0.0
    raw: str = ""


class HeadingIn(BaseModel):
    """One heading to classify (Step 10b). `parent_conditions` is the audience
    already in force where it sits — the composition happens in code, so the
    caller supplies it rather than the model restating it."""
    idx: int
    heading: str
    ancestry: list[str] = []
    opening: str = ""
    parent_predicate: str | None = None
    parent_conditions: list[str] = []


class HeadingAudienceRequest(BaseModel):
    doc_id: str
    headings: list[HeadingIn]


class HeadingAudienceOut(BaseModel):
    idx: int
    heading: str
    is_audience: bool
    resolved: bool
    label: str | None = None
    condition: str | None = None
    relation: str | None = None
    normalised: str = ""
    conditions: list[str] = []
    predicate_hash: str | None = None
    confidence: float = 0.0
    why: str | None = None
    new_property: str | None = None
    error: str | None = None


class HeadingAudienceResponse(BaseModel):
    doc_id: str
    provider: str
    results: list[HeadingAudienceOut]


class AudienceRequest(BaseModel):
    """Step 10a input: the document title and its opening clauses."""
    doc_id: str
    title: str | None = None
    clauses: list[str] = []


class AudienceResponse(BaseModel):
    """The AI's answer plus the deterministic derivation the ladder needs."""
    doc_id: str
    resolved: bool
    entities: list[str] = []
    predicate: str = ""
    normalised: str = ""
    conditions: list[str] = []
    predicate_hash: str | None = None
    label: str = ""
    confidence: float = 0.0
    evidence: str = ""
    provider: str = "mock"
    error: str | None = None


class FingerprintItem(BaseModel):
    """One rule to fingerprint. `attribute_ids` maps a canonical ref name
    ("Cyber.last_audit_date") to its registry id."""

    key: str
    expression: str
    audience_id: int | None = None
    attribute_ids: dict[str, int] = {}
    obligation_text: str | None = None


class FingerprintRequest(BaseModel):
    items: list[FingerprintItem]


class FingerprintOut(BaseModel):
    key: str
    structural: bool
    valid: bool
    identity_hash: str
    full_hash: str
    identity_core: str
    canonical_expression: str | None = None
    attribute_ids: list[int] = []
    literals: list[object] = []
    hash_inputs: dict = {}
    error: str | None = None


class FingerprintResponse(BaseModel):
    results: list[FingerprintOut]


class ParsePdfResponse(BaseModel):
    doc_id: str
    pages: int
    clauses: list[ClauseOut]
    stats: dict[str, int]
    audit: dict[str, Any] = {}  # numbering-audit report (gaps, repairs, flags)


class ExtractWindow(BaseModel):
    idx: int
    clause_no: str | None = None
    page: int = 0
    char_start: int = 0
    char_end: int = 0
    window_text: str


class ExtractRequest(BaseModel):
    doc_id: str
    windows: list[ExtractWindow]


class RuleOut(BaseModel):
    title: str
    rule_expression: str
    result_pass: str = "Compliant"
    result_fail: str = "Non-Compliant"
    attribute_hints: dict[str, Any] = {}
    obligation_type: str = "computable"
    context: str = ""
    source_clause: str = ""
    confidence: float = 0.5
    ast: dict[str, Any]

    # Step 11's designed outputs, unbuilt until D4.
    precondition: str | None = None  # "where the broker holds client funds..."
    inferred: list[str] = []  # what the model supplied that the clause did not state
    validation: ValidationOut | None = None

class WindowResult(BaseModel):
    idx: int
    clause_no: str | None
    rules: list[RuleOut] = []
    error: str | None = None
    modifiers: list[ModifierOut] = []  # Step 12's input


class ExtractResponse(BaseModel):
    doc_id: str
    drafter: str  # "openai" | "mock" | …
    model: str
    results: list[WindowResult]


class EmbedRequest(BaseModel):
    texts: list[str]


class EmbedResponse(BaseModel):
    embeddings: list[list[float]]
    model: str
    mock: bool


# ── M3 attribute judge ────────────────────────────────────────────────────────


class JudgeToken(BaseModel):
    name: str
    meaning: str = ""
    topic: str = ""


class JudgeCandidate(BaseModel):
    id: int
    name: str
    category: str = ""
    description: str = ""


class JudgeAttributeRequest(BaseModel):
    token: JudgeToken
    candidates: list[JudgeCandidate] = []


class JudgeAttributeResponse(BaseModel):
    match_index: int  # index into candidates, -1 = none → create new
    same: bool
    reason: str
    confidence: float
    judge: str  # "openai" | "mock" | …
