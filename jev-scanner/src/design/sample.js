// Step C1: sample the labeled set and split it into dev / held-out.
//   240 tasks with a fixed seed: 80 from occupations likely to fit Jev well, 80 likely to fit
//   badly, 80 at random; plus the 30 anchor tasks. Split 2/3 dev, 1/3 held-out per group.
//
//   node src/design/sample.js
// Writes the design_tasks table and data/labeling/labeled_set.json (what labelers see).
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { openDb, setMeta, ROOT } from '../lib/db.js';
import { rng, shuffle } from '../lib/rng.js';
import { HIGH_ANCHORS, LOW_ANCHORS } from '../../config/anchors.js';

export const SAMPLE_SEED = 20260925;
const PER_GROUP = 80;
const MAX_PER_OCCUPATION = 2;
const DEV_SHARE = 2 / 3;

// Occupation-level prior for "likely to fit Jev": O*NET Work Activities importance (IM, 1-5).
const GOOD_GWAS = ['4.A.2.a.2', '4.A.2.a.3', '4.A.3.b.1', '4.A.2.a.4']; // processing info, compliance evaluation, computers, analyzing data
const BAD_GWAS = ['4.A.3.a.1', '4.A.3.a.2', '4.A.3.a.4', '4.A.4.a.5']; // general physical, handling objects, vehicles, caring for others

