"""Step 14 fingerprints — task D6's check.

The canonicaliser and both hashes live in the AI service, because that is where
the expression parser already is. So the check lives here, next to the other
host-side harnesses, and needs no Docker and no API key.

    python tools/fingerprint_check.py

The backend half — that it passes the audience id and stores hash_inputs — is
covered separately by `npm run test:fingerprint`.
"""

from __future__ import annotations

import sys
from pathlib import Path

for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, ValueError):
        pass

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "services" / "ai-service"))

from app.canonical import canonicalise, fingerprint, hash_inputs, serialise  # noqa: E402
from app.ast_parse import parse_expression  # noqa: E402

# Registry ids, as Step 14b would supply them.
IDS = {
    "Cyber.last_audit_date": 4471,
    "Cyber.scope": 5120,
    "Broker.net_worth": 991,
    "today": 1,
}
QSB, NON_QSB = 7, 8

passed = 0
failures: list[str] = []


def check(name: str, cond: bool, detail: str = "") -> None:
    global passed
    if cond:
        passed += 1
        print(f"  ok    {name}")
    else:
        failures.append(name)
        print(f"  FAIL  {name}{'  — ' + detail if detail else ''}")


def fp(expression: str, audience: int | None, text: str | None = None) -> dict:
    return fingerprint(
        expression, audience_id=audience, attribute_ids=IDS, obligation_text=text
    )


def section(title: str) -> None:
    print(f"\n{title}")


