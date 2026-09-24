// Filters, weights, cost cap and rate limit. Re-ranking after a change here costs nothing:
// src/rank.js reads the cached Jev answers and recomputes every score.

// Always the pinned version, never the moving `jev-latest` alias.
export const MODEL = 'jev-1.13.0';

// Hard filters: a task is dropped if physical >= 0.6 or reads_text < 0.3.
export const FILTERS = {
  physicalDropAtOrAbove: 0.6,
  readsTextDropBelow: 0.3,
};

// fit = 0.20*reads_text + 0.20*closed_outcome + 0.10*(1-writes_content) + 0.05*(1-live_human)
//     + 0.15*(1 - time_per_item/3) + 0.10*same_rules + 0.10*digital_input + 0.10*(1-licensed_signoff)
export const FIT = {
  reads_text: 0.20,
  closed_outcome: 0.20,
  not_writes_content: 0.10,
  not_live_human: 0.05,
  short_time_per_item: 0.15,
  same_rules: 0.10,
  digital_input: 0.10,
  not_licensed_signoff: 0.10,
};

// money = 0.4*(money_link/3) + 0.3*recoverable_loss + 0.3*outcome_visible
export const MONEY = {
  money_link: 0.4,
  recoverable_loss: 0.3,
  outcome_visible: 0.3,
};

// opportunity = fit * (MONEY_FLOOR + (1-MONEY_FLOOR)*money) * (SCALE_FLOOR + (1-SCALE_FLOOR)*scale)
//             * (1 + SPEED_BONUS*speed_value)
export const MONEY_FLOOR = 0.5;
export const SCALE_FLOOR = 0.5;
export const SPEED_BONUS = 0.1;

// Score questions run 0..3, so dividing by the top level puts them on 0..1.
export const SCORE_TOP_LEVEL = 3;

// A task is flagged "uncertain" if any Score answer has confidence below this.
export const UNCERTAIN_CONFIDENCE = 0.4;

// Cost guard: output tokens are free; the run stops if the running total passes the cap.
export const COST = {
  usdPerMillionInputTokens: 0.042,
  usdPerMillionOutputTokens: 0,
  capUsd: 10,
};

// Rate limit: about 15 requests per second with 8 in flight (TypeSafe's published limit for
// jev-1.13.0 is 1,200 requests per minute). Per-call timeout 15 s, at most 2 SDK retries.
export const RATE = {
  requestsPerSecond: 15,
  maxInFlight: 8,
  timeoutMs: 15000,
  maxRetries: 2,
  logEvery: 500,
};

// Pilot: the 30 anchors plus 120 random tasks drawn with a fixed seed.
export const PILOT = {
  randomTasks: 120,
  seed: 20260924,
  quarter: 0.25,
  anchorsNeededPerSide: 12,
};

export const TOP_TASKS = 300;
