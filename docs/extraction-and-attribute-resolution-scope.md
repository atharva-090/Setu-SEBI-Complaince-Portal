# Setu — Project Scope: SEBI Compliance Portal

> **Status:** draft scope · **Owner:** Atharva · **Last updated:** 2026-06-28
>
> **Product framing:** Setu is built as **SEBI's central compliance portal**, not a
> single broker's tool. SEBI maintains **one canonical regulatory graph** (obligations
> issued once, at the source — no divergent interpretations). Intermediaries
> (stockbrokers, investment advisers, …) **register, log in, and each gets a
> personalised compliance dashboard** computed from the *same* shared rules against
> *their own* data.
>
> **Core principle that makes this cheap:** separate **the rule** (global, SEBI-owned)
> from **the compliance state** (per-tenant). The engine is identical to a single-broker
> build; multi-tenancy is mostly the existing `tenant_id` keying plus role-based views.
>
> This document specifies the pipeline that turns SEBI text into stored, executable
> obligations (two-step LLM extraction + attribute resolution), how they are evaluated
> per intermediary, and the portal's screens. It is the contract the parser, the LLM
> prompts, the database, and the frontend build against.

---

## 1. Purpose & scope

**In scope (this document):**
- Parsing a SEBI circular PDF into an addressable clause tree.
- A **two-step LLM** flow: (1) draft a rule in BRE syntax, (2) resolve its data-points to canonical attributes.
- The **attribute registry** (BRE's `categories`/`attributes` data dictionary) and the **resolution funnel** that prevents duplicate input fields while never wrongly merging different data-points.
- Storing the resulting obligation linked to canonical attributes.
- **Facts & evaluation** — how broker data (keyed by attribute id) is checked against a rule to produce a status + reason (Stage F).

- **Multi-tenant platform model** — global rules vs per-tenant compliance state; the two personas (SEBI admin, intermediary); registration + role-based views (§2, §3, §13).
- **Frontend screens & feature mapping** — which screens we build per persona and how each feature maps to the data/pipeline above (§13).

**Out of scope (covered elsewhere):**
- The obligation-level matching/classification funnel for amendments (New/Amended/Replaced/Split) — referenced here but specified in the "Intelligence Layer" doc.
- Detailed UI/UX specs, component design, and styling. §13 covers screens and feature→data mapping at planning level only.
- Production hardening: RBAC beyond two roles, refresh-token rotation, rate-limiting, KYC of registrants, payments, notifications, ingestion scheduling, deployment.

---

## 2. Context (where this fits)

Setu is a *regulatory-to-runtime compiler* delivered as a **two-sided portal**:

- **SEBI side (regulator/admin):** ingests circulars, owns and curates the **one
  canonical regulatory graph**, approves amendments. This is *dynamic regulatory
  translation* — issued once, identically, at the source.
- **Intermediary side (broker / IA, self-registered):** read-only view of the rules
  that apply to them, enters their own data/evidence, sees a **personalised
  compliance dashboard** with live status, gaps, and audit trail. This is *ongoing
  compliance management*.

Both sides run on the **same graph and the same engine** — they are two doors into
one system. That is the literal expression of "both challenges are the same graph."

**The ownership split (what makes multi-tenancy nearly free):**

| Layer | Owner | Scope |
|---|---|---|
| `obligations`, `attributes`, `edges`, `source_clauses` | SEBI | **global** (one copy) |
| `facts`, `evaluations`, `evidence` | each intermediary | **per-tenant** |
| applicability (which global rules apply) | derived | per-tenant, from profile + category |

A broker's dashboard = the global obligations **filtered by applicability**,
**evaluated against that tenant's facts**. The engine never changes per tenant.

```
PDF ─▶ clause tree ─▶ [Step-1 LLM: draft rule] ─▶ [AST parse: find attributes]
     ─▶ [Step-2: resolve attributes to registry] ─▶ store GLOBAL obligation (canonical)
                                                          │
                          per-tenant facts ─▶ evaluate ─▶ per-tenant status (dashboard)
```

---

## 3. Core design principles

1. **AI reads; rules decide.** The LLM only turns text into structure. Every
   *decision* (which attribute, what status, what changed) is made by
   deterministic code that can be explained to a regulator.
2. **Two registries, one pattern.** Obligations and attributes each have a
   canonical registry, each populated through the *same* cheap retrieval funnel
   (name/alias → meaning-vector → tiny LLM judge only when ambiguous).
3. **Context is the disambiguator.** An attribute's `category` (its context
   bucket) decides whether two same-named data-points are the same thing. Names
   never merge across contexts.
