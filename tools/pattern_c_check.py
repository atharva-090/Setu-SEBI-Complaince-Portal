"""Pattern C over the real corpus — task D1's per-document check.

Pattern C reads only the title and the opening clauses, so the whole corpus can
be checked on the host in seconds. Running eight full ingestions to see eight
audiences would take hours and prove nothing extra.

    python tools/pattern_c_check.py
    python tools/pattern_c_check.py --show      # the scope text the model sees

Exit 0 only when every document resolves. Needs PyMuPDF; no Docker, and no API
key (the resolver falls back to its transparent mock).
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "services" / "ai-service"))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from app.audience import provider, resolve_document_audience  # noqa: E402
from corpus_check import CIRCULARS, _title_clause, load, tier_of  # noqa: E402

OPENING_CLAUSES = 10


def scope_input(path: Path) -> tuple[str | None, list[str]]:
    """What Pattern C sees: the title B2 extracts, plus the opening clauses.

    The preamble body is included as the first entry because that is where the
    addressee list lives ("To, All Investment Advisers") — on several documents
    it states the applicability more explicitly than the title does.
    """
    clauses, _, _ = load(path)
    title_node = _title_clause(clauses)
    title = getattr(title_node, "title_text", None) if title_node else None

    opening: list[str] = []
    if title_node is not None and (title_node.text or "").strip():
        opening.append(re.sub(r"\s+", " ", title_node.text).strip())
    for c in clauses:
        if c.kind != "clause" or c.junk or not (c.text or "").strip():
            continue
        opening.append(f"{c.clause_no or ''} {re.sub(r'\\s+', ' ', c.text)}".strip())
        if len(opening) > OPENING_CLAUSES:
            break
    return title, opening


def main() -> int:
    ap = argparse.ArgumentParser(description="Pattern C over the corpus")
    ap.add_argument("--only", help="substring filter on filename")
    ap.add_argument("--show", action="store_true", help="print the scope text too")
    args = ap.parse_args()

    paths = sorted(CIRCULARS.glob("*.pdf"))
    if args.only:
        paths = [p for p in paths if args.only.lower() in p.name.lower()]

    print(f"resolver provider: {provider()}\n")
    print(f"{'document':<36}{'t':>2}  {'?':<3}predicate")
    print("-" * 112)
    resolved = 0
    rows: list[tuple[str, str]] = []
    for path in paths:
        title, opening = scope_input(path)
        result = resolve_document_audience(title, opening)
        ok = bool(result.get("resolved"))
        resolved += ok
        rows.append((path.stem, result.get("normalised") or ""))
        print(
            f"{path.stem[:35]:<36}{tier_of(path.stem):>2}  "
            f"{('ok' if ok else 'NO'):<3}{result.get('normalised') or result.get('error') or '-'}"
        )
        print(f"{'':<41}label: {result.get('label') or '-'}")
        if args.show:
            print(f"{'':<41}title: {title!r}")
            for line in opening[:3]:
                print(f"{'':<41}  | {line[:88]}")
    print("-" * 112)
    print(f"{resolved}/{len(paths)} documents resolved to an audience")

    distinct = {n for _, n in rows if n}
    print(f"{len(distinct)} distinct audiences across the corpus "
          f"(rung 3 collapses the repeats)")
    return 0 if resolved == len(paths) else 1


if __name__ == "__main__":
    raise SystemExit(main())
