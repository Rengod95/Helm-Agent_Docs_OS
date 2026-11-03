import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BUN_NOTICE, collectNotices, noticesText } from "./notices.ts";
import { noticesBody } from "./release.ts";

function write(path: string, body: string): void {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, body);
}

function pkg(
  root: string,
  rel: string,
  json: Record<string, unknown>,
  files: Record<string, string> = {},
): void {
  write(join(root, rel, "package.json"), JSON.stringify(json));
  for (const [name, body] of Object.entries(files)) write(join(root, rel, name), body);
}

/** apps/host (first-party) -> a -> b, plus devDependency d that must not be listed. */
function fixture(): string {
  const root = mkdtempSync(join(tmpdir(), "notices-"));
  pkg(root, "apps/host", {
    name: "@fresnel/host",
    version: "0.0.0",
    dependencies: { a: "1.0.0" },
    devDependencies: { d: "1.0.0" },
  });
  pkg(
    root,
    "apps/host/node_modules/a",
    { name: "a", version: "1.0.0", license: "MIT", dependencies: { b: "2.0.0" } },
    {
      LICENSE: "MIT text of a\n",
    },
  );
  pkg(
    root,
    "node_modules/b",
    { name: "b", version: "2.0.0", license: "(BSD-3-Clause OR GPL-2.0)" },
    {
      "LICENSE.md": "BSD text of b",
      NOTICE: "notice of b",
    },
  );
  pkg(
    root,
    "node_modules/d",
    { name: "d", version: "1.0.0", license: "MIT" },
    { LICENSE: "dev only" },
  );
  return root;
}

test("collectNotices lists third-party production packages with their license texts and skips devDependencies", () => {
  const root = fixture();
  try {
    const result = collectNotices(root, ["apps/host"], { choice: { b: "BSD-3-Clause" } });
    expect(result).toEqual({
      ok: true,
      value: [
        {
          name: "a",
          version: "1.0.0",
          license: "MIT",
          texts: [{ file: "LICENSE", body: "MIT text of a" }],
          origin: undefined,
        },
        {
          name: "b",
          version: "2.0.0",
          license: "BSD-3-Clause",
          texts: [
            { file: "LICENSE.md", body: "BSD text of b" },
            { file: "NOTICE", body: "notice of b" },
          ],
          origin: undefined,
        },
      ],
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("collectNotices fails for a package without a license file or field and for an unresolvable dependency", () => {
  const root = fixture();
  try {
    pkg(root, "node_modules/b", { name: "b", version: "2.0.0", dependencies: { gone: "1.0.0" } });
    rmSync(join(root, "node_modules/b/LICENSE.md"));
    rmSync(join(root, "node_modules/b/NOTICE"));
    const result = collectNotices(root, ["apps/host"]);
    expect(result).toEqual({
      ok: false,
      error: [
        `b: cannot resolve gone from ${realpathSync(join(root, "node_modules/b"))}`,
        "b@2.0.0: no license field",
        "b@2.0.0: no license file in node_modules/b",
      ],
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("collectNotices follows symlinked installs and walks first-party packages without listing them", () => {
  const root = fixture();
  try {
    pkg(
      root,
      "store/c/node_modules/c",
      { name: "c", version: "3.0.0", license: "ISC" },
      { COPYING: "ISC text" },
    );
    mkdirSync(join(root, "apps/host/node_modules"), { recursive: true });
    symlinkSync(join(root, "store/c/node_modules/c"), join(root, "apps/host/node_modules/c"));
    pkg(root, "apps/host", {
      name: "@fresnel/host",
      version: "0.0.0",
      dependencies: { a: "1.0.0", c: "3.0.0" },
    });
    const result = collectNotices(root, ["apps/host"]);
    expect(
      result.ok ? result.value.map((e) => `${e.name}@${e.version}:${e.license}`) : result,
    ).toEqual(["a@1.0.0:MIT", "b@2.0.0:(BSD-3-Clause OR GPL-2.0)", "c@3.0.0:ISC"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("noticesText starts with the Bun runtime block and prints each package with its text", () => {
  const text = noticesText([
    {
      name: "a",
      version: "1.0.0",
      license: "MIT",
      texts: [{ file: "LICENSE", body: "MIT text of a" }],
      origin: undefined,
    },
    {
      name: "z",
      version: "0.1.0",
      license: "MIT",
      texts: [],
      origin: "Z Author, https://example.test/z",
    },
  ]);
  expect(text.startsWith(BUN_NOTICE)).toEqual(true);
  expect(text).toContain("npm packages bundled into the binary (2)");
  expect(text).toContain("a 1.0.0\nlicense: MIT\n");
  expect(text).toContain("[LICENSE]\nMIT text of a\n");
  expect(text).toContain(
    "The package ships no license file. Declared license: MIT. Origin: Z Author, https://example.test/z.",
  );
});

test("noticesBody appends the npm notices after the binary block", () => {
  const body = noticesBody("1.0.0", "aarch64-apple-darwin", [], [], "NPM BLOCK\n");
  expect(body.endsWith("The full license texts are in the sources above.\n\nNPM BLOCK\n")).toEqual(
    true,
  );
});
