import { afterAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { locateGroupTemplates } from "../src/group/fs-port.ts";

// Template location for `xeon group new` (L4.cli.spec §3.8, B5-REL §3.2): the env override first, then the release resource
// directory (`<resourceDir>/group-kit/templates`, the compiled binary has no source checkout), then the source checkout
// (walk up from `from`). The end-to-end run of the compiled binary is X11 (scripts/release-smoke.test.ts).

const root = mkdtempSync(join(tmpdir(), "xeon-locate-"));
afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

/** A folder under the test root. */
function dirAt(...parts: string[]): string {
  const dir = join(root, ...parts);
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** A templates folder with its index.json, at `<dir>/<rel...>`. */
function templatesAt(dir: string, ...rel: string[]): string {
  const folder = join(dir, ...rel);
  mkdirSync(folder, { recursive: true });
  writeFileSync(join(folder, "index.json"), "{}");
  return folder;
}

test("XEON_GROUP_TEMPLATES_DIR wins over both the resource directory and the source checkout", () => {
  const resource = dirAt("env-wins", "resource");
  templatesAt(resource, "group-kit", "templates");
  const source = dirAt("env-wins", "source");
  templatesAt(source, "packages", "group-kit", "templates");
  expect(
    locateGroupTemplates({ XEON_GROUP_TEMPLATES_DIR: "/custom/templates" }, source, resource),
  ).toEqual("/custom/templates");
});

test("an empty XEON_GROUP_TEMPLATES_DIR is no override and the resource directory is used", () => {
  const resource = dirAt("empty-env", "resource");
  const bundled = templatesAt(resource, "group-kit", "templates");
  const source = dirAt("empty-env", "source");
  templatesAt(source, "packages", "group-kit", "templates");
  expect(locateGroupTemplates({ XEON_GROUP_TEMPLATES_DIR: "" }, source, resource)).toEqual(bundled);
});

test("a resource directory with group-kit/templates/index.json is found with no env override", () => {
  const resource = dirAt("resource-only", "resource");
  const bundled = templatesAt(resource, "group-kit", "templates");
  const elsewhere = dirAt("resource-only", "elsewhere", "deeper");
  expect(locateGroupTemplates({}, elsewhere, resource)).toEqual(bundled);
});

test("a resource directory without index.json falls through to the source checkout", () => {
  const source = dirAt("fall-through", "source");
  const checkout = templatesAt(source, "packages", "group-kit", "templates");
  const bare = dirAt("fall-through", "bare-resource");
  const halfway = dirAt("fall-through", "halfway-resource");
  mkdirSync(join(halfway, "group-kit", "templates"), { recursive: true });
  expect([bare, halfway].map((resource) => locateGroupTemplates({}, source, resource))).toEqual([
    checkout,
    checkout,
  ]);
});

test("the source checkout is found by walking up from `from` when no resource directory is given", () => {
  const source = dirAt("walk-up", "source");
  const checkout = templatesAt(source, "packages", "group-kit", "templates");
  expect(locateGroupTemplates({}, join(source, "apps", "cli", "src"))).toEqual(checkout);
});

test("nothing found returns null", () => {
  const lonely = dirAt("nothing", "lonely");
  const resource = dirAt("nothing", "resource");
  expect([locateGroupTemplates({}, lonely), locateGroupTemplates({}, lonely, resource)]).toEqual([
    null,
    null,
  ]);
});
