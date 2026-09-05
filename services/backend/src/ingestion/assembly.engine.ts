/**
 * Step 12 — Assembly. The PURE half.
 *
 * Steps 1–9 turn a PDF into windows; Step 11 sends every window to the AI **in
 * parallel** and gets back rules and modifiers, each an interpretation of one
 * clause **in isolation**, connected to nothing. Step 12 is where the parallel
 * work stops and the pile is assembled in order.
 *
 *     PHASE A — EXTRACTION    all windows, in parallel, any order
 *     ─────────────────────── phase boundary ───────────────────────
 *     PHASE B — ASSEMBLY      walk them in order and build the graph
 *
 * That boundary is why extraction could be blindly parallel: completion order is
 * irrelevant because nothing is consumed until all of it is done.
 *
 * ⚠️ ORDERING IS THE POINT. Modifiers are applied, then the audience is stamped,
 * and only THEN is the rule fingerprinted. Fingerprinting first and narrowing
 * afterwards changes the hash of a rule that was already filed — a phantom
 * amendment of a duty nobody actually amended. Here the rule is satisfied by the
 * sequence itself rather than by anyone remembering it.
 *
 * ── What the corpus actually contains ───────────────────────────────────────
 *
 * Measured over the seven SEBI documents: **34 sentences cross-reference a
 * paragraph and say something about its application, and roughly two of them
 * narrow by a property of the FIRM.** The rest narrow by transaction type,
 * instrument type, scheme type or client type:
 *
 *     "Investment limits in 12.3.1 shall not be applicable on investments
 *      in securitized debt instruments"                    ← instrument, not firm
 *     "Paragraphs 8.4.5 and 8.4.6 shall apply to 'switch in' transactions"
 *                                                          ← transaction, not firm
 *     "para 50.1 shall not be applicable to clients having arrangements
 *      with custodians registered with SEBI"               ← the CLIENT, not the firm
 *
 * The design models a modifier as narrowing a rule's AUDIENCE, and an audience is
 * a set of FIRMS. Most real modifiers are not that. Forcing them into the
 * audience would be wrong in the dangerous direction — it would claim a firm is
 * outside a rule when only one kind of its transactions is.
 *
 * So a modifier's condition is ROUTED:
 *
 *     expressible as a firm property   → narrows applicability (the design path)
 *     anything else                    → a PRECONDITION on the rule, attached and
 *                                        carried, never promoted to an audience
 *
 * Which is what "preconditions still attached, not yet promoted" was always
 * meant to mean; the measurement only shows how much of the traffic goes that way.
 */

import { ClauseNode, resolveTarget } from './links.engine';

// ── applicability as an expression, not a flat list ─────────────────────────
//
// A list of ANDed conditions cannot express "except, unless":
//
//     all brokers AND NOT ( clients < 500 AND NOT holds_client_funds )
//
// and every term remembers the clause that added it, so a modifier targeting
// ANOTHER MODIFIER has a labelled handle to grab (Problem 3). Chains work
// because each modification leaves one behind for the next.

export type Applicability =
  | { kind: 'base'; conditions: string[]; source: string }
  | { kind: 'and'; terms: Applicability[] }
  | { kind: 'or'; terms: Applicability[] }
  | { kind: 'not'; term: Applicability; source: string };

export type Effect = 'restrict_scope' | 'exempt' | 'extend_scope' | 'override_value';

export interface DraftedModifier {
  /** The clause this modifier was drafted from. */
  fromClauseNo: string | null;
  fromClauseId: number | null;
  effect: Effect;
  /** What the AI said it points at — a string, connected to nothing yet. */
  targets: string;
  /** The condition it imposes, in firm-property form when it can be. */
  condition: string;
  /** Free-text when the condition is not about the firm at all. */
  scopeNote?: string;
  /** For override_value: the value that replaces the original. */
  overrideValue?: string | number;
  raw: string;
  confidence: number;
}

export interface AssemblyRule {
  key: string;
  clauseId: number | null;
  clauseNo: string | null;
  title: string;
  /** Needed to build an override: the value is substituted into a COPY. */
  expression?: string;
  /** The audience in force from Step 10 — the floor, or a chapter narrowing. */
  audienceConditions: string[];
  audienceId: number | null;
}

