"""Stage M3 — the Attribute Judge (scope §5 Stage D / TASKS.md M3).

Fires ONLY on the ambiguous leftovers of the attribute funnel: a new token whose
nearest existing attribute sits in the middle band (meaning-distance 0.15–0.45), or
one that collides on name with an existing attribute (the same-name tripwire). Every
obvious case (very near → reuse, very far → new) is decided deterministically upstream
and never reaches here.

The single question: is this new data-point the SAME as any candidate? Judged by
*meaning and topic only* — never by name (two circulars spelling the same duty
differently must still merge; two different duties sharing a token name must not).

Two providers, mirroring the drafter:
- real: one tiny forced tool-call, temperature 0.
- mock: deterministic meaning-overlap + topic match, pinned confidence 0.55.
"""

from __future__ import annotations

import json
import re
from typing import Any

from .config import settings
from .drafter import provider  # same mock/real switch as the drafter
from . import usage
from .llm import _client

# ── mock judge ────────────────────────────────────────────────────────────────

_WORD = re.compile(r"[a-z0-9]+")
_STOP = {"the", "of", "and", "to", "a", "in", "for", "by", "date", "last", "that",
         "this", "must", "which", "was", "were", "has", "have", "with", "supply"}


def _words(s: str | None) -> set[str]:
    return {w for w in _WORD.findall((s or "").lower()) if len(w) > 2 and w not in _STOP}


def _norm(s: str | None) -> str:
    return re.sub(r"[^a-z0-9]+", "_", (s or "").lower()).strip("_")


def _judge_mock(token: dict[str, Any], candidates: list[dict[str, Any]]) -> dict[str, Any]:
    tw = _words(token.get("meaning"))
    ttopic = _norm(token.get("topic"))
    best_i, best = -1, 0.0
    for i, c in enumerate(candidates):
        cw = _words(c.get("description"))
        inter = len(tw & cw)
        union = len(tw | cw) or 1
        jac = inter / union
        topic_match = ttopic != "" and _norm(c.get("category")) == ttopic
        score = jac + (0.2 if topic_match else 0.0)
        if score > best:
            best, best_i = score, i
    same = best >= 0.55  # needs strong meaning overlap; name is deliberately ignored
    return {
        "match_index": best_i if same else -1,
        "same": same,
        "reason": f"meaning-overlap score {best:.2f} (mock judge)",
        "confidence": 0.55,
        "judge": "mock",
    }


# ── real judge ────────────────────────────────────────────────────────────────

_SYSTEM = """You are a data-dictionary de-duplicator for a compliance system.
You are given ONE new data-point (name, meaning, topic) and up to three existing
candidate attributes. Decide whether the new data-point is the SAME real-world
data-point as any candidate.

Rules:
- Judge ONLY by meaning and topic. IGNORE the names entirely — two circulars may
  spell the same duty differently, and two different duties may share a token name.
- "Same" means a broker would fill in the exact same value for both. If a broker
  would supply two different values (e.g. a cyber-audit date vs a statutory financial
  audit date), they are DIFFERENT even if the names match.
- If none clearly matches, return match_index -1.
Answer ONLY via the `decide_attribute` function."""

_DECIDE_TOOL = {
    "type": "function",
    "function": {
        "name": "decide_attribute",
        "description": "Return which candidate (if any) is the same data-point.",
        "parameters": {
            "type": "object",
            "properties": {
                "match_index": {
                    "type": "integer",
                    "description": "0-based index of the same candidate, or -1 if none.",
                },
                "reason": {"type": "string"},
                "confidence": {"type": "number"},
            },
            "required": ["match_index", "reason", "confidence"],
        },
    },
}


def _judge_real(token: dict[str, Any], candidates: list[dict[str, Any]]) -> dict[str, Any]:
    lines = [
        f"NEW DATA-POINT:\n  name: {token.get('name')}\n  meaning: {token.get('meaning')}\n  topic: {token.get('topic')}",
        "\nCANDIDATES:",
    ]
    for i, c in enumerate(candidates):
        lines.append(
            f"  [{i}] name: {c.get('name')} | topic: {c.get('category')} | meaning: {c.get('description')}"
        )
    resp = _client().chat.completions.create(
        model=settings.llm_model_small,
        temperature=0,
        messages=[
            {"role": "system", "content": _SYSTEM},
            {"role": "user", "content": "\n".join(lines)},
        ],
        tools=[_DECIDE_TOOL],
        tool_choice={"type": "function", "function": {"name": "decide_attribute"}},
    )
    usage.record(settings.llm_model_small, getattr(resp, "usage", None))
    calls = resp.choices[0].message.tool_calls or []
    if not calls:
        return {"match_index": -1, "same": False, "reason": "no tool call", "confidence": 0.0, "judge": settings.llm_provider}
    payload = json.loads(calls[0].function.arguments)
    idx = int(payload.get("match_index", -1))
    same = 0 <= idx < len(candidates)
    return {
        "match_index": idx if same else -1,
        "same": same,
        "reason": str(payload.get("reason", ""))[:400],
        "confidence": float(payload.get("confidence", 0.5)),
        "judge": settings.llm_provider,
    }


