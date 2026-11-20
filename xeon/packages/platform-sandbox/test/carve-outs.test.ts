import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ProtectedPathEntry } from "@fresnel/contracts/services";
import { carveOutRules } from "../src/carve-outs.ts";

// L0.sandbox.spec §4.9 "script-env" 읽기 예외의 검사(carve-outs.ts). 파일 시스템의 임시 틀에서 값으로 본다.

const root = realpathSync(mkdtempSync(join(tmpdir(), "fresnel-carve-")));
const home = join(root, "home");
const hooks = join(home, ".claude", "hooks");
const helper = join(hooks, "helper.py");
const project = join(root, "project");

mkdirSync(hooks, { recursive: true });
mkdirSync(join(home, ".ssh"), { recursive: true });
mkdirSync(project, { recursive: true });
writeFileSync(helper, "helper");
writeFileSync(join(hooks, "x.py"), "x");
writeFileSync(join(home, ".claude", "secret.json"), "secret");

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

const claude: ProtectedPathEntry = {
  path: join(home, ".claude"),
  match: "prefix",
  access: "read_write",
  reason: "agent_credentials",
};
const ssh: ProtectedPathEntry = {
  path: join(home, ".ssh"),
  match: "prefix",
  access: "read_write",
  reason: "credentials",
};
const envFile: ProtectedPathEntry = {
  path: ".env",
  match: "basename",
  access: "read_write",
  reason: "credentials",
  except: [".env.example"],
};
const envPattern: ProtectedPathEntry = {
  path: ".env.*",
  match: "basename",
  access: "read_write",
  reason: "credentials",
  except: [".env.example"],
};
const entries: readonly ProtectedPathEntry[] = [claude, ssh, envFile, envPattern];
const readDeny: readonly string[] = [claude.path, ssh.path];

describe("carveOutRules", () => {
  test("a file and a folder under a protected path come back as literal and subpath rules", () => {
    const result = carveOutRules({
      carveOuts: [helper, hooks],
      readDeny,
      protectedEntries: entries,
    });
    expect(result).toEqual({
      ok: true,
      value: { literal: [helper], subpath: [hooks] },
    });
  });

  test("no carve-outs give empty rules", () => {
    expect(carveOutRules({ carveOuts: [], readDeny, protectedEntries: entries })).toEqual({
      ok: true,
      value: { literal: [], subpath: [] },
    });
  });

  test("the protected folder itself, an ancestor of it, and the root are rejected as protected", () => {
    for (const carveOut of [claude.path, home, "/"]) {
      expect(carveOutRules({ carveOuts: [carveOut], readDeny, protectedEntries: entries })).toEqual(
        { ok: false, error: "protected" },
      );
    }
  });

  test("a relative path, a missing path and a path with an unsafe character are rejected as unsafe or missing", () => {
    const cases = ["relative/hooks", join(home, "missing"), join(home, 'a"b')];
    for (const carveOut of cases) {
      expect(carveOutRules({ carveOuts: [carveOut], readDeny, protectedEntries: entries })).toEqual(
        { ok: false, error: "unsafe_or_missing" },
      );
    }
  });

  test("a file whose name is a protected basename is rejected, and .env.example is accepted", () => {
    const envPath = join(project, ".env");
    const examplePath = join(project, ".env.example");
    writeFileSync(envPath, "A=1");
    writeFileSync(examplePath, "A=");
    expect(
      carveOutRules({ carveOuts: [envPath], readDeny: [], protectedEntries: entries }),
    ).toEqual({ ok: false, error: "protected" });
    expect(
      carveOutRules({ carveOuts: [examplePath], readDeny: [], protectedEntries: entries }),
    ).toEqual({ ok: true, value: { literal: [examplePath], subpath: [] } });
  });

  test("a folder that contains a protected basename file is rejected", () => {
    const folder = join(root, "with-env");
    mkdirSync(folder, { recursive: true });
    writeFileSync(join(folder, ".env.local"), "A=1");
    expect(carveOutRules({ carveOuts: [folder], readDeny: [], protectedEntries: entries })).toEqual(
      { ok: false, error: "protected" },
    );
  });

  test("a symbolic link is checked by its real path: a link named helper.py to .env is rejected", () => {
    const realEnv = join(root, "linked", ".env");
    mkdirSync(join(root, "linked"), { recursive: true });
    writeFileSync(realEnv, "A=1");
    const link = join(root, "linked", "helper.py");
    symlinkSync(realEnv, link);
    expect(carveOutRules({ carveOuts: [link], readDeny: [], protectedEntries: entries })).toEqual({
      ok: false,
      error: "protected",
    });
  });

  test("a folder that holds an effective read-deny path is rejected", () => {
    const secret = join(hooks, "x.py");
    expect(
      carveOutRules({
        carveOuts: [hooks],
        readDeny: [...readDeny, secret],
        protectedEntries: entries,
      }),
    ).toEqual({ ok: false, error: "protected" });
  });
});
