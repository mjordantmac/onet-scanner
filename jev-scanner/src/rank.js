// Step 6: rank every scored task. Code only: reads the cached Jev answers for the current question
// set, recomputes every score from config/weights.js, and writes
//   out/ranked_tasks.csv  every scored task, kept ones first (by opportunity), then filtered ones
//   out/top_tasks.md      the top 300 kept tasks
// Re-running after a weight change costs nothing.
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { openDb, setMeta, ROOT } from './lib/db.js';
import { scoreTask, percentiles, rankOrder } from './lib/scoring.js';
import { CONCEPT_SOURCES, SCORE_IDS, questionSetHash, jevConceptValues } from '../config/questions.js';
import { MODEL, FILTERS, UNCERTAIN_CONFIDENCE, TOP_TASKS, PILOT } from '../config/weights.js';
import { HIGH_ANCHORS, LOW_ANCHORS } from '../config/anchors.js';
import { codeValues, toConceptScale } from './design/features.js';

const NUMERIC = ['reads_text', 'closed_outcome', 'writes_content', 'physical', 'live_human', 'same_rules', 'errors_lose_money',
  'loss_recoverable', 'outcome_visible', 'speed_value', 'digital_input', 'licensed_signoff', 'time_per_item', 'volume', 'money_link'];

