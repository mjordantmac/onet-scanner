// Export everything the explorer page needs into out/viewer/data.json: every scored task with its
// scores, every Jev answer (with confidence and the runner-up choice), the O*NET context (occupation,
// ratings, Detailed Work Activities) and the run summary. Scores come from src/rank.js, so the page
// and out/ranked_tasks.csv always agree.
//   node src/export-viewer.js
import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { openDb, getMeta, ROOT } from './lib/db.js';
import { computeRanking } from './rank.js';
import { CONCEPT_SOURCES } from '../config/questions.js';
import { MODEL, FILTERS, FIT, MONEY, MONEY_FLOOR, SCALE_FLOOR, SPEED_BONUS, UNCERTAIN_CONFIDENCE, COST } from '../config/weights.js';

const CONCEPTS = ['reads_text', 'closed_outcome', 'writes_content', 'physical', 'live_human', 'same_rules', 'errors_lose_money',
  'loss_recoverable', 'outcome_visible', 'speed_value', 'digital_input', 'licensed_signoff', 'time_per_item', 'volume', 'money_link'];
const r2 = (x) => (x == null ? null : Math.round(x * 100) / 100);
const r3 = (x) => (x == null ? null : Math.round(x * 1000) / 1000);

function main() {
  const db = openDb();
  const { qsetHash, rows } = computeRanking(db);
  const meta = (k) => { const v = getMeta(db, k); return v ? JSON.parse(v) : null; };

  const occ = db.prepare('SELECT onet_code, title, employment, median_wage, bls_match FROM occupations ORDER BY onet_code').all();
  const occIndex = new Map(occ.map((o, i) => [o.onet_code, i]));
  const dwaRef = db.prepare('SELECT dwa_id, dwa_title FROM dwa_reference ORDER BY dwa_id').all();
  const dwaIndex = new Map(dwaRef.map((d, i) => [d.dwa_id, i]));
  const taskDwas = new Map();
  for (const l of db.prepare('SELECT task_id, dwa_id FROM task_dwas ORDER BY task_id, dwa_id').all()) {
    if (!taskDwas.has(l.task_id)) taskDwas.set(l.task_id, []);
    taskDwas.get(l.task_id).push(dwaIndex.get(l.dwa_id));
  }
  const ratings = new Map(db.prepare('SELECT task_id, importance, relevance, frequency FROM tasks').all().map((t) => [t.task_id, t]));

  // Choice option lists come from the questions actually asked.
  const options = (concept) => Object.keys(CONCEPT_SOURCES[concept].q.criteria);
  const buyers = options('buyer');
  const sells = options('sell_model');
  const inputs = options('digital_input');
  const choice = (a, list) => {
    const ranked = Object.entries(a.probabilities).sort((x, y) => y[1] - x[1]);
    return [list.indexOf(ranked[0][0]), r2(ranked[0][1]), list.indexOf(ranked[1][0]), r2(ranked[1][1])];
  };
  const dropCode = (d) => (d.includes('physical') ? 1 : 0) + (d.includes('reads_text') ? 2 : 0);

  const cols = ['id', 'occ', 'task', 'rank', 'drop', 'opp', 'fit', 'money', 'scale', 'scaleFromVolume', 'labor', ...CONCEPTS, 'recoverable',
    'buyer', 'buyerP', 'buyer2', 'buyer2P', 'sell', 'sellP', 'sell2', 'sell2P', 'input', 'inputP',
    'physicalConf', 'volumeConf', 'moneyConf', 'uncertain', 'importance', 'relevance', 'frequency', 'dwas'];
  const out = rows.map((r) => {
    const a = JSON.parse(r.answers_raw);
    const rt = ratings.get(r.task_id);
    const b = choice(a.buyer, buyers);
    const sm = choice(a.sell_model, sells);
    const inp = choice(a.digital_input, inputs);
    return [r.task_id, occIndex.get(r.onet_code), r.task, r.rank, dropCode(r.dropped), r3(r.opportunity), r3(r.fit), r3(r.money), r3(r.scale),
      r.scale_source === 'volume' ? 1 : 0, r.labor_value == null ? null : Math.round(r.labor_value),
      ...CONCEPTS.map((c) => r2(r.values[c])), r2(r.recoverable_loss),
      b[0], b[1], b[2], b[3], sm[0], sm[1], sm[2], sm[3], inp[0], inp[1],
      r2(a.physical?.confidence), r2(a.volume?.confidence), r2(a.money_link?.confidence), r.uncertain ? 1 : 0,
      r2(rt.importance), r2(rt.relevance), r2(rt.frequency), taskDwas.get(r.task_id) || []];
  });

  const questions = Object.fromEntries(Object.entries(CONCEPT_SOURCES).map(([k, c]) => [k, { type: c.q.type, text: c.q.instructions, criteria: c.q.criteria }]));
  const runs = db.prepare('SELECT run_id, mode, input_tokens, cost_usd, status, started_at, finished_at FROM runs ORDER BY run_id').all();
  const spend = meta('design_spend');
  const themesPath = resolve(ROOT, 'data', 'themes_ranked.json');
  const data = {
    generated_at: new Date().toISOString(),
    qset: qsetHash, model: MODEL,
    weights: { FILTERS, FIT, MONEY, MONEY_FLOOR, SCALE_FLOOR, SPEED_BONUS, UNCERTAIN_CONFIDENCE },
    rank: meta('rank'), onet: { version: meta('onet').version, release: meta('onet').release }, bls: { release: meta('bls').release },
    spend: { scoring_usd: runs.reduce((s, r) => s + (r.cost_usd || 0), 0), design_usd: spend?.cost_usd ?? 0, price_per_million_input: COST.usdPerMillionInputTokens,
      input_tokens: runs.reduce((s, r) => s + (r.input_tokens || 0), 0) + (spend?.input_tokens ?? 0) },
    questions, buyers, sells, inputs,
    occupations: occ.map((o) => [o.onet_code, o.title, o.employment == null ? null : Math.round(o.employment), o.median_wage == null ? null : Math.round(o.median_wage), o.bls_match]),
    dwas: dwaRef.map((d) => d.dwa_title),
    themes: existsSync(themesPath) ? JSON.parse(readFileSync(themesPath, 'utf8')) : null,
    cols, rows: out,
  };
  const dir = resolve(ROOT, 'out', 'viewer');
  mkdirSync(dir, { recursive: true });
  const json = JSON.stringify(data);
  writeFileSync(resolve(dir, 'data.json'), json);
  console.log(`wrote out/viewer/data.json: ${out.length} tasks, ${(json.length / 1e6).toFixed(1)} MB`);
}

main();
