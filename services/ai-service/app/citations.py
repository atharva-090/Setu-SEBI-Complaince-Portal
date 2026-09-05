"""Step 16 — citation EXTRACTION.

Step 9 builds windows; while it does, every *"para 9.5.3.1"* mention in the text is
worth recording, because by the time rules exist (Step 15) the wording that produced
them has been rewritten and the reference strings are gone. So they are pulled out
here, in the parser, and parked. Resolution — turning a parked string into an edge
between two RULES — happens in the backend, after filing, because rules do not exist
until then.

**Extraction is not resolution, and this file does only the first.** It never decides
which clause a citation points at; it records what the text said, what kind of link the
sentence implies, and whether the target is even inside this corpus.

What the corpus actually contains (measured by tools/citation_check.py over the seven
SEBI documents, tiers 1-2 — 1,067 references in all):

    statute             459    "Regulation 7(1) of the SEBI (IA) Regulations, 2013"
    annexure / form     198    points at a template, not a rule
    internal            410    of which:
        unique          206      the number matches exactly one citable clause
        by scope         15      ambiguous document-wide, unique inside the citing
                                 clause's own subtree
        ambiguous        53      Decision 66 again: "1" appears 152x in CSCRF
        absent          136      cites a paragraph this document does not contain

**Only 21% of references resolve to a clause we hold.** That is the single most
important number here: an extractor that assumed every reference names a paragraph of
this circular would be wrong about four references in five, and would manufacture an
edge for every one of them. Statute and annexure targets are kept as provenance and
produce no edge, ever.

The 136 `absent` are worth naming honestly: they are mostly clauses the SEGMENTER did
not produce, not citations the extractor misread. A citation to a paragraph we failed
to split out is unresolvable, and the answer is to park it — a later re-ingest may
produce that clause — not to guess at the nearest number.

Five kinds are distinguished, and only ONE of them survives to become a `depends_on`
edge — the other four are consumed by earlier steps:

    definitional   Step 9   inlined into the window
    exemption      Step 12  becomes a modifier
    amends         Step 15  drives the filing verdict
    supersedes     Step 15  the repeal verdict
    trigger        Step 16  "where unable to comply with para X" -> depends_on

Classification reads the sentence AROUND the reference, not the reference itself, and
is deliberately conservative: an unrecognised lead-in is `reference`, which is inert.
Misreading a plain cross-reference as an `amends` would let Step 15 file an amendment
against a rule SEBI never touched, so the default has to be the harmless one.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

# ── the reference itself ────────────────────────────────────────────────────

# Cues that point INSIDE a document. `regulation` and `section` are deliberately
# absent: in SEBI circulars they name statute, not this circular's own paragraphs.
_INTERNAL_CUE = r"para(?:graph)?s?|clauses?|sub[-\s]?clauses?|points?|items?"
# Cues that name a statute or a template. Both are recorded, neither becomes an edge.
_STATUTE_CUE = r"regulations?|sections?|rules?|articles?"
_ANNEX_CUE = r"annexures?|schedules?|appendix|appendices|forms?|tables?"

_CUE = rf"(?:{_INTERNAL_CUE}|{_STATUTE_CUE}|{_ANNEX_CUE})"

# "9", "9.5.3.1", "1A.1.3.D", "4.4.3.5 (iii)", "II", "A".
# Roman numerals and bare capitals are accepted only because SEBI uses them for
# real paragraph numbers ("clause I", "para C"); they resolve badly and the
# resolver treats them accordingly.
_NUM = r"\d+[A-Z]?(?:\.\d+[A-Z]?)*(?:\s*\([a-z0-9ivxIVX]+\))*|[IVX]{1,4}\b|[A-Z]\b"

_REF = re.compile(rf"\b({_CUE})\.?\s+(?:nos?\.?\s*)?({_NUM})", re.IGNORECASE)

# "paras 55.13 to 55.49", "para 63.3.1, 63.3.2 and 63.3.3" — SEBI writes the cue
# ONCE and then lists. Without this the second and later numbers are invisible:
# 96 of 1,085 references in the SEBI corpus (~9%) are continuations, and the
# clause a "to" range ends at is exactly the sort of thing an auditor checks.
#
# Only the word separators are accepted. A bare hyphen is deliberately excluded —
# "9.5-2024" and "Regulation 9-11" would both match it and neither is a list.
_CONTINUATION = re.compile(r"\s*(?:,\s*(?:and\s+)?|and\s+|&\s*|to\s+)(\d+[A-Z]?(?:\.\d+[A-Z]?)*)", re.IGNORECASE)
_RANGE_SEP = re.compile(r"^\s*to\s", re.IGNORECASE)

# "... of the SEBI (Intermediaries) Regulations, 2008" / "... of the SEBI Act, 1992".
# Anchored to what FOLLOWS the number, so it only fires on an explicit statute name.
_OF_STATUTE = re.compile(
    r"^\s*(?:,\s*)?of\s+(?:the\s+)?(?P<name>[A-Z][\w&.'\-]*(?:\s+[\w&.'()\-]+){0,7}?"
    r"\s+(?:Regulations?|Act|Rules|Guidelines|Bye[-\s]?laws))",
    re.IGNORECASE,
)
# "... of Annexure A" / "... of Chapter 5" — an EXPLICIT container for the target.
_OF_CONTAINER = re.compile(
    rf"^\s*(?:,\s*)?of\s+(?:the\s+)?((?:{_ANNEX_CUE}|chapters?|parts?)\s+[A-Z0-9][\w.\-]*)",
    re.IGNORECASE,
)
# "Annexure A, para 3" — the container stated BEFORE the reference.
_CONTAINER_BEFORE = re.compile(
    rf"((?:{_ANNEX_CUE}|chapters?|parts?)\s+[A-Z0-9][\w.\-]*)\s*[,-]?\s*$",
    re.IGNORECASE,
)

# ── what kind of link the sentence implies ──────────────────────────────────
#
# Ordered: the first match wins, so the specific phrases sit above the generic
# ones. Every pattern is checked against a window of the sentence around the
# reference, lower-cased and whitespace-collapsed.
_KINDS: list[tuple[str, re.Pattern[str]]] = [
    (
        "supersedes",
        re.compile(
            r"stands?\s+withdrawn|hereby\s+withdrawn|stands?\s+repealed|rescind|"
            r"supersed|shall\s+cease\s+to\s+(?:be\s+in\s+force|apply)|"
            r"stands?\s+deleted|is\s+hereby\s+deleted"
        ),
    ),
    (
        "amends",
        re.compile(
            r"partial\s+modification|partially\s+modif|is\s+(?:hereby\s+)?(?:amended|"
            r"substituted|modified|revised|replaced)|shall\s+be\s+(?:amended|substituted|"
            r"modified|replaced|read\s+as)|stands?\s+(?:amended|substituted|modified)|"
            r"has\s+been\s+amended|prior\s+to\s+substitution|read\s+as\s+under"
        ),
    ),
    (
        "definitional",
        re.compile(
            r"meaning\s+(?:assigned|ascribed)|as\s+defined\s+in|defined\s+under|"
            r"shall\s+have\s+the\s+(?:same\s+)?meaning"
        ),
    ),
    (
        "exemption",
        re.compile(
            r"nothing\s+(?:contained\s+)?in|shall\s+not\s+apply|exempt(?:ed|ion)?\s+from|"
            r"notwithstanding\s+anything|save\s+as\s+(?:otherwise\s+)?provided"
        ),
    ),
    (
        "trigger",
        re.compile(
            r"unable\s+to\s+compl|not\s+(?:able|in\s+a\s+position)\s+to\s+compl|"
            r"fails?\s+to\s+(?:meet|compl|satisf|adhere|maintain)|"
            r"failure\s+to\s+(?:meet|compl|satisf)|"
            r"(?:in\s+)?(?:the\s+)?event\s+of\s+(?:any\s+)?(?:non[-\s]?compliance|breach|default)|"
            r"non[-\s]?compliance\s+with|in\s+case\s+(?:of\s+)?(?:non[-\s]?compliance|the\s+\w+\s+fails)|"
            r"only\s+(?:if|where|after)|subject\s+to\s+(?:compliance\s+with|fulfil)|"
            r"upon\s+(?:satisfying|meeting|complying)"
        ),
    ),
]

#: How much text either side of the reference the classifier reads. A SEBI
#: sentence carrying a lead-in like "where a Regulated Entity is unable to comply
#: with" routinely runs 100+ characters before the number, so a tighter window
#: silently reclassifies triggers as plain references.
CONTEXT_BEFORE = 160
CONTEXT_AFTER = 90


@dataclass
class Citation:
    """One reference string, as found. Nothing here is resolved."""

    raw: str
    """Exactly what the text said — an auditor sees this, not our parse of it."""
    cue: str
    number: str
    kind: str
    """definitional | exemption | amends | supersedes | trigger | reference"""
    target_type: str
    """internal | statute | annexure — only `internal` can become an edge."""
    target_container: str | None = None
    """Stated explicitly ("para 3 of Annexure A"). Usually None; the resolver then
    scopes by the CITING clause's own ancestry instead."""
    target_doc: str | None = None
    """A named external document: the statute, or another circular by number."""
    range_to: str | None = None
    """Set on the first number of "paras 55.13 to 55.49". The range is NOT expanded:
    37 edges from one sentence is over-linking, and the endpoints are what the text
    actually names."""
    char_start: int = 0
    char_end: int = 0
    context: str = ""

    def to_dict(self) -> dict:
        return {
            "raw": self.raw,
            "cue": self.cue,
            "number": self.number,
            "kind": self.kind,
            "target_type": self.target_type,
            "target_container": self.target_container,
            "target_doc": self.target_doc,
            "range_to": self.range_to,
            "char_start": self.char_start,
            "char_end": self.char_end,
            "context": self.context,
        }


