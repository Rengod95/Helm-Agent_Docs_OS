import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  ALLOWED_LICENSES,
  disallowed,
  missingFromText,
  packageDirOf,
  packageDirs,
  readModuleIds,
  uiNotices,
} from "./ui-notices.ts";

const xeon = resolve(import.meta.dir, "..");

test("a module id maps to its package directory, scoped and bun-layout paths included", () => {
  expect(packageDirOf("/x/node_modules/react/index.js")).toBe("/x/node_modules/react");
  expect(packageDirOf("/x/node_modules/@scope/pkg/dist/a.js")).toBe("/x/node_modules/@scope/pkg");
  expect(
    packageDirOf("/x/node_modules/.bun/a@1+h/node_modules/a/lib/b.js?commonjs-es-import"),
  ).toBe("/x/node_modules/.bun/a@1+h/node_modules/a");
  expect(packageDirOf("\0/x/node_modules/a/b.js")).toBe("/x/node_modules/a");
  expect(packageDirOf("/x/apps/desktop/src/main.tsx")).toBeUndefined();
  expect(packageDirOf("\0vite/preload-helper.js")).toBeUndefined();
});

test("package directories are distinct and sorted", () => {
  expect(
    packageDirs([
      "/n/node_modules/b/x.js",
      "/n/node_modules/a/y.js",
      "/n/node_modules/b/z.js",
      "/src/a.ts",
    ]),
  ).toEqual(["/n/node_modules/a", "/n/node_modules/b"]);
});

const item = (name: string, license: string) => ({
  name,
  version: "1.0.0",
  license,
  link: undefined,
  copyright: [],
  texts: [],
  notes: [],
});

test("a license outside the allowed list is reported by name, an allowed one is not", () => {
  expect(disallowed([item("a", "MIT"), item("b", "GPL-3.0-only")])).toEqual([
    "b@1.0.0: license GPL-3.0-only is not in the allowed list",
  ]);
  expect(ALLOWED_LICENSES.has("MIT")).toBe(true);
  expect(ALLOWED_LICENSES.has("GPL-3.0-only")).toBe(false);
});

test("a package missing from the notice text is found", () => {
  const text = "x\nreact 19.0.0\n  link: y\n";
  expect(
    missingFromText(
      [
        { ...item("react", "MIT"), version: "19.0.0" },
        { ...item("motion", "MIT"), version: "12.0.0" },
      ],
      text,
    ),
  ).toEqual(["motion@12.0.0"]);
});

test("a package with a license outside the allowed list fails the notice and writes nothing to list it", () => {
  const root = mkdtempSync(join(tmpdir(), "ui-notices-"));
  try {
    const dir = join(root, "node_modules", "copyleft");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({ name: "copyleft", version: "2.0.0", license: "GPL-3.0-only" }),
    );
    writeFileSync(join(dir, "LICENSE"), "GNU GENERAL PUBLIC LICENSE\n");
    const built = uiNotices(root, [join(dir, "index.js")]);
    expect(built).toEqual({
      ok: false,
      error: ["copyleft@2.0.0: license GPL-3.0-only is not in the allowed list"],
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the screen bundle's real module list yields a notice that lists every bundled package", () => {
  const out = mkdtempSync(join(tmpdir(), "ui-build-"));
  try {
    const build = Bun.spawnSync(
      [
        process.execPath,
        "run",
        "--cwd",
        join(xeon, "apps", "desktop"),
        "vite",
        "build",
        "--outDir",
        join(out, "ui"),
      ],
      { stdout: "pipe", stderr: "pipe" },
    );
    expect(build.exitCode).toBe(0);
    const ids = readModuleIds(join(out, "ui-modules.json"));
    if (!ids.ok) throw new Error(ids.error);
    const built = uiNotices(xeon, ids.value);
    if (!built.ok) throw new Error(built.error.join("; "));
    const names = built.value.items.map((entry) => entry.name);
    // what apps/desktop imports directly ends up in the bundle, so each must be in the notice
    for (const name of [
      "react",
      "react-dom",
      "motion",
      "shiki",
      "zustand",
      "react-markdown",
      "remark-gfm",
    ]) {
      expect(names).toContain(name);
    }
    // a package that is only a build tool is not
    expect(names).not.toContain("vite");
    expect(names).not.toContain("electron");
    // every bundled package is listed, with its version
    expect(missingFromText(built.value.items, built.value.text)).toEqual([]);
    // dropping one package from the text is caught
    const react = built.value.items.find((entry) => entry.name === "react");
    expect(react).toBeDefined();
    const without = built.value.text.replace(`react ${react?.version ?? ""}\n`, "");
    expect(missingFromText(built.value.items, without)).toEqual([`react@${react?.version ?? ""}`]);
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
}, 120_000);
