// Step A: concepts computed in code from O*NET ratings, as candidates that compete with the Jev
// variants on the same gold labels. Each returns a number oriented like the concept (higher =
// more present); binary concepts are scored by AUC, level concepts by Spearman.
//
// Task level:  Tasks to DWAs -> GWA shares (the task's detailed work activities rolled up to
//              O*NET's Generalized Work Activities), and Task Ratings frequency (FT).
// Occupation level: Work Context (CX, 1-5) and Work Activities importance (IM, 1-5). These
//              cannot vary between tasks of the same occupation.

const GWA = {
  physical: ['4.A.3.a.1', '4.A.3.a.2', '4.A.3.a.3', '4.A.3.a.4', '4.A.3.b.4', '4.A.3.b.5', '4.A.1.b.2'],
  interpersonal: ['4.A.4.a.4', '4.A.4.a.5', '4.A.4.a.6', '4.A.4.a.7', '4.A.4.a.8', '4.A.4.b.3', '4.A.4.b.4', '4.A.4.b.5'],
  information: ['4.A.1.a.1', '4.A.2.a.2', '4.A.2.a.3', '4.A.2.a.4'],
  judging: ['4.A.2.a.1', '4.A.2.a.3'],
  writing: ['4.A.3.b.6', '4.A.2.b.2'],
  computer: ['4.A.3.b.1', '4.A.2.a.2'],
};

const WC = {
  hands: '4.C.2.d.1.g', standing: '4.C.2.d.1.b', sitting: '4.C.2.d.1.a',
  faceToFace: '4.C.1.a.2.l', public: '4.C.1.b.1.f', email: '4.C.1.a.2.h',
  repeatSame: '4.C.3.b.7', consequence: '4.C.3.a.1', decisionFreq: '4.C.3.a.2.b', timePressure: '4.C.3.d.1',
  exact: '4.C.3.b.4', impact: '4.C.3.a.2.a',
};
const WA = { computers: '4.A.3.b.1', compliance: '4.A.2.a.3', processing: '4.A.2.a.2' };

// Candidate definitions: concept -> { name: { level: 'task'|'occupation', describe, fn(row) } }
export const CODE_CANDIDATES = {
  reads_text: {
    code_gwa_information: { level: 'task', describe: 'share of the task\'s DWAs under information GWAs (getting, processing, evaluating compliance, analyzing)', fn: (r) => r.gwa.information },
  },
  closed_outcome: {
    code_gwa_judging: { level: 'task', describe: 'share of DWAs under judging GWAs (judging qualities, evaluating compliance)', fn: (r) => r.gwa.judging },
  },
  writes_content: {
    code_gwa_writing: { level: 'task', describe: 'share of DWAs under documenting/recording and thinking creatively', fn: (r) => r.gwa.writing },
  },
  physical: {
    code_gwa_physical: { level: 'task', describe: 'share of DWAs under physical GWAs (physical activities, handling objects, controlling machines, vehicles, repairing, inspecting equipment/structures)', fn: (r) => r.gwa.physical },
    code_wc_physical: { level: 'occupation', describe: 'mean of Work Context hands, standing, and (1 - sitting)', fn: (r) => mean([r.wc.hands, r.wc.standing, inv(r.wc.sitting)]) },
  },
  live_human: {
    code_gwa_interpersonal: { level: 'task', describe: 'share of DWAs under interpersonal GWAs (relationships, caring, selling, negotiating, public, teaching, coaching, directing)', fn: (r) => r.gwa.interpersonal },
    code_wc_contact: { level: 'occupation', describe: 'mean of Work Context face-to-face discussions and dealing with the public', fn: (r) => mean([r.wc.faceToFace, r.wc.public]) },
  },
  same_rules: {
    code_wc_repeat: { level: 'occupation', describe: 'Work Context importance of repeating same tasks', fn: (r) => r.wc.repeatSame },
    code_wa_compliance: { level: 'occupation', describe: 'Work Activities importance of evaluating information to determine compliance with standards', fn: (r) => r.wa.compliance },
  },
  errors_lose_money: {
    code_wc_consequence: { level: 'occupation', describe: 'Work Context consequence of error', fn: (r) => r.wc.consequence },
  },
  speed_value: {
    code_wc_time_pressure: { level: 'occupation', describe: 'Work Context time pressure', fn: (r) => r.wc.timePressure },
  },
  digital_input: {
    code_gwa_computer: { level: 'task', describe: 'share of DWAs under working with computers and processing information', fn: (r) => r.gwa.computer },
    code_wa_computers: { level: 'occupation', describe: 'Work Activities importance of working with computers', fn: (r) => r.wa.computers },
  },
  volume: {
    code_ft_frequency: { level: 'task', describe: 'Task Ratings frequency (FT) expected category, 1 yearly or less .. 7 hourly or more', fn: (r) => r.frequency },
    code_wc_decision_frequency: { level: 'occupation', describe: 'Work Context frequency of decision making', fn: (r) => r.wc.decisionFreq },
  },
  time_per_item: {
    code_ft_frequency_inverse: { level: 'task', describe: 'minus the task frequency (frequent tasks tend to be quick per item)', fn: (r) => (r.frequency == null ? null : -r.frequency) },
  },
  money_link: {
    code_wc_consequence: { level: 'occupation', describe: 'Work Context consequence of error', fn: (r) => r.wc.consequence },
    code_wc_impact: { level: 'occupation', describe: 'Work Context impact of decisions on co-workers or company results', fn: (r) => r.wc.impact },
  },
};