export type FlagKind =
  | 'orphaned_modifier'
  | 'multi_rule_target'
  | 'chained_modification'
  | 'unexpressible_condition'
  | 'ambiguous_target'
  | 'cross_document_target';

export interface AssemblyFlag {
  kind: FlagKind;
  ruleKeys: string[];
  modifierFrom: string | null;
  message: string;
}

export interface AssembledRule {
  key: string;
  applicability: Applicability;
  /** Flat conditions, when the expression is a plain conjunction — what the
   *  fingerprint uses. Null when it is not, which is itself information. */
  conditions: string[] | null;
  /** The audience in force BEFORE any modifier ran. Kept so the caller can tell
   *  a real narrowing from a rule that only picked up a precondition — without
   *  it, "3 audiences narrowed" gets reported for three rules whose audience
   *  never moved. */
  baseConditions: string[];
  /** Conditions that are NOT about the firm. Carried, never promoted. */
  preconditions: { source: string; note: string }[];
  appliedFrom: string[];
  /** Set when a modifier's condition cannot be expressed as a firm test. The
   *  rule must be filed in REVIEW rather than filed unrestricted. */
  needsReview: boolean;
}

export interface AssemblyResult {
  rules: AssembledRule[];
  /** override_value produces a SECOND rule; it never edits the original. */
  derived: {
    fromKey: string;
    conditions: string[];
    overrideValue: string | number;
    source: string;
    /** The original expression with the value substituted, when that could be
     *  done unambiguously. Null when the original has no single numeric
     *  literal to replace -- guessing which one SEBI meant would silently
     *  produce a different duty. */
    overriddenExpression: string | null;
    /** Set when substitution was refused, so the reason reaches the queue. */
    note?: string;
  }[];
  flags: AssemblyFlag[];
  stats: {
    modifiers: number;
    resolved: number;
    orphaned: number;
    /** Targets naming several clauses. Refused — a modifier never fans out. */
    ambiguous: number;
    applied: number;
    narrowedAudience: number;
    preconditionsAttached: number;
  };
}

// ── 12b — resolve what each modifier points at ──────────────────────────────

/**
 * `targets: "9.5.1"` is a string connected to nothing. Resolving it means
 * finding the actual clause — the SAME two-hop problem Step 16 solves for
 * citations, so it uses the same resolver rather than a second one that could
 * drift from it. `clause_no` is not a key (Decision 66), and the citing
 * clause's own subtree is searched first.
 *
 * An orphaned modifier matters more than it looks: it usually means the clause
 * it points at went missing, which is a second independent signal of upstream
 * loss alongside the numbering audit.
 */
export function resolveModifier(
  modifier: DraftedModifier,
  clauses: ClauseNode[],
): { clauseIds: number[]; how: string } {
  return resolveTarget(
    {
      raw: modifier.raw,
      cue: 'para',
      number: modifier.targets.trim(),
      kind: 'reference',
      targetType: 'internal',
    },
    modifier.fromClauseId,
    clauses,
  );
}

// ── 12c — the index ─────────────────────────────────────────────────────────

/**
 * Keyed by CLAUSE ID, not by the text "9.5.1". The same string means different
 * things in different documents, so resolving once up front means the walk never
 * has to think about it again.
 */
