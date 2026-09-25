// Shared Jev client: pinned model, rate limit (requests/s + max in flight), per-call timeout and
// retries, request IDs, and a running cost guard. Field names checked against the SDK's
// dist/index.d.mts (0.6.0): result.model, result.answers, result.usage.input_tokens;
// APIPromise.withResponse() -> { data, requestId }.
//
// Where the key comes from (it never appears in code, logs or git):
//   1. TYPESAFE_API_KEY in the environment or the git-ignored jev-scanner/.env, sent by the SDK; or
//   2. a Claude cloud-environment credential for api.typesafe.ai (the owner's choice), which the
//      session's network proxy adds to each request. The proxy only fills in a missing Authorization
//      header, so in this mode a fetch wrapper leaves the SDK's own header off (the SDK insists on a
//      non-empty apiKey, so it gets a placeholder that is never sent). Node's fetch uses the proxy
//      only when started with NODE_USE_ENV_PROXY=1, which the npm scripts set.
import { resolve } from 'node:path';
import dotenv from 'dotenv';
import { TypeSafeClient, APIError } from '@typesafe-ai/sdk';
import { ROOT } from './db.js';
import { MODEL, RATE, COST } from '../../config/weights.js';

dotenv.config({ path: resolve(ROOT, '.env'), quiet: true });

export class CostCapError extends Error {}
export class MissingKeyError extends Error {}

const PLACEHOLDER_KEY = 'supplied-by-environment-credential';

function withoutAuthHeader(input, init = {}) {
  const headers = Object.fromEntries(Object.entries(init.headers || {})
    .filter(([name, value]) => value !== undefined && name.toLowerCase() !== 'authorization'));
  return globalThis.fetch(input, { ...init, headers });
}

// { apiKey, fetch?, mode } for the TypeSafeClient constructor.
export function authOptions() {
  const key = (process.env.TYPESAFE_API_KEY || '').trim();
  if (key) return { apiKey: key, mode: 'env' };
  // Node's fetch only goes through the session proxy (which adds the key) with NODE_USE_ENV_PROXY=1;
  // the npm scripts set it.
  if ((process.env.HTTPS_PROXY || process.env.https_proxy) && process.env.NODE_USE_ENV_PROXY !== '1') {
    throw new MissingKeyError('TYPESAFE_API_KEY is not set. To use the environment credential instead, run with NODE_USE_ENV_PROXY=1 (the npm scripts do).');
  }
  return { apiKey: PLACEHOLDER_KEY, fetch: withoutAuthHeader, mode: 'environment_credential' };
}

export function costOf(inputTokens, outputTokens = 0) {
  return (inputTokens / 1e6) * COST.usdPerMillionInputTokens + (outputTokens / 1e6) * COST.usdPerMillionOutputTokens;
}

// Paces request starts to `rps` and caps concurrent requests at `maxInFlight`.
export class Limiter {
  constructor({ rps = RATE.requestsPerSecond, maxInFlight = RATE.maxInFlight } = {}) {
    this.interval = 1000 / rps;
    this.maxInFlight = maxInFlight;
    this.inFlight = 0;
    this.nextStart = 0;
    this.waiters = [];
  }

  async acquire() {
    while (this.inFlight >= this.maxInFlight) await new Promise((r) => this.waiters.push(r));
    this.inFlight += 1;
    const now = Date.now();
    const start = Math.max(now, this.nextStart);
    this.nextStart = start + this.interval;
    if (start > now) await new Promise((r) => setTimeout(r, start - now));
  }

  release() {
    this.inFlight -= 1;
    const w = this.waiters.shift();
    if (w) w();
  }
}

export class JevSession {
  constructor({ capUsd = COST.capUsd, model = MODEL, label = 'run' } = {}) {
    const { mode, ...auth } = authOptions();
    this.authMode = mode;
    this.authFailed = null;
    this.client = new TypeSafeClient({ ...auth, timeout: RATE.timeoutMs, retry: { maxRetries: RATE.maxRetries }, logLevel: 'warn' });
    this.model = model;
    this.capUsd = capUsd;
    this.label = label;
    this.limiter = new Limiter();
    this.inputTokens = 0;
    this.outputTokens = 0;
    this.requests = 0;
    this.failures = 0;
    this.modelsSeen = new Map();
    this.stopped = false;
  }

  get costUsd() { return costOf(this.inputTokens, this.outputTokens); }

  // One call. Returns { answers, model, requestId, inputTokens, outputTokens }.
  async ask(state, questions) {
    if (this.authFailed) throw new MissingKeyError(this.authFailed);
    if (this.stopped) throw new CostCapError(`${this.label}: stopped, cost cap $${this.capUsd} passed`);
    await this.limiter.acquire();
    try {
      const { data, requestId } = await this.client
        .systemOne({ state, questions, model: this.model }, { timeout: RATE.timeoutMs, retry: { maxRetries: RATE.maxRetries } })
        .withResponse();
      this.requests += 1;
      this.inputTokens += data.usage.input_tokens || 0;
      this.outputTokens += data.usage.output_tokens || 0;
      this.modelsSeen.set(data.model, (this.modelsSeen.get(data.model) || 0) + 1);
      if (this.costUsd > this.capUsd) this.stopped = true;
      return { answers: data.answers, model: data.model, requestId: requestId ?? null,
        inputTokens: data.usage.input_tokens || 0, outputTokens: data.usage.output_tokens || 0 };
    } catch (err) {
      this.failures += 1;
      if (err instanceof APIError && err.status === 401) {
        this.authFailed = this.authMode === 'env'
          ? 'TypeSafe rejected TYPESAFE_API_KEY (401). Check the key in the environment or jev-scanner/.env.'
          : 'No TypeSafe key: TYPESAFE_API_KEY is not set and no environment credential for api.typesafe.ai was applied (401).';
        throw new MissingKeyError(this.authFailed);
      }
      throw err;
    } finally {
      this.limiter.release();
    }
  }

  summary() {
    return { auth_mode: this.authMode, requests: this.requests, failures: this.failures, input_tokens: this.inputTokens,
      output_tokens: this.outputTokens, cost_usd: Number(this.costUsd.toFixed(6)),
      models_seen: Object.fromEntries(this.modelsSeen) };
  }
}

export function describeError(err) {
  if (err instanceof APIError) return { status: err.status, requestId: err.requestId ?? null, message: err.message };
  return { status: null, requestId: null, message: String(err && err.message ? err.message : err) };
}