def judge_attribute(token: dict[str, Any], candidates: list[dict[str, Any]]) -> dict[str, Any]:
    if not candidates:
        return {"match_index": -1, "same": False, "reason": "no candidates", "confidence": 1.0, "judge": provider()}
    if provider() == "mock":
        return _judge_mock(token, candidates)
    return _judge_real(token, candidates)


# ─────────────────────────────────────────────────────────────────────────────
# Step 10, rung 6 — the audience judge
#
# Reached only for the genuinely ambiguous middle: rung 3 proved nothing, rung 4
# proved nothing, and rung 5 found something CLOSE. The question asked is
# deliberately narrow, and it is asked about the TEST and the meaning, never the
# name -- matching by name is the one thing the whole step exists to avoid.
#
# ⚠️ A "yes" here merges two groups of firms. That is the duplicate-branch
# failure in reverse: wrongly merging puts one group's duties on another, and
# nothing downstream detects it. So the prompt is told that "different" is the
# safe answer and that it should be given whenever the tests are not clearly
# describing the same set.
# ─────────────────────────────────────────────────────────────────────────────

AUDIENCE_JUDGE_PROMPT = """You decide whether two descriptions name the SAME SET OF FIRMS.

You are given one new audience and up to three existing ones, each with a test
over firm properties and a short label.

Judge by the TEST and what it means, never by the label. Two labels can read
alike and select different firms; two very different labels can select the same
firms.

Answer "same" ONLY when you are confident the two tests select the same firms.
If the sets merely overlap, or one is narrower than the other, or you cannot
tell, answer "different" -- a narrower group is a separate audience, not a match.

Merging two groups wrongly puts one group's obligations onto another and nothing
downstream can detect it. "different" is the safe answer and costs only an extra
node in the register."""

JUDGE_AUDIENCE_TOOL = {
    "type": "function",
    "function": {
        "name": "judge_audience",
        "description": "Are these the same set of firms?",
        "parameters": {
            "type": "object",
            "properties": {
                "same": {"type": "boolean"},
                "match_index": {
                    "type": "integer",
                    "description": "index of the matching candidate, or -1",
                },
                "confidence": {"type": "number"},
                "why": {"type": "string"},
            },
            "required": ["same", "match_index", "confidence"],
        },
    },
}


def judge_audience(candidate: dict, existing: list[dict]) -> dict:
    """Rung 6. Returns {same, match_index, confidence, why}."""
    if provider() == "mock":
        # Without a model there is no judgement to make. "different" is the
        # answer that cannot silently merge two groups of firms.
        return {
            "same": False,
            "match_index": -1,
            "confidence": 0.0,
            "why": "no model configured; not merged",
            "provider": "mock",
        }

    lines = [
        f"NEW AUDIENCE\n  label: {candidate.get('label')}\n  test: {candidate.get('predicate')}",
        "\nEXISTING AUDIENCES",
    ]
    for i, e in enumerate(existing):
        lines.append(f"  [{i}] label: {e.get('label')}\n      test: {e.get('predicate')}")
    resp = _client().chat.completions.create(
        model=settings.llm_model_small,
        temperature=0,
        messages=[
            {"role": "system", "content": AUDIENCE_JUDGE_PROMPT},
            {"role": "user", "content": "\n".join(lines)},
        ],
        tools=[JUDGE_AUDIENCE_TOOL],
        tool_choice={"type": "function", "function": {"name": "judge_audience"}},
    )
    usage.record(settings.llm_model_small, getattr(resp, "usage", None))
    calls = resp.choices[0].message.tool_calls or []
    if not calls:
        return {"same": False, "match_index": -1, "confidence": 0.0, "why": "no answer"}
    out = json.loads(calls[0].function.arguments)
    out["provider"] = provider()
    return out
