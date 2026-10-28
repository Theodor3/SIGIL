import assert from "node:assert/strict";
import { test, after } from "node:test";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";
const web = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const out = mkdtempSync(join(tmpdir(), "sigil-diversified-tests-"));
execFileSync(process.execPath, [join(web, "node_modules/typescript/bin/tsc"), join(web, "src/lib/diversifiedStrategy.ts"), "--outDir", out, "--module", "ES2022", "--target", "ES2022", "--moduleResolution", "node", "--skipLibCheck", "--strict"], { cwd: web, stdio: "pipe" });
writeFileSync(join(out, "diversifiedStrategy.mjs"), readFileSync(join(out, "diversifiedStrategy.js")));
const { evaluateDiversified, validateDiversifiedDataset, symbols } = await import(pathToFileURL(join(out, "diversifiedStrategy.mjs")));
after(() => { const p = resolve(tmpdir()), r = resolve(out); if (dirname(r) !== p || !r.startsWith(`${p}${sep}sigil-diversified-tests-`)) throw new Error("Unsafe cleanup path"); rmSync(r, { recursive: true, force: true }); });
const day = i => new Date(Date.UTC(2020, 0, i + 1)).toISOString().slice(0, 10);
function fixture(count = 300) { return { schemaVersion: 1, retrievedAt: "2025-01-01T00:00:00Z", sources: symbols.map(symbol => ({ symbol, sourceUrl: "https://example.invalid/synthetic", sha256: "a".repeat(64), retrievedAt: "2025-01-01T00:00:00Z" })), rows: Array.from({ length: count }, (_, i) => ({ date: day(i), SPY: 100 + i, EFA: 100 + i, IEF: 100 + i, GLD: 100 + i, BIL: 100 })) }; }
const near = (a, b, tolerance = 1e-9) => assert.ok(Math.abs(a - b) < tolerance, `${a} != ${b}`);
test("starts next month after full warmup and never earns execution-day return", () => {
  const d = fixture(), r = evaluateDiversified(d, { costBpsPerSide: 0 });
  assert.equal(r.metrics.startDate, "2020-08-01");
  assert.equal(r.rebalances[0].signalDate, "2020-07-31");
  near(r.equity[0].strategy, 1);
  near(r.metrics.strategy.totalReturnPct, (399 / 313 - 1) * 100);
  near(r.metrics.strategy.totalReturnPct, r.metrics.benchmark.totalReturnPct);
});
test("initial purchase is self-financing and final fee applies to every holding", () => {
  const d = fixture(215), r = evaluateDiversified(d);
  near(r.equity[0].strategy, 1 / 1.001);
  near(r.rebalances[0].strategyFee + r.equity[0].strategy, 1);
  near(r.equity.at(-1).strategy, (1 / 1.001) * 314 / 313 * .999);
});
test("flat risk prices allocate all sleeves to BIL with no extra cash interest", () => {
  const d = fixture(240);
  d.rows.forEach((r, i) => { r.SPY = r.EFA = r.IEF = r.GLD = 100.1; r.BIL = 100 + i; });
  const r = evaluateDiversified(d, { costBpsPerSide: 0 });
  assert.equal(r.rebalances[0].strategyTarget.BIL, 1);
  near(r.metrics.strategy.totalReturnPct, (339 / 313 - 1) * 100);
  near(r.metrics.strategy.meanRiskExposurePct, 0);
});
test("partial risk sleeves keep fixed weights rather than renormalizing", () => {
  const d = fixture();
  d.rows.forEach(r => { r.EFA = r.IEF = r.GLD = 100; });
  const r = evaluateDiversified(d);
  assert.deepEqual(r.rebalances[0].strategyTarget, { SPY: .25, EFA: 0, IEF: 0, GLD: 0, BIL: .75 });
});
test("month transition earns old allocation return before selling and buying BIL", () => {
  const d = fixture(246);
  for (let i = 220; i < d.rows.length; i++) for (const s of ["SPY", "EFA", "IEF", "GLD"]) d.rows[i][s] = i === 244 ? 25 : 50;
  const r = evaluateDiversified(d, { costBpsPerSide: 0 });
  const augEnd = r.equity.find(p => p.date === "2020-08-31"), sepStart = r.equity.find(p => p.date === "2020-09-01");
  near(sepStart.strategy, augEnd.strategy / 2);
  assert.equal(r.rebalances[1].strategyTarget.BIL, 1);
  near(r.equity.at(-1).strategy, sepStart.strategy);
});
test("switch costs include sold risk assets and purchased BIL", () => {
  const d = fixture(246);
  for (let i = 220; i < d.rows.length; i++) for (const s of ["SPY", "EFA", "IEF", "GLD"]) d.rows[i][s] = 50;
  const r = evaluateDiversified(d), before = r.equity.find(p => p.date === "2020-08-31").strategy;
  const afterSwitch = r.equity.find(p => p.date === "2020-09-01").strategy;
  near(afterSwitch, before * .999 / 1.001);
  near(r.rebalances[1].strategyFee, before - afterSwitch);
});
test("static portfolio also pays for monthly rebalancing of drifted holdings", () => {
  const d = fixture(246);
  for (let i = 214; i < d.rows.length; i++) d.rows[i].SPY *= 2;
  const r = evaluateDiversified(d);
  assert.ok(r.rebalances[1].benchmarkFee > 0);
  assert.ok(r.metrics.benchmark.turnover > 2);
});
test("future changes cannot change prior signals or equity", () => {
  const d = fixture(), before = evaluateDiversified(d);
  d.rows.slice(260).forEach(r => { r.SPY *= 5; r.BIL *= 3; });
  const afterResult = evaluateDiversified(d);
  assert.deepEqual(before.equity.filter(p => p.date < day(260)), afterResult.equity.filter(p => p.date < day(260)));
  assert.deepEqual(before.rebalances.filter(p => p.date < day(260)), afterResult.rebalances.filter(p => p.date < day(260)));
});
test("slicing retains warmup but starts both portfolios afresh on monthly execution", () => {
  const r = evaluateDiversified(fixture(), { startDate: "2020-09-01", costBpsPerSide: 0 });
  assert.equal(r.metrics.startDate, "2020-09-01"); near(r.equity[0].strategy, 1); near(r.equity[0].benchmark, 1);
  assert.throws(() => evaluateDiversified(fixture(), { startDate: "2026-01-01" }), /No complete/);
});
test("terminal day liquidates rather than creating a fresh rebalance", () => {
  const r = evaluateDiversified(fixture(), { endDate: "2020-09-01" });
  assert.equal(r.rebalances.length, 1);
  assert.equal(r.equity.at(-1).riskExposurePct, 0);
});
test("invalid or unaligned input fails, never fills missing data", () => {
  let d = fixture(); delete d.rows[220].BIL; assert.throws(() => evaluateDiversified(d), /BIL/);
  d = fixture(); d.rows[1].date = d.rows[0].date; assert.throws(() => evaluateDiversified(d), /Duplicate/);
  d = fixture(); d.rows.splice(220, 5); assert.throws(() => evaluateDiversified(d), /Gap/);
  d = fixture(); d.sources[0].sha256 = "bad"; assert.throws(() => evaluateDiversified(d), /SHA256/);
  d = fixture(); d.sources[0].symbol = "BIL"; assert.throws(() => evaluateDiversified(d), /duplicate/);
  d = fixture(); d.rows[0].SPY = Infinity; assert.throws(() => evaluateDiversified(d), /invalid/);
  assert.throws(() => evaluateDiversified(fixture(), { costBpsPerSide: -1 }), /cost/);
});
test("validation copies and sorts input without modifying its rows", () => {
  const d = fixture(); d.rows.reverse(); const original = JSON.stringify(d), v = validateDiversifiedDataset(d);
  assert.equal(v.rows[0].date, "2020-01-01"); assert.equal(JSON.stringify(d), original);
});

