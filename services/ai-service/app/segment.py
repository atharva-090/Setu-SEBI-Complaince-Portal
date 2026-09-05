"""Stage A2 — structural segmentation by the document's own numbering grammar.

Nodes are created for chapters/annexures/schedules and dotted-numbered clauses
("5", "5.2", "5.2.1"). Lettered/roman sub-items ("(a)", "(iv)") fold into their
parent clause body: the unit of extraction is the clause leaf *with* its
sub-clauses and provisos (scope §4.1). Overlap is handled by carrying the
ancestor chain as the window prefix, never by sliding windows.
"""

from __future__ import annotations

import re
import statistics
from collections import defaultdict
from dataclasses import dataclass, field, replace

from .pdf import Line

_CHAPTER = re.compile(r"^(?:CHAPTER|Chapter)\s+([IVXLCivxlc\d]+)\b[\s:.—–-]*(.*)$")
_ANNEX = re.compile(
    r"^(?:ANNEXURE|Annexure|SCHEDULE|Schedule|APPENDIX|Appendix)\s*[-–—:.]?\s*"
    r"([A-Z0-9]{1,4})?\b[\s:.—–-]*(.*)$"
)
_PART = re.compile(r"^(?:PART|Part)\s+([IVXLC\d]+)\b[\s:.—–-]*(.*)$")
# "9", "9.3", "9.3.1" at line start. {1,2} on the head blocks years ("2024 …").
_NUM = re.compile(r"^(\d{1,2}(?:\.\d{1,3})*)[.)]?\s+(\S.*)$")
_NORMATIVE = re.compile(
    r"\b(shall|must|should|required|ensure|not\s+exceed|at\s+least|within|"
    r"prior\s+to|no\s+later\s+than|mandat\w+)\b",
    re.IGNORECASE,
)
_LIST_START = re.compile(r"^(\(([a-z]{1,2}|[ivxlc]+|\d{1,2})\)|[•▪‣–-])\s", re.IGNORECASE)
# Letterhead / header / sign-off furniture — the preamble shapes we skip on sight.
# Only ever tested against `kind == "preamble"` (the block before clause 1), so
# matching a leading "circular"/"sebi/…" can't eat a real numbered clause.
_FURNITURE = re.compile(
    r"^(to,|madam|sir|dear\s|yours\s+faithfully|thanking\s+you|encl|copy\s+to|"
    r"deputy\s+general\s+manager|chief\s+general\s+manager|general\s+manager|"
    r"assistant\s+general\s+manager|e[- ]?mail:|"
    r"(master\s+)?circular\b|sebi/[a-z]|no\.\s*sebi)",
    re.IGNORECASE,
)

# A clause that announces a list: its children are the members. Matched against
# the parent's opening text only — "in the following five categories" appears at
# the front of a lead-in, never buried three sentences down.
_LEAD_IN = re.compile(
    r"(following|as\s+under|as\s+below|categor|classif|namely|"
    r"divided\s+into|types?\s+of|comprise|consist)",
    re.IGNORECASE,
)
_LEADIN_SCAN = 300
# Tombstones. A repealed clause is short AND meaningless — always junk, even
# inside a list, or the carve-out below would resurrect every "Omitted."
_DEAD = re.compile(
    r"^\W*(deleted|omitted|reserved|nil|not\s+applicable|blank)\W*$", re.IGNORECASE
)
_NAME_WORD = re.compile(r"[A-Za-z]{3,}")

# --- document title -------------------------------------------------------
# A master circular declares who it binds in its subject line ("Master Circular
# for Stock Brokers"), which is Pattern C's primary input. The line sits inside
# the preamble block, alongside the filing header and the addressee list.
_SUBJECT = re.compile(r"\b(?:subject|sub|re)\s*[:\-–—]\s*(.+)", re.IGNORECASE | re.S)
_SALUTATION_LINE = re.compile(r"^(?:dear\s+)?(?:madam|sir)\b.{0,12}?,\s*$", re.IGNORECASE)
# Where a title stops: the Hindi half, a body enumerator ("I. Securities…"),
# or the start of a new sentence.
_TITLE_STOP = re.compile(
    r"[ऀ-ॿ]|\b[IVXLC]{1,4}[.)]\s+[A-Z]|\b\d{1,2}[.)]\s+[A-Z]|(?<=[.;])\s+[A-Z]"
)
# A wrapped title line ends on a word that cannot end a phrase.
_WRAPS = re.compile(
    r"(?:\b(?:of|for|and|or|to|the|a|an|by|in|on|with|from|under|regarding|relating)\b"
    r"|[-–—,])\s*$",
    re.IGNORECASE,
)
_DEVANAGARI = re.compile(r"[ऀ-ॿ]")
MAX_TITLE_CHARS = 200
MIN_TITLE_CHARS = 10
MAX_TITLE_LINES = 3

