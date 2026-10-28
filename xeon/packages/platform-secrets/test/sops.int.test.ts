import { afterEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { err, ok } from "@xeon/contracts";
import type { KeyProviderIdPublic, SecretError } from "@xeon/contracts/services";
import { createRedactor } from "../src/redactor.ts";
import {
  bunRunner,
  createSopsProvider,
  createSopsResolver,
  type ProcessRunner,
  type SopsKeyAccess,
  type SopsResolver,
} from "../src/providers/sops.ts";
import { fakeSopsBinary } from "../src/testing/index.ts";
import { manualClock } from "./support/clock.ts";
import { httpCtx } from "./support/ctx.ts";
import { forms } from "./support/encode.ts";
import { fixedLocalIds } from "./support/ids.ts";
import { nameOf } from "./support/names.ts";
import { recordingLogger, tempDir, type TempDir } from "./support/os.ts";
import { fakeValue, seededRandom } from "./support/random.ts";

const FIXTURE = join(import.meta.dir, "fixtures", "sample.sops.yaml");
const PARENT_ENV = {
  PATH: "/usr/bin:/bin",
  HOME: "/home/test",
  SOPS_AGE_KEY: "parent-should-not-reach-sops",
  GITHUB_TOKEN: "parent-should-not-reach-sops",
  OP_SERVICE_ACCOUNT_TOKEN: "parent-should-not-reach-sops",
};
const LIMITS = { ttlSeconds: 900, maxUses: 5 };

/** 버전 확인은 실제로 실행하고 복호화 호출만 실행 실패로 만든다 */
const failing: ProcessRunner = (request) =>
  request.argv.includes("decrypt")
    ? Promise.resolve(err({ kind: "spawn_failed", code: "ENOENT" }))
    : bunRunner(request);

type KeyUnavailableReason = Extract<SecretError, { kind: "key_unavailable" }>["reason"];

const dirs: TempDir[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => dir.remove()));
});

async function workdir(): Promise<TempDir> {
  const dir = await tempDir();
  dirs.push(dir);
  return dir;
}

function resolverFor(binary: string | null, runner: ProcessRunner = bunRunner): SopsResolver {
  return createSopsResolver({
    configured: () => binary,
    resolveBinary: () =>
      Promise.resolve(err({ kind: "not_found", name: "sops", searched: [], hint: "" })),
    runner,
    signal: new AbortController().signal,
    parentEnv: PARENT_ENV,
  });
}

function providerFor(options: {
  binary: string | null;
  key?: SopsKeyAccess;
  runner?: ProcessRunner;
  redactor?: ReturnType<typeof createRedactor>;
}) {
  const clock = manualClock();
  const runner = options.runner ?? bunRunner;
  const resolver = resolverFor(options.binary, runner);
  const key: SopsKeyAccess = options.key ?? {
    id: "file",
    env: { SOPS_AGE_KEY_FILE: "/fake/keys.txt" },
  };
  const logger = recordingLogger();
  const provider = createSopsProvider({
    files: () => [{ env: "dev", path: FIXTURE }],
    binary: () => resolver.resolve(),
    key: () => Promise.resolve(ok(key)),
    parentEnv: PARENT_ENV,
    runner,
    signal: new AbortController().signal,
    redactor: options.redactor ?? createRedactor(),
    clock,
    scheduler: clock,
    ids: fixedLocalIds(),
    logger,
  });
  return { provider, resolver, logger };
}

