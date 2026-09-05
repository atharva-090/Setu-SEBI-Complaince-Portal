"""Pattern A harness — chapter scoping over assets/circulars/*.pdf (task D2).

    python tools/pattern_a_check.py                 # the table
    python tools/pattern_a_check.py --show          # every audience heading found
    python tools/pattern_a_check.py --only stock    # one document
    python tools/pattern_a_check.py --json

Runs the SAME walk the backend runs: Pattern C gives the document floor, then
every heading is classified in document order with its nearest resolved ancestor
as the parent, and the result is composed IN CODE. Nothing here mocks the
classifier — it imports app.audience.

No Docker. Needs PyMuPDF on the host.
"""

from __future__ import annotations

import argparse
import json
import sys
from collections import Counter, defaultdict
from pathlib import Path

for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, ValueError):
        pass

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))
sys.path.insert(0, str(ROOT / "services" / "ai-service"))

import corpus_check as cc  # noqa: E402
from app.audience import classify_heading, resolve_document_audience  # noqa: E402


def opening_lines(clause, kids, by_idx, limit: int = 600) -> str:
    """The first prose under a heading — what the section says it addresses.

    Deliberately NOT the whole subtree: the design sends the opening lines only,
    because a chapter's later clauses describe duties, not who owes them.
    """
    text = (clause.text or "").strip()
    for kid in kids.get(clause.idx, [])[:3]:
        if len(text) >= limit:
            break
        text = f"{text} {(kid.text or '').strip()}".strip()
    return text[:limit]


def walk(clauses, floor_conditions: list[str], floor_predicate: str):
    """Classify every heading top-down, inheriting the nearest resolved ancestor.

    Order matters: a child heading is composed against its PARENT's resolved
    audience, not against the document floor, so "18.5 ... for QSBs" beneath
    "18 ... Qualified Stock Brokers" narrows once rather than twice.
    """
    by_idx = {c.idx: c for c in clauses}
    kids = defaultdict(list)
    for c in clauses:
        kids[c.parent_idx].append(c)

    # idx -> the conditions in force there. Seeded with the document floor.
    audience_at: dict[int, list[str]] = {}
    predicate_at: dict[int, str] = {}
    results = []
    seen_headings: set[str] = set()

    def ancestors(c):
        out, node = [], c
        while node is not None and node.parent_idx is not None:
            node = by_idx.get(node.parent_idx)
            if node is None:
                break
            out.append(node)
        return list(reversed(out))

    for c in sorted(clauses, key=lambda x: x.idx):
        anc = ancestors(c)
        parent_conditions, parent_predicate = floor_conditions, floor_predicate
        for a in reversed(anc):
            if a.idx in audience_at:
                parent_conditions = audience_at[a.idx]
                parent_predicate = predicate_at[a.idx]
                break

        heading = (c.heading or "").strip()
        if not heading:
            continue
        # Each distinct heading is classified once per document; a repeated
        # heading (a running header, a TOC echo) is not a second chapter.
        key = heading.lower()
        if key in seen_headings:
            continue
        seen_headings.add(key)

        res = classify_heading(
            heading,
            [a.heading for a in anc if a.heading],
            opening_lines(c, kids, by_idx),
            parent_predicate,
            parent_conditions,
        )
        results.append((c, res, parent_predicate))
        if res.get("resolved") and res["conditions"] != parent_conditions:
            audience_at[c.idx] = res["conditions"]
            predicate_at[c.idx] = res["normalised"]

    # How many clauses each resolved audience actually scopes, by inheritance.
    scoped: Counter = Counter()
    for c in clauses:
        node = c
        while node is not None:
            if node.idx in predicate_at:
                scoped[predicate_at[node.idx]] += 1
                break
            node = by_idx.get(node.parent_idx) if node.parent_idx is not None else None
    return results, audience_at, predicate_at, scoped


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--show", action="store_true")
    ap.add_argument("--only")
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args()

    paths = sorted(cc.CIRCULARS.glob("*.pdf"))
    if args.only:
        paths = [p for p in paths if args.only.lower() in p.stem.lower()]
    if not paths:
        print("no PDFs found under assets/circulars", file=sys.stderr)
        return 2

    blob = {}
    rows = []
    for path in paths:
        clauses, _pages, _lines = cc.load(path)
        title = next((c.title_text for c in clauses if getattr(c, "is_title", False)), None)
        opening = [c.text for c in clauses if c.text and not c.junk][:14]
        floor = resolve_document_audience(title, opening)
        floor_conditions = floor.get("conditions") or []
        floor_predicate = floor.get("normalised") or ""

        results, audience_at, predicate_at, scoped = walk(
            clauses, floor_conditions, floor_predicate
        )
        headings = len(results)
        audiences = sum(1 for _c, r, _p in results if r.get("resolved"))
        refused = [r for _c, r, _p in results if r.get("is_audience") and not r.get("resolved")]
        distinct = sorted(set(predicate_at.values()))
        narrower = [p for p in distinct if p != floor_predicate]

        rows.append(
            {
                "stem": path.stem,
                "tier": cc.tier_of(path.stem),
                "floor": floor_predicate or "(none)",
                "headings": headings,
                "audiences": audiences,
                "refused": len(refused),
                "distinct": len(distinct),
                "narrower": narrower,
                "scoped": scoped,
                "results": results,
                "refusals": refused,
            }
        )
        blob[path.stem] = {
            "tier": cc.tier_of(path.stem),
            "floor": floor_predicate,
            "headings": headings,
            "audiences": audiences,
            "refused": len(refused),
            "narrower_audiences": narrower,
            "clauses_scoped": {k: v for k, v in scoped.items()},
        }

    if args.json:
        print(json.dumps(blob, indent=2))
        return 0

    print(f"{'document':42s} {'t':>2} {'heads':>6} {'aud':>5} {'refd':>5}  floor -> narrower")
    print("-" * 124)
    for r in rows:
        print(
            f"{r['stem']:42s} {r['tier']:>2} {r['headings']:>6} {r['audiences']:>5} "
            f"{r['refused']:>5}  {r['floor']}"
        )
        for pred in r["narrower"]:
            print(f"{'':57s}  -> {pred}   ({r['scoped'][pred]} clauses)")
        if args.show:
            for c, res, parent in r["results"]:
                if not res.get("resolved"):
                    continue
                print(f"{'':6s}[{c.clause_no or '-':>8s}] {(c.heading or '')[:64]}")
                print(f"{'':16s} {parent}  +  {res.get('condition')}")
            for res in r["refusals"]:
                print(f"{'':6s}REFUSED  {res.get('heading','')[:60]}")
                print(f"{'':16s} {res.get('error')}")
    print("-" * 124)
    gating = [r for r in rows if r["tier"] in cc.GATING_TIERS]
    print(
        f"SEBI (tiers 1-2): {sum(r['headings'] for r in gating)} headings -> "
        f"{sum(r['audiences'] for r in gating)} audience headings, "
        f"{sum(len(r['narrower']) for r in gating)} distinct audiences narrower than a floor, "
        f"{sum(r['refused'] for r in gating)} refused as contradictions"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
