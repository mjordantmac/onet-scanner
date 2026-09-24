# jev-scanner checklist

Ticked items are done. New items found along the way are added under the step they belong to.

## Step 0. Read the TypeSafe docs
- [x] Read every page of docs.typesafe.ai (llms-full.txt, 111 pages, incl. all cookbooks, models, jaggedness, JS + Python SDK reference, example payloads, agent SKILL.md)

## Step 1. Ingest
- [x] Scaffold folder layout, package.json (`@typesafe-ai/sdk` pinned to 0.6.0, better-sqlite3, dotenv)
- [x] Check the SDK's type definitions in node_modules before relying on field names
- [x] Find the latest O*NET release on the database page (31.0, August 2026) and download the text release
- [x] Inspect real headers; load Occupation Data, Task Statements, Task Ratings into SQLite
- [x] Latest BLS OEWS national estimates (May 2025): official zip blocked by BLS bot filter (403), fetched from BLS's official OEWS query service instead
- [x] Map O*NET codes to BLS by first 7 characters; fall back to broad group then minor group residuals; flag the rest
- [x] Split a BLS row evenly among O*NET occupations that share it (no double counting); allocated employment matches the BLS total
- [x] Wage bill = employment x median annual wage (hourly median x 2080 where BLS reports hourly only)
- [x] Task labor_value = task share (importance x relevance, normalized within occupation; equal shares when unrated) x wage bill
- [ ] Record releases and URLs in RUN_REPORT.md

## Step 2. The Jev questions
- [x] Draft 16 questions in config/questions.js (verbatim from the plan)

## Step 3. The Jev runner
- [ ] src/jev-score.js: cache by task ID + question-set hash, model version, request ID, input tokens, timestamp
- [ ] ~15 requests/s with 8 in flight; running cost at $0.042/M input tokens; stop past $10; log every 500 tasks

## Step 4 (replaced). Question design on labeled data
- [x] Pick 15 high and 15 low anchor tasks from the real O*NET list (config/anchors.js)
- [x] A1. Ingest Work Context, Work Activities, Task Ratings frequency (FT), task-to-DWA mapping
- [x] A2. Split recoverable_loss into errors_lose_money + loss_recoverable; add "other" to sell_model; state = occupation + task + task DWAs
- [ ] A3. Audit each concept against O*NET (Work Context, Work Activities, Task Ratings, task-to-DWA mapping); ingest what is useful; decide source and state context; split compound concepts; record in QUESTION_DESIGN.md
- [x] B. Write 3 variants per Jev concept (current draft is one of them) — config/question_variants.js; O*NET code candidates in src/design/features.js
- [x] C1. Sample 240 tasks with a fixed seed (80 likely-good-fit, 80 likely-bad-fit, 80 random) + 30 anchors (src/design/sample.js, seed 20260925)
- [x] C2. Label every concept for every task with subagents, two independent labels per task (18 subagents, 9 batches x labelers A/B)
- [x] C3. Record labeler agreement per concept (89-99%, kappa 0.81-0.98; none below 70%, no rewrites needed)
- [x] C4. Resolve disagreements by reading the tasks (212 labels on 142 tasks, data/labeling/adjudication.json); save data/gold_labels.csv (270 tasks)
- [x] D1. Split labeled tasks 2/3 dev, 1/3 held-out, stratified by sample group (180 dev / 90 held-out, design_tasks table)
- [ ] D2. Run all variants on every labeled task (one call per task, jev-1.13.0, stop past $2)
- [ ] D3. Dev metrics (AUC, Spearman + MAE, accuracy + top-2, spread); up to 3 rewrite rounds per concept below target, dev only
- [ ] D4. Pick best variant per concept on dev; report held-out numbers
- [ ] E1. Correlations between chosen questions; merge or drop any pair above 0.85
- [ ] E2. Update config/questions.js and config/weights.js
- [ ] E3. Anchor check on the final set (12/15 high in top quarter, 12/15 low in bottom quarter of the labeled set)
- [ ] E4. QUESTION_DESIGN.md complete

## Step 5. Full run
- [ ] Run all tasks with the final question set

## Step 6. Rank
- [ ] src/rank.js: filters, fit, money, scale, opportunity, uncertain flag (all weights in config/weights.js)
- [ ] out/ranked_tasks.csv and out/top_tasks.md (top 300)

## Step 7. Themes
- [ ] Group the top 300 into 30-50 themes; out/themes.md

## Step 8. Briefs
- [ ] One subagent per top-20 theme; check every claim against SQLite; out/briefs/01-...20-

## Step 9. Keyword prep
- [ ] 15-20 phrases for each of the top 30 themes; out/keywords.csv

## Step 10. Report
- [ ] RUN_REPORT.md complete
- [ ] src/demand/ stub + README
- [ ] README.md with the O*NET attribution notice
