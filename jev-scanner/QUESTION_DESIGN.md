# Question design

This stage replaced the original pilot. The goal was to find, for each concept the ranking uses, the question that measures it best, and to prove that on labeled tasks rather than assume it.

## Result in brief
- **Every concept ended up with a Jev question.** For each concept, a Jev wording beat every measure computable from O*NET ratings, usually by a wide margin.
- **Every chosen question met its target on the dev split in the first round.** So no rewrite rounds were needed.
- **On the held-out split, 16 of 17 concepts meet their target.** The exception is `speed_value`: dev AUC 0.83, held-out 0.71.
- **No two chosen measures correlate above 0.85.** The highest is physical ~ digital_input at -0.78.
- **Anchor check: the high side passes.** All 15 high anchors land in the top quarter of the labeled set.
- **Anchor check: the low side fails as worded.** Only 2 of 15 low anchors land in the bottom quarter. All 15 are removed by the hard filters, so none of them can reach the ranked output. The reason is explained under E3.
- **Jev spend for the whole stage: $0.061.** That was 271 requests and 1.45M input tokens, against a $2 cap.

The table at the end has one row per concept.

**Caveat on the labels.** The "gold" labels are the judgments of two AI labelers (the same model family), adjudicated by me. They are not ground truth. Correlated labeler errors would not show up as disagreement. They could also make Jev look better or worse than it is on concepts where the labelers share a blind spot.

## A. Audit against O*NET

**Data loaded for the audit.** From the O*NET 31.0 text release:
- Work Context: 911 occupations, CX/CT scales.
- Work Activities: importance and level.
- Task Ratings: frequency (FT) as an expected category from 1 (yearly or less) to 7 (hourly or more), for 18,420 tasks.
- The task-to-DWA mapping: 24,087 links covering all 18,838 tasks, with the DWA to IWA to GWA hierarchy.

**Candidate measures.** For each concept, I built every measure that O*NET ratings plausibly support (`src/design/features.js`):
- **Task level:** the share of a task's Detailed Work Activities that fall under a group of Generalized Work Activities, and the task frequency.
- **Occupation level:** Work Context and Work Activities importance. These cannot tell apart two tasks in the same occupation.

These candidates competed with the Jev variants on the same labels, with the same metric. The rule was to prefer an O*NET measure if it came within 0.02 of the best Jev variant on dev.

Candidate results, dev metric (AUC for yes/no concepts, Spearman for level concepts):

| Concept | O*NET measure | Dev | Dev, random group only | Best Jev variant (dev) |
|---|---|---:|---:|---:|
| reads_text | share of DWAs under information GWAs | 0.82 | 0.88 | 0.99 |
| closed_outcome | share of DWAs under judging GWAs | 0.54 | 0.53 | 0.98 |
| writes_content | share of DWAs under documenting / creative GWAs | 0.57 | 0.51 | 0.99 |
| physical | Work Context: hands, standing, not sitting (occupation) | 0.93 | 0.84 | 0.98 |
| physical | share of DWAs under physical GWAs | 0.78 | 0.70 | 0.98 |
| live_human | share of DWAs under interpersonal GWAs | 0.67 | 0.68 | 0.98 |
| live_human | Work Context: face-to-face + public contact (occupation) | 0.60 | 0.78 | 0.98 |
| same_rules | Work Context: importance of repeating same tasks (occupation) | 0.82 | 0.73 | 0.93 |
| same_rules | Work Activities: evaluating compliance with standards (occupation) | 0.67 | 0.68 | 0.93 |
| errors_lose_money | Work Context: consequence of error (occupation) | 0.54 | 0.54 | 0.97 |
| speed_value | Work Context: time pressure (occupation) | 0.60 | 0.62 | 0.83 |
| digital_input | Work Activities: working with computers (occupation) | 0.84 | 0.82 | 0.98 |
| digital_input | share of DWAs under computer / processing GWAs | 0.58 | 0.53 | 0.98 |
| time_per_item | task frequency, inverted | 0.51 | 0.58 | 0.77 |
| volume | task frequency (FT) | 0.63 | 0.75 | 0.75 |
| volume | Work Context: frequency of decision making (occupation) | 0.20 | 0.27 | 0.75 |
| money_link | Work Context: consequence of error (occupation) | 0.06 | -0.05 | 0.70 |
| money_link | Work Context: impact of decisions on results (occupation) | 0.27 | 0.27 | 0.70 |

