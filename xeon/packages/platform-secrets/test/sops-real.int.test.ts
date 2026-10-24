import { afterEach, describe, expect, test } from "bun:test";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { createLinuxKeyProvider } from "../src/key/linux.ts";
import {
  bunRunner,
  jsonStringBytes,
  type ProcessRunner,
  type RunRequest,
} from "../src/providers/sops.ts";
import { httpCtx } from "./support/ctx.ts";
import { realProvider, realSopsFixture, REAL_SOPS } from "./support/real-sops.ts";
import { tempDir, type TempDir } from "./support/os.ts";

// plan SC-18(sops put·remove), SC-19(Linux 키 명령). 실제 sops 3.13과 일회용 age 키를 쓴다. 바이너리가 없으면 건너뛴다.
// 값 비교는 불리언으로만 하고 실패 메시지에 값이 찍히지 않게 한다.

const LIMITS = { ttlSeconds: 60, maxUses: 3 };
const real = REAL_SOPS !== null;

const dirs: TempDir[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => dir.remove()));
});

async function workdir(): Promise<TempDir> {
  const dir = await tempDir();
  dirs.push(dir);
  return dir;
}

/** 값을 lease로 열어 기대한 바이트와 같은지만 돌려준다 */
async function leaseEquals(
  provider: ReturnType<typeof realProvider>,
  ref: string,
  expected: Uint8Array,
): Promise<boolean> {
  const opened = await provider.lease(ref, httpCtx(), LIMITS);
  if (!opened.ok) return false;
  try {
    const same = await opened.value.use((view) =>
      Buffer.from(view.bytes).equals(Buffer.from(expected)),
    );
    return same.ok && same.value;
  } finally {
    opened.value.dispose();
  }
}

const encode = (text: string): Uint8Array => new TextEncoder().encode(text);

const decodeJson = (bytes: Uint8Array): unknown => JSON.parse(new TextDecoder().decode(bytes));

describe("jsonStringBytes", () => {
  test("escapes quotes, backslashes and control characters and keeps UTF-8 bytes", () => {
    for (const text of ['a"b', "a\\b", "line1\nline2\ttab", "한글 값 ✓", "\u0001\u001f", "plain"]) {
      expect(decodeJson(jsonStringBytes(encode(text))) === text).toBe(true);
    }
  });
});

describe.skipIf(!real)("sops put and remove with the real binary (SC-18)", () => {
  const sops = REAL_SOPS ?? "";

  const tricky = [
    'quote " and \\ backslash',
    "multi\nline\ttab value",
    "한글 값 ✓ 12345",
    "plain-fake-value-0002",
  ];
  for (const [index, text] of tricky.entries()) {
    test(`put round-trips byte for byte (case ${index})`, async () => {
      const dir = await workdir();
      const fx = await realSopsFixture(dir, sops, { EXISTING_KEY: "existing-fake-value-0001" });
      const provider = realProvider(fx);
      expect((await provider.refreshCapabilities()).put).toBe(true);
      expect((await provider.put?.("dev/NEW_KEY", encode(text)))?.ok).toBe(true);
      expect(await leaseEquals(provider, "dev/NEW_KEY", encode(text))).toBe(true);
      // 같은 키를 다른 값으로 바꾸면 새 값만 남는다
      expect((await provider.put?.("dev/NEW_KEY", encode("replacement-fake-0003")))?.ok).toBe(true);
      expect(await leaseEquals(provider, "dev/NEW_KEY", encode("replacement-fake-0003"))).toBe(
        true,
      );
      // 다른 키는 그대로이고 파일에는 평문 값이 없다
      expect(
        await leaseEquals(provider, "dev/EXISTING_KEY", encode("existing-fake-value-0001")),
      ).toBe(true);
      const file = await readFile(fx.yaml, "utf8");
      expect(
        file.includes("replacement-fake-0003") || file.includes("existing-fake-value-0001"),
      ).toBe(false);
      const listed = await provider.list();
      expect(listed.ok && listed.value.map((e) => e.ref)).toEqual([
        "dev/EXISTING_KEY",
        "dev/NEW_KEY",
      ]);
    });
  }

  test("the value reaches sops through stdin only and the stdin buffer is zeroed afterwards", async () => {
    const dir = await workdir();
    const fx = await realSopsFixture(dir, sops, { EXISTING_KEY: "existing-fake-value-0001" });
    const requests: RunRequest[] = [];
    const recording: ProcessRunner = (request) => {
      requests.push(request);
      return bunRunner(request);
    };
    const provider = realProvider(fx, { runner: recording });
    const text = "argv-must-not-see-this-0003";
    expect((await provider.put?.("dev/NEW_KEY", encode(text)))?.ok).toBe(true);
    const put = requests.find((r) => r.argv.includes("--value-stdin"));
    expect(put).toBeDefined();
    expect(put?.argv.some((arg) => arg.includes(text))).toBe(false);
    expect(Object.values(put?.env ?? {}).some((value) => value.includes(text))).toBe(false);
    expect(put?.stdin !== undefined && put.stdin.every((byte) => byte === 0)).toBe(true);
  });

  test("put reports read_only_provider when the binary lacks --value-stdin", async () => {
    const dir = await workdir();
    const fx = await realSopsFixture(dir, sops, { EXISTING_KEY: "existing-fake-value-0001" });
    const oldSops: ProcessRunner = (request) => {
      if (request.argv.includes("--help")) {
        return Promise.resolve({
          ok: true as const,
          value: { exitCode: 0, stdout: encode("usage: sops set file index value"), stderr: "" },
        });
      }
      return bunRunner(request);
    };
    const provider = realProvider(fx, { runner: oldSops });
    expect((await provider.refreshCapabilities()).put).toBe(false);
    expect(await provider.put?.("dev/NEW_KEY", encode("value-not-written-0004"))).toEqual({
      ok: false,
      error: { kind: "read_only_provider", provider: "sops" },
    });
    expect(provider.capabilities().put).toBe(false);
  });

  test("put and remove reject unknown environments and missing keys", async () => {
    const dir = await workdir();
    const fx = await realSopsFixture(dir, sops, { EXISTING_KEY: "existing-fake-value-0001" });
    const provider = realProvider(fx);
    const unknownEnv = await provider.put?.("prod/NEW_KEY", encode("value-not-written-0005"));
    expect(unknownEnv?.ok === false && unknownEnv.error.kind).toBe("secret_missing");
    const missing = await provider.remove?.("dev/NOT_THERE");
    expect(missing?.ok === false && missing.error.kind).toBe("secret_missing");
  });

  test("remove deletes only the named key", async () => {
    const dir = await workdir();
    const fx = await realSopsFixture(dir, sops, {
      KEEP_KEY: "keep-fake-value-0006",
      DROP_KEY: "drop-fake-value-0007",
    });
    const provider = realProvider(fx);
    expect((await provider.remove?.("dev/DROP_KEY"))?.ok).toBe(true);
    const listed = await provider.list();
    expect(listed.ok && listed.value.map((e) => e.ref)).toEqual(["dev/KEEP_KEY"]);
    expect(await leaseEquals(provider, "dev/KEEP_KEY", encode("keep-fake-value-0006"))).toBe(true);
    const gone = await provider.lease("dev/DROP_KEY", httpCtx(), LIMITS);
    expect(gone.ok).toBe(false);
  });

  test("a wrong key fails with decrypt_failed and the masked stderr carries no value", async () => {
    const dir = await workdir();
    const fx = await realSopsFixture(dir, sops, { EXISTING_KEY: "existing-fake-value-0001" });
    const other = await realSopsFixture(await workdir(), sops, { X: "other-fake-value-0008" });
    const provider = realProvider(fx, {
      key: { id: "file", env: { SOPS_AGE_KEY_FILE: other.keyFile } },
    });
    const result = await provider.put?.("dev/NEW_KEY", encode("value-not-written-0009"));
    expect(result?.ok).toBe(false);
    if (result !== undefined && !result.ok) {
      expect(result.error.kind).toBe("decrypt_failed");
      expect(JSON.stringify(result.error).includes("value-not-written-0009")).toBe(false);
    }
  });
});

