// Step D2: run every candidate variant of every concept on every labeled task.
// One Jev call per task carrying all variants; model pinned to jev-1.13.0; stops past $2.
//
//   node src/design/run-variants.js                 -> round 0: all variants, all 270 labeled tasks
//   node src/design/run-variants.js --round 1 --only physical.v4,volume.v4
//                                                   -> a rewrite round: only the named variants, dev tasks only
//   node src/design/run-variants.js --smoke          -> one task, prints the raw response shape
import { openDb, setMeta, getMeta } from '../lib/db.js';
import { JevSession, CostCapError, MissingKeyError, describeError } from '../lib/jev.js';
import { CONCEPTS, COMPOUND_DRAFTS } from '../../config/question_variants.js';
import { buildState } from '../../config/questions.js';

export const DESIGN_CAP_USD = 2;

function arg(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : null;
}

export function variantQuestions(only = null) {
  const qs = {};
  for (const [concept, def] of Object.entries(CONCEPTS)) {
    for (const [v, variant] of Object.entries(def.variants)) {
      const id = `${concept}.${v}`;
      if (!only || only.includes(id)) qs[id.replace('.', '__')] = variant.q;
    }
  }
  if (!only) for (const [concept, d] of Object.entries(COMPOUND_DRAFTS)) qs[`${concept}__draft`] = d.q;
  return qs;
}

async function main() {
  const round = Number(arg('--round') || 0);
  const only = arg('--only') ? arg('--only').split(',') : null;
  const smoke = process.argv.includes('--smoke');
  const db = openDb();
  db.exec(`CREATE TABLE IF NOT EXISTS design_answers (
    task_id INTEGER NOT NULL, round INTEGER NOT NULL, question_ids TEXT NOT NULL, answers_json TEXT NOT NULL,
    model_reported TEXT, request_id TEXT, input_tokens INTEGER, output_tokens INTEGER, answered_at TEXT,
    PRIMARY KEY (task_id, round))`);

  const questions = variantQuestions(only);
  if (only && Object.keys(questions).length !== only.length) throw new Error(`unknown variant in --only: ${only.join(',')}`);
  const tasks = db.prepare(`SELECT d.task_id, d.split, t.task, t.onet_code, o.title occupation_title, o.description occupation_description
    FROM design_tasks d JOIN tasks t USING(task_id) JOIN occupations o ON o.onet_code = t.onet_code
    ${round > 0 ? "WHERE d.split = 'dev'" : ''} ORDER BY d.task_id`).all();
  const dwas = db.prepare(`SELECT r.dwa_title FROM task_dwas td JOIN dwa_reference r USING(dwa_id)
    WHERE td.task_id = ? AND td.onet_code = ? ORDER BY r.dwa_id`);
  const stateOf = (t) => ({ ...buildState(t), detailed_work_activities: dwas.all(t.task_id, t.onet_code).map((d) => d.dwa_title) });

  // Spend so far in this stage counts toward the $2 cap.
  const prior = JSON.parse(getMeta(db, 'design_spend') || '{"input_tokens":0,"output_tokens":0,"cost_usd":0,"requests":0}');
  const session = new JevSession({ capUsd: DESIGN_CAP_USD - prior.cost_usd, label: 'question design' });

  if (smoke) {
    const t = tasks[0];
    const res = await session.ask(stateOf(t), questions);
    console.log(JSON.stringify({ state: stateOf(t), model: res.model, requestId: res.requestId, inputTokens: res.inputTokens,
      questions: Object.keys(questions).length, sample: Object.fromEntries(Object.entries(res.answers).slice(0, 4)) }, null, 1));
    saveSpend(db, prior, session);
    return;
  }

  const done = new Set(db.prepare('SELECT task_id FROM design_answers WHERE round = ?').all(round).map((r) => r.task_id));
  const todo = tasks.filter((t) => !done.has(t.task_id));
  console.log(`round ${round}: ${Object.keys(questions).length} questions per call, ${todo.length} tasks to ask (${done.size} cached); prior stage spend $${prior.cost_usd.toFixed(4)}`);
  const ins = db.prepare(`INSERT OR REPLACE INTO design_answers (task_id, round, question_ids, answers_json, model_reported, request_id,
    input_tokens, output_tokens, answered_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const errors = [];
  await Promise.all(todo.map(async (t) => {
    try {
      const res = await session.ask(stateOf(t), questions);
      ins.run(t.task_id, round, Object.keys(questions).join(','), JSON.stringify(res.answers), res.model, res.requestId,
        res.inputTokens, res.outputTokens, new Date().toISOString());
    } catch (err) {
      if (!(err instanceof CostCapError) && !(err instanceof MissingKeyError)) errors.push({ task_id: t.task_id, ...describeError(err) });
    }
  }));
  const summary = session.summary();
  console.log(JSON.stringify({ round, ...summary, errors: errors.length }, null, 1));
  if (errors.length) console.log('first errors:', errors.slice(0, 3));
  saveSpend(db, prior, session);
  if (session.authFailed) {
    console.error(`STOPPED: ${session.authFailed} Ask the user.`);
    process.exit(3);
  }
  if (session.stopped) {
    console.error(`STOPPED: question-design spend passed $${DESIGN_CAP_USD}. Ask the user before continuing.`);
    process.exit(2);
  }
}

function saveSpend(db, prior, session) {
  const s = session.summary();
  const total = { input_tokens: prior.input_tokens + s.input_tokens, output_tokens: prior.output_tokens + s.output_tokens,
    requests: prior.requests + s.requests, cost_usd: prior.cost_usd + s.cost_usd,
    models_seen: { ...(prior.models_seen || {}) } };
  for (const [m, n] of Object.entries(s.models_seen)) total.models_seen[m] = (total.models_seen[m] || 0) + n;
  setMeta(db, 'design_spend', total);
}

main().catch((err) => {
  console.error(err.stack || err);
  process.exit(1);
});
