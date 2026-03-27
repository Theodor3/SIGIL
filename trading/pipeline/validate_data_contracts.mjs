#!/usr/bin/env node

export function requireColumns(rows, required, label) {
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error(`${label}: no rows available.`);
  }

  const headers = new Set(Object.keys(rows[0] || {}));
  const missing = required.filter((col) => !headers.has(col));
  if (missing.length) {
    throw new Error(`${label}: missing required columns: ${missing.join(', ')}`);
  }
}

export function ensureNumeric(row, columns, label) {
  for (const col of columns) {
    const value = Number(row[col]);
    if (!Number.isFinite(value)) {
      throw new Error(`${label}: non-numeric value in ${col} for ticker ${row.ticker || 'UNKNOWN'}`);
    }
  }
}

export function truthyBool(value) {
  const s = String(value ?? '').trim().toLowerCase();
  if (s === 'true' || s === '1' || s === 'yes') return true;
  if (s === 'false' || s === '0' || s === 'no') return false;
  return Boolean(value);
}

export function clamp(v, lo = 0, hi = 1) {
  return Math.min(hi, Math.max(lo, v));
}