# --- back-references (task B4) --------------------------------------------
# A clause pointing at something outside itself. The two shapes need different
# answers, which is why they are matched separately: a NAMED antecedent
# ("such intermediary") can be searched for, an OPAQUE one ("thereof") cannot,
# and pulling context for a reference you cannot locate is guesswork.
_NAMED_BACKREF = re.compile(
    r"\b(?:such|the\s+said|said|aforesaid|aforementioned|the\s+above(?:-mentioned)?|"
    r"above[-\s]mentioned)\s+([a-z][a-z-]{2,}(?:\s+[a-z][a-z-]{2,})?)",
    re.IGNORECASE,
)
# Opaque references: real, but with no noun to search for. Tracked so the
# measurement can report how much of the back-reference problem is out of reach
# of any context-widening at all.
_OPAQUE_HINT = re.compile(
    r"\b(?:thereof|therein|thereunder|thereto|therewith|the\s+same|"
    r"as\s+(?:mentioned|specified|stated|provided)\s+above|in\s+this\s+regard)\b",
    re.IGNORECASE,
)
# A clause that grammatically continues the previous one — a proviso has no
# subject of its own, so its antecedent is the preceding clause by construction.
_CONTINUATION = re.compile(
    r"^\s*(?:provided\s+(?:further\s+)?that|however|further(?:more)?\s*,|"
    r"in\s+addition\s+thereto|also\s*,)\b",
    re.IGNORECASE,
)
_BACKREF_STOPWORDS = frozenset(
    {"the", "of", "and", "for", "such", "said", "above", "other", "any"}
)
ANCESTOR_LABEL_CHARS = 80
SIBLING_EXCERPT_CHARS = 400
PARENT_EXCERPT_CHARS = 400

MAX_WINDOW_CHARS = 4500
MIN_NORMATIVE_CHARS = 60
STUB_CHARS = 15  # below this, a clause is too short to hold any obligation
MIN_TAXONOMY_MEMBERS = 2  # a taxonomy is a list; one short child is a fragment


@dataclass
class Clause:
    idx: int
    kind: str  # container | clause | preamble | toc
    clause_no: str | None
    heading: str | None
    parent_idx: int | None
    page: int
    depth: int
    lines: list[str] = field(default_factory=list)
    text: str = ""
    char_start: int = 0
    char_end: int = 0
    is_leaf: bool = True
    normative: bool = False  # keyword signal — a TAG for ordering/UI, not a gate
    junk: bool = False  # provable junk → not sent to the drafter
    is_title: bool = False  # the block carrying the document's subject line
    title_text: str | None = None  # the subject line itself — Pattern C's input
    path: str = ""
    window_text: str | None = None  # set for everything we DO send (i.e. not junk)


_EMPTY_BRACKETS = re.compile(r"\(\s*\)|\[\s*\]|\{\s*\}")
_SEP_RUN = re.compile(r"(?:\s*[/|,;:–—-]\s*){2,}")
MIN_LATIN_CHARS = 3  # below this, the English residue is punctuation, not text


