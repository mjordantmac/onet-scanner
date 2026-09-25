# jev-scanner

jev-scanner scores every O*NET task for how well TypeSafe's Jev model (`jev-1.13.0`) could do it. It ranks the tasks by business opportunity and turns the best ones into service ideas: themes, briefs and keyword lists.

Jev answers a fixed set of questions about each task. Every score, filter and ranking is computed in code from those answers, with the weights in `config/weights.js`.

## What's here

| Path | What it is |
|---|---|
| `src/ingest-onet.js` | Downloads the latest O*NET text release and loads it into SQLite: occupations, tasks, task ratings, Work Context, Work Activities, task-to-DWA links |
| `src/ingest-bls.js` | Loads BLS OEWS national employment and wages, joins them to O*NET codes, and computes each task's labor value |
| `config/question_variants.js` | Every candidate question wording tested; `v1` is the original draft |
| `config/questions.js` | The final question set (`SELECTED`) and the state Jev sees for each task |
| `config/weights.js` | Filters, weights, the $10 cost cap, and the rate limit |
| `config/anchors.js` | 15 clearly-good and 15 clearly-bad tasks used as sanity checks |
| `src/design/` | The question-design stage: labeled sample, variant runs, evaluation (see QUESTION_DESIGN.md) |
| `src/jev-score.js` | Asks Jev the final questions and caches every answer (by task + question-set hash) |
| `src/rank.js` | Computes fit, money, scale and opportunity, and writes the ranked outputs |
| `src/demand/` | Stub for search-volume lookups (no provider implemented) |
| `data/scanner.db.gz` | Everything: source data, labels, every Jev answer, run logs. Stored compressed because the database (~115 MB) is over GitHub's 100 MB file limit: `npm run db:unpack` restores `data/scanner.db`, `npm run db:pack` re-creates the archive |
| `data/gold_labels.csv` | 270 labeled tasks used to choose the questions |
| `out/` | `ranked_tasks.csv`, `top_tasks.md`, `themes.md`, `briefs/`, `keywords.csv` |
| `TASKS.md`, `RUN_REPORT.md`, `QUESTION_DESIGN.md` | Checklist, run record, question-design record |

## Setup
```
npm ci
npm run db:unpack    # restore data/scanner.db from the committed archive
```
Requirements:
- Node 20 or newer.
- Node 22.21 or newer if you use the environment-credential key option below.

## The TypeSafe API key
The code reads the key from one of two places. It never goes in a tracked file.

1. **An environment variable.** `TYPESAFE_API_KEY` in the shell, or in `jev-scanner/.env`. `.env` is git-ignored; copy `.env.example` to create it.
2. **A Claude cloud-environment credential.**
   - Where to add it: the environment's Add credential screen.
   - Allowed website: `api.typesafe.ai`.
   - Header: `Authorization`, prefix `Bearer`.
   - How it works: the session's network proxy adds the key to each request, so the key never enters the session. The code then drops the SDK's own `Authorization` header (the proxy only fills in a missing one).
   - Node must send its requests through the proxy, which needs `NODE_USE_ENV_PROXY=1`. The npm scripts set it.

## Run it
```
npm run ingest              # O*NET + BLS -> data/scanner.db
npm run design:run          # question design: all variants on the 270 labeled tasks (cap $2)
npm run design:eval         # pick the best question per concept; correlations; anchor check
npm run pilot               # anchors + 120 random tasks with the final questions
npm run score:all           # every task (cap $10 across all scoring runs; re-running only asks what is missing)
npm run rank                # out/ranked_tasks.csv, out/top_tasks.md
```

## How a task is scored

**Filters.** A task is dropped if physical ≥ 0.6 or reads_text < 0.3.

**Formulas:**
```
fit         = 0.20 reads_text + 0.20 closed_outcome + 0.10 (1 - writes_content) + 0.05 (1 - live_human)
            + 0.15 (1 - time_per_item/3) + 0.10 same_rules + 0.10 digital_input + 0.10 (1 - licensed_signoff)
money       = 0.4 (money_link/3) + 0.3 recoverable_loss + 0.3 outcome_visible
              where recoverable_loss = errors_lose_money x loss_recoverable
scale       = percentile of the task's labor value among all O*NET tasks (volume/3 when there is no wage data)
opportunity = fit (0.5 + 0.5 money) (0.5 + 0.5 scale) (1 + 0.1 speed_value)
```

**Uncertain flag.** A task is flagged "uncertain" when any Score answer has confidence below 0.4.

**Labor value is an estimate.** It is BLS employment × median annual wage for the occupation, times the task's share of the occupation's rated tasks. The share uses importance × relevance, with equal shares when ratings are missing.

## Data sources
- **O*NET 31.0 Database** (August 2026 release), https://www.onetcenter.org/database.html. Files used:
  - Task Statements
  - Task Ratings
  - Occupation Data
  - Work Context
  - Work Activities
  - Tasks to DWAs
  - DWA Reference
- **BLS Occupational Employment and Wage Statistics (OEWS), May 2025**: national, cross-industry estimates.
  - Source: the official BLS OEWS query service (https://data.bls.gov/oes/).
  - The flat-file download returned 403 to scripted requests.

Release details, URLs and file checksums are in RUN_REPORT.md.

## O*NET attribution
This page includes information from the [O*NET 31.0 Database](https://www.onetcenter.org/database.html) by the U.S. Department of Labor, Employment and Training Administration (USDOL/ETA). Used under the [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) license. O*NET® is a trademark of USDOL/ETA. The jev-scanner project has modified all or some of this information. USDOL/ETA has not approved, endorsed, or tested these modifications.

See the O*NET database license: https://www.onetcenter.org/license_db.html.
