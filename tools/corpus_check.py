"""Corpus harness - runs the real parser over assets/circulars/*.pdf on the host.

Task A1. This exists because every structural claim in docs/product-logic.md was
measured by throwaway scripts that lived in a temp directory and were deleted.
Nothing here mocks anything: it imports the same pdf.parse_pdf and segment.segment
that the /parse-pdf endpoint calls in the container, and runs the numbering audit
and re-segment pass exactly as main.py does.

    python tools/corpus_check.py                     # the metrics table
    python tools/corpus_check.py --grep "Qualified REs|Mid-size"   # clauses so named
    python tools/corpus_check.py --grep "Qualified REs" --mentions # every mention
    python tools/corpus_check.py --titles
    python tools/corpus_check.py --backrefs          # where antecedents live (B4)
    python tools/corpus_check.py --json              # machine-readable

No Docker. Needs PyMuPDF on the host (pip install pymupdf).
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from collections import Counter
from dataclasses import dataclass
from pathlib import Path

# SEBI text is full of en-dashes, curly quotes and Devanagari; the Windows
# console is cp1252 and raises on all three. Never let the harness die of its
# own output.
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, ValueError):  # not a real tty / already wrapped
        pass

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "services" / "ai-service"))

from app.pdf import parse_pdf  # noqa: E402
from app.segment import (  # noqa: E402
    ANCESTOR_LABEL_CHARS,
    STUB_CHARS,
    Clause,
    audit_numbering,
    backref_noun,
    mentions,
    segment,
    strip_secondary_script,
)
from app.segment import _CONTINUATION, _OPAQUE_HINT  # noqa: E402

CIRCULARS = ROOT / "assets" / "circulars"

# ---------------------------------------------------------------------------
# Acceptance scope
#
# The product targets SEBI master circulars. Everything else in the corpus is
# there to keep us honest, NOT to be satisfied. The tiers are load-bearing:
# a change that improves a tier-3 document and regresses a tier-1 one is a
# failed change, however good the totals look.
#
#   1  SEBI master circulars     the acceptance set. A regression here fails.
#   2  SEBI, not master          in scope, must not regress.
#   3  non-SEBI                  observed only. Never a reason to change code.
#
# Unknown files default to tier 3: a new document has to be promoted on
# purpose, so nothing quietly starts gating the build.
# ---------------------------------------------------------------------------
TIER: dict[str, int] = {
    "master-circular-stock-brokers-2024": 1,
    "master-investment-advisers-2024": 1,
    "master-mutual-funds-2024": 1,
    "master-research-analysts-2024": 1,
    "cscrf-multi-entity-2024": 2,
    "cloud-framework-multi-entity-2023": 2,
    "circular-2024-14-mirsd": 2,
    "rbi-it-outsourcing-2023": 3,
}
GATING_TIERS = (1, 2)


def tier_of(stem: str) -> int:
    return TIER.get(stem, 3)

# Devanagari block. SEBI/RBI circulars carry a Hindi parallel text; it is not junk,
# it is a second language, and Step 8 currently treats it as ordinary body text.
_DEVANAGARI = re.compile(r"[ऀ-ॿ]")

# A lead-in is a clause that announces a list - "REs are categorised as under:".
# Its children are the taxonomy members, and they are short by nature (task B1).
_LEADIN = re.compile(
    r"(categoris|categoriz|classif|following|as\s+under|as\s+below|"
    r"shall\s+be\s+divided|types?\s+of|namely)\b",
    re.IGNORECASE,
)


@dataclass
class DocMetrics:
    name: str
    tier: int             # 1 SEBI master · 2 SEBI other · 3 non-SEBI (observed)
    pages: int
    lines: int
    clauses: int          # kind == "clause"
    nodes: int            # every node, incl. containers / preamble / toc
    headings: int
    junked: int
    short_junked: int     # junked *only* because len(text) < STUB_CHARS
    devanagari_pct: float  # share of NODES carrying Devanagari - the doc's 7.3%
    devanagari_chars: float  # same thing by character, for comparison
    dup_clause_no: int    # distinct clause_no values that appear more than once
    dup_extra: int        # total extra occurrences of those numbers
    leadins: int
    titles: int
    sent: int             # windows that would actually reach the drafter


def load(path: Path):
    """Parse + segment exactly as main.py does - numbering audit and re-segment
    included, otherwise these numbers would not match what the pipeline sees.

    Returns (clauses, pages, lines). A2 shares this loader."""
    lines, pages = parse_pdf(path.read_bytes())
    lines = strip_secondary_script(lines)
    clauses = segment(lines)
    _, patched = audit_numbering(clauses, lines)
    if patched is not None:
        lines = patched
        clauses = segment(lines)
    return clauses, pages, lines


def _title_clause(clauses: list[Clause]) -> Clause | None:
    """The node carrying the document's subject line. B2 sets `is_title`; the
    preamble fallback is kept so this still reports something on a document
    where extraction fails, rather than silently showing nothing."""
    for c in clauses:
        if getattr(c, "is_title", False):
            return c
    for c in clauses:
        if c.kind == "preamble" and (c.text or "").strip():
            return c
    return None


def measure(path: Path) -> DocMetrics:
    clauses, pages, lines = load(path)

    # Two Devanagari readings. The one product-logic.md quotes is per-node: a
    # bilingual document is one where whole clauses are in Hindi, not one where
    # a Hindi word appears. The character share is kept beside it because that
    # is the number telling you how much of the page is untranslated.
    body = "\n".join(l.text for l in lines)
    deva_chars = len(_DEVANAGARI.findall(body))
    letters = sum(1 for ch in body if ch.isalpha())
    deva_nodes = sum(1 for c in clauses if _DEVANAGARI.search(c.text or ""))

    # Duplicates counted over every node, not just kind == "clause": a repeated
    # number landing on a container is exactly the collision that makes a
    # citation ambiguous at Step 16.
    numbers = Counter(c.clause_no for c in clauses if c.clause_no)
    dup_distinct = sum(1 for n in numbers.values() if n > 1)
    dup_extra = sum(n - 1 for n in numbers.values() if n > 1)

    leadins = 0
    for c in clauses:
        text = (c.text or c.heading or "").strip()
        if text.endswith(":") and _LEADIN.search(text):
            leadins += 1

    short_junked = sum(
        1
        for c in clauses
        if c.junk
        and c.kind not in ("toc", "container")
        and len((c.text or "").strip()) < STUB_CHARS
    )

    title = _title_clause(clauses)

    return DocMetrics(
        name=path.stem,
        tier=tier_of(path.stem),
        pages=pages,
        lines=len(lines),
        clauses=sum(1 for c in clauses if c.kind == "clause"),
        nodes=len(clauses),
        headings=sum(1 for c in clauses if c.heading),
        junked=sum(1 for c in clauses if c.junk),
        short_junked=short_junked,
        devanagari_pct=round(100.0 * deva_nodes / len(clauses), 2) if clauses else 0.0,
        devanagari_chars=round(100.0 * deva_chars / letters, 2) if letters else 0.0,
        dup_clause_no=dup_distinct,
        dup_extra=dup_extra,
        leadins=leadins,
        titles=1 if (title and not title.junk) else 0,
        sent=sum(1 for c in clauses if not c.junk and c.window_text),
    )


COLUMNS = [
    ("document", "name", 36),
    ("t", "tier", 3),
    ("pages", "pages", 6),
    ("clauses", "clauses", 8),
    ("headings", "headings", 9),
    ("junked", "junked", 7),
    ("short", "short_junked", 6),
    ("deva%", "devanagari_pct", 7),
    ("dupNo", "dup_clause_no", 6),
    ("leadin", "leadins", 7),
    ("sent", "sent", 6),
]


def print_table(rows: list[DocMetrics]) -> None:
    head = "".join(
        label.ljust(w) if i == 0 else label.rjust(w)
        for i, (label, _, w) in enumerate(COLUMNS)
    )
    print(head)
    print("-" * len(head))
    for r in rows:
        print("".join(
            str(getattr(r, attr)).ljust(w) if i == 0 else str(getattr(r, attr)).rjust(w)
            for i, (_, attr, w) in enumerate(COLUMNS)
        ))
    print("-" * len(head))
    accept = [r for r in rows if r.tier == 1]
    print(
        f"tier 1 = the acceptance set ({len(accept)} SEBI master circulars, "
        f"{sum(r.clauses for r in accept)} clauses) | tier 3 is observed, never a target"
    )
    print(
        f"{len(rows)} documents | "
        f"{sum(r.clauses for r in rows)} clauses | "
        f"{sum(r.junked for r in rows)} junked "
        f"({sum(r.short_junked for r in rows)} of them for length < {STUB_CHARS}) | "
        f"{sum(r.sent for r in rows)} sent to drafter"
    )


LABEL_CHARS = 60  # above this a clause has a body, not just a name


def _label(c: Clause) -> str:
    """What the clause is *about*, as opposed to what it mentions.

    A heading is a label outright. A clause with no heading and a body short
    enough to read as a name - "Qualified REs" - is its own label; that shape
    is exactly what B1 is about, and exactly what STUB_CHARS deletes."""
    if c.heading:
        return c.heading
    text = (c.text or "").strip()
    return text if len(text) <= LABEL_CHARS else ""


def do_grep(paths: list[Path], pattern: str, mentions: bool = False) -> int:
    rx = re.compile(pattern, re.IGNORECASE)
    hits = 0
    print(f"{'document':<28}{'idx':>6}  {'no':<8}{'junk':<7}{'len':>5}  text")
    print("-" * 112)
    for path in paths:
        clauses, _, _ = load(path)
        for c in clauses:
            blob = (
                f"{c.clause_no or ''} {c.heading or ''} {c.text or ''}"
                if mentions
                else _label(c)
            )
            if blob and rx.search(blob):
                hits += 1
                snippet = re.sub(r"\s+", " ", (c.heading or c.text or ""))[:58]
                print(
                    f"{path.stem[:27]:<28}{c.idx:>6}  {(c.clause_no or '-'):<8}"
                    f"{str(c.junk):<7}{len((c.text or '').strip()):>5}  {snippet}"
                )
    print("-" * 112)
    print(f"{hits} matching clauses")
    return hits


# --- back-reference analysis (task B4) ------------------------------------
# The regexes and the noun test are IMPORTED from segment.py, not re-declared.
# This measurement is what decided the implementation; if the two could drift,
# the number below would stop describing the code that ships.


def _prev_sibling(c: Clause, clauses: list[Clause]) -> Clause | None:
    prev = None
    for other in clauses:
        if other.idx >= c.idx:
            break
        if other.parent_idx == c.parent_idx and other.kind == c.kind:
            prev = other
    return prev


def do_backrefs(paths: list[Path], show: int) -> int:
    """Where does a clause's antecedent actually live?

    B4 asks whether _window should pull in the previous sibling. That is only
    worth its token cost for clauses whose antecedent is NOT already reachable
    from the ancestor chain the window carries.
    """
    print(f"{'document':<36}{'t':>2}{'sent':>7}{'backref':>8}{'inWin':>7}"
          f"{'trunc':>7}{'sib':>6}{'opaque':>8}{'cont':>6}")
    print("-" * 100)
    samples: list[str] = []
    for path in paths:
        clauses, _, _ = load(path)
        by_idx = {c.idx: c for c in clauses}
        sent = [c for c in clauses if not c.junk and c.window_text]
        n_back = in_win = truncated = via_sib = opaque = cont = 0

        for c in sent:
            text = (c.text or "")
            is_cont = bool(_CONTINUATION.match(text))
            noun = backref_noun(text)
            vague = _OPAQUE_HINT.search(text)
            if not (noun or vague or is_cont):
                continue
            n_back += 1
            if is_cont:
                cont += 1
            if not noun:
                if vague:
                    opaque += 1
                continue

            parent = by_idx.get(c.parent_idx) if c.parent_idx is not None else None
            ptext = (parent.text or "") if parent else ""
            head = ptext[:ANCESTOR_LABEL_CHARS] + " " + ((parent.heading or "") if parent else "")
            sib = _prev_sibling(c, clauses)
            stext = (sib.text or "") if sib else ""

            def has(hay: str) -> bool:
                return any(re.search(rf"\b{re.escape(w)}s?\b", hay, re.I) for w in noun)

            if has(head):
                in_win += 1
            elif has(ptext):
                truncated += 1
            elif has(stext):
                via_sib += 1
                if len(samples) < show:
                    samples.append(
                        f"  {path.stem[:26]:<27} {c.clause_no or '-':<9} "
                        f"'{' '.join(noun)[:34]}'  <- prev sibling {sib.clause_no or '-'}"
                    )

        print(f"{path.stem[:35]:<36}{tier_of(path.stem):>2}{len(sent):>7}{n_back:>8}"
              f"{in_win:>7}{truncated:>7}{via_sib:>6}{opaque:>8}{cont:>6}")

    print("-" * 100)
    print("inWin  antecedent already in the window (ancestor chain)  -> sibling adds nothing")
    print("trunc  in the parent, but past the 80-char ancestor label -> fix truncation, not siblings")
    print("sib    only in the previous sibling                       -> the case B4 is about")
    if samples:
        print("\nsamples of the 'sib' case:")
        for s in samples:
            print(s)
    return 0


def do_titles(paths: list[Path]) -> int:
    ok = 0
    print(f"{'document':<34}{'kept':<7}extracted title")
    print("-" * 112)
    for path in paths:
        clauses, _, _ = load(path)
        title = _title_clause(clauses)
        extracted = getattr(title, "title_text", None) if title else None
        kept = bool(title and not title.junk and extracted)
        ok += kept
        shown = extracted or re.sub(r"\s+", " ", (title.text if title else "<none>"))
        print(f"{path.stem[:33]:<34}{('yes' if kept else 'NO'):<7}{shown[:64]}")
    print("-" * 112)
    print(f"{ok}/{len(paths)} non-junk titles")
    return ok


def main() -> int:
    ap = argparse.ArgumentParser(description="Setu corpus metrics")
    ap.add_argument("--dir", default=str(CIRCULARS), help="folder of PDFs")
    ap.add_argument("--only", help="substring filter on filename")
    ap.add_argument("--grep", help="regex - list clauses NAMED by it, with junk status")
    ap.add_argument("--mentions", action="store_true",
                    help="with --grep: search whole bodies, not just clause labels")
    ap.add_argument("--titles", action="store_true", help="title-clause survival check")
    ap.add_argument("--backrefs", action="store_true",
                    help="where dangling antecedents live (task B4)")
    ap.add_argument("--show", type=int, default=10, help="with --backrefs: sample count")
    ap.add_argument("--json", action="store_true", help="emit JSON instead of a table")
    args = ap.parse_args()

    paths = sorted(Path(args.dir).glob("*.pdf"))
    if args.only:
        paths = [p for p in paths if args.only.lower() in p.name.lower()]
    if not paths:
        print(f"no PDFs in {args.dir}", file=sys.stderr)
        return 2

    if args.grep:
        return 0 if do_grep(paths, args.grep, args.mentions) else 1
    if args.backrefs:
        return do_backrefs(paths, args.show)
    if args.titles:
        return 0 if do_titles(paths) == len(paths) else 1

    rows = [measure(p) for p in paths]
    if args.json:
        print(json.dumps([r.__dict__ for r in rows], indent=2))
    else:
        print_table(rows)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
