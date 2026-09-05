# Setu — Product Logic: the ingestion pipeline, step by step

> **What this is.** A plain-language walkthrough of what happens inside the system,
> one small action at a time — what goes in, what the step does to it, what comes out.
> Written for someone who understands how software works functionally, without
> assuming they read code.
>
> **Status:** Steps 1 → 13 documented. The walkthrough continues from Step 14
> (canonical rewrite and fingerprints → filing → links → consistency checks).
>
> **Scenario being walked:** a SEBI admin uploads the **first PDF into a completely
> empty system**. Registries are empty, no rules exist yet. Where behaviour differs
> once the system is populated, that's called out.
>
> **Test corpus — 8 documents, ~1,700 pages, 2 regulators.** Every number in this file
> was measured by running the real parser over real documents, not estimated.
>
> | document | pages | why it's in the corpus |
> |---|---|---|
> | QSB circular (2024/14) | 5 | smallest real case |
> | **Master Circular · Stock Brokers** | 419 | the single-intermediary baseline |
> | **CSCRF** (Aug 2024) | 205 | multi-entity, 22 types across 5 tiers |
> | Master Circular · Mutual Funds | 828 | largest; different SEBI department |
> | Master Circular · Investment Advisers | 83 | small master circular |
> | Master Circular · Research Analysts | 53 | small master circular |
> | **Cloud Services Framework** (2023) | 53 | multi-entity, *different* structure |
> | **RBI · IT Outsourcing Master Direction** | 31 | **different regulator** |
>
> Three designs were discarded because of what these measurements showed. Details in
> the sections they belong to.

---

## ⚠️ Three applicability patterns — and how they stack

The single most important structural finding. Measured across all 8 documents.

```
PATTERN C — document-level declaration    "this applies to: X, Y, Z"
              ↓ EVERY document has one, stated or implied
PATTERN A — chapter scoping               a heading narrows it
              ↓ 4 of 8 documents
PATTERN B — taxonomy + thresholds         tiers with per-type limits
              ↓ 1 of 8 documents
```

They are not alternatives — they **stack**. C is the floor; A and B narrow it where a
document chooses to.

### Pattern C — the base case, and the one I originally missed

```
SEBI Cloud Framework, p2 clause 3:
  "The framework shall be applicable to the following REs:
     i. Stock Exchanges  ii. Clearing Corporations
     iii. Depositories   iv. Stock Brokers through Exchanges …"

RBI IT Outsourcing MD, p6, under a heading literally titled "Applicability":
  "(a) These Directions shall be applicable to the following entities,
       collectively referred to as 'regulated entities' or 'REs':
       (i) all Banking Companies, Corresponding New Banks and State Bank
           of India as defined…"
```

**Pattern C is the only thing that survives crossing regulators.** The Cloud framework
has **one heading in 53 pages** — Step 10 as designed produces nothing for it, yet its
applicability is stated plainly in clause 3.

Master circulars mostly don't state it in the body — it's in the **title**
(*"Master Circular for Stock Brokers"*), which the pipeline currently treats as
letterhead junk.

### Pattern A — chapter scoping (4 of 8)

```
18.     Qualified Stock Brokers                    ← audience heading
  18.5    Enhanced obligations and responsibilities for QSBs:
    18.5.1  …rule…
```

One heading scopes ~200 clauses by inheritance. This is what Step 10 was designed for,
and it is frozen.

### Pattern B — taxonomy + thresholds (1 of 8, CSCRF only)

```
7      "CSCRF follows a graded approach and classifies the REs in the
        following five categories…"
  7.1    Market Infrastructure Institutions (MIIs)
  7.2    Qualified REs         ← kind=clause · leaf=True · heading=(none)
  7.3    Mid-size REs
  7.4    Small-size REs
  7.5    Self-certification REs
```

