"""Thin, pluggable LLM + embedding client (OpenAI-compatible).

Stateless. Used by the extraction (M2), attribute/obligation judges (M3/M6).
For M0 these are not called; this just establishes the interface.
"""

from functools import lru_cache

from openai import OpenAI

from .config import settings


@lru_cache
def _client() -> OpenAI:
    kwargs: dict = {"api_key": settings.llm_api_key or "not-set"}
    if settings.llm_base_url:
        kwargs["base_url"] = settings.llm_base_url
    return OpenAI(**kwargs)


def complete(prompt: str, *, small: bool = False, **kwargs) -> str:
    model = settings.llm_model_small if small else settings.llm_model_large
    resp = _client().chat.completions.create(
        model=model,
        messages=[{"role": "user", "content": prompt}],
        **kwargs,
    )
    return resp.choices[0].message.content or ""


def embed(texts: list[str]) -> list[list[float]]:
    resp = _client().embeddings.create(model=settings.embedding_model, input=texts)
    return [item.embedding for item in resp.data]
