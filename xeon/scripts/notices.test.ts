import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  BUN_ITEM,
  collectNotices,
  groupedNoticesText,
  type NoticeItem,
  sourceLink,
  splitHeader,
} from "./notices.ts";
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
    {
      name: "a",
      version: "1.0.0",
      license: "MIT",
      repository: "git+https://github.com/example/a.git",
      dependencies: { b: "2.0.0" },
    },
    { LICENSE: "Copyright (c) 2020 Alice\n\nPermission is hereby granted.\n" },
  );
  pkg(
    root,
    "node_modules/b",
    {
      name: "b",
      version: "2.0.0",
      license: "(BSD-3-Clause OR GPL-2.0)",
      homepage: "https://example.test/b",
    },
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

test("collectNotices lists third-party production packages with links, copyright lines and license texts, and skips devDependencies", () => {
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
          link: "https://github.com/example/a",
          copyright: ["Copyright (c) 2020 Alice"],
          texts: [
            { file: "LICENSE", body: "Copyright (c) 2020 Alice\n\nPermission is hereby granted." },
          ],
          notes: [],
        },
        {
          name: "b",
          version: "2.0.0",
          license: "BSD-3-Clause",
          link: "https://example.test/b",
          copyright: [],
          texts: [
            { file: "LICENSE.md", body: "BSD text of b" },
            { file: "NOTICE", body: "notice of b" },
          ],
          notes: [],
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

test("collectNotices takes a vendored package's link from UPSTREAM.json and its license field from LICENSE_FIELD", () => {
  const root = mkdtempSync(join(tmpdir(), "notices-vendor-"));
  try {
    pkg(root, "apps/host", {
      name: "@fresnel/host",
      version: "0.0.0",
      dependencies: { "@fresnel/vendor-cordis": "4.0.0" },
    });
    pkg(
      root,
      "vendor/cordis",
      { name: "@fresnel/vendor-cordis", version: "4.0.0", private: true },
      {
        LICENSE: "Copyright (c) 2021 Vendor\n\nPermission is hereby granted.",
        "UPSTREAM.json": JSON.stringify({
          upstream: "https://github.com/example/cordis",
          license: "MIT",
        }),
      },
    );
    mkdirSync(join(root, "node_modules/@fresnel"), { recursive: true });
    symlinkSync(join(root, "vendor/cordis"), join(root, "node_modules/@fresnel/vendor-cordis"));
    const result = collectNotices(root, ["apps/host"]);
    expect(result).toEqual({
      ok: true,
      value: [
        {
          name: "@fresnel/vendor-cordis",
          version: "4.0.0",
          license: "MIT",
          link: "https://github.com/example/cordis",
          copyright: ["Copyright (c) 2021 Vendor"],
          texts: [
            { file: "LICENSE", body: "Copyright (c) 2021 Vendor\n\nPermission is hereby granted." },
          ],
          notes: [],
        },
      ],
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("collectNotices fails for a vendored package whose UPSTREAM.json cannot be read", () => {
  const root = mkdtempSync(join(tmpdir(), "notices-upstream-"));
  try {
    pkg(root, "apps/host", {
      name: "@fresnel/host",
      version: "0.0.0",
      dependencies: { "@fresnel/vendor-cordis": "4.0.0" },
    });
    pkg(
      root,
      "vendor/cordis",
      { name: "@fresnel/vendor-cordis", version: "4.0.0", private: true },
      {
        LICENSE: "Copyright (c) 2021 Vendor\n\nPermission is hereby granted.",
        "UPSTREAM.json": "{ not json",
      },
    );
    mkdirSync(join(root, "node_modules/@fresnel"), { recursive: true });
    symlinkSync(join(root, "vendor/cordis"), join(root, "node_modules/@fresnel/vendor-cordis"));
    const result = collectNotices(root, ["apps/host"]);
    expect(result.ok).toEqual(false);
    const text = result.ok ? "" : result.error.join("\n");
    expect(text).toContain("@fresnel/vendor-cordis@4.0.0: ");
    expect(text).toContain("UPSTREAM.json");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("sourceLink reads the repository forms npm accepts as https links and refuses the rest", () => {
  expect(sourceLink("git+https://github.com/example/a.git")).toEqual(
    "https://github.com/example/a",
  );
  expect(sourceLink("git://github.com/TooTallNate/x.git")).toEqual(
    "https://github.com/TooTallNate/x",
  );
  expect(sourceLink("git@github.com:sidorares/json-bigint.git")).toEqual(
    "https://github.com/sidorares/json-bigint",
  );
  expect(sourceLink("sindresorhus/p-retry")).toEqual("https://github.com/sindresorhus/p-retry");
  expect(sourceLink("github:vercel/ms")).toEqual("https://github.com/vercel/ms");
  expect(sourceLink("https://example.test/home/")).toEqual("https://example.test/home");
  expect(sourceLink("git+ssh://git@github.com/x/y.git")).toBeUndefined();
  expect(sourceLink("")).toBeUndefined();
});

test("splitHeader reads copyright lines from the header of a license file, not from the license text", () => {
  // A title line stays in the text; the copyright line under it is still read.
  expect(
    splitHeader(
      "The MIT License (MIT)\n=====\n\nCopyright © 2025 Michael\n\nPermission is hereby granted.",
    ),
  ).toEqual({
    copyright: ["Copyright © 2025 Michael"],
    rest: "The MIT License (MIT)\n=====\n\nPermission is hereby granted.",
  });
  // An introduction before the copyright line does not hide it.
  expect(
    splitHeader(
      "This license applies to all parts.\n\nCopyright (c) 2016, Daniel Wirtz\n\nRedistribution and use",
    ).copyright,
  ).toEqual(["Copyright (c) 2016, Daniel Wirtz"]);
  // The GPL copyright line after the BSD text is not the package's.
  expect(
    splitHeader("Redistribution and use\n\nCopyright (C) 1989, 1991 Free Software Foundation, Inc.")
      .copyright,
  ).toEqual([]);
  // A template line is not a copyright line.
  expect(
    splitHeader("Copyright [yyyy] [name of copyright owner]\n\nPermission is hereby granted.")
      .copyright,
  ).toEqual([]);
});

test("groupedNoticesText prints each distinct license text once, with the packages that carry it under it, then the packages without a license file", () => {
  const mitA: NoticeItem = {
    name: "a",
    version: "1.0.0",
    license: "MIT",
    link: "https://example.test/a",
    copyright: ["Copyright (c) 2020 Alice"],
    texts: [
      {
        file: "LICENSE",
        body: "Copyright (c) 2020 Alice\n\nMIT License\n\nPermission is hereby granted.",
      },
    ],
    notes: [],
  };
  // Same license text as a, with another copyright line and a title that differs: shares a's printed text.
  const mitB: NoticeItem = {
    name: "b",
    version: "2.0.0",
    license: "MIT",
    link: "https://example.test/b",
    copyright: ["Copyright (c) 2021 Bob"],
    texts: [
      {
        file: "LICENSE",
        body: "The MIT License (MIT)\n\nCopyright (c) 2021 Bob\n\nPermission is hereby granted.",
      },
    ],
    notes: [],
  };
  // Adds a clause a's text does not have: its own text is printed once, under its own group.
  const mitC: NoticeItem = {
    name: "c",
    version: "3.0.0",
    license: "MIT",
    link: undefined,
    copyright: [],
    texts: [
      {
        file: "LICENSE",
        body: "MIT License\n\nPermission is hereby granted.\n\nThe extra clause applies to c only.",
      },
    ],
    notes: [],
  };
  const mitZ: NoticeItem = {
    name: "z",
    version: "0.1.0",
    license: "MIT",
    link: "https://example.test/z",
    copyright: [],
    texts: [],
    notes: [
      "The package ships no license file. Declared license: MIT. Origin: Z Author, https://example.test/z.",
    ],
  };
  const age: NoticeItem = {
    name: "age",
    version: "1.3.2",
    license: "BSD-3-Clause",
    link: "https://github.com/FiloSottile/age",
    copyright: [],
    texts: [],
    notes: ["The archive does not ship this program's license file; see the source link."],
  };
  const rule = "=".repeat(78);
  expect(groupedNoticesText([mitC, age, mitZ, mitB, mitA])).toEqual(
    [
      rule,
      "License: BSD-3-Clause (1 package)",
      "License text (SPDX): https://spdx.org/licenses/BSD-3-Clause.html",
      rule,
      "",
      "The archive ships no license text for this license. The license text link above has it.",
      "",
      "Packages:",
      "",
      "age 1.3.2",
      "  link: https://github.com/FiloSottile/age",
      "  The archive does not ship this program's license file; see the source link.",
      "",
      rule,
      "License: MIT (4 packages)",
      "License text (SPDX): https://spdx.org/licenses/MIT.html",
      rule,
      "",
      "License text 1 of 2 (printed once; 2 packages carry it; copyright lines are listed under each package):",
      "",
      "MIT License",
      "",
      "Permission is hereby granted.",
      "",
      "Packages with this text:",
      "",
      "a 1.0.0",
      "  Copyright (c) 2020 Alice",
      "  link: https://example.test/a",
      "",
      "b 2.0.0",
      "  Copyright (c) 2021 Bob",
      "  link: https://example.test/b",
      "",
      "License text 2 of 2 (printed once; 1 package carries it; copyright lines are listed under each package):",
      "",
      "MIT License",
      "",
      "Permission is hereby granted.",
      "",
      "The extra clause applies to c only.",
      "",
      "Packages with this text:",
      "",
      "c 3.0.0",
      "  link: not stated in package.json",
      "",
      "Packages without license text:",
      "",
      "z 0.1.0",
      "  link: https://example.test/z",
      "  The package ships no license file. Declared license: MIT. Origin: Z Author, https://example.test/z.",
      "",
    ].join("\n"),
  );
});

/** An MIT package whose license text is the same as every other one's, with its own copyright holder. */
function sharingMit(name: string, holder: string): NoticeItem {
  return {
    name,
    version: "1.0.0",
    license: "MIT",
    link: `https://example.test/${name}`,
    copyright: [`Copyright (c) 2020 ${holder}`],
    texts: [
      { file: "LICENSE", body: `Copyright (c) 2020 ${holder}\n\nPermission is hereby granted.` },
    ],
    notes: [],
  };
}

test("groupedNoticesText writes an identical license text once, however many packages carry it, and lists each of them", () => {
  const text = groupedNoticesText([
    sharingMit("x", "Xe"),
    sharingMit("y", "Yo"),
    sharingMit("w", "Wu"),
  ]);
  expect(text.split("Permission is hereby granted.").length - 1).toEqual(1);
  expect(text.split("\n").filter((line) => line.startsWith("License text "))).toEqual([
    "License text (SPDX): https://spdx.org/licenses/MIT.html",
    "License text 1 of 1 (printed once; 3 packages carry it; copyright lines are listed under each package):",
  ]);
  expect(text.split("\n").filter((line) => /^[a-z]+ 1\.0\.0$/.test(line))).toEqual([
    "w 1.0.0",
    "x 1.0.0",
    "y 1.0.0",
  ]);
});

test("groupedNoticesText is empty when there is nothing to list", () => {
  expect(groupedNoticesText([])).toEqual("");
});

test("the Bun runtime is an MIT item with its copyright line and the note about its embedded parts", () => {
  expect(BUN_ITEM.license).toEqual("MIT");
  expect(BUN_ITEM.link).toEqual("https://github.com/oven-sh/bun");
  expect(BUN_ITEM.copyright).toEqual(["Copyright (c) Oven, the Bun authors"]);
  const body = noticesBody("1.0.0", "aarch64-apple-darwin", [], [], [BUN_ITEM]);
  expect(body).toContain("License: MIT (1 package)");
  expect(body).toContain(
    `Bun runtime ${Bun.version}\n  Copyright (c) Oven, the Bun authors\n  link: https://github.com/oven-sh/bun\n`,
  );
  expect(body).toContain("LGPL-2.0 and BSD-2-Clause parts");
});
