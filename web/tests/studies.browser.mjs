// Real-browser regressions for the Studies catalog. Synthetic study fixtures only.
// Serve the built frontend on loopback; the SIGIL backend is never started.
// All external requests and unexpected API methods/paths fail the tests.
// Existing installation only, no downloads:
//   npm run build
//   SIGIL_PLAYWRIGHT_MODULE=<existing playwright/index.mjs> node --test tests/studies.browser.mjs
import { after, afterEach, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import { dirname, extname, join, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

const moduleRef = process.env.SIGIL_PLAYWRIGHT_MODULE || 'playwright';
const { chromium } = await import(/^[A-Za-z]:[\\/]|^\//.test(moduleRef) ? pathToFileURL(moduleRef).href : moduleRef);
const dist = resolve(dirname(fileURLToPath(import.meta.url)), '../dist');
const artifacts = process.env.SIGIL_BROWSER_ARTIFACTS
  ? (mkdirSync(process.env.SIGIL_BROWSER_ARTIFACTS, { recursive: true }), process.env.SIGIL_BROWSER_ARTIFACTS)
  : mkdtempSync(join(tmpdir(), 'sigil-studies-browser-'));
const MIME = { '.js': 'application/javascript', '.css': 'text/css', '.html': 'text/html', '.json': 'application/json', '.svg': 'image/svg+xml' };
const study = (id, extra = {}) => ({
  id, title: `${id} study`, ticker: 'ABC', status: 'in_progress', stage: 'feasibility',
  hypothesis: 'Synthetic question', hypothesisVersion: '1', createdAt: '2026-10-01',
  nextAction: 'Collect evidence', sourceSamples: 0, originalPublicationTimesVerified: false,
  predictiveResultsAvailable: false, findings: [], publicSources: [], ...extra,
});
const records = [
  study('alpha', { title: 'Alpha freight study', ticker: 'CSX' }),
  study('beta', { title: 'Beta weather study', ticker: 'CORN', status: 'negative_result', createdAt: '2026-10-02' }),
  study('gamma', { title: 'Gamma freight study', ticker: 'CSX', status: 'negative_result', createdAt: '2026-10-03' }),
];
const publication = (experiments = records) => ({ schemaVersion: 1, publicationMode: 'reviewed_snapshot', reviewedOn: '2026-11-11', contentSha256: 'a'.repeat(64), experiments });
const fx = { responses: [], requests: 0, unexpected: [], reset() { this.responses = []; this.requests = 0; this.unexpected = []; } };
const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  const json = (body, status = 200) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(body)); };
  if (req.method !== 'GET') { fx.unexpected.push(`${req.method} ${url.pathname}`); return json({}, 405); }
  if (url.pathname === '/api/auth/check') return json({ auth_required: false, authenticated: true });
  if (url.pathname.startsWith('/api/')) { fx.unexpected.push(`${req.method} ${url.pathname}`); return json({}, 404); }
  if (url.pathname === '/research/experiments.json') {
    fx.requests += 1;
    const response = fx.responses.shift() ?? [publication(), 200];
    return json(...response);
  }
  const requested = resolve(dist, `.${url.pathname}`);
  const file = requested.startsWith(`${dist}${sep}`) && existsSync(requested) && extname(requested)
    ? requested : join(dist, 'index.html');
  res.writeHead(200, { 'Content-Type': MIME[extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' });
  res.end(readFileSync(file));
});
server.on('upgrade', (_req, socket) => socket.destroy());
let browser, origin;
const contexts = [];
before(async () => {
  assert.ok(existsSync(join(dist, 'index.html')), 'Run npm run build first');
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  origin = `http://127.0.0.1:${server.address().port}`;
  try { browser = await chromium.launch({ headless: true, executablePath: process.env.SIGIL_CHROMIUM_EXECUTABLE || undefined }); }
  catch (error) { server.closeAllConnections(); await new Promise(done => server.close(done)); throw error; }
});
afterEach(async () => { for (const context of contexts.splice(0)) { for (const page of context.pages()) await page.screenshot({ path: join(artifacts, 'latest.png'), fullPage: true }); await context.close(); } fx.reset(); });
after(async () => { try { await browser?.close(); } finally { server.closeAllConnections(); await new Promise(done => server.close(done)); } });
async function openPage(width = 1280) {
  const context = await browser.newContext({ viewport: { width, height: 800 }, serviceWorkers: 'block' });
  contexts.push(context);
  const problems = { external: [], errors: [], console: [] };
  await context.route('**/*', route => {
    if (route.request().url().startsWith(`${origin}/`)) return route.continue();
    problems.external.push(route.request().url()); return route.abort();
  });
  const page = await context.newPage();
  page.setDefaultTimeout(5000);
  page.on('pageerror', error => problems.errors.push(String(error)));
  page.on('console', message => {
    if (message.type() !== 'error') return;
    if (/WebSocket connection to 'ws:\/\/127\.0\.0\.1:\d+\/ws' failed|Failed to load resource: the server responded with a status of 503/.test(message.text())) return;
    problems.console.push(message.text());
  });
  return { page, problems };
}
function clean(problems) { assert.deepEqual(problems, { external: [], errors: [], console: [] }); assert.deepEqual(fx.unexpected, []); }
const search = page => page.getByRole('searchbox', { name: 'Find a study' });
const status = page => page.getByRole('combobox', { name: /^Status/ });
const sort = page => page.getByRole('combobox', { name: /^Sort/ });
const catalog = page => page.getByRole('region', { name: 'Published studies' });
const cards = page => catalog(page).locator('article');
const loaded = page => catalog(page).waitFor();

// Fails on 06766fe: the catalog unmounts on dossier navigation and loses state.
test('filters survive dossier navigation, in-app Back, and browser Back/Forward', async () => {
  const { page, problems } = await openPage();
  await page.goto(`${origin}/experiments`); await loaded(page);
  await search(page).fill('freight'); await status(page).selectOption('negative_result'); await sort(page).selectOption('title');
  assert.equal(await cards(page).count(), 1);
  await page.getByRole('link', { name: 'Read evidence and limitations' }).click();
  await page.getByRole('heading', { level: 1, name: 'Gamma freight study' }).waitFor();
  await page.getByRole('link', { name: /All experiments/ }).click(); await loaded(page);
  assert.equal(await search(page).inputValue(), 'freight');
  assert.equal(await status(page).inputValue(), 'negative_result'); assert.equal(await sort(page).inputValue(), 'title');
  assert.equal(await cards(page).count(), 1);
  await page.goBack(); await page.getByRole('heading', { level: 1, name: 'Gamma freight study' }).waitFor();
  await page.goForward(); await loaded(page);
  assert.equal(await search(page).inputValue(), 'freight'); assert.equal(await cards(page).count(), 1);
  clean(problems);
});



test('bookmarked filters reload accurately and typing does not create history entries', async () => {
  const { page, problems } = await openPage();
  await page.goto(`${origin}/experiments?q=freight&status=negative_result&sort=title&ref=notes`); await loaded(page);
  assert.equal(await cards(page).count(), 1); assert.equal(await search(page).inputValue(), 'freight');
  await page.reload(); await loaded(page);
  assert.equal(await status(page).inputValue(), 'negative_result'); assert.equal(await sort(page).inputValue(), 'title');
  const before = await page.evaluate(() => history.length);
  await search(page).fill('Gamma'); await search(page).fill('freight');
  assert.equal(await page.evaluate(() => history.length), before);
  assert.equal(new URL(page.url()).searchParams.get('ref'), 'notes');
  await page.getByRole('link', { name: 'Read evidence and limitations' }).click();
  await page.getByRole('heading', { level: 1, name: 'Gamma freight study' }).waitFor();
  await page.goBack(); await loaded(page);
  assert.equal(await search(page).inputValue(), 'freight'); assert.equal(await cards(page).count(), 1);
  clean(problems);
});

test('unknown statuses stay explicit; Clear filters preserves sort and unrelated URL fields', async () => {
  const { page, problems } = await openPage();
  await page.goto(`${origin}/experiments?q=freight&status=future_state&sort=title&ref=notes`); await loaded(page);
  assert.equal(await status(page).inputValue(), 'future_state');
  assert.match(await status(page).innerText(), /future state \(not in this publication\)/);
  await page.getByRole('heading', { name: 'No studies match these filters' }).waitFor();
  await page.getByRole('button', { name: 'Clear filters' }).click();
  await catalog(page).getByRole('heading', { name: 'Alpha freight study' }).waitFor();
  assert.equal(await cards(page).count(), 3); assert.equal(await sort(page).inputValue(), 'title');
  assert.equal(new URL(page.url()).searchParams.get('ref'), 'notes');
  assert.equal(new URL(page.url()).searchParams.has('q'), false);
  assert.equal(new URL(page.url()).searchParams.has('status'), false);
  clean(problems);
});

test('initial publication failure offers retry without losing bookmarked filters', async () => {
  fx.responses.push([{}, 503]);
  const { page, problems } = await openPage();
  await page.goto(`${origin}/experiments?q=freight&sort=title`);
  await page.getByRole('alert').waitFor(); assert.equal(await catalog(page).count(), 0);
  await page.getByRole('button', { name: 'Try again' }).click(); await loaded(page);
  assert.equal(await search(page).inputValue(), 'freight'); assert.equal(await cards(page).count(), 2);
  clean(problems);
});

test('invalid refresh retains the previous filtered publication and retry accepts new records', async () => {
  const { page, problems } = await openPage();
  await page.goto(`${origin}/experiments?q=freight&status=negative_result`); await loaded(page);
  fx.responses.push([{ ...publication(), schemaVersion: 99 }, 200]);
  await page.getByRole('button', { name: 'Refresh publication' }).click();
  await page.getByRole('alert').waitFor();
  assert.match(await page.getByRole('alert').innerText(), /previously loaded publication is still shown/);
  assert.equal(await cards(page).count(), 1); assert.equal(await search(page).inputValue(), 'freight');
  fx.responses.push([publication([...records, study('delta', { title: 'Delta freight study', status: 'negative_result' })]), 200]);
  await page.getByRole('button', { name: 'Try again' }).click();
  await catalog(page).getByRole('heading', { name: 'Delta freight study' }).waitFor();
  assert.equal(await cards(page).count(), 2); assert.equal(await status(page).inputValue(), 'negative_result');
  assert.equal(await page.getByRole('alert').count(), 0);
  clean(problems);
});

test('refresh removing the selected status does not silently broaden results', async () => {
  const { page, problems } = await openPage();
  await page.goto(`${origin}/experiments?status=negative_result`); await loaded(page);
  fx.responses.push([publication([records[0]]), 200]);
  await page.getByRole('button', { name: 'Refresh publication' }).click();
  await page.getByRole('heading', { name: 'No studies match these filters' }).waitFor();
  assert.equal(await status(page).inputValue(), 'negative_result');
  assert.match(await status(page).innerText(), /Negative finding \(not in this publication\)/);
  await page.getByRole('button', { name: 'Clear filters' }).click();
  await catalog(page).getByRole('heading', { name: 'Alpha freight study' }).waitFor();
  assert.equal(await cards(page).count(), 1); clean(problems);
});

test('missing dossier keeps a working return link with its filter context', async () => {
  const { page, problems } = await openPage();
  await page.goto(`${origin}/experiments/missing?q=weather&sort=title`);
  await page.getByRole('heading', { name: 'Experiment not found' }).waitFor();
  await page.getByRole('link', { name: /Back to all experiments/ }).click(); await loaded(page);
  assert.equal(await search(page).inputValue(), 'weather'); assert.equal(await cards(page).count(), 1);
  clean(problems);
});

test('mobile filter and dossier controls remain usable', async () => {
  const { page, problems } = await openPage(375);
  await page.goto(`${origin}/experiments?q=freight&status=negative_result&sort=title`); await loaded(page);
  await page.getByRole('link', { name: 'Read evidence and limitations' }).click();
  await page.getByRole('heading', { level: 1, name: 'Gamma freight study' }).waitFor();
  await page.getByRole('link', { name: /All experiments/ }).click(); await loaded(page);
  assert.equal(await cards(page).count(), 1); assert.equal(await search(page).inputValue(), 'freight');
  await page.screenshot({ path: join(artifacts, 'studies-mobile.png'), fullPage: true });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'No horizontal page overflow');
  clean(problems);
});

test('prototype-named status URLs remain readable empty filters instead of crashing React', async () => {
  const { page, problems } = await openPage();
  for (const value of ['__proto__', 'constructor', 'toString']) {
    await page.goto(`${origin}/experiments?status=${encodeURIComponent(value)}`); await loaded(page);
    assert.equal(await status(page).inputValue(), value);
    await page.getByRole('heading', { name: 'No studies match these filters' }).waitFor();
    await page.getByRole('button', { name: 'Clear filters' }).click();
    await catalog(page).getByRole('heading', { name: 'Alpha freight study' }).waitFor();
    assert.equal(await cards(page).count(), 3);
  }
  clean(problems);
});
