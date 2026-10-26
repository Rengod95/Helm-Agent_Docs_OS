import { afterEach, describe, expect, test } from "bun:test";
import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { ok } from "@xeon/contracts";
import { createSecretsRuntime, type SecretsRuntime } from "../src/assemble.ts";
import { DEFAULT_SECRETS_CONFIG, defaultSopsFile, type SecretsConfig } from "../src/config.ts";
import { bunRunner, type ProcessRunner } from "../src/providers/process.ts";
import { manualClock } from "./support/clock.ts";
import { httpCtx } from "./support/ctx.ts";
import { fixedLocalIds } from "./support/ids.ts";
import { metaOf } from "./support/meta.ts";
import { handleOf } from "./support/names.ts";
import { fakeOs, tempDir, type TempDir } from "./support/os.ts";
import { REAL_SOPS } from "./support/real-sops.ts";
import { trackedSource } from "./support/value-source.ts";

// spec §4.8 (c), plan SC-20(M2 첫 실행). 사람이 파일도 키도 준비하지 않은 깨끗한 기기에서 첫 `add`가 age 키와 기본 SOPS 파일을 만든다.
// 임시 홈과 임시 config 디렉터리만 쓴다(실제 키체인, 사용자 키 파일은 읽지도 쓰지도 않는다). 실제 sops 3.13과 age 바이너리가 없으면 건너뛴다.
// 값은 시험이 만든 가짜이고 불리언으로만 비교한다.

const real = REAL_SOPS !== null;
const sops = REAL_SOPS ?? "";

const dirs: TempDir[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => dir.remove()));
});

const FILE_SOURCE: SecretsConfig = {
  ...DEFAULT_SECRETS_CONFIG,
  sops: { files: [], binary: sops },
  // 임시 홈에서는 OS 키 저장소를 쓰지 않는다. 파일 폴백을 사람이 확인한 것으로 둔다
  ageKey: { source: "file", filePath: null },
};

interface Client {
  readonly runtime: SecretsRuntime;
  readonly config: string;
}

/** 한 클라이언트(CLI 또는 데스크톱 사이드카)의 조립. config 디렉터리가 같으면 같은 사용자의 같은 저장소다 */
function client(
  config: string,
  home: string,
  overrides: Partial<SecretsConfig> = {},
  runner?: ProcessRunner,
): Client {
  const runtime = createSecretsRuntime({
    os: fakeOs({
      config,
      clock: manualClock(),
      binaries: { sops: [sops, "3.13.3"] },
      userId: process.getuid?.() ?? null,
    }),
    ids: fixedLocalIds(),
    config: () => ({ ...FILE_SOURCE, ...overrides }),
    env: { PATH: Bun.env["PATH"] ?? "/usr/bin:/bin", HOME: home },
    ...(runner === undefined ? {} : { runner }),
  });
  return { runtime, config };
}

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

function metaFor(name: string, env = "user") {
  return metaOf({ name, ref: `${env}/${name.toUpperCase().replaceAll("-", "_")}` });
}

const leaseEquals = async (c: Client, name: string, expected: string): Promise<boolean> => {
  const lease = await c.runtime.service.lease(handleOf(name), httpCtx());
  if (!lease.ok) return false;
  try {
    const same = await lease.value.use((view) => view.text() === expected);
    return same.ok && same.value;
  } finally {
    lease.value.dispose();
  }
};

