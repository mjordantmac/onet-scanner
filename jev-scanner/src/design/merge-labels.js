// Step C3: merge the two independent labels per task, measure agreement per concept, and list
// disagreements for adjudication.
//
//   node src/design/merge-labels.js            -> agreement report + data/labeling/disagreements.json
//   node src/design/merge-labels.js --final    -> applies data/labeling/adjudication.json and writes
//                                                  data/gold_labels.csv
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { openDb, setMeta, ROOT } from '../lib/db.js';

export const BINARY = ['reads_text', 'closed_outcome', 'writes_content', 'physical', 'live_human', 'same_rules',
  'errors_lose_money', 'loss_recoverable', 'outcome_visible', 'speed_value', 'digital_input', 'licensed_signoff'];
export const LEVEL = ['time_per_item', 'volume', 'money_link'];
export const CHOICE = ['buyer', 'sell_model'];
export const ALL = [...BINARY, ...LEVEL, ...CHOICE];

const DIR = resolve(ROOT, 'data', 'labeling');

function loadLabeler(which) {
  const files = readdirSync(resolve(DIR, 'raw')).filter((f) => f.startsWith(`labels_${which}_batch_`)).sort();
  const map = new Map();
  for (const f of files) {
    for (const row of JSON.parse(readFileSync(resolve(DIR, 'raw', f), 'utf8'))) map.set(row.task_id, { ...row, _file: f });
  }
  return map;
}

// Cohen's kappa for two raters over the same items.
function kappa(pairs) {
  const n = pairs.length;
  if (!n) return null;
  const cats = [...new Set(pairs.flat())];
  const po = pairs.filter(([a, b]) => a === b).length / n;
  const pe = cats.reduce((s, c) => s + (pairs.filter(([a]) => a === c).length / n) * (pairs.filter(([, b]) => b === c).length / n), 0);
  return pe === 1 ? 1 : (po - pe) / (1 - pe);
}

export function agreementReport(A, B, ids) {
  const report = {};
  for (const c of ALL) {
    const pairs = ids.map((id) => [String(A.get(id)[c]), String(B.get(id)[c])]);
    const both = c === 'loss_recoverable'
      ? ids.filter((id) => A.get(id).errors_lose_money === 'yes' && B.get(id).errors_lose_money === 'yes').map((id) => [String(A.get(id)[c]), String(B.get(id)[c])])
      : pairs;
    const agree = pairs.filter(([a, b]) => a === b).length / pairs.length;
    const r = { agreement: agree, kappa: kappa(pairs), n: pairs.length };
    if (c === 'loss_recoverable') r.agreement_where_both_lose_money = both.length ? both.filter(([a, b]) => a === b).length / both.length : null;
    if (LEVEL.includes(c)) {
      const num = pairs.filter(([a, b]) => a !== 'unsure' && b !== 'unsure');
      r.within_one = num.filter(([a, b]) => Math.abs(Number(a) - Number(b)) <= 1).length / num.length;
    }
    report[c] = r;
  }
  return report;
}

function main() {
  const final = process.argv.includes('--final');
  const A = loadLabeler('A');
  const B = loadLabeler('B');
  const ids = [...A.keys()].filter((id) => B.has(id)).sort((a, b) => a - b);
  console.log(`labeled by both: ${ids.length} tasks (A ${A.size}, B ${B.size})`);
  const report = agreementReport(A, B, ids);
  console.log('concept'.padEnd(20), 'agree', ' kappa', ' within1');
  for (const [c, r] of Object.entries(report)) {
    console.log(c.padEnd(20), r.agreement.toFixed(2), (r.kappa ?? 0).toFixed(2).padStart(6), r.within_one !== undefined ? r.within_one.toFixed(2).padStart(8) : '');
  }

  const db = openDb();
  const info = new Map(db.prepare(`SELECT d.task_id, d.sample_group, d.split, t.task, o.title FROM design_tasks d
    JOIN tasks t USING(task_id) JOIN occupations o ON o.onet_code = t.onet_code`).all().map((r) => [r.task_id, r]));

  if (!final) {
    const disagreements = [];
    for (const id of ids) {
      const diffs = ALL.filter((c) => String(A.get(id)[c]) !== String(B.get(id)[c]))
        .map((c) => ({ concept: c, A: A.get(id)[c], B: B.get(id)[c] }));
      if (diffs.length) disagreements.push({ task_id: id, occupation: info.get(id).title, task: info.get(id).task, diffs });
    }
    writeFileSync(resolve(DIR, 'disagreements.json'), `${JSON.stringify(disagreements, null, 1)}\n`);
    writeFileSync(resolve(DIR, 'agreement_round1.json'), `${JSON.stringify(report, null, 1)}\n`);
    const n = disagreements.reduce((s, d) => s + d.diffs.length, 0);
    console.log(`${disagreements.length} tasks with at least one disagreement; ${n} disagreeing labels -> data/labeling/disagreements.json`);
    setMeta(db, 'label_agreement_round1', report);
    return;
  }

  // Final: agreed labels + adjudicated disagreements -> gold_labels.csv
  const adjudication = existsSync(resolve(DIR, 'adjudication.json')) ? JSON.parse(readFileSync(resolve(DIR, 'adjudication.json'), 'utf8')) : {};
  const rows = [];
  const missing = [];
  for (const id of ids) {
    const row = { task_id: id, sample_group: info.get(id).sample_group, split: info.get(id).split };
    for (const c of ALL) {
      const a = String(A.get(id)[c]);
      const b = String(B.get(id)[c]);
      if (a === b) row[c] = a;
      else if (adjudication[id] && adjudication[id][c] !== undefined) row[c] = String(adjudication[id][c]);
      else { row[c] = ''; missing.push(`${id}:${c}`); }
    }
    // loss_recoverable is only defined where money is lost.
    if (row.errors_lose_money === 'no') row.loss_recoverable = 'no';
    rows.push(row);
  }
  if (missing.length) {
    console.error(`${missing.length} disagreements have no adjudication, e.g. ${missing.slice(0, 5).join(', ')}`);
    process.exit(1);
  }
  const header = ['task_id', 'sample_group', 'split', ...ALL, 'labeler_a', 'labeler_b'];
  const esc = (v) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
  const lines = [header.join(',')];
  for (const r of rows) {
    lines.push([...header.slice(0, -2).map((h) => esc(r[h])),
      esc(ALL.map((c) => A.get(r.task_id)[c]).join('|')), esc(ALL.map((c) => B.get(r.task_id)[c]).join('|'))].join(','));
  }
  writeFileSync(resolve(ROOT, 'data', 'gold_labels.csv'), `${lines.join('\n')}\n`);
  const unsure = Object.fromEntries(ALL.map((c) => [c, rows.filter((r) => r[c] === 'unsure').length]));
  console.log(`wrote data/gold_labels.csv (${rows.length} tasks); unsure per concept:`, unsure);
  setMeta(db, 'gold_labels', { tasks: rows.length, unsure, adjudicated_labels: Object.values(adjudication).reduce((s, v) => s + Object.keys(v).length, 0) });
}

if (import.meta.url === `file://${process.argv[1]}`) main();
