// Real-browser tests for the /compare page, on synthetic data only.
//
// What runs: the built frontend (web/dist) in a real Chromium, served by a
// temporary loopback-only fixture server in this file. The Sigil backend is
// never started or contacted: every API answer below is invented, any API path
// or method other than the two the page is expected to use is recorded and
// fails the test, WebSocket upgrades are closed locally, and every request to
// another origin is aborted and fails the test.
//
// Needs an existing Playwright installation and browser; nothing is downloaded.
//
//   cd web && npm run build
//   SIGIL_PLAYWRIGHT_MODULE=<file URL or path of playwright/index.mjs> \
//     node --test tests/company-compare.browser.mjs
//
// Optional: SIGIL_CHROMIUM_EXECUTABLE (browser binary), SIGIL_BROWSER_ARTIFACTS
// (screenshot directory; defaults to a new folder under the OS temp directory).
import { after, afterEach, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { importPlaywright } from './playwright-module.mjs';

const { chromium } = await importPlaywright();

const dist = resolve(dirname(fileURLToPath(import.meta.url)), '../dist');
const artifacts = process.env.SIGIL_BROWSER_ARTIFACTS
  ? (mkdirSync(process.env.SIGIL_BROWSER_ARTIFACTS, { recursive: true }), process.env.SIGIL_BROWSER_ARTIFACTS)
  : mkdtempSync(join(tmpdir(), 'sigil-compare-browser-'));
const MIME = { '.js': 'application/javascript', '.css': 'text/css', '.html': 'text/html', '.json': 'application/json' };

// ---------- synthetic fixtures ----------
const RUN = '2026-01-05T14:00:00'; // no offset, exactly as the backend sends it
const payload = (ticker, over = {}) => ({
  ticker,
  company: { name: `${ticker} Test Corp`, description: 'x', sector: 'Testing', industry: 'Fixtures',
    market_cap: 2.5e9, price: 50, fifty_two_week_high: 60, fifty_two_week_low: 40 },
  final_score: 0.5, score_status: 'saved', eligible: true, confidence: 0.7,
  signals: [{ signal: 'value', score: 0.8 }, { signal: 'quality', score: 0.3 }],
  score_history: [], evaluations: [],
  trades: [{ id: 7, side: 'buy', shares: 987654, entry_price: 123.45, realized_pnl: 4321.99 }],
  run_date: RUN,
  ...over,
});

// ---------- fixture server ----------
// Research requests are held until the test answers them, unless the ticker has
// an automatic answer registered with fx.auto.
const fx = {
  requests: [],   // every research request: { ticker, aborted, answered, respond(body, status) }
  unexpected: [], // anything the page should never have asked this server for
  sockets: 0,     // WebSocket upgrade attempts, all closed locally
  auto: new Map(),
  reset() { this.requests = []; this.unexpected = []; this.sockets = 0; this.auto = new Map(); },
  for(ticker) { return this.requests.filter((r) => r.ticker === ticker); },
  live(ticker) { return this.for(ticker).filter((r) => !r.aborted && !r.answered); },
};
const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  const json = (body, status = 200) => {
    res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(body));
  };
  const research = /^\/api\/research\/ticker\/([^/]+)$/.exec(url.pathname);
  if (url.pathname.startsWith('/api/') || url.pathname === '/ws') {
    if (req.method !== 'GET') {
      fx.unexpected.push(`${req.method} ${url.pathname}`);
      return json({ detail: 'fixture: method not allowed' }, 405);
    }
    if (url.pathname === '/api/auth/check') return json({ auth_required: false, authenticated: true });
    if (research && url.search === '') {
      const entry = { ticker: decodeURIComponent(research[1]), aborted: false, answered: false };
      entry.respond = (body, status = 200) => { entry.answered = true; if (!entry.aborted) json(body, status); };
      res.on('close', () => { if (!res.writableEnded) entry.aborted = true; });
      fx.requests.push(entry);
      if (fx.auto.has(entry.ticker)) entry.respond(...fx.auto.get(entry.ticker));
      return undefined;
    }
    fx.unexpected.push(`${req.method} ${url.pathname}${url.search}`);
    return json({ detail: 'fixture: unknown path' }, 404);
  }
  if (req.method !== 'GET') { fx.unexpected.push(`${req.method} ${url.pathname}`); res.writeHead(405); return res.end(); }
  const file = url.pathname.startsWith('/assets/') ? resolve(dist, `.${url.pathname}`) : join(dist, 'index.html');
  if (!file.startsWith(dist) || !existsSync(file)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': MIME[extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' });
  return res.end(readFileSync(file));
});
server.on('upgrade', (_req, socket) => { fx.sockets += 1; socket.destroy(); });