describe.skipIf(!real)("first write on a clean machine (spec §4.8)", () => {
  test("add creates the age key, the recipient record and an encrypted 0600 default file", async () => {
    const dir = await workdir();
    const config = dir.join("config");
    const a = client(config, dir.path);
    const defaultFile = defaultSopsFile(config).path;
    expect(defaultFile).toBe(join(config, "secrets", "sops", "user.yaml"));

    const value = "first-write-fake-value-0201";
    const added = await a.runtime.admin.add(metaFor("anthropic-api-key"), trackedSource(value));
    expect(added).toEqual({ ok: true, value: handleOf("anthropic-api-key") });

    expect(await mode(defaultFile)).toBe(0o600);
    expect(await mode(join(config, "secrets", "sops"))).toBe(0o700);
    expect(await mode(join(config, "secrets", "age", "keys.txt"))).toBe(0o600);
    expect(await mode(join(config, "secrets", "age", "recipient.file.txt"))).toBe(0o600);
    // 파일에는 암호문만 있고 값도 개인 키도 없다
    const body = await readFile(defaultFile, "utf8");
    expect(body.includes("ENC[")).toBe(true);
    expect(body.includes(value)).toBe(false);
    expect(body.includes("AGE-SECRET-KEY")).toBe(false);
    // 수신자는 공개키이고 SOPS 파일의 수신자와 같다
    const recipient = (
      await readFile(join(config, "secrets", "age", "recipient.file.txt"), "utf8")
    ).trim();
    expect(recipient.startsWith("age1")).toBe(true);
    expect(body.includes(`recipient: ${recipient}`)).toBe(true);

    expect(await leaseEquals(a, "anthropic-api-key", value)).toBe(true);
    const tested = await a.runtime.admin.test(handleOf("anthropic-api-key"));
    expect(tested.ok && tested.value.decryptable).toBe(true);
    // 설정에 파일을 적지 않아도 목록에 보이고, 샌드박스 보호 경로도 기본 파일을 덮는다
    const listed = await a.runtime.admin.ls({ usage: false });
    expect(listed.ok && listed.value.map((l) => [l.handle, l.status])).toEqual([
      [handleOf("anthropic-api-key"), "valid"],
    ]);
    expect(a.runtime.service.protectedPaths().some((p) => defaultFile.startsWith(p))).toBe(true);
  });

  test("the second add reuses the key and the file", async () => {
    const dir = await workdir();
    const config = dir.join("config");
    const a = client(config, dir.path);
    expect(
      (await a.runtime.admin.add(metaFor("exa-api-key"), trackedSource("exa-fake-value-0202"))).ok,
    ).toBe(true);
    const keyPath = join(config, "secrets", "age", "keys.txt");
    const keyBefore = await readFile(keyPath, "utf8");
    expect(
      (await a.runtime.admin.add(metaFor("brave-api-key"), trackedSource("brave-fake-value-0203")))
        .ok,
    ).toBe(true);
    expect((await readFile(keyPath, "utf8")) === keyBefore).toBe(true);
    expect(await leaseEquals(a, "exa-api-key", "exa-fake-value-0202")).toBe(true);
    expect(await leaseEquals(a, "brave-api-key", "brave-fake-value-0203")).toBe(true);
  });

  test("two clients of one user (CLI state dir and sidecar state dir) see one secret store", async () => {
    const dir = await workdir();
    // 저장소는 사용자 config 디렉터리 하나다. 클라이언트마다 다른 것은 state 디렉터리(`state/cli` 등)뿐이고 비밀은 거기 쓰지 않는다
    const config = dir.join("config");
    const cli = client(config, dir.path);
    const sidecar = client(config, dir.path);
    await Promise.all(
      ["cli", "sidecar"].map((name) => workdir().then((d) => d.join("state", name))),
    );

    const value = "shared-fake-value-0204";
    expect(
      (await cli.runtime.admin.add(metaFor("anthropic-api-key"), trackedSource(value))).ok,
    ).toBe(true);

    // 사이드카는 같은 이름과 값을 본다
    const listed = await sidecar.runtime.admin.ls({ usage: false });
    expect(listed.ok && listed.value.map((l) => [l.handle, l.status])).toEqual([
      [handleOf("anthropic-api-key"), "valid"],
    ]);
    expect(await leaseEquals(sidecar, "anthropic-api-key", value)).toBe(true);

    // 사이드카가 값을 바꾸면 CLI가 새 값을 본다
    const rotated = "shared-fake-value-0205";
    const set = await sidecar.runtime.admin.set(
      handleOf("anthropic-api-key"),
      trackedSource(rotated),
    );
    expect(set.ok).toBe(true);
    expect(await leaseEquals(cli, "anthropic-api-key", rotated)).toBe(true);
    // 파일은 하나뿐이다
    expect(await readdir(join(config, "secrets", "sops"))).toEqual(["user.yaml"]);
  });

  test("concurrent first writes from two clients create one key and keep both values", async () => {
    const dir = await workdir();
    const config = dir.join("config");
    const cli = client(config, dir.path);
    const sidecar = client(config, dir.path);
    const [first, second] = await Promise.all([
      cli.runtime.admin.add(metaFor("exa-api-key"), trackedSource("race-fake-value-0206")),
      sidecar.runtime.admin.add(metaFor("brave-api-key"), trackedSource("race-fake-value-0207")),
    ]);
    expect([first.ok, second.ok]).toEqual([true, true]);
    expect(await leaseEquals(cli, "exa-api-key", "race-fake-value-0206")).toBe(true);
    expect(await leaseEquals(sidecar, "brave-api-key", "race-fake-value-0207")).toBe(true);
    expect(await leaseEquals(cli, "brave-api-key", "race-fake-value-0207")).toBe(true);
    // 키 파일 하나, 수신자 기록 하나
    expect((await readdir(join(config, "secrets", "age"))).toSorted()).toEqual([
      "keys.txt",
      "recipient.file.txt",
    ]);
  });

  test("a missing sops binary fails before any key is created", async () => {
    const dir = await workdir();
    const config = dir.join("config");
    const runtime = createSecretsRuntime({
      os: fakeOs({ config, clock: manualClock(), userId: process.getuid?.() ?? null }),
      ids: fixedLocalIds(),
      config: () => ({ ...FILE_SOURCE, sops: { files: [], binary: null } }),
      env: { PATH: Bun.env["PATH"] ?? "/usr/bin:/bin", HOME: dir.path },
    });
    const added = await runtime.admin.add(
      metaFor("exa-api-key"),
      trackedSource("nobin-fake-value-0208"),
    );
    expect(added).toEqual({
      ok: false,
      error: { kind: "provider_unavailable", provider: "sops", reason: "binary_missing" },
    });
    expect(await readdir(join(config, "secrets")).catch(() => [])).not.toContain("age");
  });

  test("a failed encryption leaves the key and the recipient record, and the retry reuses them", async () => {
    const dir = await workdir();
    const config = dir.join("config");
    let failEncrypt = true;
    const flaky: ProcessRunner = (request) => {
      if (failEncrypt && request.argv[1] === "encrypt") {
        return Promise.resolve(ok({ exitCode: 1, stdout: new Uint8Array(), stderr: "boom" }));
      }
      return bunRunner(request);
    };
    const c = client(config, dir.path, {}, flaky);
    const failed = await c.runtime.admin.add(
      metaFor("exa-api-key"),
      trackedSource("retry-fake-value-0209"),
    );
    expect(failed).toEqual({
      ok: false,
      error: {
        kind: "write_failed",
        target: "sops_file",
        path: defaultSopsFile(config).path,
        code: "sops_encrypt_failed",
      },
    });
    const recipientPath = join(config, "secrets", "age", "recipient.file.txt");
    const recipient = await readFile(recipientPath, "utf8");
    expect(await exists(defaultSopsFile(config).path)).toBe(false);

    failEncrypt = false;
    const value = "retry-fake-value-0210";
    expect((await c.runtime.admin.add(metaFor("exa-api-key"), trackedSource(value))).ok).toBe(true);
    // 같은 키를 다시 쓴다: 새 키를 만들지 않았다
    expect((await readFile(recipientPath, "utf8")) === recipient).toBe(true);
    expect(await leaseEquals(c, "exa-api-key", value)).toBe(true);
  });

  test("a key without a recipient record cannot create the file and says why", async () => {
    const dir = await workdir();
    const config = dir.join("config");
    const c = client(config, dir.path);
    // 첫 시도가 키만 만들고 수신자 기록을 잃은 상태를 만든다
    expect(
      (await c.runtime.admin.add(metaFor("exa-api-key"), trackedSource("norec-fake-value-0211")))
        .ok,
    ).toBe(true);
    const { rm } = await import("node:fs/promises");
    await rm(defaultSopsFile(config).path);
    await rm(join(config, "secrets", "age", "recipient.file.txt"));
    const added = await c.runtime.admin.add(
      metaFor("brave-api-key"),
      trackedSource("norec-fake-value-0212"),
    );
    expect(added).toEqual({
      ok: false,
      error: {
        kind: "write_failed",
        target: "sops_file",
        path: defaultSopsFile(config).path,
        code: "recipient_unknown",
      },
    });
  });

  test("an unconfirmed file fallback does not create a key silently", async () => {
    const dir = await workdir();
    const config = dir.join("config");
    const runtime = createSecretsRuntime({
      // WSL에는 Secret Service가 없다: auto가 파일 폴백으로 떨어지고 사람이 확인하기 전에는 쓰지 않는다(§4.7 5번)
      os: fakeOs({
        config,
        clock: manualClock(),
        isWsl: true,
        binaries: { sops: [sops, "3.13.3"] },
        userId: process.getuid?.() ?? null,
      }),
      ids: fixedLocalIds(),
      config: () => ({ ...FILE_SOURCE, ageKey: { source: "auto", filePath: null } }),
      env: { PATH: Bun.env["PATH"] ?? "/usr/bin:/bin", HOME: dir.path },
    });
    const added = await runtime.admin.add(
      metaFor("exa-api-key"),
      trackedSource("unconf-fake-value-0213"),
    );
    expect(added).toEqual({
      ok: false,
      error: { kind: "key_unavailable", key: "file", reason: "access_denied" },
    });
    expect(await readdir(join(config, "secrets")).catch(() => [])).not.toContain("age");
    expect(await exists(defaultSopsFile(config).path)).toBe(false);
  });

  test("a configured file that does not exist yet is created too; a dotenv file is refused before a key exists", async () => {
    const dir = await workdir();
    const config = dir.join("config");
    const mine = dir.join("mine", "dev.json");
    const c = client(config, dir.path, {
      sops: { files: [{ env: "dev", path: mine }], binary: sops },
    });
    expect(
      (
        await c.runtime.admin.add(
          metaFor("exa-api-key", "dev"),
          trackedSource("cfg-fake-value-0214"),
        )
      ).ok,
    ).toBe(true);
    expect(await mode(mine)).toBe(0o600);
    expect(await leaseEquals(c, "exa-api-key", "cfg-fake-value-0214")).toBe(true);

    const dir2 = await workdir();
    const env = dir2.join("x.env");
    const d = client(dir2.join("config"), dir2.path, {
      sops: { files: [{ env: "dev", path: env }], binary: sops },
    });
    const refused = await d.runtime.admin.add(
      metaFor("exa-api-key", "dev"),
      trackedSource("cfg-fake-value-0215"),
    );
    expect(refused).toEqual({
      ok: false,
      error: { kind: "write_failed", target: "sops_file", path: env, code: "unsupported_format" },
    });
    expect(await readdir(join(dir2.join("config"), "secrets")).catch(() => [])).not.toContain(
      "age",
    );
  });
});

// 실제 바이너리가 없는 기기의 안내: 위 시험은 건너뛴다. 이 한 건이 이유를 이름으로 보인다(환경 문제이고 코드 문제가 아니다)
test.skipIf(real)(
  "real sops binary missing: first-write integration tests are skipped (environment, not code)",
  () => {
    expect(REAL_SOPS).toBeNull();
  },
);