def main() -> int:
    audit = "days_between([Cyber.last_audit_date], today)"

    section("THE BUG — two coexisting duties must not collide")
    qsb180 = fp(f"{audit} <= 180", QSB)
    non_qsb90 = fp(f"{audit} <= 90", NON_QSB)
    check(
        "QSB <=180 vs non-QSB <=90 -> identity DIFFERS",
        qsb180["identity_hash"] != non_qsb90["identity_hash"],
        f'{qsb180["identity_core"]} vs {non_qsb90["identity_core"]}',
    )
    check("and full differs too", qsb180["full_hash"] != non_qsb90["full_hash"])
    # Proof that the audience is what separates them: same expression, same
    # audience, and they collapse again — which is the pre-fix behaviour.
    same_audience = fp(f"{audit} <= 90", QSB)
    check(
        "the audience is what separates them, nothing else",
        fp(f"{audit} <= 180", QSB)["identity_hash"] == same_audience["identity_hash"],
    )

    section("AMENDMENT — same duty, moved value")
    qsb120 = fp(f"{audit} <= 120", QSB)
    check(
        "QSB <=180 vs QSB <=120 -> identity MATCHES",
        qsb180["identity_hash"] == qsb120["identity_hash"],
    )
    check(
        "...and full DIFFERS, which is what makes it an amendment",
        qsb180["full_hash"] != qsb120["full_hash"],
    )

    section("CANONICALISATION — one duty, many phrasings")
    check(
        "'180 >= x' == 'x <= 180'  (comparison flipped)",
        fp(f"180 >= {audit}", QSB)["identity_hash"] == qsb180["identity_hash"],
        fp(f"180 >= {audit}", QSB)["identity_core"],
    )
    a_and_b = fp(f"{audit} <= 180 AND [Cyber.scope] == 'cloud'", QSB)
    b_and_a = fp(f"[Cyber.scope] == 'cloud' AND {audit} <= 180", QSB)
    check(
        "'x AND y' == 'y AND x'  (commutative operands sorted)",
        a_and_b["identity_hash"] == b_and_a["identity_hash"],
    )
    check("...and their full hashes match too", a_and_b["full_hash"] == b_and_a["full_hash"])
    check(
        "parentheses and whitespace carry no meaning",
        fp(f"(  {audit}   <=  180 )", QSB)["identity_hash"] == qsb180["identity_hash"],
    )
    check(
        "OR is sorted as well",
        fp("[Cyber.scope] == 'a' OR [Broker.net_worth] > 5", QSB)["identity_hash"]
        == fp("[Broker.net_worth] > 5 OR [Cyber.scope] == 'a'", QSB)["identity_hash"],
    )
    check(
        "set members are sorted",
        fp("[Cyber.scope] IN {'a','b'}", QSB)["identity_hash"]
        == fp("[Cyber.scope] IN {'b','a'}", QSB)["identity_hash"],
    )

    section("MASKING — values are excluded from identity, kept in full")
    check(
        "a string literal is masked in identity",
        fp("[Cyber.scope] == 'cloud'", QSB)["identity_hash"]
        == fp("[Cyber.scope] == 'onprem'", QSB)["identity_hash"],
    )
    check(
        "...but not in full",
        fp("[Cyber.scope] == 'cloud'", QSB)["full_hash"]
        != fp("[Cyber.scope] == 'onprem'", QSB)["full_hash"],
    )
    check(
        "identity is built from ids, never labels",
        "#4471" in qsb180["identity_core"] and "last_audit_date" not in qsb180["identity_core"],
        qsb180["identity_core"],
    )

    section("THINGS THAT MUST *NOT* MATCH")
    check(
        "a different data-point is a different duty",
        fp("[Broker.net_worth] <= 180", QSB)["identity_hash"] != qsb180["identity_hash"],
    )
    check(
        "an operator flip is a different duty (documented, lands in review)",
        fp(f"{audit} >= 180", QSB)["identity_hash"] != qsb180["identity_hash"],
    )
    check(
        "an ADDED condition changes identity — the structural-amendment blind spot",
        a_and_b["identity_hash"] != qsb180["identity_hash"],
    )
    check(
        "a missing audience does not silently equal audience 7",
        fp(f"{audit} <= 180", None)["identity_hash"] != qsb180["identity_hash"],
    )

    section("ATTESTABLE PROSE — the documented fallback")
    prose = fp("shall maintain adequate systems and procedures", QSB,
               "shall maintain adequate systems and procedures")
    check("does not parse, and says so", not prose["valid"] and not prose["structural"])
    check("still yields a usable identity", bool(prose["identity_hash"]))
    check(
        "same sentence, different audience -> different identity",
        prose["identity_hash"]
        != fp("shall maintain adequate systems and procedures", NON_QSB,
              "shall maintain adequate systems and procedures")["identity_hash"],
    )
    check(
        "whitespace and case do not change it",
        prose["identity_hash"]
        == fp("Shall   maintain ADEQUATE systems and procedures", QSB,
              "Shall   maintain ADEQUATE systems and procedures")["identity_hash"],
    )

    section("14d — the hashes are recomputable")
    stored = hash_inputs(qsb180)
    check(
        "hash_inputs carries audience, ids, tree and literals",
        stored["audience_id"] == QSB
        and stored["attribute_ids"] == [1, 4471]
        and stored["canonical_tree"] is not None
        and stored["literals"] == [180],
        str(stored),
    )
    # A registry migration renumbers ids; re-deriving must reproduce the shape
    # without re-reading the PDF.
    remapped = {**IDS, "Cyber.last_audit_date": 9999}
    rederived = fingerprint(f"{audit} <= 180", audience_id=QSB, attribute_ids=remapped)
    check(
        "re-deriving after a renumber changes the hash but not the structure",
        rederived["identity_hash"] != qsb180["identity_hash"]
        and rederived["canonical_tree"] == qsb180["canonical_tree"],
    )

    section("determinism")
    repeats = {fp(f"{audit} <= 180", QSB)["identity_hash"] for _ in range(25)}
    check("25 runs, one hash", len(repeats) == 1)
    tree = canonicalise(parse_expression(f"{audit} <= 180").tree)
    check(
        "serialisation is stable across calls",
        serialise(tree, mask=True, ids=IDS) == serialise(tree, mask=True, ids=IDS),
    )

    print("\n" + "-" * 64)
    if failures:
        print(f"FAILED — {len(failures)} of {passed + len(failures)} checks:")
        for f in failures:
            print(f"  • {f}")
        return 1
    print(f"PASSED — all {passed} checks green.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