# A circular referring to another circular by its SEBI number. Recorded as the
# target document so the retry sweep (16b) can match it when that circular lands.
_CIRCULAR_NO = re.compile(
    r"(?:SEBI[/\s][\w/.\-]{6,}|CIR[/\s][\w/.\-]{4,})",
    re.IGNORECASE,
)


def _classify(context: str) -> str:
    low = re.sub(r"\s+", " ", context).lower()
    for kind, pattern in _KINDS:
        if pattern.search(low):
            return kind
    return "reference"


def _target_type(cue: str, tail: str) -> str:
    c = cue.lower().rstrip("s.")
    if re.fullmatch(rf"(?:{_ANNEX_CUE})", cue, re.IGNORECASE):
        return "annexure"
    if re.fullmatch(rf"(?:{_STATUTE_CUE})", cue, re.IGNORECASE):
        return "statute"
    # An internal cue can still name a statute: "clause 4 of the SEBI Act".
    if _OF_STATUTE.match(tail):
        return "statute"
    return "internal"


def extract(text: str, *, offset: int = 0) -> list[Citation]:
    """Every reference string in one clause's text.

    `offset` is added to the character positions so a citation can be located in
    the whole document, not just this clause — the span an auditor is shown.
    """
    if not text:
        return []
    out: list[Citation] = []
    # "para 3 of Annexure B" is ONE citation, scoped to Annexure B — not a
    # paragraph reference plus an annexure reference. Once a container has been
    # read as part of a reference, the text it occupies is consumed.
    consumed_to = 0
    for m in _REF.finditer(text):
        if m.start() < consumed_to:
            continue
        cue, number = m.group(1), re.sub(r"\s+", "", m.group(2)).strip(".")
        if not number:
            continue
        head = text[max(0, m.start() - CONTEXT_BEFORE) : m.start()]
        tail = text[m.end() : m.end() + CONTEXT_AFTER]
        target_type = _target_type(cue, tail)

        target_doc = None
        container = None
        if target_type == "statute":
            statute = _OF_STATUTE.match(tail)
            target_doc = _norm(statute.group("name")) if statute else None
        else:
            after = _OF_CONTAINER.match(tail)
            explicit = after or _CONTAINER_BEFORE.search(head)
            if explicit:
                container = _norm(explicit.group(1))
            if after:
                consumed_to = m.end() + after.end()
            cited_circular = _CIRCULAR_NO.search(tail[:60]) or _CIRCULAR_NO.search(head[-80:])
            if cited_circular:
                target_doc = cited_circular.group(0).rstrip(" ,.")

        context = _norm(head + m.group(0) + tail)
        kind = _classify(context)

        # The listed numbers after the cue, if any. They share the sentence, so
        # they share its kind and its classification — only the number differs.
        numbers: list[tuple[str, int, int, str | None]] = []
        pos = m.end()
        first_range_to: str | None = None
        while True:
            cont = _CONTINUATION.match(text, pos)
            if not cont:
                break
            more = re.sub(r"\s+", "", cont.group(1)).strip(".")
            if _RANGE_SEP.match(text[pos : cont.start(1)]) and not numbers:
                first_range_to = more
            numbers.append((more, cont.start(1), cont.end(1), None))
            pos = cont.end()

        out.append(
            Citation(
                raw=text[m.start() : pos],
                cue=cue.lower(),
                number=number,
                kind=kind,
                target_type=target_type,
                target_container=container,
                target_doc=target_doc,
                range_to=first_range_to,
                char_start=offset + m.start(),
                char_end=offset + m.end(),
                context=context[:240],
            )
        )
        for more, start, end, _ in numbers:
            if more == first_range_to:
                continue  # already carried as the range endpoint
            out.append(
                Citation(
                    raw=more,
                    cue=cue.lower(),
                    number=more,
                    kind=kind,
                    target_type=target_type,
                    target_container=container,
                    target_doc=target_doc,
                    char_start=offset + start,
                    char_end=offset + end,
                    context=context[:240],
                )
            )
    return out