**They are list items, not headings**, so Step 10 finds none of them. Worse, three are
**deleted by the junk filter** (see Step 8's measured bug).

And the thresholds live elsewhere, in **a separate table per intermediary type**:

```
p39  "Table 3: Criteria and thresholds for AIFs categorization
      Criteria | Self-certification | Small-size | Mid-size | Qualified
      AUM      | Less than 100 cr   | …          | …        | …"
p39  "Table 4: Criteria and thresholds for Client-based and proprietary
      stock brokers' categorization …"
```

So *"Mid-size RE"* means something different for an AIF than for a broker — it is a
**matrix**, not a category.

**The clean model for it:** don't express that as a 22-branch audience predicate.
Express `re_category` as a **derived property** in the Formula Register, computed from
`(intermediary_type, AUM/clients/turnover)`. Then the audience test is just
`re_category = mid_size`. That reuses existing machinery, makes the tier **computed
rather than self-declared**, and means a firm's obligations change automatically when
its own numbers cross a threshold.

### Build order

| | | |
|---|---|---|
| **C** | **build first** | validated across 2 regulators and 4 departments; one AI call per document; gives every clause a guaranteed floor |
| **A** | already designed & frozen | SEBI master circulars |
| **B** | **defer** | 1 of 8; review queue catches it meanwhile |

*(A prediction that turned out backwards: I expected Step 10 to do **more** work on a
multi-entity circular. It does almost nothing, because neither multi-entity document
uses chapter scoping.)*

---

## ⚠️ Portability limit — the numbering grammar is SEBI-specific

Measured on the RBI Master Direction:

```
NUMBERING STYLES PRESENT

  inline decimal   "9.5.3.1 A cyber audit shall…"     0   ← what Step 6 expects
  bare number alone on its own line                  37
  Chapter – I / Chapter – II                         20
  lettered  (a) (b)                                   8
  roman lower  i. ii.                                  4
  roman upper alone  I. II.                            2
```

**Zero.** RBI puts the number on its own line and the heading on the next:

```
Chapter – I
Preliminary
1.                              ← number alone
Short title and Commencement    ← heading on the NEXT line
(a) These Directions shall be called…
```

Result: **31 pages → 38 clauses** (SEBI averages ~6 per page; this is 1.2). The tree is
structurally wrong, so no conclusion about RBI's audience patterns can be drawn from
it.

**This is a documented boundary, not a task.** While Setu is SEBI-only, Step 6 is fine.
If it ever extends to RBI/IRDAI/PFRDA — and *"regulatory-to-runtime compiler"* is not a
SEBI-specific idea — Step 6 needs a **pluggable numbering grammar per regulator**, not
a tweak.

*Caveat: one RBI document, fetched via a third-party mirror because
`rbidocs.rbi.org.in` blocks direct download. The finding is structural and
unambiguous, but it is one document.*

---

## How to read this

Every step is described the same way:

- **What arrives** — the shape of the data coming in
- **What it does** — the actual work, in order
- **What leaves** — the shape of the data going out, and what changed
- **Failure branches** — what happens when it doesn't work
- **Notes** — trade-offs, weak spots, things deliberately deferred

Steps are deliberately small. Several of them together make one file's worth of code.

---

## Context: the three layers

Before the steps, the structural decision everything else depends on. The system is
three layers, and only the middle one is expensive:

```
┌─ LAYER A — DOCUMENTS ────────────────────────────────┐
│  The original PDFs. Written once, never modified.    │
│  This is the evidence. Every rule must trace back    │
│  to a page in one of these files.                    │
└──────────────────────────────────────────────────────┘
                        ↓
┌─ LAYER B — EXTRACTIONS ──────────────────────────────┐
│  Everything the AI ever said, plus expensive derived │
│  artifacts (table grids). Cached by content hash.    │
│  EXPENSIVE. Bought once, kept forever.               │
└──────────────────────────────────────────────────────┘
                        ↓
┌─ LAYER C — THE GRAPH ────────────────────────────────┐
│  Audiences, rules, formulas, links, fingerprints.    │
│  CHEAP and deterministic. Fully disposable —         │
│  delete it and rebuild from Layer B in minutes.      │
└──────────────────────────────────────────────────────┘
```

**The graph is never edited in place. It is always recomputed.**

Why this matters: fixing a bug in the filing logic, or changing a matching
threshold, means re-running Layer C only — minutes, no AI spend. Without this
split, every logic improvement would mean re-calling the AI on millions of clauses.

---

## Step 1 — Receive and check the file

**What arrives**

Three things arrive together from the browser:

- **The file** — at this point just a stream of raw bytes. Nothing has been read.
  The system doesn't know if it's a circular, a photo, or a corrupted download.
- **The two dates typed in** — issue date and effective date, currently text.
- **The login token** — proof the uploader is a SEBI admin.

**What it does**

1. **Peeks at the first 5 bytes.** A real PDF always begins with the characters
   `%PDF`. Catches a renamed Word file or image instantly, without reading the rest.
2. **Checks the size** against the 60 MB ceiling, so one bad upload can't jam the
   pipeline.
3. **Builds a document name** from the filename — strips spaces, symbols and the
   `.pdf`, trims to a safe length. `Master Circular Stock Brokers 2024.pdf` becomes
   `master-circular-stock-brokers-2024`. This becomes the document's permanent
   handle everywhere in the system.
4. **Converts the two dates from text into real date values**, so later steps can
   sort by them rather than comparing strings.
5. **Checks the role** — only a SEBI admin gets past here.

**What leaves**

One tidy package: the confirmed bytes, the clean document name, the two dates as
proper dates, and the uploader's ID.

**Failure branches**

Any check fails → nothing is saved anywhere, the upload is rejected immediately
with the reason ("not a PDF", "file too large", "not authorised"). Because nothing
was written, there's no half-finished record to clean up.

**Notes**

At this point the system still has **no idea what's inside the document**. Not one
word has been read. This step only answers *"is this a legitimate file from a
legitimate person?"*

---

## Step 2 — Fingerprint the file and check if we've seen it

**What arrives**

The package from Step 1.

**What it does**

1. **Runs the entire file through a fingerprinting function**, producing one short
   fixed-length code. The useful property: **identical files always produce the
   identical code, and changing a single character anywhere produces a completely
   different one.** The code acts as a serial number for that exact content.
2. **Looks that code up** against every document already stored.
3. **Branches on what it finds.**

**The three outcomes**

| What's found | What happens |
|---|---|
| **No match** | Carry on. Genuinely new content. |
| **Match, same document name, and its job COMPLETED** | Re-upload of something already processed. **Stop.** Return the existing document and job. |
| **Match, but a different document name** | Same content under a new name. **Pause and ask the admin.** Either SEBI reissued an identical circular under a new number (legitimate, needs its own record) or someone uploaded the wrong file. The system can't tell which. |

**What leaves**

The same package plus the content fingerprint (which stays attached permanently)
and a verdict: new / already-have-it / same-content-different-name.

**⚠️ The important detail — skip on COMPLETED, not on PRESENT**

The lookup must check *"did this document finish processing?"*, not merely *"is this
document present?"*

If the pipeline dies partway through a bulk load, the failed document's **file** is
already stored. A plain fingerprint match would say "already have it, skip" and
silently lose a half-processed circular. So:

- fingerprint matches **and** job status is `completed` → skip
- fingerprint matches but job is `failed` / `running` / half-done → **redo it**

With that, restarting a 1,000-document load after a crash at document 500 skips the
499 finished ones in about a second each, redoes 500 properly, and carries on.

**Notes — what this deliberately does NOT catch**

If SEBI republishes the same circular but the PDF was re-scanned or re-exported,
the bytes differ, so the fingerprint differs, and it passes through as new.

That's fine — it's caught later at a finer grain. Each individual *clause* is also
fingerprinted, so a re-exported document with identical text matches clause by
clause and reuses all the cached AI work anyway. This step catches the cheap
obvious case; the clause-level check catches the subtle one.

---

## Step 3 — Put the file into document storage

**What arrives**

The package with the verdict "genuinely new".

**What it does**

1. **Sends the raw bytes to the document store** — a *different* database from the
   main one. Two different jobs, two different tools: the main database holds
   structured things you search and join (rules, data-points, firms); the document
   store holds big opaque blobs nobody queries by content.
2. **The store breaks the file into chunks internally.** A 400-page circular isn't
   held as one lump, which is why it can later be read a piece at a time instead of
   loading 40 MB into memory at once.
3. **Files labels alongside the bytes** — original filename, timestamp, fingerprint,
   clean document name — so the stored file is self-describing even if the main
   database were wiped.
4. **Gets back a reference** — a short unique address, like a locker number.

**What leaves — the shape change**

```
Before:  [ 40 MB of PDF bytes ] + name + dates + fingerprint
After:   [ a short locker number ] + name + dates + fingerprint
```

From here on every downstream step carries a light ticket instead of the whole
document. The 40 MB is only pulled out again when someone actually needs to read
the pages — and then in chunks.

**Notes — why this file is sacred**

This stored file is the **evidence layer**. Written once, then never modified,
never overwritten, never deleted — not even if the parsing later turns out to be
wrong.

Every rule the system produces must be traceable to *a specific page in this exact
file*. When a broker asks "why am I being told to do this?", the answer has to end
at an original SEBI document nobody has touched. That guarantee only holds if this
file is read-only forever.

---

## Step 4 — Create the job record and hand off

**What arrives**

The light package: locker reference, document name, dates, fingerprint, uploader.

**What it does**

1. **Creates one row in the main database — the job record.** This is the control
   desk for everything that follows. It holds:
   - a freshly generated **job ID** (long random unique code)
   - the document name and the **locker reference**
   - the fingerprint, the two dates, who uploaded it, when
   - **status** — set to `pending`
   - **a diary** — currently empty
   - **an error slot** — currently empty
2. **Opens a live progress channel** tied to that job ID — a channel the browser
   tunes into, which every later step broadcasts on.
3. **Hands the work off to the background** and immediately replies to the browser
   with the job ID and the channel address.

**What leaves — the shape change**

Two separate things now exist:

```
IN THE FILE STORE      →  the PDF itself, untouched, forever
IN THE MAIN DATABASE   →  a job record that POINTS AT it
```

The job record is small, but **every later step writes into its diary** — parsing
finished, rules extracted with counts, errors. That diary is both the progress bar
and the debugging record.

**Notes — why the work is handed off**

A 419-page circular takes minutes; a thousand of them takes days. A browser
connection can't be held open that long, so the request ends here and the user gets
a ticket number.

**And this record is what makes Step 2's resume check possible.** On restart, Step 2
reads *this* row to decide whether a document is genuinely done. Without it, the
system would have no memory of its own progress, and a crash at document 500 would
mean starting over from document 1.

**What you see on screen**

The upload box is replaced by a progress view showing stages as they complete, with
live counts. It sits at *pending* — the channel is open and waiting.

**Still true at this point:** not one word of the document has been read.

---

## Steps 5a–5c — Read the document (two lanes)

> **Design decision: the hybrid lane.** The page reader produces **two streams**, not
> one — prose and tables — because they need completely different treatment.
>
> **Why not one lane:** a PDF has no concept of a table; flattening one into text
> lines produces garbage like `Stock broker (non-QSB) ₹ 1 crore 31 Mar 2025`,
> stitching columns together and losing which value belongs to which heading. Yet
> tables in SEBI circulars often carry the *densest* rule content — a three-column
> table of category / net worth / deadline is three complete obligations per row.
>
> **Why not convert the whole document to Markdown instead:** it was considered.
> Markdown preserves tables and normalises scanned and digital documents into one
> format, which is genuinely valuable. But it breaks the **character positions back
> into the original PDF**, and those positions are what let the Clause Inspector
> highlight the exact source sentence — the audit trail the whole product rests on.
> A converter is only acceptable here if it returns page and position for every
> element it emits.
>
> It also replaces our numbering-grammar parser (tuned to SEBI's decimal numbering,
> tested at 2,493 clauses with zero false splits) with generic font-based heading
> detection, which is worse *for this document family*.
>
> **Resolution:** keep our parser for the prose spine, use a structure-aware
> converter for the table lane only. Fill the hole; don't replace what works.
>
> **Ordering constraint:** tables must be *located* before prose is extracted,
> otherwise table cells leak into the prose stream and can't be cleanly removed.

### Step 5a — Find the tables

**What arrives:** the stored PDF, fetched from the document store.

**What it does:** scans each page for table regions — repeated column alignment,
ruling lines, dense short cells.

**What leaves:** a list of locations — *"there's a table on page 297, occupying this
area of the page."* Nothing has been read yet; the tables are only **located**.

### Step 5b — Extract the prose lines

**What arrives:** the PDF, plus the table regions from 5a.

**First, the thing that surprises people about PDFs**

A PDF does not contain sentences, paragraphs, or even lines. It's a **printing
instruction sheet** — thousands of fragments each saying roughly *"put the
characters `cyber secu` at position 72 across, 340 down, in 11-point Arial."*

It describes **where ink goes**, not what the text means. A line only *looks* like a
line because several fragments happen to sit at the same height. So this step is
reconstruction: scattered positioned fragments → ordered readable lines.

**What it does**

1. **Walks the document page by page.**
2. **Pulls out every text fragment**, recording not just the characters but the
   **font size**, whether it's **bold**, how far from the **left edge** it starts,
   and how far **down the page** it sits.
3. **Skips anything inside a table region** from 5a.
4. **Groups fragments into lines** — fragments at roughly the same height on the
   same page belong together; sorted left-to-right and joined.
5. **Sorts lines top to bottom** into genuine reading order.

**What leaves — the shape change**

```
Before:  one PDF file (a sealed binary blob)
After:   an ordered list of ~16,000 lines
```

Each line carries four things that matter enormously later:

| What's kept | Why |
|---|---|
| **The text** | this is what gets read |
| **Page number** | provenance — every rule must trace to a page |
| **Font size + bold** | headings are bigger or bolder than body text |
| **Indentation** | sub-clauses sit further right — a second, independent structural clue |

That last pair is what people throw away and then regret. Extract plain text only
and you lose every visual signal about what's a heading, leaving you forced to guess
structure from numbering alone with nothing to cross-check.

**Failure branch — scanned documents**

If the PDF is a **scan** (a photograph of a printed page), there are no text
fragments at all, just an image. This step returns almost nothing.

That's not a bug — it's a different kind of document needing a different path
(OCR). The job stops with a clear reason: *"no extractable text — appears to be a
scanned document."* **This matters for a five-year corpus**, where older circulars
are much more likely to be scans.

### Step 5c — Extract the table grids

**What arrives:** the regions from 5a.

**What it does:** for each region, pulls it out as an actual grid — rows and columns
preserved — keeping the **header row separate** from the data rows, keeping the
caption above it (*"Table 3: Net worth requirements"*), and keeping page and position
so it stays traceable.

**What leaves:** the table stream, parked for now.

**Where it rejoins**

```
5b prose lines ──> 6 clause tree ──> ... ──> window building ──┐
                                                               ├──> drafting
5c table grids ──────────── parked ──────> attached to their ──┘
                                           parent clause first
```

Tables rejoin **after the clause tree exists**, because a table needs to know which
section it lives under — a table under "9.5 Cyber security" belongs to that section
and inherits its audience. They're matched by page position: a table on page 297
sitting between clause 9.5.2 and 9.5.4 belongs to 9.5.3.

Then window building handles both kinds:

- a prose clause → window = heading trail + clause text
- a table row → window = heading trail + caption + **header row** + that row

Same principle either way: **carry the context that makes the content mean
something.** A row without its header is meaningless (`₹ 1 crore` — for what? by
when?), exactly as a clause without its heading trail is.

**Notes**

- Table detection uses a layout model — slow and CPU-heavy relative to everything
  else here. Its output belongs in **Layer B**, cached against the document
  fingerprint, so a re-run reads it rather than recomputing it.
- The first column of a rule table is very often the **audience**
  ("Stock broker (non-QSB)" / "Qualified Stock Broker"). That's the same audience
  resolution used for section headings, arriving from a table cell — which closes
  part of the known "audience stated somewhere other than a heading" gap.
- Markdown tables can't express merged cells, multi-row headers, or nested tables.
  Complex annexure tables will still degrade. Better than flattening; not perfect.

---

## Step 6 — Build the clause tree

**What arrives**

The prose line stream from 5b — ~16,000 lines for a 419-page circular, each knowing
its text, page, font size, boldness and indentation. Table content is already out of
the way.

It's still a **flat list** — 16,000 lines in a row, with no idea that clause 9.5.3.1
sits inside 9.5.3, which sits inside 9.5.

**The one question asked of every line**

> *Does this line START a new clause, or CONTINUE the one before it?*

**What it does**

1. **Walks the lines in order**, top to bottom.
2. **Tests each line for a clause number at the start** — `9.`, `9.5`, `9.5.3`,
   `9.5.3.1`, and the other styles SEBI uses: `(a)`, `(b)`, `(i)`, `(ii)`, bullets.
3. **If it finds one → starts a new clause.** The **depth** comes from how many
   parts the number has: `9` → 1, `9.5` → 2, `9.5.3` → 3, `9.5.3.1` → 4.
4. **If it doesn't → the line is a continuation**, appended to the clause currently
   being built. This is how a clause running over five lines and across a page break
   ends up as one piece of text.
5. **Assigns the parent** by looking backwards: *the most recent clause with a
   smaller depth.*

**Worked example**

```
"9. Obligations of Qualified Stock Brokers"       → depth 1, new clause
"9.5 Cyber security and cyber resilience"         → depth 2, parent = 9
"9.5.3 Audit requirements"                        → depth 3, parent = 9.5
"9.5.3.1 A cyber security audit shall be"         → depth 4, parent = 9.5.3
"carried out at least once every 180 days."       → no number → glued onto 9.5.3.1
"9.5.3.2 A broker unable to comply shall file"    → depth 4, parent = 9.5.3 (sibling)
```

**What each clause ends up knowing**

| | |
|---|---|
| **Clause number** | `9.5.3.1` |
| **Heading** | its title, if it has one |
| **Body text** | the actual sentences, joined across lines |
| **Parent** | which clause it sits inside |
| **Depth** | how deep in the outline |
| **Page** | where it starts — provenance |
| **Character span** | exactly where in the document it begins and ends |
| **Path** | `9 › 9.5 › 9.5.3 › 9.5.3.1` |
| **Leaf or container** | does it have children? |

### The three things that make this harder than it looks

**1. Not every number is a clause number.** A line reading *"1.5 times the net worth
of the broker"* starts with `1.5` but it's a multiplier. Likewise *"2024. The
provisions shall apply…"*.

The guard that works best isn't a better pattern — it's **expectation**. If we're
inside section 9 and the last clause was `9.5.2`, then `9.5.3` is *expected* and
`1.5` is not. Checking each candidate against what should come next kills most false
positives, because real clause numbers arrive in sequence and stray numbers don't.

**2. Headings and obligations look different — and the font tells you which.**

```
"9.5 Cyber security and cyber resilience"   → short, bold, no verb, no full stop  → HEADING
"9.5.3.1 A cyber security audit shall..."   → long, normal weight, "shall"        → OBLIGATION
```

This is where the font size and bold flags kept in 5b earn their place. Text alone
leaves you guessing; text plus formatting makes it obvious.

**3. Containers vs real clauses.** `9.5 Cyber security` has children but no
obligation of its own — it's a signpost, marked as a **container**. `9.5.3.1` has
body text — a real clause. That distinction is what lets the junk filter later drop
signposts without dropping content.

> #### ⚠️ MEASURED — two structural facts the design assumed away
>
> **1. Some circulars are bilingual.** CSCRF carries a Hindi translation interleaved
> with the English:
>
> ```
> 7.1  "बाजार की बुनियादी संस्थाएँ (एमआईआई)"     ← Devanagari
> 7.1  "Market Infrastructure Institutions (MIIs)"  ← English, same number
>
> 79 of 1,082 clauses (7.3%) are Devanagari
> ```
>
> Every clause number appears twice with different text, producing two interleaved
> trees. **Needs a language pass before segmentation** — detect and separate the
> scripts, or the numbering audit reads the second copy as duplicates rather than
> gaps, and modifier resolution has two candidates for every citation.
>
> **2. `clause_no` is NOT a key — even in monolingual documents.**
>
> ```
> master circular   144 duplicated numbers   "1" appears 76× · "2" appears 83×
> CSCRF              81 duplicated numbers   "1" appears 153×
> ```
>
> Sub-lists restart numbering in every section. Full dotted paths (`9.5.3.1`) are far
> more unique, but a citation to a bare *"para 1"* is unresolvable without context —
> which matters directly for Step 12's modifier target resolution.

**What leaves — the shape change**

```
Before:  16,240 lines in a flat row
After:   2,493 clauses in a nested tree
```

Every clause now knows its parents, children, page, exact position, and full path.
That path becomes the "heading trail" the AI reads later, and the parent chain is
what will carry the audience down from a section heading to every clause beneath it.

*(Figures from the actual run on the 419-page master circular.)*

**Notes**

No AI has been involved yet. Nothing has decided what any clause *means*, whether
it's an obligation, or who it applies to. This step only recovered the document's
outline — the same outline a human sees at a glance from the indentation, which the
PDF had thrown away.

---

## Step 7 — Check the tree for holes (the numbering audit)

**What arrives**

The clause tree from Step 6 — 2,493 clauses, each knowing its number, parent, depth,
page and position.

**Why this step exists**

The tree just built might be **missing clauses**, and that is the most dangerous
kind of error in the whole system — because it is **invisible**.

If a rule is extracted wrongly, someone eventually notices it's wrong. If a clause
never makes it into the tree at all, nothing downstream knows it ever existed. No
error, no warning, no gap on screen. An obligation simply isn't there, and nobody
finds out until a regulator asks why a broker was never told about it.

So before going further, the system audits its own work.

**What it does**

1. **For each parent, lists its children's numbers in order.**

   ```
   Under 9.5:  9.5.1, 9.5.2, 9.5.4
                              ↑ where is 9.5.3?
   ```

2. **Looks for gaps — but only small ones**, jumps of 1 to 3. A leap from `9.5.2` to
   `9.5.40` isn't 37 missing clauses; it's a numbering restart or a parsing
   artefact, and chasing it produces noise.

3. **Investigates each missing number through three lanes, in order.**

### Lane 1 — Is the number glued to the text?

The most common cause. The PDF has no space between the number and the sentence:

```
"9.5.3The broker shall maintain records of..."
```

Step 6 didn't recognise that as a clause number, so the whole thing was swallowed
into the previous clause's body.

```
→ search the raw lines for "9.5.3" immediately followed by a capital letter or quote
→ FOUND → split the line apart → the clause exists after all
→ REPAIRED. No AI involved.
```

### Lane 2 — Is it just being referred to?

```
"...in accordance with para 9.5.3 of this circular, the broker shall..."
```

That's a **cross-reference**, not a missing clause. The number appears mid-sentence,
surrounded by words like *para*, *clause*, *in terms of*.

```
→ FOUND mid-sentence → a mention, not a definition
→ CLEARED. Nothing is missing.
```

### Lane 3 — Genuinely absent

```
→ the number appears nowhere in the document, in any form
→ either SEBI skipped it when drafting, or something upstream lost it
→ the system CANNOT tell which
→ FLAGGED for human review
```

**The rebuild loop**

If Lane 1 repaired anything, the tree has changed — so the system **goes back to
Step 6, rebuilds the tree on the corrected lines, and re-runs this audit.**

Why: a clause that was glued and is now un-glued may itself have children that were
also swallowed. One pass isn't enough. The second pass sees a clean tree, so only
genuine gaps and cross-references remain in the final report.

**What leaves**

- **The clause tree**, possibly repaired and rebuilt
- **An audit report** — how many numbers checked, how many repaired, how many
  flagged, and the detail of each flag

The report goes into the job diary and onto the progress screen, so the admin sees
*"4 clauses flagged as missing"* immediately rather than discovering it months later.

**Real numbers from our run**

On the 419-page master circular: **1,603 numbers checked, 4 genuine gaps flagged**
(15.6.2.2, 46.3.3, 57.3, 57.4), **0 false repairs**.

Those four were checked by hand and are real — the document contains a merged clause
written as *"57.5 & 57.6"*, and the numbering simply skips 57.3 and 57.4. The flags
were correct, and the system was right to raise them rather than guess.

**Why annexures are excluded from gap detection**

Annexure and appendix numbering is chaotic — it restarts, mixes letters and digits,
and is full of table numbering and form field numbers that look exactly like clause
numbers. Before this exclusion, annexure pages produced **23 false "missing clause"
hits** in one run. Gap detection is therefore limited to the main body, where
numbering is disciplined.

With the table lane from 5a/5b now stripping table content out of the prose stream,
most of those 23 would never arise at all — their source was table cell numbers
leaking in. The annexure exclusion becomes a safety net rather than the actual fix.

**What this step deliberately does NOT do**

A fourth lane is designed but not built: sending genuinely ambiguous leftovers to
the AI to adjudicate. It hasn't been needed — the three deterministic lanes resolve
everything cleanly, leaving only true absences. It stays a documented hook for when
a case appears that actually requires it.

**Notes**

Still no AI. Seven steps in, everything has been deterministic — pattern matching,
position arithmetic, bookkeeping. That's deliberate: every one of these steps is
cheap to re-run and produces the same answer every time, which is what makes the
pipeline replayable.

---

## Step 8 — Decide what actually gets sent to the AI

**What arrives**

The repaired clause tree from Step 7 — 2,493 clauses with number, heading, body
text, parent chain and page.

**The question this step answers**

> *Which of these clauses are worth sending to the AI, and which are provably not
> rules?*

Everything up to now has been mechanical. This is the first step that makes a
**judgement about content** — and how it's framed turns out to matter enormously.

### The design principle: block, don't allow

Two ways to write this filter, both sounding reasonable:

| | |
|---|---|
| **Allowlist** | *"Only send clauses that look like obligations"* — contain "shall"/"must", over 60 characters |
| **Blocklist** | *"Send everything except what is provably not a rule"* |

We built the allowlist first. **It was wrong, and we flipped it.**

**What the allowlist silently dropped:**

```
"1.1 the total number of active clients of the stock broker"
```

No "shall". No "must". Short. Discarded — yet it is one of four parameters that
*decide whether a broker is designated a QSB*, which in turn decides which entire
branch of obligations applies to them.

**The costs are not symmetric, and that is the whole argument:**

- **Sending too much** → more spend, and some clauses return "not a rule" or land in
  the review queue at low confidence. Annoying. Visible. Fixable.
- **Sending too little** → an obligation is never extracted, never stored, never
  shown to anyone. **Nobody ever finds out.** No error, no gap, no symptom.

One is a bill. The other is a compliance failure surfacing years later.

**Two further reasons the allowlist was the wrong instinct:**

1. **The AI is already a better filter than a regex.** It is explicitly instructed to
   emit no rule for purely procedural or definitional text, or for duties addressed
   to SEBI rather than the regulated entity. The regex was a dumb filter placed in
   front of a smart one, doing the same job worse.
2. **If the model is eventually run locally**, the per-clause cost argument mostly
   evaporates — and with it the only real reason to be stingy.

**Measured effect of the flip:**

| | before (allowlist) | after (blocklist) |
|---|---|---|
| QSB circular | 11 of 39 sent | **37 sent** |
| Master circular | 1,231 of 2,493 sent | **2,193 sent** |

### What it does — the four junk categories

A clause is marked **junk** only if it falls into one of these. Everything else is
sent.

**1. Table-of-contents entries**

```
"9.5  Cyber security and cyber resilience .................. 147"
```
Trailing dots and a page number, sitting inside the TOC region. A pointer to
content, not content.

**2. Containers — headings with no body of their own**

```
"9.5 Cyber security and cyber resilience"     ← has children, no obligation itself
```
A signpost. The obligations live in its children.

**3. Stubs — under 15 characters of body text**

```
"Annexure A"
"(c)"
```
Too short to contain a duty.

> #### ⚠️ MEASURED BUG — this rule is deleting audience definitions
>
> On the CSCRF circular, the stub rule discards three of the five RE categories:
>
> ```
> 7.2  "Qualified Res"    13 chars  →  junk = True   ✗ dropped
> 7.3  "Mid-size REs"     12 chars  →  junk = True   ✗ dropped
> 7.4  "Small-size Res"   14 chars  →  junk = True   ✗ dropped
> ```
>
> **An audience name is short by nature**, so a length threshold is actively hostile
> to exactly the content that matters most. Those three clauses define who the entire
> 205-page framework applies to.
>
> **Required carve-out:** never junk a short clause when its parent's lead-in
> announces a list (*"…the following five categories"*, *"…the following
> parameters"*). Such children are list items, and a short list item is normal.
>
> This is the same shape as the QSB parameter list (`1.1 the total number of active
> clients…`) — short children of a lead-in — except there the children were long
> enough to survive by luck.

**4. Letterhead and furniture**

```
"CIRCULAR SEBI/HO/MIRSD/MIRSD-PoD-1/P/CIR/2024/14"
"Yours faithfully,"
"General Manager"
```
Document plumbing — present in every circular, never a rule.

*(Category 4 exists because of a real bug: the circular's own header was once
extracted as an obligation titled "CIRCULAR SEBI/HO/…". It is now matched only
within the document's preamble, so a clause citing a circular number mid-text is
unaffected.)*

### ⚠️ Junk means "don't send" — not "throw away"

This distinction matters more than it looks.

The container `"9 Obligations of Qualified Stock Brokers"` is marked **junk**. It
will never be sent to have a rule written from it — correctly, since it isn't one.

But it is simultaneously **the most important node in the document**, because it is
the heading that tells us the audience for the next 200 clauses.

So junk clauses stay fully in the tree. They keep their position, their children,
their page, and they still form part of every descendant's heading trail. They are
excluded from exactly one thing: being sent off to have a rule written from them.

**What leaves**

The same tree, with every clause carrying a yes/no send flag.

```
2,493 clauses
  → 300 marked junk
  → 2,193 marked to send
```

### The table lane's version of this question

Table rows face the same decision, but the categories differ. What matters is **what
kind of table it is** — one small AI call per table, not per row:

| Table type | Send? |
|---|---|
| **Rule table** — each row an obligation (category / net worth / deadline) | **Yes** — one window per row |
| **Reference data** — codes, exchange names, formats | No — kept as lookup data |
| **Blank template** — "format of the report to be submitted" | No — a form, not a duty |
| **Worked example** — an illustrative calculation | No — but flagged, since examples sometimes carry the only clear statement of a threshold |

**The safety net that makes this filter survivable**

Even a blocklist can be wrong. So after extraction, a **recall audit** sweeps every
clause that produced no rule — whether we skipped it or the AI declined it — and
checks whether it still contains numbers with teeth: deadlines, rupee amounts,
percentages.

The logic: a compliance rule is usually made of numbers. A clause full of numbers
that produced nothing is suspicious by construction, and gets flagged rather than
forgotten.

That runs in a later step, but it is why this filter can afford to be simple:
nothing numeric disappears silently, whichever way the filter errs.

---

## Step 9 — Build the windows

**What arrives**

Two streams converging:

- the clause tree from Step 8, with 2,193 clauses marked "send"
- the table grids from 5c, parked since the document was read

**The principle**

> *Carry exactly the context that makes this clause mean what it means — and nothing more.*

A clause pulled out on its own is very often **meaningless**. The document's
structure carries half the meaning, and isolating a clause throws that half away.

```
9.5.3.2   "The report shall be submitted within 15 days."
```

What report? By whom? To whom? Useless alone. Its parents supply every missing
piece.

So a **window** is the clause plus its context, assembled into one block of text.
That block is what actually gets sent to the AI.

### The anatomy of a window

```
┌─ CONTEXT ────────────── the heading trail (always present)
├─ LEAD-IN ────────────── the parent's body text (when it exists)
├─ CLAUSE ─────────────── the clause itself
├─ REFERENCED ─────────── inlined text (only for some reference types)
└─ SOURCE ─────────────── document, page, position
```

### Part 1 — The heading trail (always)

Every ancestor's heading, top down:

```
[9 Obligations of Qualified Stock Brokers › 9.5 Cyber security › 9.5.3 Audit requirements]
```

Headings only, not their bodies. Usually under 150 characters, and it tells the AI
who the clause applies to, what subject it concerns, and where it sits.

### Part 2 — The parent's body text (when it exists)

Easy to miss, and it matters enormously. SEBI writes lists like this constantly:

```
1.   Based on the following parameters, stock brokers shall be
     designated as Qualified Stock Brokers (QSBs):

1.1     the total number of active clients of the broker
1.2     the available total assets of clients with the broker
1.3     the trading volumes of the broker
1.4     the end of day margin obligations of the broker
```

Read 1.4 in isolation: *"the end of day margin obligations of the broker"*. That's a
**noun phrase** — no verb, no duty, no subject. Unusable.

The obligation lives in the **parent's body**. The child is only the tail of a
sentence that began one level up. Without the lead-in, every numbered list in every
circular produces fragments.

### Part 3 — The clause's own text

The obvious part.

### Part 4 — Referenced text (only sometimes)

Per decisions 10–11 and 13: inline the referenced **text**, never the extracted
rules, and only for the reference types that need it.

```
CONDITIONAL TRIGGER — no inlining
  9.5.3.2  "Where a broker is unable to comply with para 9.5.3.1, an
            exception report shall be filed within 15 days."

  → the rule being written concerns the exception report: its own
    data-point, its own 15-day deadline
  → it needs to know NOTHING about what 9.5.3.1 says
  → the relationship is captured later as a link
```

```
DEFINITIONAL — inline it
  9.8.1  "...net worth of not less than ₹ 5 crore, computed in the
          manner specified in para 1.2."

  → the referenced text IS the content
```

Same for exemptions (*"nothing in para X shall apply to…"*) — the exemption can't be
written without knowing what is being exempted.

**Size guard:** referenced text under ~2,000 characters is inlined whole. Over that,
the referenced clause's own text goes in plus only its children's **headings** —
structure without bulk.

### Part 5 — The preceding sibling (narrow trigger only)

Sometimes a clause depends on the one immediately before it:

```
A SPLIT DUTY                          AN IMPLIED SUBJECT
9.5.3.1  audit every 180 days         9.5.3.1  broker shall prepare an audit report
9.5.3.2  The audit shall be           9.5.3.2  The report shall be submitted
         conducted by a CERT-In                to the Exchange within 15 days
         empanelled auditor
                                      "the report" points at the SIBLING,
one duty, read as two                 not at the parent
```

Both are the same failure: *the clause depends on its sibling, and we don't send
siblings.*

> #### ⚠️ This was designed twice and both versions were wrong. The numbers below are measured.

**First attempt** — trigger on any definite backward reference (`the`/`such`/`this` +
a noun, excluding entity nouns). **Second attempt** — give up on detection and always
include the previous sibling's first sentence (+23% tokens on every window).

Before building either, the detector was run over the real corpus. Result on the
419-page master circular (2,183 non-junk clauses):

| How clauses open | share |
|---|---|
| don't start with an article at all | 72.1% |
| definite (`the …`) | 17.4% |
| indefinite (`a` / `any` / `every` …) | 8.8% |
| pronoun | 1.0% |
| strong backward reference (`such` / `the said` …) | 0.7% |
| no subject at all | 0.0% *(one clause in the whole document)* |

| Of the candidates | share of all clauses |
|---|---|
| excluded entity noun (*"the broker"*, *"the Board"*) | 10.7% |
| antecedent in the **parent** — lead-in already covers it | 3.2% |
| antecedent in the **sibling** — what the fix would buy | **2.8%** |
| antecedent not found | 2.3% |

**And the examples showed even that 2.8% is inflated:**

```
18.4.1.2  "the available total assets of clients with the stock broker;"
     1.2  "the available total assets of clients with the stock broker;"
```
Not backward references — **list fragments**, which need their *parent's* lead-in
(already carried). They only "matched the sibling" because the sibling is another list
item sharing the words *clients* and *stock broker*.

```
     2.2  "It is recommended that resources employed shall have..."
    17.1  "It has been decided to put in place an Early Warning Mechanism..."
```
Dummy *"it"* — grammatically an expletive, referring to nothing.

```
     1.8  "The system auditors should follow the reporting standard..."
    12.1  "The transferee shall obtain fresh registration from SEBI..."
```
Entity nouns simply missing from the exclusion list.

**Roughly one in four of the strongest-category examples was genuine.** So the real
rate is **1–3% of clauses**, and:

- the **broad heuristic** has poor precision — it mostly fires on things the lead-in
  already handles
- **always sending siblings** is a bad trade: +23% tokens on every window to fix ~2%

#### What is actually done

**Trigger on high-precision signals only:**

```
✓  no subject at all           "Shall be submitted within 15 days."
✓  such / the said /           "Such policy shall be reviewed annually."
   the aforesaid / the above
✓  a real pronoun subject      "They shall be filed within 15 days."
   — excluding dummy "it"      (NOT "It is recommended that...")

✗  the broad "the + noun" trigger is NOT used
   measured to be mostly list fragments (covered by the lead-in) and
   entity nouns
```

That is ~1% of clauses in this corpus, so the token cost is **negligible**, and
precision is high enough to need no exclusion list to maintain.

**Everything else relies on the `inferred` field** (Step 11): when the AI can't
resolve *"the audit"*, it declares the inference and the rule routes to REVIEW. Zero
token cost, and better precision than any pattern — because the model knows when it's
confused and a regex never will.

**Two practical details:**

- **Cap the chain at two.** 9.5.3.4 refers to 9.5.3.3 refers to 9.5.3.2 — left alone
  you'd drag in a whole section.
- **The cache still works.** The window text changed, so its hash changed — but it's
  still deterministic text assembled identically every time.

**Residual:** a clause whose antecedent is genuinely missing may still get a
confident-looking rule with no declared inference. Same open case as Step 11's implied
subjects.

---

### A complete window

```
[CONTEXT]
9 Obligations of Qualified Stock Brokers (QSBs)
  › 9.5 Cyber security and cyber resilience
    › 9.5.3 Audit requirements

[LEAD-IN — para 9.5.3]
Every Qualified Stock Broker shall comply with the following requirements
in respect of the audit of its critical systems:

[CLAUSE 9.5.3.1]
A cyber security audit shall be carried out at least once every 180 days
by an auditor empanelled with CERT-In, and the audit report shall be
placed before the governing board of the broker.

[SOURCE]
document: master-circular-stock-brokers-2024
page: 148 · characters 412,880–413,061
```

*(Composite example, shaped like real circular text — the 180-day cyber audit duty
is real, the surrounding structure is illustrative.)* Roughly 600 characters, which
is typical.

What the AI can now work out that it could not from the clause alone: **who** it
applies to (QSBs, from the trail), **what subject** (cyber security audit), that
*"shall comply with the following"* governs this clause (from the lead-in), and that
**two separate duties** are hiding in one clause — the 180-day interval *and*
placing the report before the board.

### Variant — the list fragment

Real text from the QSB circular we ingested:

```
[CONTEXT]
1 Parameters for designation as Qualified Stock Brokers

[LEAD-IN — para 1]
Based on the following parameters, stock brokers shall be designated
as Qualified Stock Brokers (QSBs):

[CLAUSE 1.4]
the end of day margin obligations of the stock broker

[SOURCE]
document: circular-2024-14-mirsd
page: 1 · characters 1,840–1,897
```

Strip the lead-in and the AI receives a bare noun phrase with nothing to extract.
This is exactly the clause the old allowlist filter discarded.

### Variant — a reference inlined

```
[CONTEXT]
9 Obligations of Qualified Stock Brokers (QSBs)
  › 9.8 Financial requirements

[CLAUSE 9.8.1]
A QSB shall at all times maintain a net worth of not less than
₹ 5 crore, computed in the manner specified in para 1.2.

[REFERENCED — para 1.2, for context only]
Net worth means the aggregate value of paid-up capital and free
reserves, less accumulated losses and deferred revenue expenditure.

[SOURCE]
document: master-circular-stock-brokers-2024
page: 152 · characters 421,003–421,190
```

The **`for context only`** marker matters — it tells the AI *"understand the rule
using this, but don't write a rule from it."* Without it, a duplicate net-worth
definition gets extracted from every clause that references para 1.2.

### Variant — a table row

```
[CONTEXT]
9 Obligations of Qualified Stock Brokers (QSBs)
  › 9.7 Net worth and deposit requirements

[TABLE — "Table 3: Minimum net worth by category", page 151]
Column headings:
  Category of intermediary | Minimum net worth | Compliance date

[ROW]
  Qualified Stock Broker   | ₹ 5 crore         | 31 March 2025

[SOURCE]
document: master-circular-stock-brokers-2024
page: 151 · table 3, row 2
```

One window per **row**. The column headings do here exactly what the heading trail
does for prose — without them, `₹ 5 crore` is a number with no question attached.

Tables are attached to their parent clause by page position first: a table on page
297 sitting between clause 9.5.2 and 9.5.4 belongs under 9.5.3 and inherits its
heading trail.

Also visible: **the first column is the audience.** That's the same audience
resolution that normally reads section headings, arriving from a table cell
instead — which is how a table row can carry a scope that no heading ever stated.

---

### The content hash — and why it is computed here

Once assembled, the whole window is fingerprinted, and **that hash is the cache key
for the entire extraction layer**.

The critical detail: the hash covers **the full assembled window**, not just the
clause body. Consider the same sentence under two different headings:

```
under "9 Obligations of QSBs"        → applies to QSBs
under "12 Obligations of non-QSBs"   → applies to everyone else
```

Identical clause text. Genuinely different meaning. If the cache key were the clause
body alone, the second would get a cache hit and inherit an extraction made in the
wrong context.

Hashing the whole window costs some cache hits — a master circular restating a
clause under renumbered headings will miss — but a wrong hit here would silently
attach a rule to the wrong audience, which is the exact failure the design exists to
prevent.

**What leaves**

A flat list of windows, each carrying the clause (or table row) it came from, the
assembled text block, its content hash, and its page and character positions.

```
2,193 clauses marked "send"
  + ~180 table rows
  → ~2,370 windows
  → deduplicated by hash → ~2,290 unique windows to extract
```

From here the clause tree steps back and the **window list** becomes the working
unit. Because each window is fully self-contained, they can be processed in any
order, by any number of workers, with no coordination at all.

### What rides alongside but is NOT sent

The window *text* is what the AI sees. The window *record* keeps more, and never
leaves our system:

| Kept | Used for |
|---|---|
| **Content hash of the whole block** | the cache key — has this window been extracted before? |
| **Clause ID** | linking the result back to the tree |
| **Page + character span** | provenance; highlighting the source in the original PDF |
| **The resolved audience** | attached to the clause, used at filing time — not at drafting |
| **Detected references** | the raw list of "para 9.5.3.1" mentions, resolved into links after drafting |

That separation is deliberate: the AI gets the minimum it needs to write a good
rule, and everything required to trace, cache and file the result stays on our side.

**Notes — what is deliberately left out**

**Siblings, except on a backward reference** (Part 5). A window still doesn't include
its brothers and sisters by default — only when the clause's own opening words show
it depends on one. So the case that remains open is a duty split across
**non-adjacent** clauses, or across sections, where nothing in the wording points
backwards.

**The resolved audience.** The window carries the audience as *wording* inside the
heading trail, which is all the AI needs to write a sensible rule. The formally
resolved audience — the actual test, `is_qsb = true` — is attached to the clause
separately and used at filing time. That is why audience resolution and window
building do not depend on each other, and can run in either order.

---

## Step 10 — Work out who each section applies to

> **Companion:** an interactive walkthrough of this step (the ladder and the lattice,
> both clickable) is published at
> <https://claude.ai/code/artifact/bdc44d86-76c3-4437-a8c8-b33eb921c63d>

### ⚠️ First: this is not the next link in the chain

The numbering implies Step 10 follows Step 9 and consumes its output. **It doesn't.**

Steps 1 → 9 are a single chain, each eating what the last produced. Step 10
**branches off the clause tree** instead, runs beside window building, and doesn't
rejoin until filing.

```
  Step 6/7          Step 8            Step 9           Step 11        Step 12
  CLAUSE TREE  ──▶  JUNK FILTER  ──▶  WINDOWS    ──▶   DRAFTING   ──┐
       │                                                            │
       │                                                            ▼
       └──────▶  STEP 10  ─────────────────────────────────────▶  FILING
                AUDIENCE                                       the two streams
                RESOLUTION                                      finally meet
```

Two consequences worth holding on to:

- **It reads the clause tree, not the windows.** It looks only at *headings* — the
  container nodes Step 8 marked as junk. It never touches clause bodies.
- **Drafting does not wait for it.** A window carries its audience as *wording*
  inside the heading trail, which is all the AI needs to write a rule. The formally
  resolved audience is only needed later, when a rule is filed.

**What this step builds:** the **applicability layer of the graph** — the branch
nodes that every rule eventually hangs from.

**Why it exists:** without it, a rule from the QSB chapter and a rule from the
non-QSB chapter are indistinguishable once stored. Six months later SEBI amends the
QSB one, and the system cannot tell which of the two to change — so it either
rewrites the wrong rule, or decides one supersedes the other and deletes an
obligation thousands of firms still owe.

**What arrives**

- the clause tree from Step 6/7 — specifically its **container nodes**
- the **Audience Register** (empty on the very first document)
- the **firm-property vocabulary**

### The idea the whole step rests on

Everywhere else in this pipeline, matching is done by *meaning similarity*. That is
the right tool for data-points, because "date of last audit" is a human notion with
fuzzy edges.

An audience is different. **An audience is a set of firms.** Sets can be compared
exactly. Using a similarity score here would throw away certainty available for free.

```
MATCHING BY NAME                            MATCHING BY TEST

"Obligations of Qualified Stock Brokers"    → category=stock_broker AND is_qsb=true
"QSB Obligations"                           → category=stock_broker AND is_qsb=true

     ↓                                           ↓
different words, numbering and depth        character-for-character identical
     ↓                                           ↓
GUESS whether they're the same              KNOW they're the same
```

> **The rule: the AI translates the heading into a test. From that point on, the
> computer decides — not the AI.**

Same trick as matching "senior citizens" to "old people". Comparing the words is
guesswork; if both are written `age > 60`, you just look and know.

---

### 10a — Read the document's base applicability (Pattern C) 🆕

**Build this first.** It is the only pattern validated across both regulators, and it
gives every clause in every document a guaranteed audience floor.

```
INPUT   the document title  +  its first ~10 clauses
        ("Master Circular for Stock Brokers")
        ("The framework shall be applicable to the following REs: …")

ONE AI CALL per document
        → the list of entity types this document governs
        → resolved through the normal audience ladder (rungs 3–7)

OUTPUT  a BASE AUDIENCE, stamped on every clause as a floor
```

Why it matters most: the Cloud framework has **one heading in 53 pages**, so Steps
10b–10f produce nothing for it — but its applicability is stated plainly in clause 3.
Without Pattern C that document yields zero audiences. With it, it resolves completely.

**One change this forces upstream:** master circulars state their applicability in the
**title**, which Step 8 currently marks as letterhead junk. The title must be preserved
and passed here.

---

### 10b — Collect the heading candidates. ~~The cheap gate.~~ ⚠️ REMOVED

> **A phrase-based gate was designed, measured, and deleted.** It would have sent
> **zero** headings on *both* real documents:
>
> ```
> master circular (419p, 148 headings)   PHRASE gate → 0
> CSCRF          (205p,  64 headings)   PHRASE gate → 0
> ```
>
> The phrase list (*"obligations of"*, *"applicable to"*…) was written against an
> invented example — `"9. Obligations of Qualified Stock Brokers"` — which appears
> nowhere in the corpus. Real headings read:
>
> ```
> "18.5  Enhanced obligations and responsibilities for QSBs:"
> "52    Conditions to be met by Broker for providing Internet Based Trading"
> "1.8   BCP/DR (Only applicable for Stock Brokers having BCP/DR site)"
> ```
>
> **And the asymmetry ran the wrong way.** A false positive costs one wasted AI call
> that answers *"no, it's a topic"*. A false negative means a section silently
> inherits the wrong audience and **every rule beneath it is filed under the wrong
> group.** The gate saved ~150 calls out of ~2,400 (6%) while risking that.

**What happens instead: send every heading.**

```
419-page master circular  →  148 distinct headings  →  148 AI calls
205-page CSCRF            →   64 distinct headings  →   64 AI calls
```

Trivial against the ~2,400 calls the document already makes, and there is no silent
failure mode left.

**Plus — the Pattern B candidates** (see the banner at the top of this document):
clauses that are **list items under a taxonomy-announcing lead-in** are also
collected, because in a multi-entity circular that is where the audiences actually
live. *Designed, not built.*

---

### 10b — Translate the heading into a test

#### Choosing the vocabulary slice

> **Scale note, after measurement.** This was originally designed as *core + retrieved
> tail out of ~600 properties*. **That scale does not appear to exist.** Firm
> properties only slice the population — registration type, a few activity flags, a
> few size thresholds — so the realistic total is **tens, not hundreds**, and once
> filtered by intermediary type most circulars need **15–30**.
>
> At that size, **just send them all.** No retrieval to build, no risk of the right
> property failing to surface, and ~30 options is well inside where a model chooses
> reliably. Build retrieval only if a filtered list ever passes ~40.

The AI is given a list of firm properties and told to pick from it rather than invent
names. The filter that produces the list:

```
ALL PROPERTIES        ~120 (estimate, across SEBI's regulated universe)
  ↓ keep only those tagged for THIS circular's intermediary type
  ↓   (the tag comes from the property-approval screen — the same tick
  ↓    that supplies implied conditions, so one input serves two uses)
  ↓ plus every unrestricted property (active_clients, is_listed, …)
SENT                  ~30
```

The paragraphs below describe the retrieval design for the case where the list does
grow past that — kept because it may be needed for a full multi-intermediary registry,
but **not required at measured scale.**

Cost is the smaller reason (a stable prefix is prompt-cached anyway). **Accuracy is
the real reason**: a model choosing from 300 options performs measurably worse than
one choosing from 35, because entries buried mid-list get less attention.

The slice is built in two halves.

**Half 1 — the core (~25, always identical, prompt-cached).** Just a usage count over
the register: which properties appear in the most audience tests. There's a strong
power law — a handful do most of the work, because regulation slices firms the same
few ways repeatedly. Recomputed nightly, not per call.

**Half 2 — the tail (~10, chosen for this heading).** Three narrowing moves, cheapest
first:

```
600  all properties
      │
      ├─ FILTER by the document's intermediary type (captured at Step 0)
      │    a stock-broker circular doesn't need adviser properties
 200  │    — a tag lookup, free
      │
      ├─ MEANING SEARCH: embed the heading + its opening lines, keep the
  10  │    10 nearest property descriptions
      │    (each description was embedded once, at creation time)
      │
      ├─ ADD THE PARENT AUDIENCE'S PROPERTIES — a child heading almost
  13  │    always narrows along related lines. A lookup, free.
      │
      ├─ ADD THE CORE (25, cached)
  38  │
      ├─ DEDUPLICATE
 ~30  └─ this is what the AI sees
```

**No AI is involved in the selection itself** — a tag filter, a lookup, a precomputed
ranking, and one vector query. Milliseconds.

#### How big does the vocabulary actually get?

| | What it is | Rough size |
|---|---|---|
| **Data-points** | facts a firm reports — audit dates, net worth, client counts | thousands |
| **Firm properties** | characteristics deciding *who a rule applies to* | tens |

Firm properties exist only to slice the population — registration type, a few
activity flags, a few size thresholds. Regulation doesn't divide firms hundreds of
ways, so this set stays small while the data-point register grows into the thousands.

> **Governance rule that keeps it small:** a property earns its place **only when
> some rule's audience depends on it**. "Net worth ≥ ₹5 crore" is a rule *about* a
> data-point — that doesn't make net worth a firm property. It becomes one only if a
> circular says *"brokers with net worth above X shall…"*, using it to define who is
> addressed. If the vocabulary heads for the hundreds, that's the signal data-points
> are leaking in where they don't belong.

#### What is actually sent

**The instructions (identical every call, prompt-cached):**

```
You classify headings from Indian securities-market circulars.

Your ONLY job: decide whether this heading names a TYPE OF FIRM, and if so,
express it as a test that can be run against a firm's profile.

WHAT COUNTS AS A TYPE OF FIRM (an audience):
  "Obligations of Qualified Stock Brokers"          → yes, a kind of firm
  "Provisions applicable to clearing members"       → yes
  "Brokers offering algorithmic trading to clients" → yes
  "Requirements for firms holding client funds"     → yes

WHAT DOES NOT COUNT (a topic):
  "Cyber security and cyber resilience"             → subject matter
  "Audit requirements"                              → subject matter
  "Algorithmic trading"                             → subject matter
  "Definitions"                                     → subject matter

The distinction is WHO vs WHAT. "Algorithmic trading" is a subject.
"Brokers offering algorithmic trading" is a group of firms. Words alone
will not tell you — read what the section is addressing.

RULES FOR THE TEST:
- Use ONLY the properties listed in AVAILABLE PROPERTIES below.
- Report ONLY the condition THIS heading adds. Do not repeat the parent's
  conditions — they are applied automatically.
- If nothing in the list can express it, name the property you would need
  under `new_property`. This is a last resort; check the list carefully first.
- If this heading steps OUT of its parent rather than narrowing it (e.g. a
  section on "all intermediaries" sitting inside a chapter on QSBs), set
  `relation` to "independent" instead of "narrows".
```

**The heading (built fresh each call):**

```
HEADING
  9.  Obligations of Qualified Stock Brokers (QSBs)

WHERE IT SITS
  (document root)
    └─ 9. Obligations of Qualified Stock Brokers (QSBs)   ← this one

OPENING LINES OF THIS SECTION
  The provisions of this chapter shall apply to stock brokers designated
  as Qualified Stock Brokers in terms of para 2 of the SEBI circular dated
  6 August 2023. Such brokers shall comply with enhanced obligations in
  respect of governance, risk management and investor grievance redressal.

PARENT AUDIENCE (already applied — do not restate)
  All stock brokers
  category = stock_broker

AVAILABLE PROPERTIES
  core —
    category              stock_broker | investment_adviser | merchant_banker
    is_qsb                yes/no    designated a Qualified Stock Broker
    holds_client_funds    yes/no    holds client money or securities
    is_clearing_member    yes/no    member of a clearing corporation
    active_clients        number    count of active clients
    ...20 more

  retrieved for this heading —
    has_governance_committee   yes/no
    grievance_redressal_score  number
    enhanced_supervision       yes/no
```

**What comes back:**

```
is this an audience?   yes
name                   Qualified Stock Brokers
condition it adds      is_qsb = yes
relation to parent     narrows
new property needed    none
confidence             0.94
why                    The section explicitly addresses brokers "designated as
                       Qualified Stock Brokers" and states its provisions apply
                       to them — a class of firm, not a subject.
```

**Then we — not the AI — compose the full test:**

```
parent:     category = stock_broker
this adds:  is_qsb = yes
            ─────────────────────────────────────────
full test:  category = stock_broker AND is_qsb = yes
```

That composition being ours is deliberate: the AI has one small judgement to make,
and the arithmetic of inheritance happens in code where it can't drift.

#### What is deliberately NOT in the prompt

- **No clause bodies** — only the section's opening lines
- **No sibling headings** — each is classified alone
- **No previously drafted rules** — never feed our own output back in as input
- **No list of existing audiences** — the AI doesn't try to match. It only
  translates; matching is the computer's job on the rungs below. Showing it the
  register and asking *"is this one of these?"* would put the decision back in the
  model's hands.

---

### 10c — Normalise the test

Two circulars describing the same group will phrase it differently:

```
Circular A →   is_qsb = yes AND category = stock_broker
Circular B →   category=stock_broker AND is_qsb=true
```

Identical meaning, different strings. Compare as text and they don't match → a
duplicate audience is created.

> **Normalisation turns "means the same" into "looks the same."**

That converts a *hard* comparison (do these two logical expressions describe the same
set?) into a *trivial* one (are these strings identical?). It's why the next rung can
be a plain dictionary lookup.

#### The six passes — all plain code, no AI

```
STEP 1 — EXPAND              add implied conditions
                             is_qsb=true implies category=stock_broker

STEP 2 — CANONICALISE        property name → lowercase
                             values → one form per type (yes/1/true → true)
                             operator → property always on the LEFT

STEP 3 — TIGHTEN BOUNDS      integers only:  > 50000  becomes  >= 50001
                             (not for decimals — > 0.5 is not >= 0.51)

STEP 4 — MERGE               several constraints on one property collapse
                             to the tightest

STEP 5 — SORT                terms ordered alphabetically by property name

STEP 6 — JOIN + FINGERPRINT  glue with " AND ", hash it → the lookup key
```

#### Why sorting is allowed, and how it works

**There is no intelligence in the reordering.** `A AND B` means exactly the same as
`B AND A` — the order carries **zero** information. Because order means nothing,
we're free to pick any order, so we pick the one requiring no thought: alphabetical.

```
    is_qsb=true          "i"
    category=stock_broker "c"      → c before i

    → category=stock_broker AND is_qsb=true
```

Same principle as writing dates `2024-01-31` — not because that order is more
correct, but because if everyone writes it the same way, comparison is trivial. Or
sorting two shopping lists alphabetically to see they're the same list.

#### Where the implied terms come from — a human, once

The system does **not** work out that only stock brokers can be QSBs. That is a fact
about the real world, present in no circular. So we don't try to be clever — we ask,
at the moment a new property is approved:

```
NEW PROPERTY PROPOSED

  name        is_qsb
  meaning     whether the broker is designated a Qualified Stock Broker

  Does this property only apply to certain kinds of firm?
     ☑  category = stock_broker
     ☐  category = investment_adviser
     ☐  category = merchant_banker

  [ Approve ]
```

One tick, stored forever, never asked again. **Most properties need no ticks:**

```
is_qsb                →  only stock brokers     ✓ has an implication
is_clearing_member    →  only stock brokers     ✓ has an implication
holds_client_funds    →  brokers AND advisers   ✗ none
active_clients        →  anyone                 ✗ none
```

**What breaks without it:**

```
CIRCULAR 1                              CIRCULAR 2
  9. Obligations of QSBs                  Part II — Stock Brokers
     (sits at top level, no parent)          4. Obligations of QSBs
     → is_qsb=true                           → category=stock_broker AND is_qsb=true
```

Same firms, different strings. Rung 3 misses, and rung 4 gets the wrong answer —
*"the second has more conditions, so it's narrower; nest it underneath"* — producing
**two audience nodes where there should be one**, with rules split across both.

With the table, circular 1's test gains `category=stock_broker` during normalisation,
both become identical, and rung 3 merges them instantly.

#### What normalisation deliberately does NOT do

It only kills **cosmetic** variation. It cannot tell you that
`category=stock_broker AND is_qsb=true` is a *subset* of `category=stock_broker` —
those are genuinely different strings describing genuinely different sets. That's the
next rung's job. Normalisation makes the easy cases free so implication only handles
the genuinely hard ones.

---

### 10d — The ladder

Every heading takes the same ladder and stops at the first rung that resolves it.

```
RUNG 3 — EXACT MATCH
   normalised test is character-identical to an existing one
   → provably the same set of firms → REUSE

RUNG 4 — LOGICAL IMPLICATION
   does one test imply the other?

     new:      category=stock_broker AND is_qsb=true
     existing: category=stock_broker
     → every firm matching the new test also matches the existing one
     → NARROWER group, not a duplicate → nest it underneath

   Four outcomes, all computed:
     A implies B and B implies A  → identical      → REUSE
     A implies B                  → A is narrower  → nest A under B
     B implies A                  → A is broader   → A becomes B's parent
     neither                      → continue down

RUNG 5 — MEANING SIMILARITY            ← the fallback
   no logical match — perhaps the AI phrased it with a different or new
   property. Compare audience DESCRIPTIONS by meaning, keep the 5 closest.

RUNG 6 — AI JUDGE
   borderline candidates only → "are these the same group of firms?"
   ≤3 candidates, answered by meaning, never by name

RUNG 7 — NEW AUDIENCE
   nothing matched → propose → ⚠️ HUMAN APPROVAL
```

Rung 4 only became possible by storing tests instead of names. With a few dozen
properties, implication is cheap and exact: for the common shape (conditions joined
by AND), A implies B when every condition in B also appears in A. Numeric ranges use
interval containment — `active_clients > 50,000` implies `active_clients > 10,000`.

---

### 10e — The approval gate ⚠️

**Creating a new audience requires a human click.** This is the one deliberate
interruption in the pipeline, and it buys a hard guarantee.

A wrongly created audience produces the **duplicate branch** problem: two separate
QSB nodes, rules scattered across both, and a firm seeing half its obligations with
no sign the rest exists. Nothing downstream can detect it, because both branches look
perfectly valid.

New audiences are rare — a few dozen across SEBI's entire regulated universe — so one
click prevents it outright.

**A new firm property needs separate approval**, because it changes the vocabulary
itself and therefore what every future heading can be translated into.

**The gate doesn't block the expensive work.** Clauses under a pending audience are
still parsed and still drafted. Only filing waits.

---

### 10f — Stamp the tree

```
the container's audience is now resolved
  → every descendant with no audience heading of its own INHERITS it
  → 200 clauses beneath "9 Obligations of QSBs" all carry that audience
```

That inheritance is why the step is cheap: **148 heading calls cover all 2,193
clauses** on the master circular (measured), because once a heading is resolved every
clause beneath it inherits the answer for free.

> **Measured caveat.** The master circular is essentially **one audience** — it is
> entirely about stock brokers, with QSBs as a sub-audience in section 18. Genuine
> audience headings number roughly two to four in 419 pages. So on a
> single-intermediary circular this layer does far **less** work than the design
> implies; and on a multi-entity circular (Pattern B) it currently does almost
> **none**, for the reasons in the banner at the top of this document.

---

### Audiences form a lattice, not a tree

A folder structure gives everything exactly one parent. Real regulation doesn't work
that way:

```
              [All stock brokers]
                 ↙            ↘
            [QSBs]      [Firms holding client funds]
                 ↘            ↙
        [QSBs holding client funds]
```

That bottom node sits beneath **two** parents. A tree can't express it — you'd have
to duplicate the rules down both branches and they would drift apart.

A firm collects obligations from **every** node whose test it passes, and can be told
exactly why:

> *You are subject to this rule because `is_qsb = yes` **and**
> `holds_client_funds = yes`.*

---

### On a cold start, batch the approvals

The first document into an empty system means every audience is new — with 1,000
circulars that's an approval prompt on practically every document.

So bulk load doesn't decide as it goes. It collects **every audience candidate across
all 1,000 documents first**, normalises them, and lets rungs 3 and 4 collapse the
duplicates. Thousands of headings reduce to roughly **40 distinct audiences**,
approved in one sitting.

In steady state — one circular against a settled register — most headings resolve at
rung 3 or 4 with no approval at all.

---

**What leaves**

| Output | Consumed by | What it's for |
|---|---|---|
| **The Audience Register** — name, test, parents in the lattice, wordings seen | Filing · Evaluation | Deciding which firms a rule reaches, and proving why |
| **Every clause stamped** with its audience | Filing (Step 12) | Goes into the rule's fingerprint, so a QSB rule can never collide with a non-QSB one |
| **Approval queue** — proposed audiences and properties | SEBI admin console | The gate preventing duplicate branches |

The stamped audience is the payload. A rule's fingerprint is built from *audience +
data-points + the shape of the check*. Because the audience is baked in, the 180-day
QSB rule and the 90-day non-QSB rule produce different fingerprints and can never be
mistaken for versions of each other.

---

**Notes — where this breaks**

**Telling *who* from *what*.**

```
"Obligations of QSBs"                             → WHO
"Cyber security"                                  → topic
"Algorithmic trading"                             → topic
"Brokers offering algorithmic trading to clients" → WHO   ← nearly the same words
```

Wrong one way creates a phantom audience — the approval gate catches that. Wrong the
other way piles rules into an audience that's too broad, so firms receive obligations
that aren't theirs. **That direction has no automatic guard** and would surface as a
firm querying a rule they shouldn't have.

**Audiences written in prose.** *"Where the broker holds client funds, the audit
shall…"* is a genuine audience buried mid-sentence. This step never sees it, because
it reads only headings. It survives as a condition attached to that single rule —
correct, but that firm's dashboard won't group it the way a real audience would.
Table rows partly close this gap (a rule table's first column is often the audience);
prose remains open.

**Retrieval misses in the vocabulary slice.** The right property exists but doesn't
surface, so the AI proposes a duplicate. This fails safe — a proposed property runs
the same dedup ladder, so worst case a human sees *"proposed:
offers_algorithmic_trading — looks like existing: offers_algo_trading"* and rejects
it. One rejected proposal, not a corrupted vocabulary.

---

## Step 11 — Draft the rules

**What arrives**

The window list from Step 9 — ~2,370 self-contained text blocks (2,193 prose clauses
+ ~180 table rows), each with its content hash and its list of pattern-detected
clause citations.

---

### 11a — The cache check, before any AI call

```
for each window:
   look up  (window hash + prompt version)
     → FOUND      → use the stored result. No call, no cost.
     → NOT FOUND  → queue for extraction
```

The biggest cost saver in the pipeline. Master circulars restate earlier circulars
**verbatim**, so on a 1,000-document load roughly **40% of windows are exact
repeats**. Each unique window is sent to the AI **once, ever**.

**Why reuse is safe:**

> The cache stores **what the AI said about one clause in isolation.** It never
> stores a finished rule.

A clause always means what it means. What changes between circulars is the
*surrounding* clauses — separate windows, with their own extractions, combined later
in the free deterministic layer. So the same cached translation correctly produces
different final rules in different documents.

```
CIRCULAR 1                          CIRCULAR 2
"QSB audit half yearly."            "QSB audit half yearly."
(nothing follows it)                "...applies only when >5,000 customers"

translation: audit within 6 months  translation: audit within 6 months  ← reused
                                    + a second clause, separately translated

FINAL RULE                          FINAL RULE
audit within 6 months               audit within 6 months,
for all QSBs                        only for QSBs >5,000 customers
```

The prompt version is part of the key, so improving the instructions invalidates only
what you choose to re-run.

---

### 11b — What gets sent

**The instructions** (identical every call, prompt-cached):

```
You convert ONE clause from an Indian securities-market circular into
zero or more executable rules.

A rule must evaluate to TRUE when the firm is COMPLIANT.

EXPRESSION VOCABULARY
  functions   days_since(x)  months_since(x)  years_since(x)
              days_between(a,b)  hours_between(a,b)
              count(x)  exists(x)  max(x)  min(x)  abs(x)
  comparison  <=  >=  ==  !=  <  >
  combine     AND  OR  and parentheses

UNITS — use ONLY these, never invent one:
  days · months · years · hours · rupees · percent · count

NUMBERS
- Copy them VERBATIM from the clause. Never invent, round or infer.
- Do NOT convert between units. If the clause says "6 months", write
  6 months — not 183 days.
- Convert words to digits only: "ninety" → 90.
- Dates in ISO format: YYYY-MM-DD.

WHAT TO EMIT
  computable  a number or date decides it
  attestable  a proof-style duty with nothing to compute (maintain a policy,
              appoint an officer, keep records) → exists(<token>)
  definition  the clause DEFINES a term ("net worth means A + B - C")
              → emit the formula, NOT a rule
  modifier    the clause creates NO duty of its own; it changes how ANOTHER
              clause applies → see below
  nothing     procedural text, recitals, statements of intent, or duties
              addressed to SEBI / exchanges rather than the regulated firm

A single clause may produce SEVERAL of these at once — for example a
modifier AND a rule ("the provisions of 9.5 shall apply to QSBs with more
than 5,000 clients, who shall additionally maintain a register of audits").

MODIFIERS
A clause saying "X applies only when...", "X shall not apply to...",
"notwithstanding X...", or "in the case of Y, the period in X shall be Z"
creates no obligation of its own. Do NOT invent a rule for it.
Emit a modifier naming:
  - the clause it changes, EXACTLY as written in the text
    ("9.5.1" · "para 5.2 of the circular dated 22 May 2024" ·
     "the preceding paragraph")
  - the effect:  restrict_scope | exempt | extend_scope | override_value
  - the condition, or the replacement value

PRECONDITIONS
If a duty applies only in stated circumstances ("where the broker holds
client funds..."), put that in `precondition` — do NOT bury it in the rule.

FOR EVERY TOKEN YOU USE
  type     date | number | boolean | string | document
  meaning  one line stating what the firm must supply
  unit     from the list above, where applicable

DECLARE YOUR INFERENCES
If you had to supply anything the clause does not state — who performs
the duty, who receives a report, what "the said document" refers to —
list it under `inferred`, with what you assumed and why.
An inference is not a failure. Leaving it undeclared is.

One clause often contains SEVERAL duties. Emit one rule per duty.
Do not resolve or guess attribute IDs — tokens are placeholders.
```

**Then the window itself**, exactly as assembled in Step 9.

Not sent: no resolved audience (the heading trail carries the wording), no sibling
clauses, no previously drafted rules.

#### Why units are constrained but never converted

The instinct to standardise time at extraction is right; doing it *here* is wrong.

```
Circular says:  "at least once every half year"

Convert to days at extraction → 183 days

But what did SEBI mean?
   6 calendar months from 31 Jan   →  31 July
   183 days from 31 Jan            →  2 August
                                       ↑ two days apart
```

A firm audited on 1 August is compliant under one reading and in breach under the
other. The conversion doesn't standardise — it silently picks an interpretation and
destroys the evidence a choice was made. "Annually" is worse: 365 days, 366 in a leap
year, or the same calendar date next year — which is what a regulator almost
certainly means, and is not a fixed number of days.

Three further reasons: it **destroys provenance** (a stored "183 days" can't be traced
to a page saying "half-yearly"); it hands **deterministic work to the least
deterministic component**; and it **cements the cache** (change the conversion rule
later and you'd have to re-run the AI over everything).

**So: three representations, one truth.**

```
STORED      what the circular said       "every 6 months"    ← never changes
COMPARED    canonical form for matching  183 days            ← derived, disposable
DISPLAYED   what the user reads          "half-yearly"       ← from the source
```

Conversion happens at canonicalisation, purely to make fingerprints comparable, on a
value that can be recomputed with better rules at any time.

*(A closed unit vocabulary and ISO dates are adopted — that's constraint and
formatting, both lossless. Unit conversion is not.)*

---

### 11c — What comes back: five outcomes

**1 — One or more rules.** One clause frequently holds several duties:

```
RULE 1
  title        Cyber security audit at least every 180 days
  type         computable
  expression   compare
                 operator   at most
                 left       days since [last_audit_date]
                 right      180  unit: days
  tokens       last_audit_date · date · "date the broker last completed a
                                          cyber security audit"
  confidence   0.91

RULE 2
  title        Audit report placed before the governing board
  type         attestable
  expression   exists([audit_report_board_minutes])
  confidence   0.84
```

**2 — A definition.**

```
  type      definition
  defines   net_worth
  formula   paid_up_capital + free_reserves
              − accumulated_losses − deferred_revenue_expenditure
```

→ **Formula Register**, no obligation. The intake form asks for the four inputs and
computes the total, so a firm can't supply a figure nobody can check.

**3 — A rule carrying a precondition.**

```
  title         Daily reconciliation of client funds
  precondition  holds_client_funds = true       ← structured, not prose
  expression    days_since([last_reconciliation_date]) <= 1
```

Structured because it's already in audience-test form — which is what lets Step 12
run it through the audience ladder and promote it to a real branch.

**4 — A modifier.**

```
  type          modifier
  targets       "9.5.1"                    ← plain text, exactly as written
  effect        restrict_scope
  condition     active_clients > 5000
  confidence    0.89
  why           The clause creates no duty of its own. It narrows who
                9.5.1 applies to.
```

| Effect | Circular wording | What Step 12 does |
|---|---|---|
| `restrict_scope` | *"9.5.1 applies only when…"* | narrows who the target covers |
| `exempt` | *"nothing in 9.5.1 shall apply to…"* | carves a group out |
| `extend_scope` | *"9.5.1 shall also apply to…"* | widens the target |
| `override_value` | *"for QSBs, the period in 9.5.1 shall be 90 days"* | creates a **second, stricter rule** for the narrower group, overriding the original |

`override_value` doesn't edit the original — it creates a sibling. All brokers keep
the 180-day rule; QSBs get a 90-day rule marked as overriding it, and a QSB then sees
only the stricter one.

**5 — Nothing.**

```
  rules: []
  reason: "Procedural — directs exchanges to disseminate this circular."
```

A legitimate answer. The **recall audit** later sweeps declined clauses for numbers
with teeth, so nothing numeric disappears on the AI's say-so.

#### Why the expression is a structure, not a string

```
AS A STRING     "days_since(last_audit_date) <= 180"

AS A STRUCTURE  compare
                  operator  at most
                  left      days since [last_audit_date]
                  right     180  unit: days
```

- **Type checking** — units are present, rather than needing the string re-parsed
- **Standard-form conversion** — knowing which part is a duration is trivial on a tree
- **Stable fingerprints** — identity is the shape with literals stripped; a tree walk,
  not text surgery

---

### 11d — Validation: three lanes, all deterministic-first

#### Lane 1 — Type check

```
✓  structure well-formed
✓  all functions from the allowed list
✓  every numeric literal carries a unit from the closed vocabulary
✓  both sides of a comparison compatible
       date vs date      ✓        date vs rupees    ✗  REJECT
✓  months vs days  → auto-convert for comparison, don't reject
✓  every token in the expression has a hint
```

#### Lane 2 — Modifier cross-check

The AI's `targets` value must appear among the citations the pattern scan already
found in that clause:

```
AI targets  "9.5.1"   ·  scan found ["9.5.1"]   ✓ consistent
AI targets  "9.5.3"   ·  scan found ["9.5.1"]   ✗ the text never mentions 9.5.3
                                                → flag, don't trust
```

Cheap, and it catches a real modification attached to the wrong target — which would
otherwise silently restrict the wrong rule.

#### Lane 3 — Number fidelity → tripwire → targeted verifier

**Step 1: normalise the clause text the same way the rule was normalised**, or the
check cries wolf constantly:

```
1. word numbers → digits          ninety → 90
2. period phrases → values        half-yearly → 6 months · quarterly → 3 months
                                  annually → 12 months · fortnightly → 14 days
3. unit conversions               two weeks → 14 days
4. STRIP reference numbers        "Annexure 4" · "Form 22" · "Regulation 5"
                                  → these are pointers, not thresholds
```

That fourth rule earns its place: it means a rule that lifted `4` out of *"as
specified in Annexure 4"* now **fails** the check, because 4 was removed from the
text's number pool. A whole failure class becomes visible.

**Step 2: compare.**

```
TEXT  "...at least once every 180 days..."     numbers after normalising: {180, 15}
RULE  days_since(last_audit_date) <= 90        literal: 90

90 ∉ {180, 15}   →  nothing explains this  →  TRIPWIRE
```

**Step 3: a failure is not a rejection — it's a referral.** The deterministic check
is a tripwire deciding *who gets looked at*, not a judge. And because it fires on a
small fraction of rules, the verifier stays cheap and high-signal.

The verifier is told **exactly what's wrong** — a narrow, checkable question beats
"is this rule right?", which the same model that wrote it will usually answer yes to:

```
THE CLAUSE          [heading trail + clause text]
THE DRAFTED RULE    days_since(last_audit_date) <= 90
THE COMPLAINT       The rule uses 90. The clause contains 180 and 15.
                    Nothing in the clause explains where 90 came from.

ANSWER ONE QUESTION
  Is 90 justified by this clause?
    - if yes, explain the derivation
    - if no, give the value that IS correct
    - if you cannot tell, say so
```

**Three outcomes:**

```
JUSTIFIED   → accept · store the explanation as provenance
WRONG       → correct it · drop confidence · route to REVIEW
CANNOT TELL → route to REVIEW with both readings shown
```

**The closed loop — a correction must pass the check that failed:**

```
verifier proposes 180
text numbers: {180, 15}
180 ∈ {180, 15}   ✓  admissible

a correction that ALSO fails the check is rejected outright → human
```

So the AI can only move a value toward something demonstrably present in the source.
It cannot invent its way out of the flag.

**Scope limits — or the second call quietly becomes a second drafter:**

```
MAY change   the numeric literal that was flagged
MAY NOT      the expression structure · the tokens or their meanings ·
             the rule type · anything about a rule that wasn't flagged
```

> #### The principle this is the third instance of
>
> **Cheap deterministic check → tripwire → targeted AI adjudication with a specific
> complaint → verify the answer with the same check.**
>
> Same shape as the attribute funnel (thresholds decide the obvious cases; the judge
> sees only the ambiguous middle) and the numbering audit (three deterministic lanes;
> AI only for genuine leftovers).
>
> **The AI is never the first responder, and never the last word.**

---

### 11e — Confidence routing

```
all validation lanes passed
  AND confidence >= 0.75
  AND `inferred` is empty                →  ACTIVE

anything else                            →  REVIEW
```

**The `inferred` gate exists because nothing else can catch a filled gap.** When a
circular genuinely never states who a report goes to, the AI supplies an answer — and
the result is well-formed, correctly typed, with every number present in the source.
Type checking passes. Number fidelity passes. It looks perfect and it may be wrong.

Models are reasonably good at knowing when they filled a gap — **if given somewhere
to say so.** Without a field for it, an inference and a fact come out looking
identical. With one, the guess is labelled and a reviewer confirms it in seconds.

Under the mock drafter everything is pinned at 0.55, so all output lands in REVIEW by
construction — mock results can never be mistaken for real extraction.

---

### Running it — parallel, and why that's safe

```
windows not in cache  →  worker pool
                      →  concurrency capped by the API's rate limit,
                         not by anything in our design
                      →  each result written to the cache by window hash
                      →  each failure retried individually; one bad window
                         cannot sink a batch
```

**Order is irrelevant.** Every call is stateless — no conversation, no accumulated
context, no memory of earlier clauses. Send clause 1.1 first or clause 47.9 first;
every result is identical. Order matters later, for data-point resolution and filing,
which are deterministic, AI-free and take seconds.

---

**What leaves**

```
~2,370 windows
   → ~1,370 answered from cache      (bulk load; ~0% on a first document)
   →   ~1,000 sent to the AI
        ├─ rules          (most)
        ├─ definitions    (a few dozen)
        ├─ modifiers      (a few dozen)
        └─ declines       (procedural text)

all written to the extraction cache, keyed by window hash + prompt version
```

Everything here lives in **Layer B** and is never re-requested. Delete the graph,
rebuild from this cache for free.

---

### The boundary — what Step 11 deliberately does NOT do

| Step 11 does | Step 12 does |
|---|---|
| returns `targets: "9.5.1"` as **plain text** | resolves it to an actual **clause id** |
| — | builds the modifier index |
| — | applies modifiers to rules |
| — | resolves data-points, computes fingerprints, files |

Step 11 never looks anything up. It's a pure translation layer: one clause in, one
interpretation out. Everything relational happens in assembly.

---

### Built vs designed

| | Status |
|---|---|
| `/extract`, batched calls, forced structured output | **built** |
| Mock drafter fallback (no API key) | **built** |
| Expression validated against an allowed function list | **built** |
| Confidence → ACTIVE / REVIEW at 0.75 | **built** |
| Typed expression tree instead of a string | designed |
| Closed unit vocabulary + ISO dates | designed |
| `definition` type → Formula Register | designed |
| `modifier` type + the four effects | designed |
| Structured `precondition` field | designed |
| Modifier cross-check against pattern-scanned citations | designed |
| Number-fidelity tripwire + targeted verifier | designed |
| Window-hash extraction cache | designed |
| Full parallelism (currently sequential batches of 25) | designed |

---

### Where it breaks

**✅ Now caught — numbers that aren't thresholds.** *"as specified in Annexure 4"*
would previously have produced a rule using 4. Stripping reference-numbers from the
text's pool means the fidelity tripwire fires and the verifier adjudicates.

**⚠️ Partly handled — a clause that is both a modifier and a rule.** *"The provisions
of 9.5 shall apply to QSBs with more than 5,000 clients, who shall additionally
maintain a register of audits."* The prompt now explicitly permits both outputs from
one clause. Whether the AI reliably splits them is unverified.

**⚠️ Partly fixed — one duty split across two clauses.** Step 9's Part 5 pulls in the
preceding sibling, but only on **high-precision signals** (no subject, `such`/`the
said`, a real pronoun) — measured at ~1% of clauses. The broader *"**The audit** shall
be conducted by…"* pattern is deliberately not used, because measurement showed it
fires mostly on list fragments the lead-in already covers.

Worth being clear why this mattered. Evaluation was never wrong (both rules must
pass), but **amendment matching** was:

```
2026 circular:  "A cyber security audit shall be carried out every 90
                 days by a CERT-In empanelled auditor."   ← ONE clause

  → produces ONE rule
  → looks for what it amends
  → finds TWO existing rules · matches neither cleanly
  → reports "one rule appeared, two vanished" instead of
    "the deadline changed from 180 to 90"
```

*Residual:* duties split across **non-adjacent** clauses, or across sections, where
no wording points backwards. Still invisible.

**✅ Mostly fixed — implied subjects.** Four cases, three now covered:

| | Where the answer is | Status |
|---|---|---|
| 1 | in the parent — *"9.5.3 Every QSB shall conduct an audit and submit a report to the Exchange"* | ✅ the lead-in already carries it |
| 2 | implied by the audience — *"shall be submitted"* with no actor | ✅ the heading trail says who |
| 3 | in a **sibling** — *"the report"* pointing at the previous clause | ✅ now fixed by Part 5 |
| 4 | **nowhere in the document** | ⚠️ flagged, not fixed |

*Residual (case 4):* the circular genuinely never says, and a human reader fills it in
from experience. No context retrieval helps, because the information was never
written. The `inferred` field converts it from a silent invention into a labelled
guess routed to **manual review** — which is the correct destination, since answering
it requires domain knowledge the document doesn't contain.

**Mock inflation, still true.** The mock drafter emits a rule for every window, so the
master circular yields ~2,193 REVIEW obligations. Expected, and not a measure of
anything real.

---

## Step 12 — Assembly

> **Where we are.** Steps 1–9 turned a PDF into ~2,370 self-contained windows.
> Step 10 worked out which *type of firm* each section addresses. Step 11 sent every
> window to the AI **in parallel** and got back rules, definitions, modifiers and
> declines — each an interpretation of a single clause **in isolation**, none
> connected to anything else.
>
> So we hold a pile of correct-but-disconnected pieces. **Step 12 is where the
> parallel work stops and everything is assembled in order.**

**What arrives**

Every extraction for this document, sitting in the cache. Plus the clause tree, plus
the audience stamps from Step 10.

---

### The trigger: a phase boundary, not an event

Nothing here waits for anything. Extraction finishes **completely**, then assembly
begins.

```
PHASE A — EXTRACTION       all windows, in parallel, any order
                           → every rule, definition and modifier now exists
                           ─────────────────────────────────────
                                     ▼  phase boundary
PHASE B — ASSEMBLY         walk them in order and build the graph
```

That is why extraction could be blindly parallel: **completion order is irrelevant
because nothing is consumed until all of it is done.** No callbacks, no "has my
target finished yet?" checks, no dependency scheduler.

---

### 12a — Sort the pile

```
rules        →  9.5.1: audit within 6 months
                9.5.1: audit report placed before the board
definitions  →  1.2: net worth = paid-up + reserves − losses
modifiers    →  9.5.2: restricts 9.5.1 · customers > 5,000
declines     →  9.9: procedural, no rule
```

Definitions go to the **Formula Register**. Declines go to the recall audit. Rules and
modifiers are what this step works on.

---

### 12b — Resolve what each modifier points at

The AI gave us `targets: "9.5.1"` — a **string**, connected to nothing. Resolving
means finding the actual clause:

```
"9.5.1"  →  look up this document's clause tree by number
         →  found: clause id 88213, page 148
```

| What the clause says | How it resolves |
|---|---|
| `"9.5.1"` — a number in this document | direct lookup in the clause tree |
| `"para 5.2 of the circular dated 22 May 2024"` | resolve the **document** first, then the clause inside it |
| `"the preceding paragraph"` · `"sub-clause (b) above"` | positional — see *Problem 1* below |
| nothing matches | ⚠️ **orphaned** → flag |

That last case matters more than it looks. An orphaned modifier usually means **the
clause it points at went missing** — a second, independent signal of upstream loss
alongside the numbering audit.

---

### 12c — Build the index

Once every modifier has a resolved target, the index is a group-by:

```
  from 9.5.2   → targets 88213 (9.5.1)  · restrict · customers > 5,000
  from 9.5.4   → targets 88213 (9.5.1)  · restrict · is_clearing_member = true
  from 12.7    → targets 91004 (12.3)   · exempt   · active_clients < 500

              ↓  group by target  ↓

  88213  →  [ restrict: customers > 5,000,
              restrict: is_clearing_member = true ]
  91004  →  [ exempt: active_clients < 500 ]
```

Keyed by **clause id**, not by the text `"9.5.1"` — the same string means different
things in different documents, so resolving once up front means the walk never thinks
about it again.

---

### 12d — Walk the rules and apply

```
for each rule, in document order:

   a. LOOK UP the index for modifiers on this clause     ← the combine
   b. apply them
   c. (→ Step 13) resolve data-points
   d. (→ Step 13) promote preconditions to audiences
   e. (→ Step 14) canonical rewrite
   f. (→ Step 14) fingerprint
   g. (→ Step 15) file it
```

**Step (a) is the trigger** — a dictionary lookup asking *"does anything modify this
clause?"* Usually the answer is no and the rule passes straight through.

Note the ordering: the combine at **(a)**, the fingerprint at **(f)**. The
before-fingerprinting rule is satisfied *by the sequence itself*, not by anyone
remembering it.

**What each effect does:**

```
RESTRICT_SCOPE     "9.5.1 applies only when customers > 5,000"
   rule            audit within 6 months · all QSBs
   becomes         audit within 6 months · QSBs with >5,000 customers

EXEMPT             "nothing in 12.3 shall apply to firms with <500 clients"
   rule            daily reporting · all brokers
   becomes         daily reporting · all brokers EXCEPT those with <500 clients

EXTEND_SCOPE       "9.5.1 shall also apply to clearing members"
   rule            audit within 6 months · QSBs
   becomes         audit within 6 months · QSBs OR clearing members

OVERRIDE_VALUE     "for QSBs, the period in 9.5.1 shall be 90 days"
   rule            audit within 180 days · all brokers      ← unchanged
   PLUS a new one  audit within 90 days · QSBs · overrides the above
```

`override_value` is the odd one — it **doesn't edit the original**. All brokers keep
the 180-day rule; QSBs get a second, stricter rule marked as overriding it. A QSB's
dashboard shows only the 90-day version, with the original one click away as *"this
replaces the general requirement."*

---

### 12e — When the target is in an *older* circular

```
Circular 2025/08:
  "Para 9.5.1 of the Master Circular dated 22 May 2024 shall apply
   only to QSBs with more than 5,000 customers."
```

The target is a rule filed months ago, already fingerprinted, already live. So the
same lookup takes a different route:

```
target is in THIS document
   → apply during assembly, silently, before fingerprinting
   → nothing existed before, so nothing "changed"

target is a rule from an EARLIER document
   → that rule is already live
   → narrowing it IS an amendment
   → proposed change → diff card → SEBI approves → new version
```

No special machinery needed — narrowing a live rule's audience is exactly what the
amendment path is for.

---

### Three edge cases the lookup must handle

**Orphaned modifier** — targets a clause that was declined or never parsed. Nothing to
attach to → flag. Usually means the target rule was lost.

**Several modifiers on one rule** — apply all, combining their conditions. Order is
irrelevant for restrictions (they AND together), but `override_value` goes last, since
it creates a new rule from whatever the others produced.

**One clause, several rules.** If 9.5.1 produced *two* duties, does *"9.5.1 applies
only when…"* restrict both? We apply it to both — the modifier cites the clause, and
the clause is the only unit it can name. Usually right, occasionally not, and **the
text gives no way to tell**, so it's flagged for confirmation.

---

**What leaves**

```
rules with their FINAL applicability determined
   · modifiers applied
   · audience stamped (from Step 10)
   · preconditions still attached, not yet promoted
   · data-points still free-text tokens
   · NOT yet fingerprinted
```

The rules now know **who they apply to**, definitively. What they don't yet know is
**what data they need** — that's Step 13.

---

## Step 13 — Resolve the data-points

> **Where we are.** Step 12 finished assembly: every rule now knows **who it applies
> to**, with modifiers applied and its audience stamped. But its expression is still
> full of words the AI invented on the spot — `last_audit_date`, `audit_completion`,
> `aud_dt` — none of which are connected to anything.
>
> **Step 13 turns those invented words into permanent registry ids.** It is the one
> step in this half of the pipeline that is largely **already built**, so the numbers
> below are measured rather than estimated.

**What arrives**

Rules with final applicability, carrying free-text tokens. Plus definitions from
Step 11 awaiting the Formula Register. Plus the **Data-Point Register** (empty on a
first document).

### Why this step exists

Think of contacts on a phone. You tap **"Mom"** and it dials **+91 98765 43210**. The
label is how a human refers to it; the number is the real thing. Different people save
her as *Mother*, *Amma*, *Mom* — all pointing at one line.

The AI invents a label every time it reads a clause:

```
circular 2021  →  aud_dt
circular 2023  →  last_audit_date
circular 2025  →  audit_completion_date
```

Three labels. **One real-world fact.** Store the labels and a broker's intake form
asks for the same audit date three times, while a rule amending one won't recognise
the others.

---

### 13a — Definitions resolve first

Before any rule, regardless of where they sat in the document:

```
1.2  net worth = paid_up_capital + free_reserves
                 − accumulated_losses − deferred_revenue_expenditure

  → all FOUR tokens resolved to registry ids
  → a Formula Register entry created
  → net_worth marked  is_derived = true
```

**Why first:** if a rule using `net_worth` resolved before the definition, it would
create `net_worth` as an ordinary attribute — and the intake form would then *ask the
broker for their net worth* instead of computing it. Definitions-first makes that
impossible.

`is_derived` is the flag that matters: the intake form only ever asks for the
**leaves** of the formula tree.

---

### 13b — The funnel, per token

```
STEP 1 — build one description line
   "name: audit_last_date.
    meaning: the date on which the last cyber security audit was carried out.
    topic: cybersecurity_audit"

STEP 2 — embed it  (batched 128 at a time, up front)

STEP 3 — find the 5 nearest existing data-points by meaning

STEP 4 — ⛔ TYPE GATE — discard any candidate whose type or unit differs
   a date can NEVER merge with a count, however similar the wording
   "date of last audit"  vs  "number of audits"   → different types → out

STEP 5 — same-name tripwire
   does any canonical name or recorded alias exactly equal this token?

STEP 6 — decide
   tripwire hit          → JUDGE (always — never assume)
   distance < 0.15       → REUSE
   distance 0.15 – 0.45  → JUDGE
   distance > 0.45       → CREATE NEW

STEP 7 — the judge (only for the ambiguous middle)
   the new token + ≤3 candidates → "same data-point or not?"
   judged by meaning and topic, NEVER by name

STEP 8 — act
   REUSE  → record this spelling as an alias (provenance, not a lookup key)
          → return the existing id
   NEW    → create the row, embed it IMMEDIATELY
          → return the new id
```

**The type gate** is the cheapest guard here. Type mismatch is the most common false
merge in every data-catalogue system, it costs nothing to prevent, and it is
near-impossible to unpick later — once two facts share an id, every rule using either
of them is wrong.

**The tripwire override** is the false-merge guard. A same-name hit *always* goes to
the judge, even at distance 0.01. That is what stops a statutory audit date and a
cyber audit date — both plausibly called `last_audit_date` — from silently fusing into
one input box.

---

### ⚠️ The audience must NEVER enter the composite

This is handled by an **absence**, which is exactly why it is easy to lose. Look at
what the description line contains:

```
name:     audit_last_date
meaning:  the date on which the last cyber security audit was carried out
topic:    cybersecurity_audit          ← the SUBJECT, not the audience
```

No "QSB" anywhere. `topic` is subject matter, never who the clause addresses. So a QSB
clause and a non-QSB clause produce near-identical composites, land ~0.03 apart, and
**merge** — with no judge call needed.

**Why merging is correct.** Ask what goes on a broker's intake form:

> *"When did you last complete your cyber security audit?"*

That is **one question**, asked of a QSB and a small broker in identical words, and
each has exactly one such date. What differs is not the question — it is the **pass
mark**.

```
                data-point #41
          "date of last cyber audit"
             ONE register entry
               ↑            ↑
   [QSB] rule ≤180d    [non-QSB] rule ≤90d
```

Split it and a QSB's form has one audit-date box while a small broker's has a
*different* one — so the moment a firm is re-designated a QSB, their data doesn't
carry over.

**Where the audience actually lives:** on the rule's fingerprint, one step later.

```
identity = audience + data-point ids + shape of the check

QSB rule       broker+qsb  ·  #41  ·  days_since(x) ≤ NUM
non-QSB rule   broker      ·  #41  ·  days_since(x) ≤ NUM
                  ↑ different → different fingerprints
```

> **Audience separates rules. It does not separate facts.**

**The contrast — the case that must split:**

| | Same name? | Same meaning? | Outcome |
|---|---|---|---|
| Cyber audit date **vs** statutory financial audit date | yes | **no** — different events | **SPLIT** |
| QSB's cyber audit date **vs** non-QSB's | yes | **yes** — same event | **MERGE** |

The deciding factor in both rows is **meaning**. Not the name, not the audience.

*(Stripping entity nouns from the meaning to remove even the wording wobble was
considered and rejected: "net worth of the broker" vs "net worth of the investment
adviser" may be genuinely different under different regulations, and stripping would
wrongly fuse them. The small wobble is absorbed by the distance threshold, and
double-covered by the tripwire.)*

---

### 13c — Why this step is strictly sequential

Embeddings are batched up front, but the funnel walks tokens **one at a time, in
document order**:

```
token 1.1 creates data-point #41
token 1.4 must be able to FIND #41
```

Resolve in parallel and both would look into an empty register and both would create
the same attribute. Sequential is what makes within-document dedup work at all.

It is affordable because it is pure database work — **2,228 tokens in under a second**
on the master circular. *(See the throughput caveat below: that figure assumes no AI
calls in the loop.)*

---

### 13d — Promote preconditions to audiences

The rule carries a structured precondition from Step 11:

```
precondition:  holds_client_funds = true
```

Already in audience-test form — so run it through the **Step 10 ladder**, intersected
with the rule's current audience:

```
current audience   QSBs        (category=stock_broker AND is_qsb=true)
precondition       holds_client_funds = true
                   ─────────────────────────────────────────
combined test      broker AND is_qsb AND holds_client_funds
                   → ladder → rung 3 exact match → that node already exists

  → attach the rule to "QSBs holding client funds"
  → DROP the precondition (now redundant)
```

If the combined test resolves to no existing audience, it needs approval — and the
rule waits in **REVIEW**, exactly as in Step 12's Problem 2.

---

### Cold start vs steady state — two different algorithms

**The problem:** resolve greedily one circular at a time and **whichever document is
processed first names everything forever.** If a 2019 circular said `aud_dt`, that
becomes canonical — even though 400 later circulars say `last_audit_date`.

```
BULK LOAD                              STEADY STATE
collect ALL mentions across all        one circular arrives against a
1,000 documents first (~180,000)       settled register
   ↓                                      ↓
embed them all                         run the funnel above, one token
   ↓                                   at a time
CLUSTER them together                     ↓
(not pairwise comparison)              most resolve at reuse or create
   ↓                                   with no judge call
~4,000 clusters
   ↓
canonical name by frequency ×
recency × clarity
   "last_audit_date" used 400×
   beats "aud_dt" used once
   ↓
every other spelling → alias
   ↓
borderline clusters → batched judge
```

Same funnel, different entry point: bulk load decides **once with full corpus
knowledge**; steady state decides **incrementally against what is settled**.

---

**What leaves**

```
rules whose every token is now a registry id
   · applicability final (Step 12)
   · preconditions promoted or pending
   · data-points resolved
   · NOT yet canonically rewritten or fingerprinted

plus a populated Data-Point Register and Formula Register
```

---

### Built vs designed — with measured numbers

| | Status |
|---|---|
| Composite description line, batched embedding | **built** |
| Top-5 vector search (pgvector HNSW) | **built** |
| Same-name tripwire | **built** |
| Thresholds 0.15 / 0.45 | **built** |
| `/judge/attribute` (real + mock) | **built** |
| Alias-as-provenance, create-and-embed-immediately | **built** |
| Sequential resolution with memoisation | **built** |
| Type/unit gate | designed |
| Definitions-first ordering + Formula Register | designed |
| Precondition promotion | designed |
| Cold-start clustering (today it is greedy sequential) | designed |

**Measured end-to-end on the real circulars:**

| | QSB circular | master circular |
|---|---|---|
| tokens seen | 37 | 2,228 |
| created | 29 | 1,960 |
| reused | 8 | 268 |
| sent to the judge | 8 | 311 |
| forced by the tripwire | 8 | 311 |

**The false-merge guard fired for real:** `exchange_ensure_that_evidence` appeared 6×
across 4 different topics and was kept as **six separate data-points** rather than
merged on the strength of a matching name.

---

### Where it breaks — three categories

Worth separating, because they need completely different responses.

#### A. Mock artifacts — these vanish the day a real key lands

**Only one dedup path can fire.** The pseudo-embeddings are hash-seeded random
vectors, so distance between two *different* strings is noise (~1.0) and between
identical strings is 0. So on the live mock pipeline the **only** path that ever fires
is the exact-name tripwire — the vector lane, both thresholds, and the whole
alias/provenance path are never exercised. **Zero aliases across both circulars**,
exactly as expected.

Those paths are covered instead by `npm run test:m3` — 24 assertions driving the real
service against an in-memory register with **deliberately controlled** vectors,
including the case that matters most: a distance-0.01 vector still does *not*
auto-merge when the tripwire fires.

**The register is inflated.** 1,989 data-points from two circulars, with slug
categories like `order_further`. Downstream of the mock drafter emitting a rule (and
tokens) for every clause. A real drafter declines procedural text, so the real
register is far smaller and its topics are real.

#### B. Genuine limits — these exist in production too

**The thresholds are placeholders.** 0.15 and 0.45 are an agreed starting point, not a
measurement. Meaningless under mock embeddings, so they must be calibrated on a
hand-labelled same/different set before any dedup number is trusted.

**Divergent meanings, one fact.** If the AI describes the same fact as *"date of last
cyber audit"* in one circular and *"when the IT security review concluded"* in another,
the distance may exceed 0.45 and **both are created without the judge ever seeing
them.** Thresholds decided; nothing was consulted. The funnel cannot detect its own
miss. It surfaces later as a broker being asked two near-identical questions on their
intake form — which is at least a good place to catch it.

#### C. Hidden by mock mode — unknown until measured

These are the ones that matter most, because testing has been **structurally unable to
reach them.**

**1 — Nobody knows how many judge calls there will be.**

```
MEASURED (mock)                       PRODUCTION (unknown)
311 judge calls on the master         311 from the tripwire
circular — ALL from the tripwire      + everything landing in 0.15–0.45
0 from the vector band                     ↑ this number does not exist yet
```

At 5% of tokens that is ~110 extra calls per circular; at 30% it is ~670. Across 1,000
circulars that is the difference between roughly 100k and 700k AI calls, and there is
no basis to guess which.

**2 — Sequential resolution plus AI calls is a throughput problem.**

Resolution is deliberately sequential. Today that costs nothing (2,228 tokens in under
a second) because the mock judge is instant local code. Put a ~1-second judge call
inside that loop:

```
if 20% of 2,228 tokens hit the judge  →  ~445 sequential calls
                                      →  ~7 minutes per circular
                                      →  ~5 days for 1,000 circulars
```

**Likely fix:** two passes — resolve everything deterministic first (fast, sequential,
no AI), collect the judge cases, **batch them**, then apply verdicts in order. It costs
some of the "just-created is visible to the next token" property, which needs thinking
through, but turns days into minutes.

**3 — Cold-start clustering is not built.** ⚠️ *This one is a build gap, not a test
gap.* What exists is the greedy sequential funnel. A bulk load today would therefore
let **whichever circular is processed first name everything** — `aud_dt` from 2019
beating `last_audit_date` used 400 times. No amount of testing fixes that; the
clustering path has to be built before any bulk load.

---

### What to measure the day a real key lands

On a single real circular, before building anything further on top of this step:

```
1. the DISTANCE DISTRIBUTION across all tokens
   → how many actually fall in 0.15–0.45?
   → that one histogram sizes both the cost and the throughput problem

2. CALIBRATE the thresholds on a hand-labelled same/different set

3. TIME the resolution phase end to end
   → if it is minutes, two-pass batching becomes required, not optional

4. SPOT-CHECK for divergent-meaning duplicates
   → sort the register by meaning-similarity and eyeball the near-misses
     that landed just over 0.45
```

Roughly an afternoon, and it converts three unknowns into three numbers.

---

## Step 14 — Canonical rewrite and fingerprints

> **Where we are.** Step 12 settled **who** each rule applies to. Step 13 turned the
> AI's invented words into permanent registry ids. The rule is now correct and fully
> connected — but nothing yet lets the system recognise it **again**, six months later,
> when a new circular restates or amends it.
>
> **Step 14 gives every rule two hashes.** One answers *"is this the same duty?"* and
> the other answers *"has anything about it changed?"* Together they are what makes an
> amendment detectable as an amendment rather than as an unrelated new rule.

**What arrives**

Rules carrying: a final `audience_id`, an expression whose tokens are registry ids, the
Formula Register, and the modifiers already folded in by Step 12.

---

### Why this step exists

A master circular reissued each year repeats hundreds of rules verbatim. An amendment
circular changes one number in one of them. Without a stable identity for a rule, the
system cannot tell those two situations apart — and both look identical to a naive
text comparison, because *every* rule's text differs slightly between issues.

So each rule gets a pair of fingerprints:

```
IDENTITY  →  audience  +  data-points  +  the SHAPE of the test     (values removed)
FULL      →  identity  +  the values                                (everything)
```

Which gives Step 15 a three-way verdict from two comparisons:

| identity | full | what it means |
|---|---|---|
| match | match | **restatement** — a master circular repeating an existing rule. File a citation, change nothing |
| match | differs | **amendment** — same duty, the value moved. 180 days became 90 |
| no match | — | **new rule** |

The middle row is the entire point. `days_between(...) <= 180` and
`days_between(...) <= 90` must collide on identity — that collision is the detection.

---

### 14a — Parse to a tree, not a string

The fingerprint is currently computed on **normalised text**, and text is fragile.
The AI will phrase the same duty differently in two circulars, and every variance
manufactures a phantom new rule:

```
days_between(a, b) <= 180        →  hash X
180 >= days_between(a, b)        →  hash Y      ← same duty, different hash
x AND y                          →  hash P
y AND x                          →  hash Q      ← same duty, different hash
```

[`ast_parse.py`](../services/ai-service/app/ast_parse.py) already contains a full
recursive-descent parser for the expression grammar — but `AstResult` returns only
flat lists (`functions`, `identifiers`, `literals`). **It builds a tree and discards
it.** Step 14 keeps the tree, then canonicalises it:

```
1. COMPARISONS face one way
     the data-point goes on the left, the operator flips to suit
     180 >= x        →   x <= 180

2. COMMUTATIVE OPERANDS are sorted
     AND, OR, +, * have no meaningful order — impose a stable one
     y AND x         →   x AND y

3. STRUCTURE REPLACES PUNCTUATION
     parentheses and whitespace stop existing; nesting is the tree

4. SERIALISE deterministically   →  the string that gets hashed
```

Equivalent rules now produce identical output regardless of phrasing.

---

### 14b — Names become ids

Already built. `[Cyber.last_audit_date]` → `#4471`.

The hash is built from **ids, never labels** — so the topic spelling, the AI's naming
whim and any later cosmetic rename are all irrelevant to identity.

---

### 14c — Mask the values, hash twice

```
identity_core  =  audience_id  +  canonical tree with literals masked
                                  ("..." → STR,  123 → NUM)

full_core      =  identity_core  +  the literals, in tree order

identity_hash  =  sha256(identity_core)
full_hash      =  sha256(full_core)
```

Worked through, for the case that motivated all of this:

```
QSB          audience #7   days_between(#4471, today) <= 180
                           →  identity: #7 | #4471<=NUM        →  a1b2c3
                           →  full:     #7 | #4471<=180        →  d4e5f6

Non-QSB      audience #8   days_between(#4471, today) <= 90
                           →  identity: #8 | #4471<=NUM        →  9z8y7x    ← DIFFERENT
                           →  full:     #8 | #4471<=90         →  6w5v4u

Two coexisting duties. No collision, because the audience is in the hash.
```

```
2026 amendment to the QSB rule — 180 becomes 120

             audience #7   days_between(#4471, today) <= 120
                           →  identity: #7 | #4471<=NUM        →  a1b2c3    ← MATCHES
                           →  full:     #7 | #4471<=120        →  differs

identity match + full differs  →  AMENDMENT of the QSB rule. Correct.
```

---

### ⚠️ 14c.1 — The audience enters by **id**, not by shape

This was the decision that had to be made before the step could be frozen, and it is
the difference between a working amendment loop and a corrupted graph.

**The bug in what exists.** The code at `attribute-resolver.service.ts` hashes the
expression **only** — the audience never enters. So:

```
QSB      days_between(...) <= 180   →  masked  →  #4471<=NUM   →  abc123
Non-QSB  days_between(...) <= 90    →  masked  →  #4471<=NUM   →  abc123
                                                                 ^^^^^^
                                                       THE SAME HASH
```

Step 15 sees an identity collision and files the non-QSB rule as **an amendment to the
QSB rule**. 180 is superseded by 90. Two distinct coexisting obligations silently
collapse into one wrong one — no error, no flag, a quietly incorrect rulebook.

**The choice.** Once the audience is in the hash, it can enter two ways:

| | how a threshold change reads | the risk |
|---|---|---|
| **by shape** — `[clients] > NUM` | 5,000 → 10,000 keeps identity → clean amendment | `category=='stock_broker'` and `category=='mutual_fund'` **both mask to `[category]==STR`** — a brokers' duty and a mutual-funds' duty become the same rule |
| **by id** — `audience #7` | mints a new audience → identity misses → files as a new rule, old one orphaned | a duplicate sits in the review queue |

**Frozen: by id.**

The two errors are not symmetric, and that asymmetry decides it:

```
a false AMENDMENT   overwrites a live obligation, invisibly
a false NEW RULE    leaves a duplicate where a human sees it

When you are going to be wrong, be wrong LOUDLY.
```

By-shape reintroduces exactly the disease the audience was added to cure — silent
cross-population merging — just at the category level instead of the tier level.
By-id's failure is a visible duplicate, which the review queue already handles.

---

### 14d — Store the inputs, not just the hash

The identity hash is built from registry ids. When Step 13's cold-start clustering
merges or renames attributes, **every hash already in the database becomes stale.**

So each rule stores its hash *inputs* alongside the hash itself:

```
audience_id  ·  sorted attribute_ids  ·  the canonical tree  →  and then the hash
```

The hash is **recomputable, never a permanent key.** This is Layer C's rule applied
here — the graph is always recomputed, never edited — and it is what makes a registry
migration a re-derivation instead of a rebuild.

---

**What leaves**

Every rule carrying `canonical_tree`, `attribute_ids`, `audience_id`, `identity_hash`,
`full_hash` — plus the raw inputs, so all of it can be rebuilt. Step 15 files on it.

---

### Where it breaks

**1 · Structural amendments are invisible to the hash.** When an amendment *adds* a
condition —

```
before   interval <= 90
after    interval <= 90 AND scope includes cloud
```

— the data-point set changed, so identity misses and it files as a new rule. This is
**common**; real amendments add conditions as often as they move numbers.

*Resolution:* the fingerprint is **one lane of three**, and Step 15 is designed around
that. Lane 2 is citation matching (*"this partially modifies para 9.5 of circular X"* —
regulators usually say so explicitly). Lane 3 is fuzzy: same audience + overlapping
attribute ids + same obligation topic → a review-queue candidate. Overselling the hash
as a complete amendment detector is the mistake to avoid.

**2 · Operator flips file as new.** *"at least 180 days"* → *"at most 180 days"*
changes the shape, so identity misses. Rare, lands in review, acceptable.

**3 · Attestable rules have no expression to parse.** A large share of SEBI text is
*"shall maintain adequate systems and procedures"* — no operators, no data-points, no
literals. Nothing structural to fingerprint.

*Resolution:* a fallback identity of `audience_id + attribute_ids + hash of the
normalised obligation sentence`. It is genuinely weaker and will generate more
review-queue traffic, and there is no way around that — **prose cannot be diffed
structurally.** The alternative is not a better hash; it is a human.

**4 · Registry churn invalidates every hash.** Handled by 14d, and only by 14d. It is
the reason the inputs are stored.

---

### What it costs to build

Three changes; the funnel around them already works.

```
1.  return the tree from ast_parse.py      (it already builds it)
2.  add the canonicaliser                  (flip · sort · serialise)
3.  put audience_id into the hash          ← the bug fix, and the smallest edit
```

---

## Step 15 — Filing

> **Where we are.** Step 14 gave every rule two fingerprints. Step 15 is where they are
> finally *used* — deciding whether an incoming rule is new, a repetition of something
> already known, or a change to a live obligation, and committing that decision.
>
> This is the step the whole ingestion half exists to reach. Everything before it turns
> prose into a well-formed rule; **this is where the rule meets the graph.**

**What arrives**

Rules carrying `audience_id`, `attribute_ids`, canonical tree, `identity_hash`,
`full_hash`, source spans — plus the document's circular number, issue date and
**effective date**.

**State of the code:** the hashes are computed and written
(`ingestion.service.ts` sets `identityHash` / `fullHash` on each row) but **nothing
reads them**. There is no filing logic; every rule inserts as new. `obligation_versions`
already has the right shape — `validFrom`, `validTo`, `supersededReason`, `snapshot`.

---

### The five verdicts

| verdict | condition | what happens |
|---|---|---|
| **Restatement** | identity ✓ · full ✓ | Nothing changes. Add a source span — this circular also says it. **The most common outcome at corpus scale** |
| **Amendment** | identity ✓ · full ✗ | Same duty, the value moved. Version the existing rule |
| **New** | no match on any lane | Insert, version 1, `ACTIVE` |
| **Repeal** | *no incoming rule at all* | An existing rule goes `SUPERSEDED` |
| **Ambiguous** | partial or multiple matches | Review queue, nothing committed |

**Repeal is the verdict that is easy to design past.** *"Para 9.5 of circular X stands
withdrawn"* produces **no incoming rule to match** — it is an instruction to kill an
existing one. No fingerprint can see it, because there is nothing to fingerprint. Only
the citation lane reaches it.

---

### The three lanes

```
LANE 1 · FINGERPRINT     exact identity_hash lookup
                         deterministic · free · catches VALUE changes
                         blind to everything else

LANE 2 · CITATION        the circular says so, in words:
                         "this partially modifies para 9.5 of
                          SEBI/HO/MIRSD/2023/45"
                         citation → document → clauses → obligations
                         (sourceSpans already carries that chain)
                         → the ONLY lane that sees structural
                           amendments and repeals

LANE 3 · FUZZY           same audience + overlapping attribute ids
                         + similar obligation embedding
                         → produces CANDIDATES, never decisions
```

**When lanes 1 and 2 disagree, lane 2 wins.** An explicit statement of intent from the
regulator outranks a hash collision. The hash is an inference; the citation is a fact.

---

### ⚠️ 15a — Ordering: filing appends events, the graph is a projection

**The problem.** Amendments only mean anything in **effective-date order**, and a bulk
load of five years of PDFs arrives in whatever order the download gave you:

```
ingest the 2026 amendment first   →  no match      →  files as NEW
ingest the 2023 original second   →  identity ✓    →  files as an AMENDMENT
                                                      that moves 90 back to 180

The graph now says 180 days. SEBI says 90.
No error was raised. Nothing looks wrong.
```

**Why sorting is not enough.** Sorting the corpus by effective date fixes the bulk load
and **fails in the steady state**: circulars apply retroactively, so a document that
arrives in March can be effective from January — by which time firm statuses have
already been computed against a graph that didn't know about it.

**Frozen: event replay.**

```
Filing does not mutate the graph. It APPENDS an immutable assertion:

     document D asserts rule R, effective E, verdict V

The live graph is a PROJECTION — replay the log in effective-date order.
A late retroactive circular inserts an event and replays from its date.
```

This is not new architecture. It is **Layer C's existing rule applied one level up** —
the graph is recomputed, never edited — and Layer C was built disposable precisely so
this is cheap.

It also buys the thing that is otherwise unbuildable: *"what did we believe on
12 March?"* Replay to that date. Without an event log that question has no answer, and
an audit pack that cannot reconstruct a past belief is not an audit pack.

---

### ⚠️ 15b — Amendments are staged, never auto-applied

```
restatement  →  AUTO      nothing changes; provenance only
new rule     →  AUTO      inserted ACTIVE; adds an obligation, flips nobody
amendment    →  STAGED    new version written PROPOSED
                          the old version stays ACTIVE until a human approves
```

The reason is not caution. **The approval step is the product.**

An amendment is the only verdict that can flip a firm from compliant to breaching. Auto-
applying it would delete the exact moment the entire demo is built around — *SEBI issued
this → here is precisely which firms change → approve*. The amendment console is not a
safety net bolted onto filing; it is what filing exists to feed.

The blast radius argument is the same asymmetry that decided Step 14: a new rule adds
something and flips nobody, while an amendment silently rewrites a live duty. At corpus
scale amendments are a small share of rules, so staging them does not create an
unreviewable queue — it aims human attention at the few decisions that actually move a
firm's status.

---

**What leaves**

An append-only assertion log, a projected graph of `ACTIVE` obligations, versioned
history in `obligation_versions`, a set of staged `PROPOSED` amendments awaiting the
console, and a review queue of everything ambiguous.

---

### Where it breaks

**1 · Citations into documents we do not have.** A 2024 circular amending a 2019
circular that was never ingested. *Resolution:* store the citation **unresolved** and
resolve it retroactively when that document lands — Step 16's machinery, so this is a
dependency rather than a separate problem.

**2 · One incoming rule matching several existing ones.** Trivial expression shapes
(`x == true`) are low-entropy and will collide across genuinely unrelated duties.
*Resolution:* **if identity matches more than one `ACTIVE` rule, never auto-file.**

**3 · Silent duplicates.** A master circular restates a rule, but Step 13 resolved one
token to a different attribute this time, so the shape differs and it files as new. Two
copies of one duty, both `ACTIVE`, no error raised. Only lane 3 finds it, and only if
someone reads the queue. **This has no clean fix** — it is the standing cost of a
pipeline with AI upstream of a hash.

**4 · Vague repeals.** *"All previous instructions on this subject stand withdrawn"*
cites nothing resolvable. Review queue, and realistically a human has to read the
circular.

---

### What it costs to build

Schema first — and two of these are already blocking earlier steps:

```
obligations.audienceId          ← BLOCKS Step 14's frozen decision (does not exist)
obligations.hashInputs  jsonb   ← 14d, keeps hashes recomputable
rule_assertions                 ← the event log
unresolved_citations            ← shared with Step 16
```

Then the filing service: three lanes, five verdicts, and the projection replay.
`obligation_versions` needs no changes.

---

## Step 16 — Link resolution

> **Where we are.** Step 9 pattern-scanned every *"para 9.5.3.1"* mention while building
> windows and parked the raw list. Step 15 filed the rules, so rules finally have ids.
> Step 16 turns those parked strings into edges — **because a link joins two rules, and
> rules did not exist until filing.**

**What arrives**

Detected reference strings per clause, the filed obligations, the clause tree, and the
unresolved cross-document citations Step 15 parked.

---

### First: most citations are already consumed

Walking back through the pipeline, four of the five citation kinds are handled before
Step 16 ever sees them:

| the citation reads like | handled at | leaves an edge? |
|---|---|---|
| *"shall have the meaning assigned in para X"* | **Step 9** — inlined into the window | no |
| *"nothing in para X shall apply to…"* | **Step 12** — becomes a modifier, folded into applicability | no |
| *"this partially modifies para 9.5"* | **Step 15** — lane 2, drives the filing verdict | `amends` |
| *"para 9.5 stands withdrawn"* | **Step 15** — the repeal verdict | `supersedes` |
| *"where unable to comply with para X…"* | **nobody yet** | `depends_on` |

So Step 16 is **not "resolve all citations."** It is four narrower jobs:

```
1  depends_on edges   ← conditional triggers, the only unconsumed citation kind
2  shared_evidence    ← not citation-derived at all; computed from overlap
3  the retry sweep    ← citations Step 15 parked, waiting for their document
4  split_of           ← structural, one clause yielding several rules
```

`shared_evidence` is worth naming because it comes from nowhere in the text: two
obligations satisfied by the same uploaded document, computed from attribute overlap. It
is what makes *"upload once, satisfy nine rules"* possible.

---

### 16a — A citation names a CLAUSE; an edge joins RULES

```
clause 9.5.3.2 cites "para 9.5.3.1"
        ↓
but 9.5.3.1 produced THREE rules — a clause routinely yields several
        ↓
which one does the exception-report duty depend on?
```

Two hops: **citation → clause**, then **clause → rules**. The second hop is genuinely
ambiguous, and the right answer depends on what kind of edge it is:

```
depends_on           FAN OUT to every rule from the cited clause
                     "unable to comply with 9.5.3.1" plausibly means any
                     of its duties failing. Over-linking is recoverable —
                     evaluation walks the edge and finds nothing wrong.

amends / supersedes  MUST BE PRECISE
                     amending three rules when SEBI meant one corrupts
                     the graph. Ambiguous → review, never auto-file.
```

The same asymmetry that decided Steps 14 and 15: fan out where being wrong is loud, stop
where being wrong is silent.

---

### 16b — The retry sweep, and why event replay pays off twice

A 2024 circular cites a 2019 circular that has not been ingested. Step 15 parks it. When
the 2019 document finally lands, a sweep asks **"who was waiting for me?"**

But resolving a parked citation can **change a past filing verdict**. A rule filed as NEW
in 2024 turns out to have been an amendment of a 2019 rule all along.

```
Without an event log:  history has to be rewritten in place.
With one (Step 15a):   append a correction event, replay. Done.
```

This is the second thing event replay bought, and it was not the reason it was chosen —
which is usually the sign that a structural decision was the right one.

---

### ⚠️ 16c — Schema gap: an edge cannot be explained

```
edges:  fromId · toId · type · createdAt
```

No provenance. There is no record of which clause's citation produced the edge, no
confidence, no state. **An auditor cannot be shown why the graph believes rule A depends
on rule B.**

Every edge here is *derived*, so it needs at minimum the citing clause and span — which
also makes edges recomputable rather than precious, consistent with the fingerprints and
the graph itself.

---

**What leaves**

A linked graph: `depends_on` chains that evaluation will walk, `shared_evidence` groups
that collapse the intake form, resolved cross-document `amends` / `supersedes`, and a
shrinking queue of citations still waiting for their documents.

---

### Where it breaks

**1 · Cycles.** `A depends_on B depends_on C depends_on A`. Step 24 walks these links
during evaluation, so a cycle is an **infinite loop in the product's hot path**.

*Resolution:* **detection at insert time, never at evaluation time.** By evaluation it is
a production hang, and the firm whose status triggered it is the one who sees it.

**2 · Bare numbers.** Decision 66 already established that `clause_no` is not a key —
*"1"* appears 153× in CSCRF. A citation to *"para 1"* is unresolvable in isolation.
*Resolution:* try the citing clause's own subtree first (nearest ancestor wins), then
document-wide, then review.

**3 · Citations outside the corpus.** *"Regulation 9(2) of SEBI (Stock Brokers)
Regulations, 1992"* points at a document class we may never ingest. Store as an external
reference — no edge, still displayed as provenance.

**4 · Citations to annexures and forms.** *"as per Annexure A"* targets a template, not a
rule. A different target type; not an edge.

---

## Step 17 — Consistency checks

> **Where we are.** Steps 1–16 have produced a filed, linked graph: obligations with
> audiences, canonical expressions, fingerprints and edges. Step 17 asks the question
> nothing before it could — **does the graph agree with itself?**
>
> This is available to us only because Steps 10, 13 and 15 produced machine-readable
> audiences, a canonical data-point registry, and one graph holding both.

**What arrives**

The whole projected graph. Not one document — **Step 17 is not a per-document check.**

---

### ⚠️ 17a — It runs on the projection, not on the ingest

Every finding here is a statement about a **pair** of rules, and pairs cannot be
evaluated while the graph is still being built. So Step 17 runs at the end of a
projection replay:

```
event log  →  replay in effective-date order  →  projected graph  →  CONSISTENCY PASS
```

Which means it re-runs automatically whenever a retroactive circular forces a replay —
the graph is never checked once and then trusted forever.

---

### 17b — The four families of finding

```
1  CONTRADICTION   two ACTIVE rules no single firm can satisfy
2  DEAD RULE       a rule no firm can ever match
3  REDUNDANCY      two rules saying the same thing
4  INTEGRITY       broken provenance, dangling edges, orphaned registry entries
```

**Contradiction** is the headline:

```
Rule A   audience = QSB              cyber_audit_interval <= 180
Rule B   audience = stock brokers    cyber_audit_interval >= 365

QSB ⊂ stock broker      →  the audiences OVERLAP
same attribute #4471    →  the ranges cannot both hold
                        →  no QSB can comply with both
```

Two machines do this, and both already exist:

- **audience overlap** is a lattice-implication check — Step 10's machinery
- **expression conflict** is interval arithmetic on a single attribute id

**Dead rules:** an unsatisfiable audience test (`is_qsb = true AND is_qsb = false`), an
audience naming a category that does not exist, a rule depending on an attribute no firm
can supply, or a `SUPERSEDED` rule with no successor.

**Redundancy:** two `ACTIVE` rules sharing an `identity_hash` — **this is exactly the
silent duplicate Step 15 could not catch**, arriving here to be caught. Also subsumption:
a rule whose audience is strictly narrower than another rule with an identical expression
adds nothing.

**Integrity:** obligations with no source span (the audit pack breaks), edges pointing at
superseded rules, cycles that Step 16 should have refused, and registry attributes
referenced by zero rules — harmless in themselves, but a signal that Step 13
over-created.

---

### ⚠️ 17c — Restricted to single-attribute interval conflicts

General satisfiability checking is an SMT problem: powerful, slow, and capable of
producing findings nobody can act on. It is also unnecessary, because **real regulatory
contradictions are almost always two different numbers for the same duty** — two
deadlines, two thresholds, two frequencies.

```
IN SCOPE      same attribute id, comparison operators with disjoint ranges
OUT OF SCOPE  multi-variable satisfiability, arithmetic across attributes
```

The same discipline as everywhere else in this pipeline: a cheap deterministic check that
covers the real cases, escalating only what it flags.

**Cost control.** Pairwise comparison is O(n²) — at ~50,000 obligations that is 2.5
billion pairs. But **two rules can only contradict if they share an attribute**, so
bucket by attribute id first. Most attributes appear in a handful of rules, which
collapses the work to near-linear.

---

### ⚠️ 17d — A contradiction is usually OUR bug, not SEBI's

This is the reframing that decides how the step is used.

```
Most contradictions will trace back to:
   a mis-resolved audience                  (Step 10)
   two facts wrongly merged                 (Step 13)
   a modifier applied to the wrong target   (Step 12)
   an unnormalised unit                     (Step 11)

Not to SEBI issuing conflicting requirements.
```

So Step 17 is not only a product feature — it is **the pipeline's regression test.** It
is the only check in the entire system that can detect a Step 10 or Step 13 error *after
the fact*, because it compares rules against **each other** rather than against the
document they came from.

That makes it worth building **early rather than last**. Run it on a two-document corpus
and it audits every step before it.

---

**What leaves**

A findings list — never an auto-fix. Each finding carries its severity, the rules
involved, and the pipeline step that most likely caused it. It feeds the review queue.

---

### Where it breaks

**1 · One bad audience floods the queue.** If Step 10 wrongly merged two audiences,
*every* rule pair beneath them looks contradictory — hundreds of findings, one cause.
*Resolution:* cluster findings by probable root cause and show the cause once, with the
pairs collapsed beneath it. **A findings list that cannot be triaged will not be read.**

**2 · Unit mismatches look like contradictions.** `<= 180 days` versus `<= 6 months` is
the same rule twice. Step 11 normalises time to days, so this should not survive — but
any unnormalised unit produces a phantom contradiction, and the check cannot tell the
difference.

**3 · Conditional rules.** Two rules that look contradictory but are gated by
preconditions that never co-occur. Without evaluating the preconditions there is no way
to know. *Resolution:* rules with unmodelled preconditions are checked at lower
confidence and reported separately.

**4 · Sometimes the regulation really does contradict itself.** A later circular can
conflict with an earlier one without formally amending it. The system cannot resolve that
— it can only surface it. **Which is arguably the single most valuable thing it
produces**, and the one output no existing compliance tool can generate at all.

---

## Step 12 — the three edge cases, resolved

### Problem 1 — "The preceding paragraph"

**The example**

```
9.5.3     Audit requirements
   9.5.3.1   A cyber security audit shall be carried out every 180 days.
   9.5.3.2   The audit shall be conducted by a CERT-In empanelled auditor.

9.5.4     The preceding paragraph shall not apply to brokers with
          fewer than 500 clients.
```

**What goes wrong** — "the preceding paragraph" is ambiguous about *level*:

```
Reading 1 — previous clause in reading order    →  9.5.3.2 (the auditor requirement)
Reading 2 — previous clause at the same level   →  9.5.3   (the whole audit section)
```

Reading 1 exempts small brokers from *needing a CERT-In auditor*. Reading 2 exempts
them from *auditing at all*. Nothing in the text resolves it; a positional walk just
picks whichever rule it was coded with.

**The solution — don't let the reference stay positional.** Make it explicit at
extraction time by telling the AI what the neighbours are called. Two lines added to
the window:

```
[NEIGHBOURS]
  previous clause in reading order:  9.5.3.2
  previous clause at this level:     9.5.3
```

The AI — the only component actually reading the language — returns `targets: "9.5.3"`
instead of leaving us a phrase to guess at. Two lines per window, and the judgement
moves to where the judgement belongs.

**Fallback:** if the AI can't tell, show a human both candidates with their
plain-English applicability. Positional references are rare enough that a handful per
corpus costs nothing.

---

### Problem 2 — A condition the vocabulary can't express

**The example**

```
9.5.6   The provisions of 9.5.1 shall apply only to brokers using
        the T+0 settlement cycle.
```

The modifier needs `uses_t0_settlement = true`, which doesn't exist in the vocabulary.

**What goes wrong** — the condition can't be written as a test, so the modifier is
silently dropped or degrades into an unevaluable prose note. Either way **9.5.1 stays
applicable to everyone**, including brokers not on T+0.

**The solution — it's an audience test, so use the audience path.** Route the
condition through the same property-proposal path as a section heading (Step 10, rung
7): propose the property, queue it for admin approval.

**What happens to the rule while it waits** — three options, two of them traps:

```
❌  File it WITHOUT the restriction
      → applies to every broker, including those it shouldn't
      → and when the property is later approved and the restriction applied,
        the fingerprint CHANGES → phantom amendment

❌  Drop the rule entirely
      → firms silently miss an obligation they owe

✅  File it in REVIEW state, not ACTIVE
      → the rule exists and is visible in the queue
      → it isn't live on anyone's dashboard yet
      → when the property is approved, the restriction is applied and the
        rule is fingerprinted ONCE, correctly
```

Same treatment as a pending audience in Step 10: parsing and drafting proceed, only
**filing** waits. Nothing is silently wrong in either direction.

---

### Problem 3 — A modifier that modifies a modifier

**The example**

```
12.3   Every stock broker shall submit daily transaction reports.
12.7   Nothing in 12.3 shall apply to brokers with fewer than 500 active clients.
12.9   The exemption in 12.7 shall not apply to brokers holding client funds.
```

```
start           every broker
12.7 removes    brokers with <500 clients
12.9 adds back  ...unless they hold client funds

FINAL: every broker EXCEPT small brokers who don't hold client funds
```

**What goes wrong** — our index maps `modifier → the rule it targets`. But 12.9
doesn't target a *rule*; it targets **12.7's exemption**, a piece of a rule's
applicability. There's nowhere to put it, so 12.9 is dropped and every small broker
gets exempted — including the ones holding client funds.

**The solution — two changes.**

**1. Applicability becomes an expression, not a flat list.** A list of ANDed
conditions cannot express "except, unless":

```
    all brokers
      AND NOT ( clients < 500
                AND NOT holds_client_funds )
```

**2. Each applied modification remembers where it came from.**

```
rule 12.3's applicability
   base term                  → all brokers
   term added by clause 12.7  → NOT (clients < 500)      ← tagged with its source
```

Now 12.9 targeting "12.7" resolves to **that term**, not to the rule, and modifies it
in place. Chains work because every modification leaves a labelled handle for the next
one to grab.

**But compute it *and* flag it.** *"The exemption shall not apply to X"* is a double
negative, and humans misread these too. Does it restore X to the original obligation,
or something narrower? Usually restoration — but the wording doesn't guarantee it.

```
⚠️  CHAINED MODIFICATION — please confirm

  12.3   Daily transaction reports
         → every stock broker

  12.7   ...except brokers with fewer than 500 active clients
         → every stock broker EXCEPT those with fewer than
           500 active clients

  12.9   ...but that exemption doesn't apply to brokers
         holding client funds
         → every stock broker EXCEPT those with fewer than
           500 active clients who do NOT hold client funds

  Read as written: small brokers are exempt, unless they hold
  client funds — in which case they must still report daily.

  [ Correct ]    [ Something's wrong ]
```

Nobody can reliably reason about a triple negative in prose, but everyone can read the
final line and say whether it matches what the circular meant.

**Depth limit:** resolve two levels, flag the third. A modifier-of-a-modifier-of-a-
modifier is vanishingly rare and almost certainly a drafting error deserving a human
anyway.

---

### The pattern across all three

| | Deterministic part | AI part | Human part |
|---|---|---|---|
| **1 — positional refs** | list the candidate neighbours | pick the right one, reading the sentence | confirm when the AI can't tell |
| **2 — unknown property** | detect it's missing | propose the property | approve it |
| **3 — chained modifiers** | compute the set algebra + render it in plain English | — | confirm the reading is right |

In all three the human is shown **the resulting rule in plain English**, never the
logic and never a fabricated number. The system does the reasoning and asks a question
answerable from experience in two seconds.

---

### Built vs designed

| | Status |
|---|---|
| Everything in Step 12 | **designed** — none of the assembly phase is built |
| (Today the pipeline stores obligations directly from extraction, with no modifier concept and no assembly pass) | |

---

## Step 10 — the three edge cases, resolved

> These were flagged as open when Step 10 was first written. All three now have a
> designed solution. None is built.

### The reframe that makes the first one tractable

> **Where a section sits in the document is not the same as where it sits in the
> audience lattice.**

They coincide almost always, which is why composition works at all. The cases below
are exactly where they diverge.

```
DOCUMENT STRUCTURE              AUDIENCE LATTICE

  9. QSB obligations                [All stock brokers]
     9.1 Governance      ─────────▶      ▲          ▲
     9.2 Risk mgmt                       │          │
     9.9 All brokers ────────────────────┘     [QSBs]
         9.9.1 ...                                 ▲
                                                   └── 9.1, 9.2 attach here
                                          9.9 attaches one level UP
```

Inheritance follows the **resolved** audience, never the physical parent.

---

### Problem 1 — A section that steps *out* of its parent

**What goes wrong**

```
9.   Obligations of Qualified Stock Brokers        test: broker AND qsb
     9.1   Governance                              (topic → inherits)
     9.9   Provisions applicable to all brokers    ← BROADER than its parent
           9.9.1  Every stock broker shall display its SEBI
                  registration number on client communications.
```

Compose blindly (*child = parent AND delta*) and 9.9.1 is filed as QSB-only. Every
non-QSB broker — the large majority — never learns of a rule they owe. **Silent, and
the worst failure mode in this step.**

Note 9.9 usually needs no *new* audience: its test is `category=stock_broker`, which
almost certainly already exists as "All stock brokers", so rung 3 exact-matches it and
the section attaches to a node already in the lattice.

**What the AI returns — and it differs by relation**

```
relation = "narrows"      → returns ONLY the condition to add   e.g.  is_qsb = yes
relation = "independent"  → returns the COMPLETE test           e.g.  category = stock_broker
```

When narrowing we compose. When stepping out, composition is precisely what must not
happen, so the AI hands over the whole test.

**The verification — the AI's answer is a hint, logic decides**

Reuses rung 4's implication machinery. The core rule:

> **More conditions = a smaller set.** A is inside B when, for every condition in B,
> A has a condition on that property that is at least as tight.

```
PARENT   category=stock_broker AND is_qsb=true
CHILD    category=stock_broker

Is CHILD inside PARENT?
  parent requires is_qsb=true; child says nothing about it
  → a non-QSB broker satisfies CHILD but not PARENT      → NO

Is PARENT inside CHILD?
  child requires category=stock_broker; parent requires it too
  → every firm matching PARENT also matches CHILD        → YES

VERDICT: the child is BROADER than its parent.
```

Numbers use range containment (`>= 50001` sits inside `>= 10001`). Two tests are
**disjoint** when they contradict on any one property (`is_qsb=true` vs
`is_qsb=false`; `category=broker` vs `category=adviser`). Anything else is partial
overlap.

**The decision table** — seven cases, three need a human:

| AI says | Logic finds | Meaning | Action |
|---|---|---|---|
| narrows | child inside parent | consistent | **compose, accept** |
| narrows | child broader | AI contradicted itself | ⚠️ **flag** |
| narrows | disjoint | claimed narrowing, no overlap | ⚠️ **flag** |
| narrows | overlapping | composition would be arbitrary | ⚠️ **flag** |
| independent | child inside parent | AI over-called it; it *is* narrowing | **override silently, compose** |
| independent | **child broader** | genuine step-out — the dangerous direction | ⚠️ **flag** |
| independent | disjoint | genuine step-out to a different group | **accept silently** |

The asymmetry is deliberate. When the AI over-calls "independent" and logic proves
the child is narrower, **we override without asking** — logic is more trustworthy
here and the correction is provably safe. When logic confirms *broader*, we stop,
because that is where being wrong strips an obligation from most of the population.

**Worked examples**

```
1 — GENUINE STEP-OUT → flagged
    parent  9.   Obligations of QSBs            broker AND qsb
    child   9.9  Provisions applicable to all brokers
    AI      independent · complete test = category=stock_broker
    logic   parent is inside child → CHILD IS BROADER
    action  ⚠️ flag · do not compose · clauses beneath still get drafted

2 — AI OVER-CALLED IT → silently corrected
    parent  9.   Obligations of QSBs            broker AND qsb
    child   9.4  Additional requirements for QSBs holding client funds
    AI      independent · complete test = broker AND qsb AND holds_client_funds
    logic   child has every parent condition plus one → child is inside parent
    action  override the AI · compose normally · no human

3 — DISJOINT → accepted silently
    parent  12.  Obligations of Non-QSB brokers  broker AND is_qsb=false
    child   12.8 Transitional provisions for QSBs
    AI      independent · complete test = broker AND is_qsb=true
    logic   is_qsb true vs false → contradiction → DISJOINT
    action  accept · attach to the QSB audience · no flag
            (a section cannot "lose" firms by attaching to a group its
             parent never contained)
```

**What the reviewer sees**

```
⚠️  SECTION APPEARS BROADER THAN ITS CHAPTER

  Document   master-circular-stock-brokers-2024, page 163
  Section    9.9  Provisions applicable to all stock brokers
  Sits under 9.   Obligations of Qualified Stock Brokers

  The chapter addresses    stock brokers who are QSBs
  This section addresses   every stock broker

  Opening line:
    "Notwithstanding anything contained in this chapter, every
     stock broker shall display its SEBI registration number..."

  17 clauses are waiting on this decision.

  [ Yes — applies to all brokers ]    [ No — QSBs only ]
```

The **plain-English applicability** is the useful part. *"every stock broker"* versus
*"stock brokers who are QSBs"* is answerable in two seconds; *"narrows or
independent"* is jargon.

That rendering is produced **deterministically from the predicate** — a template walk
over the condition tree, no AI and no firm data required:

```
category = stock_broker           →  "every stock broker"
AND is_qsb = true                 →  "...who is a QSB"
AND NOT (active_clients < 500)    →  "...except those with fewer than
                                       500 active clients"
```

> ⚠️ **Never show a reviewer a number that came from a language model.** An earlier
> draft of this card said *"4,190 firms instead of 187"*. Those figures don't exist
> during ingestion — there may be no registered firms at all — and a model asked to
> supply them would produce something confident, plausible and entirely fabricated,
> sitting in a compliance screen looking authoritative.
>
> Counts are an **enrichment**, added only when the platform genuinely holds tenant
> profiles, and labelled for what they are: *"among the 47 firms registered on this
> platform: 31 affected — not the full market."*

**Why it's cheap:** no new machinery (the implication check is rung 4, already
needed), no extra AI call (`relation` rides along in the classification), rare
(one to three per master circular, only the broader subset flagged), and
non-blocking (clauses beneath keep getting drafted — only filing pauses).

---

### Problem 2 — Nobody has told the system what a property implies

**What goes wrong**

```
CIRCULAR A                          CIRCULAR B
  9. Obligations of QSBs              Part II — Stock Brokers
     (top level, no parent)              4. Obligations of QSBs
  → is_qsb=true                       → category=stock_broker AND is_qsb=true
```

Same firms, two strings → rung 3 misses → rung 4 concludes *"B has more conditions,
so it's narrower — nest it under A"* → **two audience nodes where there should be
one**, rules split across both.

**The solution: the AI pre-fills, the human confirms**

The admin is **already** clicking approve on the property. Make it a confirmation,
not a form:

```
NEW PROPERTY PROPOSED

  name        is_clearing_member
  meaning     whether the firm is a member of a clearing corporation

  Only applies to:                          ← AI pre-ticked, admin corrects
     ☑ stock_broker
     ☐ investment_adviser
     ☐ merchant_banker

  [ Approve ]   [ No restrictions ]
```

*"Only stock brokers can be clearing members"* is exactly the kind of general domain
knowledge a model has reliably. The human checks a box that is already right most of
the time.

**Default to none.** If skipped, no expansion happens — producing the occasional
duplicate nesting rather than a *wrong merge*. That asymmetry is the point:
under-expanding is recoverable; over-expanding fuses two genuinely different
audiences, which is not.

**Later refinement — suggest, never infer.** Once a property has been used in 20+
audiences and has co-occurred with `category=stock_broker` every single time, surface
*"add this implication?"* in the review queue. Correlation is not implication, so it
stays a prompt.

---

### Problem 3 — The audience is in a sentence, not a heading

**What goes wrong**

```
"Where the broker holds client funds, reconciliation shall be
 carried out on a daily basis."

"Brokers with more than 50,000 active clients shall appoint a
 dedicated compliance officer."
```

Each names a group of firms. Neither is a heading, so the audience layer never sees
it.

**How bad, honestly: less than it sounds.** The drafter still notices the condition
and emits it as a **precondition on the rule**, so evaluation is correct — a broker
who doesn't hold client funds gets *not applicable*, not a false red.

What's lost is **modelling quality**: the rule isn't grouped with its audience, SEBI
can't ask *"show me everything applying to firms holding client funds"* and get it,
and it sits on every broker's list carrying a condition instead of living on the
right branch. It degrades gracefully, which is why it ranks third of the three.

**The solution: run preconditions through the same ladder**

A precondition is *already in exactly the same form as an audience test*. So the
ladder eats it directly — no new machinery:

```
"Where the broker holds client funds..."
   → drafter emits precondition:  holds_client_funds = true
   → run it through the SAME ladder a heading would take
      → rung 3 exact match → that audience already exists
      → attach the rule to that audience
      → drop the precondition (now redundant)
```

> ⚠️ **Critical constraint: this must happen during ingestion, before fingerprinting.**
> Moving a rule from *"all brokers + condition"* to *"audience = firms holding client
> funds"* changes its fingerprint. A retroactive move would look like the old rule
> died and a new one appeared.

**The background sweep.** Periodically:

> *"41 rules share the precondition `holds_client_funds = true`. Promote to an
> audience?"*

One click, cleaner graph. Being retroactive, it needs a migration that **preserves
each rule's identity** across the move — otherwise it manufactures 41 phantom
amendments.

---

### Suggested order

**Problem 1 first** — the only one that silently *loses* obligations, and the fix
reuses rung 4 plus a review flag.

**Problem 2 second** — small, and a prerequisite for the property-approval screen
needed anyway.

**Problem 3 last** — it degrades gracefully today, and the fix is a small addition to
the resolution step once that step exists.

---

## Decisions made while walking these steps

| # | Decision | Reason |
|---|---|---|
| 1 | Skip a document on **job completed**, not on file present | Otherwise a crash mid-load silently loses the half-processed document |
| 2 | **Hybrid lanes** — our parser for prose, a converter for tables | Tables carry dense rule content and currently get lost; but a full Markdown conversion breaks source positions and replaces a tuned parser with a generic one |
| 3 | Tables must be **located before** prose extraction | Otherwise table cells leak into the prose stream and can't be cleanly removed |
| 4 | Table detection output belongs in **Layer B** (cached) | It's expensive; a re-run should read it, not recompute it |
| 5 | Convert dates to real date values at **Step 1** | Effective date drives replay ordering; text dates can't be sorted correctly |
| 6 | Numbering gaps: only jumps of **1–3**, **main body only** | Bigger jumps are numbering restarts, not losses; annexure numbering is chaotic and floods the audit with false positives (23 in one run) |
| 7 | Repairing a gap **rebuilds the tree and re-audits** | An un-glued clause may have its own swallowed children; one pass isn't enough |
| 8 | **Blocklist, not allowlist**, for what reaches the AI | Costs are asymmetric — over-sending is a visible bill, under-sending is an obligation that vanishes with no symptom. Also: the AI is already a better filter than a regex |
| 9 | **Junk = "don't send", never "discard"** | Junk containers carry the heading trail and the audience for every clause beneath them |
| 9a | Every window includes the **immediate parent's body text** (the lead-in) | SEBI writes numbered lists whose items are sentence fragments — *"1.4 the end of day margin obligations of the broker"* has no verb and no duty without its parent's stem |
| 9b | The cache key hashes **the whole assembled window**, not the clause body | The same sentence under "Obligations of QSBs" and "Obligations of non-QSBs" means different things; hashing the body alone would produce a cache hit that attaches a rule to the wrong audience |
| 9c | Inlined references are marked **"for context only"** | Otherwise a duplicate rule gets extracted from the referenced text by every clause that cites it |
| 9d | **Sibling clauses are excluded** from windows | Bloating every window in the corpus to fix a handful of "or"-linked list items isn't worth it; if it bites, detect leading conjunctions and pull siblings only then |
| 10 | When a clause references another, inline the referenced **TEXT — never the extracted rules** | (a) Errors compound invisibly — two wrong rules that agree with each other survive review. (b) Cache stability — depending on text keeps the cache key flat; depending on extractions means improving a prompt silently invalidates a cascade. (c) It preserves the rule that everything traces to what SEBI actually wrote, not to our earlier interpretation. (d) It removes the scheduling problem entirely — text is available immediately, so no clause ever waits for another |
| 11 | Inline size guard: full text under ~2,000 chars, otherwise the clause's own text plus **only its children's headings** | Structure without bulk is usually all the drafter needs |
| 12 | Whole-chapter references (*"Chapter 9 shall apply mutatis mutandis"*) are a **structural operation, not an extraction** | There is no rule to draft. It means "copy 200 rules to another audience" — and *mutatis mutandis* ("with the necessary changes") is a legal judgement requiring a human |
| 13 | Reference **detection** before drafting; reference **resolution + classification** after | Detection is a pattern scan needed at window-building time; a link joins two *rules*, which don't exist until drafting is done |
| 14 | **Extraction runs fully parallel; graph building runs strictly sequential** | Drafting is stateless — each call is independent, so document order has zero effect on its output. Order matters only for data-point resolution and rule filing, both of which are deterministic, AI-free and take seconds. The two concerns live in different layers and never conflict |
| 15 | **Step 10 branches off the clause tree** — it is not the next link after Step 9 | It reads only headings, and drafting doesn't need its output (a window carries the audience as wording in the heading trail). The two streams rejoin at filing |
| 16 | Audiences are matched by **test, not by name or meaning** | An audience is a *set of firms*, and sets compare exactly. Similarity scoring here would discard certainty available for free — unlike data-points, whose meaning is genuinely fuzzy |
| 17 | The AI reports **only the condition the heading adds**; we compose the parent's conditions in code | The model has one small judgement to make; inheritance arithmetic happens where it can't drift. A `relation` field handles a section that steps *out* of its parent rather than narrowing it |
| 18 | The property vocabulary is sent as **core (~25, cached) + retrieved tail (~10)**, never in full | Cost is the smaller reason — a stable prefix is prompt-cached. **Accuracy is the real one**: a model choosing from 300 options does measurably worse than one choosing from 35 |
| 19 | Vocabulary slice built by **tag filter → meaning search → parent's properties → core**, with no AI in the selection | All four are lookups or a single vector query — milliseconds. The AI only sees the result |
| 20 | A firm property earns its place **only when a rule's audience depends on it** | Keeps the vocabulary in the tens while the data-point register grows into the thousands. A vocabulary heading for the hundreds signals data-points leaking in |
| 21 | Normalisation sorts terms **alphabetically** | `A AND B` ≡ `B AND A`, so order carries zero information — which means any consistent order works, and alphabetical needs no thought. Turns a semantic comparison into a string comparison |
| 22 | Implied conditions (`is_qsb=true` → `category=stock_broker`) are **declared by a human at property-approval time**, never inferred | It's a fact about the world, absent from every circular. Without it, the same audience reached with and without a parent chapter normalises to two different strings and gets wrongly nested |
| 23 | The prompt contains **no list of existing audiences** | Showing the register and asking "is this one of these?" would hand the decision back to the model. It translates; the ladder decides |
| 24 | **Both** a new audience and a new firm property require approval | A wrong audience creates the duplicate-branch failure, which nothing downstream can detect; a new property changes what every future heading can be translated into. Neither blocks drafting — only filing waits |
| 25 | Cold start **batches audience approvals** | Deciding as you go means an approval prompt per document. Collecting all candidates first lets rungs 3–4 collapse thousands of headings into ~40 audiences, approved in one sitting |
| 26 | **A section's place in the document ≠ its place in the audience lattice**; inheritance follows the *resolved* audience, never the physical parent | They coincide almost always. Step-outs are exactly where they diverge, and treating physical nesting as authoritative is what causes the silent loss |
| 27 | The AI's `relation` is a **hint; logic decides** — and when logic proves the child is narrower, we **override the AI silently** | Logic is more trustworthy than the model here and the correction is provably safe. Only the *broader* verdict stops for a human, because that's where being wrong strips an obligation from most of the population |
| 28 | `relation=independent` returns the **complete test**, not a delta | Composition is precisely what must not happen for a step-out, so there is nothing to compose with |
| 29 | Review cards state **firm counts**, not relationship jargon | *"187 firms or 4,190 firms"* is answerable in two seconds; *"narrows or independent"* is not |
| 30 | Implied conditions are **AI-proposed, human-confirmed**, defaulting to none | The admin is already clicking approve — make it a pre-ticked confirmation, not a form. Defaulting to none means under-expansion (recoverable duplicate nesting) rather than over-expansion (an unrecoverable wrong merge) |
| 31 | Co-occurrence **suggests** implications, never infers them | Correlation is not implication; it surfaces as a review-queue prompt after 20+ consistent uses |
| 32 | Prose-stated audiences are handled by **running rule preconditions through the same audience ladder** | A precondition is already in the exact form of an audience test, so the ladder eats it directly — no new machinery |
| 33 | Precondition promotion must happen **before fingerprinting** | Moving a rule from "all brokers + condition" to a proper audience changes its fingerprint; retroactively it would look like the rule died and a new one appeared. The retroactive sweep needs an identity-preserving migration |
| 34 | The extraction cache stores **what one clause says in isolation**, never a finished rule | A clause always means what it means; what varies between circulars is the *surrounding* clauses. Cross-clause effects are applied in the free deterministic layer, so the same cached translation correctly yields different final rules |
| 35 | A **`modifier`** output type — a clause that changes another clause creates no obligation of its own | Without it the drafter invents a meaningless attestable rule for *"9.5.1 applies only when…"* — an obligation nobody owes, cluttering the register forever |
| 36 | Modifiers return the target as **plain text**; resolution to a clause id happens in assembly | Keeps Step 11 a pure translation layer that never looks anything up — which is what keeps it stateless, parallel and cacheable |
| 37 | **Closed unit vocabulary + ISO dates** — the AI picks units from a fixed list | Constraint and formatting, both lossless |
| 38 | **Never convert units at extraction** — store what the circular said | "Half-yearly" → 183 days silently picks one of several readings (6 calendar months from 31 Jan is 31 July; 183 days is 2 August) and destroys the evidence a choice was made. It also loses provenance, hands arithmetic to the least deterministic component, and cements the cache. Three representations instead: **stored** (source wording) · **compared** (canonical, derived, disposable) · **displayed** (source wording) |
| 39 | **Number fidelity is a tripwire, not a judge** — a failure is a referral, not a rejection | Raw matching has real false positives (word numbers, period phrases, unit conversions). Normalise first, then refer what survives |
| 40 | Reference-numbers (*"Annexure 4"*, *"Form 22"*) are **stripped from the text's number pool** | Makes a rule that lifted a pointer as a threshold *fail* the fidelity check — turning an invisible failure class into a visible one |
| 41 | The verifier is given **the specific complaint**, not the rule to re-check | "Is this rule right?" gets a yes from the model that just wrote it. "The rule uses 90; the clause contains 180 and 15 — explain" is checkable |
| 42 | A verifier's **correction must pass the check that failed** | The AI can only move a value toward something demonstrably present in the source text; it cannot invent its way out of the flag |
| 43 | The verifier **may only change the flagged literal** | Otherwise the second call quietly becomes a second drafter, with none of the first one's constraints |
| 44 | **The AI is never the first responder, and never the last word** | Now the third instance of the same shape: cheap deterministic check → tripwire → targeted adjudication with a specific complaint → verify the answer with the same check. Also used by the attribute funnel and the numbering audit |
| 45 | A single clause may emit **several outputs at once** (e.g. a modifier *and* a rule) | *"The provisions of 9.5 shall apply to QSBs with >5,000 clients, who shall additionally maintain a register"* is genuinely both |
| 46 | **Pull in the preceding sibling only on high-precision signals** — no subject at all, or `such`/`the said`/`the aforesaid`/`the above`, or a real pronoun subject (never dummy *"it"*). Capped at two. **The broad `the` + noun trigger is deliberately NOT used.** | Supersedes 9d, and revises two earlier versions of this decision that were **both wrong** — measured on the real corpus before building either. A broad trigger fires mostly on list fragments (already covered by the lead-in) and entity nouns; always-sending costs +23% tokens on every window to fix ~2% of clauses. Genuine sibling dependencies measured at 1–3%, so the narrow trigger costs ~1% and needs no exclusion list. Everything else falls to the `inferred` field |
| 46a | **Measure before building a heuristic over the corpus** | Two designs were argued for and discarded by a twenty-minute counting script over already-parsed clauses. The examples were more informative than the counts: they revealed the detector firing on list fragments, expletive *"it"*, and entity nouns — none of which any amount of tuning would have surfaced without looking |
| 47 | The damage from a split duty is **amendment matching**, not evaluation | Both halves must pass either way, so a firm's status is correct. But a later circular restating the duty in one clause produces one rule that matches neither of the two — reported as "one appeared, two vanished" instead of "the deadline changed" |
| 48 | The AI must **declare its inferences** in an `inferred` field; non-empty → REVIEW | When a circular never states who receives a report, the output is well-formed, correctly typed, and every number checks out — type checking and number fidelity both pass. Nothing deterministic can catch it. Models know when they filled a gap *if given somewhere to say so*; without the field, an inference and a fact look identical |
| 49 | Case 4 (information absent from the document entirely) is **accepted as manual review**, not solved | No retrieval recovers what was never written. Answering it needs domain knowledge outside the corpus, so a human is the correct destination — the design's job is only to make the guess visible rather than silent |
| 50 | ⚠️ **No number shown to a reviewer may originate from a language model** | Asked "how many brokers have fewer than 500 clients?", a model produces something confident, plausible and fabricated — sitting in a compliance screen looking authoritative. Counts are computed from data we hold, or they are not shown |
| 51 | Review cards render applicability in **plain English, deterministically from the predicate**; firm counts are an optional enrichment | A template walk over the condition tree needs no AI and no firm data — so it works during corpus ingestion when zero firms are registered. Counts appear only when tenant profiles exist, labelled *"among the N firms registered on this platform — not the full market"* |
| 52 | Positional references (*"the preceding paragraph"*) are resolved **at extraction**, by listing the candidate neighbours in the window | They're ambiguous about *level* — previous-in-reading-order vs previous-at-this-level can mean exempting one requirement or an entire section. Two lines per window move the judgement to the only component actually reading the sentence |
| 53 | A modifier condition needing an unknown property routes through the **same property-proposal path as an audience heading**; the rule waits in **REVIEW**, not ACTIVE | Filing it unrestricted over-includes firms *and* changes the fingerprint when the restriction later lands (phantom amendment). Dropping it silently loses an obligation. REVIEW is the only option that is wrong in neither direction |
| 54 | Applicability is an **expression tree**, not a flat condition list, and every applied modification is **tagged with its source clause** | A flat AND-list cannot express "except, unless". Tagging gives a chained modifier a labelled handle to grab — which is what makes modifier-of-a-modifier resolvable at all |
| 55 | Chained modifiers are **computed but always flagged**; two levels deep, then flag | *"The exemption shall not apply to X"* is a double negative that humans misread too. Compute the set algebra, render the result as a sentence, and let a person confirm the reading |
| 56 | ⚠️ **The audience must NEVER enter the data-point composite** | A shared fact must stay shared. A QSB and a small broker are asked the *same question* ("when was your last cyber audit?") and differ only in the pass mark. Add the audience and every shared fact splits down audience lines — so a firm re-designated as a QSB loses its own data. **Audience separates rules at the fingerprint, not facts at the register.** Recorded explicitly because it is enforced by an *absence*, and absences don't survive future contributors |
| 57 | **Definitions resolve before rules**, regardless of document order | Otherwise a rule using `net_worth` creates it as an ordinary attribute first — and the intake form asks the broker for a figure that should have been computed from its parts |
| 58 | **Type/unit gate before any scoring** — a date can never merge with a count | The most common false merge in any data catalogue, free to prevent, and near-impossible to unpick: once two facts share an id, every rule using either is wrong |
| 59 | Resolution is **sequential by design** | A data-point created by clause 1.1 must be visible to clause 1.4. Run it in parallel and both look into an empty register and both create it |
| 60 | **Bulk load clusters; steady state funnels** | Greedy resolution lets whichever circular is processed first name everything forever — `aud_dt` from 2019 beating `last_audit_date` used 400 times. Bulk load collects all mentions first and picks canonical names by frequency × recency × clarity |
| 62 | ⚠️ **The audience layer handles only Pattern A (chapter scoping).** Pattern B — a taxonomy defined as a *list*, then applied per-rule via tables — is unhandled | Measured on CSCRF: its five RE categories are `kind=clause`, `leaf=True`, **no heading**. Step 10 reads only headings, so it finds none of them in a document built entirely on them |
| 63 | **Step 10's cheap gate was deleted after measurement** — send every heading | The phrase gate scored **0 of 148** and **0 of 64** on the two large documents. It was written against an invented example heading that appears nowhere in the corpus. It saved 6% of calls while risking a silent wrong-audience failure |
| 64 | ⚠️ **The <15-character stub rule needs a list carve-out** — it is currently deleting audience definitions | `"Qualified Res"` (13), `"Mid-size REs"` (12), `"Small-size Res"` (14) are all junked. **Audience names are short by nature.** Never junk a short clause whose parent's lead-in announces a list |
| 65 | **Bilingual documents need a language pass before segmentation** | CSCRF is 7.3% Devanagari, interleaved — every clause number appears twice with different text, producing two competing trees |
| 66 | **`clause_no` is not a key**, even monolingual | 144 duplicated numbers in the master circular (*"1"* appears 76×); 81 in CSCRF (*"1"* appears 153×). Sub-lists restart numbering. Citations to bare numbers are unresolvable without context — which Step 12's modifier resolution depends on |
| 67 | **The firm-property vocabulary is tens, not hundreds** — send the filtered list whole | Retrieval was designed for ~600 properties. Filtered by intermediary type, a circular needs ~15–30. Build retrieval only if a filtered list passes ~40 |
| 68 | **Three applicability patterns, and they STACK** — C (document-level) is the floor, A (chapter scoping) and B (taxonomy) narrow it | Measured across 8 documents. Not alternatives: every document has a C, some add A or B on top |
| 69 | **Pattern C is built first** | The only pattern validated across two regulators and four departments. One AI call per document, and it gives every clause a guaranteed floor — including documents like the Cloud framework (one heading in 53 pages) where the heading-based design produces nothing at all |
| 70 | **Pattern B is deferred** — 1 of 8 documents | Only CSCRF has it. The review queue catches the case meanwhile. Revisit if a second document needs it |
| 71 | When Pattern B is built, model the tier as a **derived property** (`re_category`), not an audience predicate | Thresholds differ per intermediary type (separate table for AIFs vs brokers), so *"Mid-size RE"* is a matrix. As a Formula Register entry the audience test collapses to `re_category = mid_size`, the tier becomes **computed rather than self-declared**, and a firm's obligations change automatically when its numbers cross a threshold |
| 72 | **The document title must be preserved**, not treated as letterhead | Master circulars state their applicability *in the title* (*"Master Circular for Stock Brokers"*) — Step 8 currently junks it, which is Pattern C's primary input for that whole document class |
| 73 | ⚠️ **The numbering grammar is SEBI-specific** — a documented portability boundary, not a task | The RBI Master Direction contains **zero** inline-decimal clause numbers (SEBI's format); it uses bare numbers alone on a line, `Chapter – I`, and roman/lettered levels. 31 pages parsed to 38 clauses vs SEBI's ~6/page. Extending beyond SEBI needs a **pluggable numbering grammar per regulator**, not a tweak |
| 74 | ⚠️ **The audience must enter the identity hash** — it currently does not, and that is a live bug | Without it, the QSB 180-day rule and the non-QSB 90-day rule both mask to `#4471<=NUM` and produce **the same identity hash**. Step 15 would file the second as an amendment of the first, silently collapsing two coexisting duties into one wrong one |
| 75 | **The audience enters by id, not by shape** | By shape, `category=='stock_broker'` and `category=='mutual_fund'` both mask to `[category]==STR` — reintroducing silent cross-population merging at the category level. By-id's cost is a visible duplicate in the review queue. A false amendment overwrites a live obligation invisibly; a false new rule is loud. When wrong, be wrong loudly |
| 76 | **Fingerprint the expression TREE, not normalised text** | `180 >= x` and `x <= 180` are the same duty; as text they hash differently. The AI rephrases across circulars, so every variance manufactures a phantom new rule. Canonicalise: comparisons face one way, commutative operands sorted, structure replaces punctuation |
| 77 | `ast_parse.py` **already builds the tree and throws it away** | `AstResult` returns flat lists (`functions`, `identifiers`, `literals`). The parser is done; only the return shape needs changing |
| 78 | **Hashes store their inputs and stay recomputable** | Identity is built from registry ids, so Step 13's cold-start clustering invalidates every hash in the database when it merges attributes. Storing `audience_id · sorted attribute_ids · canonical tree` makes a registry migration a re-derivation, not a rebuild — Layer C's rule applied to fingerprints |
| 79 | **The fingerprint is one lane of three, and is never sold as a complete amendment detector** | It catches value changes only. Structural amendments (a condition *added*) change the attribute set, so identity misses. Step 15 needs citation matching and fuzzy same-audience matching alongside it. Attestable prose falls back to hashing the normalised obligation sentence — weaker by nature, because prose cannot be diffed structurally |
| 80 | **Filing appends events; the live graph is a projection replayed in effective-date order** | Amendments are order-dependent. Ingest a 2026 amendment before its 2023 original and the original files as an amendment moving the value *backwards* — silently. Sorting the corpus fixes bulk load but not the steady state, where retroactive circulars arrive after statuses were already computed. Replay also answers *"what did we believe on 12 March?"*, which is otherwise unanswerable and which an audit pack requires |
| 81 | **Amendments are staged as `PROPOSED`, never auto-applied** | Not caution — the approval step *is* the product. An amendment is the only verdict that can flip a firm from compliant to breaching. Auto-applying deletes the moment the amendment console exists to show. New rules and restatements auto-file because they flip nobody |
| 82 | **Five verdicts, not three — repeal and ambiguous are first-class** | *"Para 9.5 stands withdrawn"* produces **no incoming rule to match**, so no fingerprint can see it. Designing around new/restatement/amendment alone leaves withdrawn obligations live forever |
| 83 | **When the citation lane and the fingerprint lane disagree, the citation wins** | The hash is an inference; an explicit *"this modifies para 9.5"* is a statement of fact by the regulator. Lane 2 is also the only lane that sees structural amendments and repeals at all |
| 84 | **Identity matching more than one `ACTIVE` rule never auto-files** | Trivial expression shapes (`x == true`) are low-entropy and collide across unrelated duties. A multi-match is evidence the hash is not discriminating, not evidence of an amendment |
| 85 | ⚠️ **`obligations.audienceId` does not exist** — it blocks Step 14's frozen decision | Step 12 attaches an audience and Step 14 hashes it, but there is no column to hold it. Along with `hashInputs`, this is schema work that must land before the audience-in-hash fix, and therefore before any bulk load |
| 86 | **Step 16 is four narrow jobs, not "resolve all citations"** | Four of the five citation kinds are consumed earlier: definitional inlined at Step 9, exemptions become modifiers at Step 12, and *amends* / *supersedes* drive Step 15's filing verdict. Only conditional triggers (`depends_on`) survive to Step 16, alongside `shared_evidence`, the retry sweep and `split_of` |
| 87 | **The clause-level citation is the stored artifact; edges are derived from it** | A citation names a *clause*, but an edge joins *rules*, and one clause routinely yields several. Storing the citation keeps the second hop recomputable — the same principle as fingerprints and the graph itself |
| 88 | **Fan-out policy differs by edge type** | `depends_on` fans out to every rule from the cited clause, because over-linking is recoverable — evaluation walks it and finds nothing wrong. `amends` / `supersedes` must be precise or go to review, because amending three rules when SEBI meant one corrupts the graph |
| 89 | **Cycle detection at insert time, never at evaluation time** | Step 24 walks `depends_on` chains during evaluation, so a cycle is an infinite loop in the product's hot path. Caught at evaluation it is a production hang, and the firm whose status triggered it is the one who sees it |
| 90 | **Unresolved citations are swept on every ingest, and re-resolution appends a correction event** | A parked citation resolving can change a *past* filing verdict — a rule filed as NEW in 2024 turns out to have amended a 2019 rule. Without Step 15's event log this needs history rewritten in place. This is the second thing event replay bought, and it was not the reason it was chosen |
| 91 | ⚠️ **`edges` has no provenance columns** | `fromId · toId · type · createdAt` — no citing clause, no span, no confidence, no state. An auditor cannot be shown *why* the graph believes rule A depends on rule B. Every edge is derived, so it needs its source citation |
| 92 | **Step 17 runs on the projection, not per-document** | Every finding is a statement about a *pair* of rules, and pairs cannot be evaluated while the graph is still being built. Running it at the end of a replay also means it re-runs automatically whenever a retroactive circular forces one |
| 93 | **Contradiction detection is restricted to single-attribute interval conflicts** | General satisfiability is an SMT problem — slow, and it produces findings nobody can act on. Real regulatory contradictions are almost always two different numbers for the same duty: two deadlines, two thresholds, two frequencies |
| 94 | **Bucket by attribute id before pairing** | Pairwise is O(n²) — ~2.5 billion pairs at 50,000 obligations. Two rules can only contradict if they share an attribute, and most attributes appear in a handful of rules, which collapses the work to near-linear |
| 95 | **A contradiction is usually OUR bug, not SEBI's — Step 17 is the pipeline's regression test** | Most findings trace to a mis-resolved audience (10), wrongly merged facts (13), a misapplied modifier (12) or an unnormalised unit (11). It is the **only** check that can detect those errors after the fact, because it compares rules against each other rather than against their source document. Which is why it is worth building early, not last |
| 96 | **Step 17 reports, never auto-fixes — and findings are clustered by root cause** | One wrongly merged audience makes every rule pair beneath it look contradictory: hundreds of findings, one cause. A findings list that cannot be triaged will not be read |
| 61 | Three Step-13 risks are **structurally invisible under mock mode**: judge-call volume, sequential throughput, and cold-start naming | Mock embeddings are random, so the vector band never fires and the mock judge is instant local code. Two are measured the day a real key lands; the third (cold-start clustering) is a **build gap** that no amount of testing fixes |

---

## Open items flagged so far

- **Scanned circulars** need an OCR path. Not designed yet. Older circulars in a
  five-year corpus will hit this.
- **Complex tables** (merged cells, multi-row headers, nested tables) will still
  degrade even with the table lane.
- **Table converter selection** — must return page and position per element, or the
  audit trail breaks. Candidates to evaluate: Docling (retains provenance), Marker,
  MinerU, LlamaParse, Azure Document Intelligence. Circulars are *public* documents,
  so hosted parsers are acceptable here — unlike anything touching tenant facts.
- **Effective date vs issue date** — some circulars apply retroactively. Both must be
  captured; effective date orders the replay.
- **Reference-intent patterns** need building — the wording that distinguishes a
  conditional trigger (*"unable to comply with para X"*) from a definitional
  reference (*"shall have the meaning assigned in para X"*) from an exemption
  (*"nothing in para X shall apply"*). Regulatory phrasing is formulaic enough that
  most sort by pattern, but the pattern set doesn't exist yet.
- **Bulk-import references** (*mutatis mutandis*) need their own structural handler —
  currently they would be mangled into a vague, meaningless attestable rule.
- **The numbering audit's fourth lane** (AI adjudication of genuinely ambiguous
  leftovers) remains a documented hook, unbuilt because the deterministic lanes have
  resolved everything so far.

---

## What comes next

**Flow A — document → rule graph — is now designed end to end.** Steps 1 through 17 are
documented above. What remains for the pipeline is construction, not design.

**Next flows:** onboarding a firm (register → applicability → intake form → facts),
evaluation (derived values → rule execution → conditional walk → status), the amendment
loop (match → impact preview → approve → cascade), and the cross-cutting review queue,
hash-chained audit log and audit-pack export.

### The schema work that gates the build

Steps 14, 15 and 16 between them carry the schema additions that block everything
downstream:

```
obligations.audienceId     ← Step 14's frozen decision cannot be built without it
obligations.hashInputs     ← keeps every hash recomputable through a registry migration
rule_assertions            ← the event log the projection replays
unresolved_citations       ← the retry queue Step 16 sweeps
edges.sourceCitation       ← without it an edge cannot be explained to an auditor
```

**All of this must land before any bulk load.** Rules ingested without the audience in
the identity hash are fingerprinted wrongly, and Step 15 will mis-file them as
amendments of each other. Re-fingerprinting is cheap once 14d exists; re-ingesting is
not.

### Known build gap before any bulk load

**Cold-start clustering (Step 13) is designed but not built.** The greedy sequential
funnel is what exists, so loading a corpus today would let whichever circular happens
to be processed first set the canonical name for every data-point in the system. This
is not a testing concern — no amount of testing changes the outcome. It has to be
built before the first bulk load, and it is cheap to build afterwards only in the
sense that the whole register would need renaming.

### The ordering rule for Steps 12–14

Three separate things must all happen **before a rule is fingerprinted**, because
each changes which firms the rule covers:

1. **modifier application** — restrictions, exemptions, scope extensions
2. **precondition promotion** — a prose-stated condition becoming a real audience
3. **canonical rewrite** — tokens becoming registry ids

Do any of them afterwards and you manufacture a phantom amendment: the system sees
the old fingerprint disappear and a new one arrive, and reports a change SEBI never
made.

### From Step 10 — designed, not built

All three edge cases now have designed solutions (see *"Step 10 — the three edge
cases, resolved"* above). What remains is construction:

- **Step-out verification** — the implication check exists as a design; it needs
  building alongside rung 4, which shares the same machinery.
- **The property-approval screen** — including the AI-pre-ticked implied-conditions
  box. Depends on the admin console (M5+), which doesn't exist yet.
- **Precondition promotion** — depends on the drafter emitting preconditions in a
  structured form, which is Step 11's output shape.
- **The retroactive precondition sweep** needs an identity-preserving migration, since
  promoting a rule to an audience changes its fingerprint.