let browser;
let origin;
const open = []; // contexts opened by the current test

before(async () => {
  assert.ok(existsSync(join(dist, 'index.html')), 'web/dist is missing: run `npm run build` first');
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  origin = `http://127.0.0.1:${server.address().port}`;
  try {
    browser = await chromium.launch({ headless: true, executablePath: process.env.SIGIL_CHROMIUM_EXECUTABLE || undefined });
  } catch (error) {
    server.closeAllConnections();
    await new Promise((done) => server.close(done));
    throw error;
  }
});
afterEach(async () => {
  for (const request of fx.requests) if (!request.answered && !request.aborted) request.respond({}, 503);
  for (const context of open.splice(0)) await context.close();
  fx.reset();
});
after(async () => {
  try { await browser?.close(); } finally {
    server.closeAllConnections();
    await new Promise((done) => server.close(done));
  }
});

/**
 * Opens a page whose browser clock is in New York. `problems` collects what
 * must never happen: uncaught page errors, requests leaving the fixture origin,
 * and console errors other than the ones the test provokes on purpose (the
 * locally-closed WebSocket and deliberately failed fixture responses).
 */
async function openPage({ width = 1280, height = 800 } = {}) {
  const context = await browser.newContext({ viewport: { width, height }, timezoneId: 'America/New_York', locale: 'en-US' });
  open.push(context);
  const problems = { pageErrors: [], external: [], consoleErrors: [] };
  await context.route('**/*', (route) => {
    const target = route.request().url();
    if (target.startsWith(`${origin}/`)) return route.continue();
    problems.external.push(target);
    return route.abort();
  });
  const page = await context.newPage();
  page.on('pageerror', (error) => problems.pageErrors.push(String(error)));
  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    const text = message.text();
    if (/WebSocket connection to 'ws:\/\/127\.0\.0\.1:\d+\/ws' failed/.test(text)) return;
    if (/Failed to load resource: the server responded with a status of 50[03]/.test(text)) return;
    problems.consoleErrors.push(text);
  });
  return { page, problems };
}
function assertClean(problems) {
  assert.deepEqual(problems.pageErrors, [], 'uncaught errors in the page');
  assert.deepEqual(problems.external, [], 'requests that tried to leave the fixture origin');
  assert.deepEqual(problems.consoleErrors, [], 'unexpected console errors');
  assert.deepEqual(fx.unexpected, [], 'API paths or methods the page should not use');
  assert.ok(fx.sockets >= 1, 'the app shell tried its WebSocket and it was closed locally');
}
async function until(check, what, timeout = 5000) {
  const started = Date.now();
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() - started > timeout) assert.fail(`timed out waiting for ${what}`);
    await new Promise((done) => setTimeout(done, 20));
  }
}
const pending = (ticker) => until(() => fx.live(ticker)[0], `a request for ${ticker}`);
const shot = (page, name) => page.screenshot({ path: join(artifacts, `${name}.png`), fullPage: true });
const selected = (page) => page.getByRole('list', { name: 'Selected companies' }).getByRole('listitem');
const tickers = async (page) => (await selected(page).locator('span.font-bold').allInnerTexts());
const input = (page) => page.getByLabel('Add tickers');
const signalTable = (page) => page.getByRole('table', { name: /Saved signal values/ });
const signalNames = (page) => signalTable(page).locator('tbody th[scope="row"]').allInnerTexts();
const rowText = async (table, name) =>
  (await table.getByRole('row').filter({ has: table.page().getByRole('rowheader', { name, exact: true }) })
    .first().innerText()).replace(/\s+/g, ' ').trim();
const search = (page) => decodeURIComponent(new URL(page.url()).search);

