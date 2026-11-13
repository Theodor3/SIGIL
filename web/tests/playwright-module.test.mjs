// Regression tests for tests/playwright-module.mjs: how SIGIL_PLAYWRIGHT_MODULE
// becomes an import() specifier. Pure string handling plus one import of a
// throwaway local module; no browser, server or network.
//
//   cd web && node --test tests/playwright-module.test.mjs
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { importPlaywright, resolvePlaywrightSpecifier } from "./playwright-module.mjs";

test("unset or empty falls back to the installed package", () => {
  for (const value of [undefined, null, ""]) assert.equal(resolvePlaywrightSpecifier(value), "playwright");
});

test("package names pass through unchanged", () => {
  for (const name of ["playwright", "playwright-core", "@playwright/test", "playwright/index.mjs", "@scope/pkg/sub/entry.mjs"]) {
    assert.equal(resolvePlaywrightSpecifier(name), name);
  }
});

test("absolute Windows paths become file URLs, with either slash direction", () => {
  const expected = "file:///C:/Users/dev/npm-cache/node_modules/playwright/index.mjs";
  assert.equal(resolvePlaywrightSpecifier("C:\\Users\\dev\\npm-cache\\node_modules\\playwright\\index.mjs"), expected);
  assert.equal(resolvePlaywrightSpecifier("C:/Users/dev/npm-cache/node_modules/playwright/index.mjs"), expected);
  assert.equal(resolvePlaywrightSpecifier("c:\\pw\\index.mjs"), "file:///c:/pw/index.mjs");
  assert.equal(resolvePlaywrightSpecifier("D:\\My Tools\\play#1\\index.mjs"), "file:///D:/My%20Tools/play%231/index.mjs");
});

test("UNC paths become file URLs with the server as host", () => {
  assert.equal(resolvePlaywrightSpecifier("\\\\buildhost\\share\\playwright\\index.mjs"), "file://buildhost/share/playwright/index.mjs");
});

test("absolute POSIX paths become file URLs on every host platform", () => {
  assert.equal(resolvePlaywrightSpecifier("/opt/pw/node_modules/playwright/index.mjs"), "file:///opt/pw/node_modules/playwright/index.mjs");
  assert.equal(resolvePlaywrightSpecifier("/home/dev/my tools/index.mjs"), "file:///home/dev/my%20tools/index.mjs");
  // A backslash is an ordinary filename character on POSIX and must survive.
  assert.equal(resolvePlaywrightSpecifier("/opt/odd\\name/index.mjs"), "file:///opt/odd%5Cname/index.mjs");
});

test("file URLs are accepted as given", () => {
  assert.equal(resolvePlaywrightSpecifier("file:///C:/pw/playwright/index.mjs"), "file:///C:/pw/playwright/index.mjs");
  assert.equal(resolvePlaywrightSpecifier("file:///opt/pw/playwright/index.mjs"), "file:///opt/pw/playwright/index.mjs");
  assert.equal(resolvePlaywrightSpecifier("FILE:///opt/pw/index.mjs"), "file:///opt/pw/index.mjs");
  assert.equal(resolvePlaywrightSpecifier("file:///opt/my%20tools/index.mjs"), "file:///opt/my%20tools/index.mjs");
});

test("a path and its file URL resolve to the same specifier", () => {
  const path = "C:\\cache\\_npx\\abc\\node_modules\\playwright\\index.mjs";
  assert.equal(resolvePlaywrightSpecifier(path), resolvePlaywrightSpecifier("file:///C:/cache/_npx/abc/node_modules/playwright/index.mjs"));
  assert.equal(resolvePlaywrightSpecifier("/srv/pw/index.mjs"), resolvePlaywrightSpecifier("file:///srv/pw/index.mjs"));
});

test("invalid values are rejected with a message naming the variable", () => {
  const cases = [
    ["./node_modules/playwright/index.mjs", /relative or malformed/],
    ["../playwright/index.mjs", /relative or malformed/],
    ["node_modules\\playwright\\index.mjs", /relative or malformed/],
    ["//host/share/index.mjs", /relative or malformed/],
    ["C:playwright\\index.mjs", /drive-relative/],
    ["https://example.invalid/playwright.mjs", /scheme other than file/],
    ["http://127.0.0.1:9/playwright.mjs", /scheme other than file/],
    ["data:text/javascript,export default 1", /scheme other than file/],
    ["node:fs", /scheme other than file/],
    ["file:", /without a path/],
    ["file:///", /without a path/],
    ["file:///opt/pw/index.mjs?x=1", /query or fragment/],
    ["file:///opt/pw/index.mjs#frag", /query or fragment/],
    [" C:\\pw\\index.mjs", /whitespace/],
    ["/opt/pw/index.mjs\n", /whitespace/],
    ["/opt/pw\u0000/index.mjs", /control character/],
    ["play wright", /not a package name/],
    ["Playwright", /not a package name/],
    [42, /must be a string/],
    [{ path: "/opt/pw" }, /must be a string/],
  ];
  for (const [value, reason] of cases) {
    assert.throws(() => resolvePlaywrightSpecifier(value), (error) => {
      assert.ok(error instanceof TypeError, String(value));
      assert.match(error.message, /^SIGIL_PLAYWRIGHT_MODULE /);
      assert.match(error.message, reason, String(value));
      return true;
    });
  }
});

// The real point of the helper: the same on-disk module loads whether it is
// named by this platform's absolute path or by its file URL.
const scratch = mkdtempSync(join(tmpdir(), "sigil-playwright-module-"));
after(() => rmSync(scratch, { recursive: true, force: true }));

test("importPlaywright loads one local module from its absolute path and from its file URL", async () => {
  const file = join(scratch, "fake playwright.mjs");
  writeFileSync(file, "export const chromium = { synthetic: true };\n");
  const byPath = await importPlaywright({ SIGIL_PLAYWRIGHT_MODULE: file });
  const byUrl = await importPlaywright({ SIGIL_PLAYWRIGHT_MODULE: pathToFileURL(file).href });
  assert.deepEqual(byPath.chromium, { synthetic: true });
  assert.equal(byPath, byUrl, "both spellings resolve to the same module instance");
});

test("importPlaywright rejects an invalid setting before attempting any import", () => {
  assert.throws(() => importPlaywright({ SIGIL_PLAYWRIGHT_MODULE: "https://example.invalid/pw.mjs" }), /scheme other than file/);
});
