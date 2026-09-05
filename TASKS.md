# Setu — Build Tasks

**Rewritten 2026-08-30**, against the frozen 17-step design in
[`docs/product-logic.md`](docs/product-logic.md) (4,530 lines, 96 numbered decisions).

Flow A — *document → rule graph* — is **designed end to end**. What remains is
construction. This file is the construction plan.

---

## The contract this file keeps

Two rules, because the last build round produced work that could only be checked by
reading it.

**1 · Every task is independently completable.** No task waits on another unless a
`DEPENDS` line says so explicitly. There is exactly **one** real prerequisite chain in
this file (`C1 → D6 → D7 → D8 → D9`); everything else can be picked up in any order.

**2 · Every task states how to prove it works, live.** Not "it compiles" — an actual
command with an expected result. If a task can't be checked by running something, it is
written wrong and needs splitting.

```
Backend tasks ship a  npm run test:<id>  that runs WITHOUT Docker,
using controlled inputs the way test/m3-attribute-funnel.ts does.
Parser tasks are checked on the host with python — no containers needed.
Docker is only required for the full end-to-end SSE run.
```

**The `test:<id>` scripts do not exist yet.** Only `test:m3` does. Adding the script and
its assertions is **part of each task**, not a separate chore — a task without its check
is not finished. `test:m3` is the working template: it drives the real service against an
in-memory registry with controlled vectors, because mock embeddings are random and can
never exercise a threshold band.

**3 · SEBI master circulars are the acceptance set.** The corpus holds eight
documents, but they are not equals. A change is judged on the four SEBI master
circulars; the other SEBI documents must not regress; the RBI document is *observed
only*. **Never make a change for the benefit of a non-SEBI document.** If a fix improves
RBI parsing and moves a single clause in a SEBI master circular, the fix is wrong —
however good the totals look.

| tier | documents | rule |
|---|---|---|
| **1** | `master-circular-stock-brokers-2024` · `master-investment-advisers-2024` · `master-mutual-funds-2024` · `master-research-analysts-2024` | **the acceptance set.** A regression here fails the task, full stop. |
| **2** | `cscrf-multi-entity-2024` · `cloud-framework-multi-entity-2023` · `circular-2024-14-mirsd` | SEBI, not master circulars. In scope, must not regress. CSCRF is where the audience taxonomy lives, so B1 and D2 are judged here. |
| **3** | `rbi-it-outsourcing-2023` | **non-SEBI. Observed, never targeted.** Useful as a canary — if a change moves RBI and nothing else, ask why. Never a reason to write code. |

This is enforced, not just written down. Tiers live in
[`corpus_check.TIER`](tools/corpus_check.py), every metrics row carries its tier, and
`snapshot.py check` **fails** on a tier-1/2 change while a tier-3 change is a warning
that exits 0. A document not listed defaults to tier 3, so a new PDF has to be promoted
deliberately before it can gate anything.

Two consequences already visible in Part E: RBI's numbering grammar is explicitly not
being supported, and Pattern B is deferred because it is CSCRF-only.

---

**Status legend** — `TODO` · `WIP` · `DONE` · `DROP` (decided against, kept for the record)

---

## Already built and working

Verified by running it, not by reading it.

| | what runs |
|---|---|
| **M0** | Docker Compose · Postgres+pgvector · MongoDB GridFS · NestJS · FastAPI · health checks |
| **M1** | 13 entities · JWT auth · role routing (`sebi_admin` / `intermediary`) · tenant scoping |
| **M2** | Upload → SHA-256 dedupe → GridFS → `parse-pdf` → clause tree → numbering audit → send/skip → windows → drafter → obligations. 4 SSE stages: `parse` · `store_clauses` · `resolve_attributes` · `store_obligations` |
| **M3** | Attribute funnel: composite embedding → pgvector top-5 → same-name tripwire → 0.15/0.45 bands → AI judge → alias provenance. **24/24 assertions green** (`npm run test:m3`) |

**AI service** — `pdf.py` · `segment.py` · `ast_parse.py` · `drafter.py` · `judge.py`,
with endpoints `/parse-pdf` · `/extract` · `/embed` · `/judge/attribute`.

**Measured on the real corpus:** QSB circular 37 tokens → 29 created / 8 reused ·
master circular 2,228 → 1,960 / 268 / 311 judged.

---

# Part A — The verification harness

**Build this first.** Every other task in this file is checked with it, and the last
version of it lived in a temp directory and was deleted by Windows.

### A1 · Permanent corpus harness `DONE`

**Why** — the measurement scripts that overturned five designs (`count_backrefs.py`,
`count_headings.py`, `corpus_survey.py`) were written to a scratchpad and are **gone**.
Every structural claim in `product-logic.md` came from them and none can be re-checked.

