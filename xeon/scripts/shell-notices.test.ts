import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { SHELL_NOTICE_FILE, shellNotices, shellNoticesText } from "./shell-notices.ts";

const xeon = resolve(import.meta.dir, "..");

test("the committed shell notice equals what the dependencies produce", () => {
  const built = shellNotices(xeon);
  if (!built.ok) throw new Error(built.error.join("; "));
  expect(readFileSync(join(xeon, SHELL_NOTICE_FILE), "utf8")).toBe(built.value.text);
});

test("the notice names electron-updater and its dependency lazy-val under MIT", () => {
  const built = shellNotices(xeon);
  if (!built.ok) throw new Error(built.error.join("; "));
  expect(built.value.text).toContain("electron-updater 6.");
  expect(built.value.text).toContain("lazy-val 1.0.5");
  expect(built.value.text).toContain("License: MIT");
});

test("the text starts with the header that points to the Electron and Chromium files", () => {
  const text = shellNoticesText([]);
  expect(text.startsWith("Fresnel desktop shell (Electron) third-party notices")).toBe(true);
  expect(text).toContain("LICENSES.chromium.html");
});

test("the notice lists mac-security under MIT but not the build tools it only needs at install time", () => {
  const built = shellNotices(xeon);
  if (!built.ok) throw new Error(built.error.join("; "));
  expect(built.value.text).toContain("mac-security 0.1.0");
  expect(built.value.text).not.toContain("node-gyp");
  expect(built.value.text).not.toContain("node-addon-api");
});