def strip_secondary_script(lines: list[Line]) -> list[Line]:
    """Drop the Hindi half of a bilingual circular, keeping the English.

    SEBI publishes CSCRF and the cloud framework with both languages in one
    file, and the Hindi half carries its OWN copy of the clause numbers. The
    segmenter therefore built two overlapping trees: CSCRF's 7.4 and 7.5 exist
    twice, and the Hindi copies come FIRST — so `scope` bound those numbers to
    the Hindi nodes and the English ones became duplicates. 81 of CSCRF's
    duplicate clause numbers are this, not a numbering defect in the document.

    Per line rather than per block, because the two languages share lines:
    "सभी समाशोधन तनगम / All Clearing Corporations" is one line holding both, and
    a block-level or ratio-based split loses the English half. Removing the
    Devanagari runs and tidying the separators left behind handles both shapes
    with one rule. A line with no Devanagari is returned untouched, so the six
    monolingual documents cannot be affected.

    English is kept because it is the operative text: SEBI's own circulars say
    the English version prevails, and every downstream stage — the drafter, the
    attribute registry, the expression grammar — is English-only.
    """
    out: list[Line] = []
    for line in lines:
        if not _DEVANAGARI.search(line.text):
            out.append(line)
            continue
        residue = _DEVANAGARI.sub("", line.text)
        residue = _EMPTY_BRACKETS.sub(" ", residue)  # "( ) / All Depositories"
        residue = _SEP_RUN.sub(" / ", residue)  # " /  / All Mutual Funds"
        residue = re.sub(r"\s+", " ", residue).strip(" /|,;:–—-")
        if sum(ch.isalpha() for ch in residue) < MIN_LATIN_CHARS:
            continue  # the line was Hindi and nothing survives — drop it
        out.append(replace(line, text=residue))
    return out


def _join(parts: list[str]) -> str:
    """Line-join with de-hyphenation; keep list items on their own lines."""
    out = ""
    for part in parts:
        if not out:
            out = part
        elif out.endswith("-") and part[:1].islower():
            out = out[:-1] + part  # mid-word hyphen split across lines
        elif _LIST_START.match(part):
            out += "\n" + part
        else:
            out += " " + part
    return out.strip()


def _is_heading_line(line: Line, body_size: float, rest: str) -> bool:
    return (line.bold or line.size >= body_size + 0.8) and len(rest) <= 90


def segment(lines: list[Line]) -> list[Clause]:
    if not lines:
        return []
    body_size = statistics.median(l.size for l in lines)

    clauses: list[Clause] = []
    container_idx: int | None = None  # current chapter/annexure/part
    current: Clause | None = None
    # dotted-number → idx, scoped to the current container (numbering restarts
    # per chapter/annexure in SEBI master circulars)
    scope: dict[str, int] = {}

    def flush() -> None:
        nonlocal current
        if current is not None:
            current.text = _join(current.lines)
            current = None

    def add(clause: Clause) -> Clause:
        clauses.append(clause)
        return clause

    for line in lines:
        text = line.text.strip()

        m = _CHAPTER.match(text) or _PART.match(text) or _ANNEX.match(text)
        if m and (line.bold or line.size >= body_size + 0.8 or text.upper() == text):
            flush()
            scope = {}
            label = text if not m.group(2) else text
            node = add(
                Clause(
                    idx=len(clauses), kind="container", clause_no=None,
                    heading=label.strip(), parent_idx=None, page=line.page, depth=0,
                )
            )
            container_idx = node.idx
            current = node
            continue

        m = _NUM.match(text)
        if m:
            number, rest = m.group(1), m.group(2)
            flush()
            parts = number.split(".")
            parent_idx = container_idx
            # nearest existing dotted prefix inside this container: 9.3.1 → 9.3 → 9
            for cut in range(len(parts) - 1, 0, -1):
                prefix = ".".join(parts[:cut])
                if prefix in scope:
                    parent_idx = scope[prefix]
                    break
            node = add(
                Clause(
                    idx=len(clauses), kind="clause", clause_no=number,
                    heading=rest if _is_heading_line(line, body_size, rest) else None,
                    parent_idx=parent_idx, page=line.page, depth=len(parts),
                )
            )
            if node.heading is None:
                node.lines.append(rest)
            scope[number] = node.idx
            if parent_idx is not None:
                clauses[parent_idx].is_leaf = False
            current = node
            continue

        if current is None:
            current = add(
                Clause(
                    idx=len(clauses), kind="preamble", clause_no=None, heading=None,
                    parent_idx=None, page=line.page, depth=0,
                )
            )
        current.lines.append(text)

    flush()

    # char offsets over the assembled document text (Ctrl+F highlight anchor)
    offset = 0
    for c in clauses:
        prefix = f"{c.clause_no} " if c.clause_no else ""
        head = f"{c.heading}\n" if c.heading else ""
        rendered = f"{prefix}{head}{c.text}".strip()
        c.char_start = offset
        c.char_end = offset + len(rendered)
        offset = c.char_end + 2  # "\n\n" between clauses

    _mark_toc_runs(clauses)

    by_idx = {c.idx: c for c in clauses}
    carve_outs = frozenset(_taxonomy_carve_outs(clauses, by_idx))
    prev_sib = _prev_siblings(clauses)

    # The title lives in the first preamble block — the text before clause 1.
    # Only that one is considered: a later preamble is body prose that happened
    # to lose its number, and a "Sub:" inside it is not the document's subject.
    for c in clauses:
        if c.kind != "preamble":
            continue
        title = _document_title(c)
        if title:
            c.is_title = True
            c.title_text = title
        break

    for c in clauses:
        c.path = _path(c, by_idx)
        # `normative` is now only a SIGNAL (keyword hit) — used for UI ordering and
        # review hints. It no longer decides what reaches the AI.
        c.normative = (
            c.kind == "clause"
            and len(c.text) >= MIN_NORMATIVE_CHARS
            and bool(_NORMATIVE.search(c.text))
        )
        # The send decision is a BLOCKLIST: skip only provable junk, send the rest
        # (in document order — clauses are already in idx = document order). The
        # drafter itself declines procedural/definitional text; a recall audit
        # downstream catches anything that slips through with numbers in it.
        c.junk = _is_junk(c, carve_outs)
        if not c.junk:
            c.window_text = _window(c, by_idx, prev_sib)
    return clauses


