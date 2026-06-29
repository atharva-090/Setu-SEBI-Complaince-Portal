# Setu — Build Tasks (2-week hackathon) · SEBI Compliance Portal

> Ordered, milestone-by-milestone build plan. **Build order rule:** always keep a
> runnable vertical slice. Each milestone (M0–M9) ends in a demoable state.
> Companion spec: [docs/extraction-and-attribute-resolution-scope.md](docs/extraction-and-attribute-resolution-scope.md).
>
> **Product:** SEBI's central portal. SEBI maintains **one canonical regulatory graph**;
> intermediaries **self-register** and each gets a **personalised dashboard** computed
> from the same rules against their own data. Two roles: `sebi_admin`, `intermediary`.
> Core principle: **global rule (SEBI-owned) vs per-tenant state**.
>
> **Demo north-star:** SEBI approves an amendment on the console → **2–3 registered
> intermediary dashboards recompute live, each flipping differently** by their own
> data/profile. Timer on screen: "issued once → propagated to everyone."
>
> Tags: `[infra]` `[data]` `[be]` backend(NestJS) `[ai]` ai-service(FastAPI) `[fe]` frontend(Next.js)
> Size: **S** ≤30min · **M** ~1–2h · **L** ~half day

---

## M0 — Foundations & scaffold  *(get all containers talking)*

- [x] `[infra]` Monorepo: `services/backend`, `services/ai-service`, `frontend`, `shared/types`, `infra/docker`. **S**
- [x] `[infra]` `docker-compose.yml`: `postgres` (`pgvector/pgvector:pg16`), `mongodb`, `backend`, `ai-service`, `frontend`, `pgadmin`. Healthchecks + one network + hot-reload volumes. **M**
- [x] `[infra]` `.env.example` + `.env` (DB creds, `AI_SERVICE_URL`, `JWT_SECRET`, `LLM_API_KEY`, `LLM_MODEL_*`). **S**
- [x] `[be]` NestJS skeleton: `/health`, `api/v1` prefix, Swagger, TypeORM → postgres. **M**
- [x] `[ai]` FastAPI skeleton: `/health`, env settings, LLM + embedding clients (pluggable provider). **M**
- [x] `[fe]` Next.js 15 + Tailwind + shadcn/ui; base layout + "ping backend" page. **M**
- [x] `[infra]` `docker compose up` all green; backend↔ai-service↔db reachable. **S**

**✅ M0 done:** all six containers run and can reach each other.

---

## M1 — Data model, registries & auth backbone

- [x] `[data]` `infra/docker/init-db.sql`: `CREATE EXTENSION vector;` + **global** tables (`source_clauses`, `obligations`, `obligation_versions`, `attributes`, `edges`), **per-tenant** tables (`tenants`, `facts`, `evaluations`, `evidence`), **platform** tables (`users`, `audit_log`, `ingestion_runs`, `cache`). **L**
- [x] `[data]` pgvector columns (`attributes.embedding`, `obligations.embedding`) + **HNSW** (cosine); indexes on `attributes(canonical_name)`, GIN `attributes.aliases`, `obligations(identity_hash)`, `edges(from_id)`, `evaluations(tenant_id)`. **M**
- [x] `[be]` TypeORM entities + repos for every table; align with `shared/types`. **L**
- [x] `[be]` `shared/types`: `Obligation`, `Attribute`, `Fact`, `Evaluation`, `Edge`, `ClauseNode`, `ChangeSet`, `Tenant`, `User`, `Role` + enums. **M**
- [x] `[be]` **Auth backbone:** `@nestjs/jwt` + `passport-jwt`; login issues JWT with `role`; global `JwtAuthGuard` + `@Roles()` decorator + `RolesGuard`. **M**
- [x] `[be]` Intermediary **self-registration** endpoint: create `users(role=intermediary)` + a `tenants` row (name, category). **M**
- [x] `[be]` Seed: 1 `sebi_admin`; 2–3 intermediary tenants (one QSB, one small broker). **S**

**✅ M1 done:** schema applies; can register/login and get a role-scoped JWT.

---

## M2 — Ingestion spine (SEBI side: PDF → global obligations)

