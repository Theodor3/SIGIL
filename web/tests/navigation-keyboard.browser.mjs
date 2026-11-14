// Real-browser keyboard regressions for the primary navigation in
// src/components/Layout.tsx: the desktop sidebar, the phone bottom bar and its
// More menu.
//
// Serves the built frontend on loopback. The SIGIL backend is never started:
// every GET under /api/ other than the auth check answers 503 from this file,
// so pages render their own error states. Any non-GET request, and any request
// that leaves loopback, fails the test.
// Existing installation only, no downloads:
//   npm run build
//   SIGIL_PLAYWRIGHT_MODULE=<existing playwright/index.mjs> \
//   SIGIL_CHROMIUM_EXECUTABLE=<existing chrome executable> \
//     node --test tests/navigation-keyboard.browser.mjs
import { after, afterEach, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, extname, join, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const moduleRef = process.env.SIGIL_PLAYWRIGHT_MODULE || 'playwright';
const { chromium } = await import(/^[A-Za-z]:[\\/]|^\//.test(moduleRef) ? pathToFileURL(moduleRef).href : moduleRef);
const dist = resolve(dirname(fileURLToPath(import.meta.url)), '../dist');
const MIME = { '.js': 'application/javascript', '.css': 'text/css', '.html': 'text/html', '.json': 'application/json', '.svg': 'image/svg+xml' };
const unexpected = [];
const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  const json = (body, status = 200) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(body)); };
  if (req.method !== 'GET') { unexpected.push(`${req.method} ${url.pathname}`); return json({}, 405); }
  if (url.pathname === '/api/auth/check') return json({ auth_required: false, authenticated: true });
  if (url.pathname.startsWith('/api/')) return json({ detail: 'Synthetic fixture: no backend' }, 503);
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
afterEach(async () => { for (const context of contexts.splice(0)) await context.close(); unexpected.length = 0; });
after(async () => { try { await browser?.close(); } finally { server.closeAllConnections(); await new Promise(done => server.close(done)); } });

const PHONE = { width: 375, height: 812 };
const DESKTOP = { width: 1280, height: 800 };
async function openPage(viewport, path) {
  const context = await browser.newContext({ viewport, serviceWorkers: 'block' });
  contexts.push(context);
  const problems = { external: [], errors: [] };
  await context.route('**/*', route => {
    if (route.request().url().startsWith(`${origin}/`)) return route.continue();
    problems.external.push(route.request().url()); return route.abort();
  });
  const page = await context.newPage();
  page.setDefaultTimeout(5000);
  page.on('pageerror', error => problems.errors.push(String(error)));
  await page.goto(`${origin}${path}`);
  await nav(page).waitFor();
  return { page, problems };
}
function clean(problems) { assert.deepEqual(problems, { external: [], errors: [] }); assert.deepEqual(unexpected, []); }

// The layout exposes one navigation landmark at each width, and it has a name.
// (Pages may add their own, differently named, navigation regions.)
const nav = page => page.getByRole('navigation', { name: 'Primary' });
const more = page => nav(page).locator('summary');
const menuLink = (page, name) => nav(page).locator('details').getByRole('link', { name, exact: true });
const menuOpen = page => nav(page).locator('details').evaluate(element => element.open);
// Describes the focused element, or null when focus fell back to the page body.
const focused = page => page.evaluate(() => {
  const element = document.activeElement;
  if (!element || element === document.body) return null;
  return { tag: element.tagName.toLowerCase(), text: element.textContent.replace(/\s+/g, ' ').trim(), href: element.getAttribute('href') };
});
const currentPages = page => page.locator('[aria-current="page"]:visible').evaluateAll(elements => elements.map(element => element.getAttribute('href')));
// Route changes commit a moment after the URL updates, so post-navigation state is polled.
async function eventually(read, expected, message) {
  const deadline = Date.now() + 5000; let actual;
  do { actual = await read(); try { assert.deepEqual(actual, expected); return; } catch { await new Promise(done => setTimeout(done, 25)); } } while (Date.now() < deadline);
  assert.deepEqual(actual, expected, message);
}
const moreText = async page => (await more(page).textContent()).replace(/\s+/g, ' ').trim();
const ALL = ['/', '/experiments', '/performance', '/portfolio', '/system', '/research', '/overview', '/signals', '/data', '/compare', '/lab'];

test('desktop sidebar: named landmark, every page reachable by Tab in order, current page announced', async () => {
  const { page, problems } = await openPage(DESKTOP, '/system');
  assert.equal(await nav(page).count(), 1, 'one exposed primary navigation landmark');
  const links = nav(page).getByRole('link');
  assert.deepEqual(await links.evaluateAll(elements => elements.map(element => element.getAttribute('href'))), ALL);
  await links.first().focus();
  const order = [];
  for (let index = 0; index < ALL.length; index += 1) { order.push((await focused(page))?.href); await page.keyboard.press('Tab'); }
  assert.deepEqual(order, ALL);
  assert.deepEqual(await currentPages(page), ['/system']);
  await links.nth(10).focus(); await page.keyboard.press('Enter');
  await page.waitForURL(`${origin}/lab`);
  await eventually(() => currentPages(page), ['/lab']);
  assert.equal((await focused(page))?.href, '/lab', 'focus stays on the activated link');
  // Icons are decorative: each link is named by its label alone.
  assert.equal(await nav(page).locator('svg:not([aria-hidden="true"])').count(), 0);
  assert.equal(await nav(page).getByRole('link', { name: 'Lab', exact: true }).count(), 1);
  clean(problems);
});