describe("sops binary resolution", () => {
  test("maps missing binary", async () => {
    const dir = await workdir();
    const missing = resolverFor(dir.join("no-such-sops"));
    expect(await missing.resolve()).toEqual({
      ok: false,
      error: { kind: "provider_unavailable", provider: "sops", reason: "binary_missing" },
    });
    expect(await missing.status()).toEqual({
      available: false,
      version: null,
      reason: "binary_missing",
    });

    const { provider } = providerFor({ binary: dir.join("no-such-sops") });
    const lease = await provider.lease("dev/GITHUB_TOKEN", httpCtx(), LIMITS);
    expect(lease).toEqual({
      ok: false,
      error: { kind: "provider_unavailable", provider: "sops", reason: "binary_missing" },
    });
  });

  test("maps old version", async () => {
    const expectations: readonly [string, boolean][] = [
      ["3.9.4", false],
      ["3.10.0", true],
      ["3.13.3", true],
      ["4.0.0", true],
    ];
    const results = await Promise.all(
      expectations.map(async ([version]) => {
        const sub = await workdir();
        const fake = await fakeSopsBinary(sub.path, { version });
        return resolverFor(fake.path).resolve();
      }),
    );
    for (const [index, resolved] of results.entries()) {
      expect(resolved.ok).toBe(expectations[index]?.[1] ?? false);
      if (!resolved.ok) {
        expect(resolved.error).toEqual({
          kind: "provider_unavailable",
          provider: "sops",
          reason: "version_too_old",
        });
      }
    }
  });

  test("reads the version with the update check turned off and a filtered env", async () => {
    const dir = await workdir();
    const fake = await fakeSopsBinary(dir.path, { version: "3.12.0" });
    const resolver = resolverFor(fake.path);
    expect(await resolver.status()).toEqual({ available: true, version: "3.12.0", reason: "ok" });
    await resolver.resolve();
    const calls = await fake.calls();
    expect(calls).toEqual([["--disable-version-check", "--version"]]);
  });

  test("resolves through xeon.os when no binary is configured", async () => {
    const resolver = createSopsResolver({
      configured: () => null,
      resolveBinary: (options) =>
        Promise.resolve(
          options.minVersion === "3.10.0"
            ? ok({ name: "sops", path: "/opt/sops", version: "3.13.3", source: "system" })
            : err({ kind: "not_found", name: "sops", searched: [], hint: "" }),
        ),
      runner: bunRunner,
      parentEnv: PARENT_ENV,
      signal: new AbortController().signal,
    });
    expect(await resolver.resolve()).toEqual({
      ok: true,
      value: { path: "/opt/sops", version: "3.13.3" },
    });

    const tooOld = createSopsResolver({
      configured: () => null,
      resolveBinary: () =>
        Promise.resolve(
          err({ kind: "version_too_old", name: "sops", found: "3.9.0", required: "3.10.0" }),
        ),
      runner: bunRunner,
      parentEnv: PARENT_ENV,
      signal: new AbortController().signal,
    });
    expect(await tooOld.status()).toEqual({
      available: false,
      version: null,
      reason: "version_too_old",
    });
  });
});