- [ ] `[ai]` PDF → clause tree: PyMuPDF text+layout; strip headers/footers; de-hyphenate. **L**
- [ ] `[ai]` Structural segmentation by numbering grammar (`^\d+(\.\d+)*` + font cues) → tree with `parent_id`, `page`, `char_start/end`. **L**
- [ ] `[ai]` Extraction window = clause leaf + ancestor chain. **M**
- [ ] `[ai]` `POST /extract`: Step-1 **Rule Drafter** (structured output: `rule_expression`, `result_pass/fail`, `attribute_hints`, `context`, `confidence`). **L**
- [ ] `[ai]` Expression **AST parse** → `{functions, identifiers, literals}`; builtins whitelist. **M**
- [ ] `[ai]` `POST /embed`: embedding vector(s) for text(s). **S**
- [ ] `[be]` `POST /circulars` (sebi_admin only) → file ref in Mongo + `ingestion_runs` row. **M**
- [ ] `[be]` Ingestion orchestration (synchronous): `/extract` → store `source_clauses` + **global** `obligations`; update run status per stage. **L**
- [ ] `[be]` SSE `GET /ingestion/:id/stream` for pipeline progress. **M**

**✅ M2 done:** SEBI admin uploads a chapter → global `obligations` exist with rule expressions + source spans.

---

## M3 — Attribute resolution (the funnel + context guard)

- [ ] `[be]` Candidate retrieval per identifier: Lane 1 name/alias SQL; Lane 2 pgvector meaning search (top-5, context boost). **L**
- [ ] `[be]` Decision logic + thresholds (REUSE / NEW / JUDGE) per scope-doc §6. **M**
- [ ] `[ai]` `POST /judge/attribute`: tiny input (new attr + ≤3 candidates) → `{same, reason, confidence}`. **M**
- [ ] `[be]` REUSE → add alias; NEW → create attribute (category from `context`); link `obligations.attribute_ids`. **M**
- [ ] `[be]` Canonical rewrite of expression; compute `identity_hash` (value excluded) + `full_hash`. **M**
- [ ] `[be]` Tests: dedup (`audit_last_date`→reuse) + false-merge (statutory vs cyber → separate). **M**

**✅ M3 done:** same data-point across circulars → one attribute + alias; same-name/different-context → two attributes.

---

## M4 — Evaluation engine (per-tenant status) — *port the Rust BRE, don't rebuild*

> Reference: `reference projects/BRE AI/Rust BRE API/bre_execution_engine/src/main.rs`
> — port `evaluate_expression` / `eval_simple_expression` / `eval_arithmetic`.
> Skip the multi-node `PolicyExecutor` (Setu obligations are single rules).

- [ ] `[be]` Port Rust expression core to TS: `[attr]` substitution, comparisons `>= <= == > <`, arithmetic with parens, `True/False`/`AND`/`OR` normalization. **L**
- [ ] `[be]` Keep result model: `pass_expression` + `fail_expression` → `pass` / `fail` / `not-sure`. **S**
- [ ] `[be]` **Fill the gaps:** (a) builtins `days_since`/`months_since`/`count`/`exists` resolved before comparison, using `as_of`; (b) real `AND`/`OR`/paren boolean combination. **M**
- [ ] `[be]` Applicability filter: `tenants.category`/`profile` → which **global** obligations apply to a tenant. **M**
- [ ] `[be]` Facts/evidence CRUD (per-tenant, keyed by `attribute_id`); intake-form metadata endpoint (applicable attributes). **M**
- [ ] `[be]` Evaluate per tenant → write `evaluations` (status + reason auto-assembled); status logic GREEN/RED/GREY/AMBER. **M**
- [ ] `[be]` Cascade: a fact change OR a rule change re-evaluates every affected obligation **for every affected tenant**. **M**

**✅ M4 done:** two seeded tenants get *different* RED/GREEN on the same obligation from their own data.

---

## M5 — Frontend: auth, role routing & the two personas

- [ ] `[fe]` Data layer: TanStack Query + API client with auth header. **M**
- [ ] `[fe]` **Login + registration** pages; token storage; **role-based routing** (sebi_admin → Console, intermediary → Dashboard); protected routes. **L**
- [ ] `[fe]` **Graph Canvas** (`react-force-graph`): nodes=obligations, colour=`evaluations.status`, edges=`edges`, cluster by category. Shared component. **L**
- [ ] `[fe]` **Clause Inspector** (shared, read-only): rule, confidence, "why red/green", provenance + highlighted source viewer (pdf.js / clause text). **L**
- [ ] `[fe]` **SEBI Console** (sebi_admin): upload circular + SSE progress; Canvas in **edit** mode. **M**
- [ ] `[fe]` **Intermediary Dashboard** (intermediary): Canvas **read-only** filtered to applicable obligations + their colours; Profile + auto-generated **deduped intake form** → writes facts → recolours. **L**

