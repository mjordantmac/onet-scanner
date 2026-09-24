# Labeling guide (gold labels for the Jev question-design stage)

You are labeling O*NET task statements. For each task you see the occupation title and
description, the task statement, and the task's O*NET "detailed work activities" (DWAs).
Label what is true of **how this task is actually done by a typical worker in this occupation
in the US today**. Use the text plus your general knowledge of the job. Judge the task, not
the whole occupation: a nurse's charting task is desk work even though nursing is physical.

Label every concept for every task. Allowed values:
- yes/no concepts: `yes`, `no`, or `unsure`
- level concepts: `0`, `1`, `2`, `3`, or `unsure`
- choice concepts: one option key, or `unsure`

Use `unsure` only when the task is genuinely ambiguous even after thinking about it (for
example the task statement covers very different activities). Do not use it to avoid a hard
call; aim for under 10% unsure per concept.

"Item" means one unit the worker handles: one claim, invoice, application, record, message,
patient chart, shipment, part, customer, etc.

---

## Yes/no concepts

### reads_text
**yes** if the core of the task is reading or reviewing written or digital information
(documents, forms, messages, records, listings, transcripts, data, code) in order to reach a
judgment about it.
**no** if the core is physical work, live conversation, creating new material, or operating
tools/equipment, or if reading is only incidental.
- Checking documents, examining records to decide something, reviewing applications: yes.
- Data entry or filing (copying information without judging it): no.
- Writing a report from scratch: no (that is creating). Reviewing a report for errors: yes.
- Inspecting physical objects (parts, buildings, patients): no.

### closed_outcome
**yes** if the task ends in a decision picked from a small, known set of outcomes: approve or
deny, accept or reject, a category or code from a fixed list, a priority level, match or no
match, pass or fail, a ranking of known items.
**no** if the result is new written content, a design, a plan, a conversation, a physical
change, or an open-ended answer (for example a dollar amount that must be calculated).
- Coding records with a standard classification system: yes.
- Determining eligibility or coverage: yes.
- Negotiating a price, writing a plan, repairing a machine: no.

### writes_content
**yes** if the main output of the task is new written material: reports, letters, articles,
plans, proposals, documentation, code, lesson plans, contracts.
**no** if the worker mainly decides, checks, sorts, talks, or acts, and any writing is
incidental (notes, logs, filling in a form field).

### physical
**yes** if the task requires being physically present, handling objects or people, or
operating tools, vehicles or equipment; it cannot be done from a computer alone.
**no** if the task can be done entirely at a computer (or on paper at a desk).
- Phone calls and video meetings count as doable from a computer: no.
- In-person meetings are not physical work by themselves; label them no unless the task also
  needs hands-on work or physical presence at a site (inspecting a site, treating a patient).

### live_human
**yes** if the task mainly happens through live, real-time conversation with people:
interviewing, counseling, negotiating, selling, teaching, advising face to face or by phone,
serving customers in person.
**no** if conversation is absent or secondary (the work is mainly reading, writing, physical
work, or analysis, even if the worker sometimes talks to someone).

### same_rules
**yes** if each item in the task is judged against the same rules, policy, checklist,
standard or criteria every time.
**no** if each item needs its own custom approach, creativity, or open-ended judgment, or if
the task is not about judging items at all (for example physical production, creative work,
open-ended planning).

### errors_lose_money
**yes** if doing this task wrong (or skipping it) directly causes the organization to lose
money: paying too much, charging too little, missing a bill, paying a fraudulent claim,
approving a bad loan, losing inventory, incurring a fine or penalty.
**no** if errors mainly cost time, quality, safety, satisfaction or reputation, with no
direct money loss.

### loss_recoverable
Only meaningful when errors_lose_money is yes. **yes** if money lost through errors in this
task can typically be found later and recovered: overpayments, duplicate payments, billing
errors, unbilled charges, fraudulent payments that can be clawed back, vendor overcharges.
**no** if the loss is gone once it happens (a bad trading decision, a wasted production run,
a penalty paid), or if errors_lose_money is no (label `no` in that case).

### outcome_visible
**yes** if it is later possible to see whether a judgment made in the task was right, from a
real outcome: a payment, an appeal or audit result, a sale, a default, a returned product, an
error found later, a patient outcome, a test result.
**no** if there is no later outcome that shows whether the judgment was right, or the task
involves no judgment.

### speed_value
**yes** if doing this task much faster would create clear value: fewer delays for customers,
faster payments or cash collection, catching problems sooner, opportunities that would
otherwise be missed, shorter queues.
**no** if speed makes little difference (the task is on a fixed schedule, or quality or
presence matters far more than speed).

### digital_input
**yes** if the information needed for the task is usually already available as digital text
(emails, database records, electronic forms, PDFs with text, spreadsheets, code).
**no** if the inputs are mostly paper, images, audio, physical objects, people in the room,
or the physical environment.

### licensed_signoff
**yes** if a licensed professional (physician, nurse, pharmacist, lawyer, licensed engineer,
CPA, licensed architect, licensed appraiser, etc.) must legally sign off on each judgment in
this task.
**no** if no licensed sign-off is legally required for the output of this task, even if the
worker happens to hold a license.

---

## Level concepts (0-3)

### time_per_item
For one item handled in the task, how long does a trained worker usually need to reach the
judgment or finish the item?
- `0`: seconds to a minute; a quick read and a gut call, like sorting a message into a folder.
- `1`: a few minutes to under an hour; a careful read checked against a policy or checklist,
  like approving a routine expense.
- `2`: hours; an investigation across several documents or sources, like reviewing a complex claim.
- `3`: a day or more of expert analysis or original work, like writing a legal opinion or
  designing a system.
For physical tasks, use the same time bands for one unit of work.

### volume
How many separate items does one worker typically handle in this task?
- `0`: occasional; a few items a week or fewer (includes one-off projects).
- `1`: regular; a handful of items a day.
- `2`: high; a steady queue of dozens a day.
- `3`: very high; a constant stream of hundreds a day.

### money_link
How directly does getting this task right or wrong affect money?
- `0`: no direct or indirect effect on money worth mentioning.
- `1`: indirect; it affects efficiency, quality, safety or satisfaction, which may affect money later.
- `2`: direct; the task decides payments, prices, claims, refunds, fraud, credit or revenue.
- `3`: large and direct; a single judgment in this task can move thousands of dollars or more.

---

## Choice concepts

### buyer
Which kind of organization most often pays for this task to be done (the employer or client
that funds the work)? Pick the best fit:
`insurance`, `banking_fintech`, `accounting_finance_ops` (finance and accounting departments
in any company, and accounting firms), `legal`, `healthcare_admin` (hospitals, clinics,
providers and health administration, including clinical work), `hr_recruiting`,
`customer_support`, `trust_safety`, `sales_marketing`, `ecommerce_marketplaces`,
`logistics_supply_chain` (including transportation, warehousing, purchasing), `real_estate`
(including construction and property), `government` (including public safety, courts,
public administration), `software_it`, `education`, `manufacturing_quality` (manufacturing,
production, repair, energy and utilities), `media_publishing` (including arts and
entertainment), `other` (anything else, e.g. hospitality, personal services, agriculture,
research labs, nonprofits).

### sell_model
What is the most natural way an outside company would get paid for doing this task?
- `contingency`: a share of money recovered or saved.
- `per_item`: a fee for each item processed.
- `subscription`: a monthly software subscription.
- `per_lead`: a fee for each qualified lead or match delivered.
- `not_outsourced`: organizations rarely pay outsiders for this.
- `other`: another arrangement, such as hourly consulting or a fixed project fee.
