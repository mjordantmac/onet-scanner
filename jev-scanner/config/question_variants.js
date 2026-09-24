// Step B of the question-design stage: candidate wordings for every concept that stays with Jev.
// Three variants per concept; `v1` is always the draft from the original plan. Variants differ
// in framing, with vs. without criteria, and question type (Noul vs. Score vs. Choice).
//
// Each variant maps Jev's answer to one number (`toValue`) oriented so that higher means the
// concept is more present; src/design/evaluate.js scores that number against the gold labels.
// Rewrites made in Step D rounds are added as v4, v5, ... with a note on what changed and why.
import { noul, score, choice } from '@typesafe-ai/sdk';

// Answer -> number helpers.
const p = (a) => a.noul; // Noul: P(yes)
const s = (levels) => (a) => a.score / (levels - 1); // Score: expected level scaled to 0..1
const pick = (key) => (a) => a.probabilities[key] ?? 0; // Choice: probability of one option
const levelOf = (levels) => (a) => (a.score / (levels - 1)) * 3; // Score on another scale -> 0..3

export const CONCEPTS = {
  // ---------------------------------------------------------------- yes/no concepts
  reads_text: {
    kind: 'binary',
    variants: {
      v1: {
        note: 'draft',
        q: noul('Is the core of `task` reading or reviewing written or digital information, such as documents, forms, messages, records, listings, transcripts or code, to reach a judgment?', {
          true: 'Most of the work is reading information and judging it.',
          false: 'Most of the work is physical, conversational, creative, or done with tools or equipment.',
        }),
        toValue: p,
      },
      v2: {
        note: 'main-activity framing; drops "to reach a judgment" (a second condition)',
        q: noul('Is reading or reviewing documents, forms, records, messages or data the main activity in `task`?', {
          true: 'The worker spends most of the task reading or checking written or digital information.',
          false: 'The worker spends most of the task doing physical work, talking with people, creating new material, or operating equipment.',
        }),
        toValue: p,
      },
      v3: {
        note: 'statement form, no criteria',
        q: noul("In `task`, the worker's main job is to read written or digital information and decide something about it."),
        toValue: p,
      },
    },
  },
  closed_outcome: {
    kind: 'binary',
    variants: {
      v1: {
        note: 'draft',
        q: noul('Does `task` end in a decision picked from a small, known set of outcomes, such as approve or deny, a category, a priority level, match or no match, or a ranking?', {
          true: 'The result is one pick from a known set of options.',
          false: 'The result is new written content, a design, a conversation, or a physical change.',
        }),
        toValue: p,
      },
      v2: {
        note: '"fixed list" wording; adds calculations to the false side',
        q: noul('Is the result of `task` a choice from a fixed list of outcomes, such as approve or deny, accept or reject, a category or code, a priority level, or pass or fail?', {
          true: 'The worker picks one outcome from a list that is known in advance.',
          false: 'The worker produces something open-ended: new text, a design, a calculated amount, a conversation, or a physical change.',
        }),
        toValue: p,
      },
      v3: {
        note: 'Choice over result types; value = P(decision from a fixed list)',
        q: choice('What kind of result does `task` produce?', {
          fixed_list_decision: 'A pick from a fixed list of outcomes, such as approve or deny, a category or code, a priority, or pass or fail',
          new_written_material: 'New written material, a design, a plan or code',
          calculated_amount: 'A calculated amount, estimate or measurement',
          conversation: 'A conversation, advice or instruction given to people',
          physical_change: 'A physical change to objects, people, machines or places',
          other: 'Something else',
        }),
        toValue: pick('fixed_list_decision'),
      },
    },
  },
  writes_content: {
    kind: 'binary',
    variants: {
      v1: {
        note: 'draft',
        q: noul('Is the main output of `task` new written material, such as reports, letters, articles, plans or code?', {
          true: 'The worker mainly produces new text or code.',
          false: 'The worker mainly decides, checks, sorts or acts; any writing is incidental.',
        }),
        toValue: p,
      },
      v2: {
        note: '"new document as the main result" framing; notes and form-filling named on the false side',
        q: noul('Does `task` produce a new document, such as a report, letter, article, plan, proposal or program code, as its main result?', {
          true: 'The main result is a new document or code written by the worker.',
          false: 'The main result is a decision, a check, a physical result or a conversation; any writing is notes or form-filling.',
        }),
        toValue: p,
      },
      v3: {
        note: 'statement form, no criteria',
        q: noul('The main output of `task` is new text or code that the worker writes.'),
        toValue: p,
      },
    },
  },
  physical: {
    kind: 'binary',
    variants: {
      v1: {
        note: 'draft',
        q: noul('Does `task` require being physically present, handling objects, or operating tools, vehicles or equipment?', {
          true: 'The task cannot be done from a computer alone.',
          false: 'The task can be done entirely at a computer.',
        }),
        toValue: p,
      },
      v2: {
        note: 'hands-on framing; phone and talk named on the false side',
        q: noul("Does `task` require the worker's hands or body to act on objects, people, vehicles, machines or places?", {
          true: 'Hands-on physical work or being on site is required.',
          false: 'Only reading, writing, typing, calling or talking is required.',
        }),
        toValue: p,
      },
      v3: {
        note: 'Score, 4 situational levels',
        q: score('How much of `task` is physical, hands-on work?', [
          'None: all of it can be done at a desk or computer.',
          'A little: mostly desk work with occasional hands-on steps.',
          'Mostly hands-on work with some desk work.',
          'All hands-on: handling objects, people, tools, vehicles or equipment.',
        ]),
        toValue: s(4),
      },
    },
  },
  live_human: {
    kind: 'binary',
    variants: {
      v1: {
        note: 'draft',
        q: noul('Does `task` mainly happen through live conversation with people, such as interviewing, counseling, negotiating, selling or teaching?', {
          true: 'Live conversation is the main work.',
          false: 'Conversation is absent or secondary.',
        }),
        toValue: p,
      },
      v2: {
        note: 'real-time talk framing (in person or by phone)',
        q: noul('Is talking with people in real time, in person or by phone, the main activity in `task`?', {
          true: 'Most of the task is live conversation: interviewing, advising, teaching, selling, negotiating or serving someone.',
          false: 'Most of the task is done without live conversation.',
        }),
        toValue: p,
      },
      v3: {
        note: 'Score, 4 situational levels',
        q: score('How much of `task` is live conversation with other people?', [
          'None or almost none.',
          'Some: conversation supports the work but is not the main part.',
          'Most of the task is live conversation.',
          'The task is live conversation from start to finish.',
        ]),
        toValue: s(4),
      },
    },
  },
  same_rules: {
    kind: 'binary',
    variants: {
      v1: {
        note: 'draft',
        q: noul('Is each item in `task` judged against the same rules, policy, checklist or criteria every time?', {
          true: 'Every item is checked against the same standard.',
          false: 'Each item needs its own custom approach.',
        }),
        toValue: p,
      },
      v2: {
        note: '"fixed written rules applied to each item"; non-judging tasks on the false side',
        q: noul('In `task`, does the worker apply a fixed set of written rules, policies, standards or checklists to each item?', {
          true: 'Each item is checked against the same fixed standard.',
          false: 'Items are handled with custom judgment, creativity or open-ended problem solving, or the task does not judge items.',
        }),
        toValue: p,
      },
      v3: {
        note: 'Score, 4 situational levels of standardization',
        q: score('How standardized is the way each item in `task` is judged?', [
          'No standard: every item needs a custom, creative or open-ended approach.',
          'Some shared guidelines, but most of the judgment is custom.',
          'Mostly a standard procedure with some case-by-case judgment.',
          'Fully standard: the same rules or checklist are applied to every item.',
        ]),
        toValue: s(4),
      },
    },
  },
  errors_lose_money: {
    kind: 'binary',
    variants: {
      v1: {
        note: 'first half of the draft recoverable_loss, split out',
        q: noul('When `task` is done wrong or skipped, does the organization lose money, such as overpayments, duplicate charges, missed billing or fraud losses?', {
          true: 'Errors directly cause money losses.',
          false: 'Errors cost time, quality or satisfaction, but not money directly.',
        }),
        toValue: p,
      },
      v2: {
        note: '"a mistake can directly cost money" with examples, no criteria',
        q: noul('Can a mistake in `task` directly cost the organization money, for example by paying too much, charging too little, paying a fraudulent claim or incurring a penalty?'),
        toValue: p,
      },
      v3: {
        note: 'Score, 3 levels of money cost per mistake',
        q: score('How much money can one mistake in `task` directly cost the organization?', [
          'None: mistakes cost time or quality, not money.',
          'A little: small amounts, like a minor billing error.',
          'A lot: a large overpayment, bad loan, fraud loss or penalty.',
        ]),
        toValue: s(3),
      },
    },
  },
  loss_recoverable: {
    kind: 'binary',
    conditionalOn: 'errors_lose_money', // scored only on tasks where errors_lose_money is yes
    variants: {
      v1: {
        note: 'second half of the draft recoverable_loss, split out',
        q: noul('If a mistake in `task` loses money, can that money usually be found and recovered later, as with overpayments, duplicate payments, billing errors or clawed-back fraud?', {
          true: 'Lost money can be found and recovered later.',
          false: 'Lost money is gone, or mistakes do not lose money.',
        }),
        toValue: p,
      },
      v2: {
        note: 'audit framing, no criteria',
        q: noul('Would an audit of past work in `task` turn up errors that let the organization get money back?'),
        toValue: p,
      },
      v3: {
        note: 'names who the money can be recovered from',
        q: noul('After a mistake in `task`, can the lost money be claimed back from a payee, vendor, customer or insurer, or billed after the fact?', {
          true: 'The money went to someone who can be asked to pay it back, or a missed bill can still be sent.',
          false: 'The money cannot be recovered once it is lost.',
        }),
        toValue: p,
      },
    },
  },
  outcome_visible: {
    kind: 'binary',
    variants: {
      v1: {
        note: 'draft',
        q: noul('Is it later possible to see whether a judgment made in `task` was right, from a real outcome such as a payment, an appeal result, a sale, or an error found later?', {
          true: 'Real outcomes later show whether each judgment was right.',
          false: 'There is no later outcome that shows whether a judgment was right.',
        }),
        toValue: p,
      },
      v2: {
        note: '"a later event confirms or refutes"; no-judgment tasks on the false side',
        q: noul("After `task` is done, does a later event show whether the worker's judgment was correct, such as a payment clearing, an appeal result, a loan default, a sale, an audit finding or a returned product?", {
          true: 'A later real-world result confirms or refutes the judgment.',
          false: 'Nothing later shows whether the judgment was right, or the task involves no judgment.',
        }),
        toValue: p,
      },
      v3: {
        note: 'statement form, no criteria',
        q: noul('Mistakes in `task` are eventually revealed by real outcomes, such as payments, appeals, audits or complaints.'),
        toValue: p,
      },
    },
  },
  speed_value: {
    kind: 'binary',
    variants: {
      v1: {
        note: 'draft',
        q: noul('Would doing `task` much faster create clear value, such as fewer delays, faster payments, or opportunities that would otherwise be missed?', {
          true: 'Speed clearly creates value.',
          false: 'Speed makes little difference.',
        }),
        toValue: p,
      },
      v2: {
        note: 'concrete "minutes instead of hours or days" framing',
        q: noul('Would finishing `task` in minutes instead of hours or days reduce waiting for customers, payments or decisions?', {
          true: 'Faster completion clearly reduces delays or captures value.',
          false: 'Speed matters little because the task runs on a schedule, needs someone present, or is limited by quality rather than time.',
        }),
        toValue: p,
      },
      v3: {
        note: 'Score, 4 situational levels',
        q: score('How much value would doing `task` much faster create?', [
          'None: timing does not matter.',
          'A little: a small convenience.',
          'Clear value: shorter queues, faster payments or fewer delays.',
          'Critical: delays lose money, customers or safety.',
        ]),
        toValue: s(4),
      },
    },
  },
  digital_input: {
    kind: 'binary',
    variants: {
      v1: {
        note: 'draft',
        q: noul('Is the information needed for `task` usually already available as digital text, rather than on paper, in images, in audio, or in the physical world?', {
          true: 'The inputs are usually digital text.',
          false: 'The inputs are mostly paper, images, audio, or physical.',
        }),
        toValue: p,
      },
      v2: {
        note: '"works from information on a computer screen" framing',
        q: noul('Does the worker in `task` mainly work from information on a computer, such as emails, database records, electronic forms or documents?', {
          true: 'The inputs are on a computer.',
          false: 'The inputs are paper, images, sounds, people or physical objects.',
        }),
        toValue: p,
      },
      v3: {
        note: 'Choice over input forms with "other"; value = P(digital text)',
        q: choice('What form do the inputs to `task` usually take?', {
          digital_text: 'Emails, database records, electronic forms, documents or code on a computer',
          paper: 'Paper documents or forms',
          images_or_audio: 'Photos, scans, drawings, video, audio or speech',
          people_in_person: 'People present in person',
          physical_objects: 'Physical objects, materials, machines or places',
          other: 'Something else',
        }),
        toValue: pick('digital_text'),
      },
    },
  },
  licensed_signoff: {
    kind: 'binary',
    variants: {
      v1: {
        note: 'draft',
        q: noul('Must a licensed professional, such as a doctor, lawyer, engineer or certified accountant, legally sign off on each judgment in `task`?', {
          true: "Each judgment legally needs a licensed professional's sign-off.",
          false: 'No licensed sign-off is legally required.',
        }),
        toValue: p,
      },
      v2: {
        note: '"the law requires approval of the result" framing, longer list of licenses',
        q: noul('Does the law require the result of `task` to be approved or signed by a licensed professional, such as a physician, attorney, licensed engineer, CPA or pharmacist?', {
          true: 'A licensed professional must legally approve each result.',
          false: 'No license is legally required to approve the result.',
        }),
        toValue: p,
      },
      v3: {
        note: 'statement form, no criteria',
        q: noul('Each judgment in `task` legally requires sign-off from a licensed professional.'),
        toValue: p,
      },
    },
  },

  // ---------------------------------------------------------------- level concepts (0-3)
  time_per_item: {
    kind: 'level',
    variants: {
      v1: {
        note: 'draft',
        q: score('For one item handled in `task`, how long does a trained worker usually need to reach the judgment?', [
          'A quick read and a gut call, like sorting a message into a folder.',
          'A careful read checked against a policy or checklist, like approving a routine expense.',
          'An investigation across several documents or sources, like reviewing a complex claim.',
          'Hours of expert analysis or original work, like writing a legal opinion.',
        ]),
        toValue: levelOf(4),
      },
      v2: {
        note: 'levels described by the kind of effort, time named in words; covers physical units too',
        q: score('How much effort does a trained worker need to finish one item in `task`?', [
          'A glance and an immediate decision or action.',
          'A careful look at one item, checked against a rule or list.',
          'Gathering and comparing several sources or steps before finishing.',
          'Extended expert study, design, building or original writing.',
        ]),
        toValue: levelOf(4),
      },
      v3: {
        note: 'Noul "one item takes a few minutes or less", inverted onto the level scale',
        q: noul('Can a trained worker finish one item of `task` in a few minutes or less?'),
        toValue: (a) => 3 * (1 - a.noul),
      },
    },
  },
  volume: {
    kind: 'level',
    variants: {
      v1: {
        note: 'draft',
        q: score('How many separate items, such as claims, invoices, messages, applications or records, does one worker typically handle in `task`?', [
          'Occasional: a few items a week or fewer.',
          'Regular: a handful of items a day.',
          'High volume: a steady queue of dozens a day.',
          'Very high volume: a constant stream of hundreds a day.',
        ]),
        toValue: levelOf(4),
      },
      v2: {
        note: 'levels as situations (queue, stream), no numbers',
        q: score('How often does one worker handle a new item in `task`?', [
          'Now and then: the task comes up occasionally or as one-off projects.',
          'Several times a day.',
          'All day long from a steady queue.',
          'A constant, fast stream where each item takes moments.',
        ]),
        toValue: levelOf(4),
      },
      v3: {
        note: 'Noul "steady queue of many items a day"',
        q: noul('Does one worker handle a steady queue of many separate items every day in `task`?'),
        toValue: (a) => 3 * a.noul,
      },
    },
  },
  money_link: {
    kind: 'level',
    variants: {
      v1: {
        note: 'draft',
        q: score('How directly does getting `task` right or wrong affect money?', [
          'No direct effect on money.',
          'Indirect: it affects efficiency, quality or satisfaction.',
          'Direct: it decides payments, prices, claims, refunds, fraud or revenue.',
          'Large and direct: a single judgment can move thousands of dollars or more.',
        ]),
        toValue: levelOf(4),
      },
      v2: {
        note: 'top level described as a situation instead of a dollar figure',
        q: score('How directly does getting `task` right or wrong affect money?', [
          'No effect on money.',
          'Indirect: it changes efficiency, quality or customer satisfaction.',
          'Direct: it decides a payment, price, claim, refund, credit or bill.',
          'Direct and large: it decides big payments, loans, claims or contracts.',
        ]),
        toValue: levelOf(4),
      },
      v3: {
        note: 'Noul "directly decides an amount of money"',
        q: noul('Does `task` directly decide an amount of money that is paid, charged, refunded, lent or recovered?'),
        toValue: (a) => 3 * a.noul,
      },
    },
  },

  // ---------------------------------------------------------------- choice concepts
  buyer: {
    kind: 'choice',
    options: ['insurance', 'banking_fintech', 'accounting_finance_ops', 'legal', 'healthcare_admin', 'hr_recruiting',
      'customer_support', 'trust_safety', 'sales_marketing', 'ecommerce_marketplaces', 'logistics_supply_chain',
      'real_estate', 'government', 'software_it', 'education', 'manufacturing_quality', 'media_publishing', 'other'],
    variants: {
      v1: {
        note: 'draft (labels only)',
        q: choice('Which kind of organization most often pays for `task` to be done?', {
          insurance: null, banking_fintech: null, accounting_finance_ops: null, legal: null, healthcare_admin: null,
          hr_recruiting: null, customer_support: null, trust_safety: null, sales_marketing: null,
          ecommerce_marketplaces: null, logistics_supply_chain: null, real_estate: null, government: null,
          software_it: null, education: null, manufacturing_quality: null, media_publishing: null, other: null,
        }),
      },
      v2: {
        note: 'same question, each option described (the label-guide definitions)',
        q: choice('Which kind of organization most often pays for `task` to be done?', BUYER_DESCRIBED()),
      },
      v3: {
        note: '"which department or industry employs the worker" framing, described options',
        q: choice('Which industry or department most often employs the workers who do `task`?', BUYER_DESCRIBED()),
      },
    },
  },
  sell_model: {
    kind: 'choice',
    options: ['contingency', 'per_item', 'subscription', 'per_lead', 'not_outsourced', 'other'],
    variants: {
      v1: {
        note: 'draft (no "other" option)',
        q: choice('What is the most natural way an outside company would get paid for doing `task`?', {
          contingency: 'A share of money recovered or saved',
          per_item: 'A fee for each item processed',
          subscription: 'A monthly software subscription',
          per_lead: 'A fee for each qualified lead or match delivered',
          not_outsourced: 'Organizations rarely pay outsiders for this.',
        }),
      },
      v2: {
        note: 'draft plus an "other" option (hourly or project fees)',
        q: choice('What is the most natural way an outside company would get paid for doing `task`?', SELL_WITH_OTHER()),
      },
      v3: {
        note: '"sold as an outsourced service" framing, with "other"',
        q: choice('If a company offered `task` as an outsourced service, how would its customers most naturally pay for it?', SELL_WITH_OTHER()),
      },
    },
  },
};

