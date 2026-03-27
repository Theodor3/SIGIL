#!/usr/bin/env node
import http from 'node:http';
import fs from 'node:fs/promises';
import fssync from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = process.cwd();
const dashboardDir = path.join(root, 'trading', 'dashboard');
const port = Number(process.env.TRADING_DASHBOARD_PORT || 5180);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
};

const TASK_MAP = {
  refresh_all: ['trading/pipeline/run_alpha_pipeline.mjs', 'trading/scripts/run_nowcast_ablation.mjs', 'trading/scripts/run_factor_tournament.mjs', 'trading/scripts/run_earnings_drift_lab.mjs', 'trading/dashboard/generate_dashboard_data.mjs'],
  alpha: ['trading/pipeline/run_alpha_pipeline.mjs'],
  backtest: ['trading/backtest/run_alpha_backtest.mjs', 'trading/dashboard/generate_dashboard_data.mjs'],
  refresh_data: ['trading/scripts/run_nowcast_ablation.mjs', 'trading/scripts/run_factor_tournament.mjs', 'trading/scripts/run_earnings_drift_lab.mjs', 'trading/dashboard/generate_dashboard_data.mjs'],
  alpha_lab_nowcast: ['trading/scripts/run_nowcast_ablation.mjs', 'trading/dashboard/generate_dashboard_data.mjs'],
  alpha_lab_factors: ['trading/scripts/run_factor_tournament.mjs', 'trading/dashboard/generate_dashboard_data.mjs'],
  alpha_lab_earnings: ['trading/scripts/run_earnings_drift_lab.mjs', 'trading/dashboard/generate_dashboard_data.mjs'],
};

function sendJson(res, status, payload) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > 1_000_000) reject(new Error('Payload too large'));
    });
    req.on('end', () => {
      if (!data.trim()) return resolve({});
      try {
        resolve(JSON.parse(data));
      } catch {
        reject(new Error('Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

async function runModuleScript(moduleRelPath) {
  const modulePath = path.join(root, moduleRelPath);
  const moduleUrl = `${pathToFileURL(modulePath).href}?run=${Date.now()}-${Math.random()}`;

  let stdout = '';
  let stderr = '';
  const originalLog = console.log;
  const originalError = console.error;

  console.log = (...args) => {
    const line = args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ');
    stdout += `${line}\n`;
    originalLog(...args);
  };

  console.error = (...args) => {
    const line = args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ');
    stderr += `${line}\n`;
    originalError(...args);
  };

  const priorEmbedded = process.env.TRADING_EMBEDDED;
  process.env.TRADING_EMBEDDED = '1';

  try {
    const mod = await import(moduleUrl);
    if (typeof mod.run !== 'function') {
      throw new Error(`Module does not export run(): ${moduleRelPath}`);
    }
    await mod.run();

    return {
      script: moduleRelPath,
      code: 0,
      stdout: stdout.trim(),
      stderr: stderr.trim(),
    };
  } catch (err) {
    const msg = err instanceof Error ? (err.stack || err.message) : String(err);
    if (msg) stderr += `${msg}\n`;
    return {
      script: moduleRelPath,
      code: 1,
      stdout: stdout.trim(),
      stderr: stderr.trim(),
    };
  } finally {
    console.log = originalLog;
    console.error = originalError;
    if (priorEmbedded == null) delete process.env.TRADING_EMBEDDED;
    else process.env.TRADING_EMBEDDED = priorEmbedded;
  }
}

async function runTask(taskId) {
  const scripts = TASK_MAP[taskId];
  if (!scripts) return { ok: false, error: `Unknown task: ${taskId}`, results: [] };

  const results = [];
  for (const modulePath of scripts) {
    const result = await runModuleScript(modulePath);
    results.push(result);
    if (result.code !== 0) {
      return { ok: false, error: `Script failed: ${modulePath}`, results };
    }
  }

  return { ok: true, results };
}

function safeResolveStatic(urlPath) {
  const clean = decodeURIComponent(urlPath.split('?')[0]);
  const rel = clean === '/' ? '/index.html' : clean;
  const full = path.normalize(path.join(dashboardDir, rel));
  if (!full.startsWith(dashboardDir)) return null;
  return full;
}

async function serveStatic(req, res) {
  const filePath = safeResolveStatic(req.url || '/');
  if (!filePath) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  if (!fssync.existsSync(filePath) || fssync.statSync(filePath).isDirectory()) {
    res.writeHead(404);
    res.end('Not Found');
    return;
  }

  const ext = path.extname(filePath).toLowerCase();
  const type = MIME[ext] || 'application/octet-stream';
  const data = await fs.readFile(filePath);
  res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(data);
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === 'POST' && req.url === '/api/run') {
      const body = await parseBody(req);
      const task = String(body.task || '').trim();
      const startedAt = new Date().toISOString();
      const result = await runTask(task);
      const endedAt = new Date().toISOString();
      return sendJson(res, result.ok ? 200 : 500, { task, started_at: startedAt, ended_at: endedAt, ...result });
    }

    if (req.method === 'GET' && req.url === '/api/tasks') {
      return sendJson(res, 200, { tasks: Object.keys(TASK_MAP) });
    }

    await serveStatic(req, res);
  } catch (err) {
    sendJson(res, 500, { ok: false, error: err instanceof Error ? err.message : String(err) });
  }
});

server.listen(port, () => {
  console.log(`Trading dashboard server listening on http://127.0.0.1:${port}`);
});





