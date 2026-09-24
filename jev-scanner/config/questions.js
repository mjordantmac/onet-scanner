// The questions the full run asks Jev, and where every scoring concept comes from.
//
// The wording lives in config/question_variants.js: `v1` of each concept is the draft from the
// original plan (verbatim), the others are the alternatives tested in the question-design stage
// (QUESTION_DESIGN.md). SELECTED below picks, per concept, either one Jev variant or one measure
// computed in code from O*NET ratings (src/design/features.js). Nothing is copied, so the wording
// that was tested is exactly the wording that runs.
//
// Changing SELECTED or any selected wording changes the question-set hash, so the runner treats the
// new set as unanswered and re-asks it. Old answers stay in SQLite under their own hash.
import { createHash } from 'node:crypto';
import { CONCEPTS as VARIANTS } from './question_variants.js';

export const QUESTION_SET_LABEL = 'draft (v1 of every concept, recoverable_loss split) - replaced in Step E2';

const jev = (variant) => ({ source: 'jev', variant });
const code = (candidate) => ({ source: 'onet_code', candidate });

// concept -> source. Step E2 fills this from data/design/selection.json.
export const SELECTED = {
  reads_text: jev('v1'),
  closed_outcome: jev('v1'),
  writes_content: jev('v1'),
  physical: jev('v1'),
  live_human: jev('v1'),
  same_rules: jev('v1'),
  errors_lose_money: jev('v1'),
  loss_recoverable: jev('v1'),
  outcome_visible: jev('v1'),
  speed_value: jev('v1'),
  digital_input: jev('v1'),
  licensed_signoff: jev('v1'),
  time_per_item: jev('v1'),
  volume: jev('v1'),
  money_link: jev('v1'),
  buyer: jev('v1'),
  sell_model: jev('v2'),
};

// concept -> { source, kind, variant | candidate, q, toValue }
export const CONCEPT_SOURCES = Object.fromEntries(Object.entries(SELECTED).map(([concept, sel]) => {
  const def = VARIANTS[concept];
  if (!def) throw new Error(`unknown concept ${concept}`);
  if (sel.source === 'onet_code') return [concept, { ...sel, kind: def.kind }];
  const v = def.variants[sel.variant];
  if (!v) throw new Error(`unknown variant ${concept}.${sel.variant}`);
  return [concept, { ...sel, kind: def.kind, q: v.q, toValue: v.toValue || null, note: v.note }];
}));

// The questions sent to Jev on every call, keyed by concept.
export const QUESTIONS = Object.fromEntries(Object.entries(CONCEPT_SOURCES)
  .filter(([, c]) => c.source === 'jev').map(([concept, c]) => [concept, c.q]));

export const SCORE_IDS = Object.entries(QUESTIONS).filter(([, q]) => q.type === 'score').map(([id]) => id);
export const CHOICE_IDS = Object.entries(QUESTIONS).filter(([, q]) => q.type === 'choice').map(([id]) => id);

// Jev answers -> one number per Jev-sourced concept (0..1 yes/no concepts, 0..3 level concepts).
// Choice concepts come back as { choice, confidence, probabilities }.
export function jevConceptValues(answers) {
  const out = {};
  for (const [concept, c] of Object.entries(CONCEPT_SOURCES)) {
    if (c.source !== 'jev') continue;
    const a = answers[concept];
    if (!a) { out[concept] = null; continue; }
    out[concept] = c.kind === 'choice'
      ? { choice: a.choice, confidence: a.confidence, probabilities: a.probabilities }
      : c.toValue(a);
  }
  return out;
}

// The state Jev sees for one task: the occupation, the task text, and the task's O*NET Detailed
// Work Activities (decided in Step A2; see QUESTION_DESIGN.md). Kept here so the hash covers it.
export const STATE_VERSION = 'occupation{title,description}+task+detailed_work_activities:v2';
export function buildState(task) {
  return {
    occupation: { title: task.occupation_title, description: task.occupation_description },
    task: task.task,
    detailed_work_activities: task.detailed_work_activities || [],
  };
}

// Stable JSON (sorted keys) so the hash only moves when meaning moves.
function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${stable(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function questionSetHash(model) {
  return createHash('sha256').update(stable({ questions: QUESTIONS, model, state: STATE_VERSION })).digest('hex').slice(0, 16);
}
