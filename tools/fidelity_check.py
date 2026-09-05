"""Fidelity harness — runs the three validation lanes over the real corpus (D4).

    python tools/fidelity_check.py                # the table
    python tools/fidelity_check.py --show         # every tripwire, with its complaint
    python tools/fidelity_check.py --only stock

The number that matters is the TRIPWIRE RATE. Lane 3 refers flagged rules to an AI
verifier, so the design only holds if it fires on a small fraction — a check that
flags a third of the corpus is not a tripwire, it is a second drafter.

No Docker. Needs PyMuPDF on the host.
"""

from __future__ import annotations

import argparse
import re
import sys
from collections import Counter
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
from app.drafter import draft_rules  # noqa: E402
from app.fidelity import number_fidelity, type_check  # noqa: E402


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--show", action="store_true")
    ap.add_argument("--only")
    ap.add_argument("--limit", type=int, default=0, help="cap windows per document")
    ap.add_argument(
        "--plant", type=int, default=0,
        help="fabricate a number in every Nth rule and report the detection rate",
    )
    args = ap.parse_args()

    paths = sorted(cc.CIRCULARS.glob("*.pdf"))
    if args.only:
        paths = [p for p in paths if args.only.lower() in p.stem.lower()]

    totals = Counter()
    print(f"{'document':42s} {'t':>2} {'rules':>6} {'trip':>5} {'rate':>6} {'type':>5}")
    print("-" * 92)
    for path in paths:
        clauses, _pages, _lines = cc.load(path)
        windows = [c for c in clauses if c.window_text]
        if args.limit:
            windows = windows[: args.limit]

        rules = tripped = typefail = 0
        planted = caught = 0
        shown = 0
        for clause in windows:
            for rule in draft_rules(clause.window_text, clause.clause_no):
                rules += 1
                expression = rule.get("rule_expression") or ""
                # ⚠️ The corpus produces ZERO tripwires, and that number is a
                # property of the MOCK DRAFTER, not evidence the check is
                # unnecessary: the mock copies numbers verbatim by construction
                # and cannot invent one. A real model can. So inventions are
                # planted and the detection rate measured — a check that never
                # fires proves only that it did not crash.
                is_planted = False
                if args.plant and rules % args.plant == 0:
                    fabricated = _fabricate(expression, clause.window_text or "")
                    if fabricated:
                        expression = fabricated
                        planted += 1
                        is_planted = True
                # The check must normalise the SAME text the drafter saw. The
                # drafter reads the WINDOW — ancestor trail, antecedent context
                # and all — so checking against clause.text alone flagged rules
                # whose number came from the trail. Found on the first run.
                fid = number_fidelity(expression, clause.window_text or clause.text or "")
                typ = type_check(expression, rule.get("attribute_hints") or {})
                if not typ["ok"]:
                    typefail += 1
                if not fid["ok"]:
                    tripped += 1
                    if is_planted:
                        caught += 1
                    if args.show and shown < 12:
                        shown += 1
                        print(f"   [{clause.clause_no or '-'}] {expression}")
                        print(f"        {fid['complaint']}")
                        print(f"        window: {(clause.window_text or '')[:110]}")
        rate = (tripped / rules * 100) if rules else 0.0
        tier = cc.tier_of(path.stem)
        extra = f"  planted {caught}/{planted}" if planted else ""
        print(f"{path.stem:42s} {tier:>2} {rules:>6} {tripped:>5} {rate:>5.1f}% {typefail:>5}{extra}")
        if tier in cc.GATING_TIERS:
            totals["rules"] += rules
            totals["tripped"] += tripped
            totals["typefail"] += typefail
            totals["planted"] += planted
            totals["caught"] += caught

    print("-" * 92)
    rate = (totals["tripped"] / totals["rules"] * 100) if totals["rules"] else 0.0
    print(
        f"SEBI (tiers 1-2): {totals['rules']} rules → {totals['tripped']} tripwires "
        f"({rate:.1f}%), {totals['typefail']} type failures"
    )
    if totals["planted"]:
        detected = totals["caught"] / totals["planted"] * 100
        print(
            f"                  planted inventions: {totals['caught']}/{totals['planted']} "
            f"caught ({detected:.1f}%)"
        )
    return 0


def _fabricate(expression: str, window: str) -> str | None:
    """Replace a rule's literal with a number the clause does not contain.

    Deliberately picks a value ABSENT from the text pool, so a miss is a real
    miss rather than an accidental collision with something legitimately there.
    """
    from app.fidelity import text_numbers

    m = re.search(r"(?<![\w.])(\d+(?:\.\d+)?)(?![\w.])", expression)
    if not m:
        return None
    pool = text_numbers(window)
    for candidate in (997, 883, 761, 641, 523, 419):
        if float(candidate) not in pool:
            return expression[: m.start(1)] + str(candidate) + expression[m.end(1):]
    return None


if __name__ == "__main__":
    raise SystemExit(main())
