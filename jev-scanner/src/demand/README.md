# src/demand: search demand for keyword phrases (stub)

`index.js` exports one function:

```js
lookupVolumes(phrases: string[]) -> Promise<[{ phrase, monthly_volume, cpc_usd, competition }]>
```

Right now it returns `null` for every number. No provider is implemented, and none is called.

## Adding a provider
Put each provider in its own file here, then have `lookupVolumes` pick one, for example through a `DEMAND_PROVIDER` environment variable. Keep the return shape identical so nothing downstream changes:

| Field | Meaning |
|---|---|
| `phrase` | The input phrase, unchanged. |
| `monthly_volume` | Average monthly searches for the chosen country and language. |
| `cpc_usd` | Suggested or average cost per click in US dollars (convert if the account currency differs). |
| `competition` | Advertiser competition normalized to 0..1. |

Candidate adapters:
- **Google Keyword Planner** (`google-ads.js`). Uses the Google Ads API's `KeywordPlanIdeaService.GenerateKeywordHistoricalMetrics`. You need:
  - a Google Ads account;
  - a developer token;
  - OAuth credentials.

  The API returns volumes in ranges unless the account has active spend. `competition` comes back as LOW / MEDIUM / HIGH plus a 0-100 index; divide the index by 100.
- **DataForSEO** (`dataforseo.js`). Uses the Keywords Data API: Google Ads search volume, live or task-based. It needs a login and password, and each request is paid. `competition` is already 0..1.

Rules for any adapter:
- **Credentials:** read them from environment variables or the git-ignored `.env`. Never put them in a tracked file.
- **Batching:** send phrases in batches within the provider's limits (up to 1,000 per request for both).
- **Caching:** cache results in `data/scanner.db`, keyed by phrase + provider + country + month, so re-runs do not pay again.
- **Missing data:** return `null`, never 0, when the provider has no data for a phrase.