def _norm(s: str) -> str:
    return re.sub(r"\s+", " ", s).strip(" ,.;:")


def extract_all(clauses: list) -> dict[int, list[Citation]]:
    """Run `extract` over a clause tree, keyed by clause idx.

    Only clauses the pipeline would actually send are scanned: a citation inside
    provable junk (a page header, a table fragment) has no rule to hang off, and
    scanning them adds noise the resolver then has to reject.
    """
    found: dict[int, list[Citation]] = {}
    for c in clauses:
        if getattr(c, "junk", False):
            continue
        cites = extract(getattr(c, "text", "") or "", offset=getattr(c, "char_start", 0) or 0)
        if cites:
            found[c.idx] = cites
    return found


#: The only kind that produces an edge at Step 16. The rest are consumed earlier
#: (definitional at 9, exemption at 12, amends/supersedes at 15) or are inert.
EDGE_KINDS = {"trigger", "amends", "supersedes"}


def summarise(found: dict[int, list[Citation]]) -> dict:
    """Counts for the harness and the ingest console."""
    kinds: dict[str, int] = {}
    targets: dict[str, int] = {}
    for cites in found.values():
        for c in cites:
            kinds[c.kind] = kinds.get(c.kind, 0) + 1
            targets[c.target_type] = targets.get(c.target_type, 0) + 1
    total = sum(len(v) for v in found.values())
    return {
        "clauses_citing": len(found),
        "citations": total,
        "by_kind": kinds,
        "by_target": targets,
        "edge_candidates": sum(
            1 for cites in found.values() for c in cites
            if c.kind in EDGE_KINDS and c.target_type == "internal"
        ),
    }
