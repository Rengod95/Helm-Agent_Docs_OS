import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { checkLayers, expectedLayer, extractSpecifiers } from "./check-layers.ts";

let root = "";
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "xeon-layers-"));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function pkg(
  dir: string,
  layer: string,
  deps: string[] = [],
  files: Record<string, string> = {},
): void {
  const name = `@xeon/${dir.split("/")[1]}`;
  const dependencies = Object.fromEntries(deps.map((d) => [d, "workspace:*"]));
  mkdirSync(join(root, dir, "src"), { recursive: true });
  writeFileSync(
    join(root, dir, "package.json"),
    JSON.stringify({ name, xeon: { layer, domain: "x" }, dependencies }),
  );
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, dir, file)), { recursive: true });
    writeFileSync(join(root, dir, file), text);
  }
}

function rules(): string[] {
  return checkLayers(root).violations.map((v) => v.rule);
}

test("expectedLayer maps directories to layers", () => {
  expect(expectedLayer("packages/contracts")).toBe("F");
  expect(expectedLayer("packages/ext-host")).toBe("X");
  expect(expectedLayer("packages/platform-store")).toBe("L0");
  expect(expectedLayer("packages/core-loop")).toBe("L1");
  expect(expectedLayer("packages/cap-web")).toBe("L2");
  expect(expectedLayer("packages/group-helm")).toBe("L3");
  expect(expectedLayer("plugins/provider-anthropic-oauth")).toBe("L1");
  expect(expectedLayer("apps/cli")).toBe("L4");
  expect(expectedLayer("vendor/cordis")).toBe("vendor");
});

test("extractSpecifiers finds static, dynamic, type and re-export imports, ignoring comments", () => {
  const text = [
    'import { a } from "@xeon/one";',
    "import type { B } from '@xeon/two/sub';",
    'import "@xeon/three";',
    'export * from "./local.ts";',
    'const c = await import("@xeon/four");',
    'import {\n  x,\n  y,\n} from "@xeon/five";',
    '// import z from "@xeon/commented";',
    '/* import q from "@xeon/blocked"; */',
  ].join("\n");
  expect(extractSpecifiers(text).toSorted()).toEqual([
    "./local.ts",
    "@xeon/five",
    "@xeon/four",
    "@xeon/one",
    "@xeon/three",
    "@xeon/two/sub",
  ]);
  expect(extractSpecifiers(text)).not.toContain("@xeon/commented");
  expect(extractSpecifiers(text)).not.toContain("@xeon/blocked");
});

test("downward dependencies pass", () => {
  pkg("packages/contracts", "F");
  pkg("packages/core-loop", "L1", ["@xeon/contracts"], { "src/a.ts": 'import "@xeon/contracts";' });
  pkg("apps/cli", "L4", ["@xeon/core-loop"], { "src/a.ts": 'import "@xeon/core-loop";' });
  expect(rules()).toEqual([]);
});

test("upward package.json dependency fails", () => {
  pkg("packages/core-loop", "L1", ["@xeon/cap-web"]);
  pkg("packages/cap-web", "L2");
  expect(rules()).toEqual(["upward-dependency"]);
});

test("upward source import fails and is reported as undeclared when not in package.json", () => {
  pkg("packages/core-loop", "L1", [], { "src/a.ts": 'import "@xeon/cap-web";' });
  pkg("packages/cap-web", "L2");
  expect(rules().toSorted()).toEqual(["undeclared-dependency", "upward-dependency"]);
});

test("same-layer import fails", () => {
  pkg("packages/core-loop", "L1", ["@xeon/core-tools"], {
    "src/a.ts": 'import "@xeon/core-tools";',
  });
  pkg("packages/core-tools", "L1");
  expect(rules()).toEqual(["same-layer-dependency"]);
});

test("plugins count as L1: importing core-* fails, importing platform-* passes", () => {
  pkg("packages/core-models", "L1");
  pkg("packages/platform-secrets", "L0");
  pkg("plugins/provider-x", "L1", ["@xeon/core-models", "@xeon/platform-secrets"]);
  expect(rules()).toEqual(["same-layer-dependency"]);
});

test("layer must match directory", () => {
  pkg("packages/cap-web", "L1");
  expect(rules()).toEqual(["layer-location"]);
});

test("missing or invalid layer fails", () => {
  pkg("packages/cap-web", "L9");
  expect(rules()).toEqual(["layer-invalid"]);
});

test("vendor is excluded in both directions", () => {
  pkg("vendor/cordis", "vendor");
  pkg("packages/ext-host", "X", ["@xeon/cordis"], { "src/a.ts": 'import "@xeon/cordis";' });
  expect(rules()).toEqual([]);
});

test("relative import out of the package fails", () => {
  pkg("packages/core-loop", "L1", [], { "src/a.ts": 'import "../../cap-web/src/index.ts";' });
  pkg("packages/cap-web", "L2");
  expect(rules()).toContain("relative-escape");
});

test("test files are scanned too", () => {
  pkg("packages/contracts", "F", [], { "test/a.test.ts": 'import "@xeon/core-loop";' });
  pkg("packages/core-loop", "L1");
  expect(rules()).toContain("upward-dependency");
});

test("import of an unknown @xeon package fails", () => {
  pkg("packages/core-loop", "L1", [], { "src/a.ts": 'import "@xeon/ghost";' });
  expect(rules()).toEqual(["unknown-package"]);
});
