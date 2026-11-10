// Company comparison: behaviour tests on the real modules with synthetic data.
//
// The TypeScript sources are transpiled in memory (same approach as
// scripts/research-checkpoint.test.mjs) and executed; nothing is matched against
// source text. `fetch` is a local fake -- no network, server or backend is used,
// and every company, price and score below is invented for the test.
//
//   cd web && node --test tests/company-compare.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const require = createRequire(import.meta.url);
const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
function load(path, imports = {}) {
  const module = { exports: {} };
  const code = ts.transpileModule(read(path), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020,
    jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  new Function('require', 'module', 'exports', code)(
    (name) => (name in imports ? imports[name] : require(name)), module, module.exports);
  return module.exports;
}

const saved = load('../src/lib/savedScores.ts');
const lib = load('../src/lib/companyCompare.ts');
const CompareView = load('../src/components/CompareView.tsx', {
  '../lib/savedScores': saved, '../lib/companyCompare': lib }).default;
const Compare = load('../src/pages/Compare.tsx', {
  '../components/CompareView': { __esModule: true, default: CompareView },
  '../lib/companyCompare': lib }).default;
const { MemoryRouter } = require('react-router-dom');

// ---------- synthetic fixtures ----------
const RUN_A = '2026-01-05T14:00:00+00:00';
const RUN_B = '2026-01-06T14:00:00+00:00';
const payload = (ticker, over = {}) => ({
  ticker,
  company: { name: `${ticker} Test Corp`, description: 'x', sector: 'Testing', industry: 'Fixtures',
    market_cap: 2.5e9, price: 50, fifty_two_week_high: 60, fifty_two_week_low: 40 },
  final_score: 0.5, score_status: 'saved', eligible: true, confidence: 0.7,
  signals: [
    { signal: 'value', score: 0.8, confidence: null, weight: null, contribution: null, metadata: {} },
    { signal: 'quality', score: 0.3, confidence: null, weight: null, contribution: null, metadata: {} },
  ],
  score_history: [], evaluations: [],
  trades: [{ id: 7, side: 'buy', shares: 987654, entry_price: 123.45, realized_pnl: 4321.99 }],
  run_date: RUN_A,
  ...over,
});
const column = (ticker, over) => lib.normalizeTickerPayload(payload(ticker, over), ticker);
const ready = (ticker, over) => ({ ticker, status: 'ready', column: column(ticker, over) });
const noop = () => {};
const view = (columns, props = {}) => renderToStaticMarkup(React.createElement(CompareView, {
  state: { columns }, filter: 'all', sort: 'spread',
  onFilter: noop, onSort: noop, onRemove: noop, onRetry: noop, ...props }));
const text = (html) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

/** A fetch whose responses the test settles by hand. */
function fakeFetch() {
  const calls = [];
  const fn = (url, init) => new Promise((resolve, reject) => {
    const call = { url, init, resolve, reject, aborted: false };
    init.signal.addEventListener('abort', () => {
      call.aborted = true;
      reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
    });
    calls.push(call);
  });
  const respond = (call, body, status = 200) => call.resolve({
    ok: status >= 200 && status < 300, status,
    json: async () => { if (body instanceof Error) throw body; return body; } });
  return { fn, calls, respond };
}
const settle = () => new Promise((resolve) => setImmediate(resolve));

// ---------- ticker list parsing ----------
test('ticker lists are upper-cased, de-duplicated and kept in first-seen order', () => {
  assert.deepEqual(lib.parseTickerList('aapl, msft;AAPL  brk.b\nBF-B'),
    { tickers: ['AAPL', 'MSFT', 'BRK.B', 'BF-B'], rejected: [], overLimit: [] });
});

test('unusable entries are reported and never turned into requests', () => {
  const parsed = lib.parseTickerList('AAPL, ../etc, <script>, 123, TOOLONGNAME, A.B.C, ok');
  assert.deepEqual(parsed.tickers, ['AAPL', 'OK']);
  assert.deepEqual(parsed.rejected, ['../etc', '<script>', '123', 'TOOLONGNAME', 'A.B.C']);
  assert.equal(lib.parseTickerList('x'.repeat(50)).rejected[0], `${'x'.repeat(12)}…`);
  for (const junk of [null, undefined, 42, {}, ['AAPL']]) {
    assert.deepEqual(lib.parseTickerList(junk), { tickers: [], rejected: [], overLimit: [] });
  }
});

test('the list stops at four companies and says which were left out', () => {
  const parsed = lib.parseTickerList('A,B,C,D,E,F,E');
  assert.deepEqual(parsed.tickers, ['A', 'B', 'C', 'D']);
  assert.deepEqual(parsed.overLimit, ['E', 'F']);
  // A pasted wall of text is bounded rather than processed in full.
  const flood = lib.parseTickerList(Array.from({ length: 5000 }, (_, i) => `T${i}`).join(','));
  assert.ok(flood.tickers.length + flood.overLimit.length + flood.rejected.length <= 40);
});

// ---------- payload validation ----------
test('a well-formed response becomes one column', () => {
  const c = column('ACME');
  assert.equal(c.ticker, 'ACME');
  assert.equal(c.name, 'ACME Test Corp');
  assert.deepEqual([c.sector, c.industry, c.marketCap, c.price, c.low52, c.high52],
    ['Testing', 'Fixtures', 2.5e9, 50, 40, 60]);
  assert.deepEqual([c.finalScore, c.confidence, c.eligible, c.scoreStatus, c.runDate],
    [0.5, 0.7, true, 'saved', '2026-01-05T14:00:00.000Z']);
  assert.deepEqual([...c.signals], [['value', 0.8], ['quality', 0.3]]);
  assert.equal(c.malformedSignals, 0);
});

test('missing or unusable fields become null, never zero', () => {
  const c = column('ACME', {
    company: { name: 'ACME', sector: '', industry: 7, market_cap: 'big', price: NaN,
      fifty_two_week_high: 0, fifty_two_week_low: -3 },
    final_score: null, confidence: '0.7', eligible: 'yes', score_status: 'made_up', run_date: 'not a date',
  });
  assert.deepEqual(
    [c.name, c.sector, c.industry, c.marketCap, c.price, c.high52, c.low52, c.finalScore, c.confidence, c.eligible, c.runDate],
    Array(11).fill(null));
  assert.equal(c.scoreStatus, undefined);
  assert.equal(lib.hasNoCompanyFacts(c), true);

  const bare = lib.normalizeTickerPayload({ ticker: 'ACME' }, 'ACME');
  assert.equal(lib.hasNoCompanyFacts(bare), true);
  assert.equal(bare.signals.size, 0);
});

test('a real zero score is kept as zero, not treated as missing', () => {
  const c = column('ACME', { final_score: 0, confidence: 0,
    signals: [{ signal: 'value', score: 0 }, { signal: 'neg', score: -0.25 }] });
  assert.equal(c.finalScore, 0);
  assert.equal(c.confidence, 0);
  assert.deepEqual([...c.signals], [['value', 0], ['neg', -0.25]]);
});

test('unreadable signal entries are counted and left out', () => {
  const c = column('ACME', { signals: [
    { signal: 'value', score: 0.8 }, { signal: 'value', score: 0.1 }, { signal: 'x', score: 'high' },
    { score: 0.4 }, null, 'value', { signal: '__proto__', score: 0.9 }, { signal: 'inf', score: Infinity },
  ] });
  assert.deepEqual([...c.signals], [['value', 0.8], ['__proto__', 0.9]]);
  assert.equal(c.malformedSignals, 6);
  assert.equal(column('ACME', { signals: 'none' }).malformedSignals, 1);
  assert.equal(column('ACME', { signals: null }).malformedSignals, 0);
});

test('a response for a different ticker, or not an object, is refused', () => {
  assert.equal(lib.normalizeTickerPayload(payload('OTHER'), 'ACME'), null);
  for (const junk of [null, 'ACME', 7, [], [payload('ACME')], { company: {} }, { ticker: 5 }]) {
    assert.equal(lib.normalizeTickerPayload(junk, 'ACME'), null);
  }
  assert.equal(lib.normalizeTickerPayload(payload('acme'), 'ACME').ticker, 'ACME');
});

test('trade history in the response is never carried into a column', () => {
  const c = column('ACME');
  const dump = JSON.stringify({ ...c, signals: [...c.signals] });
  assert.doesNotMatch(dump, /987654|123\.45|4321\.99|trades|realized/);
});

test('52-week position needs three consistent numbers', () => {
  const at = (price, low52, high52) => lib.rangePosition({ price, low52, high52 });
  assert.equal(at(50, 40, 60), 0.5);
  assert.equal(at(40, 40, 60), 0);
  assert.equal(at(60, 40, 60), 1);
  for (const args of [[null, 40, 60], [50, null, 60], [50, 40, null], [70, 40, 60], [30, 40, 60], [50, 60, 40], [50, 50, 50]]) {
    assert.equal(at(...args), null, JSON.stringify(args));
  }
});

// ---------- loading ----------
test('one column is fetched from the existing research endpoint only', async () => {
  const net = fakeFetch();
  const pending = lib.fetchCompanyColumn('BRK.B', net.fn, new AbortController().signal);
  assert.equal(net.calls.length, 1);
  assert.equal(net.calls[0].url, '/api/research/ticker/BRK.B');
  net.respond(net.calls[0], payload('BRK.B'));
  const result = await pending;
  assert.equal(result.status, 'ready');
  assert.equal(result.column.ticker, 'BRK.B');
});

test('each kind of failure is reported as itself', async () => {
  const outcome = async (act) => {
    const net = fakeFetch();
    const controller = new AbortController();
    const pending = lib.fetchCompanyColumn('ACME', net.fn, controller.signal);
    act(net, controller);
    return pending;
  };
  assert.deepEqual(await outcome((n) => n.respond(n.calls[0], {}, 401)),
    { status: 'error', reason: 'unauthorized', httpStatus: 401 });
  assert.deepEqual(await outcome((n) => n.respond(n.calls[0], {}, 503)),
    { status: 'error', reason: 'http_error', httpStatus: 503 });
  assert.deepEqual(await outcome((n) => n.calls[0].reject(new TypeError('offline'))),
    { status: 'error', reason: 'network_error' });
  assert.deepEqual(await outcome((n) => n.respond(n.calls[0], new SyntaxError('<html>'))),
    { status: 'error', reason: 'invalid_response' });
  assert.deepEqual(await outcome((n) => n.respond(n.calls[0], payload('OTHER'))),
    { status: 'error', reason: 'invalid_response' });
  assert.deepEqual(await outcome((n, c) => c.abort()), { status: 'aborted' });
  // Aborted while the body was still arriving: not reported as a failure.
  assert.deepEqual(await outcome((n, c) => { n.respond(n.calls[0], payload('ACME')); c.abort(); }),
    { status: 'aborted' });
  for (const reason of ['unauthorized', 'http_error', 'network_error', 'invalid_response']) {
    assert.ok(lib.failureMessage(reason, 503).length > 10);
  }
});

test('changing the selection keeps loaded companies and loads only new ones', () => {
  let state = lib.compareReducer(lib.emptyCompareState, { type: 'set', tickers: ['AAA', 'BBB'] });
  assert.deepEqual(state.columns.map((c) => c.status), ['loading', 'loading']);
  state = lib.compareReducer(state, { type: 'resolved', ticker: 'AAA', result: { status: 'ready', column: column('AAA') } });
  state = lib.compareReducer(state, { type: 'resolved', ticker: 'BBB', result: { status: 'error', reason: 'http_error', httpStatus: 500 } });
  assert.deepEqual(state.columns.map((c) => c.status), ['ready', 'error']);

  const same = lib.compareReducer(state, { type: 'set', tickers: ['AAA', 'BBB'] });
  assert.equal(same, state, 'an unchanged selection does not create new state');

  const next = lib.compareReducer(state, { type: 'set', tickers: ['CCC', 'AAA'] });
  assert.deepEqual(next.columns.map((c) => [c.ticker, c.status]), [['CCC', 'loading'], ['AAA', 'ready']]);
  assert.equal(next.columns[1], state.columns[0]);

  // A late answer for a company that was removed is dropped.
  const late = lib.compareReducer(next, { type: 'resolved', ticker: 'BBB', result: { status: 'ready', column: column('BBB') } });
  assert.equal(late, next);
  assert.equal(lib.compareReducer(next, { type: 'resolved', ticker: 'CCC', result: { status: 'aborted' } }), next);

  const retried = lib.compareReducer(state, { type: 'retry', ticker: 'BBB' });
  assert.deepEqual(retried.columns.map((c) => c.status), ['ready', 'loading']);
  assert.deepEqual(lib.compareReducer(state, { type: 'retry', ticker: 'AAA' }).columns[0], state.columns[0]);
});

test('the loader sends one request per company and aborts removed ones', async () => {
  const net = fakeFetch();
  const results = [];
  const loader = lib.createColumnLoader(net.fn, (ticker, result) => results.push([ticker, result.status]));
  const loading = (...tickers) => tickers.map((ticker) => ({ ticker, status: 'loading' }));

  loader.sync(loading('AAA', 'BBB'));
  loader.sync(loading('AAA', 'BBB'));
  assert.deepEqual(net.calls.map((c) => c.url), ['/api/research/ticker/AAA', '/api/research/ticker/BBB']);

  loader.sync(loading('AAA')); // BBB removed while in flight
  assert.equal(net.calls[1].aborted, true);
  assert.equal(net.calls[0].aborted, false);

  net.respond(net.calls[0], payload('AAA'));
  await settle();
  assert.deepEqual(results, [['AAA', 'ready']]);

  // Re-adding BBB, and retrying after an error, each start a fresh request.
  loader.sync([ready('AAA'), ...loading('BBB')]);
  assert.equal(net.calls.length, 3);
  net.respond(net.calls[2], {}, 500);
  await settle();
  assert.deepEqual(results[1], ['BBB', 'error']);
  loader.sync([ready('AAA'), ...loading('BBB')]);
  assert.equal(net.calls.length, 4);
  loader.dispose();
});

test('after dispose nothing is in flight and no late result is delivered', async () => {
  const net = fakeFetch();
  const results = [];
  const loader = lib.createColumnLoader(net.fn, (ticker, result) => results.push([ticker, result.status]));
  loader.sync([{ ticker: 'AAA', status: 'loading' }, { ticker: 'BBB', status: 'loading' }]);
  loader.dispose();
  assert.deepEqual(net.calls.map((c) => c.aborted), [true, true]);
  net.respond(net.calls[0], payload('AAA')); // arrives anyway
  await settle();
  assert.deepEqual(results, []);
  loader.sync([{ ticker: 'CCC', status: 'loading' }]);
  assert.equal(net.calls.length, 2, 'a disposed loader starts nothing');
});

test('a removed-then-re-added company keeps exactly one live request', async () => {
  const net = fakeFetch();
  const results = [];
  const loader = lib.createColumnLoader(net.fn, (ticker, result) => results.push([ticker, result.status]));
  const one = [{ ticker: 'AAA', status: 'loading' }];
  loader.sync(one);
  loader.sync([]); // removed: first request aborted
  loader.sync(one); // added again: second request
  await settle(); // the aborted first request finishes now
  loader.sync(one);
  assert.equal(net.calls.length, 2, 'the finished stale request must not free the slot of its replacement');
  assert.deepEqual(net.calls.map((c) => c.aborted), [true, false]);
  net.respond(net.calls[1], payload('AAA'));
  await settle();
  assert.deepEqual(results, [['AAA', 'ready']]);
  loader.dispose();
});

// ---------- comparison model ----------
test('signals are aligned by name with gaps left as gaps', () => {
  const rows = lib.buildSignalRows([
    column('AAA', { signals: [{ signal: 'value', score: 0.8 }, { signal: 'quality', score: 0 }] }),
    column('BBB', { signals: [{ signal: 'quality', score: 0.3 }, { signal: 'momentum', score: 0.6 }] }),
    column('CCC', { signals: [] }),
  ]);
  assert.deepEqual(rows, [
    { signal: 'value', values: [0.8, null, null], present: 1, unavailable: 0, spread: null },
    { signal: 'quality', values: [0, 0.3, null], present: 2, unavailable: 0, spread: 0.3 },
    { signal: 'momentum', values: [null, 0.6, null], present: 1, unavailable: 0, spread: null },
  ]);
});

test('filtering and ordering never change values, and unmeasurable rows sort last', () => {
  const rows = [
    { signal: 'b', values: [0.1, 0.2], present: 2, unavailable: 0, spread: 0.1 },
    { signal: 'a', values: [0.5, null], present: 1, unavailable: 0, spread: null },
    { signal: 'c', values: [0.9, 0.1], present: 2, unavailable: 0, spread: 0.8 },
    { signal: 'd', values: [0.4, 0.4], present: 2, unavailable: 0, spread: 0 },
  ];
  const before = JSON.stringify(rows);
  const names = (filter, sort) => lib.arrangeSignalRows(rows, filter, sort).map((r) => r.signal);
  assert.deepEqual(names('all', 'spread'), ['c', 'b', 'd', 'a']);
  assert.deepEqual(names('all', 'name'), ['a', 'b', 'c', 'd']);
  assert.deepEqual(names('shared', 'spread'), ['c', 'b', 'd']);
  assert.deepEqual(names('gaps', 'spread'), ['a']);
  assert.equal(JSON.stringify(rows), before);
});

test('run alignment separates same run, different runs and unknown', () => {
  const at = (...dates) => lib.runAlignment(dates.map((run_date, i) => column(`T${i}`, { run_date })));
  assert.equal(at(RUN_A), 'not_applicable');
  assert.equal(at(RUN_A, RUN_A), 'same_run');
  assert.equal(at(RUN_A, '2026-01-05T09:00:00-05:00'), 'same_run', 'same instant, different offset');
  assert.equal(at(RUN_A, RUN_B), 'different_runs');
  assert.equal(at(RUN_A, null), 'unknown');
});

test('formatting returns null for missing values', () => {
  assert.deepEqual([2.5e12, 2.5e9, 2.5e6, 2500, null].map(lib.formatMarketCap),
    ['$2.50T', '$2.5B', '$3M', '$2,500', null]);
  assert.deepEqual([lib.formatPrice(12.345), lib.formatPrice(null)], ['$12.35', null]);
  assert.deepEqual([lib.formatPoints(0.123), lib.formatPoints(0), lib.formatPoints(null)], ['12.3', '0.0', null]);
});

// ---------- rendered output ----------
test('empty selection explains what to do and requests nothing', () => {
  const html = view([]);
  assert.match(html, /No companies selected yet/);
  assert.doesNotMatch(html, /<table/);
});

test('rendered comparison shows values, labelled gaps and each load state', () => {
  const html = view([
    ready('AAA', { signals: [{ signal: 'value', score: 0.8 }, { signal: 'quality', score: 0 }] }),
    ready('BBB', {
      company: { name: 'BBB' }, final_score: null, confidence: null, eligible: null,
      score_status: 'ticker_unavailable', run_date: RUN_B,
      signals: [{ signal: 'quality', score: 0.3 }, { signal: 'broken' }],
    }),
    { ticker: 'CCC', status: 'loading' },
    { ticker: 'DDD', status: 'error', reason: 'http_error', httpStatus: 503 },
  ]);
  const shown = text(html);

  // Values that exist are shown as saved.
  assert.match(shown, /AAA Test Corp/);
  assert.match(shown, /\$2\.5B/);
  assert.match(shown, /Position in 52-week range.*?50%/);
  assert.match(shown, /2026-01-05 14:00 UTC/);
  assert.match(shown, /2026-01-06 14:00 UTC/);

  // Signal rows: union across loaded companies, largest difference first.
  const signalTable = html.slice(html.indexOf('Saved signal values'));
  const row = (name) => text(signalTable.slice(signalTable.indexOf(`>${name}</th>`)).split('</tr>')[0]);
  assert.ok(signalTable.indexOf('>quality</th>') < signalTable.indexOf('>value</th>'));
  assert.match(row('quality'), /quality 0\.0 30\.0 Loading… Not loaded 30\.0/);
  assert.match(row('value'), /value 80\.0 Not saved Loading… Not loaded Needs two saved values/);

  // Missing is said in words; nothing leaks as a programming value.
  assert.match(shown, /Ticker was not saved in this run/);
  assert.match(shown, /No company facts were returned/);
  assert.match(shown, /1 saved signal entry was unreadable/);
  assert.match(shown, /Saved pipeline score 50\.00 Not saved Loading… Not loaded/);
  assert.match(shown, /Market cap \$2\.5B Unavailable Loading… Not loaded/);
  assert.doesNotMatch(shown, /NaN|undefined|null|\[object|Infinity/);

  // Load states and controls are reachable by assistive technology.
  assert.match(html, /role="status"[^>]*>Loading CCC…/);
  assert.match(html, /role="alert"[^>]*>.*HTTP 503/s);
  assert.match(html, /aria-label="Retry loading DDD"/);
  for (const t of ['AAA', 'BBB', 'CCC', 'DDD']) assert.match(html, new RegExp(`aria-label="Remove ${t} from comparison"`));
  assert.equal((html.match(/<caption/g) || []).length, 2);
  assert.ok((html.match(/<th scope="row"/g) || []).length >= 13);
  assert.equal((html.match(/type="radio"/g) || []).length, 5);

  // Different saved runs are called out; account data never appears.
  assert.match(shown, /different saved pipeline runs/);
  assert.doesNotMatch(html, /987654|123\.45|4321\.99/);
});

test('filters, ordering and run notices follow the props', () => {
  const pair = [
    ready('AAA', { signals: [{ signal: 'value', score: 0.8 }, { signal: 'quality', score: 0.1 }] }),
    ready('BBB', { signals: [{ signal: 'quality', score: 0.3 }, { signal: 'alpha', score: 0.6 }] }),
  ];
  const signals = (props) => {
    const html = view(pair, props);
    const body = html.slice(html.lastIndexOf('<tbody'));
    return [...body.matchAll(/<th scope="row"[^>]*>([^<]+)<\/th>/g)].map((m) => m[1]);
  };
  assert.deepEqual(signals({}), ['quality', 'alpha', 'value']);
  assert.deepEqual(signals({ sort: 'name' }), ['alpha', 'quality', 'value']);
  assert.deepEqual(signals({ filter: 'shared' }), ['quality']);
  assert.deepEqual(signals({ filter: 'gaps', sort: 'name' }), ['alpha', 'value']);

  const same = text(view(pair));
  assert.doesNotMatch(same, /different saved pipeline runs|cannot be confirmed/);
  assert.match(text(view([pair[0], ready('BBB', { run_date: null })])), /cannot be confirmed/);
  assert.match(text(view([pair[0]])), /Add at least one more company/);

  const none = view([ready('AAA', { signals: [] }), ready('BBB', { signals: [] })]);
  assert.match(none, /No saved signal values for the selected companies/);
  assert.doesNotMatch(none, /type="radio"/);
  const filteredOut = view([ready('AAA'), ready('BBB')], { filter: 'gaps' });
  assert.match(filteredOut, /No signals match this filter/);
});

test('the page reads its selection from the link and reports what it ignored', () => {
  const realFetch = globalThis.fetch;
  let fetched = 0;
  globalThis.fetch = () => { fetched += 1; return Promise.reject(new Error('no network in tests')); };
  try {
    const page = (url) => renderToStaticMarkup(React.createElement(MemoryRouter, { initialEntries: [url] },
      React.createElement(Compare)));

    const empty = page('/compare');
    assert.match(empty, /Compare companies/);
    assert.match(empty, /No companies selected yet/);
    assert.match(empty, /0 of 4 selected/);
    assert.match(empty, /<label for="([^"]+)"[^>]*>Add tickers<\/label>.*<input id="\1"/s);
    assert.doesNotMatch(empty, /disabled=""/);
    assert.match(empty, /Where these values come from/);
    assert.match(text(empty), /Trade history and account data are not shown/);

    const linked = page('/compare?t=aapl,msft,%3Cscript%3E,AAPL');
    assert.match(linked, /Loading AAPL…/);
    assert.match(linked, /Loading MSFT…/);
    assert.match(linked, /2 of 4 selected/);
    assert.match(text(linked), /Ignored from the link: &lt;script&gt;\./);
    assert.doesNotMatch(linked, /<script/);

    const full = page('/compare?t=A,B,C,D,E');
    assert.match(full, /4 of 4 selected/);
    assert.match(text(full), /left out E\./);
    assert.equal((full.match(/disabled=""/g) || []).length, 2, 'input and Add are disabled when full');
    assert.match(full, /Clear all/);
    assert.equal(fetched, 0, 'rendering alone requests nothing');
  } finally {
    globalThis.fetch = realFetch;
  }
});

// ---------- unloaded companies and the signal filters ----------
test('an unloaded company keeps its place and blocks "saved for every company"', () => {
  const a = column('AAA', { signals: [{ signal: 'value', score: 0.8 }, { signal: 'quality', score: 0.1 }] });
  const b = column('BBB', { signals: [{ signal: 'quality', score: 0.3 }] });
  const names = (rows, filter) => lib.arrangeSignalRows(rows, filter, 'name').map((r) => r.signal);

  const partial = lib.buildSignalRows([a, null, b]);
  assert.deepEqual(partial, [
    { signal: 'value', values: [0.8, null, null], present: 1, unavailable: 1, spread: null },
    { signal: 'quality', values: [0.1, null, 0.3], present: 2, unavailable: 1, spread: 0.2 },
  ].map((row) => ({ ...row, spread: row.spread === null ? null : partial[1].spread })));
  assert.ok(Math.abs(partial[1].spread - 0.2) < 1e-12);
  assert.deepEqual(names(partial, 'shared'), [], 'nothing is shared while a company is unknown');
  assert.deepEqual(names(partial, 'gaps'), ['quality', 'value'], 'and every such row is listed as a gap');

  // Once every company is loaded the same signal is shared again.
  const loaded = lib.buildSignalRows([a, b]);
  assert.deepEqual(names(loaded, 'shared'), ['quality']);
  assert.deepEqual(names(loaded, 'gaps'), ['value']);
  assert.deepEqual(lib.buildSignalRows([null, null]), []);
});

for (const [label, unloaded, cellText] of [
  ['failed', { ticker: 'BBB', status: 'error', reason: 'network_error' }, 'Not loaded'],
  ['loading', { ticker: 'BBB', status: 'loading' }, 'Loading…'],
]) {
  test(`loaded + ${label}: shared shows nothing, gaps shows every row, and the page says why`, () => {
    const columns = [
      ready('AAA', { signals: [{ signal: 'value', score: 0.8 }, { signal: 'quality', score: 0.1 }] }),
      unloaded,
    ];
    const body = (filter) => {
      const html = view(columns, { filter, sort: 'name' });
      return text(html.slice(html.lastIndexOf('<tbody')));
    };
    const signalNames = (filter) => {
      const html = view(columns, { filter, sort: 'name' });
      return [...html.slice(html.lastIndexOf('<tbody')).matchAll(/<th scope="row"[^>]*>([^<]+)<\/th>/g)].map((m) => m[1]);
    };

    assert.deepEqual(signalNames('shared'), [], 'no row may be labelled saved for every company');
    assert.match(body('shared'), /No signal can be confirmed as saved for every company until every company has loaded/);
    assert.deepEqual(signalNames('gaps'), ['quality', 'value']);
    assert.deepEqual(signalNames('all'), ['quality', 'value']);
    assert.match(body('gaps'), new RegExp(`quality 10\\.0 ${cellText} Needs two saved values`));
    assert.match(body('gaps'), new RegExp(`value 80\\.0 ${cellText} Needs two saved values`));

    const shown = text(view(columns));
    assert.match(shown, /1 of 2 selected companies is not loaded\./);
    assert.match(shown, /Missing or not loaded for at least one/);
    assert.doesNotMatch(shown, /NaN|undefined|null|\[object/);

    // With a third, loaded company a difference exists but the row is still not "shared".
    const three = [...columns, ready('CCC', { signals: [{ signal: 'quality', score: 0.3 }] })];
    const threeShared = view(three, { filter: 'shared' });
    assert.doesNotMatch(threeShared.slice(threeShared.lastIndexOf('<tbody')), /<th scope="row"/);
    assert.match(text(view(three, { filter: 'gaps' })), new RegExp(`quality 10\\.0 ${cellText} 30\\.0 20\\.0`));
  });
}

test('the not-loaded notice disappears once every company has loaded', () => {
  const shown = text(view([ready('AAA'), ready('BBB')]));
  assert.doesNotMatch(shown, /not loaded\./);
  assert.doesNotMatch(shown, /No signal can be confirmed/);
});

// ---------- run timestamps ----------
// Backend contract (api/pipeline/runner.py, api/routes/research.py): the run is
// stamped with datetime.utcnow() and sent with .isoformat(), i.e. UTC wall-clock
// time with no offset. Each check runs under two process timezones.
const NOON_PLUS_2 = Date.UTC(2026, 0, 5, 14, 0, 0);
function inZone(zone, body) {
  const before = process.env.TZ;
  process.env.TZ = zone;
  try {
    // Guard against a vacuous pass: the zone change must really have taken effect.
    const expected = zone === 'UTC' ? 0 : 300;
    assert.equal(new Date(NOON_PLUS_2).getTimezoneOffset(), expected, `process is not running in ${zone}`);
    body();
  } finally {
    if (before === undefined) delete process.env.TZ; else process.env.TZ = before;
  }
}

for (const zone of ['UTC', 'America/New_York']) {
  test(`a run time without an offset is read as UTC (browser in ${zone})`, () => {
    inZone(zone, () => {
      for (const naive of ['2026-01-05T14:00:00', '2026-01-05T14:00:00.123456', '2026-01-05 14:00:00', '2026-01-05T14:00']) {
        const instant = lib.parseRunInstant(naive);
        assert.equal(Math.floor(instant / 1000) * 1000, NOON_PLUS_2, naive);
        assert.equal(lib.formatRunTime(column('AAA', { run_date: naive }).runDate), '2026-01-05 14:00 UTC', naive);
      }
      assert.equal(lib.parseRunInstant('2026-01-05T14:00:00.123456'), NOON_PLUS_2 + 123);
      const shown = text(view([ready('AAA', { run_date: '2026-01-05T14:00:00.123456' })]));
      assert.match(shown, /Saved run time 2026-01-05 14:00 UTC/);
      assert.doesNotMatch(shown, /19:00|09:00/);
    });
  });

  test(`explicit offsets are kept and name the same instant (browser in ${zone})`, () => {
    inZone(zone, () => {
      const same = ['2026-01-05T14:00:00', '2026-01-05T14:00:00Z', '2026-01-05T14:00:00+00:00',
        '2026-01-05T09:00:00-05:00', '2026-01-05T19:30:00+05:30', '2026-01-05T15:00:00+0100',
        '2026-01-06T00:00:00+10:00'];
      for (const stamp of same) assert.equal(lib.parseRunInstant(stamp), NOON_PLUS_2, stamp);
      // An offset is not the same thing as no offset: 14:00-05:00 is 19:00 UTC.
      assert.equal(lib.formatRunTime(column('AAA', { run_date: '2026-01-05T14:00:00-05:00' }).runDate), '2026-01-05 19:00 UTC');

      const align = (...dates) => lib.runAlignment(dates.map((run_date, i) => column(`T${i}`, { run_date })));
      assert.equal(align('2026-01-05T14:00:00', '2026-01-05T09:00:00-05:00'), 'same_run');
      assert.equal(align('2026-01-05T14:00:00', '2026-01-05T14:00:00+00:00', '2026-01-05T14:00:00Z'), 'same_run');
      assert.equal(align('2026-01-05T14:00:00', '2026-01-05T14:00:00-05:00'), 'different_runs');
    });
  });

  test(`unusable run times are rejected, not guessed (browser in ${zone})`, () => {
    inZone(zone, () => {
      const invalid = ['not a date', '', '   ', '2026-01-05', '2026-02-30T10:00:00', '2026-13-01T00:00:00',
        '2026-00-10T00:00:00', '2026-01-05T24:00:00', '2026-01-05T10:60:00', '2026-01-05T10:00:61',
        '2026-01-05T14:00:00+25:00', '2026-01-05T14:00:00+05:99', '2026-01-05T14:00:00 UTC',
        'Mon Jan 05 2026 14:00:00', '1767621600000', 1767621600000, null, undefined, {}, ['2026-01-05T14:00:00']];
      for (const raw of invalid) {
        assert.equal(lib.parseRunInstant(raw), null, JSON.stringify(raw));
        assert.equal(column('AAA', { run_date: raw }).runDate, null, JSON.stringify(raw));
      }
      assert.equal(lib.formatRunTime(null), null);
      const shown = text(view([ready('AAA', { run_date: '2026-02-30T10:00:00' }), ready('BBB')]));
      assert.match(shown, /Saved run time No completed run 2026-01-05 14:00 UTC/);
      assert.match(shown, /cannot be confirmed/);
      assert.doesNotMatch(shown, /Invalid Date|NaN/);
    });
  });
}

// ---------- the mounted page: real React lifecycle, fake DOM, fake fetch ----------
// The page is mounted with react-dom/client under <StrictMode> (development
// build, so effects run mount -> cleanup -> remount) inside a MemoryRouter. No
// DOM library is installed, so the container is a small in-memory node tree that
// implements only what React calls. Clicks, typing and submit go through the
// event listeners React itself registered on the container.
class FakeNode {
  constructor(doc, nodeType, nodeName) {
    this.ownerDocument = doc; this.nodeType = nodeType; this.nodeName = nodeName;
    this.childNodes = []; this.parentNode = null; this.nodeValue = null;
  }
  get firstChild() { return this.childNodes[0] ?? null; }
  get lastChild() { return this.childNodes[this.childNodes.length - 1] ?? null; }
  get nextSibling() {
    const siblings = this.parentNode ? this.parentNode.childNodes : [];
    return siblings[siblings.indexOf(this) + 1] ?? null;
  }
  appendChild(child) { return this.insertBefore(child, null); }
  insertBefore(child, before) {
    if (child.parentNode) child.parentNode.removeChild(child);
    const at = before ? this.childNodes.indexOf(before) : this.childNodes.length;
    assert.notEqual(at, -1, 'insertBefore: reference node is not a child');
    this.childNodes.splice(at, 0, child);
    child.parentNode = this;
    return child;
  }
  removeChild(child) {
    const at = this.childNodes.indexOf(child);
    assert.notEqual(at, -1, 'removeChild: node is not a child');
    this.childNodes.splice(at, 1);
    child.parentNode = null;
    return child;
  }
  get textContent() {
    return this.nodeType === 3 ? this.nodeValue : this.childNodes.map((c) => c.textContent).join('');
  }
  set textContent(value) {
    for (const child of [...this.childNodes]) this.removeChild(child);
    if (value !== '' && value != null) this.appendChild(this.ownerDocument.createTextNode(String(value)));
  }
}
class FakeElement extends FakeNode {
  constructor(doc, tag) {
    super(doc, 1, tag.toUpperCase());
    this.tagName = this.nodeName; this.namespaceURI = 'http://www.w3.org/1999/xhtml';
    this.attributes = new Map(); this.style = {}; this.listeners = new Map();
  }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  removeAttribute(name) { this.attributes.delete(name); }
  getAttribute(name) { return this.attributes.has(name) ? this.attributes.get(name) : null; }
  hasAttribute(name) { return this.attributes.has(name); }
  addEventListener(type, listener, options) {
    const capture = typeof options === 'boolean' ? options : Boolean(options && options.capture);
    const key = `${type}:${capture}`;
    if (!this.listeners.has(key)) this.listeners.set(key, []);
    this.listeners.get(key).push(listener);
  }
  removeEventListener() {}
  focus() {}
  querySelectorAll(selector) {
    // React asks for the other radios of a group after a radio changes.
    const name = /name="([^"]*)"/.exec(selector)?.[1];
    return descendants(this).filter((n) => n.nodeName === 'INPUT' && n.type === 'radio' && n.name === name);
  }
}
function descendants(node) {
  return node.childNodes.flatMap((child) => [child, ...descendants(child)]);
}
function fakeDocument() {
  const doc = { nodeType: 9, nodeName: '#document', addEventListener() {}, removeEventListener() {} };
  doc.createElement = (tag) => new FakeElement(doc, tag);
  doc.createTextNode = (value) => Object.assign(new FakeNode(doc, 3, '#text'), { nodeValue: String(value) });
  doc.body = doc.createElement('body');
  doc.documentElement = doc.createElement('html');
  doc.documentElement.appendChild(doc.body);
  doc.activeElement = doc.body;
  doc.oninput = null; // how React detects native input-event support
  doc.defaultView = { document: doc, HTMLIFrameElement: class {}, location: { protocol: 'http:' },
    addEventListener() {}, removeEventListener() {} };
  return doc;
}