function mean(xs) {
  const v = xs.filter((x) => x != null);
  return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null;
}
function inv(x) { return x == null ? null : 6 - x; }

// One row of raw code features per task.
export function loadFeatureRows(db, taskIds) {
  const taskStmt = db.prepare('SELECT task_id, onet_code, frequency FROM tasks WHERE task_id = ?');
  const gwaStmt = db.prepare('SELECT r.gwa_id FROM task_dwas td JOIN dwa_reference r USING(dwa_id) WHERE td.task_id = ? AND td.onet_code = ?');
  const wcStmt = db.prepare("SELECT element_id, data_value FROM work_context WHERE onet_code = ? AND scale_id = 'CX'");
  const waStmt = db.prepare('SELECT element_id, im FROM work_activities WHERE onet_code = ?');
  const rows = new Map();
  for (const id of taskIds) {
    const t = taskStmt.get(id);
    const gwas = gwaStmt.all(t.task_id, t.onet_code).map((g) => g.gwa_id);
    const share = (set) => (gwas.length ? gwas.filter((g) => set.includes(g)).length / gwas.length : null);
    const wcMap = new Map(wcStmt.all(t.onet_code).map((w) => [w.element_id, w.data_value]));
    const waMap = new Map(waStmt.all(t.onet_code).map((w) => [w.element_id, w.im]));
    rows.set(id, {
      task_id: id,
      frequency: t.frequency,
      gwa: Object.fromEntries(Object.entries(GWA).map(([k, set]) => [k, share(set)])),
      wc: Object.fromEntries(Object.entries(WC).map(([k, el]) => [k, wcMap.get(el) ?? null])),
      wa: Object.fromEntries(Object.entries(WA).map(([k, el]) => [k, waMap.get(el) ?? null])),
    });
  }
  return rows;
}

// Put a code candidate on the scale the scoring formula expects: 0..1 for yes/no concepts,
// 0..3 for level concepts. Work Context (CX) and Work Activities (IM) run 1..5; FT runs 1..7.
export function toConceptScale(concept, candidate, raw) {
  if (raw == null) return null;
  const level = ['time_per_item', 'volume', 'money_link'].includes(concept);
  if (candidate.startsWith('code_gwa_')) return level ? raw * 3 : raw;
  if (candidate === 'code_ft_frequency') return ((raw - 1) / 6) * 3;
  if (candidate === 'code_ft_frequency_inverse') return ((-raw - 1) / 6) * -3 + 3; // frequent -> short time per item
  const unit = (raw - 1) / 4; // CX / IM 1..5 -> 0..1
  return level ? unit * 3 : unit;
}

export function codeValues(db, taskIds) {
  const rows = loadFeatureRows(db, taskIds);
  const out = {}; // concept -> candidate -> task_id -> value
  for (const [concept, cands] of Object.entries(CODE_CANDIDATES)) {
    out[concept] = {};
    for (const [name, c] of Object.entries(cands)) {
      out[concept][name] = new Map([...rows].map(([id, r]) => [id, c.fn(r)]));
    }
  }
  return out;
}