def _clean_title(raw: str) -> str | None:
    text = re.sub(r"\s+", " ", raw).strip()
    stop = _TITLE_STOP.search(text)
    if stop:
        text = text[: stop.start()]
    text = text.strip(" -–—:.,")
    return text[:MAX_TITLE_CHARS] if len(text) >= MIN_TITLE_CHARS else None


def _document_title(c: Clause) -> str | None:
    """The document's subject line, pulled out of the preamble block.

    Two routes, because two things can be true of a circular:

    `Subject:` / `Sub:` — read from the JOINED text. CSCRF's bilingual layout
    breaks its English title across eight single-word lines ("Cybersecurity" /
    "and" / "Cyber" / …); _join has already reassembled them, and the marker
    gives an unambiguous starting point. Reading lines here would return one word.

    No marker (older circulars, RBI) — fall back to the line after the
    salutation, and stop at the first line that does not end on a wrapping word.
    Without a marker the layout is the only boundary signal there is.
    """
    joined = re.sub(r"\s+", " ", c.text or "")
    marker = _SUBJECT.search(joined)
    if marker:
        title = _clean_title(marker.group(1))
        if title:
            return title

    for i, line in enumerate(c.lines):
        if not _SALUTATION_LINE.match(line.strip()):
            continue
        parts: list[str] = []
        for candidate in c.lines[i + 1 : i + 1 + MAX_TITLE_LINES]:
            candidate = candidate.strip()
            if not candidate or _DEVANAGARI.search(candidate):
                break
            parts.append(candidate)
            if not _WRAPS.search(candidate):  # phrase ended — title complete
                break
        title = _clean_title(" ".join(parts))
        if title:
            return title
    return None


def _looks_like_a_name(text: str) -> bool:
    """Does this short text read as the NAME of something, or as debris?

    Audience names are short by nature — "Qualified REs" is 13 characters. So is
    a stray table cell ("crore") and a form field ("Date of birth:"). The
    separation that held across the whole corpus: a name starts with a capital,
    does not trail into a colon, and is almost entirely letters.
    """
    if not text or not text[0].isupper():  # 'crore', 'nominee(s)}' — table debris
        return False
    if text.endswith((":", ";", ",")):  # 'Name:', 'schemes:' — a label or a lead-in
        return False
    if _DEAD.match(text):
        return False
    if not _NAME_WORD.search(text):  # '85', bare footnote markers
        return False
    letters = sum(ch.isalpha() or ch.isspace() or ch in "-()/&" for ch in text)
    return letters >= 0.8 * len(text)