export function buildIndex(
  modifiers: DraftedModifier[],
  clauses: ClauseNode[],
): {
  index: Map<number, DraftedModifier[]>;
  /** Modifiers that point at another MODIFIER's clause rather than a rule's. */
  chained: { modifier: DraftedModifier; targetSource: string }[];
  orphaned: DraftedModifier[];
  /** Targets that resolve to SEVERAL clauses. Refused, never spread. */
  ambiguous: { modifier: DraftedModifier; candidates: number }[];
} {
  const index = new Map<number, DraftedModifier[]>();
  const orphaned: DraftedModifier[] = [];
  const ambiguous: { modifier: DraftedModifier; candidates: number }[] = [];
  const chained: { modifier: DraftedModifier; targetSource: string }[] = [];
  const modifierClauseNos = new Set(
    modifiers.map((m) => m.fromClauseNo).filter((n): n is string => Boolean(n)),
  );

  for (const modifier of modifiers) {
    // Problem 3 — a modifier that modifies a modifier. It does not target a
    // RULE; it targets a term in some rule's applicability. Caught here by the
    // target naming another modifier's own clause, and applied later against
    // the labelled handle that modifier left behind.
    if (modifierClauseNos.has(modifier.targets.trim())) {
      chained.push({ modifier, targetSource: modifier.targets.trim() });
      continue;
    }
    const target = resolveModifier(modifier, clauses);
    if (target.clauseIds.length === 0) {
      orphaned.push(modifier);
      continue;
    }
    // ⚠️ A MODIFIER MUST NOT FAN OUT. Step 16 fans a `depends_on` edge out to
    // every rule of an ambiguously resolved clause, because over-linking is
    // recoverable — evaluation walks the edge and finds nothing. A modifier is
    // the other kind: restricting five rules when SEBI meant one silently
    // removes four duties from the firms that owe them, and nothing downstream
    // can detect it. Same asymmetry that made `amends` refuse in Step 16.
    //
    // Found by a live run: "3.3.2.3" matched five clauses in the mutual funds
    // circular and one modifier was applied thirty-five times.
    if (target.how === 'ambiguous' || target.clauseIds.length > 1) {
      ambiguous.push({ modifier, candidates: target.clauseIds.length });
      continue;
    }
    const clauseId = target.clauseIds[0];
    const list = index.get(clauseId) ?? [];
    list.push(modifier);
    index.set(clauseId, list);
  }
  return { index, chained, orphaned, ambiguous };
}

// ── the effects ─────────────────────────────────────────────────────────────

/** A condition the firm-property vocabulary can express. */
export function isFirmCondition(condition: string, vocabulary: Set<string>): boolean {
  const name = condition.trim().split(/\s+/)[0];
  return vocabulary.has(name);
}

/** Flatten an applicability expression back to a conjunction, when it is one. */
export function flatten(node: Applicability): string[] | null {
  if (node.kind === 'base') return [...node.conditions];
  if (node.kind === 'and') {
    const out: string[] = [];
    for (const term of node.terms) {
      const inner = flatten(term);
      if (inner === null) return null;
      out.push(...inner);
    }
    return [...new Set(out)].sort();
  }
  // NOT and OR are genuinely not conjunctions. Returning null rather than an
  // approximation is deliberate: the fingerprint would otherwise be built from
  // an applicability that is not the rule's actual applicability.
  return null;
}

/** Render an expression for display and for the audit pack. */
export function render(node: Applicability): string {
  if (node.kind === 'base') return node.conditions.join(' && ') || 'true';
  if (node.kind === 'and') return node.terms.map(render).join(' && ');
  if (node.kind === 'or') return `(${node.terms.map(render).join(' || ')})`;
  return `NOT (${render(node.term)})`;
}

/** Find the term a chained modifier is pointing at, by its source label. */
export function findTerm(node: Applicability, source: string): Applicability | null {
  if (node.kind === 'not' && node.source === source) return node;
  if (node.kind === 'base' && node.source === source) return node;
  if (node.kind === 'and' || node.kind === 'or') {
    for (const term of node.terms) {
      const found = findTerm(term, source);
      if (found) return found;
    }
  }
  if (node.kind === 'not') return findTerm(node.term, source);
  return null;
}

/**
 * Put the override's value into a copy of the original expression.
 *
 * Only when there is exactly ONE numeric literal to replace. "for QSBs the
 * period in 9.5.1 shall be 90 days" against `days_since(x) <= 180` is
 * unambiguous; against `days_since(x) <= 180 AND count(y) >= 2` it is not, and
 * picking one would silently produce a duty SEBI did not write. The refusal
 * carries its reason so a human sees the override rather than losing it.
 */
export function substituteValue(
  expression: string,
  value: string | number,
): { expression: string | null; note?: string } {
  if (!expression) {
    return { expression: null, note: 'the original rule has no expression to override' };
  }
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return { expression: null, note: `override value "${value}" is not a number` };
  }
  const literals = expression.match(/(?<![\w.])\d+(?:\.\d+)?(?![\w.])/g) ?? [];
  if (literals.length !== 1) {
    return {
      expression: null,
      note:
        `the original has ${literals.length} numeric literals, so which one the ` +
        `override replaces is ambiguous - filed for review instead of guessed`,
    };
  }
  return {
    expression: expression.replace(
      /(?<![\w.])\d+(?:\.\d+)?(?![\w.])/,
      String(numeric),
    ),
  };
}

// ── 12d — the walk ──────────────────────────────────────────────────────────

