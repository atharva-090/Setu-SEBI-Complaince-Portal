"""Setu AI service — Stages A–C of the ingestion spine + embeddings.

Endpoints (all internal, backend-only, gated by X-AI-Key):
- POST /parse-pdf   Stage A/A2: PDF bytes → clause tree + extraction windows
- POST /extract     Stage B/C: windows → drafted rules + deterministic AST
- POST /audience/document  Step 10a: title + opening clauses → base audience
- POST /fingerprint        Step 14: canonical tree → identity + full hashes
- POST /embed       embedding vectors (real or deterministic mock)
"""

from __future__ import annotations

import logging
from concurrent.futures import ThreadPoolExecutor

from fastapi import Depends, FastAPI, File, Form, HTTPException, Header, UploadFile

from . import audience as audience_mod
from . import canonical as canonical_mod
from . import drafter as drafter_mod
from . import judge as judge_mod
from . import fidelity as fidelity_mod
from .ast_parse import parse_expression
from .citations import extract_all
from .citations import summarise as citation_summary
from .config import settings
from .pdf import parse_pdf
from .schemas import (
    AudienceRequest,
    AudienceResponse,
    CitationOut,
    ClauseOut,
    FingerprintRequest,
    FingerprintResponse,
    FingerprintOut,
    EmbedRequest,
    EmbedResponse,
    ComposeRequest,
    ComposeResponse,
    ExtractRequest,
    ExtractResponse,
    ModifierOut,
    HeadingAudienceOut,
    HeadingAudienceRequest,
    HeadingAudienceResponse,
    JudgeAttributeRequest,
    JudgeAttributeResponse,
    ParsePdfResponse,
    RuleOut,
    ValidationOut,
    WindowResult,
)
from .segment import audit_numbering, segment, strip_secondary_script

log = logging.getLogger("uvicorn.error")

app = FastAPI(title="Setu AI Service", version="0.2.0")

_EXTRACT_CONCURRENCY = 4


def require_key(x_ai_key: str | None = Header(default=None)) -> None:
    if settings.ai_service_key and x_ai_key != settings.ai_service_key:
        raise HTTPException(status_code=401, detail="bad or missing X-AI-Key")


@app.get("/health")
def health():
    return {
        "status": "ok",
        "service": "setu-ai-service",
        "llm_provider": settings.llm_provider,
        "llm_configured": bool(settings.llm_api_key),
        "effective_drafter": drafter_mod.provider(),
    }


@app.post(
    "/audience/document",
    response_model=AudienceResponse,
    dependencies=[Depends(require_key)],
)
async def audience_document(req: AudienceRequest) -> AudienceResponse:
    """Step 10a — Pattern C. One call per document, not per clause.

    The AI translates prose into a TEST; everything after that (normalisation,
    hashing, implication) is deterministic, so the same input always resolves to
    the same audience node.
    """
    result = audience_mod.resolve_document_audience(req.title, req.clauses)
    return AudienceResponse(
        doc_id=req.doc_id,
        resolved=bool(result.get("resolved")),
        entities=result.get("entities") or [],
        predicate=result.get("predicate") or "",
        normalised=result.get("normalised") or "",
        conditions=result.get("conditions") or [],
        predicate_hash=result.get("predicate_hash"),
        label=result.get("label") or "",
        confidence=float(result.get("confidence") or 0.0),
        evidence=result.get("evidence") or "",
        provider=result.get("provider") or audience_mod.provider(),
        error=result.get("error"),
    )


@app.post(
    "/fingerprint",
    response_model=FingerprintResponse,
    dependencies=[Depends(require_key)],
)
async def fingerprint_rules(req: FingerprintRequest) -> FingerprintResponse:
    """Step 14 — canonical rewrite and the two fingerprints, in batch.

    This lives beside the expression parser rather than in the backend because
    canonicalisation IS parsing: flipping a comparison and sorting commutative
    operands are tree rewrites. A second implementation over strings is how the
    two would drift, and a drifted identity hash silently stops matching
    amendments.
    """
    results = []
    for item in req.items:
        fp = canonical_mod.fingerprint(
            item.expression,
            audience_id=item.audience_id,
            attribute_ids=item.attribute_ids,
            obligation_text=item.obligation_text,
        )
        results.append(
            FingerprintOut(
                key=item.key,
                structural=fp["structural"],
                valid=fp["valid"],
                identity_hash=fp["identity_hash"],
                full_hash=fp["full_hash"],
                identity_core=fp["identity_core"],
                canonical_expression=fp.get("canonical_expression"),
                attribute_ids=fp["attribute_ids"],
                literals=fp["literals"],
                hash_inputs=canonical_mod.hash_inputs(fp),
                error=fp.get("error"),
            )
        )
    return FingerprintResponse(results=results)


