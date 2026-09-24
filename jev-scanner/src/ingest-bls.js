// Step 1b: download the latest BLS OEWS national estimates (employment and wages by occupation),
// join them to O*NET occupations, and give every task a labor_value.
//
//   node src/ingest-bls.js [--force]
//
// Run src/ingest-onet.js first.
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { openDb, setMeta, ROOT } from './lib/db.js';
import { downloadFirst, USER_AGENT } from './lib/http.js';
import { listZip, readZipEntry } from './lib/zip.js';
import { readFirstSheet } from './lib/xlsx.js';

const OES_SERVICES = 'https://data.bls.gov/OESServices';
const HOURS_PER_YEAR = 2080; // BLS convention for converting hourly to annual wages

// OEWS query-service datatype codes (from /OESServices/combo/datatype).
const DT = { employment: '01', hourlyMean: '03', annualMean: '04', hourlyMedian: '08', annualMedian: '13' };

async function postJson(path, body) {
  const res = await fetch(`${OES_SERVICES}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': USER_AGENT },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${path} -> HTTP ${res.status}`);
  return res.json();
}

// Latest OEWS release, e.g. { releaseDate: '2025A01', description: 'May 2025' }.
async function latestRelease() {
  const years = await postJson('/combo/year', {
    areaCodes: ['0000000'], industryCodes: ['000000'], occupationCodes: ['000000'],
    occupationExclude: false, datatypeCodes: [DT.employment],
  });
  const latest = years[0];
  const yy = latest.releaseDate.slice(2, 4);
  return { ...latest, zipName: `oesm${yy}nat.zip` };
}

const toNum = (raw) => {
  const s = String(raw ?? '').trim().replace(/,/g, '');
  return s !== '' && /^-?\d+(\.\d+)?$/.test(s) ? Number(s) : null;
};

// Route A: the official national file (zip holding one .xlsx). Returns normalized rows.
function rowsFromNationalZip(buf) {
  const xlsxEntry = listZip(buf).find((e) => /\.xlsx$/i.test(e.name));
  if (!xlsxEntry) throw new Error('No .xlsx inside the OEWS national zip');
  const table = readFirstSheet(readZipEntry(buf, xlsxEntry));
  const header = table[0].map((h) => String(h).trim().toUpperCase());
  const col = (name) => {
    const i = header.indexOf(name);
    if (i < 0) throw new Error(`OEWS national file has no ${name} column. Header: ${header.join(' | ')}`);
    return i;
  };
  const c = { code: col('OCC_CODE'), title: col('OCC_TITLE'), group: col('O_GROUP'), emp: col('TOT_EMP'),
    aMean: col('A_MEAN'), aMedian: col('A_MEDIAN'), hMean: col('H_MEAN'), hMedian: col('H_MEDIAN') };
  const levelOf = { total: 0, major: 0, minor: 1, broad: 2, detailed: 3 };
  return {
    header,
    rows: table.slice(1).filter((r) => r[c.code]).map((r) => ({
      bls_code: r[c.code], title: r[c.title], display_level: levelOf[String(r[c.group]).toLowerCase()] ?? null,
      employment_raw: r[c.emp], annual_mean_raw: r[c.aMean], annual_median_raw: r[c.aMedian],
      hourly_mean_raw: r[c.hMean], hourly_median_raw: r[c.hMedian],
    })),
  };
}

// Route B: the same national estimates from BLS's OEWS query service (data.bls.gov/oes).
function rowsFromQueryService(json, occList) {
  const level = Object.fromEntries(occList.map((o) => [o.formattedOccupationCode, o.displayLevel]));
  const byCode = new Map();
  for (const r of json) {
    const code = r.formattedOccupationCode;
    if (!byCode.has(code)) byCode.set(code, { bls_code: code, title: r.occupationName, display_level: level[code] ?? null });
    const row = byCode.get(code);
    const v = String(r.value).trim();
    if (r.datatypeCode === DT.employment) row.employment_raw = v;
    if (r.datatypeCode === DT.annualMean) row.annual_mean_raw = v;
    if (r.datatypeCode === DT.annualMedian) row.annual_median_raw = v;
    if (r.datatypeCode === DT.hourlyMean) row.hourly_mean_raw = v;
    if (r.datatypeCode === DT.hourlyMedian) row.hourly_median_raw = v;
  }
  return { header: ['query-service JSON: formattedOccupationCode, occupationName, datatypeCode, value, footnoteCodes'], rows: [...byCode.values()] };
}

