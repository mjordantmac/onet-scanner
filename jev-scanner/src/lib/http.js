// Download helpers. Every download is recorded so RUN_REPORT.md can say exactly what was used.
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export const USER_AGENT = 'jev-scanner/1.0 (+https://github.com/mjordantmac/onet-scanner; O*NET and OEWS research script)';

// Try each route in order until one returns 2xx and passes `validate`. Caches to `dest`.
// Each route is { url, method?, body?, headers? }. Returns { route, bytes, fromCache, attempts }.
export async function downloadFirst(routes, dest, { validate = () => true, force = false } = {}) {
  const attempts = [];
  if (!force && existsSync(dest)) {
    const buf = readFileSync(dest);
    if (validate(buf)) return { route: null, buf, fromCache: true, attempts };
  }
  for (const route of routes) {
    try {
      const res = await fetch(route.url, {
        method: route.method || 'GET',
        headers: { 'User-Agent': USER_AGENT, Accept: '*/*', ...(route.headers || {}) },
        body: route.body,
      });
      const buf = Buffer.from(await res.arrayBuffer());
      attempts.push({ url: route.url, method: route.method || 'GET', status: res.status, bytes: buf.length });
      if (!res.ok) continue;
      if (!validate(buf)) {
        attempts[attempts.length - 1].rejected = 'failed validation';
        continue;
      }
      mkdirSync(dirname(dest), { recursive: true });
      writeFileSync(dest, buf);
      return { route, buf, fromCache: false, attempts };
    } catch (err) {
      attempts.push({ url: route.url, method: route.method || 'GET', error: String(err.message || err) });
    }
  }
  const detail = attempts.map((a) => `${a.method} ${a.url} -> ${a.status ?? a.error}${a.rejected ? ` (${a.rejected})` : ''}`).join('\n  ');
  const err = new Error(`All download routes failed:\n  ${detail}`);
  err.attempts = attempts;
  throw err;
}

// Parse a tab-delimited O*NET text file into objects keyed by the file's own header row.
export function parseTsv(text) {
  const lines = text.replace(/\r/g, '').split('\n').filter((l) => l.length > 0);
  const header = lines[0].split('\t');
  const rows = lines.slice(1).map((line) => {
    const cells = line.split('\t');
    const row = {};
    header.forEach((h, i) => { row[h] = cells[i]; });
    return row;
  });
  return { header, rows };
}