4. **Cost scales with the change, not the corpus.** The LLM never sees the whole
   registry. Per attribute we retrieve ≤5 candidates; the judge sees 1 new item +
   ≤3 candidates. Aliases make repeats free (no LLM at all).
5. **Everything is traceable.** Every stored field points back to the clause and
   character span it came from.
6. **Global rule, per-tenant state.** Rules (`obligations`/`attributes`/`edges`) are
   issued once by SEBI and shared by all; only `facts`/`evaluations`/`evidence` are
   per-tenant. Two roles — `sebi_admin` (curates the graph, approves amendments) and
   `intermediary` (read-only graph, owns their own data) — are the only access tiers.

---

## 4. Data model

### 4.1 `source_clauses` — the parsed clause tree

| column | type | source / meaning |
|---|---|---|
| `id` | serial | PK |
| `doc_id` | text | which circular |
| `clause_no` | text | regex `^\d+(\.\d+)*` at line start |
| `heading` | text | bold / larger-font line; `null` for body |
| `parent_id` | int | derived from dotted numbering (`9.3.1`→`9.3`) |
| `page` | int | from PDF layout extraction |
| `char_start`, `char_end` | int | running char offsets (power Ctrl+F highlight) |
| `text` | text | de-hyphenated, line-joined clause body |
| `embedding` | vector | embedding of `text` + ancestor chain |

**Chunking rule:** segment by the document's own numbering hierarchy, **not** by
fixed words/pages/tokens. The unit of extraction is a clause leaf **with its
sub-clauses and provisos**. Overlap is handled by carrying the **ancestor chain**
as context, not by sliding windows. Tables, definitions, cross-references and
annexures are parsed into structured rows/edges (see Chunking doc).

### 4.2 `attributes` — the canonical data dictionary (registry)

This is BRE's existing `category.attribute` dictionary. **The single source of
truth for data-points.** Everything resolves *into* this table.

```json
{
  "id": 201,
  "category": "Bureau",
  "canonical_name": "credit_score",
  "data_type": "number",
  "unit": null,
  "description": "Applicant credit bureau score",
  "aliases": ["credit_score", "cibil_score", "bureau_score"],
  "embedding": "[…meaning vector…]",
  "created_from": "DOC-XYZ#4.1"
}
```