function csvCell(v) {
  if (v == null) return '';
  const s = typeof v === 'number' ? (Number.isInteger(v) ? String(v) : v.toFixed(4)) : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
const md = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
const money = (x) => (x == null ? 'n/a' : x >= 1e9 ? `$${(x / 1e9).toFixed(2)}B` : `$${(x / 1e6).toFixed(1)}M`);

// Score and order every answered task. Shared with src/export-viewer.js so both show the same numbers.
export function computeRanking(db) {
  const qsetHash = questionSetHash(MODEL);
  const tasks = db.prepare(`SELECT t.task_id, t.task, t.onet_code, t.labor_value, o.title occupation, o.bls_match
    FROM tasks t JOIN occupations o ON o.onet_code = t.onet_code`).all();
  const answers = new Map(db.prepare('SELECT task_id, answers_json, min_score_conf, model_reported, request_id FROM jev_answers WHERE qset_hash = ?')
    .all(qsetHash).map((r) => [r.task_id, r]));

  // scale = percentile of labor_value among all tasks that have one; volume/3 where it is missing.
  const withLabor = tasks.filter((t) => t.labor_value != null);
  const pct = percentiles(withLabor.map((t) => t.labor_value));
  const laborPct = new Map(withLabor.map((t, i) => [t.task_id, pct[i]]));

  // Concepts computed in code from O*NET (none in the final set, but supported).
  const codeConcepts = Object.entries(CONCEPT_SOURCES).filter(([, c]) => c.source === 'onet_code');
  const code = codeConcepts.length ? codeValues(db, [...answers.keys()]) : null;

  const rows = [];
  for (const t of tasks) {
    const a = answers.get(t.task_id);
    if (!a) continue;
    const jv = jevConceptValues(JSON.parse(a.answers_json));
    const v = { ...jv };
    for (const [concept, c] of codeConcepts) v[concept] = toConceptScale(concept, c.candidate, code[concept][c.candidate].get(t.task_id));
    const missing = NUMERIC.filter((k) => typeof v[k] !== 'number');
    if (missing.length) throw new Error(`task ${t.task_id}: no value for ${missing.join(', ')}`);
    const scaleSource = laborPct.has(t.task_id) ? 'labor_value_percentile' : 'volume';
    const scale = scaleSource === 'volume' ? v.volume / 3 : laborPct.get(t.task_id);
    const s = scoreTask(v, scale);
    rows.push({
      ...t, ...s, scale_source: scaleSource, values: v,
      buyer: jv.buyer?.choice, buyer_conf: jv.buyer?.confidence, sell_model: jv.sell_model?.choice, sell_model_conf: jv.sell_model?.confidence,
      min_score_conf: a.min_score_conf, uncertain: a.min_score_conf != null && a.min_score_conf < UNCERTAIN_CONFIDENCE,
      model_reported: a.model_reported, request_id: a.request_id, answers_raw: a.answers_json,
    });
  }
  rows.sort(rankOrder);
  let kept = 0;
  for (const r of rows) r.rank = r.passes ? ++kept : null;
  return { qsetHash, tasks, rows, kept, answers };
}

function main() {
  const db = openDb();
  const { qsetHash, tasks, rows, kept } = computeRanking(db);

  // ---- out/ranked_tasks.csv
  const outDir = resolve(ROOT, 'out');
  mkdirSync(outDir, { recursive: true });
  const header = ['rank', 'task_id', 'onet_code', 'occupation', 'task', 'passes_filters', 'dropped_by', 'opportunity', 'fit', 'money', 'scale',
    'scale_source', 'labor_value', ...NUMERIC.slice(0, 8), 'recoverable_loss', ...NUMERIC.slice(8), 'buyer', 'buyer_conf', 'sell_model',
    'sell_model_conf', 'min_score_conf', 'uncertain', 'model_reported', 'request_id'];
  const lines = [header.join(',')];
  for (const r of rows) {
    const rec = { ...r.values, ...r, passes_filters: r.passes ? 1 : 0, dropped_by: r.dropped.join('+'), uncertain: r.uncertain ? 1 : 0,
      labor_value: r.labor_value == null ? null : Math.round(r.labor_value) };
    lines.push(header.map((h) => csvCell(rec[h])).join(','));
  }
  writeFileSync(resolve(outDir, 'ranked_tasks.csv'), `${lines.join('\n')}\n`);

  // ---- counts
  const counts = {
    tasks_total: tasks.length,
    tasks_scored: rows.length,
    tasks_not_scored: tasks.length - rows.length,
    filtered_total: rows.filter((r) => !r.passes).length,
    filtered_physical_only: rows.filter((r) => r.dropped.join() === 'physical').length,
    filtered_reads_text_only: rows.filter((r) => r.dropped.join() === 'reads_text').length,
    filtered_both: rows.filter((r) => r.dropped.length === 2).length,
    kept: kept,
    uncertain_all_scored: rows.filter((r) => r.uncertain).length,
    uncertain_kept: rows.filter((r) => r.passes && r.uncertain).length,
    uncertain_top: rows.filter((r) => r.passes && r.rank <= TOP_TASKS && r.uncertain).length,
    scale_from_volume_kept: rows.filter((r) => r.passes && r.scale_source === 'volume').length,
  };

  // ---- anchors on the full ranking (same quarter rule as the design-stage check)
  const n = rows.length;
  const q = Math.floor(n * PILOT.quarter);
  const pos = new Map(rows.map((r, i) => [r.task_id, i + 1]));
  const byId = new Map(rows.map((r) => [r.task_id, r]));
  const anchorRow = (a) => ({ task_id: a.task_id, why: a.why, position: pos.get(a.task_id) ?? null, rank: byId.get(a.task_id)?.rank ?? null,
    dropped_by: byId.get(a.task_id)?.dropped.join('+') ?? 'not scored' });
  const anchors = {
    scored_tasks: n, quarter_size: q,
    high_in_top_quarter: HIGH_ANCHORS.filter((a) => pos.get(a.task_id) <= q).length,
    high_in_top_300: HIGH_ANCHORS.filter((a) => (byId.get(a.task_id)?.rank ?? Infinity) <= TOP_TASKS).length,
    low_in_bottom_quarter: LOW_ANCHORS.filter((a) => pos.get(a.task_id) > n - q).length,
    low_removed_by_filters: LOW_ANCHORS.filter((a) => byId.get(a.task_id) && !byId.get(a.task_id).passes).length,
    high: HIGH_ANCHORS.map(anchorRow), low: LOW_ANCHORS.map(anchorRow),
  };

  // ---- out/top_tasks.md
  const top = rows.filter((r) => r.passes).slice(0, TOP_TASKS);
  const mdLines = [
    `# Top ${TOP_TASKS} tasks for Jev`,
    '',
    `Question set \`${qsetHash}\`, model \`${MODEL}\`. Generated by \`src/rank.js\` from cached Jev answers; every number below is computed in code (config/weights.js).`,
    '',
    `- Tasks in O*NET: ${counts.tasks_total}; scored by Jev: ${counts.tasks_scored}`,
    `- Removed by the filters (physical >= ${FILTERS.physicalDropAtOrAbove} or reads_text < ${FILTERS.readsTextDropBelow}): ${counts.filtered_total} `
      + `(physical only ${counts.filtered_physical_only}, reads_text only ${counts.filtered_reads_text_only}, both ${counts.filtered_both})`,
    `- Kept and ranked: ${counts.kept}; flagged uncertain (a Score answer with confidence < ${UNCERTAIN_CONFIDENCE}): ${counts.uncertain_kept} of the kept, ${counts.uncertain_top} of this top ${TOP_TASKS}`,
    `- Scale is the task's labor value percentile across all O*NET tasks; ${counts.scale_from_volume_kept} kept tasks have no BLS wage data and use volume/3 instead.`,
    '- Labor value is an estimate: occupation employment x median wage (BLS OEWS May 2025) x the task\'s share of the occupation\'s rated tasks.',
    '',
    '| # | Task ID | Occupation | Task | Opportunity | Fit | Money | Scale | Labor value | Buyer | Sell model | Flag |',
    '|---:|---:|---|---|---:|---:|---:|---:|---:|---|---|---|',
    ...top.map((r) => `| ${r.rank} | ${r.task_id} | ${md(r.occupation)} | ${md(r.task)} | ${r.opportunity.toFixed(3)} | ${r.fit.toFixed(2)} | ${r.money.toFixed(2)} | `
      + `${r.scale.toFixed(2)}${r.scale_source === 'volume' ? '*' : ''} | ${money(r.labor_value)} | ${r.buyer} | ${r.sell_model} | ${r.uncertain ? 'uncertain' : ''} |`),
    '',
    '\\* scale from volume/3 (no BLS wage data for the occupation).',
    '',
    'Source data: O*NET 31.0 Database (USDOL/ETA, CC BY 4.0), modified; BLS OEWS May 2025 national estimates. See README.md.',
    '',
  ];
  writeFileSync(resolve(outDir, 'top_tasks.md'), mdLines.join('\n'));

  const summary = { qset_hash: qsetHash, model: MODEL, generated_at: new Date().toISOString(), counts, anchors,
    models_reported: Object.fromEntries(db.prepare('SELECT model_reported m, COUNT(*) n FROM jev_answers WHERE qset_hash = ? GROUP BY 1').all(qsetHash).map((r) => [r.m, r.n])) };
  setMeta(db, 'rank', summary);
  console.log(JSON.stringify({ ...summary, anchors: { ...anchors, high: undefined, low: undefined } }, null, 1));
  console.log(`wrote out/ranked_tasks.csv (${rows.length} rows) and out/top_tasks.md (${top.length} tasks)`);
}

if (process.argv[1] && process.argv[1].endsWith('rank.js')) main();