test('keyboard: type, submit, and the duplicate / invalid / four-company limits', async () => {
  for (const t of ['AAPL', 'MSFT', 'C', 'D']) fx.auto.set(t, [payload(t)]);
  const { page, problems } = await openPage();
  await page.goto(`${origin}/compare`);
  await page.getByRole('heading', { name: 'Compare companies' }).waitFor();
  assert.match(await page.locator('main').innerText(), /No companies selected yet/);
  assert.equal(fx.requests.length, 0, 'nothing is requested before a ticker is added');

  // Keyboard only from here: focus the labelled field, type, press Enter.
  await input(page).focus();
  await page.keyboard.type('aapl, msft');
  await page.keyboard.press('Enter');
  await page.getByText('MSFT Test Corp').first().waitFor();
  assert.deepEqual(await tickers(page), ['AAPL', 'MSFT']);
  assert.equal(search(page), '?t=AAPL,MSFT');
  assert.equal(await input(page).inputValue(), '', 'the field is cleared after a successful add');
  assert.deepEqual(fx.requests.map((r) => r.ticker).sort(), ['AAPL', 'MSFT']);

  // Tab order: field -> Add -> Clear all, and Enter on Add submits too.
  await input(page).focus();
  await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(() => document.activeElement.textContent), 'Add');
  await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(() => document.activeElement.textContent), 'Clear all');

  // Duplicate: said in words, no new request, selection unchanged.
  await input(page).focus();
  await page.keyboard.type('Aapl');
  await page.keyboard.press('Enter');
  await page.getByRole('alert').filter({ hasText: 'Already in the comparison.' }).waitFor();
  assert.equal(fx.requests.length, 2);

  // Invalid text never becomes a request or a URL entry.
  await input(page).fill('');
  await page.keyboard.type('../etc <b>');
  await page.keyboard.press('Enter');
  await page.getByRole('alert').filter({ hasText: 'Not a ticker symbol: ../etc, <b>.' }).waitFor();
  assert.equal(fx.requests.length, 2);
  assert.equal(search(page), '?t=AAPL,MSFT');
  assert.equal(await page.locator('main b').count(), 0, 'typed markup is shown as text');

  // Three more when two slots remain: two are added, the third is named as left out.
  await input(page).fill('');
  await page.keyboard.type('c d e');
  await page.keyboard.press('Enter');
  await page.getByRole('alert').filter({ hasText: 'Only 4 companies fit side by side; left out E.' }).waitFor();
  await page.getByText('D Test Corp').first().waitFor();
  assert.deepEqual(await tickers(page), ['AAPL', 'MSFT', 'C', 'D']);
  assert.equal(search(page), '?t=AAPL,MSFT,C,D');
  assert.equal(fx.for('E').length, 0);
  assert.equal(await input(page).isDisabled(), true);
  assert.equal(await page.getByRole('button', { name: 'Add', exact: true }).isDisabled(), true);
  assert.match(await page.locator('main').innerText(), /4 of 4 selected/);

  // The filter radios are a keyboard-operable group.
  await page.getByRole('radio', { name: 'All signals' }).focus();
  await page.keyboard.press('ArrowDown');
  assert.equal(await page.getByRole('radio', { name: 'Saved for every company' }).isChecked(), true);

  // Remove by keyboard frees a slot and re-enables the field.
  await page.getByRole('button', { name: 'Remove D from comparison' }).focus();
  await page.keyboard.press('Enter');
  await until(() => search(page) === '?t=AAPL,MSFT,C', 'the URL to drop D');
  await until(async () => !(await input(page).isDisabled()), 'the field to be enabled again');
  await shot(page, 'keyboard-three-companies-desktop');
  assertClean(problems);
});