/**
 * Walk the rules and apply. Step (a) is a dictionary lookup asking "does
 * anything modify this clause?" — usually the answer is no and the rule passes
 * straight through, which is what makes assembly cheap on a real document.
 */
export function assemble(
  rules: AssemblyRule[],
  modifiers: DraftedModifier[],
  clauses: ClauseNode[],
  vocabulary: Set<string>,
): AssemblyResult {
  const { index, chained, orphaned, ambiguous } = buildIndex(modifiers, clauses);
  const rulesByClause = new Map<number, AssemblyRule[]>();
  for (const rule of rules) {
    if (rule.clauseId === null) continue;
    const list = rulesByClause.get(rule.clauseId) ?? [];
    list.push(rule);
    rulesByClause.set(rule.clauseId, list);
  }

  const flags: AssemblyFlag[] = [];
  /** Keyed by modifier, so one modifier reaching many rules is one finding. */
  const unexpressible = new Map<string, AssemblyFlag>();
  const derived: AssemblyResult['derived'] = [];
  const out: AssembledRule[] = [];
  let applied = 0;
  let narrowedAudience = 0;
  let preconditionsAttached = 0;

  for (const { modifier, candidates } of ambiguous) {
    flags.push({
      kind: 'ambiguous_target',
      ruleKeys: [],
      modifierFrom: modifier.fromClauseNo,
      message:
        `"${modifier.raw.slice(0, 60)}" targets ${modifier.targets}, which names ${candidates} ` +
        `different clauses — refused rather than applied to all of them`,
    });
  }

  for (const modifier of orphaned) {
    flags.push({
      kind: 'orphaned_modifier',
      ruleKeys: [],
      modifierFrom: modifier.fromClauseNo,
      message:
        `"${modifier.raw.slice(0, 70)}" targets ${modifier.targets}, which is not in this ` +
        `document — the clause it points at was probably lost upstream`,
    });
  }

  for (const rule of rules) {
    const own = rule.clauseId === null ? [] : (index.get(rule.clauseId) ?? []);
    let applicability: Applicability = {
      kind: 'base',
      conditions: [...rule.audienceConditions],
      source: rule.clauseNo ?? rule.key,
    };
    const preconditions: { source: string; note: string }[] = [];
    const appliedFrom: string[] = [];
    let needsReview = false;

    // One clause, several rules. Does "9.5.1 applies only when..." restrict
    // both duties it produced? We apply it to both — the modifier cites the
    // CLAUSE, and the clause is the only unit it can name. Usually right,
    // occasionally not, and the text gives no way to tell, so it is flagged.
    if (own.length > 0 && rule.clauseId !== null) {
      const siblings = rulesByClause.get(rule.clauseId) ?? [];
      if (siblings.length > 1 && siblings[0].key === rule.key) {
        flags.push({
          kind: 'multi_rule_target',
          ruleKeys: siblings.map((r) => r.key),
          modifierFrom: own[0].fromClauseNo,
          message:
            `clause ${rule.clauseNo} produced ${siblings.length} rules and a modifier names the ` +
            `clause, not a rule — applied to all ${siblings.length}, please confirm`,
        });
      }
    }

    // override_value goes LAST: it creates a new rule from whatever the others
    // produced, so it has to see their result. The rest are order-independent —
    // restrictions AND together and the AND is commutative.
    const ordered = [...own].sort((a, b) =>
      (a.effect === 'override_value' ? 1 : 0) - (b.effect === 'override_value' ? 1 : 0),
    );

    for (const modifier of ordered) {
      const source = modifier.fromClauseNo ?? 'unknown';
      const firmCondition =
        modifier.condition && isFirmCondition(modifier.condition, vocabulary);

      if (!firmCondition) {
        // Not about the firm — most real modifiers are not. Carried as a
        // precondition on the rule rather than forced into the audience, which
        // would claim a firm is outside a rule when only one kind of its
        // transactions is.
        preconditions.push({
          source,
          note: modifier.scopeNote || modifier.condition || modifier.raw.slice(0, 120),
        });
        preconditionsAttached += 1;
        appliedFrom.push(source);
        applied += 1;
        // Problem 2 — the condition cannot be written as a test, so the rule
        // must NOT be filed as though the restriction did not exist. Filing it
        // unrestricted applies it to firms it should not; dropping it makes
        // firms miss a duty they owe. REVIEW is the only option that is not
        // silently wrong in one direction or the other.
        if (modifier.effect === 'restrict_scope' || modifier.effect === 'exempt') {
          needsReview = true;
          // Clustered per MODIFIER, not per rule. One modifier reaching thirty
          // rules is ONE thing for a reviewer to decide, and a queue that lists
          // it thirty times is a queue nobody reads. (The same lesson Step 17
          // learned about contradictions.)
          const existing = unexpressible.get(`${source}|${modifier.targets}`);
          if (existing) {
            existing.ruleKeys.push(rule.key);
          } else {
            unexpressible.set(`${source}|${modifier.targets}`, {
              kind: 'unexpressible_condition',
              ruleKeys: [rule.key],
              modifierFrom: source,
              message:
                `${modifier.effect} from ${source} is not a firm property ` +
                `("${(modifier.scopeNote || modifier.condition || '').slice(0, 60)}") — ` +
                `carried as a precondition and the rule filed for REVIEW, not applied silently`,
            });
          }
        }
        continue;
      }

      applied += 1;
      appliedFrom.push(source);
      switch (modifier.effect) {
        case 'restrict_scope':
          applicability = {
            kind: 'and',
            terms: [applicability, { kind: 'base', conditions: [modifier.condition], source }],
          };
          narrowedAudience += 1;
          break;
        case 'exempt':
          applicability = {
            kind: 'and',
            terms: [
              applicability,
              {
                kind: 'not',
                source,
                term: { kind: 'base', conditions: [modifier.condition], source },
              },
            ],
          };
          narrowedAudience += 1;
          break;
        case 'extend_scope':
          applicability = {
            kind: 'or',
            terms: [applicability, { kind: 'base', conditions: [modifier.condition], source }],
          };
          break;
        case 'override_value': {
          // It does NOT edit the original. Everyone keeps the general rule; the
          // narrower group gets a second, stricter one marked as overriding it.
          const substituted = substituteValue(
            rule.expression ?? '',
            modifier.overrideValue ?? '',
          );
          derived.push({
            fromKey: rule.key,
            conditions: [...(flatten(applicability) ?? rule.audienceConditions), modifier.condition],
            overrideValue: modifier.overrideValue ?? '',
            source,
            overriddenExpression: substituted.expression,
            note: substituted.note,
          });
          break;
        }
      }
    }

    // Problem 3 — a modifier aimed at another modifier's term.
    for (const { modifier, targetSource } of chained) {
      const term = findTerm(applicability, targetSource);
      if (!term || term.kind !== 'not') continue;
      // "The exemption in 12.7 shall not apply to brokers holding client funds"
      // narrows the EXEMPTION, not the rule: the exempted set shrinks.
      term.term = {
        kind: 'and',
        terms: [
          term.term,
          {
            kind: 'not',
            source: modifier.fromClauseNo ?? 'unknown',
            term: {
              kind: 'base',
              conditions: [modifier.condition],
              source: modifier.fromClauseNo ?? 'unknown',
            },
          },
        ],
      };
      applied += 1;
      appliedFrom.push(modifier.fromClauseNo ?? 'unknown');
      // Computed AND flagged. "The exemption shall not apply to X" is a double
      // negative and humans misread these too: does it restore X to the original
      // obligation, or to something narrower? Usually restoration — but the
      // wording does not guarantee it.
      flags.push({
        kind: 'chained_modification',
        ruleKeys: [rule.key],
        modifierFrom: modifier.fromClauseNo,
        message:
          `${modifier.fromClauseNo} modifies the exemption added by ${targetSource}, not the rule ` +
          `itself — read as written, ${render(applicability)}. Please confirm.`,
      });
    }

    out.push({
      key: rule.key,
      applicability,
      baseConditions: [...rule.audienceConditions],
      conditions: flatten(applicability),
      preconditions,
      appliedFrom: [...new Set(appliedFrom)],
      needsReview,
    });
  }

  flags.push(...unexpressible.values());

  return {
    rules: out,
    derived,
    flags,
    stats: {
      modifiers: modifiers.length,
      resolved: modifiers.length - orphaned.length - ambiguous.length,
      orphaned: orphaned.length,
      ambiguous: ambiguous.length,
      applied,
      narrowedAudience,
      preconditionsAttached,
    },
  };
}