describe.skipIf(!real)("Linux Secret Service key command with the real sops (SC-05, SC-19)", () => {
  const sops = REAL_SOPS ?? "";

  test("SOPS_AGE_KEY_CMD built for secret-tool decrypts through a path with spaces and quotes", async () => {
    const dir = await workdir();
    const fx = await realSopsFixture(dir, sops, { GITHUB_TOKEN: "linux-key-cmd-fake-value-10" });
    // secret-tool 대역: 인자를 기록하고 identity를 출력한다. 진짜 Secret Service는 이 기기에 없다
    const toolDir = dir.join("fake bin's dir");
    await mkdir(toolDir, { recursive: true });
    const tool = `${toolDir}/secret-tool`;
    const argsFile = dir.join("secret-tool.args");
    await writeFile(tool, `#!/bin/sh\nprintf '%s\\n' "$*" > '${argsFile}'\ncat '${fx.keyFile}'\n`);
    await chmod(tool, 0o755);

    const keys = createLinuxKeyProvider({
      secretToolPath: tool,
      isWsl: false,
      env: { DBUS_SESSION_BUS_ADDRESS: "unix:path=/nonexistent" },
      pathExists: () => false,
    });
    expect(await keys.probe()).toEqual({ available: true, reason: "ok" });
    const env = keys.sopsKeyEnv();
    expect(env.ok).toBe(true);
    if (!env.ok) return;
    const command = env.value["SOPS_AGE_KEY_CMD"];
    expect(command).toBeDefined();

    const provider = realProvider(fx, {
      key: { id: "linux-secret-service", env: { SOPS_AGE_KEY_CMD: command ?? "" } },
    });
    expect(
      await leaseEquals(provider, "dev/GITHUB_TOKEN", encode("linux-key-cmd-fake-value-10")),
    ).toBe(true);
    expect((await readFile(argsFile, "utf8")).trim()).toBe(
      "lookup service xeon.age account default",
    );
  });

  test("a key command that fails maps to a typed error instead of a value", async () => {
    const dir = await workdir();
    const fx = await realSopsFixture(dir, sops, { GITHUB_TOKEN: "linux-key-cmd-fake-value-11" });
    const tool = dir.join("failing-tool");
    await writeFile(tool, `#!/bin/sh\necho "collection is locked" >&2\nexit 1\n`);
    await chmod(tool, 0o755);
    const keys = createLinuxKeyProvider({
      secretToolPath: tool,
      isWsl: false,
      env: { DBUS_SESSION_BUS_ADDRESS: "unix:path=/nonexistent" },
      pathExists: () => false,
    });
    const env = keys.sopsKeyEnv();
    if (!env.ok) throw new Error("setup failed");
    const provider = realProvider(fx, {
      key: {
        id: "linux-secret-service",
        env: { SOPS_AGE_KEY_CMD: env.value["SOPS_AGE_KEY_CMD"] ?? "" },
      },
    });
    const result = await provider.lease("dev/GITHUB_TOKEN", httpCtx(), LIMITS);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(["key_unavailable", "decrypt_failed"]).toContain(result.error.kind);
    }
  });
});
