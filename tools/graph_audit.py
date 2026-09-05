"""Audit the live graph against its own source text (offline, no API calls).

    python tools/graph_audit.py            # the report
    python tools/graph_audit.py --show 12  # examples for each finding

Everything here re-checks a rule that is ALREADY STORED against the clause it
came from, using the same deterministic lanes the pipeline ran at draft time.
That is the point: the pipeline checked each rule as it was written, against the
window it was written from. This checks the graph as a whole, after filing, and
can therefore see things a per-rule check cannot -- a test that can never fail, a
rule whose duty belongs to somebody else, an attribute the register split three
ways.

Reads the database directly and calls nothing. Run it as often as you like.
"""

from __future__ import annotations

import argparse
import io
import os
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

import corpus_check as _offline  # noqa: F401,E402  (forces mock; no API calls)
from app import fidelity  # noqa: E402

# Reads JSON exported from the container rather than connecting directly: a
# native Postgres on this machine owns port 5432, so a host connection reaches
# THAT server and fails authentication in a way that looks like a credentials
# bug and is not. Export with:
#
#   docker exec setu-postgres psql -U setu_user -d setu_db -tAc "SELECT ..."
import json  # noqa: E402

# A comparison that no firm can fail. `days_between(x, today) > 0` is true for
# every date in the past; `count(x) >= 0` is true always. A rule built from one
# is not a compliance test, it is a sentence shaped like one.
_VACUOUS = [
    (r"(days|months|years|hours)_(since|between)\([^)]*\)\s*>=?\s*0(?!\d)", "duration >= 0"),
    (r"count\([^)]*\)\s*>=\s*0(?!\d)", "count >= 0"),
    (r"\b(\w+)\s*==\s*\1\b", "x == x"),
    (r"\bexists\(([^)]+)\)\s*(AND|OR)\s*exists\(\1\)", "exists(x) AND exists(x)"),
]

# The same attribute on both sides of an arithmetic operator: "a + a >= 40" was
# meant to be two different holdings. Neither the type gate nor the number check
# can see this -- both sides are the right type and the number is in the text.
_SELF_ARITH = re.compile(r"\[([a-z0-9_]+)\.([a-z0-9_]+)\]\s*[-+*/]\s*\[\1\.\2\]", re.I)

# Duties addressed to somebody other than the regulated firm. The design says
# these should be DECLINED at Step 11; a rule built from one tells a broker they
# owe something the exchange owes.
_OTHER_ACTOR = re.compile(
    r"\b(?:shall be inspected|shall be examined|stock exchanges? shall|"
    r"the exchanges? shall|SEBI shall|the Board shall (?:take|initiate|specify)|"
    r"clearing corporations? shall|depositor(?:y|ies) shall)\b",
    re.IGNORECASE,
)


def load(path: str) -> list[dict]:
    with io.open(path, encoding="utf-8") as fh:
        return json.load(fh) or []


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--show", type=int, default=0, help="print N examples per finding")
    ap.add_argument("--doc", default="master-circular-stock-brokers-2024")
    ap.add_argument("--obligations", default=None)
    ap.add_argument("--attributes", default=None)
    args = ap.parse_args()

    tmp = os.environ.get("TEMP") or "/tmp"
    obligations = load(args.obligations or os.path.join(tmp, "obligations.json"))
    if not obligations:
        print("no obligations in the export", file=sys.stderr)
        return 2

    live = [o for o in obligations if o["state"] == "ACTIVE"]
    findings: dict[str, list[dict]] = defaultdict(list)

    for o in obligations:
        expr = o["rule_expression"] or ""
        text = o["clause_text"] or ""

        for pattern, label in _VACUOUS:
            if re.search(pattern, expr, re.IGNORECASE):
                findings[f"cannot fail ({label})"].append(o)
                break

        if _SELF_ARITH.search(expr):
            findings["same attribute on both sides of an operator"].append(o)

        # Re-run the number-fidelity lane against the STORED clause text.
        fid = fidelity.number_fidelity(expr, text)
        if not fid["ok"]:
            findings["number not traceable to the clause"].append({**o, "_why": fid["complaint"]})

        if _OTHER_ACTOR.search(text) and o["obligation_type"] == "computable":
            findings["clause addresses someone other than the firm"].append(o)

        if not o["attribute_ids"]:
            findings["no attributes resolved"].append(o)

        if o["audience_id"] is None:
            findings["no audience"].append(o)

    # Register fragmentation: several attributes whose names differ only by a
    # prefix or suffix are usually one fact the funnel failed to merge.
    attrs = load(args.attributes or os.path.join(tmp, "attributes.json"))
    stems: dict[str, list[dict]] = defaultdict(list)
    for a in attrs:
        stem = re.sub(
            r"^(last_|date_of_|the_)|(_date|_last_date|_document|_report|_evidence|_details)$",
            "", a["canonical_name"],
        )
        if len(stem) > 6:
            stems[(a["data_type"], stem)].append(a)
    fragmented = {k: v for k, v in stems.items() if len(v) > 1}

    # ── report ────────────────────────────────────────────────────────────────
    print(f"document   {args.doc}")
    print(f"rules      {len(obligations)}  ({len(live)} ACTIVE)")
    print(f"attributes {len(attrs)}")
    print()
    print(f"{'finding':52s} {'rules':>6} {'of ACTIVE':>10}")
    print("-" * 72)
    for name, items in sorted(findings.items(), key=lambda kv: -len(kv[1])):
        n_live = sum(1 for o in items if o["state"] == "ACTIVE")
        pct = f"{n_live / len(live) * 100:.1f}%" if live else "-"
        print(f"{name:52s} {len(items):>6} {pct:>10}")
    if not findings:
        print("(nothing)")
    print("-" * 72)
    total_bad = {o["id"] for items in findings.values() for o in items if o["state"] == "ACTIVE"}
    print(f"{'ACTIVE rules with at least one finding':52s} {len(total_bad):>6} "
          f"{len(total_bad) / len(live) * 100:>9.1f}%")
    print(f"{'ACTIVE rules clean on every check':52s} {len(live) - len(total_bad):>6} "
          f"{(len(live) - len(total_bad)) / len(live) * 100:>9.1f}%")

    print()
    print(f"register fragmentation: {len(fragmented)} stems split across "
          f"{sum(len(v) for v in fragmented.values())} attributes")
    if args.show:
        for (dt, stem), group in sorted(
            fragmented.items(), key=lambda kv: -len(kv[1])
        )[: args.show]:
            names = ", ".join(f"{a['canonical_name']}({a['used']})" for a in group[:4])
            print(f"   {dt:9s} {stem[:28]:30s} {names[:96]}")

    if args.show:
        for name, items in sorted(findings.items(), key=lambda kv: -len(kv[1])):
            print(f"\n── {name} ──")
            for o in items[: args.show]:
                print(f"  [{o['clause_no']}] {(o['rule_expression'] or '')[:104]}")
                if o.get("_why"):
                    print(f"      {o['_why'][:104]}")
                print(f"      source: {re.sub(chr(92) + 's+', ' ', o['clause_text'] or '')[:104]}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
