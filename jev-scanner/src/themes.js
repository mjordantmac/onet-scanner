// Step 7: turn the hand-made theme grouping (data/themes.json: name, description, task IDs) into
// out/themes.md. Every number is computed here from SQLite, never typed by hand:
// total labor value, average opportunity, main buyer and sell model (most common answer among the
// members, with its share). Themes are ranked by total labor value x average opportunity.
//   node src/themes.js
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { openDb, setMeta, ROOT } from './lib/db.js';
import { TOP_TASKS } from '../config/weights.js';

export function loadThemes() {
  const db = openDb();
  const themes = JSON.parse(readFileSync(resolve(ROOT, 'data', 'themes.json'), 'utf8'));
  const rank = JSON.parse(db.prepare("SELECT value FROM meta WHERE key = 'rank'").get().value);
  // The ranked rows come from out/ranked_tasks.csv, which src/rank.js wrote from the same answers.
  const [header, ...lines] = readFileSync(resolve(ROOT, 'out', 'ranked_tasks.csv'), 'utf8').trim().split('\n');
  const cols = header.split(',');
  const parse = (line) => {
    const out = []; let cur = ''; let q = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (q) { if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') q = false; else cur += ch; } else if (ch === '"') q = true; else if (ch === ',') { out.push(cur); cur = ''; } else cur += ch;
    }
    out.push(cur);
    return Object.fromEntries(out.map((v, i) => [cols[i], v]));
  };
  const rows = new Map(lines.map(parse).map((r) => [Number(r.task_id), r]));

  const seen = new Map();
  const computed = themes.map((t) => {
    const members = t.task_ids.map((id) => {
      const r = rows.get(id);
      if (!r) throw new Error(`theme "${t.name}": task ${id} not in ranked_tasks.csv`);
      if (r.passes_filters !== '1') throw new Error(`theme "${t.name}": task ${id} was removed by the filters`);
      if (seen.has(id)) throw new Error(`task ${id} is in two themes: "${seen.get(id)}" and "${t.name}"`);
      seen.set(id, t.name);
      return r;
    });
    const mode = (key) => {
      const counts = new Map();
      for (const m of members) counts.set(m[key], (counts.get(m[key]) || 0) + 1);
      const [top, n] = [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
      return { value: top, share: n / members.length, all: Object.fromEntries([...counts].sort((a, b) => b[1] - a[1])) };
    };
    const labor = members.reduce((s, m) => s + (m.labor_value ? Number(m.labor_value) : 0), 0);
    const avgOpp = members.reduce((s, m) => s + Number(m.opportunity), 0) / members.length;
    return {
      ...t, members, n: members.length, total_labor_value: labor, average_opportunity: avgOpp, theme_score: labor * avgOpp,
      best_rank: Math.min(...members.map((m) => Number(m.rank))), buyer: mode('buyer'), sell_model: mode('sell_model'),
      uncertain: members.filter((m) => m.uncertain === '1').length,
      occupations: [...new Set(members.map((m) => m.occupation))],
    };
  }).sort((a, b) => b.theme_score - a.theme_score);
  computed.forEach((t, i) => { t.theme_id = i + 1; });

  const topIds = [...rows.values()].filter((r) => r.passes_filters === '1' && Number(r.rank) <= TOP_TASKS).map((r) => Number(r.task_id));
  const unassigned = topIds.filter((id) => !seen.has(id));
  const outside = [...seen.keys()].filter((id) => !topIds.includes(id));
  return { db, rank, themes: computed, unassigned, outside };
}

const usd = (x) => (x >= 1e9 ? `$${(x / 1e9).toFixed(2)}B` : `$${(x / 1e6).toFixed(0)}M`);
const md = (s) => String(s).replace(/\|/g, '\\|');

function main() {
  const { db, rank, themes, unassigned, outside } = loadThemes();
  if (unassigned.length) throw new Error(`${unassigned.length} top-${TOP_TASKS} tasks have no theme: ${unassigned.join(', ')}`);
  if (outside.length) throw new Error(`tasks outside the top ${TOP_TASKS} in themes: ${outside.join(', ')}`);
  if (themes.length < 30 || themes.length > 50) throw new Error(`${themes.length} themes; the plan asks for 30-50`);

  const lines = [
    '# Themes',
    '',
    `The top ${TOP_TASKS} tasks from out/top_tasks.md, grouped by hand into ${themes.length} themes (grouping in data/themes.json). `
      + 'All numbers are computed by `src/themes.js` from the ranked tasks:',
    '',
    '- **Total labor value**: sum of the member tasks\' labor value (BLS employment x median wage x task share; an estimate of what employers spend on this work today, not a market size for an outsourced service).',
    '- **Average opportunity**: mean opportunity score of the members.',
    '- **Main buyer / sell model**: the most common Jev answer among the members, with its share.',
    '- **Theme score** = total labor value x average opportunity; themes are listed in that order.',
    '',
    `Question set \`${rank.qset_hash}\`, model \`${rank.model}\`.`,
    '',
    '| # | Theme | Tasks | Total labor value | Avg opportunity | Theme score ($B-equiv.) | Main buyer | Main sell model | Best task rank |',
    '|---:|---|---:|---:|---:|---:|---|---|---:|',
    ...themes.map((t) => `| ${t.theme_id} | ${md(t.name)} | ${t.n} | ${usd(t.total_labor_value)} | ${t.average_opportunity.toFixed(3)} | ${(t.theme_score / 1e9).toFixed(2)} | `
      + `${t.buyer.value} (${Math.round(t.buyer.share * 100)}%) | ${t.sell_model.value} (${Math.round(t.sell_model.share * 100)}%) | ${t.best_rank} |`),
    '',
  ];
  for (const t of themes) {
    lines.push(`## ${t.theme_id}. ${t.name}`, '', t.description, '',
      `- Total labor value: ${usd(t.total_labor_value)} across ${t.n} tasks in ${t.occupations.length} occupations; average opportunity ${t.average_opportunity.toFixed(3)}; theme score ${(t.theme_score / 1e9).toFixed(2)}`,
      `- Main buyer: ${t.buyer.value} (${Math.round(t.buyer.share * 100)}% of members; all: ${Object.entries(t.buyer.all).map(([k, v]) => `${k} ${v}`).join(', ')})`,
      `- Main sell model: ${t.sell_model.value} (${Math.round(t.sell_model.share * 100)}%; all: ${Object.entries(t.sell_model.all).map(([k, v]) => `${k} ${v}`).join(', ')})`,
      `- Flagged uncertain: ${t.uncertain} of ${t.n}`,
      `- Member task IDs: ${t.members.map((m) => m.task_id).join(', ')}`,
      '',
      '| Rank | Task ID | Occupation | Task | Opportunity | Labor value |',
      '|---:|---:|---|---|---:|---:|',
      ...t.members.sort((a, b) => Number(a.rank) - Number(b.rank)).map((m) => `| ${m.rank} | ${m.task_id} | ${md(m.occupation)} | ${md(m.task)} | ${Number(m.opportunity).toFixed(3)} | ${m.labor_value ? usd(Number(m.labor_value)) : 'n/a'} |`),
      '');
  }
  const outDir = resolve(ROOT, 'out');
  mkdirSync(outDir, { recursive: true });
  writeFileSync(resolve(outDir, 'themes.md'), lines.join('\n'));
  const summary = themes.map((t) => ({ theme_id: t.theme_id, name: t.name, slug: t.slug, n: t.n, total_labor_value: t.total_labor_value,
    average_opportunity: t.average_opportunity, theme_score: t.theme_score, buyer: t.buyer.value, sell_model: t.sell_model.value, task_ids: t.task_ids }));
  writeFileSync(resolve(ROOT, 'data', 'themes_ranked.json'), `${JSON.stringify(summary, null, 1)}\n`);
  setMeta(db, 'themes', { count: themes.length, top10: summary.slice(0, 10).map(({ task_ids, ...t }) => t) });
  console.log(`wrote out/themes.md: ${themes.length} themes`);
  for (const t of summary.slice(0, 12)) console.log(`${String(t.theme_id).padStart(2)} ${t.name.padEnd(55)} n=${String(t.n).padStart(3)} ${usd(t.total_labor_value).padStart(8)} opp ${t.average_opportunity.toFixed(3)} score ${(t.theme_score / 1e9).toFixed(2)}`);
}

if (process.argv[1] && process.argv[1].endsWith('themes.js')) main();
