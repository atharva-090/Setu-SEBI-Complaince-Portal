"""Golden snapshots of the clause tree - task A2.

corpus_check.py tells you a number moved. This tells you *which clause* moved,
which is the difference between "the fix worked" and "the fix worked and broke
something 300 pages away".

    python tools/snapshot.py write          # record the current trees
    python tools/snapshot.py check          # compare; non-zero on any change
    python tools/snapshot.py check --only master-mutual
    python tools/snapshot.py check --max 40 # show more diff lines

Acceptance is SEBI. A tier-1 or tier-2 change FAILS the check; a tier-3
(non-SEBI) change is reported as a warning and does not fail, because those
documents are observed, never targeted. Tiers live in corpus_check.TIER.

Snapshots go to tools/golden/<document>.json and are meant to be committed:
the diff in code review is the record of what a parser change did.
"""

from __future__ import annotations

import argparse
import difflib
import hashlib
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from corpus_check import (  # noqa: E402
    CIRCULARS,
    GATING_TIERS,
    Clause,
    load,
    tier_of,
)

GOLDEN = Path(__file__).resolve().parent / "golden"
SCHEMA = 3  # bump when the fingerprint format changes; forces a rewrite


def _sha(text: str) -> str:
    return hashlib.sha1(text.encode("utf-8")).hexdigest()


def fingerprint(c: Clause) -> str:
    """One clause, as a single comparable line.

    Deliberately excludes idx and parent_idx: both shift wholesale when a
    clause is inserted early, which would turn one real change into thousands
    of false ones. Depth carries the structural information that matters, and
    the text hash catches any content change.
    """
    return "|".join([
        c.kind,
        c.clause_no or "-",
        str(c.depth),
        "junk" if c.junk else "keep",
        "leaf" if c.is_leaf else "node",
        str(len((c.text or "").strip())),
        _sha(c.text or "")[:10],
        re.sub(r"\s+", " ", (c.heading or "")).strip()[:48],
        # B2's output. Carried here so a change to title extraction shows up as
        # a diff on the clause that owns it, not just as a metrics wobble.
        re.sub(r"\s+", " ", (c.title_text or "")).strip()[:64],
        # The window is what actually reaches the drafter. Without it, a change
        # to context assembly (B4) alters every prompt and the check still says
        # PASS - which is exactly what happened before this field existed.
        str(len(c.window_text or "")),
        _sha(c.window_text or "")[:10],
    ])


def _label(fp: str) -> str:
    """Human-readable form of a fingerprint line, for the diff output."""
    (kind, no, depth, junk, _leaf, length, _hash, heading, title,
     win_len, _win_hash) = fp.split("|")
    tail = f" {heading}" if heading else ""
    if title:
        tail += f'  title="{title}"'
    return f"{kind:<9} {no:<10} d{depth} {junk:<4} {length:>5}ch w{win_len:<5}{tail}"


def build(path: Path) -> dict:
    clauses, pages, lines = load(path)
    fps = [fingerprint(c) for c in clauses]
    return {
        "schema": SCHEMA,
        "name": path.stem,
        "tier": tier_of(path.stem),
        "pages": pages,
        "lines": len(lines),
        "nodes": len(clauses),
        "clauses": sum(1 for c in clauses if c.kind == "clause"),
        "junked": sum(1 for c in clauses if c.junk),
        "tree_hash": _sha("\n".join(fps)),
        "fingerprints": fps,
    }


def golden_path(stem: str) -> Path:
    return GOLDEN / f"{stem}.json"


def _write_one(path: Path) -> dict:
    snap = build(path)
    GOLDEN.mkdir(parents=True, exist_ok=True)
    golden_path(path.stem).write_text(
        json.dumps(snap, indent=1, ensure_ascii=False), encoding="utf-8"
    )
    return snap


def do_write(paths: list[Path]) -> int:
    print(f"{'document':<36}{'t':>2}{'nodes':>8}{'junked':>8}  tree_hash      was")
    print("-" * 96)
    for path in paths:
        before = None
        gp = golden_path(path.stem)
        if gp.exists():
            try:
                before = json.loads(gp.read_text(encoding="utf-8"))["tree_hash"][:10]
            except (KeyError, json.JSONDecodeError):
                before = "unreadable"
        snap = _write_one(path)
        mark = ""
        if before and before != snap["tree_hash"][:10]:
            mark = f"  {before}  CHANGED"
        elif before:
            mark = f"  {before}  same"
        print(
            f"{snap['name'][:35]:<36}{snap['tier']:>2}{snap['nodes']:>8}"
            f"{snap['junked']:>8}  {snap['tree_hash'][:10]}{mark}"
        )
    print("-" * 96)
    print(f"wrote {len(paths)} snapshots to {GOLDEN}")
    return 0


