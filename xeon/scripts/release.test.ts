import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  archiveName,
  describeError,
  exitCodeOf,
  isSafeVersion,
  lockBody,
  noticesBody,
  parseBundleConfig,
  devSidecarDir,
  releaseSidecarDir,
  sidecarCommand,
  sumsBody,
  type ReleaseError,
} from "./release.ts";
import { parseArchiveName, parseSums, requiredPaths } from "./release-smoke.ts";

// B5-REL (L4.release.spec §3, §6). The release pieces that do not spawn a build: config parsing, the lock, SHA256SUMS,
// the notices, the archive name and the smoke's layout checks. The end-to-end run is X11 (release-smoke.test.ts).

const REPO = join(import.meta.dir, "..", "..");
const BUNDLE_TEXT = readFileSync(join(import.meta.dir, "release-bundle.json"), "utf8");
const MAC = "aarch64-apple-darwin";
const LINUX = "x86_64-unknown-linux-gnu";

/** Replaces one fragment of the committed bundle text. Fails loudly when the fragment is not there, so a mutation never no-ops. */
function mutate(from: string, to: string): string {
  const mutated = BUNDLE_TEXT.replace(from, to);
  if (mutated === BUNDLE_TEXT) throw new Error(`mutation target not found: ${from}`);
  return mutated;
}

function kindOf(text: string): string {
  const result = parseBundleConfig(text);
  return result.ok ? "ok" : result.error.kind;
}

test("the committed release-bundle.json parses into the bundle the release builds", () => {
  const result = parseBundleConfig(BUNDLE_TEXT);
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.value).toEqual({
    templates: "packages/group-kit/templates",
    defaultPlugins: [
      { name: "helm", buildScript: "packages/group-helm/scripts/build-plugin.ts" },
      {
        name: "account-rotation",
        buildScript: "packages/group-account-rotation/scripts/build-plugin.ts",
      },
    ],
    bundledBinaries: {
      [MAC]: {
        platform: "darwin",
        arch: "arm64",
        binaries: [
          {
            name: "sops",
            version: "3.13.3",
            license: "MPL-2.0",
            source: "https://github.com/getsops/sops",
          },
          {
            name: "age",
            version: "1.3.2",
            license: "BSD-3-Clause",
            source: "https://github.com/FiloSottile/age",
          },
          {
            name: "rg",
            version: "15.0.0",
            license: "Unlicense OR MIT",
            source: "https://github.com/BurntSushi/ripgrep",
          },
        ],
      },
    },
    systemRequired: { linux: ["rg", "bwrap", "socat"] },
  });
});

test("every path the bundle config names exists in the repository", () => {
  const result = parseBundleConfig(BUNDLE_TEXT);
  if (!result.ok) throw new Error("the committed config does not parse");
  const paths = [
    result.value.templates,
    ...result.value.defaultPlugins.map((plugin) => plugin.buildScript),
  ];
  expect(paths.map((path) => existsSync(join(REPO, "xeon", path)))).toEqual([true, true, true]);
});

test("a bundle config with a bad value, an extra key or a missing field is config.invalid", () => {
  const mutations: readonly (readonly [string, string, string])[] = [
    ["http source", '"https://github.com/getsops/sops"', '"http://github.com/getsops/sops"'],
    ["uppercase binary name", '"name": "sops"', '"name": "Sops"'],
    ["empty license", '"license": "BSD-3-Clause"', '"license": ""'],
    ["unknown key", '"systemRequired": {', '"extra": 1,\n  "systemRequired": {'],
    ["missing templates", '"templates": "packages/group-kit/templates",', ""],
    ["number platform", '"platform": "darwin"', '"platform": 7'],
    ["empty plugin name", '"name": "helm"', '"name": ""'],
  ];
  const kinds = mutations.map(([label, from, to]) => [label, kindOf(mutate(from, to))]);
  expect(kinds).toEqual(mutations.map(([label]) => [label, "config.invalid"]));

  const cut = parseBundleConfig(BUNDLE_TEXT.slice(0, 60));
  expect(cut.ok ? "" : cut.error).toEqual({ kind: "config.invalid", message: expect.any(String) });
  const schema = parseBundleConfig(mutate('"name": "sops"', '"name": "Sops"'));
  expect(schema.ok ? "" : schema.error).toEqual({
    kind: "config.invalid",
    message: "release-bundle.json does not match its schema",
  });
  expect(kindOf(BUNDLE_TEXT)).toEqual("ok");
});

