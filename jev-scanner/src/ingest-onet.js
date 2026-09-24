// Step 1a: download the latest O*NET database text release and load Occupation Data,
// Task Statements and Task Ratings into SQLite.
//
//   node src/ingest-onet.js [--force]
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { openDb, setMeta, ROOT } from './lib/db.js';
import { downloadFirst, parseTsv, USER_AGENT } from './lib/http.js';
import { listZip, readZipText } from './lib/zip.js';

const DATABASE_PAGE = 'https://www.onetcenter.org/database.html';
const FILES = {
  occupations: 'Occupation Data.txt',
  tasks: 'Task Statements.txt',
  ratings: 'Task Ratings.txt',
  // Added in the question-design stage (see QUESTION_DESIGN.md, Step A).
  workContext: 'Work Context.txt',
  workActivities: 'Work Activities.txt',
  taskDwas: 'Tasks to DWAs.txt',
  dwaReference: 'GWAs to IWAs to DWAs.txt',
};
// Columns this script needs, checked against each file's real header row before loading.
const REQUIRED = {
  occupations: ['O*NET-SOC Code', 'Title', 'Description'],
  tasks: ['O*NET-SOC Code', 'Task ID', 'Task', 'Task Type', 'Incumbents Responding', 'Date', 'Domain Source'],
  ratings: ['O*NET-SOC Code', 'Task ID', 'Scale ID', 'Category', 'Data Value', 'N', 'Standard Error',
    'Lower CI Bound', 'Upper CI Bound', 'Recommend Suppress', 'Date', 'Domain Source'],
  workContext: ['O*NET-SOC Code', 'Element ID', 'Element Name', 'Scale ID', 'Category', 'Data Value', 'N', 'Recommend Suppress'],
  workActivities: ['O*NET-SOC Code', 'Element ID', 'Element Name', 'Scale ID', 'Data Value'],
  taskDwas: ['O*NET-SOC Code', 'Task ID', 'DWA Element ID'],
  dwaReference: ['GWA Element ID', 'IWA Element ID', 'DWA Element ID', 'DWA Element Name'],
};

async function findLatestRelease() {
  const res = await fetch(DATABASE_PAGE, { headers: { 'User-Agent': USER_AGENT } });
  if (!res.ok) throw new Error(`${DATABASE_PAGE} -> HTTP ${res.status}`);
  const html = await res.text();
  const versions = [...html.matchAll(/O\*NET (\d+)\.(\d+) Database/g)].map((m) => [Number(m[1]), Number(m[2])]);
  if (!versions.length) throw new Error('Could not find a release version on the O*NET database page');
  versions.sort((a, b) => b[0] - a[0] || b[1] - a[1]);
  const [major, minor] = versions[0];
  return { version: `${major}.${minor}`, slug: `db_${major}_${minor}` };
}

function requireColumns(kind, header) {
  const missing = REQUIRED[kind].filter((c) => !header.includes(c));
  if (missing.length) throw new Error(`${FILES[kind]} is missing expected columns: ${missing.join(', ')}. Header: ${header.join(' | ')}`);
}

const num = (v) => (v === undefined || v === '' || v === 'n/a' ? null : Number(v));