test('the URL is the selection: deep link, back, forward and reload', async () => {
  for (const t of ['AAA', 'BBB', 'CCC']) fx.auto.set(t, [payload(t)]);
  const { page, problems } = await openPage();

  // A link with lower case, a duplicate and junk: normalised, junk reported, never rendered as markup.
  await page.goto(`${origin}/compare?t=aaa,%3Cimg%20src%3Dx%3E,aaa`);
  await page.getByText('AAA Test Corp').first().waitFor();
  assert.deepEqual(await tickers(page), ['AAA']);
  assert.match(await page.locator('main').innerText(), /Ignored from the link: <img, src=x>\./);
  assert.equal(await page.locator('main img').count(), 0);
  assert.match(await page.locator('main').innerText(), /Add at least one more company to compare/);

  await input(page).fill('bbb');
  await input(page).press('Enter');
  await page.getByText('BBB Test Corp').first().waitFor();
  await input(page).fill('ccc');
  await input(page).press('Enter');
  await page.getByText('CCC Test Corp').first().waitFor();
  assert.equal(search(page), '?t=AAA,BBB,CCC');
  const beforeBack = fx.requests.length;

  await page.goBack();
  await until(() => search(page) === '?t=AAA,BBB', 'back to two companies');
  await page.getByText('CCC Test Corp').first().waitFor({ state: 'detached' });
  assert.deepEqual(await tickers(page), ['AAA', 'BBB']);
  assert.equal(fx.requests.length, beforeBack, 'going back re-requests nothing already loaded');

  await page.goForward();
  await page.getByText('CCC Test Corp').first().waitFor();
  assert.deepEqual(await tickers(page), ['AAA', 'BBB', 'CCC']);
  assert.equal(fx.for('CCC').length, 2, 'the company that left and came back is loaded again, once');

  const beforeReload = fx.requests.length;
  await page.reload();
  await page.getByText('CCC Test Corp').first().waitFor();
  await page.getByText('AAA Test Corp').first().waitFor();
  assert.deepEqual(await tickers(page), ['AAA', 'BBB', 'CCC']);
  assert.equal(search(page), '?t=AAA,BBB,CCC');
  assert.deepEqual(fx.requests.slice(beforeReload).map((r) => r.ticker).sort(), ['AAA', 'BBB', 'CCC']);

  // Answers that land back to back must not make the page ask for a company twice
  // (this failed intermittently before the loader kept delivered requests until re-sync).
  for (let round = 0; round < 12; round += 1) {
    const start = fx.requests.length;
    await page.reload();
    await page.getByText('CCC Test Corp').first().waitFor();
    await page.getByText('BBB Test Corp').first().waitFor();
    await page.getByText('AAA Test Corp').first().waitFor();
    await page.waitForTimeout(60);
    assert.deepEqual(fx.requests.slice(start).map((r) => r.ticker).sort(), ['AAA', 'BBB', 'CCC'], `reload ${round + 1}`);
  }

  // Clear all empties the URL too, and Back restores the selection.
  await page.getByRole('button', { name: 'Clear all' }).click();
  await page.getByText('No companies selected yet.').waitFor();
  assert.equal(search(page), '');
  await page.goBack();
  await page.getByText('BBB Test Corp').first().waitFor();
  assert.deepEqual(await tickers(page), ['AAA', 'BBB', 'CCC']);
  assertClean(problems);
});

test('loading and failed columns: filters stay honest, retry recovers', async () => {
  const { page, problems } = await openPage();
  await page.goto(`${origin}/compare?t=AAA,BBB`);
  const [a, b] = [await pending('AAA'), await pending('BBB')];
  await page.getByRole('status').filter({ hasText: 'Loading AAA…' }).waitFor();
  await page.getByRole('status').filter({ hasText: 'Loading BBB…' }).waitFor();
  assert.match(await signalTable(page).innerText(), /No company has loaded yet\./);
  assert.equal(await page.getByRole('radio').count(), 0, 'no filter controls before there is anything to filter');

  a.respond(payload('AAA', { signals: [{ signal: 'value', score: 0.8 }, { signal: 'quality', score: 0.1 }] }));
  await page.getByText('AAA Test Corp').first().waitFor();
  const notice = page.getByRole('status').filter({ hasText: '1 of 2 selected companies is not loaded.' });
  await notice.waitFor();
  assert.deepEqual(await signalNames(page), ['quality', 'value']);
  assert.equal(await rowText(signalTable(page), 'value'), 'value 80.0 Loading… Needs two saved values');
  await shot(page, 'loaded-plus-loading-desktop');

  await page.getByRole('radio', { name: 'Saved for every company' }).check();
  assert.deepEqual(await signalNames(page), []);
  assert.match(await signalTable(page).innerText(), /No signal can be confirmed as saved for every company until every company has loaded\./);
  await page.getByRole('radio', { name: 'Missing or not loaded for at least one' }).check();
  assert.deepEqual(await signalNames(page), ['quality', 'value']);

  b.respond({ detail: 'synthetic outage' }, 503);
  const failure = page.getByRole('alert').filter({ hasText: 'The Sigil backend answered with HTTP 503.' });
  await failure.waitFor();
  await notice.waitFor();
  assert.equal(await rowText(signalTable(page), 'value'), 'value 80.0 Not loaded Needs two saved values');
  await page.getByRole('radio', { name: 'Saved for every company' }).check();
  assert.deepEqual(await signalNames(page), [], 'a failed company never counts as having the signal');
  await shot(page, 'loaded-plus-failed-shared-filter-desktop');

  // Retry: exactly one new request, for the failed company only.
  const before = fx.requests.length;
  await page.getByRole('button', { name: 'Retry loading BBB' }).click();
  const again = await pending('BBB');
  await page.getByRole('status').filter({ hasText: 'Loading BBB…' }).waitFor();
  assert.equal(fx.requests.length, before + 1);
  again.respond(payload('BBB', { signals: [{ signal: 'quality', score: 0.3 }] }));
  await page.getByText('BBB Test Corp').first().waitFor();
  await notice.waitFor({ state: 'detached' });
  await failure.waitFor({ state: 'detached' });
  assert.deepEqual(await signalNames(page), ['quality']);
  assert.equal(await rowText(signalTable(page), 'quality'), 'quality 10.0 30.0 20.0');
  await page.getByRole('radio', { name: 'Missing or not loaded for at least one' }).check();
  assert.deepEqual(await signalNames(page), ['value']);
  assertClean(problems);
});

