# Setu — Demo Video Script

> **Runtime:** ~3 min 55 sec (hard cap 4:00) · **Voice:** you, calm and confident, Indian English
> **Pace:** ~140 words/min. Guided product walkthrough — you're showing, not selling.
> **Weighting:** regulator's portal ≈ 60% · broker side ≈ 20% · problem + close ≈ 20%.
> **Rule of the film:** hook and twist in one line each, get onto the screen fast, and finish with a hard-hitting close.

**What you'll need on the timeline**
- Screen recording of the regulator's portal: **circular upload → ingestion pipeline → rule-graph/canvas → new circular → propose/approve flow**
- Screen recording of the broker side: **register → personalised dashboard** (short)
- Deck slides: opening problem, the **four-pillar** slide, the **outcomes** slide, closing line
- Lower-third overlays for the punch lines (appendix)

---

## At a glance

| Time | On screen | Beat | Weight |
|---|---|---|---|
| 0:00–0:10 | DECK: one circular → many readings | Hook (1 line) | — |
| 0:10–0:28 | DECK: "understood once, at the source" | Twist (1 line) | — |
| 0:28–0:42 | SCREEN: SEBI console home | Reveal | — |
| 0:42–1:20 | SCREEN: upload PDF → pipeline → rules | **Document ingestion** | ★ regulator |
| 1:20–1:55 | SCREEN: the rule-graph / canvas | **Canvas** | ★ regulator |
| 1:55–2:38 | SCREEN: new circular → propose → approve | **Inputter/approver flow** | ★ regulator |
| 2:38–3:05 | SCREEN: broker register → dashboard | Broker onboarding + view | broker |
| 3:05–3:25 | DECK: four-pillar slide | **The pillars** | close |
| 3:25–3:45 | DECK: outcomes slide (SEBI / firms) | **The outcomes** | close |
| 3:45–3:55 | DECK: closing line / logo | Final line | — |

---

## The script

### [0:00 – 0:10] Hook — one line
**On screen:** `DECK` — a single SEBI circular at top, arrows fanning out to many broker logos, each reading it slightly differently.
**Overlay:** *Same rule. Hundreds of readings.*

**Voiceover:**
> "SEBI issues one circular — and within a week, every broker in the country is reading that same rule a little differently."

---

### [0:10 – 0:28] Twist — one line
**On screen:** `DECK` — the arrows collapse back into a single point at the source.
**Overlay:** *Understood once. At the source.*

**Voiceover:**
> "But the fix was never at the broker's end — a rule should be understood once, at the source, not re-interpreted again and again by everyone downstream. So I built the place where that happens."

---

### [0:28 – 0:42] Reveal — the regulator's portal
**On screen:** `SCREEN` — the SEBI console home.

**Voiceover:**
> "This is Setu — a compiler, but for regulation. This is the regulator's side; let me walk you through it, the way SEBI would actually use it."

---

### [0:42 – 1:20] Document ingestion — the circular becomes code ★
**On screen:** `SCREEN` — SEBI admin uploads a circular PDF. Pipeline runs on-screen: **PDF → clause tree → draft rules → confidence.** Zoom on one obligation appearing with its executable form.
**Overlay (~1:00):** *A legal PDF → executable rules.*

**Voiceover:**
> "It starts with injesting all current and previously issued circulars. Each circular is a plain PDF. SEBI uploads it, and Setu goes to work. The document is split into its clause tree, and then, clause by clause, the language becomes actual executable rules. Here — 'cyber-security audit at least half-yearly' turns into a rule a computer can check: days since the last audit, less than 182. Each rule carries a confidence score; anything uncertain is held back for a human to confirm. A legal document, becoming runnable code, right in front of you."

---

### [1:20 – 1:55] The canvas — one canonical rule-graph ★
**On screen:** `SCREEN` — extracted rules settle onto the graph, clustered by area, coloured, edges between related ones. Click a node → **Clause Inspector**: original SEBI wording highlighted, executable rule beside it, confidence, source circular + clause.

**Voiceover:**
> "Every rule then takes its place here, on the canonical rule-graph — one single source of truth. Every obligation SEBI has issued, grouped by area, linked where they relate. Click any node and you get the proof: the original SEBI wording, highlighted, next to the executable rule, its confidence, and the exact circular and clause it came from. No black boxes."

---

### [1:55 – 2:38] New circular → propose → approve ★ *(the governance heart)*
**On screen:** `SCREEN` — a new circular arrives. Setu classifies it (**New / Amended / Split**), builds a proposed change-set. **Diff card**: old rule (left) → new rule (right). Affected node **pulses**. One user **proposes**; the **approver** reviews and clicks **Approve**. On commit: old version retired, new version live, audit entry written.
**Overlay (~2:15):** *Propose. Approve. Audited.*

