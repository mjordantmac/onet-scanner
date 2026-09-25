// Search-demand lookup for the keyword phrases in out/keywords.csv. This is a stub: no provider is
// wired in yet, so every phrase comes back with null numbers. See README.md in this folder for how to
// add an adapter (Google Keyword Planner or DataForSEO).
//
//   import { lookupVolumes } from './src/demand/index.js';
//   const rows = await lookupVolumes(['medical claims review service', 'invoice audit outsourcing']);
//   // -> [{ phrase, monthly_volume, cpc_usd, competition }, ...]

/**
 * @param {string[]} phrases
 * @returns {Promise<Array<{ phrase: string, monthly_volume: number|null, cpc_usd: number|null, competition: number|null }>>}
 *   monthly_volume: average monthly searches (country-level, provider-defined)
 *   cpc_usd: suggested or average cost per click in US dollars
 *   competition: advertiser competition, normalized to 0..1
 */
export async function lookupVolumes(phrases) {
  if (!Array.isArray(phrases)) throw new TypeError('lookupVolumes expects an array of phrases');
  return phrases.map((phrase) => ({ phrase, monthly_volume: null, cpc_usd: null, competition: null }));
}