test("lockBody lists the entries sorted by name with the exact shape and a trailing newline", () => {
  const sops = "a".repeat(64);
  const age = "b".repeat(64);
  const rg = "c".repeat(64);
  const body = lockBody([
    {
      binary: { name: "sops", version: "3.13.3", license: "MPL-2.0", source: "https://x" },
      platform: "darwin",
      arch: "arm64",
      path: "binaries/sops",
      sha256: sops,
    },
    {
      binary: { name: "rg", version: "15.0.0", license: "Unlicense OR MIT", source: "https://x" },
      platform: "darwin",
      arch: "arm64",
      path: "binaries/rg",
      sha256: rg,
    },
    {
      binary: { name: "age", version: "1.3.2", license: "BSD-3-Clause", source: "https://x" },
      platform: "darwin",
      arch: "arm64",
      path: "binaries/age",
      sha256: age,
    },
  ]);
  expect(body).toEqual(`{
  "binaries": [
    {
      "name": "age",
      "platform": "darwin",
      "arch": "arm64",
      "path": "binaries/age",
      "sha256": "${age}",
      "version": "1.3.2"
    },
    {
      "name": "rg",
      "platform": "darwin",
      "arch": "arm64",
      "path": "binaries/rg",
      "sha256": "${rg}",
      "version": "15.0.0"
    },
    {
      "name": "sops",
      "platform": "darwin",
      "arch": "arm64",
      "path": "binaries/sops",
      "sha256": "${sops}",
      "version": "3.13.3"
    }
  ]
}
`);
});

test("sumsBody writes one `<sha256>  <path>` line per file, sorted by path", () => {
  const a = "a".repeat(64);
  const b = "b".repeat(64);
  const c = "c".repeat(64);
  const d = "d".repeat(64);
  expect(
    sumsBody([
      { path: "xeon", sha256: a },
      { path: "THIRD-PARTY-NOTICES.txt", sha256: b },
      { path: "group-kit/templates/index.json", sha256: c },
      { path: "binaries/age", sha256: d },
    ]),
  ).toEqual(
    `${d}  binaries/age\n${c}  group-kit/templates/index.json\n${b}  THIRD-PARTY-NOTICES.txt\n${a}  xeon\n`,
  );
});

test("noticesBody names each bundled binary with its license and source on a mac", () => {
  const bundled = [
    {
      name: "sops",
      version: "3.13.3",
      license: "MPL-2.0",
      source: "https://github.com/getsops/sops",
    },
    {
      name: "age",
      version: "1.3.2",
      license: "BSD-3-Clause",
      source: "https://github.com/FiloSottile/age",
    },
    {
      name: "rg",
      version: "15.0.0",
      license: "Unlicense OR MIT",
      source: "https://github.com/BurntSushi/ripgrep",
    },
  ];
  expect(noticesBody("0.0.0-smoke", MAC, bundled, [])).toEqual(
    [
      "Xeon 0.0.0-smoke (aarch64-apple-darwin) third-party notices",
      "",
      "sops 3.13.3",
      "  license: MPL-2.0",
      "  source:  https://github.com/getsops/sops",
      "",
      "age 1.3.2",
      "  license: BSD-3-Clause",
      "  source:  https://github.com/FiloSottile/age",
      "",
      "rg 15.0.0",
      "  license: Unlicense OR MIT",
      "  source:  https://github.com/BurntSushi/ripgrep",
      "",
      "",
      "The full license texts are in the sources above.",
      "",
    ].join("\n"),
  );
});

test("noticesBody on linux says nothing is bundled and names rg, bwrap and socat as required from the system", () => {
  expect(noticesBody("0.0.0-smoke", LINUX, [], ["rg", "bwrap", "socat"])).toEqual(
    [
      "Xeon 0.0.0-smoke (x86_64-unknown-linux-gnu) third-party notices",
      "",
      "Bundled external binaries: none.",
      "Required from the system, not bundled: rg, bwrap, socat.",
      "Install them with the package manager (`xeon doctor` prints the command).",
      "",
      "The full license texts are in the sources above.",
      "",
    ].join("\n"),
  );
});

test("archiveName is xeon-<version>-<triple>.tar.gz and parseArchiveName reads it back", () => {
  expect(archiveName("1.2.3", MAC)).toEqual("xeon-1.2.3-aarch64-apple-darwin.tar.gz");
  expect(parseArchiveName(archiveName("1.2.3-rc.1", LINUX))).toEqual({
    version: "1.2.3-rc.1",
    triple: LINUX,
  });
});

test("isSafeVersion accepts a plain dotted version with a pre-release tail and rejects paths and short forms", () => {
  const cases = ["0.0.0", "1.2.3-rc.1", "../x", "1.2", "1.2.3/x"];
  expect(cases.map((version) => isSafeVersion(version))).toEqual([true, true, false, false, false]);
});

const ALL_ERRORS: readonly ReleaseError[] = [
  { kind: "config.invalid", message: "m" },
  { kind: "binary.missing", name: "rg", dir: "/d" },
  { kind: "binary.version", name: "rg", want: "15.0.0", got: "14.1.0" },
  { kind: "input.missing", path: "/p" },
  { kind: "step.failed", step: "sign", exitCode: 3 },
  { kind: "host.unsupported", platform: "win32", arch: "ia32" },
  { kind: "tool.missing", name: "tar" },
];

test("exitCodeOf gives 2 only for an unsupported host or a missing tool, 1 for every fix", () => {
  expect(ALL_ERRORS.map((error) => exitCodeOf(error))).toEqual([1, 1, 1, 1, 1, 2, 2]);
});

