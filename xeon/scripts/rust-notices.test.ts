import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type CrateLicenseFile,
  type LicenseFileReader,
  NO_LICENSE_FILE_CRATES,
  normalizeLicense,
  readCrateLicenseFiles,
  rustNotices,
  rustNoticesText,
} from "./rust-notices.ts";

const REGISTRY = "registry+https://github.com/rust-lang/crates.io-index";
const ROOT_ID = "path+file:///app/fresnel-desktop#fresnel-desktop@0.0.0";

type Kinds = readonly (string | null)[];
const NORMAL: Kinds = [null];
const DEV: Kinds = ["dev"];
const BUILD: Kinds = ["build"];
const DEV_AND_NORMAL: Kinds = ["dev", null];

function idOf(name: string, version: string, local: boolean): string {
  return local ? `path+file:///app/${name}#${name}@${version}` : `${REGISTRY}#${name}@${version}`;
}

/** A `cargo metadata` package entry. Registry crates live in /src/<name>-<version>, which the fake reader keys on. */
function pkg(
  name: string,
  version: string,
  options: {
    readonly license?: string | null;
    readonly repository?: string | null;
    readonly authors?: readonly string[];
    readonly local?: boolean;
  } = {},
): Record<string, unknown> {
  const local = options.local === true;
  return {
    id: idOf(name, version, local),
    name,
    version,
    manifest_path: local ? `/app/${name}/Cargo.toml` : `/src/${name}-${version}/Cargo.toml`,
    license: options.license === undefined ? "MIT" : options.license,
    repository: options.repository ?? null,
    authors: options.authors ?? [],
    source: local ? null : REGISTRY,
  };
}

/** A resolve node: its id and its dependency edges, each with the dependency kinds of the edge. */
function node(
  name: string,
  version: string,
  edges: readonly (readonly [
    { readonly name: string; readonly version: string; readonly local?: boolean },
    Kinds,
  ])[],
  local = false,
): Record<string, unknown> {
  return {
    id: idOf(name, version, local),
    deps: edges.map(([target, kinds]) => ({
      name: target.name,
      pkg: idOf(target.name, target.version, target.local === true),
      dep_kinds: kinds.map((kind) => ({ kind, target: null })),
    })),
  };
}

function metadata(
  packages: readonly Record<string, unknown>[],
  nodes: readonly Record<string, unknown>[],
): unknown {
  return { packages, resolve: { root: ROOT_ID, nodes } };
}

const failingReader: LicenseFileReader = () => ({ ok: false, error: "boom" });

/** Fake reader: the license files of each source directory, keyed by the crate directory (no disk). */
function readerOf(files: Record<string, readonly CrateLicenseFile[]>): LicenseFileReader {
  return (dir) => ({ ok: true, value: files[dir] ?? [] });
}

const root = pkg("fresnel-desktop", "0.0.0", { local: true, license: null });
const crateA = { name: "a", version: "1.0.0" };
const crateC = { name: "c", version: "1.0.0" };
const crateD = { name: "d", version: "1.0.0" };
const crateE = { name: "e", version: "1.0.0" };
const crateG = { name: "g", version: "1.0.0" };
const crateT = { name: "t", version: "1.0.0" };
const crateTk = { name: "tk", version: "1.0.0" };
const crateW = { name: "w", version: "0.1.0", local: true };
const crateX = { name: "x", version: "1.0.0" };

/**
 * The graph of the test: the root reaches a (normal), tk (normal and dev), t, the path package w and, through w, x. a reaches c
 * (normal) and g (build only). The root's dev dependency d reaches e, which is dev-only and must be dropped.
 */
