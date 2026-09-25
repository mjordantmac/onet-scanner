// Step 3/5: ask Jev the final question set about O*NET tasks and cache every answer in SQLite.
//
//   node src/jev-score.js --pilot          the 30 anchors + 120 seeded random tasks
//   node src/jev-score.js --all            every task
//   node src/jev-score.js --all --limit N  at most N not-yet-answered tasks (task_id order)
//
// Answers are cached by task ID + question-set hash (wording + model + state layout), so re-running
// only asks what is missing, and a wording change re-asks everything under a new hash. Each row keeps
// the model version Jev reported, the request ID, token counts and a timestamp.
// Rate: ~15 requests/s with 8 in flight. Cost: $0.042 per million input tokens, counted across all
// scoring runs; the run stops once the total passes $10 (exit code 2: ask the owner before going on).
// Use the npm scripts (npm run pilot / npm run score:all): they set NODE_USE_ENV_PROXY=1, which the
// environment-credential key path needs.
import { openDb, setMeta } from './lib/db.js';
import { JevSession, CostCapError, MissingKeyError, describeError, costOf } from './lib/jev.js';
import { rng, shuffle } from './lib/rng.js';
import {
  QUESTIONS, QUESTION_SET_LABEL, STATE_VERSION, SELECTED, SCORE_IDS, buildState, questionSetHash, jevConceptValues,
} from '../config/questions.js';
import { MODEL, RATE, COST, PILOT } from '../config/weights.js';
import { ANCHOR_IDS } from '../config/anchors.js';

function arg(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : null;
}

// Concept columns in jev_answers that hold one number each (the rest of the answer is in answers_json).
const NUMBER_COLUMNS = ['reads_text', 'closed_outcome', 'writes_content', 'physical', 'live_human', 'same_rules',
  'errors_lose_money', 'loss_recoverable', 'outcome_visible', 'speed_value', 'digital_input', 'licensed_signoff',
  'time_per_item', 'volume', 'money_link'];

function selectTasks(db, mode) {
  const all = db.prepare(`SELECT t.task_id, t.task, t.onet_code, o.title occupation_title, o.description occupation_description
    FROM tasks t JOIN occupations o ON o.onet_code = t.onet_code ORDER BY t.task_id`).all();
  if (mode !== 'pilot') return all;
  const anchors = new Set(ANCHOR_IDS);
  const rest = shuffle(all.filter((t) => !anchors.has(t.task_id)), rng(PILOT.seed)).slice(0, PILOT.randomTasks);
  return [...all.filter((t) => anchors.has(t.task_id)), ...rest];
}

function dwaMap(db) {
  const m = new Map();
  for (const r of db.prepare(`SELECT td.task_id, r.dwa_title FROM task_dwas td JOIN dwa_reference r USING(dwa_id)
    ORDER BY td.task_id, r.dwa_id`).all()) {
    if (!m.has(r.task_id)) m.set(r.task_id, []);
    m.get(r.task_id).push(r.dwa_title);
  }
  return m;
}