describe("sops lease", () => {
  test("extracts a value with a real child process and a filtered env", async () => {
    const dir = await workdir();
    const value = fakeValue(seededRandom(3), 24, true);
    const fake = await fakeSopsBinary(dir.path, { values: { GITHUB_TOKEN: value } });
    const { provider } = providerFor({ binary: fake.path });

    const leased = await provider.lease("dev/GITHUB_TOKEN", httpCtx(), LIMITS);
    expect(leased.ok).toBe(true);
    if (!leased.ok) return;
    expect(await leased.value.use((view) => view.text())).toEqual({ ok: true, value });
    expect(leased.value.usesLeft).toBe(4);

    const calls = await fake.calls();
    expect(calls).toHaveLength(2);
    expect(calls[1]).toEqual(["decrypt", "--extract", '["GITHUB_TOKEN"]', FIXTURE]);
    const envNames = await fake.lastEnvNames();
    expect(envNames).toContain("SOPS_AGE_KEY_FILE");
    expect(envNames.filter((n) => n.startsWith("SOPS_"))).toEqual(["SOPS_AGE_KEY_FILE"]);
    expect(envNames).not.toContain("GITHUB_TOKEN");
    expect(envNames).not.toContain("OP_SERVICE_ACCOUNT_TOKEN");
    expect(envNames).toContain("PATH");
    expect(JSON.stringify(calls)).not.toContain(value);
    leased.value.dispose();
  });

  test("extracts nested keys and keeps the value exactly (no trailing newline added)", async () => {
    const dir = await workdir();
    const fake = await fakeSopsBinary(dir.path, {
      values: { "nested.inner.deep_key": "line1\nline2" },
    });
    const { provider } = providerFor({ binary: fake.path });
    const leased = await provider.lease("dev/nested.inner.deep_key", httpCtx(), LIMITS);
    expect(leased.ok && (await leased.value.use((v) => v.text()))).toEqual({
      ok: true,
      value: "line1\nline2",
    });
    expect((await fake.calls())[1]).toEqual([
      "decrypt",
      "--extract",
      '["nested"]["inner"]["deep_key"]',
      FIXTURE,
    ]);
  });

  test("a key that is not in the file is secret_missing and sops is not run", async () => {
    const dir = await workdir();
    const fake = await fakeSopsBinary(dir.path, { values: {} });
    const { provider } = providerFor({ binary: fake.path });
    const refs = ["dev/NOT_THERE", "prod/GITHUB_TOKEN", "garbage", "dev/", "/KEY", "dev/bad.key"];
    const results = await Promise.all(refs.map((ref) => provider.lease(ref, httpCtx(), LIMITS)));
    for (const result of results) {
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.kind).toBe("secret_missing");
    }
    expect(await fake.calls()).toEqual([]);
  });

  test("maps locked keychain and decrypt failure", async () => {
    const dir = await workdir();
    const cases: readonly (readonly [KeyProviderIdPublic, string, KeyUnavailableReason])[] = [
      [
        "darwin-keychain",
        "security: The user name or passphrase you entered is not correct. Keychain is locked",
        "locked",
      ],
      ["darwin-keychain", "User canceled the operation", "access_denied"],
      ["linux-secret-service", "Access denied by the secret service", "access_denied"],
      [
        "linux-secret-service",
        "The specified item could not be found in the keychain.",
        "item_missing",
      ],
    ];
    const results = await Promise.all(
      cases.map(async ([keyId, stderr]) => {
        const sub = await workdir();
        const fake = await fakeSopsBinary(sub.path, { failure: { exitCode: 128, stderr } });
        const { provider } = providerFor({
          binary: fake.path,
          key: { id: keyId, env: { SOPS_AGE_KEY_CMD: "fake cmd" } },
        });
        return provider.lease("dev/GITHUB_TOKEN", httpCtx(), LIMITS);
      }),
    );
    for (const [index, result] of results.entries()) {
      const [keyId, , reason] = cases[index] ?? ["file", "", "locked"];
      expect(result).toEqual({ ok: false, error: { kind: "key_unavailable", key: keyId, reason } });
    }

    // 파일 폴백에는 잠금·승인 개념이 없으므로 같은 stderr도 decrypt_failed다
    const fake = await fakeSopsBinary(dir.path, {
      failure: { exitCode: 128, stderr: "Keychain is locked" },
    });
    const { provider } = providerFor({ binary: fake.path });
    const result = await provider.lease("dev/GITHUB_TOKEN", httpCtx(), LIMITS);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatchObject({ kind: "decrypt_failed", exitCode: 128 });
  });

  test("decrypt_failed masks stderr and keeps at most 500 characters", async () => {
    const dir = await workdir();
    const value = fakeValue(seededRandom(9), 24, true);
    const redactor = createRedactor();
    redactor.registerKnown(nameOf("github-token"), new TextEncoder().encode(value));
    const stderr = `Failed to decrypt. context: ${value} ${"x".repeat(900)}`;
    const fake = await fakeSopsBinary(dir.path, { failure: { exitCode: 2, stderr } });
    const { provider } = providerFor({ binary: fake.path, redactor });
    const result = await provider.lease("dev/GITHUB_TOKEN", httpCtx(), LIMITS);
    expect(result.ok).toBe(false);
    if (result.ok || result.error.kind !== "decrypt_failed") throw new Error("unexpected result");
    expect(result.error.stderrMasked.length).toBeLessThanOrEqual(500);
    expect(result.error.stderrMasked).toContain("[REDACTED:known:github-token]");
    for (const form of forms(value)) expect(JSON.stringify(result.error)).not.toContain(form.text);
  });

  test("a runner that cannot spawn the decrypt call is binary_missing", async () => {
    const dir = await workdir();
    const fake = await fakeSopsBinary(dir.path, { values: { GITHUB_TOKEN: "abcdefgh" } });
    const { provider } = providerFor({ binary: fake.path, runner: failing });
    expect(await provider.lease("dev/GITHUB_TOKEN", httpCtx(), LIMITS)).toEqual({
      ok: false,
      error: { kind: "provider_unavailable", provider: "sops", reason: "binary_missing" },
    });
  });

  test("an aborted service signal cancels the decrypt call and the runner kills the child", async () => {
    const dir = await workdir();
    const fake = await fakeSopsBinary(dir.path, { values: { GITHUB_TOKEN: "abcdefgh" } });
    const controller = new AbortController();
    controller.abort();
    const aborted = await bunRunner({
      argv: [fake.path, "--version"],
      env: {},
      timeoutMs: 5000,
      signal: controller.signal,
    });
    expect(aborted).toEqual({ ok: false, error: { kind: "cancelled" } });
  });

  test("a key access error is returned as is and sops is not run for decryption", async () => {
    const dir = await workdir();
    const fake = await fakeSopsBinary(dir.path, { values: { GITHUB_TOKEN: "abcdefgh" } });
    const clock = manualClock();
    const resolver = resolverFor(fake.path);
    const provider = createSopsProvider({
      files: () => [{ env: "dev", path: FIXTURE }],
      binary: () => resolver.resolve(),
      key: () =>
        Promise.resolve(
          err({ kind: "key_unavailable", key: "file", reason: "file_mode" } as const),
        ),
      parentEnv: PARENT_ENV,
      signal: new AbortController().signal,
      runner: bunRunner,
      redactor: createRedactor(),
      clock,
      scheduler: clock,
      ids: fixedLocalIds(),
      logger: recordingLogger(),
    });
    expect(await provider.lease("dev/GITHUB_TOKEN", httpCtx(), LIMITS)).toEqual({
      ok: false,
      error: { kind: "key_unavailable", key: "file", reason: "file_mode" },
    });
    expect((await fake.calls()).filter((c) => c.includes("decrypt"))).toEqual([]);
  });
});