test("missing synthetic month-end can pass the gap check and flip allocation, with an explicit warning", () => {
  // Synthetic weekday schedule, NOT an exchange calendar or observed market data.
  // No holiday inference: this fixture exists only to demonstrate accepted input behavior.
  const d = fixture();
  d.rows = Array.from({ length: 310 }, (_, i) => day(i))
    .filter(date => ![0, 6].includes(new Date(`${date}T00:00:00Z`).getUTCDay()))
    .map(date => ({ date, SPY: date === "2020-10-29" ? 99 : date === "2020-10-30" ? 101 : 100,
      EFA: 100, IEF: 100, GLD: 100, BIL: 100 }));
  const options = { startDate: "2020-11-02", costBpsPerSide: 0 };
  const complete = evaluateDiversified(d, options);
  const missing = { ...d, rows: d.rows.filter(row => row.date !== "2020-10-30") };
  const original = JSON.stringify(missing);
  assert.equal((Date.parse("2020-11-02") - Date.parse("2020-10-29")) / 86400000, 4);
  assert.doesNotThrow(() => validateDiversifiedDataset(missing));
  const incomplete = evaluateDiversified(missing, options);
  assert.equal(complete.rebalances[0].signalDate, "2020-10-30");
  assert.equal(incomplete.rebalances[0].signalDate, "2020-10-29");
  assert.equal(complete.rebalances[0].date, "2020-11-02");
  assert.equal(incomplete.rebalances[0].date, "2020-11-02");
  assert.equal(complete.rebalances[0].strategyTarget.SPY, .25);
  assert.equal(incomplete.rebalances[0].strategyTarget.SPY, 0);
  assert.equal(incomplete.rebalances[0].strategyTarget.BIL, 1);
  assert.equal(JSON.stringify(missing), original); // no forward fill or mutation
  assert.match(incomplete.warnings[0], /Calendar completeness is unverified/);
  assert.match(incomplete.warnings[0], /missing month-end session can pass/);
  assert.match(incomplete.warnings[0], /does not establish that this dataset has missing sessions/);
});

test("an ordinary partial-month end remains valid without asserting a missing session", () => {
  const result = evaluateDiversified(fixture(), { endDate: "2020-09-15" });
  assert.equal(result.metrics.endDate, "2020-09-15");
  assert.match(result.warnings[0], /Calendar completeness is unverified/);
  assert.match(result.warnings[0], /does not establish that this dataset has missing sessions/);
});

if (process.argv.includes("--real-report")) {
  const dataset = JSON.parse(readFileSync(join(web, "public/research/diversified-history.json"), "utf8").replace(/^\uFEFF/, ""));
  const report = { version: "four-sleeve-monthly-sma200-bil-v1", datasetReceipts: dataset.sources, full10: evaluateDiversified(dataset), recent10: evaluateDiversified(dataset, { startDate: "2023-01-01" }), full25: evaluateDiversified(dataset, { costBpsPerSide: 25 }), recent25: evaluateDiversified(dataset, { startDate: "2023-01-01", costBpsPerSide: 25 }) };
  writeFileSync(join(web, "../.swarm/reports/market-data/diversified-results-2026-10-27.json"), JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify(Object.fromEntries(Object.entries(report).filter(([k]) => /10|25/.test(k)).map(([k, v]) => [k, v.metrics])), null, 2));
}