test('mounted page: one request per company, honest partial state, retry, add, remove and unmount', async () => {
  const realFetch = globalThis.fetch;
  const realError = console.error;
  const hadWindow = 'window' in globalThis;
  const complaints = [];
  const net = fakeFetch();
  globalThis.fetch = net.fn;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  console.error = (...args) => { complaints.push(args.map(String).join(' ')); };

  // react-dom decides at load time whether it has a document, so the fake one is
  // in place before react-dom/client is first required.
  const doc = fakeDocument();
  globalThis.window = doc.defaultView;
  globalThis.document = doc;
  // On submit React builds a FormData from the form node; Node's own FormData
  // refuses anything that is not a real HTMLFormElement.
  const realFormData = globalThis.FormData;
  globalThis.FormData = class FakeFormData {};

  const { StrictMode, act, createElement } = React;
  const { createRoot } = require('react-dom/client');
  const { useLocation } = require('react-router-dom');

  const container = doc.createElement('div');
  doc.body.appendChild(container);
  let search = null;
  const Probe = () => { search = useLocation().search; return null; };
  const root = createRoot(container);

  const shown = () => container.textContent.replace(/\s+/g, ' ');
  const find = (predicate, what) => {
    const hits = descendants(container).filter((n) => n.nodeType === 1 && predicate(n));
    assert.equal(hits.length, 1, `expected exactly one ${what}, found ${hits.length}`);
    return hits[0];
  };
  const labelled = (label) => find((n) => n.getAttribute('aria-label') === label, `control labelled "${label}"`);
  const radio = (value) => find((n) => n.nodeName === 'INPUT' && n.type === 'radio' && n.value === value, `radio ${value}`);
  const signalRows = () => {
    const tables = descendants(container).filter((n) => n.nodeName === 'TBODY');
    return descendants(tables[tables.length - 1]).filter((n) => n.nodeName === 'TH').map((n) => n.textContent);
  };
  const fire = (type, target, extra = {}) => act(async () => {
    const event = { type, target, bubbles: true, cancelable: true, timeStamp: 0, defaultPrevented: false,
      preventDefault() { this.defaultPrevented = true; }, stopPropagation() {}, ...extra };
    for (const capture of [true, false]) {
      for (const listener of container.listeners.get(`${type}:${capture}`) ?? []) listener(event);
    }
    await settle();
  });
  const answer = (call, body, status) => act(async () => { net.respond(call, body, status); await settle(); });
  const tickerOf = (call) => decodeURIComponent(call.url.split('/').pop());
  const live = (ticker) => net.calls.filter((c) => !c.aborted && !c.done && tickerOf(c) === ticker);
  const liveCall = (ticker) => {
    assert.equal(live(ticker).length, 1, `exactly one request in flight for ${ticker}`);
    const call = live(ticker)[0];
    call.done = true;
    return call;
  };

  try {
    await act(async () => {
      root.render(createElement(StrictMode, null,
        createElement(MemoryRouter, { initialEntries: ['/compare?t=aaa,bbb'] },
          createElement(Probe), createElement(Compare))));
      await settle();
    });

    // Strict Mode mounted, cleaned up and remounted: the first mount's requests
    // were aborted and exactly one per company is in flight.
    assert.equal(live('AAA').length, 1);
    assert.equal(live('BBB').length, 1);
    assert.equal(net.calls.filter((c) => !c.aborted).length, 2);
    assert.ok(net.calls.every((c) => c.url.startsWith('/api/research/ticker/')));
    assert.match(shown(), /Loading AAA….*Loading BBB…/);
    assert.match(shown(), /No company has loaded yet\./);
    assert.match(shown(), /2 of 4 selected/);

    // One company loaded, the other still loading.
    await answer(liveCall('AAA'), payload('AAA', { run_date: '2026-01-05T14:00:00.250000',
      signals: [{ signal: 'value', score: 0.8 }, { signal: 'quality', score: 0.1 }] }));
    assert.match(shown(), /AAA Test Corp/);
    assert.match(shown(), /Saved run time2026-01-05 14:00 UTCLoading…/);
    assert.match(shown(), /1 of 2 selected companies is not loaded\./);
    assert.deepEqual(signalRows(), ['quality', 'value']);
    await fire('click', radio('shared'));
    assert.deepEqual(signalRows(), [], 'nothing is "saved for every company" while BBB is loading');
    assert.match(shown(), /No signal can be confirmed as saved for every company/);
    await fire('click', radio('gaps'));
    assert.deepEqual(signalRows(), ['quality', 'value']);

    // The other company fails; the failure is shown and the rows stay gaps.
    await answer(liveCall('BBB'), { detail: 'unavailable' }, 503);
    assert.match(shown(), /The Sigil backend answered with HTTP 503\./);
    assert.match(shown(), /1 of 2 selected companies is not loaded\./);
    assert.deepEqual(signalRows(), ['quality', 'value']);
    await fire('click', radio('shared'));
    assert.deepEqual(signalRows(), [], 'nothing is "saved for every company" while BBB has failed');

    // Retry issues exactly one new request, for the failed company only.
    const beforeRetry = net.calls.length;
    await fire('click', labelled('Retry loading BBB'));
    assert.equal(net.calls.length, beforeRetry + 1);
    assert.match(shown(), /Loading BBB…/);
    await answer(liveCall('BBB'), payload('BBB', { run_date: '2026-01-05T09:00:00.250-05:00',
      signals: [{ signal: 'quality', score: 0.3 }] }));
    assert.doesNotMatch(shown(), /not loaded\.|HTTP 503|different saved pipeline runs|cannot be confirmed/);
    assert.deepEqual(signalRows(), ['quality'], 'shared now holds the signal both companies have');
    await fire('click', radio('gaps'));
    assert.deepEqual(signalRows(), ['value']);
    await fire('click', radio('all'));

    // Typing a ticker and submitting adds it to the link and requests only the new company.
    const input = find((n) => n.nodeName === 'INPUT' && n.type === 'text', 'ticker input');
    const form = find((n) => n.nodeName === 'FORM', 'form');
    const beforeAdd = net.calls.length;
    input.value = 'ccc';
    await fire('input', input);
    await fire('submit', form);
    assert.equal(search, '?t=AAA%2CBBB%2CCCC');
    assert.equal(net.calls.length, beforeAdd + 1, 'loaded companies are not requested again');
    assert.equal(live('CCC').length, 1);
    assert.match(shown(), /3 of 4 selected/);
    assert.match(shown(), /1 of 3 selected companies is not loaded\./);

    // A bad entry is reported and requests nothing.
    input.value = '../etc';
    await fire('input', input);
    await fire('submit', form);
    assert.match(shown(), /Not a ticker symbol: \.\.\/etc\./);
    assert.equal(net.calls.length, beforeAdd + 1);

    // Removing a company that is still loading aborts its request; a late answer changes nothing.
    const pending = live('CCC')[0];
    await fire('click', labelled('Remove CCC from comparison'));
    assert.equal(pending.aborted, true);
    assert.equal(search, '?t=AAA%2CBBB');
    const settled = shown();
    await answer(pending, payload('CCC'));
    assert.equal(shown(), settled);
    assert.doesNotMatch(shown(), /CCC Test Corp/);

    // Unmounting aborts whatever is in flight and nothing lands afterwards.
    input.value = 'ddd';
    await fire('input', input);
    await fire('submit', form);
    const last = live('DDD')[0];
    assert.ok(last && !last.aborted);
    await act(async () => { root.unmount(); await settle(); });
    assert.equal(last.aborted, true);
    assert.equal(net.calls.filter((c) => !c.aborted && !c.done).length, 0, 'no request outlives the page');
    net.respond(last, payload('DDD'));
    await settle();
    assert.equal(container.childNodes.length, 0);
    assert.deepEqual(complaints, [], 'React reported no errors or warnings');
  } finally {
    console.error = realError;
    globalThis.fetch = realFetch;
    globalThis.FormData = realFormData;
    if (!hadWindow) { delete globalThis.window; delete globalThis.document; }
    delete globalThis.IS_REACT_ACT_ENVIRONMENT;
  }
});