describe("sops list", () => {
  test("lists entries from the files without running sops", async () => {
    const dir = await workdir();
    const fake = await fakeSopsBinary(dir.path, {});
    const { provider, logger } = providerFor({ binary: fake.path });
    const listed = await provider.list();
    expect(listed.ok && listed.value.map((e) => e.ref)).toEqual([
      "dev/GITHUB_TOKEN",
      "dev/nested.inner.deep_key",
    ]);
    expect(listed.ok && listed.value[0]?.updatedAt).toBe(Date.parse("2026-01-04T10:00:00Z"));
    expect(await fake.calls()).toEqual([]);
    expect(logger.lines).toEqual([]);
    // put은 refreshCapabilities가 `set --value-stdin` 지원을 확인한 뒤에만 켜진다. remove(`sops unset`)는 값을 받지 않는다
    expect(provider.capabilities()).toEqual({
      list: true,
      put: false,
      remove: true,
      usage: false,
    });
  });

  test("unreadable and unparseable files are skipped with a warning that has no content", async () => {
    const dir = await workdir();
    const bad = dir.join("broken.sops.json");
    await Bun.write(bad, "{ not json hunter2hunter2");
    const clock = manualClock();
    const logger = recordingLogger();
    const provider = createSopsProvider({
      files: () => [
        // 없는 파일(ENOENT)은 경고가 아니다: 기본 파일은 첫 쓰기 전에 없다
        { env: "gone", path: dir.join("missing.sops.yaml") },
        // 읽을 수 없는 파일(디렉터리를 파일 자리에 둔다)은 경고한다
        { env: "unreadable", path: dir.path },
        { env: "broken", path: bad },
        { env: "dev", path: FIXTURE },
      ],
      binary: () =>
        Promise.resolve(
          err({
            kind: "provider_unavailable",
            provider: "sops",
            reason: "binary_missing",
          } as const),
        ),
      key: () => Promise.resolve(ok({ id: "file", env: {} } as const)),
      parentEnv: {},
      runner: bunRunner,
      signal: new AbortController().signal,
      redactor: createRedactor(),
      clock,
      scheduler: clock,
      ids: fixedLocalIds(),
      logger,
    });
    const listed = await provider.list();
    expect(listed.ok && listed.value).toHaveLength(2);
    // 파일은 동시에 읽어서 경고 순서는 정해지지 않는다. 없는 파일(ENOENT)은 경고가 없다
    expect(logger.lines.map((l) => l.event).toSorted()).toEqual([
      "secrets.sops.file_unparseable",
      "secrets.sops.file_unreadable",
    ]);
    expect(JSON.stringify(logger.lines)).not.toContain("hunter2hunter2");
  });
});