**✅ M5 done:** register as a broker → log in → see *your* coloured map → enter data → colours change. SEBI logs into a different console. *Already a portal demo.*

---

## M6 — The amendment loop (the hero, multi-tenant)  ⭐

- [ ] `[be]` Obligation matching funnel: citation + `identity_hash` + vector + keyword lanes → shortlist → weighted vote; short-circuit on confident match. **L**
- [ ] `[ai]` `POST /judge/obligation`: New / Amended / Replaced / Split + `changed_fields`. **M**
- [ ] `[be]` Deterministic diff (field comparison). **M**
- [ ] `[be]` Build **proposed change-set** (`state=PROPOSED`); impact = predicted status flips **per affected tenant**. **L**
- [ ] `[fe]` SEBI Console: affected nodes pulse; **diff cards** (old → new) with **Approve / Reject**. **L**
- [ ] `[be]` Commit on approve: apply ops, `obligation_versions`, `edges` (split_of/amends), disable superseded, **re-evaluate across all affected tenants**. **L**
- [ ] `[be]` `audit_log` hash-chain (`prev_hash` + `row_hash`). **M**
- [ ] `[fe]` On commit: **2–3 intermediary dashboards recompute live** (open side by side); on-screen timer. **M**

**✅ M6 done:** SEBI approves the scripted amendment → multiple dashboards flip differently, committed + logged. Hero shot works.

---

## M7 — Workbench, Review queue, Oversight, Audit export

- [ ] `[fe]` **Compliance Workbench** (intermediary): table of *their* obligations + status; gap queue by deadline/risk; evidence required/provided/missing. **L**
- [ ] `[be]` Audit export endpoint (JSON/CSV of the hash-chained log). **M**
- [ ] `[fe]` **Review queue** (sebi_admin): low-confidence extractions + attribute-resolution conflicts, approve/edit. **M**
- [ ] `[fe]` **SEBI Oversight** *(STRETCH)*: % compliance per obligation across all tenants; non-compliant list; amendment impact preview. **L**

**✅ M7 done:** both halves visible — SEBI's curate/oversee side and the intermediary's worklist + audit artifact.

---

## M8 — Multi-tenant seed data & demo readiness

- [ ] `[data]` Seed corpus: 2–3 chapters of the chosen master circular, fully real. **L**
- [ ] `[data]` Seed 2–3 registered intermediaries with **different** profiles + data (some passing, some breaching). **M**
- [ ] `[data]` Prepare + **pre-warm** the scripted amendment (run the real pipeline ahead, cache the verified delta for stage replay). **M**
- [ ] `[fe]` Visual polish: empty/loading/error states, canvas legend, consistent spacing across both personas. **L**

**✅ M8 done:** clean, seeded, multi-tenant app that runs the full SEBI↔intermediary story.

---

## M9 — Rehearse & pitch

- [ ] Demo script: register broker → SEBI publishes → amendment → multi-dashboard flip. Rehearse **cold** 5×. **M**
- [ ] Fallback: recorded video of the hero loop. **S**
- [ ] Pitch deck: "issued once, no divergent interpretation" + "both challenges are one graph" + market gap + timer headline. **L**
- [ ] Answers ready: hallucination, human-in-the-loop, "is it live?", scaling, who owns the data. **S**

---

## Build-discipline notes

- **Build real:** M1 auth/registration, M2–M6 (ingestion → attributes → evaluation → personas → amendment loop with multi-tenant propagation).
- **Build thin:** M7 Workbench + Review queue.
- **Stretch:** M7 SEBI Oversight; a 2nd intermediary category (IA).
- **Mock/skip:** RBAC beyond two roles, KYC of registrants, autonomous circular polling (seed the amendment), full-corpus coverage, refresh tokens, rate limiting.
- **If behind:** cut Oversight first, then Workbench evidence, then drop to 2 tenants. **Never cut M6 or the multi-tenant propagation** — that's the win.

## Suggested 2-week pacing (10 working days)

| Day | Milestone |
|---|---|
| 1 | M0 + start M1 |
| 2 | M1 (data + auth backbone + registration) |
| 3–4 | M2 (ingestion spine) |
| 5 | M3 (attribute resolution) |
| 6 | M4 (per-tenant evaluation) |
| 7 | M5 (auth UI + two personas) — **portal slice exists** |
| 8 | M6 (multi-tenant amendment loop) — **hero works** |
| 9 | M7 + M8 (workbench, seed, oversight if time) |
| 10 | M8 polish + M9 (rehearse, deck) |
