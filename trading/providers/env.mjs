import fs from 'node:fs/promises';
import path from 'node:path';

const ENV_FILENAME = '.env.local';
let didLoad = false;

function parseEnvLine(line) {
  const trimmed = String(line || '').trim();
  if (!trimmed || trimmed.startsWith('#')) return null;

  const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
  if (!match) return null;

  const key = match[1];
  let value = (match[2] ?? '').trim();

  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1).trim();
  }

  return { key, value };
}

export async function loadLocalEnv(root = process.cwd()) {
  if (didLoad) return;
  didLoad = true;

  const envPath = path.join(root, ENV_FILENAME);
  let text = '';
  try {
    text = await fs.readFile(envPath, 'utf8');
  } catch {
    return;
  }

  for (const line of text.split(/\r?\n/)) {
    const parsed = parseEnvLine(line);
    if (!parsed) continue;
    if (process.env[parsed.key] == null || process.env[parsed.key] === '') {
      process.env[parsed.key] = parsed.value;
    }
  }
}

export function getProviderEnvSummary() {
  return {
    polygon: Boolean(process.env.POLYGON_API_KEY || process.env.MASSIVE_API_KEY),
    finnhub: Boolean(process.env.FINNHUB_API_KEY),
    marketDataProvider: process.env.TRADING_MARKET_DATA_PROVIDER || 'polygon',
    fundamentalsProvider: process.env.TRADING_FUNDAMENTALS_PROVIDER || 'finnhub',
  };
}