**Reading the table:**
- Four O*NET measures clear the 0.80 bar on dev: physical, digital_input, reads_text and same_rules. Jev beats each of them by 0.09 to 0.17.
- The "random group only" column is a bias check. The likely-good and likely-bad samples were drawn using an O*NET occupation prior, which can flatter occupation-level measures. On the random group, O*NET's physical measure drops from 0.93 to 0.84.
- No O*NET measure exists for loss_recoverable, outcome_visible or licensed_signoff, or for the buyer and sell_model choices.

**Decision: every concept stays with Jev.** O*NET data is still used in two ways:
- the Detailed Work Activities go into the state (below);
- the labor value and scale come from O*NET task ratings and BLS wages.

**State context.** Each call sends:
- the occupation title and description;
- the task statement;
- the task's O*NET Detailed Work Activities (`detailed_work_activities`, a list of short titles).

The DWAs are included because they are O*NET's own task-level classification, and they disambiguate short or generic task statements. I did not add a Work Context summary. It is occupation-level, so it would push the same numbers onto every task in an occupation. The docs' jaggedness notes also warn that irrelevant state lowers accuracy.

**Compound concepts split.**
- **recoverable_loss** asked two things at once: whether errors lose money, and whether that money can be recovered. It was split into `errors_lose_money` and `loss_recoverable`. `loss_recoverable` is scored only on tasks labeled as losing money, and the formula recombines them: `recoverable_loss = errors_lose_money x loss_recoverable` (`src/lib/scoring.js`). Against the combined label on dev, the split product scores AUC 0.997 and the compound draft 0.996. Splitting cost nothing and makes each half checkable on its own. With only 9 dev and 5 held-out combined positives, both numbers are loose.
- **reads_text** in the draft also said "to reach a judgment". The v2 wording drops that second condition. On dev, the draft still scored best.

**Option lists.**
- `sell_model` gained an `other` option (hourly or project fees). Without it, Jev had to force a fee model onto tasks that have none. The draft's accuracy was 0.52 without `other` and 0.77 with it.
- `buyer` options gained one-line descriptions (v2, v3).

## B. Variants
There are three variants per concept, with the original draft kept as `v1` (`config/question_variants.js`). They differ along the axes the TypeSafe docs identify:
- framing (the "core" or "main activity" of the task vs a concrete situation);
- with vs without criteria;
- question type: a Noul vs a Score with situational levels vs a Choice whose value is the probability of the target option.

The level concepts also got a Noul variant mapped onto the 0-3 scale. That Noul variant won for `time_per_item`.

## C. Labeled set
- **Sample** (`src/design/sample.js`, seed 20260925):
  - 80 likely-good-fit tasks, from the top quartile of occupations by an O*NET work-activity prior;
  - 80 likely-bad-fit tasks, from the bottom quartile;
  - 80 random tasks;
  - the 30 anchors.
  - At most 2 tasks per occupation. 270 tasks in total.
- **Labels.** Two independent AI labelers labeled all 17 concepts for every task, in 9 batches of 30 each. They worked from `data/labeling/LABEL_GUIDE.md` and saw the same occupation, task and DWAs that Jev sees.
- **Agreement.** Every concept was between 89% and 99% (kappa 0.81 to 0.98), with the level concepts at 99% or better within one level. No concept was below 70%, so no definition needed rewriting.
- **Adjudication.** I read each task behind the 212 disagreeing labels, on 142 tasks (`data/labeling/adjudication.json`). Two rules were applied consistently:
  - `outcome_visible` = no for pure physical execution with no judgment;
  - `errors_lose_money` = yes when errors scrap material, cause paid rework or lose revenue.

  `loss_recoverable` is set to no whenever `errors_lose_money` is no.
