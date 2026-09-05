"""Token and cost accounting for the live LLM run.

Every estimate in TASKS.md about what a real run costs was arithmetic on
character counts. This records what actually happened, per model, so the decision
about whether to run the full document is made on a measured number rather than
on my multiplication.

Process-local and in-memory: it resets when the container restarts, which is the
right scope — the question it answers is "what did THIS run cost", not "what have
we ever spent". The provider's own dashboard is the authority on the bill.
"""

from __future__ import annotations

import threading
from collections import defaultdict
from typing import Any

# USD per 1,000,000 tokens, (input, output).
#
# ⚠️ Hard-coded from the vendor's published rates and NOT fetched from anywhere.
# They change. The dashboard is the authority; this is here so a run reports a
# number in the same breath as the token counts, and it is labelled as an
# estimate everywhere it surfaces.
PRICES: dict[str, tuple[float, float]] = {
    "gpt-4o": (2.50, 10.00),
    "gpt-4o-mini": (0.15, 0.60),
    "gpt-4.1": (2.00, 8.00),
    "gpt-4.1-mini": (0.40, 1.60),
    "gpt-4.1-nano": (0.10, 0.40),
    "text-embedding-3-small": (0.02, 0.0),
    "text-embedding-3-large": (0.13, 0.0),
}

_lock = threading.Lock()
_tally: dict[str, dict[str, int]] = defaultdict(
    lambda: {"calls": 0, "input": 0, "output": 0, "cached_input": 0}
)


def record(model: str, usage: Any) -> None:
    """Record one API response's usage. Never raises — accounting must not be
    able to fail a run that has already been paid for."""
    if usage is None:
        return
    try:
        prompt = int(getattr(usage, "prompt_tokens", 0) or 0)
        completion = int(getattr(usage, "completion_tokens", 0) or 0)
        cached = 0
        details = getattr(usage, "prompt_tokens_details", None)
        if details is not None:
            cached = int(getattr(details, "cached_tokens", 0) or 0)
    except Exception:  # pragma: no cover - defensive
        return
    with _lock:
        row = _tally[model]
        row["calls"] += 1
        row["input"] += prompt
        row["output"] += completion
        row["cached_input"] += cached


def _cost(model: str, row: dict[str, int]) -> float:
    price = PRICES.get(model)
    if not price:
        return 0.0
    per_in, per_out = price
    # A cached input token bills at half rate on OpenAI. Counted explicitly
    # rather than ignored, because the system prompt is identical on every one
    # of a few thousand calls and that is most of the input volume.
    billable_in = (row["input"] - row["cached_input"]) + row["cached_input"] * 0.5
    return billable_in / 1e6 * per_in + row["output"] / 1e6 * per_out


def report() -> dict[str, Any]:
    with _lock:
        models = {m: dict(r) for m, r in _tally.items()}
    out: dict[str, Any] = {"models": {}, "totals": {
        "calls": 0, "input": 0, "output": 0, "cached_input": 0, "estimated_usd": 0.0,
    }}
    for model, row in sorted(models.items()):
        cost = _cost(model, row)
        out["models"][model] = {
            **row,
            "estimated_usd": round(cost, 4),
            "priced": model in PRICES,
        }
        for k in ("calls", "input", "output", "cached_input"):
            out["totals"][k] += row[k]
        out["totals"]["estimated_usd"] += cost
    out["totals"]["estimated_usd"] = round(out["totals"]["estimated_usd"], 4)
    out["note"] = (
        "estimate from hard-coded rates; the provider dashboard is the authority"
    )
    return out


def reset() -> None:
    with _lock:
        _tally.clear()
