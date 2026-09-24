// Steps D3-E3: score every candidate (Jev variants and O*NET code candidates) against the gold
// labels, pick the best per concept on the dev split, report held-out numbers, check
// correlations between the chosen measures, and run the anchor check.
//
//   node src/design/evaluate.js           -> metrics table; writes data/design/metrics.json
//   node src/design/evaluate.js --select  -> also writes data/design/selection.json, correlations
//                                             and the anchor check
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { openDb, setMeta, ROOT } from '../lib/db.js';
import { rng } from '../lib/rng.js';
import { CONCEPTS, COMPOUND_DRAFTS } from '../../config/question_variants.js';
import { CODE_CANDIDATES, codeValues, toConceptScale } from './features.js';
import { scoreTask, percentiles, rankOrder } from '../lib/scoring.js';
import { HIGH_ANCHORS, LOW_ANCHORS } from '../../config/anchors.js';
import { PILOT } from '../../config/weights.js';

export const TARGET = { binary: 0.80, level: 0.60, choice: 0.70 };
const MIN_SPREAD = 0.05;
const CODE_TIE_MARGIN = 0.02; // prefer an O*NET code measure when it is within this of the best Jev variant

// ---------------------------------------------------------------- metrics
function ranks(xs) {
  const idx = xs.map((x, i) => [x, i]).sort((a, b) => a[0] - b[0]);
  const r = new Array(xs.length);
  for (let i = 0; i < idx.length;) {
    let j = i;
    while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
    for (let k = i; k <= j; k++) r[idx[k][1]] = (i + j) / 2 + 1;
    i = j + 1;
  }
  return r;
}
function pearson(x, y) {
  const n = x.length;
  if (n < 3) return null;
  const mx = x.reduce((s, v) => s + v, 0) / n;
  const my = y.reduce((s, v) => s + v, 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) { sxy += (x[i] - mx) * (y[i] - my); sxx += (x[i] - mx) ** 2; syy += (y[i] - my) ** 2; }
  return sxx && syy ? sxy / Math.sqrt(sxx * syy) : null;
}
export const spearman = (x, y) => pearson(ranks(x), ranks(y));
export function auc(scores, labels) { // labels 1/0; Mann-Whitney with ties
  const pos = labels.filter((l) => l === 1).length;
  const neg = labels.length - pos;
  if (!pos || !neg) return null;
  const r = ranks(scores);
  const sumPos = r.reduce((s, v, i) => s + (labels[i] === 1 ? v : 0), 0);
  return (sumPos - (pos * (pos + 1)) / 2) / (pos * neg);
}
function sd(xs) {
  const m = xs.reduce((s, v) => s + v, 0) / xs.length;
  return Math.sqrt(xs.reduce((s, v) => s + (v - m) ** 2, 0) / xs.length);
}

// ---------------------------------------------------------------- data
function readGold() {
  const [header, ...lines] = readFileSync(resolve(ROOT, 'data', 'gold_labels.csv'), 'utf8').trim().split('\n');
  const cols = header.split(',');
  const parseLine = (line) => { // simple CSV with quotes
    const out = []; let cur = ''; let q = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (q) { if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') q = false; else cur += ch; }
      else if (ch === '"') q = true; else if (ch === ',') { out.push(cur); cur = ''; } else cur += ch;
    }
    out.push(cur);
    return out;
  };
  return lines.map((l) => Object.fromEntries(parseLine(l).map((v, i) => [cols[i], v])));
}

// Latest answer for each question id, across rounds.
function loadAnswers(db) {
  const byTask = new Map();
  const has = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'design_answers'").get();
  if (!has) return byTask; // no Jev answers yet: code candidates only
  for (const r of db.prepare('SELECT task_id, round, answers_json FROM design_answers ORDER BY round').all()) {
    const cur = byTask.get(r.task_id) || {};
    Object.assign(cur, JSON.parse(r.answers_json));
    byTask.set(r.task_id, cur);
  }
  return byTask;
}