| column | role |
|---|---|
| `category` | **context bucket** — the false-merge guard. Two same-named attributes only merge if context-compatible. |
| `canonical_name` | the chosen name used in rule expressions |
| `data_type` | `date` / `number` / `boolean` / `string` / … |
| `description` | the **meaning**; embedded for resolution (not the name) |
| `aliases` | every surface form ever resolved here — makes repeats O(1) |
| `embedding` | vector of `description` → how `audit_last_date` finds `last_audit_date` |
| `created_from` | provenance (doc#clause) |

### 4.3 `obligations` — the stored, executable rule

```json
{
  "id": 47,
  "title": "Cyber security audit at least half-yearly",
  "rule_expression": "days_since([CyberAudit.last_audit_date]) <= 182",
  "result_pass": "Compliant",
  "result_fail": "Non-Compliant",
  "attribute_ids": [305],
  "obligation_type": "computable",
  "context": "cybersecurity_audit",
  "identity_hash": "a3f9c1d4…e72b",
  "full_hash": "b7710e90…4c1a",
  "source_spans": [{ "doc_id": "DOC-MC-SB", "clause": "9.3.1", "page": 88, "char": [41053, 41205] }],
  "version": 1,
  "state": "ACTIVE",
  "confidence": 0.92
}
```

| column | source |
|---|---|
| `rule_expression` | Step-1 LLM (BRE grammar), rewritten to **canonical** refs after Step-2 |
| `attribute_ids` | resolved links (not strings) from the resolver |
| `identity_hash` | SHA-256 of `(context + action + attribute-roles)` — **value excluded** (enables amendment matching) |
| `full_hash` | identity + literal value(s) included |
| `source_spans` | from `source_clauses` |
| `state` | `ACTIVE` if `confidence ≥ threshold`, else `REVIEW` (intake queue) |

### 4.4 Supporting tables (summarised)

**Global (SEBI-owned, one copy):**
- `obligations`, `attributes`, `edges`, `source_clauses`, `obligation_versions` — the canonical regulatory graph (see §4.1–4.3).
- `edges(from, to, type)` — `amends` / `supersedes` / `split_of` / `depends_on` / `shared_evidence`.
- `obligation_versions(obligation_id, version, valid_from, valid_to, superseded_reason)` — lineage.

**Per-tenant (each intermediary owns its own rows):**
- `tenants(id, name, category, profile, created_at)` — a registered intermediary; `category` (stock_broker / investment_adviser) + `profile` (is_qsb, holds_client_funds, …) drive applicability.
- `facts(tenant_id, attribute_id, value, source, entered_by, entered_at)` — the intermediary's data, **keyed by `attribute_id`** (never a loose string).
- `evaluations(obligation_id, tenant_id, status, reason, method, evaluated_at)` — that tenant's colour + reason per obligation.
- `evidence(tenant_id, attribute_id, file_ref, valid_from, valid_to, status)` — uploaded documents for attestable obligations.

**Platform:**
- `users(id, email, password_hash, role, tenant_id)` — `role ∈ {sebi_admin, intermediary}`; `tenant_id` null for SEBI admins, set for intermediary users.
- `audit_log(seq, event, actor, before, after, clause_refs, ts, prev_hash, row_hash)` — append-only, hash-chained (covers both global rule changes and per-tenant state changes).
- `ingestion_runs(id, doc_id, status, stages, started_at)` — pipeline progress for the SEBI console.

---

## 5. The pipeline (stage by stage)

### Stage A — PDF → clause tree
Layout-aware extraction (PyMuPDF + pdfplumber; OCR fallback for scans) →
structural segmentation by numbering grammar → `source_clauses` rows. The window
sent downstream is **clause leaf + ancestor path** (e.g. `Chapter 9 › 9.3 › 9.3.1`).

### Stage B — Step-1 LLM: the Rule Drafter
**No registry is sent.** Input = one clause window. Output = a slim obligation:
the rule in BRE syntax + a one-line meaning hint per token.

```json
{
  "title": "Cyber security audit conducted at least half-yearly",
  "rule_expression": "days_since(last_audit_date) <= 182",
  "result_pass": "Compliant",
  "result_fail": "Non-Compliant",
  "attribute_hints": {
    "last_audit_date": { "data_type": "date",
      "meaning": "date the broker last completed a cyber security audit" }
  },
  "obligation_type": "computable",
  "context": "cybersecurity_audit",
  "source_clause": "9.3.1",
  "confidence": 0.92
}
```

The fat `measure` object is gone — **the rule expression is the spec.**

### Stage C — Deterministic AST parse (no LLM)
Parse `rule_expression` like code. Known builtins (`days_since`, `months_since`,
`count`, …) are ignored; remaining identifiers **are** the attributes to resolve.

```json
{ "functions": ["days_since"], "identifiers": ["last_audit_date"], "literals": [182] }
```

Attributes are **derived from the rule**, never separately hallucinated.

### Stage D — Step-2: the Attribute Resolver (the funnel, per token)
For each identifier, with its `{meaning, data_type, context}` hint:

1. **Embed the meaning** (not the name).
2. **Candidate retrieval (≤5, capped):**
   - **Lane 1 — name / alias:** exact match on `canonical_name` or `aliases`.
   - **Lane 2 — meaning vector:** nearest neighbours by `embedding <=> :meaning_emb`, with a boost for matching `context`/`category`.
3. **Decide** (see thresholds in §6): `REUSE` (+ add alias), `NEW`, or `JUDGE`.
4. **Context guard:** a name hit + a meaning mismatch + different context →
   **conflict → judge**. The judge weighs **meaning + context, not name.**

```sql
-- Lane 1
SELECT id, category FROM attributes
WHERE :name = ANY(aliases) OR canonical_name = :name;

-- Lane 2
SELECT id, category, canonical_name, description, embedding <=> :meaning_emb AS dist
FROM attributes ORDER BY dist LIMIT 5;
```

### Stage E — Canonical rewrite + store
Rewrite the expression to canonical refs and store the obligation:

```
days_since(last_audit_date) <= 182  →  days_since([CyberAudit.last_audit_date]) <= 182
```

The broker's intake form is then generated from the **resolved attributes**, so a
data-point that already exists never produces a second input field.

### Stage F — Facts & evaluation (attribute-keyed)

This is where the system stops *describing* a rule and starts *checking the
broker against it.* Three pieces: **facts**, the **evaluation**, the **result**.

**A fact** is one piece of data the broker gives about themselves, stored under
the canonical attribute **id** — never a text label:

```json
{ "tenant_id": "TEN-SHARMA", "attribute_id": 305, "value": "2025-10-15", "source": "manual_entry" }
```

Keying by `attribute_id` (not the string `"last_audit_date"`) is the payoff of the
registry: the same data-point spelled differently across circulars all resolved to
attribute `305`, so the broker enters the audit date **once** and *every* rule that
references `305` reads the same fact. Text-keyed facts would create duplicate
lockers and duplicate input boxes for the same date.

**The evaluation** hands the rule + the facts + an "as-of" date to the BRE engine:

```json
// BRE request
{ "expression": "days_since([CyberAudit.last_audit_date]) <= 182",
  "inputs": { "305": "2025-10-15" },     // facts, looked up by attribute id
  "as_of": "2026-06-28" }                // what counts as "today"

// BRE response
{ "result": false, "computed": { "days_since": 256 }, "execution_ms": 0.4 }
```

- `expression` ← `obligations.rule_expression` (canonical).
- `inputs` ← `facts`, keyed by attribute id.
- `as_of` ← normally the clock; settable to ask "were we compliant in March?" or
  "will we be compliant on this future deadline?" (time-travel).
- `computed` is kept on purpose — it is the *evidence* of the math.

**The result** is stored as a verdict that both the canvas and the worklist read:

```json
{ "obligation_id": 47, "tenant_id": "TEN-SHARMA", "status": "RED",
  "reason": "Last audit 256 days ago; limit 182.", "method": "rule_exec" }
```

- `status` ← from the engine result (see status logic below).
- `reason` ← **assembled from the numbers** (`computed.days_since` + the rule's
  limit), not written by an LLM — so it can never lie.
- `method` ← `rule_exec` for computable rules; `evidence_check` for proof-based
  obligations (document present/valid vs missing).

**Status logic:**

| condition | status |
|---|---|
| rule returns `true` | GREEN |
| rule returns `false` | RED |
| no fact entered yet for a required attribute | GREY |
| compliant now, but a deadline is within the warning window | AMBER |

**Cascade:** a fact is shared by id, so changing one fact (or a rule's limit via an
amendment) re-evaluates **every** obligation whose `attribute_ids` include it. When
the QSB amendment adds obligation `91` (`days_since([CyberAudit.last_audit_date]) <= 91`),
it reuses attribute `305` — **no new input field** — and re-runs against the existing
fact: `256 <= 91 → false → RED`. A rule that did not exist yesterday can already
judge the broker on data entered months ago.

---

## 6. Decision rules & thresholds

### Attribute resolution (per token)

| condition | action |
|---|---|
| Lane-1 name/alias hit **and** context compatible | **REUSE** (no LLM) |
| Best meaning `dist < 0.15` **and** context compatible | **REUSE**, add alias (no LLM) |
| Best meaning `dist > 0.35` (and no name hit) | **NEW** attribute |
| Name hit **but** meaning `dist` high / context differs | **JUDGE** (tiny LLM) |
| `0.15 ≤ dist ≤ 0.35` | **JUDGE** (tiny LLM) |
| Judge says `same:true` | REUSE + add alias |
| Judge says `same:false` | NEW attribute in its own category |

> Thresholds (`0.15`, `0.35`) are tunable per embedding model; calibrate on a
> labelled set during build.

### Extraction confidence

| condition | action |
|---|---|
| `confidence ≥ 0.75` | store `state = ACTIVE` (live on map) |
| `confidence < 0.75` | store `state = REVIEW` (intake queue, human confirms) |

---

## 7. LLM cost model

| call | when | input size |
|---|---|---|
| Step-1 Rule Drafter | once per clause window | 1 clause + ancestor path |
| Attribute judge | only ambiguous tokens | 1 new attr + ≤3 candidates |
| (Obligation judge — other doc) | only ambiguous obligations | 1 new obl + ≤3 candidates |

**The LLM never sees the registry or the corpus.** Embeddings are cached. Cost is
proportional to the size of the incoming circular, not the size of the system.

---

## 8. Worked example — life of O-47

1. **Onboard.** Master circular `9.3.1` → Step-1 drafts
   `days_since(last_audit_date) <= 182`. AST → token `last_audit_date`.
   Registry has nothing cyber-audit-ish (best `dist 0.71`) → **NEW** attribute
   `305 = CyberAudit.last_audit_date`. Expression rewritten to canonical;
   obligation `47` stored, `attribute_ids:[305]`.

2. **Dedup (different circular).** `DOC-CIR-77 §5.1` →
   `months_since(audit_last_date) <= 6`. Token `audit_last_date` → name miss, but
   meaning `dist 0.06` to attr `305` + same context → **REUSE 305, add alias
   `audit_last_date`.** No new input field for the user. ✅

3. **False-merge guard.** `DOC-CIR-90` references a *statutory financial* audit
   date, LLM names it `last_audit_date` (name collides with `305`). Meaning
   `dist 0.41`, context `statutory_financial_audit` ≠ `cybersecurity_audit` →
   conflict → **judge** → `same:false` → **NEW** attribute
   `312 = StatutoryAudit.last_statutory_audit_date`. Same name, never merged. ✅

4. **Amendment.** `DOC-CIR-14 §4.2` (QSB quarterly) →
   `days_since(last_audit_date) <= 91`. Token resolves via **alias** to `305`
   (no new field). Obligation funnel classifies `split` (identity-hash collision
   on `47`, scope `qsb`) → new obligation `91` reuses attribute `305`.

---

## 9. Prompt templates

### 9.1 Step-1 — Rule Drafter (system)
```
You convert a single regulatory clause into ONE OR MORE executable rules.
Output ONLY via the `emit_rules` function.
- Write each rule in BRE expression syntax using short, readable tokens.
- Copy numbers and units verbatim; never invent values.
- For each token used, give its data_type and a one-line meaning.
- Give a `context` (the topic/area) and a confidence 0-1.
Do not resolve or guess attribute IDs — tokens are placeholders.
```

### 9.2 Step-1 — function schema (simplified)
```json
{ "name": "emit_rules", "parameters": { "type": "object", "properties": {
  "rules": { "type": "array", "items": { "type": "object", "properties": {
    "title": { "type": "string" },
    "rule_expression": { "type": "string" },
    "result_pass": { "type": "string" },
    "result_fail": { "type": "string" },
    "attribute_hints": { "type": "object" },
    "obligation_type": { "enum": ["computable", "attestable"] },
    "context": { "type": "string" },
    "source_clause": { "type": "string" },
    "confidence": { "type": "number" }
  } } } } } }
```

### 9.3 Attribute judge (only on conflict)
```
Are these the SAME data point? Judge by meaning and context, NOT by name.
Return {same: bool, reason: string, confidence: number}.
```
```json
{ "new": { "name": "last_audit_date", "meaning": "last statutory financial audit date", "context": "statutory_financial_audit" },
  "candidate": { "id": 305, "category": "CyberAudit", "meaning": "last cyber security audit date" } }
```

---

## 10. Non-goals
- No fixed-size / sliding-window chunking.
- No sending the registry or full corpus to any LLM.
- No LLM making the final attribute or status decision (rules do).
- No auto-merge on name alone.

---

## 11. Open questions / to confirm
- Embedding model + exact thresholds (calibrate on labelled pairs).
- Category creation policy: auto-create from `context`, or resolve `context` to a
  category via its own small registry?
- Builtins whitelist for the expression grammar (`days_since`, `months_since`,
  `count`, `exists`, comparison/logical operators).
- Handling attestable obligations (evidence requirement instead of a computable
  expression) — same registry, `data_type: document`?

---

## 12. Glossary
- **Obligation** — one "must-do" extracted from a clause; stored as an executable rule.
- **Attribute** — a single data-point a rule references (e.g. `last_audit_date`).
- **Registry** — the canonical table (obligations or attributes) everything resolves into.
- **Alias** — an alternate surface form that resolves to a canonical entry.
- **Context / category** — the bucket that prevents same-named, different-meaning merges.
- **Funnel** — name/alias → meaning-vector → tiny judge; cheap first, LLM last.
- **Identity hash** — fingerprint of an obligation excluding its value; enables amendment matching.

---

## 13. Frontend screens & feature mapping

**Principle: one data model, two personas, shared components.** Every screen is a
projection of the §4 data. The **same Graph Canvas and Clause Inspector serve both
personas** — SEBI in *edit* mode (curate + approve), intermediaries in *read-only*
mode (their applicable subset, their colours). We are not building two products; we
are role-gating one.

| Persona | Sees | Mode |
|---|---|---|
| `sebi_admin` | full graph · ingestion · amendment approval · (oversight) | edit / approve |
| `intermediary` | their applicable obligations · their status · their data/evidence | read-only graph + own data |

```
                         ┌──────── SEBI admin ────────┐
   Login / Register ─▶   │ Ingestion/Review → Canvas  │
                         │   (edit) ⇄ Clause Inspector│
                         │        ↓ approve amendments │
                         └───────────────┬─────────────┘
                                         │ publishes ONE global graph
                         ┌───────────────▼─────────────┐
                         │      Intermediary           │
   Login / Register ─▶   │ Dashboard(Canvas read-only) │
                         │   ⇄ Clause Inspector        │
                         │ Workbench · Profile/Data    │
                         └─────────────────────────────┘
```

### Screen 0 — Login & Registration *(both personas)*
The front door. Kept minimal (basic JWT).

| Feature | Maps to |
|---|---|
| Login → JWT with role | `users.role` (`sebi_admin` / `intermediary`) |
| Intermediary self-registration | creates `users` + a `tenants` row; collects `category` |
| Role-based routing after login | SEBI → Console; intermediary → Dashboard |

### Screen 1 — Graph Canvas *(both personas — edit vs read-only)*
The living map. **This is the product's spine.** SEBI sees the full graph in edit
mode; an intermediary sees only their applicable obligations, coloured by *their*
status, with no edit/approve controls.

| Feature | Maps to | Persona |
|---|---|---|
| Nodes = obligations (label, cluster) | `obligations.title`, `obligations.context`/category | both |
| Node colour = live status (GREEN/RED/GREY/AMBER) | `evaluations.status` (Stage F) — per tenant for intermediary | both |
| Edges = relationships (`amends`/`supersedes`/`split_of`/`depends_on`) | `edges` table | both |
| Applicability filter (intermediary sees only their subset) | `tenants.profile`/`category` → applicability | intermediary |
| Hero: drop a new circular → affected nodes pulse / split / recolour | obligation funnel output as a **PROPOSED** change-set | sebi_admin |
| Diff cards (old rule → new rule) with **Approve** | change-set ops + governance + `audit_log` | sebi_admin |

> **Tech note:** a force-directed lib (`react-force-graph` / Cytoscape.js) suits
> the organic "living map" better than React Flow; reserve React Flow for the
> rule-editor canvas reused from BRE inside the Inspector.

> **Demo hero (portal version):** SEBI approves an amendment on the console → **two
> or three intermediary dashboards recompute live, each flipping differently** based
> on their own data/profile (QSB → red on the 3-month rule; small broker → stays
> green). "Issued once → propagated to everyone, instantly."

### Screen 2 — Clause Inspector *(both personas, read-only)* — side panel on node click
Where a skeptical judge confirms it's real, not a pretty diagram.

| Feature | Maps to |
|---|---|
| Original SEBI wording, verbatim, with the exact part highlighted (Ctrl+F style) | `source_clauses.text` + `source_spans` char offsets → document viewer |
| The plain executable rule | `obligations.rule_expression` + `attribute_ids` |
| Extraction confidence ("high" / "review recommended") | `obligations.confidence` |
| Provenance trail (circular no., clause, version, supersedes, effective date) | `source_spans`, `obligation_versions`, `edges` |
| "Why is this red/green?" plain-language explanation | `evaluations.reason` (auto-assembled from the numbers) |
| (Optional) small Q&A box over this obligation | graph-grounded retrieval, **not** the headline feature |

### Screen 3 — Compliance Workbench *(intermediary)* — worklist
The unglamorous half — "ongoing compliance management". A table, not a graph,
because a broker's compliance officer wants a worklist of *their* obligations.

| Feature | Maps to |
|---|---|
| Every obligation + current status | `obligations` + `evaluations` |
| Evidence required / provided / missing (attestable) | attribute of `data_type: document` + `facts` |
| Gap queue, sorted by risk/deadline | `evaluations.status = RED/AMBER` + deadlines |
| Audit-trail export (the inspection artifact) | `audit_log` (append-only, hash-chained) |

### Screen 4 — SEBI Console: Ingestion / Review *(sebi_admin only)*
Makes the canvas "magic" legible as engineering, and is the human approval gate
for anything uncertain. The regulator's workspace.

| Feature | Maps to |
|---|---|
| Upload circular + pipeline status: PDF → clauses → rules → confidence-scored | Stages A–E (`source_clauses`, Step-1 output, `ingestion_runs`) |
| Review queue: low-confidence extractions | `obligations.state = REVIEW` (confidence < 0.75) |
| Review queue: attribute-resolution conflicts | Stage D **judge** cases (same-name/different-meaning) |
| Approve / edit / reject before it joins the global graph | governance state + `audit_log` |

### Screen 5 — Intermediary Profile & Data Entry *(intermediary)*
Set during/after self-registration. Captures who the intermediary is and the facts
their applicable rules need.

| Feature | Maps to |
|---|---|
| Category + profile (QSB? holds client funds?) | `tenants.category`/`profile` → applicability filter |
| Intake form, auto-generated, deduped | fields = **resolved attributes** of *applicable* obligations (Stage E); one field per canonical attribute |
| Data / document entry | writes `facts` / `evidence` (keyed by `attribute_id`) → triggers evaluation cascade (Stage F) |

### Screen 6 — SEBI Oversight *(sebi_admin — STRETCH)*
The regulator's bird's-eye view across all registered intermediaries.

| Feature | Maps to |
|---|---|
| % compliance per obligation across all tenants | aggregate over `evaluations` |
| Which intermediaries are non-compliant / have gaps | `evaluations.status` grouped by tenant |
| Impact preview of a pending amendment across the population | change-set × per-tenant re-eval |

### Hackathon build priority
- **Build real:** Login + role routing + intermediary registration; SEBI Console (ingest + Canvas edit + diff-card approval); Clause Inspector (highlighted source viewer); the obligation→rule→evaluation path on 2–3 chapters; the amendment loop propagating to **2–3 seeded intermediary dashboards**.
- **Build thin:** Workbench (table over the same data), Review queue (a list), Profile/Data entry (a few fields).
- **Stretch:** SEBI Oversight aggregate view; a second intermediary category (IA).
- **Mock/skip:** RBAC beyond two roles, KYC of registrants, autonomous circular polling (seed the amendment), full-corpus coverage.
