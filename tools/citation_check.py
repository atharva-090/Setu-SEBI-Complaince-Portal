"""Citation harness — runs the real extractor over assets/circulars/*.pdf (task D8).

    python tools/citation_check.py                 # the table
    python tools/citation_check.py --kind trigger  # every trigger citation, in context
    python tools/citation_check.py --resolve       # what would actually become an edge
    python tools/citation_check.py --json

Tiering is corpus_check's: tier 1 is the acceptance set, tier 3 is observed only.
No Docker. Needs PyMuPDF on the host.
"""

from __future__ import annotations

import argparse
import json
import re
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
from app.citations import EDGE_KINDS, extract_all, summarise  # noqa: E402


def _ancestors(c, by_idx):
    out, node = [], c
    while node is not None and node.parent_idx is not None:
        node = by_idx.get(node.parent_idx)
        if node is None:
            break
        out.append(node)
    return out


def resolve_report(clauses, found) -> Counter:
    """Mirror of the backend resolver, for measurement only.

    Nearest-ancestor subtree first, then document-wide. This is the number that
    matters: how many internal citations name exactly one citable clause.
    """
    by_idx = {c.idx: c for c in clauses}
    kids = defaultdict(list)
    for c in clauses:
        kids[c.parent_idx].append(c)

    def subtree(root):
        out, stack = [], [root]
        while stack:
            n = stack.pop()
            out.append(n)
            stack.extend(kids.get(n.idx, []))
        return out

    citable = defaultdict(list)
    for c in clauses:
        if c.clause_no and c.kind == "clause" and not c.junk:
            citable[c.clause_no].append(c)

    st = Counter()
    for idx, cites in found.items():
        citing = by_idx.get(idx)
        for cite in cites:
            if cite.target_type != "internal":
                st[cite.target_type] += 1
                continue
            cands = citable.get(cite.number, [])
            if not cands:
                st["absent"] += 1
                continue
            if len(cands) == 1:
                st["unique"] += 1
                continue
            scoped = None
            for anc in _ancestors(citing, by_idx) if citing else []:
                inside = [x for x in subtree(anc) if x.clause_no == cite.number and x.idx != idx]
                if len(inside) == 1:
                    scoped = inside
                    break
                if len(inside) > 1:
                    break
            st["unique-by-scope" if scoped else "ambiguous"] += 1
    return st


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--kind", help="print every citation of this kind, in context")
    ap.add_argument("--resolve", action="store_true", help="what would become an edge")
    ap.add_argument("--json", action="store_true")
    ap.add_argument("--only", help="substring of the filename")
    args = ap.parse_args()

    paths = sorted(cc.CIRCULARS.glob("*.pdf"))
    if args.only:
        paths = [p for p in paths if args.only.lower() in p.stem.lower()]
    if not paths:
        print("no PDFs found under assets/circulars", file=sys.stderr)
        return 2

    blob = {}
    totals = Counter()
    rows = []
    for path in paths:
        clauses, _pages, _lines = cc.load(path)
        found = extract_all(clauses)
        summary = summarise(found)
        tier = cc.tier_of(path.stem)
        if args.kind:
            for idx, cites in sorted(found.items()):
                for c in cites:
                    if c.kind == args.kind:
                        node = next((x for x in clauses if x.idx == idx), None)
                        where = (node.clause_no if node else None) or f"idx {idx}"
                        print(f"{path.stem} [{where}] {c.raw}  ->  {c.target_type}")
                        print(f"      ...{c.context}")
            continue
        res = resolve_report(clauses, found) if args.resolve else Counter()
        rows.append((path.stem, tier, summary, res))
        blob[path.stem] = {"tier": tier, **summary, **({"resolve": dict(res)} if res else {})}
        if tier in cc.GATING_TIERS:
            totals.update(summary["by_kind"])
            totals.update({f"target:{k}": v for k, v in summary["by_target"].items()})
            totals.update(res)

    if args.kind:
        return 0
    if args.json:
        print(json.dumps(blob, indent=2))
        return 0

    print(f"{'document':42s} {'t':>2} {'cites':>6} {'edge?':>6}  kinds")
    print("-" * 118)
    for stem, tier, s, res in rows:
        kinds = " ".join(f"{k}={v}" for k, v in sorted(s["by_kind"].items(), key=lambda kv: -kv[1]))
        print(f"{stem:42s} {tier:>2} {s['citations']:>6} {s['edge_candidates']:>6}  {kinds}")
        tgt = " ".join(f"{k}={v}" for k, v in sorted(s["by_target"].items(), key=lambda kv: -kv[1]))
        print(f"{'':42s} {'':>2} {'':>6} {'':>6}  targets: {tgt}")
        if res:
            print(f"{'':42s} {'':>2} {'':>6} {'':>6}  resolve: "
                  + " ".join(f"{k}={v}" for k, v in sorted(res.items(), key=lambda kv: -kv[1])))
    print("-" * 118)
    print("SEBI totals (tiers 1-2): " + " ".join(f"{k}={v}" for k, v in sorted(totals.items())))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