function fixture(order: "forward" | "reversed"): unknown {
  const packages = [
    root,
    pkg("a", "1.0.0", {
      license: "MIT OR Apache-2.0",
      authors: ["Alice Example"],
      repository: "git+https://github.com/example/a.git",
    }),
    pkg("c", "1.0.0", { license: "MIT/Apache-2.0" }),
    pkg("d", "1.0.0", { license: "MIT" }),
    pkg("e", "1.0.0", { license: "MIT" }),
    pkg("g", "1.0.0", { license: "MIT" }),
    pkg("t", "1.0.0", { license: "BSD-3-Clause" }),
    pkg("tk", "1.0.0", { license: "Apache-2.0" }),
    pkg("w", "0.1.0", { local: true, license: "MIT" }),
    pkg("x", "1.0.0", { license: "MIT" }),
  ];
  const nodes = [
    node(
      "fresnel-desktop",
      "0.0.0",
      [
        [crateA, NORMAL],
        [crateTk, DEV_AND_NORMAL],
        [crateD, DEV],
        [crateT, NORMAL],
        [crateW, NORMAL],
      ],
      true,
    ),
    node("a", "1.0.0", [
      [crateC, NORMAL],
      [crateG, BUILD],
    ]),
    node("d", "1.0.0", [[crateE, NORMAL]]),
    node("w", "0.1.0", [[crateX, NORMAL]], true),
    node("c", "1.0.0", []),
    node("e", "1.0.0", []),
    node("g", "1.0.0", []),
    node("t", "1.0.0", []),
    node("tk", "1.0.0", []),
    node("x", "1.0.0", []),
  ];
  return order === "forward"
    ? metadata(packages, nodes)
    : metadata(packages.toReversed(), nodes.toReversed());
}

const files = {
  "/src/a-1.0.0": [
    { file: "LICENSE-MIT", body: "Copyright (c) 2020 Alice\n\nPermission is hereby granted." },
  ],
  "/src/c-1.0.0": [
    { file: "LICENSE-MIT", body: "Copyright (c) 2021 Carol\n\nPermission is hereby granted." },
  ],
  "/src/t-1.0.0": [{ file: "LICENSE", body: "Redistribution and use in source and binary forms." }],
  "/src/tk-1.0.0": [
    { file: "LICENSE", body: "Copyright 2019 Tom\n\nLicensed under the Apache License." },
  ],
  "/src/x-1.0.0": [{ file: "COPYING", body: "Permission is hereby granted." }],
};

test("rustNotices lists the normal dependencies reachable from fresnel-desktop and drops dev-only, build-only, the root and path packages", () => {
  const result = rustNotices(fixture("forward"), readerOf(files));
  expect(result.ok ? result.value.map((item) => `${item.name}@${item.version}`) : result).toEqual([
    "a@1.0.0",
    "c@1.0.0",
    "t@1.0.0",
    "tk@1.0.0",
    "x@1.0.0",
  ]);
});

test("a dual license keeps its expression as the section key, and a slash between identifiers reads as OR", () => {
  const result = rustNotices(fixture("forward"), readerOf(files));
  expect(result.ok ? result.value.map((item) => `${item.name}:${item.license}`) : result).toEqual([
    "a:MIT OR Apache-2.0",
    "c:MIT OR Apache-2.0",
    "t:BSD-3-Clause",
    "tk:Apache-2.0",
    "x:MIT",
  ]);
  if (!result.ok) return;
  expect(rustNoticesText(result.value)).toContain("License: MIT OR Apache-2.0 (2 packages)\n");
});

