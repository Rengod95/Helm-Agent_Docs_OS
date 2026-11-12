import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  PINNED_VERSIONS,
  bundledPath,
  findOnBuildMachine,
  lockText,
  missingToolMessage,
  newestFirst,
  relockText,
  sha256Of,
  versionOfOutput,
} from "./bundled-binaries-lib.ts";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
function tmp(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "dzB-bin-"));
  dirs.push(dir);
  return dir;
}
function exe(file: string): void {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, "x");
  chmodSync(file, 0o755);
}

describe("pins", () => {
  test("match scripts/release-bundle.json", () => {
    const text = readFileSync(path.join(import.meta.dirname, "release-bundle.json"), "utf8");
    const json: unknown = JSON.parse(text);
    const found: Record<string, string> = {};
    if (typeof json === "object" && json !== null && "bundledBinaries" in json) {
      const triples: unknown = json.bundledBinaries;
      const entry =
        typeof triples === "object" && triples !== null && "aarch64-apple-darwin" in triples
          ? triples["aarch64-apple-darwin"]
          : null;
      const list: unknown =
        typeof entry === "object" && entry !== null && "binaries" in entry ? entry.binaries : [];
      if (Array.isArray(list)) {
        const items: readonly unknown[] = list;
        for (const item of items) {
          if (
            typeof item === "object" &&
            item !== null &&
            "name" in item &&
            "version" in item &&
            typeof item.name === "string" &&
            typeof item.version === "string"
          ) {
            found[item.name] = item.version;
          }
        }
      }
    }
    expect(found["sops"]).toBe(PINNED_VERSIONS.sops);
    expect(found["age"]).toBe(PINNED_VERSIONS.age);
  });
});

describe("lockText", () => {
  test("has the shape the engine reads, sorted by name, with a trailing newline", () => {
    const text = lockText([
      {
        name: "sops",
        platform: "darwin",
        arch: "arm64",
        path: bundledPath("sops"),
        sha256: sha256Of(new TextEncoder().encode("s")),
        version: "3.13.3",
      },
      {
        name: "age",
        platform: "darwin",
        arch: "arm64",
        path: bundledPath("age"),
        sha256: sha256Of(new TextEncoder().encode("a")),
        version: "1.3.2",
      },
    ]);
    expect(JSON.parse(text)).toEqual({
      binaries: [
        {
          name: "age",
          platform: "darwin",
          arch: "arm64",
          path: "binaries/age",
          sha256: "ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb",
          version: "1.3.2",
        },
        {
          name: "sops",
          platform: "darwin",
          arch: "arm64",
          path: "binaries/sops",
          sha256: "043a718774c572bd8a25adbeb1bfcd5c0256ae11cecf9f9c3f925d0e52beaf89",
          version: "3.13.3",
        },
      ],
    });
    expect(text.endsWith("}\n")).toBe(true);
  });
});

describe("versionOfOutput and newestFirst", () => {
  test("reads the first x.y.z and orders versions newest first", () => {
    expect(versionOfOutput("sops 3.13.3 (latest)\n")).toBe("3.13.3");
    expect(versionOfOutput("nothing")).toBeNull();
    expect(newestFirst(["3.9.0", "3.13.3", "3.10.1"])).toEqual(["3.13.3", "3.10.1", "3.9.0"]);
  });
});

describe("findOnBuildMachine", () => {
  test("FRESNEL_BINARIES_DIR first, then the pinned mise version, then PATH; null when absent", () => {
    const home = tmp();
    const pathDir = tmp();
    const given = tmp();
    exe(path.join(pathDir, "sops"));
    exe(path.join(home, ".local/share/mise/installs/sops/3.13.3/sops"));
    exe(path.join(home, ".local/share/mise/installs/sops/3.99.0/sops"));
    const base = { tool: "sops", home, pathEnv: pathDir, wantVersion: "3.13.3" } as const;
    expect(findOnBuildMachine({ ...base, binariesDir: undefined })?.path).toBe(
      path.join(home, ".local/share/mise/installs/sops/3.13.3/sops"),
    );
    exe(path.join(given, "sops"));
    expect(findOnBuildMachine({ ...base, binariesDir: given })?.via).toBe("FRESNEL_BINARIES_DIR");
    expect(findOnBuildMachine({ ...base, home: undefined, binariesDir: undefined })?.via).toBe(
      "PATH",
    );
    expect(
      findOnBuildMachine({ ...base, home: undefined, pathEnv: "", binariesDir: undefined }),
    ).toBeNull();
  });

  test("age is found in the mise layout age/<ver>/age/age", () => {
    const home = tmp();
    exe(path.join(home, ".local/share/mise/installs/age/1.3.2/age/age"));
    const found = findOnBuildMachine({
      tool: "age",
      home,
      pathEnv: "",
      binariesDir: undefined,
      wantVersion: "1.3.2",
    });
    expect(found?.path).toBe(path.join(home, ".local/share/mise/installs/age/1.3.2/age/age"));
  });

  test("the missing message tells how to install and says nothing is downloaded", () => {
    expect(missingToolMessage("sops", "3.13.3")).toContain("mise use -g sops@3.13.3");
    expect(missingToolMessage("sops", "3.13.3")).toContain("never downloads");
  });
});

describe("relockText", () => {
  test("rewrites only the hashes and keeps the rest, and refuses a wrong shape", () => {
    const before = lockText([
      {
        name: "sops",
        platform: "darwin",
        arch: "arm64",
        path: "binaries/sops",
        sha256: "old",
        version: "3.13.3",
      },
    ]);
    const after = relockText(before, (rel) => `new:${rel}`);
    expect(JSON.parse(after ?? "null")).toEqual({
      binaries: [
        {
          name: "sops",
          platform: "darwin",
          arch: "arm64",
          path: "binaries/sops",
          sha256: "new:binaries/sops",
          version: "3.13.3",
        },
      ],
    });
    expect(relockText('{"binaries": 3}', () => "x")).toBeNull();
    expect(relockText('{"binaries": [{"name": "evil"}]}', () => "x")).toBeNull();
  });
});