test("describeError names the cause and the fix for each kind", () => {
  expect(ALL_ERRORS.map((error) => describeError(error))).toEqual([
    "release-bundle.json is invalid: m",
    "bundled binary rg not found in /d (pass --binaries-dir with sops, age and rg)",
    'bundled binary rg must be 15.0.0, found "14.1.0"',
    "missing input /p",
    "step sign failed with exit 3",
    "unsupported host win32/ia32",
    "tool tar is missing",
  ]);
});

test("parseArchiveName accepts only xeon-<version>-<triple>.tar.gz", () => {
  const names = [
    "xeon-0.0.0-smoke-aarch64-apple-darwin.tar.gz",
    "xeon-1.2.3-x86_64-unknown-linux-gnu.tar.gz",
    "xeon-1.2-aarch64-apple-darwin.tar.gz",
    "xeon-1.2.3-aarch64-apple-darwin.zip",
    "other-1.2.3-aarch64-apple-darwin.tar.gz",
    "xeon-../x-aarch64-apple-darwin.tar.gz",
  ];
  expect(names.map((name) => parseArchiveName(name))).toEqual([
    { version: "0.0.0-smoke", triple: MAC },
    { version: "1.2.3", triple: LINUX },
    undefined,
    undefined,
    undefined,
    undefined,
  ]);
});

const H1 = "a".repeat(64);
const H2 = "b".repeat(64);

test("parseSums reads `<sha256>  <path>` lines and rejects a malformed line, a `..` path or an absolute path", () => {
  expect(parseSums(`${H1}  xeon\n${H2}  binaries/age\n`)).toEqual([
    { sha256: H1, path: "xeon" },
    { sha256: H2, path: "binaries/age" },
  ]);
  const malformed = [
    "not a sum line\n",
    `${H1} xeon\n`,
    `${"A".repeat(64)}  xeon\n`,
    `${H1}  ../secret\n`,
    `${H1}  binaries/../../secret\n`,
    `${H1}  /etc/passwd\n`,
  ];
  expect(malformed.map((text) => parseSums(text))).toEqual(malformed.map(() => undefined));
});

test("requiredPaths asks for the lock and the bundled binaries only on macOS", () => {
  const common = [
    "xeon",
    "group-kit/templates/index.json",
    "default-plugins/helm/.xeon-plugin/plugin.json",
    "default-plugins/account-rotation/.xeon-plugin/plugin.json",
    "THIRD-PARTY-NOTICES.txt",
    "SHA256SUMS",
  ];
  expect(requiredPaths(MAC)).toEqual([
    ...common,
    "binaries.lock.json",
    "binaries/sops",
    "binaries/age",
    "binaries/rg",
  ]);
  expect(requiredPaths(LINUX)).toEqual(common);
  expect(requiredPaths("x86_64-pc-windows-msvc")).toEqual(["xeon.exe", ...common.slice(1)]);
});

function miseVersions(file: string): readonly string[] | undefined {
  const text = readFileSync(join(REPO, ".github", "workflows", file), "utf8");
  return /mise use --global sops@(\S+) age@(\S+) ripgrep@(\S+)/.exec(text)?.slice(1);
}

test("the sops, age and rg versions in release-bundle.json match the mise pins of both macOS workflows", () => {
  const result = parseBundleConfig(BUNDLE_TEXT);
  if (!result.ok) throw new Error("the committed config does not parse");
  const bundled = result.value.bundledBinaries[MAC]?.binaries ?? [];
  expect({
    bundle: bundled.map((binary) => binary.version),
    macos: miseVersions("xeon-macos.yml"),
    release: miseVersions("xeon-release.yml"),
  }).toEqual({
    bundle: ["3.13.3", "1.3.2", "15.0.0"],
    macos: ["3.13.3", "1.3.2", "15.0.0"],
    release: ["3.13.3", "1.3.2", "15.0.0"],
  });
});

test("sidecarCommand hands the release version to build-sidecar, so the binary carries it", () => {
  expect(sidecarCommand(LINUX, "1.2.3", "/o/.sidecar-build")).toEqual([
    process.execPath,
    join("scripts", "build-sidecar.ts"),
    LINUX,
    "--version",
    "1.2.3",
    "--out-dir",
    "/o/.sidecar-build",
  ]);
});

test("a release build writes its sidecar under the output directory, never the development sidecar path", () => {
  const out = "/o/release";
  expect(releaseSidecarDir(out)).toBe("/o/release/.sidecar-build");
  expect(releaseSidecarDir(out)).not.toBe(devSidecarDir("/x"));
  expect(devSidecarDir("/x")).toBe(join("/x", "apps", "desktop", "src-tauri", "binaries"));
});

test("release-smoke.sh passes its version to release.ts, and xeon-release.yml sets XEON_RELEASE_VERSION from a tag", () => {
  const smoke = readFileSync(join(import.meta.dir, "release-smoke.sh"), "utf8");
  expect(smoke).toContain('scripts/release.ts host --version "$version"');
  const workflow = readFileSync(join(REPO, ".github", "workflows", "xeon-release.yml"), "utf8");
  expect(workflow).toContain("XEON_RELEASE_VERSION:");
  expect(workflow).toContain("refs/tags/v");
});