test('remove and clear while a request is pending: aborted, and a late answer changes nothing', async () => {
  const { page, problems } = await openPage();
  await page.goto(`${origin}/compare?t=AAA,BBB`);
  const [a, b] = [await pending('AAA'), await pending('BBB')];
  a.respond(payload('AAA'));
  await page.getByText('AAA Test Corp').first().waitFor();

  await page.getByRole('button', { name: 'Remove BBB from comparison' }).click();
  await until(() => b.aborted, 'the browser to abort the request for the removed company');
  assert.deepEqual(await tickers(page), ['AAA']);
  b.respond(payload('BBB'));
  await page.waitForTimeout(150);
  assert.equal(await page.getByText('BBB Test Corp').count(), 0);
  assert.deepEqual(await tickers(page), ['AAA']);

  // Re-add, then clear everything while it is still loading.
  await input(page).fill('bbb ccc');
  await input(page).press('Enter');
  const [b2, c] = [await pending('BBB'), await pending('CCC')];
  await page.getByRole('button', { name: 'Clear all' }).click();
  await page.getByText('No companies selected yet.').waitFor();
  await until(() => b2.aborted && c.aborted, 'both pending requests to be aborted');
  b2.respond(payload('BBB'));
  c.respond(payload('CCC'));
  await page.waitForTimeout(150);
  assert.equal(await selected(page).count(), 0);
  assert.equal(await page.getByRole('table').count(), 0);
  assert.equal(search(page), '');

  // A company added afterwards starts from a clean loading state with its own request.
  await input(page).fill('ccc');
  await input(page).press('Enter');
  const c2 = await pending('CCC');
  await page.getByRole('status').filter({ hasText: 'Loading CCC…' }).waitFor();
  assert.equal(await page.getByText('CCC Test Corp').count(), 0, 'the earlier late answer was not kept');
  c2.respond(payload('CCC', { company: { name: 'Second Answer Inc' } }));
  await page.getByText('Second Answer Inc').first().waitFor();
  assert.equal(fx.live('AAA').length + fx.live('BBB').length + fx.live('CCC').length, 0);
  assertClean(problems);
});