function main() {
  const db = openDb();
  db.exec(`CREATE TABLE IF NOT EXISTS design_tasks (
    task_id INTEGER PRIMARY KEY, sample_group TEXT NOT NULL, split TEXT NOT NULL, fit_prior REAL)`);
  const existing = db.prepare('SELECT COUNT(*) n FROM design_tasks').get().n;
  if (existing > 0 && !process.argv.includes('--resample')) {
    console.log(`design_tasks already has ${existing} rows; keeping them (pass --resample to rebuild the sample).`);
    writeLabelerView(db);
    return;
  }

  const wa = db.prepare('SELECT onet_code, element_id, im FROM work_activities WHERE im IS NOT NULL').all();
  const byElement = new Map();
  for (const r of wa) {
    if (!byElement.has(r.element_id)) byElement.set(r.element_id, []);
    byElement.get(r.element_id).push(r.im);
  }
  const stats = new Map([...byElement].map(([k, v]) => {
    const mean = v.reduce((s, x) => s + x, 0) / v.length;
    const sd = Math.sqrt(v.reduce((s, x) => s + (x - mean) ** 2, 0) / v.length);
    return [k, { mean, sd }];
  }));
  const z = (el, v) => (v - stats.get(el).mean) / stats.get(el).sd;
  const imOf = new Map();
  for (const r of wa) imOf.set(`${r.onet_code}|${r.element_id}`, r.im);
  const occs = db.prepare('SELECT DISTINCT onet_code FROM tasks').all().map((r) => r.onet_code);
  const prior = new Map();
  for (const code of occs) {
    const good = GOOD_GWAS.map((el) => imOf.get(`${code}|${el}`)).filter((v) => v !== undefined);
    const bad = BAD_GWAS.map((el) => imOf.get(`${code}|${el}`)).filter((v) => v !== undefined);
    if (good.length < GOOD_GWAS.length || bad.length < BAD_GWAS.length) continue; // no Work Activities data
    const g = GOOD_GWAS.reduce((s, el) => s + z(el, imOf.get(`${code}|${el}`)), 0) / GOOD_GWAS.length;
    const b = BAD_GWAS.reduce((s, el) => s + z(el, imOf.get(`${code}|${el}`)), 0) / BAD_GWAS.length;
    prior.set(code, g - b);
  }
  const ranked = [...prior].sort((a, b) => b[1] - a[1]).map(([code]) => code);
  const q = Math.floor(ranked.length / 4);
  const goodOccs = new Set(ranked.slice(0, q));
  const badOccs = new Set(ranked.slice(-q));

  const anchorIds = new Set([...HIGH_ANCHORS, ...LOW_ANCHORS].map((a) => a.task_id));
  const allTasks = db.prepare('SELECT task_id, onet_code FROM tasks ORDER BY task_id').all();
  const random = rng(SAMPLE_SEED);
  const taken = new Set(anchorIds);
  const perOcc = new Map();
  const draw = (pool, n) => {
    const out = [];
    for (const t of shuffle(pool, random)) {
      if (out.length >= n) break;
      if (taken.has(t.task_id) || (perOcc.get(t.onet_code) || 0) >= MAX_PER_OCCUPATION) continue;
      out.push(t);
      taken.add(t.task_id);
      perOcc.set(t.onet_code, (perOcc.get(t.onet_code) || 0) + 1);
    }
    return out;
  };
  const groups = {
    likely_good: draw(allTasks.filter((t) => goodOccs.has(t.onet_code)), PER_GROUP),
    likely_bad: draw(allTasks.filter((t) => badOccs.has(t.onet_code)), PER_GROUP),
    random: draw(allTasks, PER_GROUP),
    anchor_high: HIGH_ANCHORS.map((a) => ({ task_id: a.task_id, onet_code: a.onet })),
    anchor_low: LOW_ANCHORS.map((a) => ({ task_id: a.task_id, onet_code: a.onet })),
  };

  const ins = db.prepare('INSERT INTO design_tasks (task_id, sample_group, split, fit_prior) VALUES (?, ?, ?, ?)');
  db.transaction(() => {
    db.exec('DELETE FROM design_tasks');
    for (const [group, tasks] of Object.entries(groups)) {
      const order = shuffle(tasks, random);
      const nDev = Math.round(order.length * DEV_SHARE);
      order.forEach((t, i) => ins.run(t.task_id, group, i < nDev ? 'dev' : 'heldout', prior.get(t.onet_code) ?? null));
    }
  })();
  const summary = db.prepare('SELECT sample_group, split, COUNT(*) n FROM design_tasks GROUP BY 1, 2 ORDER BY 1, 2').all();
  console.log(summary);
  setMeta(db, 'design_sample', {
    seed: SAMPLE_SEED, per_group: PER_GROUP, max_per_occupation: MAX_PER_OCCUPATION, dev_share: DEV_SHARE,
    prior: { good_gwas: GOOD_GWAS, bad_gwas: BAD_GWAS, method: 'mean z(IM) of good GWAs minus mean z(IM) of bad GWAs; top and bottom quartile of occupations' },
    occupations_scored: prior.size, good_pool_occupations: goodOccs.size, bad_pool_occupations: badOccs.size, summary,
  });
  writeLabelerView(db);
}

// What labelers (and Jev) see for each task: occupation title and description, the task, and
// the task's O*NET detailed work activities.
export function writeLabelerView(db) {
  const rows = db.prepare(`SELECT d.task_id, t.task, o.onet_code, o.title occupation_title, o.description occupation_description
    FROM design_tasks d JOIN tasks t USING(task_id) JOIN occupations o ON o.onet_code = t.onet_code ORDER BY d.task_id`).all();
  const dwas = db.prepare(`SELECT r.dwa_title FROM task_dwas td JOIN dwa_reference r USING(dwa_id)
    WHERE td.task_id = ? AND td.onet_code = ? ORDER BY r.dwa_id`);
  const view = rows.map((r) => ({ ...r, detailed_work_activities: dwas.all(r.task_id, r.onet_code).map((d) => d.dwa_title) }));
  mkdirSync(resolve(ROOT, 'data', 'labeling'), { recursive: true });
  writeFileSync(resolve(ROOT, 'data', 'labeling', 'labeled_set.json'), `${JSON.stringify(view, null, 1)}\n`);
  console.log(`wrote data/labeling/labeled_set.json (${view.length} tasks)`);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
