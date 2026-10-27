import assert from "node:assert/strict";
import { test, after } from "node:test";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";

const web = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const out = mkdtempSync(join(tmpdir(), "sigil-freight-tests-"));
execFileSync(process.execPath, [join(web, "node_modules/typescript/bin/tsc"), join(web, "src/lib/freightStrategy.ts"), "--outDir", out, "--module", "ES2022", "--target", "ES2022", "--moduleResolution", "node", "--skipLibCheck", "--strict"], { cwd: web, stdio: "pipe" });
writeFileSync(join(out, "freightStrategy.mjs"), readFileSync(join(out, "freightStrategy.js")));
const { evaluateStrategy, validateDataset, defaultConfig, sampleDataset } = await import(pathToFileURL(join(out, "freightStrategy.mjs")));
after(() => {
  const resolved = resolve(out);
  const parent = resolve(tmpdir());
  if (dirname(resolved) !== parent || !resolved.startsWith(`${parent}${sep}sigil-freight-tests-`)) throw new Error("Refusing cleanup outside the generated test directory.");
  rmSync(resolved, { recursive: true, force: true });
});
const day = i => new Date(Date.UTC(2025, 0, i)).toISOString().slice(0, 10);
const event = (id, observedDay = 1, evaluation = 100) => ({ id, firstObservedAt: `${day(observedDay)}T23:59:00Z`, periodEnd: day(observedDay), baselineCarloads: 100, evaluationCarloads: evaluation, sourceUrl: "https://example.invalid/fixture" });
const data = (events = [event("one")], count = 32) => ({ schemaVersion: 1, label: "Test fixture", kind: "synthetic", prices: Array.from({ length: count }, (_, i) => ({ date: day(i + 1), close: 100 + i })), events });
const approx = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`);

test("strict next UTC date entry prevents observation-day lookahead", () => {
  const fixture = data();
  fixture.events[0].firstObservedAt = "2025-01-01T23:00:00-05:00";
  const result = evaluateStrategy(fixture, { ...defaultConfig, costBpsPerSide: 0 });
  assert.equal(result.trades[0].entryDate, "2025-01-03");
  assert.equal(result.trades[0].exitDate, "2025-01-23");
});
test("costs compound at both sides and benchmark uses identical dates/costs", () => {
  const fixture = data();
  const result = evaluateStrategy(fixture, { ...defaultConfig, costBpsPerSide: 100 });
  const expected = (121 / 101 * 0.99 * 0.99 - 1) * 100;
  approx(result.trades[0].netReturnPct, expected);
  approx(result.metrics.totalReturnPct, expected);
  approx(result.metrics.buyHoldReturnPct, expected);
  approx(result.metrics.excessReturnPct, 0);
  assert.equal(result.metrics.evaluatedStart, "2025-01-02");
  assert.equal(result.metrics.evaluatedEnd, "2025-01-22");
  approx(result.equity[0].strategy, 0.99);
});
test("flat-price roundtrip costs compound rather than sum", () => {
  const fixture = data(); fixture.prices.forEach(p => { p.close = 100; });
  const result = evaluateStrategy(fixture);
  approx(result.metrics.totalReturnPct, -0.1999);
  approx(result.metrics.exposureCalendarPct, 100);
});
test("drawdown uses the equity path rather than only completed trade outcomes", () => {
  const fixture = data(); fixture.prices.forEach(p => { p.close = 100; });
  fixture.prices[10].close = 50;
  const result = evaluateStrategy(fixture, { ...defaultConfig, costBpsPerSide: 0 });
  approx(result.metrics.totalReturnPct, 0);
  approx(result.metrics.maxDrawdownPct, 50);
});
test("overlapping signals cannot add positions or liquidate on freight weakness", () => {
  const result = evaluateStrategy(data([event("entry"), event("weak", 5, 80), event("overlap", 6)]));
  assert.equal(result.trades.length, 1);
  assert.equal(result.trades[0].exitDate, "2025-01-22");
  assert.equal(result.skips.filter(s => s.reason.includes("Overlapping")).length, 2);
});
test("benchmark window is independent of threshold and overlapping trade selection", () => {
  const fixture = data([event("first", 1, 96), event("second", 10, 100)], 40);
  const firstLong = evaluateStrategy(fixture, { ...defaultConfig, declineThresholdPct: 5 });
  const firstCash = evaluateStrategy(fixture, { ...defaultConfig, declineThresholdPct: 3 });
  assert.equal(firstLong.trades[0].eventId, "first");
  assert.equal(firstCash.trades[0].eventId, "second");
  assert.equal(firstLong.metrics.evaluatedStart, "2025-01-02");
  assert.equal(firstLong.metrics.evaluatedEnd, "2025-01-31");
  assert.equal(firstLong.metrics.evaluatedStart, firstCash.metrics.evaluatedStart);
  assert.equal(firstLong.metrics.evaluatedEnd, firstCash.metrics.evaluatedEnd);
  approx(firstLong.metrics.buyHoldReturnPct, firstCash.metrics.buyHoldReturnPct);
  assert.deepEqual(firstLong.equity.map(p => p.buyHold), firstCash.equity.map(p => p.buyHold));
});
test("exit-day observations are ignored even when their proposed entry is next day", () => {
  const result = evaluateStrategy(data([event("first"), event("exit-day", 22)], 50));
  assert.equal(result.trades.length, 1);
  assert.equal(result.trades[0].exitDate, "2025-01-22");
  assert.match(result.skips.find(s => s.eventId === "exit-day").reason, /Overlapping/);
  assert.equal(result.metrics.evaluatedEnd, "2025-02-12");
});
test("missing terminal exit produces no trade or invented partial return", () => {
  const result = evaluateStrategy(data([event("late", 20)], 32));
  assert.equal(result.trades.length, 0);
  assert.equal(result.equity.length, 0);
  assert.equal(result.metrics.evaluatedEnd, null);
  assert.match(result.skips[0].reason, /Missing exit/);
});
test("exact 5% decline remains flat cash with honest same-window buyhold", () => {
  const result = evaluateStrategy(data([event("cash", 1, 95)]), { ...defaultConfig, costBpsPerSide: 100 });
  assert.equal(result.metrics.tradeCount, 0);
  assert.equal(result.metrics.totalReturnPct, 0);
  assert.equal(result.metrics.winRatePct, null);
  assert.ok(result.equity.every(p => p.strategy === 1));
  approx(result.metrics.buyHoldReturnPct, (121 / 101 * 0.99 ** 2 - 1) * 100);
  assert.equal(result.metrics.evaluatedStart, "2025-01-02");
});
test("gaps move exit to first available date without shortening calendar horizon", () => {
  const fixture = data();
  fixture.prices = fixture.prices.filter(p => p.date < "2025-01-20" || p.date >= "2025-01-27");
  const result = evaluateStrategy(fixture);
  assert.equal(result.trades[0].exitDate, "2025-01-27");
  assert.ok(result.warnings.some(w => w.includes("Price gaps")));
});
test("sequential trades compound capital and preserve cash between trades", () => {
  const fixture = data([event("one"), event("two", 24)], 50);
  const result = evaluateStrategy(fixture);
  assert.equal(result.trades.length, 2);
  const product = result.trades.reduce((capital, t) => capital * (1 + t.netReturnPct / 100), 1);
  approx(result.metrics.totalReturnPct, (product - 1) * 100);
  approx(result.equity.find(p => p.date === "2025-01-23").strategy, 1 + result.trades[0].netReturnPct / 100);
});
test("validation sorts prices without mutating input and rejects duplicate dates", () => {
  const fixture = data(); fixture.prices.reverse();
  assert.equal(validateDataset(fixture).prices[0].date, "2025-01-01");
  assert.equal(fixture.prices[0].date, "2025-02-01");
  fixture.prices.push({ ...fixture.prices[0] });
  assert.throws(() => validateDataset(fixture), /Duplicate price date/);
});
test("malformed data cannot masquerade as an evaluated strategy", () => {
  for (const mutate of [
    d => { d.prices[0].close = NaN; },
    d => { d.events[0].baselineCarloads = 0; },
    d => { d.events[0].evaluationCarloads = -1; },
    d => { d.events[0].evaluationCarloads = Infinity; },
    d => { d.events[0].firstObservedAt = "2025-01-01T01:00:00"; },
    d => { d.events[0].firstObservedAt = "2024-12-31T01:00:00Z"; },
    d => { d.events[0].sourceUrl = "file:///tmp/fixture"; },
    d => { d.events.push({ ...d.events[0] }); },
    d => { d.prices[0].date = "2025-02-30"; },
  ]) { const fixture = data(); mutate(fixture); assert.throws(() => evaluateStrategy(fixture)); }
  assert.throws(() => evaluateStrategy(data(), { ...defaultConfig, holdingCalendarDays: 0 }));
  assert.throws(() => evaluateStrategy(data(), { ...defaultConfig, costBpsPerSide: Infinity }));
});
test("sample is deterministic synthetic and imported provenance remains unverified", () => {
  assert.equal(sampleDataset.kind, "synthetic");
  assert.deepEqual(evaluateStrategy(sampleDataset), evaluateStrategy(sampleDataset));
  const fixture = data(); fixture.kind = "imported";
  assert.ok(evaluateStrategy(fixture).warnings.some(w => w.includes("remain unverified")));
});