def _taxonomy_carve_outs(clauses: list[Clause], by_idx: dict[int, Clause]) -> set[int]:
    """Short clauses that are members of a taxonomy, and must survive STUB_CHARS.

    CSCRF defines its five RE categories as bare names under a lead-in — three
    of them fall under STUB_CHARS and were being deleted, taking the audience
    vocabulary with them. Three conditions must hold together, because any one
    alone lets debris through:

      1. the parent announces a list  ("classifies the REs in the following …")
      2. the text reads as a name     (see _looks_like_a_name)
      3. at least MIN_TAXONOMY_MEMBERS siblings qualify — a taxonomy is a list,
         so a lone short child under a lead-in is a fragment, not a category

    Measured over the eight-document corpus this keeps 11 clauses, all in CSCRF
    (the six CSF functions, the three deleted RE categories, Custodians and
    Depositories), and moves nothing in any master circular.
    """
    groups: defaultdict[int, list[int]] = defaultdict(list)
    for c in clauses:
        if c.kind != "clause" or c.parent_idx is None:
            continue
        body = (c.text or "").strip()
        if len(body) >= STUB_CHARS or not _looks_like_a_name(body):
            continue
        parent = by_idx.get(c.parent_idx)
        if parent is None or not _LEAD_IN.search((parent.text or "")[:_LEADIN_SCAN]):
            continue
        groups[c.parent_idx].append(c.idx)

    return {
        idx
        for members in groups.values()
        if len(members) >= MIN_TAXONOMY_MEMBERS
        for idx in members
    }


def _is_junk(c: Clause, carve_outs: frozenset[int] = frozenset()) -> bool:
    """Provable junk only — the standard a skip must meet. Everything else is sent."""
    if c.kind in ("toc", "container"):
        return True
    if c.is_title:
        # Letterhead, yes — but it carries the subject line and the addressee
        # list, which is where a master circular says who it binds (Pattern C).
        return False
    body = (c.text or "").strip()
    if len(body) < STUB_CHARS and c.idx not in carve_outs:
        # 'Deleted.', 'Omitted.', bare heading with no body — unless the clause
        # is a named member of a taxonomy list (see _taxonomy_carve_outs).
        return True
    if c.kind == "preamble" and _FURNITURE.match(body):  # letterhead / sign-off
        return True
    return False


_TOC_ENTRY = re.compile(r"\s\d{1,3}$")


def _mark_toc_runs(clauses: list[Clause], min_run: int = 5) -> None:
    """Table-of-contents entries parse as short clauses ending in a page number.
    The signature alone also matches some real clauses, so only dense runs of
    consecutive matches (a real TOC) are reclassified."""
    run: list[Clause] = []

    def close() -> None:
        if len(run) >= min_run:
            for c in run:
                c.kind = "toc"
        run.clear()

    for c in clauses:
        if c.kind == "clause" and len(c.text) <= 160 and _TOC_ENTRY.search(c.text):
            run.append(c)
        else:
            close()
    close()


def _path(c: Clause, by_idx: dict[int, Clause]) -> str:
    parts: list[str] = []
    node: Clause | None = c
    while node is not None:
        label = node.heading or node.clause_no or node.kind
        if node.clause_no and node.heading:
            label = f"{node.clause_no} {node.heading}"
        parts.append(label.strip())
        node = by_idx.get(node.parent_idx) if node.parent_idx is not None else None
    return " › ".join(reversed(parts))


def backref_noun(text: str) -> list[str] | None:
    """The head noun of a named back-reference — 'such intermediary' → ['intermediary'].

    None when the clause has no named back-reference. Opaque references
    ('thereof', 'the same') deliberately return None: there is no noun to look
    for, so no amount of extra context can be shown to help.
    """
    m = _NAMED_BACKREF.search(text or "")
    if not m:
        return None
    words = [w for w in m.group(1).lower().split() if w not in _BACKREF_STOPWORDS]
    return words or m.group(1).lower().split()


def mentions(haystack: str, nouns: list[str]) -> bool:
    return any(
        re.search(rf"\b{re.escape(w)}s?\b", haystack, re.IGNORECASE) for w in nouns
    )


def _sentence_with(text: str, nouns: list[str]) -> str:
    """The sentence in `text` that introduces the antecedent, not the whole clause."""
    for part in re.split(r"(?<=[.;:])\s+", text):
        if mentions(part, nouns):
            return part.strip()[:PARENT_EXCERPT_CHARS]
    return text[:PARENT_EXCERPT_CHARS]


def _prev_siblings(clauses: list[Clause]) -> dict[int, int]:
    """idx → idx of the preceding clause under the same parent."""
    last: dict[tuple[int | None, str], int] = {}
    out: dict[int, int] = {}
    for c in clauses:
        key = (c.parent_idx, c.kind)
        if key in last:
            out[c.idx] = last[key]
        last[key] = c.idx
    return out


