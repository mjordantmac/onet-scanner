// Minimal .xlsx sheet reader (first worksheet) built on the zip reader. Enough for the OEWS
// national file, which is a single flat table.
import { listZip, readZipEntry } from './zip.js';

const decode = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
  .replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d))).replace(/&amp;/g, '&');

function colIndex(ref) {
  const letters = ref.match(/^[A-Z]+/)[0];
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

// Returns an array of rows (arrays of strings) from the first worksheet.
export function readFirstSheet(buf) {
  const entries = listZip(buf);
  const get = (name) => {
    const e = entries.find((x) => x.name === name);
    return e ? readZipEntry(buf, e).toString('utf8') : null;
  };
  const shared = [];
  const sst = get('xl/sharedStrings.xml');
  if (sst) {
    for (const si of sst.match(/<si>[\s\S]*?<\/si>/g) || []) {
      shared.push(decode((si.match(/<t[^>]*>([\s\S]*?)<\/t>/g) || []).map((t) => t.replace(/<[^>]+>/g, '')).join('')));
    }
  }
  const sheetName = entries.map((e) => e.name).filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n)).sort()[0];
  const xml = get(sheetName);
  const rows = [];
  for (const rowXml of xml.match(/<row[^>]*>[\s\S]*?<\/row>/g) || []) {
    const row = [];
    for (const c of rowXml.match(/<c [^>]*?(?:\/>|>[\s\S]*?<\/c>)/g) || []) {
      const ref = c.match(/ r="([A-Z]+\d+)"/)[1];
      const type = (c.match(/ t="(\w+)"/) || [])[1];
      let value = '';
      if (type === 'inlineStr') value = decode(((c.match(/<t[^>]*>([\s\S]*?)<\/t>/) || [])[1]) || '');
      else {
        const v = (c.match(/<v>([\s\S]*?)<\/v>/) || [])[1];
        value = v === undefined ? '' : type === 's' ? shared[Number(v)] : decode(v);
      }
      row[colIndex(ref)] = value;
    }
    rows.push(Array.from(row, (x) => (x === undefined ? '' : x)));
  }
  return rows;
}