// ---------------------------------------------------------------- evaluation
function evaluateCandidate(kind, concept, values, gold, split, extra = {}) {
  const rows = gold.filter((g) => g.split === split || split === 'all')
    .filter((g) => values.get(Number(g.task_id)) != null)
    .filter((g) => (CONCEPTS[concept]?.conditionalOn ? g[CONCEPTS[concept].conditionalOn] === 'yes' : true));
  if (kind === 'binary') {
    const use = rows.filter((g) => g[concept] === 'yes' || g[concept] === 'no');
    return { metric: auc(use.map((g) => values.get(Number(g.task_id))), use.map((g) => (g[concept] === 'yes' ? 1 : 0))), n: use.length, rows: use };
  }
  if (kind === 'level') {
    const use = rows.filter((g) => g[concept] !== 'unsure' && g[concept] !== '');
    const x = use.map((g) => values.get(Number(g.task_id)));
    const y = use.map((g) => Number(g[concept]));
    const mae = extra.onScale ? x.reduce((s, v, i) => s + Math.abs(v - y[i]), 0) / x.length : null;
    return { metric: spearman(x, y), mae, n: use.length, rows: use };
  }
  // choice: values map task -> probabilities object
  const use = rows.filter((g) => g[concept] !== 'unsure' && g[concept] !== '');
  let correct = 0; let top2 = 0;
  for (const g of use) {
    const probs = values.get(Number(g.task_id));
    const order = Object.entries(probs).sort((a, b) => b[1] - a[1]).map(([k]) => k);
    if (order[0] === g[concept]) correct++;
    if (order.slice(0, 2).includes(g[concept])) top2++;
  }
  return { metric: use.length ? correct / use.length : null, top2: use.length ? top2 / use.length : null, n: use.length, rows: use };
}

function bootstrapCI(kind, concept, values, rows, reps = 1000) {
  const random = rng(7);
  const stats = [];
  for (let r = 0; r < reps; r++) {
    const sample = rows.map(() => rows[Math.floor(random() * rows.length)]);
    const m = evaluateCandidate(kind, concept, values, sample.map((g) => ({ ...g, split: 'all' })), 'all').metric;
    if (m != null && !Number.isNaN(m)) stats.push(m);
  }
  stats.sort((a, b) => a - b);
  return stats.length ? [stats[Math.floor(0.025 * stats.length)], stats[Math.floor(0.975 * stats.length) - 1]] : null;
}

function spreadOf(kind, values, allIds) {
  const xs = allIds.map((id) => values.get(id)).filter((v) => v != null);
  if (kind === 'choice') {
    const counts = new Map();
    for (const p of xs) { const top = Object.entries(p).sort((a, b) => b[1] - a[1])[0][0]; counts.set(top, (counts.get(top) || 0) + 1); }
    const topShare = Math.max(...counts.values()) / xs.length;
    return { spread: 1 - topShare, flat: topShare > 0.9 };
  }
  const lo = Math.min(...xs); const hi = Math.max(...xs);
  const norm = hi > lo ? xs.map((v) => (v - lo) / (hi - lo)) : xs.map(() => 0);
  const scaleSd = kind === 'level' ? sd(xs) / 3 : sd(xs);
  const s = Math.min(scaleSd, sd(norm));
  return { spread: s, flat: s < MIN_SPREAD };
}

