/**
 * D5 — Step 13's type gate and cold-start clustering
 * (run: `npm run test:type-gate` and `npm run test:coldstart`; this file is both).
 *
 * Two things are under test:
 *
 *   1. the TYPE GATE — a date can never merge with a count, however similar the
 *      wording. The cheapest guard in the funnel, and it was missing entirely:
 *      candidates arrived ranked purely by meaning distance.
 *
 *   2. COLD-START CLUSTERING — a build gap, not a test gap. Resolving greedily
 *      one circular at a time means whichever document is processed FIRST names
 *      everything forever.
 */

import 'reflect-metadata';
import {
  Mention,
  chooseName,
  clarity,
  cluster,
  cosineDistance,
  recency,
} from '../src/ingestion/coldstart.engine';
import { typeGate, typesCompatible, unitsCompatible } from '../src/ingestion/type-gate';

let passed = 0;
const failures: string[] = [];

function check(name: string, cond: boolean, detail = '') {
  if (cond) {
    passed += 1;
    console.log(`  ✓ ${name}`);
  } else {
    failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

function section(t: string) {
  console.log(`\n${t}`);
}

/** A unit vector that is `angle` radians from the reference. */
function vecAt(angle: number): number[] {
  return [Math.cos(angle), Math.sin(angle), 0];
}

function mention(over: Partial<Mention> = {}): Mention {
  return {
    token: 'last_audit_date',
    docId: 'DOC-A',
    effectiveFrom: '2024-01-01',
    dataType: 'date',
    unit: null,
    meaning: 'the date of the last cyber security audit',
    topic: 'cybersecurity_audit',
    ...over,
  };
}

async function main() {
  // ── the type gate ─────────────────────────────────────────────────────────
  section('the type gate · a date can NEVER merge with a count');

  const candidates = [
    { id: 1, dataType: 'number', unit: 'count', distance: 0.01 },
    { id: 2, dataType: 'date', unit: null, distance: 0.06 },
    { id: 3, dataType: 'document', unit: null, distance: 0.09 },
  ];

  const gated = typeGate(candidates, { data_type: 'date' });
  check(
    'the NEAREST candidate is discarded when its type is wrong',
    gated.rejected.some((r) => r.id === 1 && r.reason === 'type'),
    JSON.stringify(gated.rejected),
  );
  check(
    'and the correctly typed one survives to be reused',
    gated.kept.length === 1 && gated.kept[0].id === 2,
    'a gate applied to the winner alone would have left a create where a reuse was right',
  );
  check(
    'at distance 0.01 — closeness is not a reason to merge across types',
    candidates[0].distance === 0.01 && !gated.kept.some((c) => c.id === 1),
  );
  check('the rejection says what it wanted and what it found', gated.rejected[0].was === 'number' && gated.rejected[0].wanted === 'date');

  check('a date never merges with a count', !typesCompatible('date', 'number'));
  check('a document never merges with a date', !typesCompatible('document', 'date'));
  check('a date merges with a date', typesCompatible('date', 'date'));
  check(
    'an UNSTATED type does not block a merge',
    typesCompatible(null, 'date') && typesCompatible('date', undefined),
    'fragmenting the register on the drafter\'s uncertainty is not the same as a real difference',
  );
  check(
    'and "string" is treated as unstated in one direction only',
    typesCompatible('string', 'date') && typesCompatible('date', 'string'),
    'the drafter falls back to string when it cannot tell',
  );

  section('the type gate · units');
  check('days and months measure the same thing', unitsCompatible('days', 'months'));
  check('days and rupees do not', !unitsCompatible('days', 'rupees'));
  check('percent and count do not', !unitsCompatible('percent', 'count'));
  check(
    'an unstated unit never blocks a merge',
    unitsCompatible(null, 'rupees') && unitsCompatible('rupees', ''),
    'otherwise net_worth splits from net_worth (rupees) and creates the duplicate the register prevents',
  );
  check(
    'two unrecognised units are compared literally',
    unitsCompatible('bushels', 'bushels') && !unitsCompatible('bushels', 'furlongs'),
    'if we cannot say they measure the same thing, we do not assume it',
  );
  {
    const g = typeGate([{ id: 9, dataType: 'number', unit: 'rupees' }], {
      data_type: 'number',
      unit: 'percent',
    });
    check(
      'a unit mismatch is caught even when the type matches',
      g.kept.length === 0 && g.rejected[0].reason === 'unit',
      JSON.stringify(g.rejected),
    );
  }

  // ── the acceptance case ───────────────────────────────────────────────────
  section('acceptance · date vs count at distance 0.01 → still 2 attributes');
  {
    // "date of last audit" and "number of audits": near-identical wording, so
    // they land 0.01 apart, and merging them would put one box on the intake
    // form where there should be two.
    const existing = [{ id: 41, dataType: 'number', unit: 'count', distance: 0.01 }];
    const g = typeGate(existing, { data_type: 'date' });
    check(
      'nothing survives the gate, so the funnel creates a second attribute',
      g.kept.length === 0,
      'once two facts share an id, EVERY rule using either of them is wrong',
    );
  }

  // ── cold start ────────────────────────────────────────────────────────────
  section('cold start · clarity, recency, frequency');

  check('a spelled-out name is clearer than an abbreviation', clarity('last_audit_date') > clarity('aud_dt'));
  check('and than a single truncated word', clarity('audit_completion_date') > clarity('acd'));
  check('recency is 1 for today and low for a decade ago', recency(new Date().toISOString()) > 0.9 && recency('2010-01-01', new Date('2026-01-01')) < 0.1);
  check('an unparseable date does not crash the weighting', recency('not-a-date') === 0.5);

  section('acceptance · aud_dt ×1 vs last_audit_date ×400 → the latter wins');
  {
    // Embeddings are supplied deliberately. Clustering is a MEANING operation,
    // and two spellings of one fact only meet if their vectors say so — under
    // mock embeddings (random by construction) they never would, which is
    // decision 61's point that cold start cannot be validated in mock mode.
    const mentions: Mention[] = [
      mention({ token: 'aud_dt', docId: 'CIR-2019', effectiveFrom: '2019-03-01', embedding: vecAt(0) }),
      ...Array.from({ length: 400 }, (_, i) =>
        mention({
          token: 'last_audit_date',
          docId: `CIR-${2020 + (i % 5)}`,
          effectiveFrom: '2024-06-01',
          embedding: vecAt(0.02),
        }),
      ),
    ];
    const { name, rationale } = chooseName(mentions, new Date('2026-01-01'));
    check(
      'the name used 400 times wins, not the one processed first',
      name === 'last_audit_date',
      `chose "${name}"`,
    );
    check('and the reason is shown, not hidden', /400x/.test(rationale) && /aud_dt/.test(rationale), rationale);

    const { clusters } = cluster(mentions, { now: new Date('2026-01-01') });
    check(
      'both spellings land in ONE cluster',
      clusters.length === 1 && clusters[0].mentions === 401,
      `${clusters.length} clusters`,
    );
    check(
      'and the loser becomes an alias, not a second data-point',
      clusters[0].aliases.includes('aud_dt') && clusters[0].canonicalName === 'last_audit_date',
      JSON.stringify(clusters[0].aliases),
    );
  }
  {
    // Frequency dominates, but not absolutely: a slightly rarer, much clearer
    // spelling should win over a marginally more common abbreviation.
    const mentions = [
      ...Array.from({ length: 20 }, () => mention({ token: 'nw' })),
      ...Array.from({ length: 18 }, () => mention({ token: 'net_worth_rupees' })),
    ];
    check(
      'a marginally rarer but far clearer name wins',
      chooseName(mentions).name === 'net_worth_rupees',
      chooseName(mentions).name,
    );
  }
  {
    const mentions = [
      ...Array.from({ length: 400 }, () => mention({ token: 'nw' })),
      ...Array.from({ length: 2 }, () => mention({ token: 'net_worth_rupees' })),
    ];
    check(
      'but 400 to 2 is not a tie — frequency still dominates',
      chooseName(mentions).name === 'nw',
      'the register exists to be read, and 400 mentions is what people recognise',
    );
  }

  section('cold start · clustering');
  {
    const near = cluster([
      mention({ token: 'a', embedding: vecAt(0) }),
      mention({ token: 'b', embedding: vecAt(0.1) }),
    ]);
    check('two mentions 0.005 apart cluster together', near.clusters.length === 1, `${near.clusters.length}`);
    const far = cluster([
      mention({ token: 'a', embedding: vecAt(0) }),
      mention({ token: 'b', embedding: vecAt(1.2) }),
    ]);
    check('two mentions far apart do not', far.clusters.length === 2);
  }
  {
    // ⚠️ The gate applies here too. At bulk-load scale, clustering by meaning
    // alone would fuse a date with a count thousands of times before anyone looked.
    const mixed = cluster([
      mention({ token: 'audit_x', dataType: 'date', embedding: vecAt(0) }),
      mention({ token: 'audit_x', dataType: 'number', embedding: vecAt(0.01) }),
    ]);
    check(
      'identical wording and different types never cluster',
      mixed.clusters.length === 2,
      `${mixed.clusters.length} clusters`,
    );
    check(
      'even at distance ~0',
      cosineDistance(vecAt(0), vecAt(0.01)) < 0.001,
    );
  }
  {
    const noVectors = cluster([
      mention({ token: 'last_audit_date' }),
      mention({ token: 'last_audit_date' }),
      mention({ token: 'aud_dt' }),
    ]);
    check(
      'without usable vectors it dedupes only what is provably identical',
      noVectors.clusters.length === 2 && noVectors.stats.withVectors === 0,
      'mock embeddings are random; clustering on them would be theatre',
    );
    check('and it says so, rather than reporting a clean run', noVectors.stats.withVectors === 0);
  }
  {
    const many = cluster(
      Array.from({ length: 500 }, (_, i) =>
        mention({ token: `t${i % 40}`, embedding: vecAt((i % 40) * 0.08) }),
      ),
    );
    check(
      '500 mentions collapse to far fewer clusters',
      many.clusters.length < 40 && many.stats.mentions === 500,
      `${many.stats.clusters} clusters from 500 mentions`,
    );
    check('and the biggest cluster is reported first', many.clusters[0].mentions >= many.clusters[many.clusters.length - 1].mentions);
  }

  console.log('');
  if (failures.length) {
    console.log(`FAILED — ${passed} passed, ${failures.length} failed:`);
    failures.forEach((f) => console.log(`  • ${f}`));
    process.exit(1);
  }
  console.log(`PASSED — all ${passed} assertions green.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
