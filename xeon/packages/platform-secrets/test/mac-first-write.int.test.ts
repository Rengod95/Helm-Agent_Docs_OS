import { afterEach, describe, expect, test } from "bun:test";
import { stat } from "node:fs/promises";
import { join } from "node:path";
import { ok } from "@fresnel/contracts";
import { createSecretsRuntime, type SecretsRuntime } from "../src/assemble.ts";
import { DEFAULT_SECRETS_CONFIG, defaultSopsFile } from "../src/config.ts";
import { bunRunner, type ProcessRunner } from "../src/providers/process.ts";
import { manualClock } from "./support/clock.ts";
import { httpCtx } from "./support/ctx.ts";
import { fixedLocalIds } from "./support/ids.ts";
import { metaOf } from "./support/meta.ts";
import { handleOf } from "./support/names.ts";
import { fakeOs, tempDir, type TempDir } from "./support/os.ts";
import { REAL_SOPS } from "./support/real-sops.ts";
import { trackedSource } from "./support/value-source.ts";

// spec §4.7 9번, 첫 쓰기(macOS). 키체인 항목이 없는 Mac에서 첫 `add`는 키를 키체인에 만들지 않고 0600 키 파일에 만든다.
// `security`는 가짜 실행기가 답하고(항목 없음 44, 있음 0) 그 호출을 모두 기록한다. 실제 키체인과 실제 HOME은 건드리지 않는다.
// sops는 실제 바이너리를 쓴다. 없으면 건너뛴다(first-write.int.test.ts와 같은 조건). 값은 시험이 만든 가짜다.

const real = REAL_SOPS !== null;
const sops = REAL_SOPS ?? "";
const SECURITY = "/usr/bin/security";

const dirs: TempDir[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => dir.remove()));
});

async function workdir(): Promise<TempDir> {
  const dir = await tempDir();
  dirs.push(dir);
  return dir;
}

const exists = (path: string): Promise<boolean> =>
  stat(path).then(
    () => true,
    () => false,
  );

const mode = async (path: string): Promise<number> => (await stat(path)).mode & 0o777;

function metaFor(name: string) {
  return metaOf({ name, ref: `user/${name.toUpperCase().replaceAll("-", "_")}` });
}

interface FakeKeychain {
  readonly runner: ProcessRunner;
  /** `security`에 넘어간 argv 전부. 호출은 모두 여기에 남는다 */
  readonly calls: string[][];
}

/** 가짜 `security`. 항목이 있으면 조회에 0을, 없으면 44를 답한다. 다른 바이너리(sops)는 실제 실행기로 넘긴다 */
function fakeKeychain(itemExists: boolean): FakeKeychain {
  const calls: string[][] = [];
  const runner: ProcessRunner = (request) => {
    if (request.argv[0] !== SECURITY) return bunRunner(request);
    calls.push([...request.argv]);
    const exitCode = request.argv[1] === "find-generic-password" && itemExists ? 0 : 44;
    return Promise.resolve(ok({ exitCode, stdout: new Uint8Array(), stderr: "" }));
  };
  return { runner, calls };
}

/** macOS 한 대의 조립. 설정은 키 소스 auto(기본), SOPS 파일은 기본 사용자 파일이다 */
function macRuntime(
  config: string,
  home: string,
  keychain: FakeKeychain,
  onFileKeyCreated?: () => Promise<void>,
): SecretsRuntime {
  return createSecretsRuntime({
    os: fakeOs({
      config,
      clock: manualClock(),
      platform: "darwin",
      binaries: { sops: [sops, "3.13.3"], security: [SECURITY, "1"] },
      userId: process.getuid?.() ?? null,
    }),
    ids: fixedLocalIds(),
    config: () => ({
      ...DEFAULT_SECRETS_CONFIG,
      sops: { files: [], binary: sops },
      ageKey: { source: "auto", filePath: null },
    }),
    env: { PATH: Bun.env["PATH"] ?? "/usr/bin:/bin", HOME: home },
    runner: keychain.runner,
    ...(onFileKeyCreated === undefined ? {} : { onFileKeyCreated }),
  });
}

async function leaseEquals(
  runtime: SecretsRuntime,
  name: string,
  expected: string,
): Promise<boolean> {
  const lease = await runtime.service.lease(handleOf(name), httpCtx());
  if (!lease.ok) return false;
  try {
    const same = await lease.value.use((view) => view.text() === expected);
    return same.ok && same.value;
  } finally {
    lease.value.dispose();
  }
}

describe.skipIf(!real)("first add on a Mac (spec §4.7 9번)", () => {
  test("no Keychain item: the first key goes to the 0600 file, the Keychain is only read, the source callback runs once", async () => {
    const dir = await workdir();
    const config = dir.join("config");
    const keychain = fakeKeychain(false);
    let created = 0;
    const runtime = macRuntime(config, dir.path, keychain, () => {
      created += 1;
      return Promise.resolve();
    });

    const value = "mac-first-fake-value-0301";
    const added = await runtime.admin.add(metaFor("anthropic-api-key"), trackedSource(value));
    expect(added).toEqual({ ok: true, value: handleOf("anthropic-api-key") });

    expect(await mode(join(config, "secrets", "age", "keys.txt"))).toBe(0o600);
    expect(await mode(join(config, "secrets", "age", "recipient.file.txt"))).toBe(0o600);
    expect(await exists(join(config, "secrets", "age", "recipient.darwin-keychain.txt"))).toBe(
      false,
    );
    expect(await mode(defaultSopsFile(config).path)).toBe(0o600);
    expect(created).toBe(1);

    // Keychain은 항목 조회만 받았다. 항목을 만드는 `security -i`나 add 동사는 한 번도 가지 않았다
    expect(keychain.calls.length).toBeGreaterThan(0);
    expect([...new Set(keychain.calls.map((argv) => argv[1]))]).toEqual(["find-generic-password"]);
    expect(keychain.calls.some((argv) => argv.includes("-w"))).toBe(false);

    expect(await leaseEquals(runtime, "anthropic-api-key", value)).toBe(true);
  });

  test("a Keychain item that already exists keeps the Keychain: no key file, no callback, no new item", async () => {
    const dir = await workdir();
    const config = dir.join("config");
    const keychain = fakeKeychain(true);
    let created = 0;
    const runtime = macRuntime(config, dir.path, keychain, () => {
      created += 1;
      return Promise.resolve();
    });

    const added = await runtime.admin.add(
      metaFor("anthropic-api-key"),
      trackedSource("mac-held-fake-value-0302"),
    );
    // 항목은 있는데 이 기기가 수신자를 기록해 두지 않았다: 기존 키체인 경로가 그대로 이 오류를 낸다
    expect(added).toEqual({
      ok: false,
      error: {
        kind: "write_failed",
        target: "sops_file",
        path: defaultSopsFile(config).path,
        code: "recipient_unknown",
      },
    });
    expect(await exists(join(config, "secrets", "age", "keys.txt"))).toBe(false);
    expect(await exists(join(config, "secrets", "age", "recipient.file.txt"))).toBe(false);
    expect(created).toBe(0);
    // 항목을 새로 만들려는 호출은 없었다
    expect(keychain.calls.some((argv) => argv[1] === "-i")).toBe(false);
    expect(keychain.calls.some((argv) => argv[1] === "add-generic-password")).toBe(false);
  });
});