def diff_report(old: list[str], new: list[str], limit: int) -> list[str]:
    """Readable diff of two fingerprint lists, insertion-tolerant."""
    out: list[str] = []
    sm = difflib.SequenceMatcher(a=old, b=new, autojunk=False)
    for tag, i1, i2, j1, j2 in sm.get_opcodes():
        if tag == "equal":
            continue
        if tag == "replace":
            for k in range(max(i2 - i1, j2 - j1)):
                a = old[i1 + k] if i1 + k < i2 else None
                b = new[j1 + k] if j1 + k < j2 else None
                if a == b:
                    continue
                if a and b:
                    out.append(f"    ~ was  {_label(a)}")
                    out.append(f"      now  {_label(b)}")
                elif a:
                    out.append(f"    - gone {_label(a)}")
                else:
                    out.append(f"    + new  {_label(b)}")
        elif tag == "delete":
            out += [f"    - gone {_label(x)}" for x in old[i1:i2]]
        elif tag == "insert":
            out += [f"    + new  {_label(x)}" for x in new[j1:j2]]
        if len(out) > limit:
            remaining = sum(
                max(b - a, d - c)
                for t, a, b, c, d in sm.get_opcodes()
                if t != "equal"
            )
            out = out[:limit]
            out.append(f"    ... {remaining} changed regions in total")
            break
    return out


def do_check(paths: list[Path], limit: int) -> int:
    failed: list[str] = []
    warned: list[str] = []
    missing: list[str] = []

    for path in paths:
        gp = golden_path(path.stem)
        tier = tier_of(path.stem)
        if not gp.exists():
            missing.append(path.stem)
            continue
        old = json.loads(gp.read_text(encoding="utf-8"))
        if old.get("schema") != SCHEMA:
            missing.append(f"{path.stem} (schema {old.get('schema')} != {SCHEMA})")
            continue

        new = build(path)
        if new["tree_hash"] == old["tree_hash"]:
            print(f"  ok    t{tier}  {path.stem}")
            continue

        gating = tier in GATING_TIERS
        (failed if gating else warned).append(path.stem)
        print(f"  {'FAIL' if gating else 'WARN':<4}  t{tier}  {path.stem}")
        print(
            f"        nodes {old['nodes']} -> {new['nodes']}   "
            f"clauses {old['clauses']} -> {new['clauses']}   "
            f"junked {old['junked']} -> {new['junked']}"
        )
        for line in diff_report(old["fingerprints"], new["fingerprints"], limit):
            print(line)

    print("-" * 96)
    if missing:
        print(f"NO SNAPSHOT for {len(missing)}: {', '.join(missing)}")
        print("run:  python tools/snapshot.py write")
        return 2
    if failed:
        print(f"FAIL - clause tree changed in {len(failed)} SEBI document(s): "
              f"{', '.join(failed)}")
        if warned:
            print(f"       (also changed, non-gating: {', '.join(warned)})")
        print("if the change is intended:  python tools/snapshot.py write")
        return 1
    if warned:
        print(f"PASS with warnings - tier-3 only: {', '.join(warned)}")
        print("       non-SEBI documents are observed, not targeted; not a failure.")
        return 0
    print(f"PASS - {len(paths)} clause trees identical to golden")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description="Setu golden clause-tree snapshots")
    ap.add_argument("mode", choices=["write", "check"])
    ap.add_argument("--dir", default=str(CIRCULARS))
    ap.add_argument("--only", help="substring filter on filename")
    ap.add_argument("--max", type=int, default=20, help="max diff lines per document")
    args = ap.parse_args()

    paths = sorted(Path(args.dir).glob("*.pdf"))
    if args.only:
        paths = [p for p in paths if args.only.lower() in p.name.lower()]
    if not paths:
        print(f"no PDFs in {args.dir}", file=sys.stderr)
        return 2

    return do_write(paths) if args.mode == "write" else do_check(paths, args.max)


if __name__ == "__main__":
    raise SystemExit(main())
