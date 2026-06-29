# Setu — Graph Canvas layout decision

> **Status:** decided · **Locked before:** M5 · **Companion:** [extraction-and-attribute-resolution-scope.md](extraction-and-attribute-resolution-scope.md) §13 Screen 1.
>
> The Graph Canvas is the product's spine — one shared `react-force-graph` component
> serving both personas (SEBI edit, intermediary read-only). This doc fixes *how the
> canvas is laid out* so it looks meaningful, is technically correct, and stays stable
> across demo runs.

---

## 1. What is a node, what is an edge

| Element | Maps to | Notes |
|---|---|---|
| **Node** | one `obligations` row | label = `obligations.title`; group = `obligations.context`/category |
| **Node colour** | `evaluations.status` | GREEN / RED / GREY / AMBER — **per tenant** for an intermediary, full set for SEBI |
| **Node size** *(optional)* | significance | e.g. # tenants affected, or attribute fan-in |
| **Edge** | one `edges` row | never inferred for layout — only real `edges` table rows |

**Edge types** (`shared/types` `EdgeType`):

| Type | Style | Meaning | Frequency |
|---|---|---|---|
| `shared_evidence` | dashed, no arrow | two obligations read the same `attribute_id` | **common** — main intra-cluster structure |
| `depends_on` | solid, arrow | one rule is conditional on another | sparse |
| `amends` / `supersedes` / `split_of` | coloured, arrow | versioning lineage | ~none at rest; **appears during the amendment** (the hero) |

Colour carries exactly **one** meaning: compliance status. Nothing else on the canvas
is allowed to reuse the status palette.

---

## 2. Layout model — clustered force graph (NOT a connected web)

Most obligations have **zero edges to each other**. Laying out by edges alone gives a
few knots plus a cloud of lonely nodes — meaningless. So:

- **Primary spatial dimension = category** (`obligations.context` bucketed into
  Cybersecurity, Capital & deposits, Reporting & filings, KYC & governance, …).
  Every node gets a home from its category even with no edges.
- **Edges are a thin detail layer** inside clusters (mostly `shared_evidence`) and
  sparsely across them.
- A category with one lonely obligation still renders as its own small region — a node
  is never "lost" at the edge of the canvas.

---

## 3. Self-healing spacing — d3-force config

`react-force-graph-2d` runs a d3-force simulation per tick. "Self-healing" = these four
forces continuously re-settling on any node/edge change:

| Force | Role | Setting |
|---|---|---|
| `forceManyBody` (charge) | nodes repel → spread | `strength -180` |
| `forceLink` | edges as springs | `distance` ≈ 40 for `shared_evidence`, ≈ 110 for `amends`/`split_of` |
| `forceCollide` | hard radius → **no overlaps** | `radius = nodeR + 6` |
| `forceX` / `forceY` → **category centroid** | pull each node to its category anchor | `strength 0.12` |

```js
graph
  .d3Force('x', d3.forceX(d => clusterAnchor[d.category].x).strength(0.12))
  .d3Force('y', d3.forceY(d => clusterAnchor[d.category].y).strength(0.12))
  .d3Force('collide', d3.forceCollide(d => d.r + 6));
graph.d3Force('charge').strength(-180);
```

- **Fact recolours a node** → no movement, just a fill change.
- **Amendment adds a node** (e.g. `split_of`) → `graph.d3ReheatSimulation()`; the new
  node slots into its category cluster, collide nudges neighbours aside, it re-settles.

---

## 4. Beautify features (priority order)

1. **Cluster hulls** — translucent blob behind each category (the biggest readability
   win; turns node-soup into a map of regions). `d3.polygonHull` over the category's
   node positions → rounded path, or an ellipse on the cluster bbox, labelled with the
   category name. **Hulls stay neutral grey** — never tint by category (would clash with
   status colour).
2. **Settle-then-freeze** — run to low alpha on load, then pin positions (`fx`/`fy`). On
   a structural change, unpin only the affected neighbourhood, reheat briefly, re-pin.
   Kills the perpetual jiggle that reads as "unstable" on stage.
3. **Node radius by significance** (# tenants affected / attribute fan-in).
4. **Edge styling by type** (dash/solid + colour + arrow per §1); curve parallel edges.
5. **Label decluttering by zoom** — hide labels zoomed out, show on hover / zoom-in.
6. **Pulse on PROPOSED nodes** — affected nodes pulse before approve/reject (M6 hero).

---

## 5. Determinism (demo stability)

Cluster anchors **must be deterministic**: sort categories by name, assign fixed
positions on a ring (or grid), seed the simulation the same way each run. The map must
look identical across rehearsals — judges should never see it reshuffle between runs.

## 6. Library choice

- **Canvas:** `react-force-graph-2d` (organic living map).
- **Rule editor** (inside Clause Inspector, reused from BRE): React Flow — *not* this
  canvas. Two different surfaces, don't conflate them.