test("the notice text is the header, then the grouped notice with each license text once and each package's copyright and link", () => {
  const single = metadata(
    [
      root,
      pkg("a", "1.0.0", {
        license: "MIT",
        authors: ["Alice Example"],
        repository: "git+https://github.com/example/a.git",
      }),
    ],
    [node("fresnel-desktop", "0.0.0", [[crateA, NORMAL]], true), node("a", "1.0.0", [])],
  );
  const result = rustNotices(single, readerOf(files));
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  const rule = "=".repeat(78);
  expect(rustNoticesText(result.value)).toEqual(
    [
      "Third-party notices for the Rust crates of the Fresnel desktop shell (apps/desktop/src-tauri).",
      "The desktop app bundle carries this file. The JS and Bun notices are in the release archive (THIRD-PARTY-NOTICES.txt).",
      "Generated from Cargo.lock by xeon/scripts/rust-notices.ts (just desktop-notices). Do not edit by hand.",
      "",
      rule,
      "License: MIT (1 package)",
      "License text (SPDX): https://spdx.org/licenses/MIT.html",
      rule,
      "",
      "License text 1 of 1 (printed once; 1 package carries it; copyright lines are listed under each package):",
      "",
      "Permission is hereby granted.",
      "",
      "Packages with this text:",
      "",
      "a 1.0.0",
      "  Copyright (c) 2020 Alice",
      "  link: https://github.com/example/a",
      "",
    ].join("\n"),
  );
});

test("the output is the same whatever order cargo lists the packages and the graph nodes in", () => {
  const forward = rustNotices(fixture("forward"), readerOf(files));
  const reversed = rustNotices(fixture("reversed"), readerOf(files));
  expect(forward.ok && reversed.ok).toBe(true);
  if (!forward.ok || !reversed.ok) return;
  expect(rustNoticesText(reversed.value)).toEqual(rustNoticesText(forward.value));
});

test("a linked crate without a license file fails, and a crate on NO_LICENSE_FILE_CRATES prints its declared license, authors and repository", () => {
  const plain = metadata(
    [root, pkg("plain", "1.0.0")],
    [
      node("fresnel-desktop", "0.0.0", [[{ name: "plain", version: "1.0.0" }, NORMAL]], true),
      node("plain", "1.0.0", []),
    ],
  );
  expect(rustNotices(plain, readerOf({}))).toEqual({
    ok: false,
    error: [
      "plain@1.0.0: no license file in the crate package (check the upstream repository, then list the crate in NO_LICENSE_FILE_CRATES)",
    ],
  });

  expect(NO_LICENSE_FILE_CRATES.has("objc2")).toBe(true);
  const objc2 = metadata(
    [
      root,
      pkg("objc2", "0.6.5", {
        license: "MIT",
        authors: ["Mads Marquart"],
        repository: "https://github.com/madsmtm/objc2",
      }),
    ],
    [
      node("fresnel-desktop", "0.0.0", [[{ name: "objc2", version: "0.6.5" }, NORMAL]], true),
      node("objc2", "0.6.5", []),
    ],
  );
  const result = rustNotices(objc2, readerOf({}));
  expect(result).toEqual({
    ok: true,
    value: [
      {
        name: "objc2",
        version: "0.6.5",
        license: "MIT",
        link: "https://github.com/madsmtm/objc2",
        copyright: [],
        texts: [],
        notes: [
          "The crate ships no license file in its package. Declared license: MIT. Origin: Mads Marquart, https://github.com/madsmtm/objc2.",
        ],
      },
    ],
  });
});

test("a linked crate without a license field fails even when it is on NO_LICENSE_FILE_CRATES", () => {
  const noLicense = metadata(
    [root, pkg("objc2", "0.6.5", { license: null })],
    [
      node("fresnel-desktop", "0.0.0", [[{ name: "objc2", version: "0.6.5" }, NORMAL]], true),
      node("objc2", "0.6.5", []),
    ],
  );
  expect(rustNotices(noLicense, readerOf({}))).toEqual({
    ok: false,
    error: ["objc2@0.6.5: no license in Cargo.toml"],
  });
});

test("a reader failure is reported with the crate it belongs to", () => {
  const plain = metadata(
    [root, pkg("plain", "1.0.0")],
    [
      node("fresnel-desktop", "0.0.0", [[{ name: "plain", version: "1.0.0" }, NORMAL]], true),
      node("plain", "1.0.0", []),
    ],
  );
  expect(rustNotices(plain, failingReader)).toEqual({ ok: false, error: ["plain@1.0.0: boom"] });
});