test('zero is shown as zero, missing is said in words, account data never appears', async () => {
  fx.auto.set('ZERO', [payload('ZERO', { final_score: 0, confidence: 0, eligible: false,
    signals: [{ signal: 'value', score: 0 }, { signal: 'quality', score: 0 }, { signal: 'only_zero', score: 0 }] })]);
  fx.auto.set('GAPS', [payload('GAPS', {
    company: { name: 'GAPS', sector: null, market_cap: 0, price: 'n/a', fifty_two_week_high: null },
    final_score: null, confidence: null, eligible: null, score_status: 'ticker_unavailable', run_date: null,
    signals: [{ signal: 'value', score: 0.25 }, { signal: 'quality', score: null }, { signal: 'broken' }] })]);
  const { page, problems } = await openPage();
  await page.goto(`${origin}/compare?t=ZERO,GAPS`);
  await page.getByText('ZERO Test Corp').first().waitFor();
  await page.getByText('No company facts were returned. Check the symbol.').waitFor();

  const facts = page.getByRole('table', { name: 'Company facts and saved score' });
  assert.equal(await rowText(facts, 'Sector'), 'Sector Testing Unavailable');
  assert.equal(await rowText(facts, 'Market cap'), 'Market cap $2.5B Unavailable');
  assert.equal(await rowText(facts, 'Price'), 'Price $50.00 Unavailable');
  assert.equal(await rowText(facts, 'Saved pipeline score'), 'Saved pipeline score 0.00 Not saved');
  assert.equal(await rowText(facts, 'Confidence'), 'Confidence 0% Not saved');
  assert.equal(await rowText(facts, 'Passed confidence gate'), 'Passed confidence gate No Not saved');
  assert.equal(await rowText(facts, 'Saved run time'), 'Saved run time 2026-01-05 14:00 UTC No completed run');
  assert.match(await rowText(facts, /Position in 52-week range/), /50% Unavailable$/);

  assert.equal(await rowText(signalTable(page), 'value'), 'value 0.0 25.0 25.0');
  assert.equal(await rowText(signalTable(page), 'quality'), 'quality 0.0 Not saved Needs two saved values');
  assert.equal(await rowText(signalTable(page), 'only_zero'), 'only_zero 0.0 Not saved Needs two saved values');
  const main = await page.locator('main').innerText();
  assert.match(main, /2 saved signal entries were unreadable and left out\./);
  assert.match(main, /cannot be confirmed that these scores come from the same run/);
  assert.doesNotMatch(main, /NaN|undefined|null|\[object|Infinity|Invalid Date/);
  assert.doesNotMatch(await page.content(), /987654|123\.45|4321\.99/);
  await shot(page, 'zero-and-missing-desktop');
  assertClean(problems);
});

test('run times are UTC on a New York browser; offsets are kept; bad stamps are refused', async () => {
  fx.auto.set('NAIVE', [payload('NAIVE', { run_date: '2026-01-05T14:00:00.250000' })]);
  fx.auto.set('EAST', [payload('EAST', { run_date: '2026-01-05T09:00:00.250-05:00' })]);
  fx.auto.set('LATER', [payload('LATER', { run_date: '2026-01-05T14:00:00-05:00' })]);
  fx.auto.set('BAD', [payload('BAD', { run_date: '2026-02-30T10:00:00' })]);
  const { page, problems } = await openPage();
  await page.goto(`${origin}/compare?t=NAIVE,EAST`);
  await page.getByText('EAST Test Corp').first().waitFor();
  await page.getByText('NAIVE Test Corp').first().waitFor();

  // The test is only meaningful if the browser really is five hours behind UTC.
  assert.deepEqual(await page.evaluate(() => [
    Intl.DateTimeFormat().resolvedOptions().timeZone, new Date(2026, 0, 5, 14).getTimezoneOffset(),
    new Date('2026-01-05T14:00:00').getUTCHours()]), ['America/New_York', 300, 19]);

  const facts = page.getByRole('table', { name: 'Company facts and saved score' });
  assert.equal(await rowText(facts, 'Saved run time'), 'Saved run time 2026-01-05 14:00 UTC 2026-01-05 14:00 UTC');
  assert.doesNotMatch(await page.locator('main').innerText(), /different saved pipeline runs|cannot be confirmed|19:00/);

  await page.goto(`${origin}/compare?t=NAIVE,LATER,BAD`);
  await page.getByText('BAD Test Corp').first().waitFor();
  await page.getByText('LATER Test Corp').first().waitFor();
  await page.getByText('NAIVE Test Corp').first().waitFor();
  assert.equal(await rowText(facts, 'Saved run time'),
    'Saved run time 2026-01-05 14:00 UTC 2026-01-05 19:00 UTC No completed run');
  assert.match(await page.locator('main').innerText(), /cannot be confirmed that these scores come from the same run/);

  await page.getByRole('button', { name: 'Remove BAD from comparison' }).click();
  await page.getByRole('alert').filter({ hasText: 'different saved pipeline runs' }).waitFor();
  await shot(page, 'run-times-new-york-desktop');
  assertClean(problems);
});

for (const [label, width, height] of [['desktop', 1280, 800], ['narrow-390', 390, 844], ['narrow-320', 320, 568]]) {
  test(`layout at ${width}px: page stays inside the viewport and the tables scroll sideways`, async () => {
    const long = { signals: [{ signal: 'value', score: 0.8 }, { signal: 'quality', score: 0.3 },
      { signal: 'a_signal_with_a_fairly_long_name', score: 0.55 }] };
    fx.auto.set('AAAAAA', [payload('AAAAAA', { ...long,
      company: { name: 'An Exceptionally Long Company Name Holdings International Incorporated', sector: 'Testing',
        industry: 'Semiconductor Equipment and Materials Manufacturing', market_cap: 2.5e12, price: 1234.5,
        fifty_two_week_high: 2000, fifty_two_week_low: 900 } })]);
    fx.auto.set('BRK.B', [payload('BRK.B', long)]);
    fx.auto.set('CCC', [payload('CCC', long)]);
    const { page, problems } = await openPage({ width, height });
    await page.goto(`${origin}/compare?t=AAAAAA,BRK.B,CCC,DDD`);
    const d = await pending('DDD');
    await page.getByText('CCC Test Corp').first().waitFor();
    await page.getByText('BRK.B Test Corp').first().waitFor();
    await page.getByText('An Exceptionally Long Company Name').first().waitFor();
    await shot(page, `four-companies-one-loading-${label}`);
    d.respond({ detail: 'synthetic outage' }, 500);
    await page.getByRole('alert').filter({ hasText: 'HTTP 500' }).waitFor();
    assert.equal(fx.for('BRK.B').length, 1, 'a class-share symbol is requested as typed');

    const measure = () => page.evaluate(() => {
      const main = document.querySelector('main');
      const box = (el) => { const r = el.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height }; };
      const scrollers = [...main.querySelectorAll('.overflow-x-auto')].map((el) => ({
        ...box(el), clientWidth: el.clientWidth, scrollWidth: el.scrollWidth,
        overflowX: getComputedStyle(el).overflowX }));
      // Everything that is not inside a sideways-scrolling table area.
      const outside = (selector) => [...main.querySelectorAll(selector)].filter((el) => !el.closest('.overflow-x-auto'));
      const controls = outside('input[type="text"], button, label').map((el) => ({
        name: el.getAttribute('aria-label') || el.textContent.trim().slice(0, 30), ...box(el) }));
      const blocks = outside('h1, h2, p, li, fieldset').map((el) => ({
        name: el.textContent.trim().slice(0, 30), ...box(el) }));
      return { viewport: window.innerWidth, doc: document.documentElement.scrollWidth, body: document.body.scrollWidth,
        main: { ...box(main), clientWidth: main.clientWidth, scrollWidth: main.scrollWidth }, scrollers, controls, blocks };
    });
    const m = await measure();

    // Nothing makes the page itself scroll sideways.
    assert.ok(m.doc <= m.viewport, `document is ${m.doc}px wide in a ${m.viewport}px viewport`);
    assert.ok(m.body <= m.viewport, `body is ${m.body}px wide in a ${m.viewport}px viewport`);
    assert.ok(m.main.scrollWidth <= m.main.clientWidth, `main overflows: ${m.main.scrollWidth} > ${m.main.clientWidth}`);
    // Every control and text block outside the tables is fully inside the viewport.
    for (const item of [...m.controls, ...m.blocks]) {
      assert.ok(item.left >= -0.5 && item.right <= m.viewport + 0.5,
        `"${item.name}" spans ${item.left.toFixed(0)}..${item.right.toFixed(0)} in a ${m.viewport}px viewport`);
    }
    // Touch targets are not slivers.
    for (const control of m.controls.filter((c) => /^(Remove|Retry)/.test(c.name) || c.name === 'Add')) {
      assert.ok(control.width >= 24 && control.height >= 16, `"${control.name}" is ${control.width}x${control.height}`);
    }
    assert.equal(m.scrollers.length, 2);
    for (const scroller of m.scrollers) {
      assert.equal(scroller.overflowX, 'auto');
      assert.ok(scroller.right <= m.viewport + 0.5 && scroller.left >= -0.5, 'the scroll area itself is inside the viewport');
    }

    // The explanation of the signal scale is readable without scrolling sideways,
    // and is still announced with the table.
    const explained = await signalTable(page).evaluate((table) => {
      const note = document.getElementById(table.getAttribute('aria-describedby') ?? '');
      if (!note) return null;
      const r = note.getBoundingClientRect();
      return { text: note.textContent, left: r.left, right: r.right, insideScroller: Boolean(note.closest('.overflow-x-auto')) };
    });
    assert.ok(explained, 'the signal table points at its explanation');
    assert.match(explained.text, /0–100 scale.*not a recommendation/);
    assert.equal(explained.insideScroller, false);
    assert.ok(explained.left >= 0 && explained.right <= m.viewport + 0.5);

    // Both tables: the last column can be brought fully into view, by script and by wheel/trackpad.
    for (const name of ['Company facts and saved score', /Saved signal values/]) {
      const table = page.getByRole('table', { name });
      const scroller = table.locator('xpath=ancestor::div[contains(@class,"overflow-x-auto")][1]');
      const lastHead = table.locator('thead th').last();
      const visibleWithin = async () => {
        const [s, h] = [await scroller.boundingBox(), await lastHead.boundingBox()];
        return h.x >= s.x - 0.5 && h.x + h.width <= s.x + s.width + 0.5;
      };
      const overflow = await scroller.evaluate((el) => el.scrollWidth - el.clientWidth);
      if (width < 600) assert.ok(overflow > 0, 'four columns do not fit a phone, so the table must scroll');
      if (overflow > 0) {
        assert.equal(await visibleWithin(), false, 'the last column starts out of view');
        // Put the top of the table at the top of the screen so the pointer is over
        // the table itself and not over the fixed bottom bar of the phone layout.
        await scroller.evaluate((el) => el.scrollIntoView({ block: 'start' }));
        const box = await scroller.boundingBox();
        await page.mouse.move(box.x + box.width / 2, box.y + 40);
        assert.equal(await scroller.evaluate((el, [x, y]) => el.contains(document.elementFromPoint(x, y)),
          [box.x + box.width / 2, box.y + 40]), true, 'the pointer is over the table');
        await page.mouse.wheel(overflow + 50, 0);
        await until(() => scroller.evaluate((el) => el.scrollLeft > 0), 'a horizontal wheel/trackpad gesture to scroll the table', 3000);
        await scroller.evaluate((el) => { el.scrollLeft = el.scrollWidth; });
      }
      assert.equal(await visibleWithin(), true, 'the last column is reachable');
      // Scrolled all the way right, each row still says what it is, and the row
      // label does not sit on top of the last column.
      const labels = await table.evaluate((el) => {
        const area = el.closest('.overflow-x-auto').getBoundingClientRect();
        const last = el.querySelector('thead th:last-child').getBoundingClientRect();
        return [...el.querySelectorAll('thead th:first-child, tbody th[scope="row"]')].map((th) => {
          const r = th.getBoundingClientRect();
          const probe = document.elementFromPoint(r.left + 4, r.top + r.height / 2);
          return { name: th.textContent.trim().slice(0, 24), visible: r.left >= area.left - 0.5 && r.right <= area.right + 0.5,
            flush: r.left - area.left <= 1,
            onTop: th.contains(probe), clearOfLast: r.right <= last.left + 0.5,
            opaque: getComputedStyle(th).backgroundColor !== 'rgba(0, 0, 0, 0)' };
        });
      });
      assert.ok(labels.length >= 4);
      for (const l of labels) {
        assert.ok(l.visible, `row label "${l.name}" is out of view after scrolling right`);
        assert.ok(l.clearOfLast, `row label "${l.name}" covers the last column`);
        assert.ok(l.flush, `scrolled values can show in a gap to the left of row label "${l.name}"`);
        if (overflow > 0) assert.ok(l.opaque, `row label "${l.name}" lets scrolled values show through`);
      }
      // The table area can be scrolled from the keyboard as well.
      if (overflow > 0) {
        await scroller.evaluate((el) => { el.scrollLeft = 0; });
        await scroller.focus();
        assert.equal(await scroller.evaluate((el) => document.activeElement === el), true, 'the table area takes keyboard focus');
        await page.keyboard.press('ArrowRight');
        await page.keyboard.press('ArrowRight');
        await until(() => scroller.evaluate((el) => el.scrollLeft > 0), 'arrow keys to scroll the table', 3000);
        await scroller.evaluate((el) => { el.scrollLeft = el.scrollWidth; });
      }
      assert.equal(await page.evaluate(() => document.documentElement.scrollLeft), 0, 'scrolling a table does not move the page');
    }
    await shot(page, `four-companies-scrolled-right-${label}`);

    // On a phone the fixed bottom bar must not cover the end of the page.
    if (width < 768) {
      const covered = await page.evaluate(() => {
        const main = document.querySelector('main');
        main.scrollTop = main.scrollHeight; window.scrollTo(0, document.documentElement.scrollHeight);
        const last = [...main.querySelectorAll('p')].pop().getBoundingClientRect();
        const bar = [...document.querySelectorAll('nav')].find((n) => getComputedStyle(n).position === 'fixed').getBoundingClientRect();
        return { lastBottom: last.bottom, barTop: bar.top };
      });
      assert.ok(covered.lastBottom <= covered.barTop + 0.5,
        `the last line ends at ${covered.lastBottom}px but the bottom bar starts at ${covered.barTop}px`);
      await page.screenshot({ path: join(artifacts, `page-end-${label}.png`) });
    }
    assertClean(problems);
  });
}
