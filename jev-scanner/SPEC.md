# jev-scanner spec (the owner's instructions, kept so any session can continue the work)

Goal: score every O*NET task for how well TypeSafe's Jev model fits it, then turn the best ones into business ideas.
Progress is tracked in TASKS.md. Start from its "RESUME HERE" section.

## Ground rules
- Keep going whenever a step doesn't need the owner's input.
- Stop and ask the owner only when:
  - TYPESAFE_API_KEY is missing when a Jev call is needed;
  - question-design Jev spend passes $2;
  - full-run spend passes $10 (the cost cap);
  - before deleting data;
  - before changing anything outside the `jev-scanner/` folder.
- A concept that misses its target after 3 rewrite rounds is not a reason to stop. Record it and continue.
- The API key comes from the `TYPESAFE_API_KEY` environment variable or the git-ignored `jev-scanner/.env`.
  - Never put the key in a tracked file.
  - Never print it.
  - Never ask for it in chat.
- The repo is public.
- Work only on branch `claude/ecstatic-albattani-8z0i7j`. Do not open a PR unless asked.
- Tick items in TASKS.md as they are finished.

## Stack
- Node 20+ ESM, better-sqlite3, dotenv.
- `@typesafe-ai/sdk` pinned exactly to 0.6.0.
- Call shape: `client.systemOne({ state, questions, model }, { timeout: 15000, retry: { maxRetries: 2 } })`.
- The model is always `jev-1.13.0`, never `jev-latest`.
- All math is done in code, never by Jev.

## Layout
- Config:
  - `config/questions.js`
  - `config/weights.js` (filters, weights, $10 cap, rate limit)
  - `config/anchors.js`
- Scripts:
  - `src/ingest-onet.js`
  - `src/ingest-bls.js`
  - `src/jev-score.js` (`--pilot`, `--all`, `--limit N`)
  - `src/rank.js`
- `src/demand/` is a stub. It exports `lookupVolumes(phrases)`, which returns `[{ phrase, monthly_volume, cpc_usd, competition }]`. Its README says adapters for Google Keyword Planner or DataForSEO go there. Do not implement a provider.
- Data and outputs: `data/scanner.db` and `out/`.
- Docs:
  - `TASKS.md`
  - `RUN_REPORT.md`
  - `README.md`, including this O*NET attribution notice (modified-content form):
    > This page includes information from the O*NET 31.0 Database by the U.S. Department of Labor, Employment and Training Administration (USDOL/ETA). Used under the CC BY 4.0 license. O*NET® is a trademark of USDOL/ETA. [name] has modified all or some of this information. USDOL/ETA has not approved, endorsed, or tested these modifications.

    Link it to https://creativecommons.org/licenses/by/4.0/ and https://www.onetcenter.org/license_db.html.

## Steps
1. **Ingest** (done). O*NET text release plus the BLS OEWS national file.
   - Match codes on the first 7 characters. Fall back to the broader group, or flag the occupation.
   - Wage bill = employment × median wage.
   - Task labor_value comes from its importance/relevance share of the occupation. Use equal shares when ratings are missing.
   - Record releases and URLs in RUN_REPORT.md.
2. **Questions** (done). The 16 draft questions, verbatim, are `v1` in `config/question_variants.js`.
3. **Runner** (`src/jev-score.js`).
   - Cache answers by task ID + question-set hash.
   - Store the model version, request ID, input tokens and timestamp.
   - About 15 requests/s with 8 in flight.
   - Cost is $0.042 per million input tokens. Stop past $10 and ask.
   - Log every 500 tasks.
4. **Question design** (replaces the pilot).
   - A. Audit each concept against O*NET (Work Context, Work Activities, Task Ratings, task-to-DWA).
     - Compute a concept in code if a reliable rating exists.
     - Decide the state context and split compound concepts.
     - Record all of this in QUESTION_DESIGN.md.
   - B. Write 3 variants per Jev concept, with the draft as one of them.
   - C. Build the labeled set: 240 seeded tasks (80 likely-good, 80 likely-bad, 80 random) plus 30 anchors.
     - Get two independent labels per task and adjudicate disagreements.
     - Rewrite any definition with agreement under 70%.
     - Save the result as data/gold_labels.csv. These labels are judgments, not ground truth.
   - D. Split the labeled set 2/3 dev and 1/3 held-out, stratified.
     - Run all variants with one call per task on jev-1.13.0. Stop past $2.
     - Targets:
       - Binary: AUC ≥ 0.80.
       - Level: Spearman ≥ 0.60, plus MAE.
       - Choice: accuracy ≥ 0.70, plus top-2.
       - Spread: drop flat variants.
     - Allow up to 3 rewrite rounds per concept, on dev only.
     - Pick the best variant on dev and report held-out. Never tune on held-out.
   - E. Finalize.
     - Merge or drop any pair of concepts correlated above 0.85.
     - Update questions.js and weights.js.
     - Anchor check: at least 12/15 high anchors in the top quarter, and at least 12/15 low anchors in the bottom quarter, of the labeled set.
     - QUESTION_DESIGN.md gets one table with columns: concept, source, final wording, variants tried, agreement, dev metric, held-out metric, what changed. Note concepts still below target, with recommendations.
5. **Full run**: all tasks, final question set.
6. **Rank** (`src/rank.js`, code only; all weights live in config/weights.js).
   - Drop a task if physical ≥ 0.6 or reads_text < 0.3.
   - fit = 0.20·reads_text + 0.20·closed_outcome + 0.10·(1−writes_content) + 0.05·(1−live_human) + 0.15·(1−time_per_item/3) + 0.10·same_rules + 0.10·digital_input + 0.10·(1−licensed_signoff)
   - money = 0.4·(money_link/3) + 0.3·recoverable_loss + 0.3·outcome_visible, where recoverable_loss = errors_lose_money × loss_recoverable after the split.
   - scale = labor_value percentile, or volume/3 when labor_value is missing.
   - opportunity = fit·(0.5+0.5·money)·(0.5+0.5·scale)·(1+0.1·speed_value)
   - Flag a task "uncertain" if any Score answer has confidence < 0.4.
   - Outputs: `out/ranked_tasks.csv` and `out/top_tasks.md` (top 300).
7. **Themes** (written by Claude, not Jev). Group the top 300 tasks into 30–50 themes.
   - Each theme gets:
     - a name;
     - a one-sentence description;
     - member task IDs;
     - total labor_value and average opportunity;
     - the main buyer and sell_model.
   - Rank themes by total labor_value × average opportunity.
   - Output: `out/themes.md`.
8. **Briefs.** One subagent per theme for the top 20 themes. Check every claim against SQLite.
   - Each brief covers:
     - the service and buyer;
     - why Jev fits;
     - a pipeline sketch;
     - pricing;
     - a size estimate, labeled as an estimate;
     - Jev's weaknesses here;
     - 3 customer types;
     - a 7-day validation plan.
   - Output: `out/briefs/01-<slug>.md` through `20-…`.
9. **Keywords.** For each of the top 30 themes, 15–20 phrases worded the way buyers search, each tagged `buyer_intent` or `research_intent`.
   - Output: `out/keywords.csv` with columns theme_id, theme_name, phrase, intent.
   - No volume lookups.
10. **RUN_REPORT.md.**
    - Releases.
    - Counts: total, filtered, scored, uncertain.
    - Tokens and dollars.
    - Model versions seen.
    - Anchor results and question changes.
    - Run time.
    - A top-10 themes table.
    - Mark anything unconfirmed.

When all Jev work is done, tell the owner.