@app.post(
    "/audience/compose",
    response_model=ComposeResponse,
    dependencies=[Depends(require_key)],
)
def compose_endpoint(req: ComposeRequest):
    """Compose parent + an added condition into a normalised, hashed test.

    Exposed because Step 12 narrows audiences too, and normalisation has to
    happen in exactly one place. Two audiences describing the same set of firms
    must produce the same hash whether a chapter heading or a modifier created
    them — otherwise rung 3 misses and the rules split across two nodes.
    """
    result = audience_mod.compose(req.parent_conditions, req.added, req.relation)
    return ComposeResponse(
        ok=bool(result.get("ok")),
        normalised=result.get("normalised") or "",
        conditions=result.get("conditions") or [],
        predicate_hash=result.get("predicate_hash"),
        error=result.get("error"),
    )


@app.post(
    "/audience/headings",
    response_model=HeadingAudienceResponse,
    dependencies=[Depends(require_key)],
)
def heading_audience_endpoint(req: HeadingAudienceRequest):
    """Step 10b — Pattern A. Every heading, batched.

    The cheap phrase gate was measured and deleted (decision 63): it scored 0 of
    148 and 0 of 64 real headings, and its failure mode was silent — a section
    inheriting the wrong audience misfiles every rule beneath it. So every
    heading is sent, and the classifier answers "topic" for most of them.
    """
    results = []
    for h in req.headings:
        try:
            r = audience_mod.classify_heading(
                h.heading, h.ancestry, h.opening, h.parent_predicate, h.parent_conditions
            )
        except Exception as exc:  # one bad heading must not fail the document
            log.warning("heading classify failed for %r: %s", h.heading[:60], exc)
            r = {"is_audience": False, "resolved": False, "error": str(exc)}
        results.append(
            HeadingAudienceOut(
                idx=h.idx,
                heading=h.heading,
                is_audience=bool(r.get("is_audience")),
                resolved=bool(r.get("resolved")),
                label=r.get("label"),
                condition=r.get("condition"),
                relation=r.get("relation"),
                normalised=r.get("normalised") or "",
                conditions=r.get("conditions") or [],
                predicate_hash=r.get("predicate_hash"),
                confidence=float(r.get("confidence") or 0.0),
                why=r.get("why"),
                new_property=r.get("new_property"),
                error=r.get("error"),
            )
        )
    return HeadingAudienceResponse(
        doc_id=req.doc_id, provider=audience_mod.provider(), results=results
    )


@app.post("/parse-pdf", response_model=ParsePdfResponse, dependencies=[Depends(require_key)])
async def parse_pdf_endpoint(
    file: UploadFile = File(...),
    doc_id: str = Form(...),
):
    data = await file.read()
    if not data:
        raise HTTPException(status_code=400, detail="empty file")
    try:
        lines, pages = parse_pdf(data)
    except Exception as exc:  # fitz raises generic errors on broken PDFs
        raise HTTPException(status_code=422, detail=f"PDF parse failed: {exc}") from exc

    # Language pass BEFORE segmentation: a bilingual circular carries the clause
    # numbers twice, and the Hindi copies come first (see strip_secondary_script).
    raw_lines = len(lines)
    lines = strip_secondary_script(lines)

    clauses = segment(lines)

    # Numbering audit. If it de-glues any missed-split clauses, re-segment on the
    # patched lines and re-audit — the once-glued clauses now parse cleanly, so
    # only genuine gaps/cross-refs remain in the final report.
    audit, patched = audit_numbering(clauses, lines)
    if patched is not None:
        lines = patched
        clauses = segment(lines)
        audit, _ = audit_numbering(clauses, lines)

    cites_by_idx = extract_all(clauses)

    out = [
        ClauseOut(
            idx=c.idx, kind=c.kind, clause_no=c.clause_no, heading=c.heading,
            parent_idx=c.parent_idx, page=c.page, depth=c.depth,
            char_start=c.char_start, char_end=c.char_end, text=c.text,
            is_leaf=c.is_leaf, normative=c.normative, junk=c.junk, path=c.path,
            is_title=c.is_title, title_text=c.title_text,
            window_text=c.window_text,
            # Step 16 extraction. It happens HERE, beside segmentation, because
            # by the time rules exist the wording that produced them has been
            # rewritten and the reference strings are gone.
            citations=[CitationOut(**cite.to_dict()) for cite in cites_by_idx.get(c.idx, [])],
        )
        for c in clauses
    ]
    stats = {
        "pages": pages,
        "lines": len(lines),
        "lines_dropped_secondary_script": raw_lines - len(lines),
        "clauses": len(out),
        "sent": sum(1 for c in out if c.window_text),  # blocklist: what reaches the AI
        "junk": sum(1 for c in out if c.junk),
        "normative": sum(1 for c in out if c.normative),  # keyword-signal tag count
        "titled": sum(1 for c in out if c.is_title),  # 1 when the title was found
        **{f"citation_{k}": v for k, v in citation_summary(cites_by_idx).items() if not isinstance(v, dict)},
        "numbering_repaired": audit.get("repaired", 0),
        "numbering_flagged": audit.get("flagged", 0),
        "chars": out[-1].char_end if out else 0,
    }
    log.info("parse-pdf %s: %s", doc_id, stats)
    return ParsePdfResponse(doc_id=doc_id, pages=pages, clauses=out, stats=stats, audit=audit)


