// The opportunity score, in code only. Used by src/rank.js and by the design-stage anchor check.
// Every weight and cutoff comes from config/weights.js.
import { FILTERS, FIT, MONEY, MONEY_FLOOR, SCALE_FLOOR, SPEED_BONUS, SCORE_TOP_LEVEL } from '../../config/weights.js';

const clamp01 = (x) => Math.max(0, Math.min(1, x));

// v: concept values. Yes/no concepts are 0..1; time_per_item, volume and money_link are 0..3.
// scale: 0..1 (labor value percentile, or volume/3 when labor value is missing).
export function scoreTask(v, scale) {
  const top = SCORE_TOP_LEVEL;
  const dropped = [];
  if (v.physical >= FILTERS.physicalDropAtOrAbove) dropped.push('physical');
  if (v.reads_text < FILTERS.readsTextDropBelow) dropped.push('reads_text');

  const fit = FIT.reads_text * v.reads_text
    + FIT.closed_outcome * v.closed_outcome
    + FIT.not_writes_content * (1 - v.writes_content)
    + FIT.not_live_human * (1 - v.live_human)
    + FIT.short_time_per_item * (1 - clamp01(v.time_per_item / top))
    + FIT.same_rules * v.same_rules
    + FIT.digital_input * v.digital_input
    + FIT.not_licensed_signoff * (1 - v.licensed_signoff);

  // recoverable_loss was split into two questions; code recombines them.
  const recoverableLoss = v.errors_lose_money * v.loss_recoverable;
  const money = MONEY.money_link * clamp01(v.money_link / top)
    + MONEY.recoverable_loss * recoverableLoss
    + MONEY.outcome_visible * v.outcome_visible;

  const opportunity = fit * (MONEY_FLOOR + (1 - MONEY_FLOOR) * money)
    * (SCALE_FLOOR + (1 - SCALE_FLOOR) * scale) * (1 + SPEED_BONUS * v.speed_value);
  return { passes: dropped.length === 0, dropped, fit, money, recoverable_loss: recoverableLoss, scale, opportunity };
}

// Percentile (0..1) of each value among all values, ties averaged.
export function percentiles(values) {
  const sorted = values.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0]);
  const out = new Array(values.length);
  for (let i = 0; i < sorted.length;) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1][0] === sorted[i][0]) j++;
    const rank = (i + j) / 2;
    for (let k = i; k <= j; k++) out[sorted[k][1]] = sorted.length > 1 ? rank / (sorted.length - 1) : 1;
    i = j + 1;
  }
  return out;
}

// Order used everywhere: tasks that pass the filters first, then by opportunity.
export function rankOrder(a, b) {
  if (a.passes !== b.passes) return a.passes ? -1 : 1;
  return b.opportunity - a.opportunity;
}
