// Turns SIGIL_PLAYWRIGHT_MODULE into something `import()` accepts on every
// platform. Node's ESM loader rejects a bare Windows path such as
// C:\tools\playwright\index.mjs (it reads "C:" as a URL scheme), so absolute
// paths are converted to file: URLs here. Test-harness helper only; nothing in
// the application imports it.
//
// Accepted:
//   unset or empty                        -> "playwright" (the installed package)
//   a package name, e.g. playwright-core  -> unchanged
//   a file: URL                           -> unchanged (normalised)
//   an absolute Windows path, either slash direction, or a UNC path
//   an absolute POSIX path
// Everything else throws: relative paths (they would silently resolve against
// the test file, not the working directory), other URL schemes, and values
// with surrounding whitespace or control characters.
import { pathToFileURL } from "node:url";

export const DEFAULT_PLAYWRIGHT_MODULE = "playwright";

const WINDOWS_DRIVE = /^[A-Za-z]:[\\/]/;
const WINDOWS_UNC = /^\\\\[^\\/]+[\\/][^\\/]+/;
const PACKAGE_NAME = /^(?:@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*(?:\/[A-Za-z0-9._~-]+)*$/;
const CONTROL = /[\u0000-\u001f\u007f]/;

function invalid(value, reason) {
  return new TypeError(
    `SIGIL_PLAYWRIGHT_MODULE ${reason}: ${JSON.stringify(value)}. ` +
      "Use a package name, an absolute path, or a file: URL to playwright/index.mjs.",
  );
}

/** Returns the specifier to pass to `import()` for the given setting. */
export function resolvePlaywrightSpecifier(value) {
  if (value === undefined || value === null || value === "") return DEFAULT_PLAYWRIGHT_MODULE;
  if (typeof value !== "string") throw invalid(value, "must be a string");
  if (value !== value.trim()) throw invalid(value, "has leading or trailing whitespace");
  if (CONTROL.test(value)) throw invalid(value, "contains a control character");

  // Checked before URL parsing: "C:/x" would otherwise parse as scheme "c:".
  if (WINDOWS_DRIVE.test(value) || WINDOWS_UNC.test(value)) return pathToFileURL(value, { windows: true }).href;
  if (/^[A-Za-z]:/.test(value)) throw invalid(value, "is a drive-relative path, not an absolute one");
  if (value.startsWith("/") && !value.startsWith("//")) return pathToFileURL(value, { windows: false }).href;

  if (/^file:/i.test(value)) {
    let url;
    try { url = new URL(value); } catch { throw invalid(value, "is not a valid file: URL"); }
    if (url.pathname === "" || url.pathname === "/") throw invalid(value, "is a file: URL without a path");
    if (url.search || url.hash) throw invalid(value, "is a file: URL with a query or fragment");
    return url.href;
  }
  if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(value)) throw invalid(value, "uses a URL scheme other than file:");
  if (value.startsWith(".") || value.includes("\\") || value.startsWith("//")) {
    throw invalid(value, "is a relative or malformed path");
  }
  if (!PACKAGE_NAME.test(value)) throw invalid(value, "is not a package name");
  return value;
}

/** Imports Playwright from SIGIL_PLAYWRIGHT_MODULE, or the installed package. */
export function importPlaywright(env = process.env) {
  return import(resolvePlaywrightSpecifier(env.SIGIL_PLAYWRIGHT_MODULE));
}