@app.post("/extract", response_model=ExtractResponse, dependencies=[Depends(require_key)])
def extract_endpoint(req: ExtractRequest):
    provider = drafter_mod.provider()
    model = "heuristic" if provider == "mock" else settings.llm_model_large

    def run(window) -> WindowResult:
        try:
            drafts = drafter_mod.draft_rules(window.window_text, window.clause_no)
        except Exception as exc:
            log.warning("extract failed for clause %s: %s", window.clause_no, exc)
            return WindowResult(idx=window.idx, clause_no=window.clause_no, error=str(exc))
        rules = []
        for d in drafts:
            ast = parse_expression(str(d.get("rule_expression", "")))
            expression = str(d.get("rule_expression", ""))
            hints = d.get("attribute_hints") or {}
            confidence = float(d.get("confidence", 0.5))

            # ── Step 11d — the three lanes, deterministic first ──────────────
            #
            # Lane 3 is a TRIPWIRE, not a judge: it decides who gets looked at.
            # Measured over the SEBI corpus it fires on 0.0% of mock-drafted
            # rules and catches 60 of 60 planted inventions, which is what keeps
            # the verifier cheap and high-signal.
            typ = fidelity_mod.type_check(expression, hints)
            fid = fidelity_mod.number_fidelity(expression, window.window_text or "")
            validation = ValidationOut(
                type_ok=typ["ok"],
                type_problems=typ["problems"],
                numbers_ok=fid["ok"],
                unexplained=fid["unexplained"],
                pool=fid["pool"][:20],
                complaint=fid.get("complaint"),
            )
            if not fid["ok"]:
                verdict = drafter_mod.verify_number(
                    expression,
                    window.window_text or "",
                    fid["complaint"],
                    fid["unexplained"],
                )
                validation.verdict = verdict["verdict"]
                validation.explanation = verdict["explanation"]
                validation.corrected = verdict["corrected"]
                if verdict["corrected"]:
                    # The correction already passed the check that failed —
                    # verify_number refuses one that does not.
                    expression = verdict["expression"]
                    ast = parse_expression(expression)
                # A rule the verifier could not justify must not read as trusted.
                if verdict["verdict"] != "justified":
                    confidence = min(confidence, 0.4)

            rules.append(
                RuleOut(
                    title=str(d.get("title", ""))[:300],
                    rule_expression=expression,
                    result_pass=str(d.get("result_pass", "Compliant")),
                    result_fail=str(d.get("result_fail", "Non-Compliant")),
                    attribute_hints=hints,
                    obligation_type=str(d.get("obligation_type", "computable")),
                    context=str(d.get("context", "")),
                    source_clause=str(d.get("source_clause") or window.clause_no or ""),
                    confidence=confidence,
                    precondition=(d.get("precondition") or None),
                    inferred=[str(x) for x in (d.get("inferred") or [])],
                    validation=validation,
                    ast=ast.to_dict(),
                )
            )
        # Step 12's input. Drafted in the same pass because it reads the same
        # window, but consumed much later: assembly cannot run until EVERY
        # window has been drafted, so nothing here waits on anything.
        try:
            mods = drafter_mod.draft_modifiers(window.window_text, window.clause_no)
        except Exception as exc:  # a modifier miss must never lose the rules
            log.warning("modifier draft failed for clause %s: %s", window.clause_no, exc)
            mods = []
        return WindowResult(
            idx=window.idx,
            clause_no=window.clause_no,
            rules=rules,
            modifiers=[
                ModifierOut(
                    targets=str(m.get("targets") or ""),
                    effect=str(m.get("effect") or ""),
                    condition_kind=str(m.get("condition_kind") or "scope"),
                    condition=m.get("condition"),
                    scope_note=m.get("scope_note"),
                    value=str(m["value"]) if m.get("value") is not None else None,
                    confidence=float(m.get("confidence") or 0.0),
                    raw=str(m.get("raw") or "")[:400],
                )
                for m in mods
                if m.get("targets") and m.get("effect")
            ],
        )

    if provider == "mock":
        results = [run(w) for w in req.windows]
    else:
        with ThreadPoolExecutor(max_workers=_EXTRACT_CONCURRENCY) as pool:
            results = list(pool.map(run, req.windows))

    return ExtractResponse(doc_id=req.doc_id, drafter=provider, model=model, results=results)


@app.post("/embed", response_model=EmbedResponse, dependencies=[Depends(require_key)])
def embed_endpoint(req: EmbedRequest):
    if not req.texts:
        return EmbedResponse(embeddings=[], model=settings.embedding_model, mock=False)
    vectors, is_mock = drafter_mod.embed_texts(req.texts)
    model = "pseudo-sha256" if is_mock else settings.embedding_model
    return EmbedResponse(embeddings=vectors, model=model, mock=is_mock)


@app.post("/judge/attribute", response_model=JudgeAttributeResponse, dependencies=[Depends(require_key)])
def judge_attribute_endpoint(req: JudgeAttributeRequest):
    verdict = judge_mod.judge_attribute(
        req.token.model_dump(),
        [c.model_dump() for c in req.candidates],
    )
    return JudgeAttributeResponse(**verdict)
