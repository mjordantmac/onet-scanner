// Step E4: print the summary table for QUESTION_DESIGN.md from the saved results, so the table
// is never hand-copied: data/labeling/agreement_round1.json, data/design/metrics.json and
// data/design/selection.json.
//   node src/design/design-table.js > data/design/table.md
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ROOT } from '../lib/db.js';
import { CONCEPTS } from '../../config/question_variants.js';

const read = (...p) => JSON.parse(readFileSync(resolve(ROOT, ...p), 'utf8'));
const agreement = read('data', 'labeling', 'agreement_round1.json');
const { results, compound } = read('data', 'design', 'metrics.json');
const { selection } = read('data', 'design', 'selection.json');

const f = (x) => (x == null ? 'n/a' : x.toFixed(2));
const metricName = { binary: 'AUC', level: 'Spearman', choice: 'accuracy' };
const cell = (s) => String(s).replace(/\|/g, '\\|').replace(/\n/g, ' ');

function wording(q) {
  let text = `${q.type[0].toUpperCase()}${q.type.slice(1)}: "${q.instructions}"`;
  if (q.type === 'noul' && q.criteria) text += ` (yes = "${q.criteria.true}"; no = "${q.criteria.false}")`;
  if (q.type === 'score') text += ` Levels 0-${q.criteria.length - 1}: ${q.criteria.map((l, i) => `${i} "${l}"`).join('; ')}`;
  if (q.type === 'choice') text += ` Options: ${Object.entries(q.criteria).map(([k, d]) => (d ? `${k} ("${d}")` : k)).join('; ')}`;
  return text;
}

const rows = [];
for (const [concept, s] of Object.entries(selection)) {
  const def = CONCEPTS[concept];
  const v = def.variants[s.name];
  const tried = results[concept].map((r) => `${r.source === 'jev' ? r.name : r.name.replace('code_', 'code:')} ${f(r.dev.metric)}`).join(', ');
  const a = agreement[concept];
  const agree = `${(a.agreement * 100).toFixed(0)}%${a.within_one != null ? ` (within one level ${(a.within_one * 100).toFixed(0)}%)` : ''}`;
  const dev = `${metricName[s.kind]} ${f(s.dev.metric)}${s.dev.mae != null ? `, MAE ${f(s.dev.mae)}` : ''}${s.dev.top2 != null ? `, top-2 ${f(s.dev.top2)}` : ''}`;
  const ci = s.heldout.ci95 ? ` [95% CI ${f(s.heldout.ci95[0])}-${f(s.heldout.ci95[1])}]` : '';
  const held = `${metricName[s.kind]} ${f(s.heldout.metric)}${s.heldout.mae != null ? `, MAE ${f(s.heldout.mae)}` : ''}${s.heldout.top2 != null ? `, top-2 ${f(s.heldout.top2)}` : ''}${ci}`
    + `${s.meets_target_heldout ? '' : ` **below the ${s.target} target**`}`;
  const changed = s.name === 'v1' ? 'kept the draft' : `replaced the draft with ${s.name}: ${v.note}`;
  rows.push(`| ${concept} | Jev (${s.name}) | ${cell(wording(v.q))} | ${tried} | ${agree} | ${dev} | ${held} | ${cell(changed)} |`);
}

console.log('| Concept | Source | Final wording | Variants tried (dev metric) | Labeler agreement | Dev metric | Held-out metric | What changed |');
console.log('|---|---|---|---|---|---|---|---|');
console.log(rows.join('\n'));
if (compound.recoverable_loss) {
  console.log(`\nCompound draft \`recoverable_loss\` against the combined label (money lost AND recoverable): dev AUC ${f(compound.recoverable_loss.dev)}, held-out ${f(compound.recoverable_loss.heldout)}.`);
}