function main() {
  const select = process.argv.includes('--select');
  const db = openDb();
  const gold = readGold();
  const allIds = gold.map((g) => Number(g.task_id));
  const answers = loadAnswers(db);
  const code = codeValues(db, allIds);
  const results = {}; // concept -> [candidate results]

  for (const [concept, def] of Object.entries(CONCEPTS)) {
    const cands = [];
    for (const [v, variant] of Object.entries(def.variants)) {
      const qid = `${concept}__${v}`;
      const values = new Map();
      for (const id of allIds) {
        const a = answers.get(id)?.[qid];
        if (!a) continue;
        values.set(id, def.kind === 'choice' ? a.probabilities : variant.toValue(a));
      }
      if (!values.size) continue;
      cands.push({ source: 'jev', name: v, note: variant.note, values, onScale: def.kind === 'level' });
    }
    for (const [name, c] of Object.entries(CODE_CANDIDATES[concept] || {})) {
      const raw = code[concept][name];
      const values = new Map([...raw].filter(([, x]) => x != null).map(([id, x]) => [id, toConceptScale(concept, name, x)]));
      cands.push({ source: 'onet_code', name, note: `${c.level}-level: ${c.describe}`, values, onScale: false });
    }
    results[concept] = cands.map((c) => {
      const dev = evaluateCandidate(def.kind, concept, c.values, gold, 'dev', { onScale: c.onScale });
      const held = evaluateCandidate(def.kind, concept, c.values, gold, 'heldout', { onScale: c.onScale });
      // Bias check: the likely-good/likely-bad pools were drawn with an O*NET occupation prior, which can
      // flatter occupation-level code measures. The random group (dev part only) has no such tilt.
      const devRandom = evaluateCandidate(def.kind, concept, c.values, gold.filter((g) => g.sample_group === 'random'), 'dev', { onScale: c.onScale });
      const spread = spreadOf(def.kind, c.values, allIds);
      return { ...c, dev: { metric: dev.metric, mae: dev.mae, top2: dev.top2, n: dev.n, random_only: devRandom.metric, n_random: devRandom.n },
        heldout: { metric: held.metric, mae: held.mae, top2: held.top2, n: held.n, ci95: select ? bootstrapCI(def.kind, concept, c.values, held.rows) : null },
        spread };
    });
  }

  // The compound draft recoverable_loss vs. the combined gold label (money lost AND recoverable).
  const compound = {};
  for (const [name, d] of Object.entries(COMPOUND_DRAFTS)) {
    const values = new Map(allIds.filter((id) => answers.get(id)?.[`${name}__draft`]).map((id) => [id, d.toValue(answers.get(id)[`${name}__draft`])]));
    const combined = gold.map((g) => ({ ...g, [name]: g.errors_lose_money === 'yes' && g.loss_recoverable === 'yes' ? 'yes' : (g.errors_lose_money === 'unsure' || g.loss_recoverable === 'unsure' ? 'unsure' : 'no') }));
    if (values.size) compound[name] = { dev: evaluateCandidate('binary', name, values, combined, 'dev').metric, heldout: evaluateCandidate('binary', name, values, combined, 'heldout').metric };
  }

  // ---- print
  const fmt = (x) => (x == null || Number.isNaN(x) ? '  -  ' : x.toFixed(3));
  console.log('concept            candidate                    dev    held   spread  n_dev  dev_random');
  for (const [concept, rs] of Object.entries(results)) {
    for (const r of rs) {
      console.log(`${concept.padEnd(18)} ${`${r.source === 'jev' ? 'jev' : 'code'}:${r.name}`.padEnd(28)} ${fmt(r.dev.metric)}  ${fmt(r.heldout.metric)}  ${fmt(r.spread.spread)}${r.spread.flat ? '*' : ' '} ${String(r.dev.n).padStart(4)}   ${fmt(r.dev.random_only)}`
        + (r.dev.mae != null ? `  mae ${r.dev.mae.toFixed(2)}` : '') + (r.dev.top2 != null ? `  top2 ${r.dev.top2.toFixed(2)}` : ''));
    }
  }
  if (Object.keys(compound).length) console.log('compound draft vs combined gold:', compound);

  const outDir = resolve(ROOT, 'data', 'design');
  mkdirSync(outDir, { recursive: true });
  const strip = (r) => ({ source: r.source, name: r.name, note: r.note, dev: r.dev, heldout: r.heldout, spread: r.spread });
  writeFileSync(resolve(outDir, 'metrics.json'), `${JSON.stringify({ results: Object.fromEntries(Object.entries(results).map(([k, v]) => [k, v.map(strip)])), compound }, null, 1)}\n`);
  if (!select) return;

  // ---- select best per concept on dev
  const selection = {};
  for (const [concept, rs] of Object.entries(results)) {
    const kind = CONCEPTS[concept].kind;
    const usable = rs.filter((r) => !r.spread.flat && r.dev.metric != null);
    const best = [...usable].sort((a, b) => b.dev.metric - a.dev.metric)[0];
    const codeBest = usable.filter((r) => r.source === 'onet_code').sort((a, b) => b.dev.metric - a.dev.metric)[0];
    const chosen = codeBest && best && codeBest.dev.metric >= best.dev.metric - CODE_TIE_MARGIN ? codeBest : best;
    selection[concept] = { kind, source: chosen.source, name: chosen.name, note: chosen.note, dev: chosen.dev, heldout: chosen.heldout,
      target: TARGET[kind], meets_target_dev: chosen.dev.metric >= TARGET[kind], meets_target_heldout: chosen.heldout.metric >= TARGET[kind],
      tried: rs.map((r) => `${r.source === 'jev' ? 'jev' : 'code'}:${r.name}`) };
  }

  // ---- E1: correlations between chosen measures across all labeled tasks
  const chosenValues = {};
  for (const [concept, s] of Object.entries(selection)) {
    if (s.kind === 'choice') continue;
    chosenValues[concept] = results[concept].find((r) => r.source === s.source && r.name === s.name).values;
  }
  const corr = [];
  const names = Object.keys(chosenValues);
  for (let i = 0; i < names.length; i++) {
    for (let j = i + 1; j < names.length; j++) {
      const ids = allIds.filter((id) => chosenValues[names[i]].get(id) != null && chosenValues[names[j]].get(id) != null);
      const r = pearson(ids.map((id) => chosenValues[names[i]].get(id)), ids.map((id) => chosenValues[names[j]].get(id)));
      corr.push({ a: names[i], b: names[j], r });
    }
  }
  corr.sort((x, y) => Math.abs(y.r) - Math.abs(x.r));
  const highCorr = corr.filter((c) => Math.abs(c.r) > 0.85);

  // ---- E3: anchor check on the labeled set
  const laborAll = db.prepare('SELECT task_id, labor_value FROM tasks WHERE labor_value IS NOT NULL').all();
  const pct = percentiles(laborAll.map((r) => r.labor_value));
  const scaleOf = new Map(laborAll.map((r, i) => [r.task_id, pct[i]]));
  const scored = allIds.map((id) => {
    const v = Object.fromEntries(Object.keys(chosenValues).map((c) => [c, chosenValues[c].get(id)]));
    const scale = scaleOf.has(id) ? scaleOf.get(id) : (v.volume ?? 0) / 3;
    return { task_id: id, ...scoreTask(v, scale) };
  }).sort(rankOrder);
  const n = scored.length;
  const q = Math.floor(n * PILOT.quarter);
  const rankOf = new Map(scored.map((s, i) => [s.task_id, i + 1]));
  const highTop = HIGH_ANCHORS.filter((a) => rankOf.get(a.task_id) <= q);
  const lowBottom = LOW_ANCHORS.filter((a) => rankOf.get(a.task_id) > n - q);
  const anchor = {
    labeled_tasks: n, quarter_size: q,
    high_in_top_quarter: highTop.length, low_in_bottom_quarter: lowBottom.length,
    passes: highTop.length >= PILOT.anchorsNeededPerSide && lowBottom.length >= PILOT.anchorsNeededPerSide,
    high: HIGH_ANCHORS.map((a) => ({ task_id: a.task_id, why: a.why, rank: rankOf.get(a.task_id) })),
    low: LOW_ANCHORS.map((a) => ({ task_id: a.task_id, why: a.why, rank: rankOf.get(a.task_id) })),
  };

  writeFileSync(resolve(outDir, 'selection.json'), `${JSON.stringify({ selection, correlations: corr, high_correlations: highCorr, anchor_check: anchor }, null, 1)}\n`);
  console.log('\nselected per concept (dev -> held-out):');
  for (const [c, s] of Object.entries(selection)) {
    console.log(`  ${c.padEnd(18)} ${`${s.source}:${s.name}`.padEnd(30)} ${fmt(s.dev.metric)} -> ${fmt(s.heldout.metric)} ${s.heldout.ci95 ? `[${fmt(s.heldout.ci95[0])}, ${fmt(s.heldout.ci95[1])}]` : ''}${s.meets_target_heldout ? '' : '  BELOW TARGET'}`);
  }
  console.log('\ncorrelations above 0.85:', highCorr.length ? highCorr : 'none', '\nhighest:', corr.slice(0, 5).map((c) => `${c.a}~${c.b} ${c.r.toFixed(2)}`).join(', '));
  console.log(`\nanchor check: ${anchor.high_in_top_quarter}/15 high in top quarter, ${anchor.low_in_bottom_quarter}/15 low in bottom quarter -> ${anchor.passes ? 'PASS' : 'FAIL'}`);
  setMeta(db, 'design_selection', { selection, high_correlations: highCorr, anchor_check: { ...anchor, high: undefined, low: undefined } });
}

main();