async function main() {
  const force = process.argv.includes('--force');
  const { version, slug } = await findLatestRelease();
  const zipName = `${slug}_text.zip`;
  const routes = [
    { url: `https://www.onetcenter.org/dl_files/database/${zipName}` },
    // Same release, served from the archive path, if the current path moves.
    { url: `https://www.onetcenter.org/dl_files/database/archive/${zipName}` },
  ];
  const isZip = (buf) => buf.length > 1000 && buf.readUInt32LE(0) === 0x04034b50;
  const dl = await downloadFirst(routes, resolve(ROOT, 'data', 'raw', zipName), { validate: isZip, force });
  const buf = dl.buf;
  const sha256 = createHash('sha256').update(buf).digest('hex');
  const readme = readZipText(buf, 'Read Me.txt').replace(/\r/g, '');
  const releaseLine = readme.split('\n').find((l) => /Release/i.test(l)) || '';
  console.log(`O*NET ${version} (${releaseLine.trim()}), ${zipName}, ${buf.length} bytes${dl.fromCache ? ' (cached)' : ''}`);
  console.log(`  entries: ${listZip(buf).length}`);

  const parsed = {};
  for (const [kind, file] of Object.entries(FILES)) {
    parsed[kind] = parseTsv(readZipText(buf, file));
    requireColumns(kind, parsed[kind].header);
    console.log(`  ${file}: ${parsed[kind].rows.length} rows; header = ${parsed[kind].header.join(' | ')}`);
  }

  const db = openDb();
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS task_ratings_uniq ON task_ratings(onet_code, task_id, scale_id, category)');

  const upsertOcc = db.prepare(`
    INSERT INTO occupations (onet_code, title, description) VALUES (@code, @title, @description)
    ON CONFLICT(onet_code) DO UPDATE SET title = excluded.title, description = excluded.description`);
  const upsertTask = db.prepare(`
    INSERT INTO tasks (task_id, onet_code, task, task_type, incumbents_responding, date, domain_source)
    VALUES (@task_id, @onet_code, @task, @task_type, @incumbents, @date, @domain_source)
    ON CONFLICT(task_id) DO UPDATE SET onet_code = excluded.onet_code, task = excluded.task,
      task_type = excluded.task_type, incumbents_responding = excluded.incumbents_responding,
      date = excluded.date, domain_source = excluded.domain_source`);
  const upsertRating = db.prepare(`
    INSERT OR REPLACE INTO task_ratings (onet_code, task_id, scale_id, category, data_value, n, standard_error,
      lower_ci, upper_ci, recommend_suppress, date, domain_source)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);

  db.transaction(() => {
    for (const r of parsed.occupations.rows) {
      upsertOcc.run({ code: r['O*NET-SOC Code'], title: r.Title, description: r.Description });
    }
    for (const r of parsed.tasks.rows) {
      upsertTask.run({
        task_id: Number(r['Task ID']), onet_code: r['O*NET-SOC Code'], task: r.Task, task_type: r['Task Type'],
        incumbents: num(r['Incumbents Responding']), date: r.Date, domain_source: r['Domain Source'],
      });
    }
    for (const r of parsed.ratings.rows) {
      upsertRating.run(r['O*NET-SOC Code'], Number(r['Task ID']), r['Scale ID'], r.Category, num(r['Data Value']),
        num(r.N), num(r['Standard Error']), num(r['Lower CI Bound']), num(r['Upper CI Bound']),
        r['Recommend Suppress'], r.Date, r['Domain Source']);
    }
    // Importance (IM, 1-5) and relevance (RT, percent) onto each task.
    // Frequency (FT) is published as the percent of incumbents in each of 7 categories; store
    // the expected category, 1 = yearly or less ... 7 = hourly or more.
    db.exec(`
      UPDATE tasks SET
        importance = (SELECT data_value FROM task_ratings r WHERE r.task_id = tasks.task_id AND r.onet_code = tasks.onet_code AND r.scale_id = 'IM'),
        relevance  = (SELECT data_value FROM task_ratings r WHERE r.task_id = tasks.task_id AND r.onet_code = tasks.onet_code AND r.scale_id = 'RT'),
        frequency  = (SELECT SUM(CAST(r.category AS REAL) * r.data_value) / NULLIF(SUM(r.data_value), 0)
                      FROM task_ratings r WHERE r.task_id = tasks.task_id AND r.onet_code = tasks.onet_code AND r.scale_id = 'FT')`);

    // Work Context: keep the mean scales (CX 1-5, CT 1-3), not the per-category percentages.
    const insWc = db.prepare(`INSERT OR REPLACE INTO work_context (onet_code, element_id, element_name, scale_id, data_value, n, recommend_suppress)
      VALUES (?, ?, ?, ?, ?, ?, ?)`);
    for (const r of parsed.workContext.rows) {
      if (r['Scale ID'] !== 'CX' && r['Scale ID'] !== 'CT') continue;
      insWc.run(r['O*NET-SOC Code'], r['Element ID'], r['Element Name'], r['Scale ID'], num(r['Data Value']), num(r.N), r['Recommend Suppress']);
    }
    // Work Activities: importance and level per occupation.
    const insWa = db.prepare(`INSERT INTO work_activities (onet_code, element_id, element_name, im, lv) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(onet_code, element_id) DO UPDATE SET element_name = excluded.element_name,
        im = COALESCE(excluded.im, work_activities.im), lv = COALESCE(excluded.lv, work_activities.lv)`);
    for (const r of parsed.workActivities.rows) {
      const v = num(r['Data Value']);
      insWa.run(r['O*NET-SOC Code'], r['Element ID'], r['Element Name'], r['Scale ID'] === 'IM' ? v : null, r['Scale ID'] === 'LV' ? v : null);
    }
    const insDwaRef = db.prepare('INSERT OR REPLACE INTO dwa_reference (dwa_id, dwa_title, iwa_id, gwa_id) VALUES (?, ?, ?, ?)');
    for (const r of parsed.dwaReference.rows) {
      insDwaRef.run(r['DWA Element ID'], r['DWA Element Name'], r['IWA Element ID'], r['GWA Element ID']);
    }
    const insTaskDwa = db.prepare('INSERT OR IGNORE INTO task_dwas (task_id, onet_code, dwa_id) VALUES (?, ?, ?)');
    for (const r of parsed.taskDwas.rows) insTaskDwa.run(Number(r['Task ID']), r['O*NET-SOC Code'], r['DWA Element ID']);
  })();

  const counts = db.prepare(`SELECT
      (SELECT COUNT(*) FROM occupations) occupations,
      (SELECT COUNT(*) FROM tasks) tasks,
      (SELECT COUNT(*) FROM task_ratings) ratings,
      (SELECT COUNT(*) FROM tasks WHERE importance IS NOT NULL AND relevance IS NOT NULL) tasks_rated,
      (SELECT COUNT(*) FROM tasks WHERE frequency IS NOT NULL) tasks_with_frequency,
      (SELECT COUNT(DISTINCT onet_code) FROM tasks) occupations_with_tasks,
      (SELECT COUNT(*) FROM work_context) work_context_rows,
      (SELECT COUNT(DISTINCT onet_code) FROM work_context) occupations_with_work_context,
      (SELECT COUNT(*) FROM work_activities) work_activity_rows,
      (SELECT COUNT(*) FROM dwa_reference) dwas,
      (SELECT COUNT(*) FROM task_dwas) task_dwa_links,
      (SELECT COUNT(DISTINCT task_id) FROM task_dwas) tasks_with_dwas`).get();
  console.log('  loaded:', counts);

  setMeta(db, 'onet', {
    version, release: releaseLine.trim(), zip: zipName, url: dl.route ? dl.route.url : routes[0].url,
    database_page: DATABASE_PAGE, bytes: buf.length, sha256, downloaded_at: new Date().toISOString(),
    from_cache: dl.fromCache, attempts: dl.attempts,
    headers: Object.fromEntries(Object.entries(parsed).map(([k, v]) => [FILES[k], v.header])),
    counts,
  });
  db.close();
}

main().catch((err) => {
  console.error(err.stack || err);
  process.exit(1);
});
