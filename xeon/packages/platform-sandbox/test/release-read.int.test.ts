import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  readSandboxEnvironment,
  runCollected,
  startRealSandbox,
  type RealSandbox,
} from "./support/real-sandbox.ts";

// `l0.sandbox.protectedPaths.allowRead`를 실제 srt로 확인한다(AGE-63 결정 2 나). 가짜 홈에 같은 모양의 폴더를 만들고 실제 키체인과 브라우저 프로필은 읽지 않는다.

const environment = readSandboxEnvironment();
const runnable = environment.supported && environment.missing.length === 0;
const suite = runnable ? describe : describe.skip;

const FILES = {
  kube: ".kube/config",
  awsSso: ".aws/sso/cache.json",
  awsCredentials: ".aws/credentials",
  gnupg: ".gnupg/secring.gpg",
  sops: ".config/sops/age/keys.txt",
} as const;

function put(home: string, relative: string): string {
  const path = join(home, relative);
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, `value-of-${relative}`);
  return path;
}

suite("protectedPaths.allowRead against the real sandbox", () => {
  let box: RealSandbox;
  const at = (relative: string): string => join(box.dirs.home, relative);

  beforeAll(async () => {
    box = await startRealSandbox((dirs) => ({
      protectedPathsAllowRead: [
        join(dirs.home, ".kube"),
        join(dirs.home, ".aws", "sso"),
        join(dirs.home, ".config", "sops"),
        join(dirs.config, "secrets"),
        join(dirs.home, "not-protected"),
      ],
    }));
    for (const relative of Object.values(FILES)) put(box.dirs.home, relative);
    mkdirSync(join(box.dirs.config, "secrets"), { recursive: true });
    writeFileSync(join(box.dirs.config, "secrets", "k"), "fresnel-secret");
  });

  afterAll(async () => {
    await box.service.dispose();
    rmSync(box.dirs.root, { recursive: true, force: true });
  });

  const shellPolicy = (): ReturnType<RealSandbox["service"]["defaultPolicy"]> =>
    box.service.defaultPolicy({
      workspaceRoots: [box.dirs.workspace],
      tempDir: box.dirs.tmp,
      userReadRelease: true,
    });
  const shellRun = (command: string) =>
    runCollected(box.service.wrapShell(box.shell, shellPolicy()), command, {
      cwd: box.dirs.workspace,
    });

  test("a whole released entry is readable but not writable", async () => {
    const read = await shellRun(`cat ${at(FILES.kube)}`);
    expect(read.exitCode).toBe(0);
    expect(read.output).toBe(`value-of-${FILES.kube}`);
    const write = await shellRun(`echo x >> ${at(FILES.kube)}`);
    expect(write.exitCode).not.toBe(0);
  });

  test("a path inside an entry is readable while the rest of the entry stays blocked", async () => {
    const inner = await shellRun(`cat ${at(FILES.awsSso)}`);
    expect(inner.exitCode).toBe(0);
    expect(inner.output).toBe(`value-of-${FILES.awsSso}`);
    const sibling = await shellRun(`cat ${at(FILES.awsCredentials)}`);
    expect(sibling.exitCode).not.toBe(0);
    expect(sibling.output).not.toContain("value-of-");
    const write = await shellRun(`echo x >> ${at(FILES.awsSso)}`);
    expect(write.exitCode).not.toBe(0);
  });

  test("entries that were not released stay blocked", async () => {
    const result = await shellRun(`cat ${at(FILES.gnupg)}`);
    expect(result.exitCode).not.toBe(0);
    expect(result.output).not.toContain("value-of-");
  });

  test("pinned entries stay blocked even when listed", async () => {
    const sops = await shellRun(`cat ${at(FILES.sops)}`);
    expect(sops.exitCode).not.toBe(0);
    expect(sops.output).not.toContain("value-of-");
    const secret = await shellRun(`cat ${join(box.dirs.config, "secrets", "k")}`);
    expect(secret.exitCode).not.toBe(0);
    expect(secret.output).not.toContain("fresnel-secret");
  });

  test("a call that does not ask for the release keeps every default block", async () => {
    const plain = box.service.defaultPolicy({
      workspaceRoots: [box.dirs.workspace],
      tempDir: box.dirs.tmp,
    });
    const shell = box.service.wrapShell(box.shell, plain);
    const results = await Promise.all(
      [FILES.kube, FILES.awsSso].map((relative) =>
        runCollected(shell, `cat ${at(relative)}`, { cwd: box.dirs.workspace }),
      ),
    );
    for (const result of results) {
      expect(result.exitCode).not.toBe(0);
      expect(result.output).not.toContain("value-of-");
    }
  });

  test("the file tools' protected path list is not changed", () => {
    const entries = box.service.protectedPaths();
    expect(
      entries.some(
        (entry) => entry.path === join(box.dirs.home, ".kube") && entry.access === "read_write",
      ),
    ).toBe(true);
    expect(existsSync(at(FILES.kube))).toBe(true);
  });
});
