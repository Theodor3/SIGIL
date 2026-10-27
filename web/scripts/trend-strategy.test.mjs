import assert from "node:assert/strict";
import { test, after } from "node:test";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";
const web = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const out = mkdtempSync(join(tmpdir(), "sigil-trend-tests-"));
execFileSync(process.execPath, [join(web, "node_modules/typescript/bin/tsc"), join(web, "src/lib/trendStrategy.ts"), "--outDir", out, "--module", "ES2022", "--target", "ES2022", "--moduleResolution", "node", "--skipLibCheck", "--strict"], { cwd: web, stdio: "pipe" });
writeFileSync(join(out, "trendStrategy.mjs"), readFileSync(join(out, "trendStrategy.js")));
const { evaluateTrend, validateTrendDataset, evaluatePassiveMix } = await import(pathToFileURL(join(out, "trendStrategy.mjs")));
after(() => {
  const resolved = resolve(out), parent = resolve(tmpdir());
  if (dirname(resolved) !== parent || !resolved.startsWith(`${parent}${sep}sigil-trend-tests-`)) throw new Error("Refusing cleanup outside the generated test directory.");
  rmSync(resolved, { recursive: true, force: true });
});
const day = i => new Date(Date.UTC(2020, 0, i + 1)).toISOString().slice(0, 10);
const data = (count = 220) => ({ symbol: "SPY", sourceUrl: "https://example.invalid/synthetic-fixture", retrievedAt: "2025-01-01T00:00:00Z", prices: Array.from({ length: count }, (_, i) => ({ date: day(i), close: 100 + i, adjustedClose: 100 + i })) });
const approx = (a, b) => assert.ok(Math.abs(a - b) < 1e-8, `${a} != ${b}`);
test("warmup is excluded and next close entry receives no same-day return", () => {
  const d = data(), r = evaluateTrend(d, { costBpsPerSide: 0 });
  assert.equal(r.metrics.startDate, day(200));
  assert.equal(r.transitions[0].signalDate, day(199));
  assert.equal(r.transitions[0].date, day(200));
  approx(r.equity[0].strategy, 1);
  approx(r.metrics.totalReturnPct, (319 / 300 - 1) * 100);
  approx(r.metrics.exposurePct, 100);
});
test("existing exposure earns sell-day loss before next-close liquidation", () => {
  const d = data(204);
  d.prices[200].adjustedClose = 300;
  d.prices[201].adjustedClose = 100;
  d.prices[202].adjustedClose = 50;
  d.prices[203].adjustedClose = 500;
  const r = evaluateTrend(d, { costBpsPerSide: 0 });
  assert.equal(r.transitions[1].signalDate, day(201));
  assert.equal(r.transitions[1].date, day(202));
  approx(r.equity[2].strategy, 50 / 300);
  approx(r.equity[3].strategy, 50 / 300);
  approx(r.metrics.maxDrawdownPct, (1 - 50 / 300) * 100);
});
test("transition and final liquidation fees compound, benchmark uses same window", () => {
  const r = evaluateTrend(data(), { costBpsPerSide: 100 });
  const expected = (319 / 300 * 0.99 ** 2 - 1) * 100;
  approx(r.metrics.totalReturnPct, expected);
  approx(r.metrics.benchmarkReturnPct, expected);
  approx(r.metrics.excessReturnPct, 0);
  assert.equal(r.metrics.transitions, 2);
  assert.match(r.transitions[1].reason, /End-of-window/);
});
test("flat prices remain cash while benchmark pays both sides", () => {
  const d = data(); d.prices.forEach(p => { p.adjustedClose = 101.23; });
  const r = evaluateTrend(d);
  approx(r.metrics.totalReturnPct, 0); approx(r.metrics.exposurePct, 0);
  approx(r.metrics.benchmarkReturnPct, (0.999 ** 2 - 1) * 100);
  approx(r.metrics.benchmarkMaxDrawdownPct, (1 - 0.999 ** 2) * 100);
  assert.equal(r.metrics.transitions, 0);
});
test("slice retains pre-slice warmup and resets both portfolios at the slice start", () => {
  const d = data(250), r = evaluateTrend(d, { startDate: day(220), endDate: day(230), costBpsPerSide: 0 });
  assert.equal(r.metrics.observations, 11);
  assert.equal(r.transitions[0].signalDate, day(219));
  approx(r.metrics.totalReturnPct, (330 / 320 - 1) * 100);
  approx(r.equity[0].strategy, 1); approx(r.equity[0].buyHold, 1);
});
test("terminal day closes positions without opening an unobservable new holding", () => {
  const d = data(202); d.prices.forEach(p => { p.adjustedClose = 100; });
  d.prices[200].adjustedClose = 200;
  const r = evaluateTrend(d);
  assert.equal(r.transitions.length, 0);
  approx(r.metrics.totalReturnPct, 0);
});
test("adjusted ratios drive returns rather than raw split-distorted closes", () => {
  const a = data(), b = structuredClone(a);
  b.prices.slice(205).forEach(p => { p.close /= 2; });
  assert.deepEqual(evaluateTrend(a), evaluateTrend(b));
});
test("future changes cannot alter earlier signals or equity", () => {
  const a = data(), b = structuredClone(a); b.prices[215].adjustedClose = 1;
  assert.deepEqual(evaluateTrend(a).equity.slice(0, 15), evaluateTrend(b).equity.slice(0, 15));
});
test("input is copied, dates sorted, duplicate or incomplete rows rejected", () => {
  const a = data(), reverse = structuredClone(a); reverse.prices.reverse();
  const before = structuredClone(reverse); assert.deepEqual(evaluateTrend(reverse), evaluateTrend(a)); assert.deepEqual(reverse, before);
  const duplicate = data(); duplicate.prices[2].date = duplicate.prices[1].date;
  assert.throws(() => validateTrendDataset(duplicate), /Duplicate/);
  const missing = data(); delete missing.prices[5].adjustedClose;
  assert.throws(() => evaluateTrend(missing), /adjustedClose/);
  const invalid = data(); invalid.prices[5].date = "2020-02-30";
  assert.throws(() => evaluateTrend(invalid), /invalid/);
});
test("invalid windows, prices, settings and provenance fail closed", () => {
  assert.throws(() => evaluateTrend(data(201)), /202/);
  assert.throws(() => evaluateTrend(data(), { startDate: day(219) }), /window/);
  assert.throws(() => evaluateTrend(data(), { startDate: day(210), endDate: day(205) }), /follow/);
  for (const cost of [-1, 10000, NaN, Infinity]) assert.throws(() => evaluateTrend(data(), { costBpsPerSide: cost }), /costBps/);
  for (const price of [0, -1, NaN, Infinity, null]) { const d = data(); d.prices[0].close = price; assert.throws(() => evaluateTrend(d), /finite/); }
  assert.throws(() => evaluateTrend({ ...data(), symbol: "CSX" }), /SPY/);
  assert.throws(() => evaluateTrend({ ...data(), retrievedAt: "2025-01-01" }), /timezone/);
  assert.throws(() => evaluateTrend({ ...data(), sourceUrl: "file:///tmp/x" }), /sourceUrl/);
});
test("gaps remain explicit and are never filled", () => {
  const d = data(230); d.prices.splice(205, 8);
  const r = evaluateTrend(d);
  assert.equal(r.equity.length, 22);
  assert.ok(r.warnings.some(w => w.includes("gaps longer")));
});
test("fixed passive mix charges fees only on stock, including final liquidation", () => {
  const d = data(); d.prices.forEach(p => { p.adjustedClose = 100; });
  const r = evaluatePassiveMix(d, { costBpsPerSide: 100 });
  approx(r.equity[0].value, 0.3 + 0.7 * 0.99);
  approx(r.metrics.totalReturnPct, (0.3 + 0.7 * 0.99 ** 2 - 1) * 100);
  assert.equal(r.equity.at(-1).stockWeightPct, 0);
});
test("fixed passive stock allocation drifts without rebalancing in identical window", () => {
  const d = data(), r = evaluatePassiveMix(d, { startDate: day(205), costBpsPerSide: 0 });
  assert.equal(r.metrics.startDate, day(205));
  approx(r.equity[0].stockWeightPct, 70);
  assert.ok(r.equity.at(-2).stockWeightPct > 70);
  approx(r.metrics.totalReturnPct, (0.3 + 0.7 * 319 / 305 - 1) * 100);
  const t = evaluateTrend(d, { startDate: day(205), costBpsPerSide: 0 });
  assert.deepEqual(r.equity.map(p => p.date), t.equity.map(p => p.date));
});
