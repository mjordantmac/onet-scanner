// The 16 Jev questions, in one place. Every question points at `task` by name; the state for
// each call is { occupation: { title, description }, task: "<task text>" }.
//
// Changing any wording here changes QUESTION_SET_HASH, so the runner treats the new set as
// unanswered and re-asks it. Old answers stay in SQLite under their own hash.
// Every wording change and the reason for it is recorded in RUN_REPORT.md.
import { createHash } from 'node:crypto';
import { noul, score, choice } from '@typesafe-ai/sdk';

export const QUESTION_SET_LABEL = 'v1 (as specified)';

export const QUESTIONS = {
  // ---- Nouls ---------------------------------------------------------------------------------
  reads_text: noul(
    'Is the core of `task` reading or reviewing written or digital information, such as documents, forms, messages, records, listings, transcripts or code, to reach a judgment?',
    {
      true: 'Most of the work is reading information and judging it.',
      false: 'Most of the work is physical, conversational, creative, or done with tools or equipment.',
    },
  ),
  closed_outcome: noul(
    'Does `task` end in a decision picked from a small, known set of outcomes, such as approve or deny, a category, a priority level, match or no match, or a ranking?',
    {
      true: 'The result is one pick from a known set of options.',
      false: 'The result is new written content, a design, a conversation, or a physical change.',
    },
  ),
  writes_content: noul(
    'Is the main output of `task` new written material, such as reports, letters, articles, plans or code?',
    {
      true: 'The worker mainly produces new text or code.',
      false: 'The worker mainly decides, checks, sorts or acts; any writing is incidental.',
    },
  ),
  physical: noul(
    'Does `task` require being physically present, handling objects, or operating tools, vehicles or equipment?',
    {
      true: 'The task cannot be done from a computer alone.',
      false: 'The task can be done entirely at a computer.',
    },
  ),
  live_human: noul(
    'Does `task` mainly happen through live conversation with people, such as interviewing, counseling, negotiating, selling or teaching?',
    {
      true: 'Live conversation is the main work.',
      false: 'Conversation is absent or secondary.',
    },
  ),
  same_rules: noul(
    'Is each item in `task` judged against the same rules, policy, checklist or criteria every time?',
    {
      true: 'Every item is checked against the same standard.',
      false: 'Each item needs its own custom approach.',
    },
  ),
  recoverable_loss: noul(
    'When `task` is done wrong or skipped, does the organization lose money it could later recover, such as overpayments, duplicate charges, missed billing or fraud losses?',
    {
      true: 'Errors create money losses that can be found and recovered.',
      false: 'Errors do not create recoverable money losses.',
    },
  ),
  outcome_visible: noul(
    'Is it later possible to see whether a judgment made in `task` was right, from a real outcome such as a payment, an appeal result, a sale, or an error found later?',
    {
      true: 'Real outcomes later show whether each judgment was right.',
      false: 'There is no later outcome that shows whether a judgment was right.',
    },
  ),
  speed_value: noul(
    'Would doing `task` much faster create clear value, such as fewer delays, faster payments, or opportunities that would otherwise be missed?',
    {
      true: 'Speed clearly creates value.',
      false: 'Speed makes little difference.',
    },
  ),
  digital_input: noul(
    'Is the information needed for `task` usually already available as digital text, rather than on paper, in images, in audio, or in the physical world?',
    {
      true: 'The inputs are usually digital text.',
      false: 'The inputs are mostly paper, images, audio, or physical.',
    },
  ),
  licensed_signoff: noul(
    'Must a licensed professional, such as a doctor, lawyer, engineer or certified accountant, legally sign off on each judgment in `task`?',
    {
      true: "Each judgment legally needs a licensed professional's sign-off.",
      false: 'No licensed sign-off is legally required.',
    },
  ),

  // ---- Scores (levels from 0 up) -------------------------------------------------------------
  time_per_item: score(
    'For one item handled in `task`, how long does a trained worker usually need to reach the judgment?',
    [
      'A quick read and a gut call, like sorting a message into a folder.',
      'A careful read checked against a policy or checklist, like approving a routine expense.',
      'An investigation across several documents or sources, like reviewing a complex claim.',
      'Hours of expert analysis or original work, like writing a legal opinion.',
    ],
  ),
  volume: score(
    'How many separate items, such as claims, invoices, messages, applications or records, does one worker typically handle in `task`?',
    [
      'Occasional: a few items a week or fewer.',
      'Regular: a handful of items a day.',
      'High volume: a steady queue of dozens a day.',
      'Very high volume: a constant stream of hundreds a day.',
    ],
  ),
  money_link: score(
    'How directly does getting `task` right or wrong affect money?',
    [
      'No direct effect on money.',
      'Indirect: it affects efficiency, quality or satisfaction.',
      'Direct: it decides payments, prices, claims, refunds, fraud or revenue.',
      'Large and direct: a single judgment can move thousands of dollars or more.',
    ],
  ),

  // ---- Choices -------------------------------------------------------------------------------
  buyer: choice(
    'Which kind of organization most often pays for `task` to be done?',
    {
      insurance: null,
      banking_fintech: null,
      accounting_finance_ops: null,
      legal: null,
      healthcare_admin: null,
      hr_recruiting: null,
      customer_support: null,
      trust_safety: null,
      sales_marketing: null,
      ecommerce_marketplaces: null,
      logistics_supply_chain: null,
      real_estate: null,
      government: null,
      software_it: null,
      education: null,
      manufacturing_quality: null,
      media_publishing: null,
      other: null,
    },
  ),
  sell_model: choice(
    'What is the most natural way an outside company would get paid for doing `task`?',
    {
      contingency: 'A share of money recovered or saved',
      per_item: 'A fee for each item processed',
      subscription: 'A monthly software subscription',
      per_lead: 'A fee for each qualified lead or match delivered',
      not_outsourced: 'Organizations rarely pay outsiders for this.',
    },
  ),
};

export const NOUL_IDS = Object.entries(QUESTIONS).filter(([, q]) => q.type === 'noul').map(([id]) => id);
export const SCORE_IDS = Object.entries(QUESTIONS).filter(([, q]) => q.type === 'score').map(([id]) => id);
export const CHOICE_IDS = Object.entries(QUESTIONS).filter(([, q]) => q.type === 'choice').map(([id]) => id);

// The state Jev sees for one task. Kept here so the hash covers it too.
export const STATE_VERSION = 'occupation{title,description}+task:v1';
export function buildState(task) {
  return {
    occupation: { title: task.occupation_title, description: task.occupation_description },
    task: task.task,
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