async function main() {
  const mode = process.argv.includes('--pilot') ? 'pilot' : 'all';
  if (!process.argv.includes('--pilot') && !process.argv.includes('--all') && !arg('--limit')) {
    console.error('usage: node src/jev-score.js --pilot | --all [--limit N]');
    process.exit(1);
  }
  const limit = arg('--limit') ? Number(arg('--limit')) : null;
  const db = openDb();
  const qsetHash = questionSetHash(MODEL);
  db.prepare('INSERT OR IGNORE INTO question_sets (qset_hash, label, created_at, questions_json) VALUES (?, ?, ?, ?)')
    .run(qsetHash, QUESTION_SET_LABEL, new Date().toISOString(), JSON.stringify({ model: MODEL, state: STATE_VERSION, selected: SELECTED, questions: QUESTIONS }));

  const tasks = selectTasks(db, mode);
  const cached = new Set(db.prepare('SELECT task_id FROM jev_answers WHERE qset_hash = ?').all(qsetHash).map((r) => r.task_id));
  let todo = tasks.filter((t) => !cached.has(t.task_id));
  if (limit != null) todo = todo.slice(0, limit);
  const dwas = dwaMap(db);

  // The $10 cap covers every scoring run, not just this one.
  const prior = db.prepare("SELECT COALESCE(SUM(cost_usd), 0) c FROM runs WHERE mode IN ('pilot', 'all')").get().c;
  const modeLabel = limit != null ? `${mode} --limit ${limit}` : mode;
  const runId = db.prepare(`INSERT INTO runs (mode, qset_hash, model, started_at, tasks_planned, tasks_cached, status)
    VALUES (?, ?, ?, ?, ?, ?, 'running')`).run(mode, qsetHash, MODEL, new Date().toISOString(), todo.length, tasks.length - todo.length).lastInsertRowid;
  console.log(`run ${runId} (${modeLabel}): question set ${qsetHash} (${Object.keys(QUESTIONS).length} questions, ${MODEL}); `
    + `${tasks.length} tasks selected, ${tasks.length - todo.length} cached, ${todo.length} to ask; prior scoring spend $${prior.toFixed(4)} of $${COST.capUsd}`);
  if (prior >= COST.capUsd) {
    db.prepare("UPDATE runs SET status = 'stopped_cost_cap', finished_at = ? WHERE run_id = ?").run(new Date().toISOString(), runId);
    console.error(`STOPPED: scoring spend is already $${prior.toFixed(4)}, at or past the $${COST.capUsd} cap. Ask the owner before continuing.`);
    process.exit(2);
  }

  const session = new JevSession({ capUsd: COST.capUsd - prior, label: `run ${runId}` });
  const scoreCols = SCORE_IDS.map((id) => `${id}_conf`);
  const cols = ['task_id', 'qset_hash', 'model_requested', 'model_reported', 'request_id', 'input_tokens', 'output_tokens',
    'answered_at', 'run_id', 'answers_json', ...NUMBER_COLUMNS, ...scoreCols, 'min_score_conf', 'buyer', 'buyer_conf', 'sell_model', 'sell_model_conf'];
  const insert = db.prepare(`INSERT OR REPLACE INTO jev_answers (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`);
  const logError = db.prepare('INSERT INTO request_errors (run_id, task_id, at, status, request_id, message) VALUES (?, ?, ?, ?, ?, ?)');
  const updateRun = db.prepare(`UPDATE runs SET requests_ok = ?, requests_failed = ?, input_tokens = ?, output_tokens = ?, cost_usd = ?,
    status = ?, finished_at = ?, notes = ? WHERE run_id = ?`);

  const save = (t, res) => {
    const v = jevConceptValues(res.answers);
    const confs = SCORE_IDS.map((id) => res.answers[id]?.confidence ?? null);
    const known = confs.filter((c) => c != null);
    const row = {
      task_id: t.task_id, qset_hash: qsetHash, model_requested: MODEL, model_reported: res.model, request_id: res.requestId,
      input_tokens: res.inputTokens, output_tokens: res.outputTokens, answered_at: new Date().toISOString(), run_id: runId,
      answers_json: JSON.stringify(res.answers),
      min_score_conf: known.length ? Math.min(...known) : null,
      buyer: v.buyer?.choice ?? null, buyer_conf: v.buyer?.confidence ?? null,
      sell_model: v.sell_model?.choice ?? null, sell_model_conf: v.sell_model?.confidence ?? null,
    };
    for (const c of NUMBER_COLUMNS) row[c] = typeof v[c] === 'number' ? v[c] : null;
    SCORE_IDS.forEach((id, i) => { row[`${id}_conf`] = confs[i]; });
    insert.run(...cols.map((c) => row[c]));
  };

  let interrupted = false;
  process.on('SIGINT', () => { interrupted = true; console.log('\ninterrupt: finishing requests in flight, then stopping'); });

  const started = Date.now();
  let done = 0;
  const failed = [];
  const progress = () => {
    const s = session.summary();
    const secs = (Date.now() - started) / 1000;
    const rate = s.requests / Math.max(secs, 1e-9);
    const left = todo.length - done;
    console.log(`[run ${runId}] ${done}/${todo.length} tasks | ${rate.toFixed(1)} req/s | ${(s.input_tokens / 1e6).toFixed(2)}M input tokens | `
      + `$${s.cost_usd.toFixed(4)} this run, $${(prior + s.cost_usd).toFixed(4)} total | ${failed.length} failed | ETA ${rate ? Math.ceil(left / rate / 60) : '?'} min`);
  };
  const halted = () => interrupted || session.stopped || session.authFailed;

  const work = async (queue, onFail) => {
    const worker = async () => {
      while (queue.length && !halted()) {
        const t = queue.shift();
        try {
          const res = await session.ask(buildState({ ...t, detailed_work_activities: dwas.get(t.task_id) || [] }), QUESTIONS);
          save(t, res);
          done += 1;
          if (done % RATE.logEvery === 0) progress();
        } catch (err) {
          if (err instanceof CostCapError || err instanceof MissingKeyError) return;
          const e = describeError(err);
          logError.run(runId, t.task_id, new Date().toISOString(), e.status, e.requestId, e.message);
          onFail(t, e);
        }
      }
    };
    await Promise.all(Array.from({ length: RATE.maxInFlight }, worker));
  };

  await work([...todo], (t) => failed.push(t));
  // One more pass for requests that failed after the SDK's own retries (timeouts, 429s, 5xx).
  const retry = failed.splice(0);
  if (retry.length && !halted()) {
    console.log(`retrying ${retry.length} failed tasks once`);
    await work(retry, (t) => failed.push(t));
  }
  progress();

  const s = session.summary();
  const status = session.authFailed ? 'stopped_auth' : session.stopped ? 'stopped_cost_cap' : interrupted ? 'interrupted'
    : failed.length ? 'finished_with_failures' : 'finished';
  const notes = { mode: modeLabel, auth_mode: s.auth_mode, models_seen: s.models_seen, failed_task_ids: failed.map((t) => t.task_id).slice(0, 200),
    seconds: Math.round((Date.now() - started) / 1000), usd_per_million_input_tokens: COST.usdPerMillionInputTokens };
  updateRun.run(s.requests, s.failures, s.input_tokens, s.output_tokens, costOf(s.input_tokens, s.output_tokens), status,
    new Date().toISOString(), JSON.stringify(notes), runId);
  setMeta(db, 'last_scoring_run', { run_id: runId, status, ...notes, requests: s.requests, input_tokens: s.input_tokens, cost_usd: s.cost_usd });
  const answered = db.prepare('SELECT COUNT(*) n FROM jev_answers WHERE qset_hash = ?').get(qsetHash).n;
  console.log(`run ${runId} ${status}: ${s.requests} requests, ${s.failures} failed attempts, ${failed.length} tasks still unanswered, `
    + `models ${JSON.stringify(s.models_seen)}; ${answered} tasks answered under ${qsetHash}`);
  db.pragma('wal_checkpoint(TRUNCATE)');

  if (session.authFailed) { console.error(`STOPPED: ${session.authFailed} Ask the owner.`); process.exit(3); }
  if (session.stopped) {
    console.error(`STOPPED: scoring spend passed the $${COST.capUsd} cap ($${(prior + s.cost_usd).toFixed(4)}). Ask the owner before continuing.`);
    process.exit(2);
  }
  if (failed.length) console.log(`${failed.length} tasks failed twice; run the same command again to retry them.`);
}

main().catch((err) => {
  console.error(err.stack || err);
  process.exit(1);
});
