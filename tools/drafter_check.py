"""D4 — Step 11 drafter hardening (run: `python tools/drafter_check.py`).

Drives the REAL validation lanes and the REAL unit contract. No Docker, no key:
every claim here is about a DETERMINISTIC decision — does this number trace to the
clause, are these two units comparable, does "six months" fingerprint as 180 days.

The verifier itself needs a model, so what is tested here is the part that must
hold whether or not one is configured: the tripwire that refers, and the CLOSED
LOOP that refuses a correction which fails the same check.
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

from app import fidelity  # noqa: E402
from app.canonical import fingerprint  # noqa: E402
from app.drafter import draft_modifiers, verify_number  # noqa: E402

passed = 0
failures: list[str] = []


def check(name: str, cond: bool, detail: str = "") -> None:
    global passed
    if cond:
        passed += 1
        print(f"  ok    {name}")
    else:
        failures.append(f"{name}{' — ' + detail if detail else ''}")
        print(f"  FAIL  {name}{' — ' + detail if detail else ''}")


def section(t: str) -> None:
    print(f"\n{t}")


IDS = {"last_audit_date": 1, "active_clients": 2, "net_worth": 3}


def fp(expression: str, audience: int | None = 4):
    return fingerprint(expression, audience_id=audience, attribute_ids=IDS)


def main() -> int:
    # ── the unit contract ─────────────────────────────────────────────────────
    section("the unit contract · STORED, COMPARED, DISPLAYED")

    half_year = fp("months_since(last_audit_date) <= 6")
    one_eighty = fp("days_since(last_audit_date) <= 180")
    ninety = fp("days_since(last_audit_date) <= 90")

    check(
        '"every six months" emerges as 180 days',
        half_year["compared_literals"] == [180],
        str(half_year["compared_literals"]),
    )
    check(
        '"annually" emerges as 360 days',
        fp("years_since(last_audit_date) <= 1")["compared_literals"] == [360],
    )
    check(
        "and the STORED expression is untouched — 6 is still 6",
        half_year["literals"] == [6] and "months_since" in half_year["canonical_expression"],
        half_year["canonical_expression"],
    )
    check(
        "six months and 180 days are the SAME rule",
        half_year["full_hash"] == one_eighty["full_hash"],
        "one duty written two ways must not become two obligations",
    )
    check(
        "six months and 90 days are the same DUTY",
        half_year["identity_hash"] == ninety["identity_hash"],
        "identity excludes literals — this is what makes it an amendment",
    )
    check(
        "but not the same VALUE",
        half_year["full_hash"] != ninety["full_hash"],
        "so Step 15 files it as an amendment rather than a new obligation",
    )
    check(
        "a non-time literal is never converted",
        fp("active_clients > 5000")["compared_literals"] == [5000],
        "5,000 clients is a count, not a duration",
    )
    check(
        "the conversion travels in hash_inputs, so a better table is a re-derivation",
        "compared_literals" in half_year,
        "changing the factors must never mean re-running the AI over the corpus",
    )

    # ── lane 1 ────────────────────────────────────────────────────────────────
    section("lane 1 · type check")

    hints = {"last_audit_date": {"data_type": "date", "unit": "days"}}
    check(
        "a well-formed rule passes",
        fidelity.type_check("days_since(last_audit_date) <= 180", hints)["ok"],
    )
    check(
        "an unknown function is caught",
        not fidelity.type_check("weeks_since(last_audit_date) <= 4", hints)["ok"],
    )
    check(
        "a token with no hint is caught",
        not fidelity.type_check("days_since(mystery_token) <= 5", {})["ok"],
    )
    check(
        "months against days is CONVERTED, not rejected",
        fidelity.commensurable("months", "days"),
        "the design is explicit: auto-convert for comparison, don't reject",
    )
    check(
        "a date against rupees is rejected",
        not fidelity.commensurable("days", "rupees"),
    )
    check("percent and count are not interchangeable", not fidelity.commensurable("percent", "count"))

    # ── lane 2 ────────────────────────────────────────────────────────────────
    section("lane 2 · modifier cross-check")

    check(
        "a target the pattern scan also found is consistent",
        fidelity.modifier_targets_seen("9.5.1", ["9.5.1", "9.5.3"])["ok"],
    )
    seen = fidelity.modifier_targets_seen("9.5.3", ["9.5.1"])
    check(
        "a target the text never mentions is flagged",
        not seen["ok"] and "9.5.3" in (seen["complaint"] or ""),
        seen["complaint"] or "",
    )
    check(
        "and it would otherwise silently restrict the WRONG rule",
        not fidelity.modifier_targets_seen("12.9", [])["ok"],
    )

    # ── lane 3 · the pool ─────────────────────────────────────────────────────
    section("lane 3 · normalising the clause the same way the rule was")

    pool = fidelity.text_numbers("at least once every 180 days, reported within 15 days")
    check("plain numbers are in the pool", {180.0, 15.0} <= pool, str(sorted(pool)))
    check(
        "word numbers become digits",
        90.0 in fidelity.text_numbers("within ninety days"),
    )
    check(
        "half-yearly stands for BOTH 6 and 180",
        {6.0, 180.0} <= fidelity.text_numbers("a half-yearly audit"),
        "a rule may reasonably write either; flagging one would make this useless",
    )
    check(
        '"2 quarters" stands for 6 months',
        6.0 in fidelity.text_numbers("fees for 2 quarters"),
    )
    check(
        "a percentage is also its decimal",
        0.1 in fidelity.text_numbers("shall not exceed 10% of net worth"),
    )
    check(
        "a POINTER is stripped, not counted as a threshold",
        4.0 not in fidelity.text_numbers("as specified in Annexure 4"),
        "without this, a rule that lifted 4 out of a pointer passes the check",
    )
    check(
        "so is a year",
        1996.0 not in fidelity.text_numbers("the SEBI (Mutual Funds) Regulations, 1996"),
    )
    check(
        "and a glued footnote marker",
        453.0 not in fidelity.text_numbers("Seventh Schedule453 shall not apply"),
    )

    # ── lane 3 · the tripwire ─────────────────────────────────────────────────
    section("lane 3 · the tripwire")

    text = "A cyber security audit shall be carried out at least once every 180 days and reported within 15 days."
    good = fidelity.number_fidelity("days_since(last_audit_date) <= 180", text)
    check("a faithful rule does not fire", good["ok"])
    bad = fidelity.number_fidelity("days_since(last_audit_date) <= 90", text)
    check("an invented number does", not bad["ok"] and bad["unexplained"] == [90.0])
    check(
        "and the complaint is SPECIFIC, not 'is this rule right?'",
        "90" in bad["complaint"] and "180" in bad["complaint"],
        bad["complaint"],
    )
    check(
        "0 and 1 are free — they are arithmetic, not thresholds",
        fidelity.number_fidelity("count(x) >= 1", "the firm shall appoint an officer")["ok"],
    )
    check(
        "a unit conversion of a pooled number is explained, not flagged",
        fidelity.number_fidelity("days_since(x) <= 14", "within two weeks")["ok"],
    )

    # ── lane 3 · the closed loop ──────────────────────────────────────────────
    section("lane 3 · the closed loop — a correction must pass the check that failed")

    check(
        "180 is admissible against this clause",
        fidelity.admissible_correction(180, text),
    )
    check(
        "77 is NOT — the model cannot invent its way out of the flag",
        not fidelity.admissible_correction(77, text),
    )
    verdict = verify_number(
        "days_since(last_audit_date) <= 90", text, bad["complaint"], bad["unexplained"]
    )
    check(
        "without a model the verifier answers cannot_tell",
        verdict["verdict"] == "cannot_tell" and not verdict["corrected"],
        f"{verdict['verdict']} / corrected={verdict['corrected']}",
    )
    check(
        "it does NOT manufacture a justification",
        "no model" in verdict["explanation"],
        "pretending to justify would invent provenance for a number nobody checked",
    )

    # The loop itself, driven directly — this is the part that must hold
    # whatever the model says.
    import app.drafter as drafter

    real_verify = drafter._verify_mock
    try:
        drafter._verify_mock = lambda e, c, cp: {
            "verdict": "wrong", "correct_value": 180, "explanation": "the clause says 180",
        }
        ok = verify_number(
            "days_since(last_audit_date) <= 90", text, bad["complaint"], [90.0]
        )
        check(
            "an ADMISSIBLE correction is applied",
            ok["corrected"] and "180" in ok["expression"],
            ok["expression"],
        )
        drafter._verify_mock = lambda e, c, cp: {
            "verdict": "wrong", "correct_value": 77, "explanation": "I think it is 77",
        }
        refused = verify_number(
            "days_since(last_audit_date) <= 90", text, bad["complaint"], [90.0]
        )
        check(
            "a correction that ALSO fails the check is refused, not applied",
            refused["verdict"] == "cannot_tell" and not refused["corrected"],
            f"{refused['verdict']}: {refused['explanation']}",
        )
        check(
            "and the expression is left exactly as drafted",
            refused["expression"] == "days_since(last_audit_date) <= 90",
        )
        drafter._verify_mock = lambda e, c, cp: {
            "verdict": "wrong", "explanation": "wrong but I won't say what is right",
        }
        vague = verify_number("days_since(x) <= 90", text, bad["complaint"], [90.0])
        check(
            "'wrong' with no replacement degrades to cannot_tell",
            vague["verdict"] == "cannot_tell",
        )
    finally:
        drafter._verify_mock = real_verify

    # ── the modifier output type ──────────────────────────────────────────────
    section("the modifier output type (built at D3, checked here)")

    for text_, effect in [
        ("The provisions of 9.5.1 shall apply only to brokers with more than 5,000 clients.", "restrict_scope"),
        ("Nothing in 12.3 shall apply to brokers with fewer than 500 active clients.", "exempt"),
        ("Paragraph 9.5.1 shall also be applicable to clearing members.", "extend_scope"),
        ("For QSBs, the period in 9.5.1 shall be 90 days.", "override_value"),
    ]:
        got = draft_modifiers(text_, "x")
        check(
            f"{effect} is emitted",
            bool(got) and got[0]["effect"] == effect,
            str([(g["effect"], g["targets"]) for g in got]),
        )
    check(
        "a plain duty emits no modifier",
        not draft_modifiers("A cyber security audit shall be carried out every 180 days.", "9.5.1"),
        "being wrong that a duty is a modifier loses the duty entirely",
    )

    print()
    if failures:
        print(f"FAILED — {passed} passed, {len(failures)} failed:")
        for f in failures:
            print(f"  - {f}")
        return 1
    print(f"PASSED — all {passed} checks green.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
