import { afterEach, describe, expect, test } from "bun:test";
import { chmod, copyFile, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { err, ok } from "@fresnel/contracts";
import type { OsInfo } from "@fresnel/contracts/services";
import { knownCandidates, sortVersionsDescending } from "../src/binaries/known-paths.ts";
import { generateBinariesLock } from "../src/binaries/lock.ts";
import {
  createBinaryResolver,
  createNodeBinaryFs,
  type BinaryFs,
  type BinaryResolverDeps,
} from "../src/binaries/resolve.ts";
import type { RunCommand } from "../src/proc.ts";
import { tempDir, type TempDir } from "../src/testing/index.ts";
import { memoryLogger } from "./support/clock.ts";

const DARWIN: OsInfo = { platform: "darwin", arch: "arm64", isWsl: false, release: "" };
const signal = new AbortController().signal;
const FINDER_PATH = "/usr/bin:/bin:/usr/sbin:/sbin";

let temp: TempDir | undefined;
afterEach(async () => {
  await temp?.remove();
  temp = undefined;
});

function fakeFs(executables: readonly string[], dirs: Readonly<Record<string, readonly string[]>>) {
  const fs: BinaryFs = {
    readFile: () => Promise.resolve(err({ code: "ENOENT" })),
    isExecutableFile: (path) => Promise.resolve(executables.includes(path)),
    listDir: (path) => Promise.resolve(dirs[path] ?? []),
  };
  return fs;
}

function deps(fs: BinaryFs, run: RunCommand, home: string | undefined): BinaryResolverDeps {
  return {
    info: DARWIN,
    resourceDir: "/no/such/resource",
    pathEnv: FINDER_PATH,
    homeDir: home,
    fs,
    run,
    logger: memoryLogger().logger,
    lifetime: signal,
  };
}

const sopsRun: RunCommand = (argv) =>
  Promise.resolve(ok({ exitCode: 0, stdout: `${argv[0] ?? ""} 3.13.3\n` }));

const ageRun: RunCommand = () => Promise.resolve(ok({ exitCode: 0, stdout: "1.3.2\n" }));

describe("sortVersionsDescending", () => {
  test("orders by numeric parts, newest first", () => {
    expect(sortVersionsDescending(["3.9.0", "3.13.3", "3.10.1"])).toEqual([
      "3.13.3",
      "3.10.1",
      "3.9.0",
    ]);
  });
});

describe("knownCandidates", () => {
  test("puts mise version folders before the mise shim and keeps the home folders out without a home", async () => {
    const fs = fakeFs([], { "/h/.local/share/mise/installs/sops": ["3.9.0", "3.13.3"] });
    const withHome = await knownCandidates(fs, { platform: "darwin", home: "/h", name: "sops" });
    const paths = withHome.map((c) => c.path);
    expect(paths[0]).toBe("/opt/homebrew/bin/sops");
    expect(paths).toContain("/h/.local/share/mise/installs/sops/3.13.3/sops");
    expect(paths.indexOf("/h/.local/share/mise/installs/sops/3.13.3/sops")).toBeLessThan(
      paths.indexOf("/h/.local/share/mise/shims/sops"),
    );
    const noHome = await knownCandidates(fs, { platform: "darwin", home: undefined, name: "sops" });
    expect(noHome.every((c) => !c.path.startsWith("/h"))).toBe(true);
    expect(await knownCandidates(fs, { platform: "win32", home: "/h", name: "sops" })).toEqual([]);
  });
});

describe("resolveBinary system candidates", () => {
  test("finds a mise install when PATH is the Finder PATH, and names the origin", async () => {
    const path = "/h/.local/share/mise/installs/sops/3.13.3/sops";
    const fs = fakeFs([path], { "/h/.local/share/mise/installs/sops": ["3.13.3"] });
    const resolve = createBinaryResolver(deps(fs, sopsRun, "/h"));
    const found = await resolve("sops", { minVersion: "3.10.0" }, signal);
    expect(found).toEqual({
      ok: true,
      value: { name: "sops", path, version: "3.13.3", source: "system", via: "mise" },
    });
  });

  test("age is found one folder deeper in the mise layout (age/<ver>/age/age)", async () => {
    const path = "/h/.local/share/mise/installs/age/1.3.2/age/age";
    const fs = fakeFs([path], { "/h/.local/share/mise/installs/age": ["1.3.2"] });
    const found = await createBinaryResolver(deps(fs, ageRun, "/h"))("age", {}, signal);
    expect(found.ok && found.value.path).toBe(path);
  });

  test("PATH wins over the known places, and not_found lists what was searched", async () => {
    const onPath = createBinaryResolver({
      ...deps(fakeFs(["/usr/bin/sops", "/opt/homebrew/bin/sops"], {}), sopsRun, "/h"),
    });
    const hit = await onPath("sops", {}, signal);
    expect(hit.ok && hit.value.via).toBe("PATH");
    const miss = await createBinaryResolver(deps(fakeFs([], {}), sopsRun, "/h"))(
      "sops",
      {},
      signal,
    );
    expect(miss.ok).toBe(false);
    if (!miss.ok && miss.error.kind === "not_found") {
      expect(miss.error.searched).toContain("/usr/bin");
      expect(miss.error.searched).toContain("/opt/homebrew/bin/sops");
    } else {
      throw new Error("expected not_found");
    }
  });
});

describe("bundled candidate (OS-11)", () => {
  test("a binaries.lock.json next to the sidecar wins over a system sops, and a changed byte is refused", async () => {
    temp = await tempDir("fresnel-bundled-");
    const resource = temp.path;
    await mkdir(join(resource, "binaries"), { recursive: true });
    const bundled = join(resource, "binaries", "sops");
    await writeFile(bundled, "#!/bin/sh\necho 3.13.3\n");
    await chmod(bundled, 0o755);
    const fs = createNodeBinaryFs();
    const lock = await generateBinariesLock(
      resource,
      [
        {
          name: "sops",
          platform: "darwin",
          arch: "arm64",
          path: "binaries/sops",
          version: "3.13.3",
        },
      ],
      fs,
    );
    if (!lock.ok) throw new Error("lock generation failed");
    await writeFile(join(resource, "binaries.lock.json"), lock.value);
    const base = { ...deps(fs, sopsRun, "/h"), resourceDir: resource };
    const withSystem = { ...base, pathEnv: "/usr/bin" };
    const found = await createBinaryResolver(withSystem)("sops", { minVersion: "3.10.0" }, signal);
    expect(found).toEqual({
      ok: true,
      value: { name: "sops", path: bundled, version: "3.13.3", source: "bundled" },
    });
    await writeFile(bundled, "#!/bin/sh\necho tampered\n");
    await chmod(bundled, 0o755);
    const tampered = await createBinaryResolver(withSystem)("sops", {}, signal);
    expect(!tampered.ok && tampered.error.kind).toBe("integrity_mismatch");
  });

  test("an executable file copied with copyFile keeps its exec bit (what the packager relies on)", async () => {
    temp = await tempDir("fresnel-bundled-mode-");
    const from = join(temp.path, "a");
    const to = join(temp.path, "b");
    await writeFile(from, "x");
    await chmod(from, 0o755);
    await copyFile(from, to);
    expect(await createNodeBinaryFs().isExecutableFile(to)).toBe(true);
  });
});