- **Output.** `data/gold_labels.csv`: 270 tasks, with both raw labels kept. One label is left as "unsure".

## D. Testing
- **Split.** Stratified by sample group: 180 dev, 90 held-out.
- **Round 0.** One Jev call per task carrying all 52 candidate questions: 17 concepts x 3 variants, plus the compound draft. Model `jev-1.13.0`. 270 requests, 0 failures, 1.45M input tokens, $0.061.
- **Metrics:**
  - yes/no concepts: AUC against the label, target 0.80;
  - level concepts: Spearman, target 0.60, plus MAE on the 0-3 scale;
  - choices: accuracy, target 0.70, plus top-2;
  - a spread check that drops near-constant variants.

  No chosen variant was flat.
- **Rewrite rounds.** None. The best variant of every concept met its target on dev in round 0, and rewrites were reserved for concepts below target.
- **Selection.** The highest dev metric wins, with ties going to the earlier variant.
- **Held-out handling.** Held-out numbers were printed alongside dev by the evaluation script. They played no part in any choice, and nothing was tuned after seeing them.
- **Held-out confidence intervals.** 95% intervals are from 1,000 seeded bootstrap resamples.

## E. Final set

**E1 correlations.** These are Pearson correlations between the chosen measures across the 270 labeled tasks. None exceeds 0.85, so nothing was merged or dropped. The highest:

| Pair | r |
|---|---:|
| physical ~ digital_input | -0.78 |
| errors_lose_money ~ money_link | 0.76 |
| errors_lose_money ~ outcome_visible | 0.76 |
| outcome_visible ~ money_link | 0.73 |
| reads_text ~ closed_outcome | 0.66 |
| closed_outcome ~ same_rules | 0.65 |

**E2 configuration.**
- `config/questions.js`: `SELECTED` names the chosen variant per concept, and the wording is taken from `config/question_variants.js`, so what was tested is exactly what runs.
- The full run asks 17 questions: 11 Nouls, 3 Scores (physical, volume, money_link) and 3 Choices (digital_input, buyer, sell_model).
- `config/weights.js`: the weights are unchanged. It now documents the `recoverable_loss` recombination, and that the "uncertain" flag reads the three Score confidences.

**E3 anchor check.** All 270 labeled tasks were scored with the chosen questions and the specified formula. Ranking: tasks that pass the filters first, by opportunity, then filtered tasks by opportunity.

| | Result |
|---|---|
| High anchors in the top quarter (target 12) | **15/15** |
| Low anchors in the bottom quarter (target 12) | **2/15**, so the check fails as worded |
| Low anchors removed by the hard filters | 15/15. 14 by both filters; the live teaching task by reads_text alone (physical 0.48) |
| Labeled tasks passing the filters | 65 of 270 |

Why the low side fails as worded:
- **The filters remove 76% of the labeled set.** Because of that, the bottom quarter (67 tasks) is a slice of filtered tasks.
- **Physical work is not part of the opportunity score**, only of the filter. So inside the filtered group, the order is set by fit, money and labor value.
- **The low anchors are high-wage, money-linked physical jobs** (surgery, plumbing, welding). They therefore sit in the middle of the filtered group.
- **The lowest opportunity scores go to non-physical tasks that are open-ended or relationship-based**, such as directing dance performances, attending conferences and advising student groups.

Jev's answers do separate the low anchors cleanly: physical ≥ 0.95 on 14 of 15, and reads_text ≤ 0.06 on all 15. In the actual output no low anchor can appear, because filtered tasks are never ranked.

I did not change the formula to force a pass, because the formula is the owner's specification. If a strict bottom-quarter pass matters, the smallest change would be to rank filtered tasks by how far they fail the filters. The other option is to add a `(1 - physical)` term to fit. Either one needs the owner's OK.