function BUYER_DESCRIBED() {
  return {
    insurance: 'Insurance carriers, brokers and claims administrators',
    banking_fintech: 'Banks, credit unions, lenders, payment and fintech companies',
    accounting_finance_ops: 'Finance and accounting departments of any company, and accounting firms',
    legal: 'Law firms and corporate legal departments',
    healthcare_admin: 'Hospitals, clinics, care providers and health administration',
    hr_recruiting: 'HR departments, recruiters and staffing firms',
    customer_support: 'Customer service and support departments',
    trust_safety: 'Content moderation, fraud prevention and trust and safety teams',
    sales_marketing: 'Sales and marketing departments and agencies',
    ecommerce_marketplaces: 'Online stores, retailers and marketplaces',
    logistics_supply_chain: 'Transportation, warehousing, purchasing and supply chain operations',
    real_estate: 'Real estate, property management and construction',
    government: 'Government agencies, courts and public safety',
    software_it: 'Software companies and IT departments',
    education: 'Schools, universities and training providers',
    manufacturing_quality: 'Manufacturing, production, repair, energy and utilities',
    media_publishing: 'Media, publishing, arts and entertainment',
    other: 'Any other kind of organization, such as hospitality, personal services, agriculture, research or nonprofits',
  };
}

function SELL_WITH_OTHER() {
  return {
    contingency: 'A share of money recovered or saved',
    per_item: 'A fee for each item processed',
    subscription: 'A monthly software subscription',
    per_lead: 'A fee for each qualified lead or match delivered',
    not_outsourced: 'Organizations rarely pay outsiders for this.',
    other: 'Another arrangement, such as hourly consulting or a fixed project fee',
  };
}

// The compound draft, kept so the report can show what splitting it changed. Scored against the
// combined gold label (errors_lose_money AND loss_recoverable).
export const COMPOUND_DRAFTS = {
  recoverable_loss: {
    note: 'draft (compound: money is lost AND can be recovered)',
    q: noul('When `task` is done wrong or skipped, does the organization lose money it could later recover, such as overpayments, duplicate charges, missed billing or fraud losses?', {
      true: 'Errors create money losses that can be found and recovered.',
      false: 'Errors do not create recoverable money losses.',
    }),
    toValue: p,
  },
};