test("metadata without the root package or without resolve.nodes is an error, not a crash", () => {
  expect(
    rustNotices({ packages: [], resolve: { root: ROOT_ID, nodes: [] } }, readerOf({})),
  ).toEqual({
    ok: false,
    error: ["cargo metadata has no workspace package fresnel-desktop"],
  });
  expect(rustNotices({}, readerOf({}))).toEqual({
    ok: false,
    error: ["cargo metadata has no packages or resolve.nodes"],
  });
});

test("normalizeLicense reads a slash between identifiers as OR and keeps SPDX expressions as they are", () => {
  expect(normalizeLicense("MIT/Apache-2.0")).toEqual("MIT OR Apache-2.0");
  expect(normalizeLicense("Apache-2.0 / MIT")).toEqual("Apache-2.0 OR MIT");
  expect(normalizeLicense("(Apache-2.0 OR MIT) AND BSD-3-Clause")).toEqual(
    "(Apache-2.0 OR MIT) AND BSD-3-Clause",
  );
  expect(normalizeLicense("Apache-2.0 WITH LLVM-exception OR Apache-2.0 OR MIT")).toEqual(
    "Apache-2.0 WITH LLVM-exception OR Apache-2.0 OR MIT",
  );
});

test("readCrateLicenseFiles reads the LICENSE, COPYING, NOTICE and UNLICENSE files of a directory and ignores the others", () => {
  const dir = mkdtempSync(join(tmpdir(), "rust-notices-"));
  try {
    writeFileSync(join(dir, "LICENSE-MIT"), "Permission is hereby granted.\r\n");
    writeFileSync(join(dir, "NOTICE"), "notice text");
    writeFileSync(join(dir, "UNLICENSE"), "This is free and unencumbered software.");
    writeFileSync(join(dir, "README.md"), "not a license");
    writeFileSync(join(dir, "lib.rs"), "fn main() {}");
    expect(readCrateLicenseFiles(dir)).toEqual({
      ok: true,
      value: [
        { file: "LICENSE-MIT", body: "Permission is hereby granted.\r\n" },
        { file: "NOTICE", body: "notice text" },
        { file: "UNLICENSE", body: "This is free and unencumbered software." },
      ],
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

/** The desktop shell's Rust tree: its Cargo.lock, and the notice file rust-notices.ts writes from it. */
const DESKTOP_DIR = join(import.meta.dir, "..", "apps", "desktop", "src-tauri");

const CESU8_TEXT =
  "The Rust Project is dual-licensed under Apache 2.0 and MIT\nterms.\n\nPermission is hereby granted.";

test("readCrateLicenseFiles reads COPYRIGHT-RUST.txt, the license file of cesu8, and ignores the README beside it", () => {
  const dir = mkdtempSync(join(tmpdir(), "rust-notices-cesu8-"));
  try {
    writeFileSync(join(dir, "COPYRIGHT-RUST.txt"), `${CESU8_TEXT}\n`);
    writeFileSync(join(dir, "README.md"), "# CESU-8\n\nLICENSE-RUST.txt is named here.\n");
    expect(readCrateLicenseFiles(dir)).toEqual({
      ok: true,
      value: [{ file: "COPYRIGHT-RUST.txt", body: `${CESU8_TEXT}\n` }],
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("cesu8 is listed under Apache-2.0 OR MIT with the text of its COPYRIGHT-RUST.txt, and fails without that file", () => {
  expect(NO_LICENSE_FILE_CRATES.has("cesu8")).toBe(false);
  const cesu8 = metadata(
    [
      root,
      pkg("cesu8", "1.1.0", {
        license: "Apache-2.0/MIT",
        repository: "https://github.com/emk/cesu8-rs",
      }),
    ],
    [
      node("fresnel-desktop", "0.0.0", [[{ name: "cesu8", version: "1.1.0" }, NORMAL]], true),
      node("cesu8", "1.1.0", []),
    ],
  );
  expect(
    rustNotices(
      cesu8,
      readerOf({ "/src/cesu8-1.1.0": [{ file: "COPYRIGHT-RUST.txt", body: CESU8_TEXT }] }),
    ),
  ).toEqual({
    ok: true,
    value: [
      {
        name: "cesu8",
        version: "1.1.0",
        license: "Apache-2.0 OR MIT",
        link: "https://github.com/emk/cesu8-rs",
        copyright: [],
        texts: [{ file: "COPYRIGHT-RUST.txt", body: CESU8_TEXT }],
        notes: [],
      },
    ],
  });
  expect(rustNotices(cesu8, readerOf({}))).toEqual({
    ok: false,
    error: [
      "cesu8@1.1.0: no license file in the crate package (check the upstream repository, then list the crate in NO_LICENSE_FILE_CRATES)",
    ],
  });
});

/** `name@version` of each registry package in a Cargo.lock text. The workspace's own packages have no `source` line. */
function registryCrates(lock: string): string[] {
  return lock
    .split("[[package]]\n")
    .slice(1)
    .flatMap((block) => {
      const name = /^name = "(.+)"$/m.exec(block)?.[1];
      const version = /^version = "(.+)"$/m.exec(block)?.[1];
      if (name === undefined || version === undefined || !/^source = "registry\+/m.test(block)) {
        return [];
      }
      return [`${name}@${version}`];
    });
}

/** `name@version` of each crate entry of a notice text: a name and a version alone on a line, as rust-notices.ts writes them. */
function noticeCrates(notice: string): string[] {
  return [...notice.matchAll(/^([A-Za-z0-9_.+-]+) ([0-9]\S*)$/gm)].flatMap((match) =>
    match[1] === undefined || match[2] === undefined ? [] : [`${match[1]}@${match[2]}`],
  );
}

/**
 * The registry crates of Cargo.lock that the notice does not list. Each is reached only through build or dev edges (build scripts
 * and the code generators behind them), so cargo metadata's normal-edge closure from fresnel-desktop leaves it out: the app does
 * not link it. A crate missing from the notice and from this list fails the test; regenerate the notice or classify the crate here.
 */
const BUILD_ONLY_CRATES = [
  "autocfg@1.5.1",
  "cargo_toml@1.0.1",
  "cc@1.10.0",
  "cfg-expr@0.15.8",
  "cfg_aliases@0.2.2",
  "embed-resource@3.0.12",
  "find-msvc-tools@0.1.15",
  "phf_codegen@0.13.1",
  "pkg-config@0.3.34",
  "rustc_version@0.4.1",
  "shlex@2.0.1",
  "static_vcruntime@3.0.0",
  "string_cache_codegen@0.6.1",
  "system-deps@6.2.2",
  "target-lexicon@0.12.16",
  "tauri-build@2.7.4",
  "tauri-plugin@2.7.2",
  "tauri-winres@0.3.7",
  "toml@0.8.2",
  "version-compare@0.2.1",
  "version_check@0.9.5",
  "vswhom-sys@0.1.3",
  "vswhom@0.1.0",
  "winreg@0.56.0",
];

test("every registry crate in apps/desktop/src-tauri/Cargo.lock has a notice, except the build-only crates the app does not link", () => {
  const locked = registryCrates(readFileSync(join(DESKTOP_DIR, "Cargo.lock"), "utf8"));
  const listed = noticeCrates(
    readFileSync(join(DESKTOP_DIR, "resources", "THIRD-PARTY-NOTICES-RUST.txt"), "utf8"),
  );
  expect(locked.length).toEqual(534);
  expect(listed.length).toEqual(510);
  expect(locked.filter((crate) => !listed.includes(crate)).toSorted()).toEqual(BUILD_ONLY_CRATES);
  expect(listed.filter((crate) => !locked.includes(crate))).toEqual([]);
});