test('phone More menu: opens from the keyboard and every page in it is reachable by Tab', async () => {
  const { page, problems } = await openPage(PHONE, '/');
  assert.equal(await nav(page).count(), 1, 'one exposed primary navigation landmark');
  assert.equal(await menuOpen(page), false);
  await more(page).focus(); await page.keyboard.press('Enter');
  assert.equal(await menuOpen(page), true);
  const order = [];
  for (let index = 0; index < 7; index += 1) { await page.keyboard.press('Tab'); order.push((await focused(page))?.href); }
  assert.deepEqual(order, ALL.slice(4));
  clean(problems);
});

test('phone More menu: Escape closes it and returns focus to the More control', async () => {
  const { page, problems } = await openPage(PHONE, '/');
  await more(page).focus(); await page.keyboard.press('Enter');
  await page.keyboard.press('Tab'); await page.keyboard.press('Tab');
  assert.equal((await focused(page))?.href, '/research');
  await page.keyboard.press('Escape');
  assert.equal(await menuOpen(page), false, 'Escape closes the menu');
  assert.equal((await focused(page))?.tag, 'summary', 'focus returns to More');
  // Escape with the menu already closed changes nothing.
  await page.keyboard.press('Escape');
  assert.equal(await menuOpen(page), false); assert.equal((await focused(page))?.tag, 'summary');
  // Escape while focus is still on the control also closes it.
  await page.keyboard.press('Enter'); assert.equal(await menuOpen(page), true);
  await page.keyboard.press('Escape');
  assert.equal(await menuOpen(page), false); assert.equal((await focused(page))?.tag, 'summary');
  clean(problems);
});

test('phone More menu: choosing a page navigates, closes the menu and keeps focus on a visible control', async () => {
  const { page, problems } = await openPage(PHONE, '/');
  await more(page).focus(); await page.keyboard.press('Enter');
  await menuLink(page, 'Lab').focus(); await page.keyboard.press('Enter');
  await page.waitForURL(`${origin}/lab`);
  await eventually(() => menuOpen(page), false);
  await eventually(async () => (await focused(page))?.tag, 'summary', 'focus is not dropped to the page body');
  clean(problems);
});

test('phone More menu: closes when keyboard focus leaves it', async () => {
  const { page, problems } = await openPage(PHONE, '/');
  await more(page).focus(); await page.keyboard.press('Enter');
  await menuLink(page, 'Lab').focus();
  await page.keyboard.press('Tab');
  await eventually(() => menuOpen(page), false, 'tabbing past the last item closes the menu');
  await more(page).focus(); await page.keyboard.press('Enter'); assert.equal(await menuOpen(page), true);
  await page.keyboard.press('Shift+Tab');
  assert.equal((await focused(page))?.href, '/portfolio');
  await eventually(() => menuOpen(page), false, 'tabbing backwards out of the menu closes it');
  clean(problems);
});

test('phone bar: the current page is announced, including when it sits inside More', async () => {
  const { page, problems } = await openPage(PHONE, '/performance');
  assert.deepEqual(await currentPages(page), ['/performance']);
  assert.equal(await moreText(page), 'More');
  await more(page).focus(); await page.keyboard.press('Enter');
  await menuLink(page, 'Signals').focus(); await page.keyboard.press('Enter');
  await page.waitForURL(`${origin}/signals`);
  // The link itself is hidden while the menu is closed, so the control says so.
  await eventually(() => currentPages(page), []);
  await eventually(() => moreText(page), 'More (includes current page: Signals)');
  await more(page).focus(); await page.keyboard.press('Enter');
  assert.deepEqual(await currentPages(page), ['/signals']);
  clean(problems);
});

// Safari does not focus a link or a summary when it is pressed with a pointer:
// the focused control just blurs with no next target, and the click arrives
// later. Chromium is made to behave the same way here (the press is stopped
// from moving focus, then the focused control is blurred from script), so the
// sequence Safari produces is exercised without WebKit.
async function pressLikeSafari(page, target) {
  await page.evaluate(() => document.addEventListener('mousedown', event => event.preventDefault(), { capture: true, once: true }));
  const box = await target.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.evaluate(async () => {
    document.activeElement?.blur();
    // Let the layout's deferred focus check run before the button is released.
    for (let turn = 0; turn < 3; turn += 1) await new Promise(done => setTimeout(done, 0));
  });
}

test('phone More menu: a pointer press that drops focus still activates what was pressed', async () => {
  const { page, problems } = await openPage(PHONE, '/');
  await more(page).focus(); await page.keyboard.press('Enter');
  assert.equal((await focused(page))?.tag, 'summary');
  await pressLikeSafari(page, menuLink(page, 'Lab'));
  assert.equal(await focused(page), null, 'the press left nothing focused, as in Safari');
  assert.equal(await menuOpen(page), true, 'the menu stays open while one of its items is being pressed');
  await page.mouse.up();
  await page.waitForURL(`${origin}/lab`);
  await eventually(() => menuOpen(page), false);
  await eventually(async () => (await focused(page))?.tag, 'summary');
  // Pressing the More control itself while an item has focus closes the menu once, without reopening it.
  await page.keyboard.press('Enter'); await page.keyboard.press('Tab');
  assert.equal((await focused(page))?.href, '/system');
  await pressLikeSafari(page, more(page));
  await page.mouse.up();
  await eventually(() => menuOpen(page), false, 'the press toggles the menu closed rather than closing and reopening it');
  // A keyboard exit afterwards still closes the menu: the press is not remembered.
  await more(page).focus(); await page.keyboard.press('Enter');
  await menuLink(page, 'Lab').focus(); await page.keyboard.press('Tab');
  await eventually(() => menuOpen(page), false);
  clean(problems);
});