def _antecedent_context(
    c: Clause, by_idx: dict[int, Clause], prev_sib: dict[int, int]
) -> str | None:
    """Extra context for a clause whose antecedent is not in its window.

    Measured over the corpus before being written (`corpus_check.py --backrefs`).
    Of ~4,750 tier-1 windows, 194 (4.1%) have an antecedent reachable only from
    the previous sibling and 40 have one in the parent that the 80-char ancestor
    label cuts off. Sending every sibling everywhere would cost +23% tokens on
    all 5,900 windows to serve those ~5% — so this fires per clause, on evidence,
    or not at all.

    Order matters. The parent is checked first and wins: if the antecedent is
    already in the parent, the sibling adds nothing but tokens, even when the
    sibling happens to mention the same word.
    """
    nouns = backref_noun(c.text or "")
    continuation = bool(_CONTINUATION.match(c.text or ""))
    if not nouns and not continuation:
        return None

    parent = by_idx.get(c.parent_idx) if c.parent_idx is not None else None
    if nouns and parent is not None:
        ptext = parent.text or ""
        header = ptext[:ANCESTOR_LABEL_CHARS] + " " + (parent.heading or "")
        if mentions(header, nouns):
            return None  # already in the window — nothing to add
        if mentions(ptext, nouns):
            # In the parent, but past the ancestor label. Carry the one sentence
            # that introduces it rather than widening every window in the corpus.
            return f"[context — {parent.clause_no or 'parent'}] {_sentence_with(ptext, nouns)}"

    sib_idx = prev_sib.get(c.idx)
    sib = by_idx.get(sib_idx) if sib_idx is not None else None
    if sib is None or not (sib.text or "").strip():
        return None
    if nouns and not mentions(sib.text or "", nouns):
        return None  # named reference the sibling cannot resolve either
    excerpt = re.sub(r"\s+", " ", sib.text or "").strip()[:SIBLING_EXCERPT_CHARS]
    return f"[context — {sib.clause_no or 'previous'}] {excerpt}"


def _window(
    c: Clause,
    by_idx: dict[int, Clause],
    prev_sib: dict[int, int] | None = None,
) -> str:
    """Extraction window = ancestor chain (context) + the clause body."""
    ancestors: list[str] = []
    node = by_idx.get(c.parent_idx) if c.parent_idx is not None else None
    while node is not None:
        label = node.heading or (node.text[:80] if node.text else node.clause_no or "")
        if node.clause_no:
            label = f"{node.clause_no} {label}".strip()
        ancestors.append(label)
        node = by_idx.get(node.parent_idx) if node.parent_idx is not None else None
    header = " › ".join(reversed(ancestors))
    body = f"{c.clause_no or ''} {(c.heading + ' — ') if c.heading else ''}{c.text}".strip()
    if len(body) > MAX_WINDOW_CHARS:
        body = body[:MAX_WINDOW_CHARS] + " …[truncated]"

    extra = (
        _antecedent_context(c, by_idx, prev_sib) if prev_sib is not None else None
    )
    if extra:
        body = f"{extra}\n{body}"
    return f"[{header}]\n{body}" if header else body


# ─────────────────────────────────────────────────────────────────────────────
# Numbering audit — catch numbering the parser missed, repair the certain cases,
# flag the rest. Runs AFTER segment(); when it finds "glued" numbers (a clause
# whose number ran into its text with no space, so _NUM missed it) it returns a
# patched line list — the caller just re-runs segment() on it, no tree surgery.
# ─────────────────────────────────────────────────────────────────────────────

# A number glued to text with no space — but only when what follows looks like the
# start of a real clause (capital letter or an opening quote). This avoids matching
# numeric fragments in tables/annexures ("4crore", "18.6lakh").
_GLUE = re.compile(r"^(\d{1,2}(?:\.\d{1,3})*)(?=[A-Z\"'“‘])")
_MAX_GAP = 3  # only probe gaps of 1..3 missing numbers; bigger jumps are structural
_CITE_CUES = r"(?:para(?:graph)?|clause|sub[- ]?clause|regulation|point|item|section|annexure)"
# Annexures/appendices/schedules/forms number chaotically (tables, list items),
# so we don't run gap-detection inside them — too many false alarms.
_NONBODY = re.compile(r"^(annexure|appendix|schedule|form|table)\b", re.IGNORECASE)