async function main() {
  const force = process.argv.includes('--force');
  const release = await latestRelease();
  console.log(`Latest OEWS release: ${release.description} (${release.releaseDate})`);

  const rawDir = resolve(ROOT, 'data', 'raw');
  const zipRoutes = [
    { url: `https://www.bls.gov/oes/special-requests/${release.zipName}` },
    { url: `https://www.bls.gov/oes/special.requests/${release.zipName}` },
  ];
  const tablePayload = {
    areaCodes: ['0000000'], industryCodes: ['000000'], occupationCodes: [], occupationExclude: true,
    datatypeCodes: [DT.employment, DT.hourlyMean, DT.annualMean, DT.hourlyMedian, DT.annualMedian],
    releaseDates: [release.releaseDate], tableSuffix: 'pub', userId: '', pwd: '',
  };
  const serviceRoutes = [{
    url: `${OES_SERVICES}/combo/table`, method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(tablePayload),
  }];

  let source;
  let parsed;
  let buf;
  let attempts = [];
  try {
    const isZip = (b) => b.length > 1000 && b.readUInt32LE(0) === 0x04034b50;
    const dl = await downloadFirst(zipRoutes, resolve(rawDir, release.zipName), { validate: isZip, force });
    attempts = dl.attempts;
    buf = dl.buf;
    parsed = rowsFromNationalZip(buf);
    source = { kind: 'national_zip', url: dl.route ? dl.route.url : zipRoutes[0].url, from_cache: dl.fromCache };
  } catch (err) {
    console.log(`  Official national zip unavailable, using the OEWS query service instead:\n  ${String(err.message).split('\n').join('\n  ')}`);
    attempts = err.attempts || [{ error: String(err.message) }];
    const isJsonArray = (b) => { try { return Array.isArray(JSON.parse(b.toString('utf8'))); } catch { return false; } };
    const dest = resolve(rawDir, `oews_${release.releaseDate}_national_query_service.json`);
    const dl = await downloadFirst(serviceRoutes, dest, { validate: isJsonArray, force });
    attempts.push(...dl.attempts);
    buf = dl.buf;
    const occList = await postJson('/combo/occ', { areaCodes: ['0000000'], industryCodes: ['000000'] });
    parsed = rowsFromQueryService(JSON.parse(buf.toString('utf8')), occList);
    source = { kind: 'oews_query_service', url: `${OES_SERVICES}/combo/table`, method: 'POST', payload: tablePayload,
      tool: 'https://data.bls.gov/oes/', from_cache: dl.fromCache };
  }
  console.log(`  source: ${source.kind} ${source.url}; ${parsed.rows.length} occupation rows`);

  const db = openDb();
  const upsertBls = db.prepare(`
    INSERT INTO bls_oews (bls_code, title, display_level, employment, annual_mean, annual_median,
      employment_raw, annual_mean_raw, annual_median_raw)
    VALUES (@bls_code, @title, @display_level, @employment, @annual_mean, @annual_median,
      @employment_raw, @annual_mean_raw, @annual_median_raw)
    ON CONFLICT(bls_code) DO UPDATE SET title = excluded.title, display_level = excluded.display_level,
      employment = excluded.employment, annual_mean = excluded.annual_mean, annual_median = excluded.annual_median,
      employment_raw = excluded.employment_raw, annual_mean_raw = excluded.annual_mean_raw,
      annual_median_raw = excluded.annual_median_raw`);

  // Annual median; else hourly median x 2080 (occupations BLS reports hourly only); else means.
  const bls = new Map();
  for (const r of parsed.rows) {
    let wage = toNum(r.annual_median_raw);
    let wageSource = 'annual_median';
    if (wage === null && toNum(r.hourly_median_raw) !== null) { wage = toNum(r.hourly_median_raw) * HOURS_PER_YEAR; wageSource = 'hourly_median_x2080'; }
    if (wage === null && toNum(r.annual_mean_raw) !== null) { wage = toNum(r.annual_mean_raw); wageSource = 'annual_mean'; }
    if (wage === null && toNum(r.hourly_mean_raw) !== null) { wage = toNum(r.hourly_mean_raw) * HOURS_PER_YEAR; wageSource = 'hourly_mean_x2080'; }
    bls.set(r.bls_code, { ...r, employment: toNum(r.employment_raw), wage, wageSource });
  }
  db.transaction(() => {
    for (const r of bls.values()) {
      upsertBls.run({ bls_code: r.bls_code, title: r.title, display_level: r.display_level ?? null, employment: r.employment,
        annual_mean: toNum(r.annual_mean_raw), annual_median: toNum(r.annual_median_raw),
        employment_raw: r.employment_raw ?? null, annual_mean_raw: r.annual_mean_raw ?? null,
        annual_median_raw: r.annual_median_raw ?? null });
    }
  })();

  // ---- Join O*NET occupations to BLS rows ---------------------------------------------------
  // Levels come from the SOC code itself (BLS's displayLevel is tree indentation, not hierarchy):
  // XX-0000 major, XX-X000 minor, XX-XXX0 broad, anything else detailed.
  const socLevel = (code) => (code.endsWith('0000') ? 0 : code.endsWith('000') ? 1 : code.endsWith('0') ? 2 : 3);
  const occs = db.prepare(`SELECT o.onet_code, (SELECT COUNT(*) FROM tasks t WHERE t.onet_code = o.onet_code) n_tasks
                           FROM occupations o`).all();

  const assign = new Map(); // onet_code -> { bls_code, match, pool, wage, wageSource }
  // Pass 1: exact matches on the first 7 characters (13-2011.01 -> 13-2011).
  const exactlyMatched = new Set();
  for (const o of occs) {
    const code7 = o.onet_code.slice(0, 7);
    const row = bls.get(code7);
    if (row && socLevel(code7) === 3 && row.employment !== null) {
      assign.set(o.onet_code, { bls_code: code7, match: 'exact', pool: row.employment, wage: row.wage, wageSource: row.wageSource });
      exactlyMatched.add(code7);
    }
  }
  // Employment already claimed by exact matches (and by broad fallbacks, for minor groups).
  const claimedBroad = (prefix6) => [...exactlyMatched].filter((c) => c.startsWith(prefix6))
    .reduce((s, c) => s + bls.get(c).employment, 0);
  // Pass 2: broader group, using only the part of the group not already claimed. OEWS publishes
  // some merged codes (e.g. 21-1018 = O*NET 21-1011 + 21-1014); the broad residual recovers them.
  const broadUsed = new Map();
  for (const o of occs) {
    if (assign.has(o.onet_code)) continue;
    const code7 = o.onet_code.slice(0, 7);
    const broad = bls.get(`${code7.slice(0, 6)}0`);
    if (broad && broad.employment !== null) {
      const residual = broad.employment - claimedBroad(code7.slice(0, 6));
      if (residual > 0) {
        assign.set(o.onet_code, { bls_code: broad.bls_code, match: 'broad_residual', pool: residual, wage: broad.wage, wageSource: broad.wageSource });
        broadUsed.set(broad.bls_code, residual);
      }
    }
  }
  // Pass 3: minor group residual, for codes with no broad group published (e.g. 11-1031 Legislators).
  for (const o of occs) {
    if (assign.has(o.onet_code)) continue;
    const code7 = o.onet_code.slice(0, 7);
    const minor = bls.get(`${code7.slice(0, 5)}00`);
    if (minor && minor.employment !== null) {
      const prefix4 = code7.slice(0, 4);
      const claimed = [...exactlyMatched].filter((c) => c.startsWith(prefix4)).reduce((s, c) => s + bls.get(c).employment, 0)
        + [...broadUsed].filter(([c]) => c.startsWith(prefix4)).reduce((s, [, v]) => s + v, 0);
      const residual = minor.employment - claimed;
      if (residual > 0) {
        assign.set(o.onet_code, { bls_code: minor.bls_code, match: 'minor_residual', pool: residual, wage: minor.wage, wageSource: minor.wageSource });
        continue;
      }
    }
    assign.set(o.onet_code, { bls_code: null, match: 'unmatched', pool: null, wage: null, wageSource: null });
  }
  // Several O*NET occupations can map to one BLS row (e.g. 15-1299.01 ... .09 -> 15-1299).
  // Split that row's employment evenly among the ones that have tasks, so the wage bill is not
  // counted more than once.
  const sharers = new Map();
  for (const o of occs) {
    const a = assign.get(o.onet_code);
    if (!a.bls_code) continue;
    const key = `${a.match}:${a.bls_code}`;
    if (!sharers.has(key)) sharers.set(key, { withTasks: 0, all: 0 });
    sharers.get(key).all += 1;
    if (o.n_tasks > 0) sharers.get(key).withTasks += 1;
  }

  const updOcc = db.prepare(`UPDATE occupations SET bls_code = ?, bls_match = ?, bls_shared_by = ?, employment = ?,
    median_wage = ?, wage_source = ?, wage_bill = ?, share_method = ? WHERE onet_code = ?`);
  const tasksOf = db.prepare('SELECT task_id, importance, relevance FROM tasks WHERE onet_code = ?');
  const updTask = db.prepare('UPDATE tasks SET weight = ?, share = ?, labor_value = ? WHERE task_id = ?');

  db.transaction(() => {
    for (const o of occs) {
      const a = assign.get(o.onet_code);
      let employment = null;
      let sharedBy = null;
      if (a.bls_code && a.pool !== null) {
        const s = sharers.get(`${a.match}:${a.bls_code}`);
        // The pool goes to the sharers that have tasks; a task-less sharer only gets a slice when
        // none of its siblings has tasks. Either way the pool is counted once.
        if (s.withTasks > 0) {
          sharedBy = s.withTasks;
          employment = o.n_tasks > 0 ? a.pool / sharedBy : 0;
        } else {
          sharedBy = s.all;
          employment = a.pool / sharedBy;
        }
      }
      const wageBill = employment !== null && a.wage !== null ? employment * a.wage : null;

      // Task shares: importance x relevance, normalized within the occupation.
      const tasks = tasksOf.all(o.onet_code);
      const rated = tasks.filter((t) => t.importance !== null && t.relevance !== null);
      let method = null;
      if (tasks.length) {
        if (rated.length === 0) method = 'equal';
        else if (rated.length < tasks.length) method = 'ratings_imputed';
        else method = 'ratings';
      }
      const meanRated = rated.length ? rated.reduce((s, t) => s + t.importance * (t.relevance / 100), 0) / rated.length : 1;
      const weights = tasks.map((t) => (method === 'equal' ? 1
        : t.importance !== null && t.relevance !== null ? t.importance * (t.relevance / 100) : meanRated));
      const total = weights.reduce((s, w) => s + w, 0);
      tasks.forEach((t, i) => {
        const share = total > 0 ? weights[i] / total : 1 / tasks.length;
        updTask.run(weights[i], share, wageBill !== null ? share * wageBill : null, t.task_id);
      });
      updOcc.run(a.bls_code, a.match, sharedBy, employment, a.wage, a.wageSource, wageBill, method, o.onet_code);
    }
  })();

  const summary = {
    occupations_by_match: db.prepare('SELECT bls_match, COUNT(*) n, SUM(CASE WHEN onet_code IN (SELECT onet_code FROM tasks) THEN 1 ELSE 0 END) with_tasks FROM occupations GROUP BY bls_match').all(),
    tasks_with_labor_value: db.prepare('SELECT COUNT(*) n FROM tasks WHERE labor_value IS NOT NULL').get().n,
    tasks_without_labor_value: db.prepare('SELECT COUNT(*) n FROM tasks WHERE labor_value IS NULL').get().n,
    share_methods: db.prepare('SELECT share_method, COUNT(*) n FROM occupations WHERE share_method IS NOT NULL GROUP BY share_method').all(),
    wage_sources: db.prepare('SELECT wage_source, COUNT(*) n FROM occupations WHERE wage_source IS NOT NULL GROUP BY wage_source').all(),
    total_wage_bill: db.prepare('SELECT SUM(wage_bill) s FROM occupations').get().s,
    total_labor_value: db.prepare('SELECT SUM(labor_value) s FROM tasks').get().s,
    bls_total_all_occupations: bls.get('00-0000') ? bls.get('00-0000').employment * bls.get('00-0000').wage : null,
    fallbacks: db.prepare(`SELECT o.onet_code, o.title, o.bls_code, o.bls_match, o.bls_shared_by, ROUND(o.employment) employment
                           FROM occupations o WHERE o.bls_match != 'exact' AND o.onet_code IN (SELECT onet_code FROM tasks) ORDER BY o.onet_code`).all(),
  };
  console.log(JSON.stringify({ ...summary, fallbacks: `${summary.fallbacks.length} occupations (see meta.bls.summary)` }, null, 2));

  setMeta(db, 'bls', {
    release: release.description, release_code: release.releaseDate, source, attempts,
    header: parsed.header, rows: parsed.rows.length, bytes: buf.length,
    sha256: createHash('sha256').update(buf).digest('hex'), downloaded_at: new Date().toISOString(),
    wage_rule: 'annual median; else hourly median x 2080; else annual mean; else hourly mean x 2080',
    summary,
  });
  db.close();
}

main().catch((err) => {
  console.error(err.stack || err);
  process.exit(1);
});