**Change** — [`tools/corpus_check.py`](tools/corpus_check.py), committed. Imports the
same `pdf.parse_pdf` / `segment.segment` the container calls, runs the numbering audit
and re-segment pass exactly as [main.py:71-80](services/ai-service/app/main.py#L71-L80)
does, and prints one metrics table. Modes: table · `--grep` · `--mentions` · `--titles` ·
`--json` · `--only` · `--dir`.

**Done when** — runs on the host with no Docker, covers all 8 documents, and reproduces
the two numbers `product-logic.md` was written against.

**Verify live** — *(baseline captured 2026-08-30)*
```bash
python tools/corpus_check.py
```
```
document                           pages clauses headings junked short  deva% dupNo leadin  sent
circular-2024-14-mirsd                 5      38        1      2     1    0.0     0      4    37
cloud-framework-multi-entity-2023     53     157       27      1     0   9.43    10      7   158
cscrf-multi-entity-2024              205     987      234    138    44    7.3    81     16   944
master-circular-stock-brokers-2024   419    2334      442    300   152    0.0   144     71  2183
master-investment-advisers-2024       83     214      125     45    22    0.0    46      1   192
master-mutual-funds-2024             828    2401      486    273   175    0.0   135     66  2226
master-research-analysts-2024         53     166       95     35    16    0.0    34      0   150
rbi-it-outsourcing-2023               31      31       18      6     0    0.0     9      1    32
8 documents | 6328 clauses | 800 junked (410 of them for length < 15) | 5922 sent
```
**CSCRF 7.3 and master circular 144 are the anchors** — both match `product-logic.md`
exactly. Two definitions had to be recovered to get there, and they are now pinned in
the source:

- **deva%** is the share of *nodes* carrying Devanagari, not of characters. A bilingual
  document is one where whole clauses are in Hindi. By character CSCRF is 3.34%; the
  char figure is kept as `devanagari_chars` in `--json`.
- **dupNo** is *distinct* clause numbers that repeat, counted over **every** node
  including containers — a repeat landing on a container is exactly the collision that
  makes a citation ambiguous at Step 16. Total extra occurrences (731 for the master
  circular) is `dup_extra` in `--json`.

**DEPENDS** — nothing. Needs `pip install pymupdf` on the host.

### A2 · Golden snapshots `DONE`

**Why** — a metrics table tells you a number changed. A snapshot tells you *which clause*
changed. Without it, every parser fix risks a silent regression somewhere else.

**Change** — [`tools/snapshot.py`](tools/snapshot.py) `write|check`. Each document gets
`tools/golden/<name>.json`: counts, a `tree_hash`, and one fingerprint line per clause —
`kind | clause_no | depth | junk | leaf | length | sha1(text) | heading`.

**idx and parent_idx are deliberately excluded from the fingerprint.** Both shift
wholesale when a clause is inserted early, which would turn one real change into two
thousand false ones. Depth carries the structure; the text hash catches content. Diffing
is `difflib.SequenceMatcher` over those lines, so an insertion reports as one `+ new`
rather than cascading.

Snapshots are committed on purpose: the diff in review *is* the record of what a parser
change did.

**Done when** — `check` exits non-zero on a tier-1/2 tree change and names the clauses.

**Verify live** — all four paths were run:
```bash
python tools/snapshot.py write && python tools/snapshot.py check
#  PASS - 8 clause trees identical to golden                          exit 0
```
```bash
# STUB_CHARS 15 → 10 in segment.py, then check:
  FAIL  t2  cscrf-multi-entity-2024
        nodes 1082 -> 1082   clauses 987 -> 987   junked 138 -> 121
    ~ was  clause    7.2        d2 junk     13ch
      now  clause    7.2        d2 keep     13ch
    ~ was  clause    7.3        d2 junk     12ch
      now  clause    7.3        d2 keep     12ch
    ... 17 changed regions in total                                   exit 1
```
Those two lines are B1's targets — *Qualified REs* and *Mid-size REs* — flipping
`junk → keep`. The snapshot names the clause, which is the whole point of A2 over A1.

```bash
# a tier-3 (RBI) change, injected into its golden file:
  WARN  t3  rbi-it-outsourcing-2023
    ~ was  preamble  -          d0 junk    880ch
      now  preamble  -          d0 keep    880ch
    + new  clause    2          d1 keep    218ch
  PASS with warnings - tier-3 only                                    exit 0
```
```bash
rm tools/golden/*.json && python tools/snapshot.py check
#  NO SNAPSHOT for 8: ... / run: python tools/snapshot.py write       exit 2
```
Three distinct exit codes — `0` pass · `1` SEBI regression · `2` snapshots missing or
schema-stale — so this drops into CI unchanged.

**DEPENDS** — A1 (imports its `load()` and `TIER`).

---

# Part B — Corrections to code that already runs

Each is independent, each is a measured bug, each is checked with A1.

### B1 · Step 8 — short-clause carve-out `DONE`

**Why** — `STUB_CHARS = 15` ([segment.py:46](services/ai-service/app/segment.py#L46))
deletes `"Qualified REs"` (13), `"Mid-size REs"` (12), `"Small-size REs"` (14) — **three
of CSCRF's five audience definitions.** Audience names are short by nature.

**Change** — `_taxonomy_carve_outs()` in
[segment.py](services/ai-service/app/segment.py), consulted by `_is_junk`. Three
conditions must hold **together**, because each one alone lets debris through:

1. the parent announces a list — `_LEAD_IN` against its first 300 chars
2. the text reads as a **name** — `_looks_like_a_name`
3. at least 2 siblings qualify — a taxonomy is a list, so a lone short child
   under a lead-in is a fragment

Condition 2 was forced by measurement, not guessed. The rule without it resurrected
**51 empty clauses in the stock brokers master circular** and table debris (`'crore'`,
`'nominee(s)}'`) plus form fields (`'Date of birth:'`, `'Name:'`) in mutual funds — a
tier-1 regression to fix a tier-2 document, exactly what rule 3 forbids. The separation
that held across all eight documents: a name **starts with a capital**, **does not trail
into a colon**, and is **≥80% letters**. Tombstones (`Omitted.`, `Deleted.`, `Reserved`)
are junked unconditionally, ahead of the carve-out.

**Done when** — all five CSCRF RE categories survive, and no master circular moves.

**Verify live**
```bash
python tools/corpus_check.py --grep "Qualified REs|Mid-size REs|Small-size REs"
#  cscrf  53  7.2  junk=False  13  Qualified Res     (was True)
#  cscrf  54  7.3  junk=False  12  Mid-size REs      (was True)
#  cscrf  55  7.4  junk=False  14  Small-size Res    (was True)
```
All five categories now survive — 7.1 *Market Infrastructure Institutions* and
7.5 *Self-certification REs* were always long enough:
```bash
python tools/snapshot.py check --max 30
```
```
  FAIL  t2  cscrf-multi-entity-2024
        nodes 1082 -> 1082   clauses 987 -> 987   junked 138 -> 127
    6.1 6.2 6.3 6.4 6.5 6.6   junk -> keep   the six CSF functions
    7.2 7.3 7.4               junk -> keep   the deleted RE categories
    16.6 16.8                 junk -> keep   Custodians, Depositories
  ok    t1  master-circular-stock-brokers-2024
  ok    t1  master-investment-advisers-2024
  ok    t1  master-mutual-funds-2024
  ok    t1  master-research-analysts-2024
  ok    t3  rbi-it-outsourcing-2023
```
**Eleven clauses changed, all in CSCRF, all `junk → keep`, node and clause counts
unmoved, every tier-1 document `ok`.** CSCRF metrics: `junked 138 → 127`,
`short 44 → 33`, `sent 944 → 955`. Golden re-accepted for CSCRF only.

`--grep` matches clause *labels*; `--mentions` searches whole bodies (74 rows for the
same pattern), which is why labels are the default.

**DEPENDS** — nothing (A1 made it observable, A2 proved it was surgical).

### B2 · Step 8 — stop junking the document title `DONE`

**Why** — master circulars declare their applicability *in the title*
(*"Master Circular for Stock Brokers"*). That is Pattern C's primary input, and Step 8
currently discards it as letterhead. Decision 72.

**Change** — `_document_title()` in
[segment.py](services/ai-service/app/segment.py) sets `is_title` + `title_text` on the
first preamble block; `_is_junk` returns `False` for it. Surfaced through
`ClauseOut.is_title` / `.title_text` and a `titled` stat on `/parse-pdf`.

**The title is not a node — it is a line inside the preamble**, which also holds the
filing header and the addressee list. Keeping the whole block is deliberate: the
addressee list (*"To, All Investment Advisers"*) is Pattern C's other input.

Two extraction routes, because two things can be true of a circular:

- **`Subject:` / `Sub:`** — read from the **joined** text. CSCRF's bilingual layout
  breaks its English title across *eight single-word lines* (`Cybersecurity` / `and` /
  `Cyber` / `Resilience` / …); `_join` has already reassembled them, and the marker gives
  an unambiguous start. Reading lines here returns one word.
- **no marker** (2024/14, RBI) — the line after the salutation, extended only while a
  line ends on a wrapping word (`of`, `for`, `and`, a comma). Without a marker, layout is
  the only boundary signal there is.

Stops at the Hindi half, a body enumerator (`I. Securities…`), or a sentence start.

**Done when** — all 8 documents yield a descriptive title, and nothing else moves.

**Verify live**
```bash
python tools/corpus_check.py --titles      # was 4/8 exit 1
```
```
circular-2024-14-mirsd              yes  Measures to instill trust in securities market – …
cloud-framework-multi-entity-2023   yes  Framework for Adoption of Cloud Services by SEBI …
cscrf-multi-entity-2024             yes  Cybersecurity and Cyber Resilience Framework (CSCRF) …
master-circular-stock-brokers-2024  yes  Master Circular for Stock Brokers
master-investment-advisers-2024     yes  Master Circular for Investment Advisers
master-mutual-funds-2024            yes  Master Circular for Mutual Funds
master-research-analysts-2024       yes  Master Circular for Research Analysts
rbi-it-outsourcing-2023             yes  Master Direction on Outsourcing of Information Technology Services
8/8 non-junk titles                                                   exit 0
```
The four clean `Master Circular for X` strings are exactly Pattern C's input. RBI came
out clean too — as a **side effect** of the generic wrapped-line rule, not by targeting
it; nothing in the extractor knows RBI exists.

Snapshot showed **one flip per document, in the four that used to junk the preamble**,
with node and clause counts unmoved:
```
FAIL  t2  circular-2024-14-mirsd            ~ preamble junk -> keep
FAIL  t1  master-investment-advisers-2024   ~ preamble junk -> keep
FAIL  t1  master-mutual-funds-2024          ~ preamble junk -> keep
FAIL  t1  master-research-analysts-2024     ~ preamble junk -> keep
ok    t1  master-circular-stock-brokers-2024   (already kept it)
```
**A2 was extended to protect the title itself** — `title_text` is now a fingerprint
field, so extraction can't silently degrade. Schema bumped to 2, all goldens rewritten;
the stale-schema guard forced it rather than letting the check pass on old data. Proved
by shortening `MAX_TITLE_CHARS` and re-running:
```
~ was  preamble  -  d0 keep  197ch  title="Master Circular for Research Analysts"
  now  preamble  -  d0 keep  197ch  title="Master Circular for"          exit 1
```

**DEPENDS** — nothing. **Blocks** D1 (Pattern C reads `title_text`). **Note for C1**:
persisting `is_title`/`title_text` needs a `clauses` column; today it lives only in the
`/parse-pdf` response.

### B3 · Step 6 — bilingual language pass `DONE`

**Why** — CSCRF is **7.3% Devanagari, interleaved**. Every clause number appears twice
with different text, producing two competing trees. Decision 65.

**Change** — `strip_secondary_script()` in
[segment.py](services/ai-service/app/segment.py), applied in `main.py` **after
`parse_pdf`, before `segment`**, and mirrored in the harness loader. Removes the
Devanagari runs from each line, tidies the separators left behind
(`( ) / All Depositories` → `All Depositories`), and drops the line only if fewer than 3
Latin characters survive. A line with no Devanagari is returned untouched, so the six
monolingual documents **cannot** be affected.

**Per line, not per block.** The task said "partition lines by script", but the two
languages share lines: `सभी समाशोधन तनगम / All Clearing Corporations` is one line holding
both. A block split — or any ratio threshold — loses the English half; one such line is
89% Devanagari and its English half is the operative text. Removing the runs handles both
shapes with one rule.

English is kept because it is the operative text, and every downstream stage — drafter,
attribute registry, expression grammar — is English-only.

**Done when** — Devanagari is 0 everywhere, CSCRF duplicates drop, and no English is lost.

**Verify live**
```bash
python tools/corpus_check.py
```
```
cloud-framework-multi-entity-2023   t2   deva% 9.43 -> 0.0   dupNo 10        clauses 157 -> 149
cscrf-multi-entity-2024             t2   deva% 7.30 -> 0.0   dupNo 81 -> 51  clauses 987 -> 920
master-circular-stock-brokers-2024  t1   unchanged
master-investment-advisers-2024     t1   unchanged
master-mutual-funds-2024            t1   unchanged
master-research-analysts-2024       t1   unchanged
```
**All four tier-1 documents are byte-identical** — the pass cannot touch a monolingual
file by construction. CSCRF clause 7 is now a single clean run, where it used to be the
Hindi copies followed by the English ones:
```
7.1 Market Infrastructure Institutions (MIIs)   7.2 Qualified REs   7.3 Mid-size REs
7.4 Small-size REs                              7.5 Self-certification REs
```

**No English was lost.** Verified by diffing the Latin-token multiset of the whole tree
before and after: cloud 11,706 → 11,691, CSCRF 43,584 → 43,581. All 18 missing tokens are
the addressee header `To` and **roman list markers belonging to Hindi list items**
(`i.`, `ii.`, `IV.`). Cloud's clause 1 shrinking 810ch → 597ch is redistribution across
clause boundaries once the interleaved Hindi nodes stopped splitting the stream — not
loss.

**The remaining 51 CSCRF duplicates are genuine and must not be "fixed".** Numbering
restarts inside each of ~20 annexures, so `1`, `2`, `3` legitimately recur (`1` appears
152 times). `scope` already resets per container, so parenting is correct — they are
duplicates only in a global namespace.

⚠ **This lands on Step 16.** A citation to "clause 1" in CSCRF is ambiguous without its
annexure; link resolution must key on **container + number**, never number alone.

**DEPENDS** — nothing.

### B4 · Step 9 — narrow the sibling heuristic `DONE`

**Why** — a clause often points outside itself (*"such year"*, *"the aforementioned
parameters"*, *"Provided that…"*). Sending the previous sibling with **every** window buys
that context everywhere and pays for it everywhere.

**Change** — `_antecedent_context()` in
[segment.py](services/ai-service/app/segment.py), consulted by `_window`. Per clause, on
evidence:

1. no named back-reference and no continuation → **nothing added**
2. antecedent already in the ancestor header → **nothing added**
3. antecedent in the parent but past the 80-char ancestor label → carry **the one
   sentence** that introduces it
4. antecedent only in the previous sibling → carry a 400-char sibling excerpt

**Order matters: the parent is checked first and wins.** If the antecedent is in the
parent, the sibling adds nothing but tokens even when it happens to repeat the word.

Opaque references (*thereof*, *the same*, *as mentioned above*) are matched but
**deliberately get nothing** — there is no noun to search for, so no context-widening can
be shown to help. They are 24% of all back-references and are honest residue, not a
solved case.

The regexes and the noun test live in `segment.py` and are **imported** by the harness,
so the measurement that decided the design cannot drift from the code that ships.

**Done when** — the added-context rate matches the measured baseline, and no clause whose
antecedent is already in its parent pulls in a sibling.

**Verify live**
```bash
python tools/corpus_check.py --backrefs
```
```
document                             t   sent backref  inWin  trunc   sib  opaque  cont
master-circular-stock-brokers-2024   1   2183     487     64      9    80     125     4
master-mutual-funds-2024             1   2227     619     60     31   106     175     6
master-investment-advisers-2024      1    193      42      3      5     6      14     0
master-research-analysts-2024        1    151      31      4      3     2      11     0
cscrf-multi-entity-2024              2    891      97      4      8    20      24     0
```
`sib` is the case B4 is about: **194 of 4,754 tier-1 windows (4.1%)**. `trunc` is 48 more
where the antecedent is in the parent but the ancestor label cuts it off — handled by
rule 3 rather than by widening every window.

**The cost measurement that settles the design:**
```
CORPUS  base 2557kB   narrow +3.4%   always-send-siblings +45.3%
windows with added context: 292 of 5865 (5.0%)   [226 sibling · 66 parent sentence]
```
Always-send is **+45.3%**, not the +23% this file previously estimated — the narrow rule
buys the same context for **a thirteenth of the cost**.

Acceptance criterion asserted programmatically over all 292 windows:
```
violations of 'antecedent already in parent -> no sibling': 0
```
Sample — clause 2 of 2024/14 says *"Based on the four parameters"* and now carries the
clause that defines them:
```
[context — 1] In order to further strengthen the compliance and monitoring requirements
of the stock brokers … the following four parameters shall be considered for …
2 Based on the …
```

⚠ **A2 was extended again, and it caught a real blind spot.** The window is what actually
reaches the drafter, and it was **not** in the fingerprint — B4 rewrote 292 windows and
`snapshot check` still said `PASS`. Window length and hash are now fingerprint fields
(schema 3, all goldens rewritten). Proved by shrinking `SIBLING_EXCERPT_CHARS`:
```
~ was  clause 2  d1 keep  111ch w528
  now  clause 2  d1 keep  111ch w278        exit 1
```

**DEPENDS** — nothing.

---

# Part C — Schema foundation

### C1 · Schema additions `DONE` ⚠ the one real prerequisite

**Why** — these block Steps 14, 15 and 16 simultaneously. `obligations.audienceId`
**did not exist**, so Step 14's frozen decision could not be implemented at all.
Decisions 85, 91.

**Change** — two files, because there is no migration tooling:
[`infra/docker/init-db.sql`](infra/docker/init-db.sql) for fresh environments and
[`infra/docker/alter-001.sql`](infra/docker/alter-001.sql) — fully idempotent — for the
volume you already have.

⚠ **The task list was incomplete: `audience_id` had no referent.** Step 10 resolves
headings against an "Audience Register" that had no table, and D2 needs the lattice. So
C1 shipped **seven** things, not five:

| | what | why |
|---|---|---|
| `audiences` 🆕 | label · predicate · **predicate_hash** · properties · aliases · pattern | An audience is a **set of firms**, matched on its normalised test character-for-character. `predicate_hash` is Step 10 rung 3's exact-match key |
| `audience_edges` 🆕 | narrower → broader | The lattice is a **DAG, not a tree** — one audience can be narrower than several. D2 writes it, D9 reads it to tell a contradiction from a legitimate override |
| `obligations.audience_id` | FK → audiences | The live bug: identity hashed the expression alone, so QSB-180 and non-QSB-90 collided |
| `obligations.hash_inputs` | jsonb | Registry ids are renumbered by Step 13's clustering; storing the inputs makes that a **re-derivation, not a re-ingest** |
| `rule_assertions` | the append-only event log | Filing appends; the graph is a projection replayed in effective-date order |
| `unresolved_citations` | the Step 16b retry queue | Includes **`target_container`** — a B3 finding: CSCRF's `1` exists 152 times, so a citation keyed on clause number alone cannot resolve |
| `edges.source_citation` + `confidence` + `state` | provenance | 16c names **three** gaps, not one. An `amends` edge resolved ambiguously must not read as an accepted fact |

Plus `source_clauses.is_title` / `title_text`, the persistence gap B2 flagged.

**`rule_assertions` is append-only in the database, not by convention.** A trigger rejects
UPDATE and DELETE outright; a correction is a new row with `corrects_seq`. The audit
claim — *"what did we believe on 12 March?"* — depends on that log being immutable, and a
well-meaning UPDATE would destroy the answer silently.

Four TypeORM entities were added and the new columns wired into `Obligation`, `Edge` and
`SourceClause`, because a column the backend cannot address would block D6 all over again.

**Done when** — a fresh volume and the existing one converge on the same schema.

**Verify live**
```bash
docker compose up -d postgres
docker compose exec -T postgres psql -U setu_user -d setu_db -v ON_ERROR_STOP=1   < infra/docker/alter-001.sql
docker compose exec -T postgres psql -U setu_user -d setu_db -v ON_ERROR_STOP=1   < infra/docker/alter-001.sql        # idempotency: 0 errors, second run
```
*(The credentials are `setu_user` / `setu_db`, not `setu` / `setu` as this file
previously said.)*

**Fresh-volume parity — without `down -v`.** The original verify called for
`docker compose down -v`, which would have destroyed **5,702 obligations and 1,989
attributes** of real dev data. Same guarantee, no loss: build the fresh schema into a
throwaway database in the same container and diff it.
```bash
docker compose exec -T postgres psql -U setu_user -d postgres -c "CREATE DATABASE setu_fresh;"
docker compose exec -T postgres psql -U setu_user -d setu_fresh < infra/docker/init-db.sql
# then diff information_schema.columns and pg_indexes/pg_constraint/pg_trigger
```
```
columns                            152 vs 152   IDENTICAL
indexes + constraints + triggers    86 vs  86   IDENTICAL
```
The diff caught one real drift: `alter-001` named the FK `fk_obligations_audience` while
`init-db.sql`'s inline `REFERENCES` got Postgres's auto-name. Fixed by naming it in both.

**Then the same check through the REAL entrypoint**, because `psql -f` and
`/docker-entrypoint-initdb.d` are not the same path:
```bash
docker run --rm -d --name probe -e POSTGRES_USER=setu_user -e POSTGRES_PASSWORD=setu_password   -e POSTGRES_DB=setu_db   -v "$(pwd -W)/infra/docker/init-db.sql:/docker-entrypoint-initdb.d/init-db.sql:ro"   pgvector/pgvector:pg16
docker logs probe | grep init-db
#  running /docker-entrypoint-initdb.d/init-db.sql
#  NOTICE:  Setu init-db: schema + indexes ready      → 17 tables, 0 errors
```
```
existing volume      152 cols /  86 objects
FRESH volume         152 cols /  86 objects     IDENTICAL
```
⚠ In Git Bash this needs `MSYS_NO_PATHCONV=1` and `$(pwd -W)`; without them MSYS rewrites
the container path to `C:/Program Files/Git/docker-entrypoint-initdb.d/`, nothing mounts,
and the database comes up **empty with no error** — which looks exactly like a broken
init-db.sql and is not one.

**Entity ↔ column mapping, checked against the live database:**
```bash
docker compose run --rm --no-deps -e DB_HOST=postgres backend npm run test:c1
```
```
  ok  obligations.audienceId + hashInputs readable
  ok  edges.sourceCitation + confidence + state readable
  ok  source_clauses.isTitle + titleText readable
  ok  audiences / rule_assertions / unresolved_citations queryable
  ok  audience arrays survive a round trip
  ok  duplicate predicateHash is rejected
  ok  UPDATE on rule_assertions is rejected by the database
  ok  DELETE on rule_assertions is rejected by the database
  13 passed, 0 failed
```
`npm run test:m3` still green (24/24) after the entity changes.

**The full application boots against the new schema** and serves the altered tables:
```bash
docker compose up -d backend
curl -s localhost:3000/api/v1/health
#  {"status":"ok","db":"up",...}    all routes mapped, no TypeORM metadata errors
curl -s -H "Authorization: Bearer $TOKEN" localhost:3000/api/v1/circulars/CIR-2024-14-QSB/obligations
#  [{"id":1,...,"audienceId":null,"identityHash":null,...}]   the new column round-trips
```

**Not covered by C1:** a full document re-ingestion has not been run since the schema
change. Every added column is nullable or defaulted, and the API read above exercises the
altered tables, but the first real end-to-end ingest belongs to D6/D7.

⚠ **Run backend tests inside the compose network** (`docker compose run`), not from the
host. A **native Windows PostgreSQL service holds port 5432**, so `localhost:5432` reaches
that server and not the container — it fails with `password authentication failed for user
"setu_user"`, which looks like a credentials problem and is not one. The backend itself is
unaffected: it uses `postgres:5432` inside the network.

⚠ **Union-typed entity columns now declare their type explicitly** (`@Column('text')` on
`dataType`, `state`, `verdict`, `role`, …). `ts-node --transpile-only` compiles
file-by-file and cannot resolve a union alias, so `design:type` became `Object` and
TypeORM refused to start with `DataTypeNotSupportedError`. This was **pre-existing** and
would have blocked every entity-driven test in Part D; 8 entities fixed.

**DEPENDS** — nothing. **Blocks** D6, D7, D8 — now unblocked.

---

# Part D — The missing pipeline steps

Ordered by value-per-unit-of-work, not by step number.

### D1 · Step 10a — Pattern C, document-level audience `DONE` ⭐

**Why** — the **only** applicability pattern validated across two regulators and four
departments. One AI call per document gives every clause an audience floor — including
documents like the Cloud framework (one heading in 53 pages) where the heading-based
design yields nothing at all. Decisions 68, 69.

**Change** — four pieces:

| where | what |
|---|---|
| [`app/audience.py`](services/ai-service/app/audience.py) | the firm-property vocabulary, 10c normalisation with the implied-terms table, `predicate_hash`, and the Pattern C resolver (real + mock) |
| `POST /audience/document` | one call per DOCUMENT, not per clause |
| [`audience-resolver.service.ts`](services/backend/src/ingestion/audience-resolver.service.ts) | the ladder — rungs 3, 4 and 7 — writing `audiences` and `audience_edges` |
| `ingestion.service.ts` | a new `audience` SSE stage that stamps the floor on every unassigned clause |

**Normalisation lives in exactly one place** (the AI service) and the backend consumes
`conditions[]`. Re-implementing it on both sides is precisely how the two would drift, and
a drifted `predicate_hash` means rung 3 silently stops matching.

⚠ **Schema the task did not list.** `source_clauses` had no `audience_id`, so there was
nowhere to stamp a floor. Added in
[`alter-002.sql`](infra/docker/alter-002.sql) with `audience_source`, which records WHICH
pattern stamped it so D2 knows what it may narrow.

⚠ **Rungs 5 and 6 are not built** (meaning similarity, then an AI judge on ≤3 borderline
candidates). They need an embedding per audience, and with Pattern C alone the register
holds a handful of nodes that rungs 3 and 4 settle *exactly*. They become necessary at D2,
when chapter audiences start being phrased with different properties.

**Done when** — all 8 documents produce a document-level audience, and they are sane.

**Verify live — 1 · the whole corpus, on the host**
```bash
python tools/pattern_c_check.py        # no Docker, no API key
```
```
master-circular-stock-brokers-2024  t1  ok  category == 'stock_broker'
master-investment-advisers-2024     t1  ok  category == 'investment_adviser'
master-mutual-funds-2024            t1  ok  category == 'mutual_fund'
master-research-analysts-2024       t1  ok  category == 'research_analyst'
cscrf-multi-entity-2024             t2  ok  regulator == 'sebi'
cloud-framework-multi-entity-2023   t2  ok  regulator == 'sebi'
circular-2024-14-mirsd              t2  ok  category == 'stock_broker'
rbi-it-outsourcing-2023             t3  ok  regulator == 'rbi'
8/8 documents resolved · 6 distinct audiences        exit 0
```
6 distinct, not 8 — `regulator=='sebi'` and `category=='stock_broker'` are each shared by
two documents. That is rung 3 collapsing repeats, visible on the real corpus.

⚠ **THE TITLE GOVERNS — a correctness rule, not a preference.** The first version scanned
the whole opening and got **5 of 8 documents wrong, every one too BROAD**: the stock
brokers master circular came out as five entity types and mutual funds as *all SEBI
entities*. The cause is that a circular's addressee list names who it is **routed
through** — *"Stock Brokers **through** Recognized Stock Exchanges"* — not who it binds.
Reading the title first fixed all five. This is now enforced in the mock and stated in the
real prompt.

**Verify live — 2 · the ladder, controlled inputs, no Docker**
```bash
npm run test:pattern-c        # 26 assertions
```
```
rung 4 — implication is computed, not guessed          8 ✓
rung 3 — the same test resolves to the same audience   6 ✓   (register does not grow)
rung 4 — a narrower audience nests instead of duplicating  3 ✓
the lattice is a DAG — one node, several parents       3 ✓
the implied-terms table (10c) collapses two spellings  2 ✓
rung 7 — a new audience is a human decision            2 ✓
order independence                                     2 ✓
```
The DAG case corrected an assumption of mine: a `category in ['investment_adviser',
'stock_broker']` audience is broader than **three** existing nodes, not two, because QSB
implies `stock_broker` which implies the set. **Containment is stored transitively** —
D9 asks "is this audience strictly narrower?" and a stored edge answers with a lookup
instead of a recursive walk.

**Verify live — 3 · end to end, through the running stack**
```bash
curl -X POST .../circulars -F file=@assets/circulars/circular-2024-14-mirsd.pdf
```
```
first ingest    "rung": "created", "audienceId": 4, "needsApproval": true,  "clausesStamped": 39
re-ingest       "rung": "exact",   "audienceId": 4, "needsApproval": false, "clausesStamped": 39
audiences table  1 row — no duplicate
```
Rung 3 reuse proved against the live database, and an exact match is `needsApproval:
false` because it is *provably* the same set of firms, where a newly minted audience
(mock confidence 0.35) is not.

`test:m3` 24/24 · `test:c1` 13/13 · `snapshot check` PASS — no regressions.

**Left in the database:** the `D1-PATTERN-C-TEST` document and audience id 4. Both are
real ingestion output rather than probes, so they were not cleaned up.

**DEPENDS** — B2 (title), C1 + alter-002 (schema). **Blocks** D2.

### D2 · Step 10b — Pattern A, chapter scoping `DONE`

**Why** — narrows Pattern C where a document scopes by chapter. The phrase gate was
**deleted after measurement** (0 hits in 148 and 64 headings) — send every heading.
Decision 63.

**Change**

| where | what |
|---|---|
| `audience.py` | `classify_heading` + `compose` — the WHO/WHAT call, then the arithmetic |
| `POST /audience/headings` | batched, one call per tree LEVEL |
| [`pattern-a.engine.ts`](services/backend/src/ingestion/pattern-a.engine.ts) 🆕 | which headings, in what order, and where the answers land — **pure** |
| `ingestion.service.ts` | a `chapter_audience` stage between Pattern C and extraction |
| `alter-005.sql` 🆕 | `audiences.state` — the approval gate finally has somewhere to live |
| `GET /api/v1/audiences` · `POST /api/v1/audiences/:id/approve` | the queue, and the click |
| `consistency.engine.ts` | a new INTEGRITY family: rules filed under an unapproved audience |

**The composition is ours, not the AI's.** The model makes one small judgement — what
does this heading add — and parent + added is composed in code, where it cannot drift.

**Done when** — a chapter-scoped heading yields a narrower audience than its document
floor, and the lattice records the containment.

**Verify live — 1 · the corpus** (no Docker)
```bash
python tools/pattern_a_check.py
```
```
master-circular-stock-brokers-2024   t1   365 headings -> 42 audience headings, 6 distinct
  floor  category == 'stock_broker'
      -> category == 'stock_broker' && is_qsb == true                     (68 clauses)
      -> category == 'stock_broker' && is_clearing_member == true         (61 clauses)
      -> category == 'stock_broker' && outsources_it == true              (59 clauses)
      -> category == 'stock_broker' && holds_client_funds == true         (31 clauses)
      -> category == 'stock_broker' && provides_internet_trading == true  (16 clauses)
      -> category == 'stock_broker' && uses_cloud_services == true         (9 clauses)

SEBI (tiers 1-2): 1,250 headings -> 114 audience headings, 24 distinct narrower
                  audiences, 45 refused as contradictions
```

**Verify live — 2 · the engine and the ladder** (no Docker)
```bash
npm run test:pattern-a          # 26 assertions
```
```
the walk      headings grouped by DEPTH, shallowest first
              a child is never classified before its parent
              a repeated heading is classified once (running headers, TOC echoes)
              the opening lines are the section's own prose, NOT its whole subtree
inheritance   a grandchild inherits · a sibling chapter does not
              the NEAREST resolved ancestor wins, not the outermost
the ladder    QSB chapter nests under the broker floor, containment recorded
              a second heading naming the same set REUSES it (rung 3), keeps an alias
              two axes (QSB, client funds) are UNRELATED to each other
              an audience narrowing both sits under BOTH parents — a lattice, not a tree
```

**Verify live — 3 · the real document**

Ingesting the stock brokers master circular (2,493 clauses, 365 headings):
```
chapter_audience  {headings: 365, audiences: 14, created: 6, reused: 8,
                   refused: 7, distinct: 6, clauses_stamped: 244}
```
```
audience_source     predicate                                              clauses
  C                 category == 'stock_broker'                                2249
  A                 category == 'stock_broker' && is_qsb == true                68
  A                 category == 'stock_broker' && is_clearing_member == true    61
  A                 category == 'stock_broker' && outsources_it == true         59
  ...
```
And the payload — 18.5's whole subtree, stamped by inheritance rather than by a call:
```
18.5      category == 'stock_broker' && is_qsb == true   Enhanced obligations ...
18.5.1    category == 'stock_broker' && is_qsb == true   Governance structure ...
18.5.1.1  category == 'stock_broker' && is_qsb == true   The Board of Directors ...
18.5.1.2  category == 'stock_broker' && is_qsb == true   Further, QSBs shall have ...
```
218 obligations now carry an audience NARROWER than their document floor, and their
identity hashes are built from it — which is the point. A QSB rule and a non-QSB rule
can no longer be mistaken for versions of each other.

The lattice, in `audience_edges`:
```
category == 'stock_broker' && is_qsb == true            ⊂  category == 'stock_broker'
category == 'stock_broker' && is_clearing_member == true ⊂  category == 'stock_broker'
...6 containments, derivation = implication
```

⚠ **45 headings were REFUSED across the SEBI corpus, and that is the guard working.**
A heading naming a firm type its parent excludes does not narrow its parent — it
contradicts it:
```
REFUSED  "SMS and E-mail alerts to investors by Stock Exchanges"
         'category' cannot be both 'stock_broker' and 'stock_exchange'
REFUSED  "Audit Committee of Asset Management Companies"
         'category' cannot be both 'mutual_fund' and 'amc'
```
Composing those anyway would produce an audience matching **no firm at all**, and every
rule beneath it would be addressed to nobody — Step 17 would report it as a dead rule
long after the damage. Refusing is also the only safe direction: too narrow hides rules
from firms that owe them, but too broad puts duties on firms that do not, and **nothing
downstream can detect that.**

The mutual-funds refusals say something further: that circular genuinely binds AMCs,
trustees and RTAs, so its floor of `category == 'mutual_fund'` is too narrow. That is a
**Pattern C finding surfaced by Pattern A**, and it goes to a human rather than being
silently widened.

⚠ **The approval gate had nowhere to live.** D1 computed `needsApproval` and dropped it:
a row created at 0.35 confidence was indistinguishable from one at 0.95. Pattern C made
one audience per document so it barely showed; Pattern A mints one per chapter, and the
queue became real. Existing rows were backfilled as **PROPOSED, not APPROVED** — every
audience in the register was made by the mock at 0.35 and none has ever been approved by
anyone. Backfilling them as approved would be a lie told once and believed forever.

```bash
GET /api/v1/audiences
```
```
proposed 9  approved 0
   43 PROPOSED C  clauses=2490 rules=1991  category == 'mutual_fund'
    4 PROPOSED C  clauses=2405 rules=1754  category == 'stock_broker'
   49 PROPOSED A  clauses=  68 rules=  58  category == 'stock_broker' && is_qsb == true
   ...
```
Ordered by blast radius: approving one that scopes 68 clauses matters more than one
scoping 1, and a reviewer with limited attention should spend it there. There is
deliberately **no bulk approve-all** — a button that waves everything through is the
gate not existing. `POST /audiences/49/approve` records who and when; a second call
answers 404.

⚠ **The gate does not block the pipeline, so something has to check it afterwards.**
The design is explicit that parsing and drafting must not wait for approval. So Step 17
grew a fourth INTEGRITY finding, live on the real graph:
```
INTEGRITY  low  1991 rules are filed under "Mutual Fund" (category == 'mutual_fund'),
                an audience nobody has approved
```
One finding per audience, not per rule — 1,991 findings from one unapproved audience
are ONE thing to approve. After approving the QSB and clearing-member audiences the
count fell from 9 to 7.

⚠ **Rungs 5 and 6 are still not built, and D2 did not force them.** D1 deferred them
with the note that they become necessary "when chapter audiences start being phrased
with different properties". Measured: all 24 narrower audiences resolve at rung 3 or 4,
because composition happens in code against a fixed property vocabulary, so two
headings meaning the same thing produce the same normalised string by construction.
They become necessary with a real LLM free-phrasing the `condition` field — which is
D4's territory, not this one.

⚠ **CSCRF mints 14 one-clause audiences** from its per-entity annexure index. Harmless
(each scopes a single clause) and arguably useful — they seed the register with entity
categories a later circular reuses at rung 3 — but they are 14 approval prompts of
little value. Pattern B proper is still deferred.

Regressions: `test:m3` 22/22 · `test:c1` 13/13 · `test:pattern-c` 26/26 ·
`test:pattern-a` 26/26 · `test:fingerprint` 14/14 · `test:filing` 31/31 ·
`test:consistency` 34/34 · `test:links` 47/47 · `fingerprint_check` 26/26 ·
`pattern_c_check` 8/8 · `citation_check` unchanged · `snapshot check` PASS.

One upstream fix fell out of this: the entity scanner matched only "adviser", while
circulars write "advisor" freely ("Investment Advisors (IAs)/ Research Analysts (RAs)").
The variant made a two-entity heading look like a one-entity audience. Pattern C's
8/8 output is byte-identical after the fix.

**DEPENDS** — D1.

### D3 · Step 12 — assembly `DONE`

**Why** — no assembly phase existed. Modifiers were drafted by nobody and applied by
nobody; everything downstream assumed this ran.

**Change**

| where | what |
|---|---|
| `drafter.py` | a **modifier lane** — Step 12 cannot assemble what Step 11 never emitted |
| `POST /extract` | every window now returns `modifiers` alongside `rules` |
| [`assembly.engine.ts`](services/backend/src/ingestion/assembly.engine.ts) 🆕 | resolve, index, the four effects, the chain — **pure** |
| [`assembly.service.ts`](services/backend/src/ingestion/assembly.service.ts) 🆕 | the clause tree, the audience each clause landed under, the vocabulary |
| `ingestion.service.ts` | an `assembly` stage at the phase boundary, **before** the funnel |

**The ordering is satisfied by the sequence, not by anyone remembering it.** Extraction
finishes completely; then modifiers are applied, preconditions attached and the audience
settled; and only then, in the NEXT stage, is the rule fingerprinted. A rule
fingerprinted first and narrowed afterwards is a phantom amendment of a duty nobody
amended.

**Done when** — a modifier clause measurably narrows its target rule's audience.

**Verify live — 1 · what the corpus actually contains** (no Docker)

Measured before building anything: **34 sentences in the seven SEBI documents
cross-reference a paragraph and say something about its application, and roughly TWO of
them narrow by a property of the FIRM.**

```
"Investment limits in 12.3.1 shall not be applicable on investments in
 securitized debt instruments"                            <- instrument, not firm
"Paragraphs 8.4.5 and 8.4.6 shall apply to 'switch in' transactions"
                                                          <- transaction, not firm
"para 50.1 shall not be applicable to clients having arrangements
 with custodians registered with SEBI"                    <- the CLIENT, not the firm
```

⚠ **That changed the design.** A modifier is modelled as narrowing a rule's AUDIENCE,
and an audience is a set of FIRMS. Most real modifiers are not that. Forcing them in
would be wrong in the dangerous direction — claiming a firm is outside a rule when only
one kind of its *transactions* is. So the condition is **routed**:

```
expressible as a firm property   -> narrows applicability (the design path)
anything else                    -> a PRECONDITION on the rule, carried, never
                                    promoted to an audience
```

Which is what *"preconditions still attached, not yet promoted"* always meant. The
measurement only shows how much of the traffic goes that way.

**Verify live — 2 · the engine** (no Docker)
```bash
npm run test:assembly           # 41 assertions
```
```
12b resolve   "9.5.1" -> the clause; an absent target is orphaned, not guessed
12c index     keyed by CLAUSE ID, never by the text "9.5.1"
12d effects   restrict_scope ANDs · exempt makes a NOT term · extend_scope ORs
              override_value does NOT edit the original — it derives a SECOND,
              stricter rule, and is applied LAST so it sees the others' result
routing       a scope condition never touches the audience
              it is carried as a precondition and the rule goes to REVIEW
              a scope EXTENSION is carried but does not force review
Problem 3     12.9 targeting 12.7 narrows the EXEMPTION, not the rule:
              brokers && NOT (clients < 500 && NOT holds_client_funds)
              computed AND flagged — a double negative humans misread too
edge cases    orphaned -> flagged · one clause, two rules -> applied to both, ONE flag
flatten       a NOT returns null rather than an approximation
acceptance    the identity hash DIFFERS either side of assembly
```

**Verify live — 3 · the real document**

Mutual funds master circular, 2,218 windows:
```
assembly  {modifiers: 6, resolved: 5, orphaned: 0, ambiguous: 1, applied: 5,
           narrowedAudience: 0, preconditionsAttached: 5, derived: 0,
           flags: 6, by_flag: {ambiguous_target: 1, unexpressible_condition: 5}}
```
`narrowedAudience: 0` is the measurement showing up in production, not a failure: none
of MF's six modifiers is about the firm. All five are carried as preconditions and their
rules go to REVIEW rather than being filed as though the restriction did not exist.

⚠ **The live run found a real bug in this engine, and it is the interesting one.**
The first run reported `modifiers: 6, applied: 35`. One modifier had resolved
ambiguously and been spread across five clauses.

Step 16 fans a `depends_on` edge out to every rule of an ambiguously resolved clause,
because over-linking is recoverable — evaluation walks the edge and finds nothing wrong.
**A modifier is the other kind.** Restricting five rules when SEBI meant one silently
removes four duties from the firms that owe them, and nothing downstream can detect it.
Same asymmetry that made `amends` refuse in Step 16, and it had been missed here. A
modifier now **never fans out**:
```
ambiguous_target  "the above limit of 10% shall not be applicable to S..." targets 10,
                  which names 32 different clauses — refused rather than applied to all
```

⚠ **And the refusal exposed two more bugs behind it, both live-only.** The target was
`10`, taken from *"the above limit of **10%**"* — a percentage read as a paragraph
number. Then a second run turned up *"Clause 1 of Seventh **Schedule453**"*, a statute
reference whose footnote marker defeated a word-boundary-anchored guard, so it attached
to an unrelated clause numbered 1. The extractor now rejects a number followed by
`%` / `per cent` / `crore` / `lakh`, preceded by *"limit of"* / *"than"*, or trailed by a
statute name with or without a footnote glued to it. Three phantom modifiers went away
and the two real ones stayed. All three shapes are in the test suite.

⚠ **A misleading counter, also live-only.** The stage reported `audience_narrowed: 3` on
a document where no audience moved: every rule that picked up a precondition was being
re-resolved through the ladder, minting a duplicate of the test it already had. Rung 3
made it harmless and the number made it invisible. Assembly now keeps `baseConditions`
so a real narrowing can be told from a rule that only gained a precondition.

⚠ **Flags are clustered per MODIFIER, not per rule.** The first live run printed the same
`unexpressible_condition` thirty-five times. One modifier reaching thirty rules is ONE
thing for a reviewer to decide — the lesson Step 17 already learned about contradictions.

**Problem 2 — a condition the vocabulary cannot express.** Three options, two of them
traps: filing it unrestricted applies the rule to firms it should not reach; dropping it
makes firms miss a duty they owe. **REVIEW** is the only choice that is not silently
wrong in one direction, so `needsReview` sets the row's state before it is stored.

**Problem 3 — a modifier that modifies a modifier.** Applicability is an EXPRESSION,
not a flat list, and every term is tagged with the clause that added it. `12.9` targeting
`"12.7"` resolves to *that term* and narrows the exemption in place. Chains work because
each modification leaves a labelled handle for the next one to grab.

⚠ **`derived: 0` and no chained modification fired on the corpus.** `override_value` and
Problem 3 are covered by the engine tests and by the design's own worked examples; the
SEBI corpus does not contain either shape. Said plainly rather than implied.

Regressions: `test:m3` 22/22 · `test:c1` 13/13 · `test:pattern-c` 26/26 ·
`test:pattern-a` 26/26 · `test:assembly` 43/43 · `test:fingerprint` 14/14 ·
`test:filing` 31/31 · `test:consistency` 34/34 · `test:links` 47/47 ·
`fingerprint_check` 26/26 · `pattern_c_check` 8/8 · `snapshot check` PASS.

**DEPENDS** — D1.

### D4 · Step 11 — drafter hardening `DONE`

**Why** — three designed lanes were unbuilt: unit normalisation, the `modifier` output
type, and the number-fidelity verifier lane.

**Change**

| where | what |
|---|---|
| [`fidelity.py`](services/ai-service/app/fidelity.py) 🆕 | the three lanes and the unit contract |
| `drafter.py` | the targeted verifier and the **closed loop** |
| `canonical.py` | `compared_literals` — unit normalisation, and only here |
| `main.py` · `schemas.py` | every rule returns `validation`, `precondition`, `inferred` |
| [`rederive.ts`](services/backend/test/rederive.ts) 🆕 | migrates stored hashes without re-running the AI |
| `tools/fidelity_check.py` · `tools/drafter_check.py` 🆕 | the corpus harness and 43 checks |

*(The `modifier` output type landed at D3, which needed it as input. Checked here.)*

**Done when** — *"every six months"* emerges as `180` days, and a fabricated number is
caught and routed.

**Verify live — 1 · the unit contract** (no Docker)
```bash
python tools/drafter_check.py       # 43 checks
```
```
"every six months"  -> compared 180   stored 6   expression untouched
"annually"          -> compared 360
six months == 180 days                  one duty written two ways, ONE fingerprint
six months IS the same DUTY as 90 days  identity excludes literals
                            but not the same VALUE  -> an amendment, not a new rule
active_clients > 5000 -> 5000           a count is not a duration
```

**Units are constrained at extraction but converted only at canonicalisation.** The
instinct to standardise time when the rule is written is right; doing it there is wrong:

```
"at least once every half year"  ->  183 days
  6 calendar months from 31 Jan  ->  31 July
  183 days from 31 Jan           ->  2 August        two days apart
```

A firm audited on 1 August is compliant under one reading and in breach under the other.
Converting at extraction does not standardise — it silently picks an interpretation and
destroys the evidence a choice was made. So:

```
STORED     "every 6 months"   the expression, untouched, what an auditor sees
COMPARED   180                what the fingerprint sees, derived and disposable
DISPLAYED  "half-yearly"      from the source
```

⚠ **The masked shape had to change too, and that is the subtle half.** Normalising the
literal was not enough: `months_since` and `days_since` are different SHAPES, and
identity deliberately excludes literals — so "audit every 6 months" and "audit every 180
days" still had different identities and Step 15 would have filed the second as a new
obligation. The time functions now collapse to one name **in the masked form only**. The
unmasked expression, which is what is stored and displayed, is untouched.

**Verify live — 2 · the tripwire, and why the corpus number proves nothing alone**
```bash
python tools/fidelity_check.py --plant 7
```
```
SEBI (tiers 1-2): 5,833 rules -> 0 tripwires (0.0%), 0 type failures
                  planted inventions: 60/60 caught (100.0%)
```
⚠ **Zero tripwires on the real corpus is a property of the MOCK DRAFTER, not evidence
the check is unnecessary.** The mock copies numbers verbatim by construction; it cannot
invent one. A real model can. So inventions are planted and the detection rate measured —
a check that never fires proves only that it did not crash, which is the same lesson
Step 17's scale test already learned.

Two bugs the first run found, before any planting:
- the check read `clause.text` while the drafter reads the **window**, so rules whose
  number came from the ancestor trail were flagged as inventions
- *"fees for 2 quarters"* did not explain `<= 6` months, because only bare period
  *phrases* were in the pool, not quantified ones

**Verify live — 3 · the closed loop**

A failure is a **referral, not a rejection**. The verifier is told exactly what is
wrong — *"the rule uses 90; the clause contains 15 and 180; nothing explains where 90
came from"* — because a narrow question beats *"is this rule right?"*, which the same
model that wrote it will answer yes to.

And the loop closes: **a correction must pass the check that failed.**
```
verifier proposes 180  ->  180 is in the pool  ->  applied
verifier proposes 77   ->  77 is not           ->  REFUSED, routed to a human
verifier says "wrong" with no replacement      ->  degrades to cannot_tell
```
So the model can only move a value toward something demonstrably present in the source.
It cannot invent its way out of the flag.

⚠ **Without a model the verifier answers `cannot_tell`, and that is the honest mock.**
Pretending to justify or to correct would manufacture provenance for a number nobody
checked — worse than an unanswered flag. The rule keeps its flag, its confidence is
capped at 0.4, and it lands in REVIEW.

**Verify live — 4 · the migration nobody wants to discover later**

Changing how a fingerprint is computed made **259 stored rules disagree with the current
rules**. Left alone, the next ingest of their document files every one as a NEW
obligation — an amendment storm caused by us, not by SEBI.

Decision 78 promised such a change would be a RE-DERIVATION rather than a re-ingest;
that is why `hash_inputs` stores what went into the hash. This makes the promise true:
```bash
docker compose run --rm --no-deps -e DB_HOST=postgres backend \
  npx ts-node --transpile-only test/rederive.ts --apply
```
```
4101 rules carry a stored derivation
re-derived    259 rules would change (259 identity)
unchanged     3842
not derivable 0
APPLIED

# and running it again:
re-derived    0 rules would change
```
Idempotent, and no AI call was made about what any rule MEANS — only the stored ref ids
and the stored expression are re-hashed.

**Verify live — 5 · on the real graph**

Ingesting the research analysts master circular, the three representations reach the rows:
```
expression                      stored  compared
hours_between(...) <= 24        [24]    [1]
months_since(...) <= 12         [12]    [360]
months_since(...) <= 6          [6]     [180]
```

**Lane 1 — type check.** Structure, the allowed function list, and comparison
compatibility. `months` against `days` is **converted, never rejected**; a date against
rupees is rejected outright. 0 failures on the corpus.

**Lane 2 — modifier cross-check.** The AI's `targets` must appear among the citations the
pattern scan already found in that clause. Cheap, and it catches a real modification
attached to the WRONG target — which would otherwise silently restrict a rule SEBI never
mentioned.

**Lane 3's pool is normalised the same way the rule was**, or the check cries wolf:
word numbers become digits, `half-yearly` stands for both 6 and 180, a percentage is also
its decimal, and **pointers are stripped** — `4` from *"as specified in Annexure 4"* is
removed, so a rule that lifted it now fails. That last rule turns a whole failure class
visible. Years and glued footnote markers go the same way.

⚠ **`precondition` and `inferred` are now returned but nothing consumes them yet.**
Step 12 carries preconditions it derives from modifiers (D3); a precondition the DRAFTER
declares is a different source for the same field, and wiring the two together is
assembly work, not drafter work. Said plainly rather than left to look finished.

Regressions: `test:m3` 22/22 · `test:c1` 13/13 · `test:pattern-c` 26/26 ·
`test:pattern-a` 26/26 · `test:assembly` 43/43 · `test:fingerprint` 14/14 ·
`test:filing` 31/31 · `test:consistency` 34/34 · `test:links` 47/47 ·
`drafter_check` 43/43 · `fingerprint_check` 26/26 · `pattern_c_check` 8/8 ·
`citation_check` unchanged · `snapshot check` PASS.

**DEPENDS** — nothing.

### D5 · Step 13 — type gate and cold-start clustering `DONE`

**Why** — the type gate (a date can never merge with a count) was designed, not built.
Cold-start clustering is a **build gap, not a test gap**: today whichever circular is
processed first names every data-point forever. Decisions 60, 61.

**Change**

| where | what |
|---|---|
| [`type-gate.ts`](services/backend/src/ingestion/type-gate.ts) 🆕 | STEP 4 of the funnel — **pure** |
| `attribute-resolver.service.ts` | the gate, before the distance decision; candidates now carry type and unit |
| [`coldstart.engine.ts`](services/backend/src/ingestion/coldstart.engine.ts) 🆕 | bulk clustering and frequency × recency × clarity naming — **pure** |
| `ingestion.service.ts` | a `preconditions` stage — Step 13d, promoting them to audiences |
| `drafter.py` | a precondition lane, sharing audience.py's property vocabulary |

**Done when** — a date and a count with near-identical wording never merge; and a bulk
run picks canonical names by frequency, not arrival order.

**Verify live — 1 · the engines** (no Docker)
```bash
npm run test:m3          # 22/22 — the existing funnel must stay green
npm run test:type-gate   # 34 assertions (test:coldstart is the same file)
```
```
type gate     the NEAREST candidate is discarded when its type is wrong
              at distance 0.01 — closeness is not a reason to merge across types
              and the correctly typed one at 0.06 survives to be reused
              days vs months compatible · days vs rupees not · unstated never blocks
cold start    aud_dt x1 vs last_audit_date x400 -> the latter wins
              both spellings land in ONE cluster, the loser becomes an alias
              a marginally rarer but far clearer name wins
              but 400 to 2 is not a tie — frequency still dominates
              identical wording + different types NEVER cluster
```

⚠ **The gate runs BEFORE the distance decision, not after.** A gate applied to the
winner alone would let a mistyped candidate at 0.02 crowd out a correctly typed one at
0.06 and then be discarded — leaving a *create* where a *reuse* was right. Filtering the
candidate LIST is what makes the second-best reachable, and the search widened from 5 to
10 for the same reason.

⚠ **A same-name tripwire hit of the wrong type is not a candidate at all.** Two facts
both called `last_audit_date`, one a date and one a document, are the clearest possible
split; sending that to the judge invites it to merge them on the strength of the name —
the one thing the funnel is never allowed to decide on.

**Verify live — 2 · the gate on the running system**

Ingesting the stock brokers master circular:
```
resolve_attributes  {tokens: 2229, reused: 2229, created: 0, judged: 2206,
                     tripwired: 2206, typeGated: 3020}
```
⚠ **`typeGated: 3020` shows the gate running, NOT 3,020 averted merges.** Mock
embeddings are random, so the nearest neighbours are arbitrary and so are their types.
The number is honest about what it is; the evidence that the gate WORKS is the planted
probe below and the 34 assertions above.

A same-named attribute was retyped `date -> number` and the document re-ingested:
```
type gate: "order_further_strengthen_last_date" (date) rejected #1 (number)
           at distance 0.000
```
Distance zero — an exact name match — and it still refused. Two attributes where before
there would have been one, which is the whole point: once two facts share an id, **every
rule using either of them is wrong** and the broker's intake form asks one question
where it should ask two. Probe reverted afterwards.

**Verify live — 3 · Step 13d, promoting preconditions**

This closes the loop D4 left open: the drafter emits a `precondition` and nothing
consumed it. A precondition *is* an audience test, so it takes the audience path —
composed with the rule's current audience and run through the same ladder.

```
preconditions  {rules: 1, promoted: 1, reused: 1, created: 0, unexpressible: 0}
```
```
7.2.3 "...if any entity is already registered with SEBI as a clearing member..."
      precondition  is_clearing_member == true
      audience      category == 'stock_broker' && is_clearing_member == true
      rung 3 — REUSED the audience D2 minted from a chapter heading
```
That reuse is the payoff for a deliberate choice: the precondition lane shares
audience.py's property vocabulary, so a precondition and a heading naming the same
property produce the same condition string. Different vocabularies would have made one
group of firms into two audience nodes with the rules split across them.

Once promoted the precondition is **dropped** — left attached beside the audience it
became, it would be checked twice.

⚠ **Measured first, as with D3's modifiers: 71 clauses in the SEBI corpus open with a
conditional lead-in and exactly ONE is gated on a firm property.** The rest condition on
transactions, instruments and circumstances. So the lane emits nothing unless a firm
property is nameable — forcing the other 70 into an audience would claim a firm is
outside a rule when only one kind of its business is. Same asymmetry, second time.

⚠ **Cold-start clustering cannot be validated under mock embeddings, and does not
pretend to be.** Mock vectors are random (decision 61), so the clusterer falls back to
exact-token dedup: it collapses what is provably identical and clusters nothing it
cannot see, and `stats.withVectors` reports zero rather than a clean-looking run. The
acceptance test supplies real vectors deliberately. The naming half — frequency ×
recency × clarity — is fully exercised either way, because it reads tokens and dates,
not embeddings.

⚠ **Cold start is built but not yet WIRED to a bulk-load entry point.** There is no
1,000-document corpus to load; the engine and its naming are tested, and the funnel
still runs in steady-state mode on every ingest. Said plainly rather than left to look
finished.

Regressions: `test:m3` 22/22 · `test:c1` 13/13 · `test:type-gate` 34/34 ·
`test:pattern-c` 26/26 · `test:pattern-a` 26/26 · `test:assembly` 43/43 ·
`test:fingerprint` 14/14 · `test:filing` 31/31 · `test:consistency` 34/34 ·
`test:links` 47/47 · `drafter_check` 43/43 · `fingerprint_check` 26/26 ·
`pattern_c_check` 8/8 · `pattern_a_check` unchanged · `snapshot check` PASS.

**DEPENDS** — nothing.

### D6 · Step 14 — tree canonicalisation + audience in hash `DONE`

**Why** — the identity hash omitted the audience, so the QSB 180-day rule and the
non-QSB 90-day rule **produced the same hash**. Step 15 would have filed the second as an
amendment of the first and silently collapsed two live duties into one wrong one.
Decisions 74–79.

**Change**

| where | what |
|---|---|
| [`ast_parse.py`](services/ai-service/app/ast_parse.py) | returns the `Node` tree it always built and threw away. `a AND b AND c` is ONE n-ary node, and parentheses are dropped — nesting *is* the tree |
| [`canonical.py`](services/ai-service/app/canonical.py) 🆕 | the canonicaliser (flip comparisons · sort commutative operands · serialise) and both hashes |
| `POST /fingerprint` | batched, one call per document |
| `attribute-resolver.service.ts` | **stopped** computing hashes; now returns a ref → id map |
| `ingestion.service.ts` | calls Step 14 after attribute resolution *and* after the audience floor, writing `identityHash`, `fullHash`, `audienceId`, `hashInputs` |

**Canonicalisation moved to the AI service, and that is the point.** It is a TREE
rewrite — flipping a comparison and sorting operands are operations on nodes, not on
strings. The old version masked the canonical expression with regexes in TypeScript,
which is both where the bug lived and why it was invisible. A second implementation is
how the two would drift, and a drifted identity hash silently stops matching amendments.

**Done when** — QSB and non-QSB rules have different identity hashes, and two
rephrasings of one rule have the same one.

**Verify live — 1 · the canonicaliser** (no Docker, no API key)
```bash
python tools/fingerprint_check.py        # 26 checks
```
```
THE BUG          QSB <=180 vs non-QSB <=90 -> identity DIFFERS
                 the audience is what separates them, nothing else
AMENDMENT        QSB <=180 vs QSB <=120    -> identity MATCHES, full DIFFERS
CANONICAL        '180 >= x' == 'x <= 180'          (comparison flipped)
                 'x AND y' == 'y AND x'            (operands sorted)
                 parens and whitespace carry no meaning · OR sorted · sets sorted
MASKING          'cloud' == 'onprem' in identity, differ in full
                 identity is built from ids, never labels
MUST NOT MATCH   different data-point · operator flip · an ADDED condition
                 a missing audience != audience 7
ATTESTABLE       prose falls back to audience + ids + sentence hash, and says so
14d              hash_inputs carries audience, ids, tree, literals
                 re-deriving after a renumber changes the hash, not the structure
determinism      25 runs, one hash
```

**Verify live — 2 · the wiring the backend owns** (no Docker)
```bash
npm run test:fingerprint     # 14 assertions
```
```
the QSB rule is sent with its clause audience            (7)
the general rule is sent with a DIFFERENT audience       (8)
an unstamped clause sends null, not a guess
an unassigned rule leaves audienceId UNSET rather than 0
hashInputs carries audience, ids and tree
450 rules batched, all carrying the clause audience
```

**Verify live — 3 · the running service**
```bash
curl -X POST localhost:8000/fingerprint -d '{"items":[...]}'
```
```
qsb    identity=ded84b9cc6c2  core=a:7|cmp:<=(call:days_between(#4471,?today),NUM)
gen    identity=5b517c12bae7  core=a:8|cmp:<=(call:days_between(#4471,?today),NUM)
amend  identity=ded84b9cc6c2  core=a:7|cmp:<=(call:days_between(#4471,?today),NUM)
```
`qsb` and `gen` differ on the audience alone. `amend` is `180 >= x` and lands on the
**same hash** as `x <= 180`. `?today` is an unmapped ref shown as a question mark rather
than dropped: a missing registry id has to be visible, not silently hashed away.

**Verify live — 4 · a full ingestion**
```
resolve_attributes: fingerprints 38 · structural 38 · attestable 0
obligations:  38 rules · 37 with audience · 38 with hash_inputs
              identity_core e.g.  a:4|call:exists(#29)
```
37 of 38, not 38, is correct: one rule comes from a clause with no `clause_no`, so it has
no audience and is left **visibly unassigned** rather than defaulted.

⚠ **The M3 test lost its fingerprint assertions, deliberately.** Four assertions there
("same duty → same identity_hash", "different deadline → different full_hash", …) were
testing a fingerprint the funnel no longer computes. They are replaced by two that check
what the funnel *does* now produce (the ref → id map), and the hash assertions live in
`tools/fingerprint_check.py` in a stronger form. `test:m3` is now **22 green, not 24** —
a smaller number that tests a truer thing.

⚠ **Known blind spots, all by design and all documented in Step 14:** a structural
amendment that ADDS a condition changes the attribute set and files as new (Step 15's
lanes 2 and 3 exist for that); an operator flip files as new and lands in review;
attestable prose has no expression to parse and falls back to a weaker sentence hash.
The fingerprint is one lane of three and is never sold as a complete amendment detector.

Regressions: `test:m3` 22/22 · `test:pattern-c` 26/26 · `test:c1` 13/13 ·
`pattern_c_check` 8/8 · `snapshot check` PASS.

**DEPENDS** — C1 (audienceId, hashInputs), D1 (something to put in audienceId).
**Blocks** D7.

### D7 · Step 15 — filing `DONE`

**Why** — the hashes were written and **never read**. Every rule inserted as new. This is
where the graph actually forms. Decisions 80–84.

**Change**

| where | what |
|---|---|
| [`filing.engine.ts`](services/backend/src/ingestion/filing.engine.ts) 🆕 | the whole decision surface, **pure**: three lanes, five verdicts, `project()` replay |
| [`filing.service.ts`](services/backend/src/ingestion/filing.service.ts) 🆕 | builds the current projection, asks the engine, appends assertions, stages versions |
| `ingestion.service.ts` | a `filing` SSE stage between fingerprinting and insert — **only NEW rules become rows** |
| [`alter-003.sql`](infra/docker/alter-003.sql) 🆕 | drops the event log's foreign keys (see below) |

**The engine is pure on purpose.** The claim being tested is a claim about ORDER — that
replaying the same events in any arrival order gives the same graph — and that is only
checkable if the graph is a *function of the log*. So `project(assertions) -> graph`, and
the database layer is a thin wrapper.

⚠ **alter-003 — a landmine C1 planted.** `rule_assertions` had FKs to `obligations` etc.
with `ON DELETE SET NULL`, and the table is append-only. A cascading SET NULL **is** an
UPDATE, so the trigger rejected it:
```
DELETE FROM obligations WHERE id = 42;
ERROR:  rule_assertions is append-only (attempted UPDATE).
```
Every re-ingest deletes its document's obligations first, so **every re-ingest would have
failed** the moment the first assertion existed. Dropping the FKs is the right fix, not a
workaround: the log records what was believed *at the time*, the graph is a projection of
the log, and a projection must not be able to reach back and rewrite the history that
produced it. Proved live — deleting 76 obligations left all 152 assertions intact.

**Done when** — the same circular ingested twice adds zero obligations, and an amendment
produces a staged version rather than a second rule.

**Verify live — 1 · the engine** (no Docker, no database)
```bash
npm run test:filing        # 31 assertions
```
```
same circular twice                one obligation, verdicts [new, restatement]
a second circular restating it     still one obligation, BOTH documents recorded
180 → 120                          live rule UNCHANGED and ACTIVE, version 2 STAGED
THE KEY ONE: out-of-order          replay gives the same graph, and the 2023
                                   original is what stays live — not the 2026 value
retroactive circular               replay orders by effective date, not arrival
"para 9.5 stands withdrawn"        the cited rule is SUPERSEDED, via the citation lane
lane 2 vs lane 1                   the citation wins — repeal, not amendment
ambiguity                          commits nothing: no row, nothing staged, → review
lane 3                             candidates only; a new rule still files as NEW
determinism                        5 shuffled replays, one graph
```

**Verify live — 2 · three documents asserting the same duty**
```
FILE-A   filed 38 → new 30 · restatement 8      stored 30   obligations 5702 → 5732
FILE-B   filed 38 → new  0 · restatement 38     stored  0   obligations      5732
FILE-C   filed 38 → new  0 · restatement 38     stored  0   obligations      5732
```
**Zero obligations added by the second and third documents.** FILE-A's 8 self-restatements
are the circular stating the same duty twice within itself — one obligation is the right
answer there too.

The log, and the provenance it produced:
```
FILE-A | new         | fingerprint | 2024-03-11 | 30
FILE-A | restatement | fingerprint | 2024-03-11 |  8
FILE-B | restatement | fingerprint | 2024-03-11 | 38

source_spans: [{"clause":"1.1","doc_id":"FILE-A",...},
               {"restated_by":"FILE-B"}, {"restated_by":"FILE-C"}]
```
`effective_from 2024-03-11` is parsed from the circular's own date, not the ingestion
date. It is the replay sort key, so it is surfaced in the SSE stream rather than buried.

⚠ **Two bugs the live run found, both worth keeping in mind:**

1. **In-run targets.** A rule can restate one filed moments earlier *in the same
   document*, whose id is `docId#key` because it is not inserted yet — `Number()` of that
   is `NaN`, straight into an integer column. Restatement against an in-run rule now just
   inserts one row; an *amendment* against one goes to **review**, because there is no
   "before" to stage against and picking one silently would be a coin flip on a live duty.
2. **Provenance was appended twice** when one document restated one obligation more than
   once. Now guarded on both sides — deduped in memory and the UPDATE refuses a span the
   row already carries. "Said it twice" is not two pieces of provenance.

**Not built, and named rather than implied:** citation *extraction* is D8 — the citation
lane consumes citations it is given, and the test supplies them. Lane 3 matches on
audience + attribute overlap; the embedding-similarity half needs obligation vectors and
is deferred. The projection is applied incrementally rather than by full replay on every
ingest; `project()` exists and is tested, but re-deriving 5,700 obligations on each
document is a cost with no payer yet.

Regressions: `test:m3` 22/22 · `test:pattern-c` 26/26 · `test:fingerprint` 14/14 ·
`test:c1` 13/13 · `fingerprint_check` 26/26 · `pattern_c_check` 8/8 · `snapshot` PASS ·
fresh-volume parity 154 columns / 85 objects identical.

**DEPENDS** — C1, D6. **Blocks** D8, D9.

### D8 · Step 16 — link resolution `DONE`

**Why** — four of five citation kinds are consumed earlier; what remains is `depends_on`
edges, `shared_evidence` groups, the retry sweep, and `split_of`. Decisions 86–91.

**Change**

| where | what |
|---|---|
| [`citations.py`](services/ai-service/app/citations.py) 🆕 | citation EXTRACTION, beside segmentation |
| `schemas.py` · `main.py` | every clause now carries its references over the wire |
| [`links.engine.ts`](services/backend/src/ingestion/links.engine.ts) 🆕 | resolution, the fan-out asymmetry, cycles, sweep — **pure** |
| [`links.service.ts`](services/backend/src/ingestion/links.service.ts) 🆕 | the clause tree, the edges, the parking queue |
| `alter-004.sql` 🆕 | `obligations.source_clause_id` — the clause→rules map |
| `GET /api/v1/links` | edges made, and what is still waiting |
| `ingestion.service.ts` | a `links` stage, after filing and before consistency |

**Extraction happens at PARSE time, resolution after FILING.** Not a split of
convenience: by the time rules exist the wording that produced them has been rewritten
and the reference strings are gone, so they have to be pulled out early — but a link
joins two RULES, and rules do not exist until Step 15 gives them ids.

**Done when** — a conditional trigger produces a `depends_on` edge carrying its citing
clause, and a cycle is refused at insert.

**Verify live — 1 · what the corpus actually contains** (no Docker)
```bash
python tools/citation_check.py --resolve
```
```
SEBI (tiers 1-2), 1,067 references:
  statute       459   "Regulation 7(1) of the SEBI (IA) Regulations, 2013"
  annexure      198   points at a template, not a rule
  internal      410   unique 206 · by scope 15 · ambiguous 53 · absent 136
  by kind             reference 1011 · definitional 19 · amends 13 ·
                      supersedes 7 · exemption 6 · trigger 11
```
⚠ **Only 21% of references resolve to a clause we hold.** An extractor that assumed
every *"para 9.5"* named a paragraph of this circular would be wrong four times in five
and would manufacture an edge for each. Statute and annexure targets are recorded as
provenance and produce **no edge, ever**.

⚠ **Nearest-ancestor scoping is weaker than the design assumed** — measured, it settles
15 of the 68 document-wide-ambiguous citations. It is kept because it is the best
available answer, and its output is graded accordingly (below).

⚠ The 136 `absent` are mostly clauses the SEGMENTER did not produce, not citations the
extractor misread. They park; a later re-ingest may resolve them.

Range and list continuations (*"paras 55.13 to 55.49"*, *"para 63.3.1, 63.3.2 and
63.3.3"*) are 96 of the references — SEBI writes the cue once and then lists. Without
them the second and later numbers are invisible. A `to` range is recorded by its
endpoints and **not expanded**: 37 edges from one sentence is over-linking.

**Verify live — 2 · the engine** (no Docker)
```bash
npm run test:links              # 47 assertions
```
```
16a hop one   TOC row carrying the same number is NOT a target
              "1" cited from inside the annexure scopes to the annexure
              the SAME "1" cited from the body does not
              an explicit container ("para 1 of Annexure A") beats scoping
16a hop two   depends_on FANS OUT to all 3 rules of the cited clause
              amends does NOT — 3 rules from 1 clause is refused, parked
              amends resolved exactly still files as REVIEW
cycles        A→B→C admitted, C→A REFUSED at insert, reason named
              re-ingest does not duplicate an edge
evidence      grouped by the SET of attributes = one upload
              a rule with no attributes shares evidence with nothing
sweep         resolves on arrival · keyed on CONTAINER + number
              a citation whose document never arrives is abandoned
```

**Verify live — 3 · the real graph**

Ingesting the mutual funds master circular (2,490 clauses, 671 citations):
```
links  {citations: 671, edges: {depends_on: 2, amends: 4, shared_evidence: 14},
        parked: 6, refused: {cycle: 0}}
```
```
depends_on  8.4.4.3 "AMCs shall compensate any loss occasioned to any inv..."
         →  8.4.4.2 "AMCs shall ensure that each payment instrument for s..."
            raw "Paragraph 8.4.4.2" · resolved_by unique · confidence 0.9
```
A real conditional trigger, both rules named, the citing span stored on the edge.

**The sweep, end to end, on the running system.** A citation was parked pointing at
*"para 4.3"*, which no ingested document contained. Ingesting the research analysts
master circular:
```
links  {swept: {resolved: 1, abandoned: 0}}
edge   7176 → 9191  depends_on  resolved_by "sweep"
                    arrived_doc master-research-analysts-2024
```
The parked row moved `PENDING → RESOLVED`. Probe removed afterwards.

⚠ **A `scoped` edge is REVIEW, not ACTIVE — and that is a measured call.** The first
scoped edge on real data linked an investment-limit rule to a table row numbered "1".
Scoping is the best guess available and it is still a guess, so only `unique` and
`container` resolutions are filed as accepted fact.

⚠ **`amends` and `supersedes` edges are ALWAYS REVIEW, however cleanly they resolved.**
Step 15 owns the filing verdict and Step 16 has not produced one; an ACTIVE `amends`
edge would assert a change to the graph that the version history does not record.
Feeding a late-resolved `amends` back as a Step 15 correction event is the remaining
work here — the sweep deliberately refuses to write one on its own authority.

⚠ **`split_of` is 0 on real data, and honestly so.** It fires when one clause yields
several rules; the mock drafter emits one rule per window, so nothing splits. The
engine test covers it; the corpus cannot yet.

⚠ **`external` is never parked.** A statute reference can never be satisfied by an
ingest, so queueing it would grow the queue forever with rows that can only be abandoned.

**Cycles are refused at INSERT, never at evaluation.** Step 24 walks `depends_on`
during evaluation, so a cycle there is an infinite loop in the product's hot path and
the firm whose status triggered it is the one who sees the hang. Edges are admitted one
at a time — accepting a batch and checking afterwards leaves the caller holding a cyclic
graph and no way to say which edge caused it.

**One performance fix worth recording.** The obvious container query — an ancestor
chain per clause, then pick the nearest container — is quadratic, because a CTE has no
index and each of 7,752 clauses rescans the whole chain table. It did not finish. Walking
DOWN from the roots and carrying the label along visits each clause once: **0.3s**.

Regressions: `test:m3` 22/22 · `test:c1` 13/13 · `test:pattern-c` 26/26 ·
`test:fingerprint` 14/14 · `test:filing` 31/31 · `test:consistency` 29/29 ·
`test:links` 47/47 · `fingerprint_check` 26/26 · `pattern_c_check` 8/8 ·
`snapshot check` PASS (segmentation untouched — citations are additive).

**DEPENDS** — C1, D7.

### D9 · Step 17 — consistency checks `DONE` ⭐

**Why** — it is **the pipeline's regression test.** A contradiction is usually *our* bug —
a mis-resolved audience (D1/D2), wrongly merged facts (D5), a misapplied modifier (D3).
It is the only check that catches those *after the fact*, by comparing rules against each
other rather than against their source. Decisions 92–96.

**Change**

| where | what |
|---|---|
| `canonical.py` | emits `constraints` — the numeric demands, extracted from the tree it already owns |
| [`consistency.engine.ts`](services/backend/src/ingestion/consistency.engine.ts) 🆕 | the four families, **pure**, with attribute bucketing |
| [`consistency.service.ts`](services/backend/src/ingestion/consistency.service.ts) 🆕 | loads the projection, runs the checks |
| `GET /api/v1/consistency` | whole-graph report, `sebi_admin` only |
| `ingestion.service.ts` | a final `consistency` stage — a document changes the projection, so the graph is re-checked |

**Constraint extraction lives with the canonicaliser**, not in the checker, so there is
one tree walker in the codebase. Two constraints are comparable only when their
serialised left-hand SHAPES are identical — that is what stops
`days_between(#4471, today) <= 180` being weighed against a bare `#4471 <= 180`: same
attribute, different quantity, and conflating them would invent contradictions.

Two cases deliberately produce **no** constraint: an `OR` branch (`a <= 1 OR a >= 9` is
satisfiable and must not read as two conflicting demands) and anything under `NOT`.

**Done when** — a planted contradiction is found on a real corpus, and a 50k graph checks
in reasonable time.

**Verify live — 1 · the engine** (no Docker)
```bash
npm run test:consistency        # 29 assertions
```
```
interval arithmetic     <=180 vs >=365 conflict · >=180 vs <=180 do NOT (180 satisfies both)
                        >180 vs <=180 DO (no value left) · different shapes never compared
CONTRADICTION           QSB ≤180 + broker ≥365 → 1 finding, both rules named, high
                        brokers vs advisers    → 0 findings (disjoint, nothing to prove)
                        a SUPERSEDED rule contradicts nothing
REDUNDANCY              two live rules, one identity → reported, and blamed on Step 15
                        subsumption: the narrower rule adds nothing
DEAD RULE               <=5 AND >=90 · is_qsb true AND false · no audience at all
INTEGRITY               no source span · ACTIVE edge into a SUPERSEDED rule · depends_on cycle
clustering              20 contradictions from one bad audience → ONE cause, not 20
SCALE                   50,003 rules over 5,000 attributes → 130ms
                        and STILL finds the 3 planted contradictions
```
The scale case plants contradictions on purpose. **A performance test that finds nothing
proves only that it did not crash** — it has to still detect at size, or the bucketing
could be silently skipping work.

**Verify live — 2 · the real graph**
```bash
GET /api/v1/consistency
```
```
checked  {rules: 5732, checked: 5732, live: 0, withConstraints: 2}
skipped  {noConstraints: 5730}
counts   {CONTRADICTION: 0, DEAD_RULE: 5703, REDUNDANCY: 163, INTEGRITY: 0}
causes    5703  suspect Step 10 — the clause never received an audience floor
           438  suspect Step 15 — filed separately instead of as restatements
```
**Those numbers are correct, and they are the point.** 5,703 rules predate D1, so they
were never stamped with an audience — the regression test found the state of the graph
before Pattern C existed. The 163 redundancies are duplicates from earlier ingests. This
is Step 17 grading everything behind it, exactly as designed.

**Verify live — 3 · a planted contradiction, on the running system**
```
CONTRADICTION high rules [7174, 7175]
  no firm can satisfy both: "QSB cyber audit" requires <= 180 while
  "broker cyber audit" requires >= 365 on the same quantity
  cause: overlapping audiences — suspect Step 10 or Step 12
```
QSB ⊂ stock broker, so the overlap is *proven* by the lattice rather than assumed. Probe
rows removed afterwards; the report returned to 0 contradictions.

⚠ **`withConstraints: 2` of 5,732 — the check is honest about what it could not check.**
Rules fingerprinted before D9 carry no constraints, and `noConstraints` reports how many.
A run that silently reported "0 contradictions" over a graph it could not compare would
be worse than useless. The mock drafter is the other half of it: it emits mostly
`exists(...)` predicates with no numeric comparison, so even freshly ingested rules yield
few constraints. Real contradiction volume needs D4 (drafter hardening) and a live LLM.

⚠ **REVIEW rules are checked, not just ACTIVE.** The design frames a contradiction as two
ACTIVE rules, and for the product that is right. But Step 17 is also the regression test,
and a rule in REVIEW is one the pipeline *just produced* — catching a mis-resolved
audience before a human approves it beats catching it after. Findings involving a
not-yet-live rule are reported one severity lower. Without this the check was vacuous:
every rule in the dev corpus is REVIEW (mock confidence), so the first live run reported
`active: 0` and a clean bill of health over 5,732 unexamined rules.

**Reports, never fixes.** Findings are clustered by likely cause, because 400 findings
from one bad audience are ONE problem to fix.

Regressions: `test:m3` 22/22 · `test:pattern-c` 26/26 · `test:fingerprint` 14/14 ·
`test:filing` 31/31 · `fingerprint_check` 26/26 · `pattern_c_check` 8/8 · `snapshot` PASS.

**DEPENDS** — D7. **Feeds** every step before it.

---

# Part E — Explicitly not building

Recorded so they are not re-proposed. Each was argued for, then measured.

| | why it's dropped |
|---|---|
| **Step 10 phrase gate** `DROP` | **0 hits in 148 headings** and **0 in 64**. Written against an invented heading that appears nowhere in the corpus. Saved 6% of calls while risking a silent wrong-audience failure. Decision 63 |
| **Always-send-siblings** `DROP` | +23% tokens on every clause to fix ~2% of them |
| **Property retrieval from ~600** `DROP` | Filtered by intermediary type, a circular needs ~15–30. Send the filtered list whole; build retrieval only past ~40. Decision 67 |
| **Pattern B (taxonomy tiers)** `DEFER` | 1 of 8 documents (CSCRF only). The review queue covers it. When built, model the tier as a **derived property**, not an audience predicate. Decisions 70, 71 |
| **RBI numbering grammar** `DEFER` | RBI has **zero** inline-decimal clause numbers; 31 pages → 38 clauses vs SEBI's ~6/page. Needs a pluggable per-regulator grammar — a documented portability boundary, not a task. Decision 73 |
| **General satisfiability (SMT)** `DROP` | Slow, and it produces findings nobody can act on. Real contradictions are two numbers for one duty. Decision 93 |
| **Numbering audit's 4th lane** `DEFER` | AI adjudication of ambiguous leftovers — the deterministic lanes have resolved everything so far |

---

# Dependency map

Only one real chain. Everything else is parallel.

```
A1 ─→ A2                          harness      (do first — nothing else is checkable)

B1  B2  B3  B4                    corrections  (fully parallel)
     └─────────────→ D1

C1 ─────────────────→ D6 ─→ D7 ─→ D8
                                  └─→ D9

D3  D4  D5                        parallel; D3 wants D1
D1 ─→ D2
```

**Suggested order:** A1 → B1–B4 → C1 → D1 → D6 → D3 → D7 → D9 → D8 → D2/D4/D5.

D9 lands before D8 deliberately: once filing works, the consistency checker starts
grading every step behind it.

---

# Open questions — not tasks yet

- **OCR path** for scanned circulars. Undesigned. A five-year corpus will hit it.
- **Table converter selection** — must return page and position per element or the audit
  trail breaks. Candidates: Docling (retains provenance), Marker, MinerU, LlamaParse,
  Azure DI. Circulars are public, so hosted parsers are acceptable here.
- **Effective date vs issue date** extraction — the projection replay depends on it, and
  D7 assumes it exists.
- **Reference-intent patterns** — the wording separating a conditional trigger from a
  definitional reference from an exemption. Formulaic enough to pattern-match; the set
  isn't written.
- **Bulk-import references** (*mutatis mutandis*) need a structural handler.
- **Three Step-13 risks are invisible under mock mode** — judge-call volume, sequential
  throughput, cold-start naming. The first two become measurable the day a real API key
  lands; the third is D5.

---

# Downstream flows — designed later

Not yet walked in the detail Flow A received. Expect them to grow the same way Flow A did
(sketched at 14 steps, frozen at 17).

**Onboarding** register → capture profile → walk the lattice for applicable rules →
generate the intake form from the data-point registry, asking only for the **leaves** of
the formula DAG → capture facts + evidence.

**Evaluation** compute derived values from the Formula Register → evaluate each
expression → walk conditional links → GREEN / RED / AMBER / GREY.

**Amendment loop ⭐** match incoming rule → preview which firms flip → approve → version,
supersede, log → cascade re-evaluation. D7 already stages amendments for exactly this.

**Cross-cutting** review queue · hash-chained audit log · audit-pack export
(clause → rule → facts → computation → evidence).