## Concepts below target, and recommendations
- **speed_value** (held-out AUC 0.71, CI 0.56-0.84; dev 0.83). It also had the second-lowest labeler agreement among yes/no concepts (94%). "Would doing it much faster create clear value" is a judgment call for many tasks.
  - It only affects the score through a bonus of at most +10%, so the impact on rankings is small.
  - Recommendation: next time, try a concrete wording tied to a cost of delay, e.g. "Is there a queue of items where each hour of waiting delays a payment, a customer or a decision?". Test it on new dev labels.
- **Near the line on held-out** (these meet the target, but their intervals cross it):
  - `money_link`: 0.61, CI 0.47-0.71;
  - `time_per_item`: 0.69, CI 0.55-0.80;
  - `errors_lose_money`: 0.84, CI 0.72-0.94;
  - `outcome_visible`: 0.85, CI 0.76-0.93.

  These are the money and effort judgments. Treat small differences between tasks on them as noise. In the ranking, the "uncertain" flag marks the tasks where a Score answer was split.
- **Uncertain flag rate.** In the labeled set, 86 of 270 tasks have at least one Score answer below 0.4 confidence. Most of these fall between two neighboring levels. For physical, both of those levels usually lead to the same filter decision.

## Summary table

| Concept | Source | Final wording | Variants tried (dev metric) | Labeler agreement | Dev metric | Held-out metric | What changed |
|---|---|---|---|---|---|---|---|
| reads_text | Jev (v1) | Noul: "Is the core of `task` reading or reviewing written or digital information, such as documents, forms, messages, records, listings, transcripts or code, to reach a judgment?" (yes = "Most of the work is reading information and judging it."; no = "Most of the work is physical, conversational, creative, or done with tools or equipment.") | v1 0.99, v2 0.98, v3 0.98, code:gwa_information 0.82 | 97% | AUC 0.99 | AUC 0.99 [95% CI 0.98-1.00] | kept the draft |
| closed_outcome | Jev (v1) | Noul: "Does `task` end in a decision picked from a small, known set of outcomes, such as approve or deny, a category, a priority level, match or no match, or a ranking?" (yes = "The result is one pick from a known set of options."; no = "The result is new written content, a design, a conversation, or a physical change.") | v1 0.98, v2 0.98, v3 0.96, code:gwa_judging 0.54 | 99% | AUC 0.98 | AUC 1.00 [95% CI 0.98-1.00] | kept the draft |
| writes_content | Jev (v2) | Noul: "Does `task` produce a new document, such as a report, letter, article, plan, proposal or program code, as its main result?" (yes = "The main result is a new document or code written by the worker."; no = "The main result is a decision, a check, a physical result or a conversation; any writing is notes or form-filling.") | v1 0.98, v2 0.99, v3 0.95, code:gwa_writing 0.57 | 98% | AUC 0.99 | AUC 0.99 [95% CI 0.97-1.00] | replaced the draft with v2: "new document as the main result" framing; notes and form-filling named on the false side |
| physical | Jev (v3) | Score: "How much of `task` is physical, hands-on work?" Levels 0-3: 0 "None: all of it can be done at a desk or computer."; 1 "A little: mostly desk work with occasional hands-on steps."; 2 "Mostly hands-on work with some desk work."; 3 "All hands-on: handling objects, people, tools, vehicles or equipment." | v1 0.98, v2 0.97, v3 0.98, code:gwa_physical 0.78, code:wc_physical 0.93 | 99% | AUC 0.98 | AUC 1.00 [95% CI 0.99-1.00] | replaced the draft with v3: Score, 4 situational levels |
| live_human | Jev (v2) | Noul: "Is talking with people in real time, in person or by phone, the main activity in `task`?" (yes = "Most of the task is live conversation: interviewing, advising, teaching, selling, negotiating or serving someone."; no = "Most of the task is done without live conversation.") | v1 0.97, v2 0.98, v3 0.98, code:gwa_interpersonal 0.67, code:wc_contact 0.60 | 98% | AUC 0.98 | AUC 1.00 [95% CI 0.99-1.00] | replaced the draft with v2: real-time talk framing (in person or by phone) |
| same_rules | Jev (v2) | Noul: "In `task`, does the worker apply a fixed set of written rules, policies, standards or checklists to each item?" (yes = "Each item is checked against the same fixed standard."; no = "Items are handled with custom judgment, creativity or open-ended problem solving, or the task does not judge items.") | v1 0.58, v2 0.93, v3 0.79, code:wc_repeat 0.82, code:wa_compliance 0.67 | 97% | AUC 0.93 | AUC 0.95 [95% CI 0.89-0.99] | replaced the draft with v2: "fixed written rules applied to each item"; non-judging tasks on the false side |
| errors_lose_money | Jev (v2) | Noul: "Can a mistake in `task` directly cost the organization money, for example by paying too much, charging too little, paying a fraudulent claim or incurring a penalty?" | v1 0.95, v2 0.97, v3 0.84, code:wc_consequence 0.54 | 95% | AUC 0.97 | AUC 0.84 [95% CI 0.72-0.94] | replaced the draft with v2: "a mistake can directly cost money" with examples, no criteria |
| loss_recoverable | Jev (v1) | Noul: "If a mistake in `task` loses money, can that money usually be found and recovered later, as with overpayments, duplicate payments, billing errors or clawed-back fraud?" (yes = "Lost money can be found and recovered later."; no = "Lost money is gone, or mistakes do not lose money.") | v1 1.00, v2 0.76, v3 0.83 | 99% | AUC 1.00 | AUC 1.00 [95% CI 1.00-1.00] | kept the draft |
| outcome_visible | Jev (v1) | Noul: "Is it later possible to see whether a judgment made in `task` was right, from a real outcome such as a payment, an appeal result, a sale, or an error found later?" (yes = "Real outcomes later show whether each judgment was right."; no = "There is no later outcome that shows whether a judgment was right.") | v1 0.90, v2 0.90, v3 0.77 | 93% | AUC 0.90 | AUC 0.85 [95% CI 0.76-0.93] | kept the draft |
| speed_value | Jev (v2) | Noul: "Would finishing `task` in minutes instead of hours or days reduce waiting for customers, payments or decisions?" (yes = "Faster completion clearly reduces delays or captures value."; no = "Speed matters little because the task runs on a schedule, needs someone present, or is limited by quality rather than time.") | v1 0.83, v2 0.83, v3 0.76, code:wc_time_pressure 0.60 | 94% | AUC 0.83 | AUC 0.71 [95% CI 0.56-0.84] **below the 0.8 target** | replaced the draft with v2: concrete "minutes instead of hours or days" framing |
| digital_input | Jev (v3) | Choice: "What form do the inputs to `task` usually take?" Options: digital_text ("Emails, database records, electronic forms, documents or code on a computer"); paper ("Paper documents or forms"); images_or_audio ("Photos, scans, drawings, video, audio or speech"); people_in_person ("People present in person"); physical_objects ("Physical objects, materials, machines or places"); other ("Something else") | v1 0.94, v2 0.96, v3 0.98, code:gwa_computer 0.58, code:wa_computers 0.84 | 97% | AUC 0.98 | AUC 0.99 [95% CI 0.98-1.00] | replaced the draft with v3: Choice over input forms with "other"; value = P(digital text) |
| licensed_signoff | Jev (v3) | Noul: "Each judgment in `task` legally requires sign-off from a licensed professional." | v1 0.95, v2 0.96, v3 0.96 | 99% | AUC 0.96 | AUC 0.97 [95% CI 0.93-1.00] | replaced the draft with v3: statement form, no criteria |
| time_per_item | Jev (v3) | Noul: "Can a trained worker finish one item of `task` in a few minutes or less?" | v1 0.65, v2 0.76, v3 0.77, code:ft_frequency_inverse 0.51 | 89% (within one level 99%) | Spearman 0.77, MAE 0.46 | Spearman 0.69, MAE 0.49 [95% CI 0.54-0.80] | replaced the draft with v3: Noul "one item takes a few minutes or less", inverted onto the level scale |
| volume | Jev (v2) | Score: "How often does one worker handle a new item in `task`?" Levels 0-3: 0 "Now and then: the task comes up occasionally or as one-off projects."; 1 "Several times a day."; 2 "All day long from a steady queue."; 3 "A constant, fast stream where each item takes moments." | v1 0.51, v2 0.75, v3 0.60, code:ft_frequency 0.63, code:wc_decision_frequency 0.20 | 91% (within one level 99%) | Spearman 0.75, MAE 0.43 | Spearman 0.88, MAE 0.34 [95% CI 0.82-0.92] | replaced the draft with v2: levels as situations (queue, stream), no numbers |
| money_link | Jev (v1) | Score: "How directly does getting `task` right or wrong affect money?" Levels 0-3: 0 "No direct effect on money."; 1 "Indirect: it affects efficiency, quality or satisfaction."; 2 "Direct: it decides payments, prices, claims, refunds, fraud or revenue."; 3 "Large and direct: a single judgment can move thousands of dollars or more." | v1 0.70, v2 0.69, v3 0.61, code:wc_consequence 0.05, code:wc_impact 0.26 | 92% (within one level 100%) | Spearman 0.70, MAE 0.40 | Spearman 0.61, MAE 0.37 [95% CI 0.47-0.71] | kept the draft |
| buyer | Jev (v3) | Choice: "Which industry or department most often employs the workers who do `task`?" Options: insurance ("Insurance carriers, brokers and claims administrators"); banking_fintech ("Banks, credit unions, lenders, payment and fintech companies"); accounting_finance_ops ("Finance and accounting departments of any company, and accounting firms"); legal ("Law firms and corporate legal departments"); healthcare_admin ("Hospitals, clinics, care providers and health administration"); hr_recruiting ("HR departments, recruiters and staffing firms"); customer_support ("Customer service and support departments"); trust_safety ("Content moderation, fraud prevention and trust and safety teams"); sales_marketing ("Sales and marketing departments and agencies"); ecommerce_marketplaces ("Online stores, retailers and marketplaces"); logistics_supply_chain ("Transportation, warehousing, purchasing and supply chain operations"); real_estate ("Real estate, property management and construction"); government ("Government agencies, courts and public safety"); software_it ("Software companies and IT departments"); education ("Schools, universities and training providers"); manufacturing_quality ("Manufacturing, production, repair, energy and utilities"); media_publishing ("Media, publishing, arts and entertainment"); other ("Any other kind of organization, such as hospitality, personal services, agriculture, research or nonprofits") | v1 0.78, v2 0.87, v3 0.91 | 97% | accuracy 0.91, top-2 0.99 | accuracy 0.92, top-2 0.99 [95% CI 0.87-0.97] | replaced the draft with v3: "which department or industry employs the worker" framing, described options |
| sell_model | Jev (v2) | Choice: "What is the most natural way an outside company would get paid for doing `task`?" Options: contingency ("A share of money recovered or saved"); per_item ("A fee for each item processed"); subscription ("A monthly software subscription"); per_lead ("A fee for each qualified lead or match delivered"); not_outsourced ("Organizations rarely pay outsiders for this."); other ("Another arrangement, such as hourly consulting or a fixed project fee") | v1 0.52, v2 0.77, v3 0.75 | 89% | accuracy 0.77, top-2 0.91 | accuracy 0.79, top-2 0.98 [95% CI 0.70-0.87] | replaced the draft with v2: draft plus an "other" option (hourly or project fees) |

Compound draft `recoverable_loss` against the combined label (money lost AND recoverable): dev AUC 1.00, held-out 1.00.

## Reproduce
```
npm run design:run            # round 0: all variants, all 270 labeled tasks (stage cap $2)
npm run design:eval           # metrics, selection, correlations, anchor check -> data/design/*.json
node src/design/design-table.js > data/design/table.md
```