def audit_numbering(clauses: list[Clause], lines: list[Line]) -> tuple[dict, list[Line] | None]:
    """Return (report, patched_lines_or_None).

    report = {checked, anomalies[], gaps_found, repaired, flagged}. If patched_lines
    is not None, the caller should re-run segment() on it (glued numbers de-glued).
    """
    present = {c.clause_no for c in clauses if c.kind == "clause" and c.clause_no}
    toc_nums = {c.clause_no for c in clauses if c.kind == "toc" and c.clause_no}

    # precompute once: glued numbers at line starts, and one searchable blob
    glued_at: dict[str, int] = {}
    for i, ln in enumerate(lines):
        m = _GLUE.match(ln.text.strip())
        if m:
            glued_at.setdefault(m.group(1), i)
    blob = "\n".join(ln.text for ln in lines)

    anomalies: list[dict] = []
    deglue: dict[int, str] = {}  # line idx → number to de-glue
    by_idx = {c.idx: c for c in clauses}

    # A. sequence gaps among siblings (same parent), main body only
    groups: dict[int | None, list[Clause]] = defaultdict(list)
    for c in clauses:
        if c.kind == "clause" and c.clause_no and not _under_nonbody(c, by_idx):
            groups[c.parent_idx].append(c)
    for kids in groups.values():
        numbered = sorted(
            (
                (int(c.clause_no.split(".")[-1]), c)
                for c in kids
                if c.clause_no.split(".")[-1].isdigit()
            ),
            key=lambda t: t[0],
        )
        for a in range(len(numbered) - 1):
            lo, c_lo = numbered[a]
            hi = numbered[a + 1][0]
            if 1 < hi - lo <= _MAX_GAP + 1:
                prefix = ".".join(c_lo.clause_no.split(".")[:-1])
                for miss in range(lo + 1, hi):
                    num = f"{prefix}.{miss}" if prefix else str(miss)
                    anomalies.append(_classify(num, c_lo.page, prefix or "(top)", glued_at, blob, deglue))

    # B. table-of-contents reconciliation — a section the TOC lists but the tree lacks
    for num in sorted(toc_nums):
        if num not in present:
            anomalies.append(_classify(num, None, "(toc)", glued_at, blob, deglue, from_toc=True))

    patched: list[Line] | None = None
    if deglue:
        patched = list(lines)
        for i, num in deglue.items():
            fixed = re.sub(r"^(" + re.escape(num) + r")(\S)", r"\1 \2", patched[i].text.strip())
            patched[i] = replace(patched[i], text=fixed)

    flagged = sum(1 for a in anomalies if a["resolution"] == "flagged")
    report = {
        "checked": len(present),
        "gaps_found": len(anomalies),
        "repaired": len(deglue),
        "flagged": flagged,
        "anomalies": anomalies[:200],
    }
    return report, patched


def _under_nonbody(c: Clause, by_idx: dict[int, Clause]) -> bool:
    """True if this clause sits under an annexure/appendix/schedule/form container."""
    node: Clause | None = c
    while node is not None:
        if node.kind == "container" and node.heading and _NONBODY.match(node.heading):
            return True
        node = by_idx.get(node.parent_idx) if node.parent_idx is not None else None
    return False


def _classify(
    num: str, page: int | None, parent: str,
    glued_at: dict[str, int], blob: str, deglue: dict[int, str], *, from_toc: bool = False,
) -> dict:
    base = {"number": num, "page": page, "parent": parent}
    # 1) number glued to its text at a line start → a clause we missed → de-glue & re-split
    if num in glued_at:
        deglue[glued_at[num]] = num
        return {**base, "kind": "missed_split", "resolution": "re-split"}
    # 2) cited mid-text ("para 18.6") → a cross-reference, not a missing clause → clear
    if re.search(_CITE_CUES + r"\s+" + re.escape(num) + r"(?!\.?\d)", blob, re.I):
        return {**base, "kind": "cross_reference", "resolution": "cleared"}
    # 3) nowhere to be found → genuinely skipped in the circular (deleted para) → flag
    return {**base, "kind": "toc_missing" if from_toc else "skipped", "resolution": "flagged"}