**Voiceover:**
> "Now a new circular arrives — say it amends an existing rule. Setu doesn't add it blindly; it matches it against the graph and works out what actually changed — new, amended, or a split. It drafts the change — old rule on the left, new one on the right — and the affected node starts pulsing. One officer proposes; a second, the approver, reviews and signs off. Nothing goes live without that two-person sign-off. And the instant it's approved, the old version retires, the new one takes over, and it's all written to a tamper-proof audit trail."

---

### [2:38 – 3:05] The other door — a broker's own view
**On screen:** `SCREEN` — broker onboarding: register **Sharma Securities**, pick category + profile. Land on their dashboard — only their applicable obligations, in their own colours. Point to the node from the amendment SEBI just approved — now **red** for Sharma.
**Overlay (~2:55):** *Issued once. Seen instantly.*

**Voiceover:**
> "So that's the rule-book — built and governed. Now, who's it for? Any intermediary just registers. Here's Sharma Securities — category, profile, done. Instantly, they get their own dashboard: only the rules that apply to them, in their own colours. And that amendment SEBI just approved? It's already here — now red for Sharma. Issued once by the regulator; seen instantly by the firm."

---

### [3:05 – 3:25] The pillars — four fast punches
**On screen:** `DECK` — four cards appear one by one as you name them. Big, clean, one icon each.

| | Pillar | One-liner under it |
|---|---|---|
| 1 | **Self-healing compliance** | change a rule, everything re-evaluates itself |
| 2 | **AI drafts. Humans approve.** | generated by AI, signed off by a person |
| 3 | **Issued once. Live everywhere.** | every firm updated in real time |
| 4 | **Fully traceable** | every status ties to a clause + a calculation |

**Voiceover:**
> "Step back, and here's what Setu really is. One — self-healing compliance: change a rule, and every affected obligation re-evaluates on its own. Two — the logic is drafted by AI, but always approved by a human. Three — issued once, and live everywhere, in real time. And four — every single decision, fully traceable."

---

### [3:25 – 3:45] The outcomes — what it actually gives us
**On screen:** `DECK` — two columns.

| For SEBI | For every firm |
|---|---|
| Its rule-book as one always-current, machine-readable system | A portal that does the work — no spreadsheets |
| Live oversight — who's breaching which rule, across the market | Manual compliance effort cut by **more than half** |

**Voiceover:**
> "And the payoff is real. SEBI gets its own rule-book as one always-current system — and can see, live, who is breaching which rule across the entire market. And every firm gets a portal that replaces the spreadsheets — cutting their manual compliance work by more than 50%."

---

### [3:45 – 3:55] Final line
**On screen:** `DECK` — closing slide: Setu logo, *"One graph. Issued once."*, fade.
**Overlay:** *One graph. Two doors.*

**Voiceover:**
> "One graph, issued once, understood identically by everyone. The rule-book stops being a document you read… and becomes a system that runs."

*(Beat. Hold the logo 2 seconds. End.)*

---

## Appendix

### Overlay text (lower thirds) — ~3 sec each
1. `0:07` — **Same rule. Hundreds of readings.**
2. `0:20` — **Understood once. At the source.**
3. `1:00` — **A legal PDF → executable rules.**
4. `2:15` — **Propose. Approve. Audited.**
5. `2:55` — **Issued once. Seen instantly.**
6. `3:05` — the four pillar cards (self-healing · AI drafts, humans approve · issued once, live everywhere · fully traceable)
7. `3:45` — **One graph. Two doors.**

### The headline number — pick one you can defend
The "more than half" line is the one stat in the film, so make it a claim you're comfortable defending if a judge pushes. Options, strongest first:
- **"cuts manual compliance work by more than half"** — effort saved (what's in the script now).
- **"from a new circular to firm-wide implementation — weeks to minutes"** — time compression (very defensible, very concrete).
- **"the same data-point is entered once, not across dozens of forms"** — dedup framing (provable from the product).
- If you want a hard %, keep it as an *estimate*: say "we estimate…" so it reads as a projection, not a measured result.

### Delivery notes
- Indian English, unhurried. The regulator walkthrough is the film; the last 50 seconds are where you lift your energy for the close.
- Slow down and let the screen work on two moments: the rule *appearing* out of the PDF, and the **Approve** click.
- On the pillars, let each card land before the next line — four clean beats, not a rushed list.

### If you need to cut to ~3:30
- Trim the reveal [0:28–0:42] to: *"This is Setu — a compiler for regulation. Here's the regulator's side."*
- Drop the pillar one-liners from the VO (keep them on the slide) — just say "self-healing, AI-drafted and human-approved, real-time, and fully traceable."

### If ingestion can't be shown live
- Pre-run the pipeline and scrub the recorded stages faster; narration stays the same. Seeing PDF turn into a rule is the point — even sped up, it lands.
