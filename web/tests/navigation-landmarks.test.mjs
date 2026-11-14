// Static accessibility semantics of the primary navigation in
// src/components/Layout.tsx, checked on server-rendered markup for a range of
// routes: landmark names, the current-page marker, decorative icons, and the
// More control's hint when the current page sits inside its menu.
//
// Vite only compiles the component in-process (an in-memory build, nothing
// written to disk). Nothing is served, no browser is started and no network is
// used. Effects do not run in a server render, so the layout's WebSocket hook
// never opens a socket.
//
//   cd web && node --test tests/navigation-landmarks.test.mjs
import { before, test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(join(root, "package.json"));
let render;

before(async () => {
  const { build } = await import("vite");
  const { output } = await build({
    root,
    configFile: false,
    logLevel: "silent",
    build: {
      ssr: "src/components/Layout.tsx",
      write: false,
      minify: false,
      rollupOptions: { output: { format: "cjs", exports: "named" } },
    },
  });
  // React and the router stay external, so the compiled layout and this test
  // share one copy of each through the same require.
  const compiled = { exports: {} };
  new Function("require", "module", "exports", output[0].code)(require, compiled, compiled.exports);
  const Layout = compiled.exports.default;
  const { createElement } = require("react");
  const { renderToStaticMarkup } = require("react-dom/server");
  const { MemoryRouter, Routes, Route } = require("react-router-dom");
  render = (path) =>
    renderToStaticMarkup(
      createElement(
        MemoryRouter,
        { initialEntries: [path] },
        createElement(Routes, null, createElement(Route, { path: "*", element: createElement(Layout) })),
      ),
    );
});

const PAGES = [
  ["/", "Stock ideas"], ["/experiments", "Studies"], ["/performance", "Results"], ["/portfolio", "Portfolio"],
  ["/system", "System"], ["/research", "Company research"], ["/overview", "Previous overview"],
  ["/signals", "Signals"], ["/data", "Source health"], ["/compare", "Compare"], ["/lab", "Lab"],
];
const IN_BAR = 4;
const text = (html) => html.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
const navs = (html) => [...html.matchAll(/<nav\b([^>]*)>([\s\S]*?)<\/nav>/g)].map(([, attributes, body]) => ({ attributes, body }));
const links = (html) => [...html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/g)].map(([, attributes, body]) => ({
  href: /href="([^"]*)"/.exec(attributes)?.[1], current: /aria-current="page"/.test(attributes), name: text(body),
}));
const summary = (html) => text(/<summary\b[^>]*>([\s\S]*?)<\/summary>/.exec(html)?.[1] ?? "");

test("both navigation variants are landmarks named Primary and list the same pages in order", () => {
  const [sidebar, bar, ...rest] = navs(render("/"));
  assert.deepEqual(rest, []);
  for (const nav of [sidebar, bar]) assert.match(nav.attributes, /aria-label="Primary"/);
  // They never show together: one is hidden below the md breakpoint, the other at and above it.
  assert.match(sidebar.attributes, /class="[^"]*\bhidden md:flex\b/);
  assert.match(bar.attributes, /class="[^"]*\bmd:hidden\b/);
  const expected = PAGES.map(([href, name]) => ({ href, name }));
  for (const nav of [sidebar, bar]) assert.deepEqual(links(nav.body).map(({ href, name }) => ({ href, name })), expected);
});

test("every icon is hidden from assistive technology, so links are named by their label alone", () => {
  const html = render("/");
  const icons = [...html.matchAll(/<svg\b([^>]*)>/g)].map(([, attributes]) => attributes);
  assert.equal(icons.length, PAGES.length * 2 + 1);
  for (const attributes of icons) assert.match(attributes, /aria-hidden="true"/);
});

test("exactly the current page is marked aria-current in each variant, on every route", () => {
  for (const [path] of PAGES) {
    for (const nav of navs(render(path))) {
      assert.deepEqual(links(nav.body).filter((link) => link.current).map((link) => link.href), [path], path);
    }
  }
});

test("nested routes keep their section current; the home link is not current on other pages", () => {
  for (const nav of navs(render("/experiments/freight-evidence"))) {
    assert.deepEqual(links(nav.body).filter((link) => link.current).map((link) => link.href), ["/experiments"]);
  }
  assert.equal(summary(render("/research/ABC")), "More (includes current page: Company research)");
});

test("the More control names the current page only when that page is inside its menu", () => {
  for (const [index, [path, label]] of PAGES.entries()) {
    assert.equal(summary(render(path)), index < IN_BAR ? "More" : `More (includes current page: ${label})`, path);
  }
  // A page that only shares a prefix with a menu entry is not that entry.
  assert.equal(summary(render("/labyrinth")), "More");
  // Routes match whatever the letter case, and so do the hint and the current-page marker.
  assert.equal(summary(render("/Signals")), "More (includes current page: Signals)");
  assert.equal(summary(render("/RESEARCH/abc")), "More (includes current page: Company research)");
  for (const nav of navs(render("/Signals"))) {
    assert.deepEqual(links(nav.body).filter((link) => link.current).map((link) => link.href), ["/signals"]);
  }
});
