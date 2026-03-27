import fs from 'node:fs/promises';
import path from 'node:path';

export function todayDate(tz = 'America/New_York') {
  return new Date().toLocaleDateString('en-CA', { timeZone: tz });
}

export async function ensureDir(dirPath) {
  await fs.mkdir(dirPath, { recursive: true });
}

export function parseCsv(text) {
  const lines = text.replace(/\r/g, '').split('\n').filter(Boolean);
  if (lines.length === 0) return [];
  const headers = parseCsvLine(lines[0]);
  if (headers.length && headers[0].charCodeAt(0) === 0xfeff) {
    headers[0] = headers[0].slice(1);
  }
  return lines.slice(1).map((line) => {
    const cols = parseCsvLine(line);
    const row = {};
    headers.forEach((h, i) => {
      row[h] = cols[i] ?? '';
    });
    return row;
  });
}

export function parseCsvLine(line) {
  const out = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      out.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

export function toCsv(rows, headers) {
  const esc = (v) => {
    const s = String(v ?? '');
    if (s.includes(',') || s.includes('"') || s.includes('\n')) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  };
  const lines = [headers.join(',')];
  for (const row of rows) {
    lines.push(headers.map((h) => esc(row[h])).join(','));
  }
  return lines.join('\n');
}

export async function readCsv(filePath) {
  const text = await fs.readFile(filePath, 'utf8');
  return parseCsv(text);
}

export async function readJson(filePath) {
  const text = await fs.readFile(filePath, 'utf8');
  const clean = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  return JSON.parse(clean);
}

export function n(value, digits = 2) {
  if (value == null || Number.isNaN(Number(value))) return '';
  return Number(value).toFixed(digits);
}

export function pct(value, digits = 2) {
  if (value == null || Number.isNaN(Number(value))) return '';
  return `${(Number(value) * 100).toFixed(digits)}%`;
}

export async function latestFile(dirPath, patternRegex) {
  const entries = await fs.readdir(dirPath, { withFileTypes: true });
  const files = entries
    .filter((e) => e.isFile() && patternRegex.test(e.name))
    .map((e) => path.join(dirPath, e.name));
  if (files.length === 0) return null;

  const withStats = await Promise.all(
    files.map(async (fp) => ({ fp, stat: await fs.stat(fp) }))
  );

  withStats.sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs);
  return withStats[0].fp;
}

export function asNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}


