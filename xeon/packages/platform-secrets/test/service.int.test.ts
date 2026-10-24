import { afterEach, describe, expect, test } from "bun:test";
import { chmod, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { SecretAuditRecord } from "@xeon/contracts/capabilities";
import { createSecretService } from "../src/assemble.ts";
import { DEFAULT_SECRETS_CONFIG, type SecretsConfig } from "../src/config.ts";
import { fakeSopsBinary, type FakeSops } from "../src/testing/index.ts";
import { manualClock } from "./support/clock.ts";
import { envCtx, httpCtx } from "./support/ctx.ts";
import { forms } from "./support/encode.ts";
import { fixedLocalIds } from "./support/ids.ts";
import { rawMeta, type MetaInput } from "./support/meta.ts";
import { handleOf } from "./support/names.ts";
import {
  fakeOs,
  recordingLogger,
  tempDir,
  type RecordingLogger,
  type TempDir,
} from "./support/os.ts";
import { fakeValue, seededRandom } from "./support/random.ts";

const FIXTURE = join(import.meta.dir, "fixtures", "sample.sops.yaml");
const HANDLE = handleOf("github-token");
const PARENT_ENV = {
  PATH: "/usr/bin:/bin",
  HOME: "/home/test",
  SOPS_AGE_KEY: "parent-should-not-reach-sops",
  GITHUB_TOKEN: "parent-should-not-reach-sops",
};

const dirs: TempDir[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => dir.remove()));
});

interface Harness {
  readonly service: ReturnType<typeof createSecretService>;
  readonly fake: FakeSops;
  readonly value: string;
  readonly records: SecretAuditRecord[];
  readonly logger: RecordingLogger;
  readonly config: string;
  readonly dir: TempDir;
}

async function writeMeta(config: string, input: MetaInput): Promise<void> {
  const metaDir = join(config, "secrets", "meta");
  await mkdir(metaDir, { recursive: true });
  const name = input.name ?? "github-token";
  await writeFile(join(metaDir, `${name}.yaml`), JSON.stringify(rawMeta(input)));
}

async function harness(
  options: {
    meta?: readonly MetaInput[];
    config?: (keyFile: string, binary: string) => SecretsConfig;
    fakeOptions?: Parameters<typeof fakeSopsBinary>[1];
    keyMode?: number;
  } = {},
): Promise<Harness> {
  const dir = await tempDir();
  dirs.push(dir);
  const value = fakeValue(seededRandom(555), 24, true);
  const fake = await fakeSopsBinary(dir.path, {
    values: { GITHUB_TOKEN: value },
    ...options.fakeOptions,
  });
  const config = dir.join("config");
  const metas: readonly MetaInput[] = options.meta ?? [
    {
      modes: ["env", "runtime-http"],
      tools: ["bash:gh", "http.request"],
      commands: ["gh api *"],
      hosts: ["api.example.test"],
    },
  ];
  await Promise.all(metas.map((input) => writeMeta(config, input)));
  const keyFile = dir.join("keys.txt");
  await writeFile(keyFile, "placeholder, not a key\n");
  await chmod(keyFile, options.keyMode ?? 0o600);
  const clock = manualClock();
  const logger = recordingLogger();
  const cfg =
    options.config?.(keyFile, fake.path) ??
    ({
      ...DEFAULT_SECRETS_CONFIG,
      sops: { files: [{ env: "dev", path: FIXTURE }], binary: fake.path },
      ageKey: { source: "file", filePath: keyFile },
    } satisfies SecretsConfig);
  const service = createSecretService({
    os: fakeOs({ config, clock, logger }),
    ids: fixedLocalIds(),
    config: () => cfg,
    env: PARENT_ENV,
  });
  const records: SecretAuditRecord[] = [];
  service.onAudit((record) => records.push(record));
  return { service, fake, value, records, logger, config, dir };
}

describe("createSecretService with the SOPS provider", () => {
  test("list does not call sops", async () => {
    const h = await harness({
      meta: [
        { modes: ["env"], ref: "dev/GITHUB_TOKEN" },
        { name: "gone-token", ref: "dev/NOT_THERE" },
      ],
    });
    const listed = await h.service.list();
    expect(listed.ok).toBe(true);
    if (!listed.ok) return;
    const view = listed.value.map((l) => [l.handle, l.entry?.ref ?? null, l.status] as const);
    expect(view).toEqual([
      [HANDLE, "dev/GITHUB_TOKEN", "valid"],
      [handleOf("gone-token"), null, "missing"],
      [null, "dev/nested.inner.deep_key", "orphaned"],
    ]);
    expect(await h.fake.calls()).toEqual([]);
    const resolved = await h.service.resolve(HANDLE);
    expect(resolved.ok && resolved.value.status).toBe("valid");
    expect(await h.fake.calls()).toEqual([]);
  });

  test("withEnv injects the value through a real child process without printing it", async () => {
    const h = await harness();
    const lease = await h.service.withEnv(HANDLE, envCtx("gh api user"));
    expect(lease.ok).toBe(true);
    if (!lease.ok) return;
    const expectedLength = h.value.length;
    // 시험 명령은 받은 env 값의 길이만 출력한다
    const reported = await lease.value.use(async (view) => {
      const proc = Bun.spawn(["sh", "-c", 'printf "%s" "${#SECRET_UNDER_TEST}"'], {
        env: { PATH: PARENT_ENV.PATH, SECRET_UNDER_TEST: view.text() },
        stdout: "pipe",
        stderr: "pipe",
      });
      return new Response(proc.stdout).text();
    });
    expect(reported).toEqual({ ok: true, value: String(expectedLength) });

    const types = h.records.map((r) => r.type);
    expect(types).toEqual(["secret.approved", "secret.used"]);
    for (const form of forms(h.value)) {
      expect(JSON.stringify(h.records)).not.toContain(form.text);
      expect(JSON.stringify(h.logger.lines)).not.toContain(form.text);
    }
    const calls = await h.fake.calls();
    expect(calls.map((c) => c[0])).toEqual(["--disable-version-check", "decrypt"]);
    expect(h.service.redactor.containsKnown(h.value)).toBe(true);
  });

  test("a denied approval leaves sops untouched", async () => {
    const h = await harness();
    const denied = await h.service.withEnv(HANDLE, envCtx("gh api user", { approval: null }));
    expect(denied.ok).toBe(false);
    if (!denied.ok)
      expect(denied.error).toMatchObject({ kind: "denied", reason: "approval_missing" });
    const outside = await h.service.withEnv(HANDLE, envCtx("curl https://example.test"));
    expect(outside.ok).toBe(false);
    if (!outside.ok) expect(outside.error).toMatchObject({ reason: "command_mismatch" });
    expect(await h.fake.calls()).toEqual([]);
    expect(h.records.map((r) => (r.type === "secret.denied" ? r.reason : r.type))).toEqual([
      "approval_missing",
      "command_mismatch",
    ]);
  });

  test("withHttp substitutes a decrypted value and scrubs an echoed response", async () => {
    const h = await harness();
    const sent: string[] = [];
    const result = await h.service.withHttp(
      {
        method: "GET",
        url: "https://api.example.test/echo",
        headers: { Authorization: "Bearer secret://github-token" },
        body: null,
      },
      {
        purpose: "http.request",
        actor: "runtime",
        threadId: "thr_test",
        toolCallId: "c1",
        projectId: null,
        approval: null,
      },
      (request) => {
        sent.push(request.headers["Authorization"] ?? "");
        return Promise.resolve({ status: 200, headers: {}, bodyText: `echo ${h.value}` });
      },
    );
    expect(result.ok && result.value.echoed).toBe(true);
    expect(sent).toEqual([`Bearer ${h.value}`]);
    expect(h.records.map((r) => r.type)).toEqual(["secret.used", "secret.masked"]);
  });

  test("an unconfirmed file fallback blocks leases until the source is set to file", async () => {
    const h = await harness({
      config: (keyFile, binary) => ({
        ...DEFAULT_SECRETS_CONFIG,
        sops: { files: [{ env: "dev", path: FIXTURE }], binary },
        ageKey: { source: "auto", filePath: keyFile },
      }),
    });
    const lease = await h.service.withEnv(HANDLE, envCtx("gh api user"));
    expect(lease.ok).toBe(false);
    if (!lease.ok) {
      expect(lease.error).toEqual({
        kind: "key_unavailable",
        key: "file",
        reason: "access_denied",
      });
    }
    const diag = await h.service.diagnose();
    expect(diag.key).toEqual({ source: "file", available: false, reason: "no_secret_service" });
    expect(diag.fileFallbackNotice).toBe(true);
    expect(diag.hints.join("\n")).toContain("ageKey.source");
  });

  test("a key file that others can read blocks leases with file_mode", async () => {
    const h = await harness({ keyMode: 0o644 });
    const lease = await h.service.withEnv(HANDLE, envCtx("gh api user"));
    expect(lease.ok).toBe(false);
    if (!lease.ok) {
      expect(lease.error).toEqual({ kind: "key_unavailable", key: "file", reason: "file_mode" });
    }
    expect((await h.fake.calls()).filter((c) => c.includes("decrypt"))).toEqual([]);
  });

  test("an invalid meta file does not block other secrets", async () => {
    const h = await harness();
    await writeFile(join(h.config, "secrets", "meta", "broken-one.yaml"), "name: [oops\n");
    const listed = await h.service.list();
    expect(listed.ok && listed.value.some((l) => l.handle === HANDLE)).toBe(true);
    expect(h.logger.lines.some((l) => l.event === "secrets.meta.invalid")).toBe(true);
    const broken = await h.service.lease(handleOf("broken-one"), httpCtx());
    expect(broken.ok).toBe(false);
    if (!broken.ok) expect(broken.error.kind).toBe("meta_invalid");
    expect((await h.service.lease(HANDLE, httpCtx())).ok).toBe(true);
  });

  test("the registered service carries no human-only or admin methods", async () => {
    const h = await harness();
    for (const name of [
      "leaseAsHuman",
      "recordAdmin",
      "providerFor",
      "revokeLeases",
      "activeLeaseCount",
    ]) {
      expect(name in h.service).toBe(false);
    }
  });

  test("ignores project-scoped meta locations", async () => {
    const h = await harness();
    const project = h.dir.join("project");
    const projectMeta = join(project, "secrets", "meta");
    await mkdir(projectMeta, { recursive: true });
    await writeFile(
      join(projectMeta, "repo-token.yaml"),
      JSON.stringify(rawMeta({ name: "repo-token" })),
    );
    const previous = process.cwd();
    process.chdir(project);
    try {
      const resolved = await h.service.resolve(handleOf("repo-token"));
      expect(resolved.ok).toBe(false);
      if (!resolved.ok) expect(resolved.error.kind).toBe("secret_missing");
    } finally {
      process.chdir(previous);
    }
  });

  test("protectedPaths and diagnose report paths and states without values", async () => {
    const h = await harness();
    const paths = h.service.protectedPaths();
    expect(paths).toContain(FIXTURE);
    expect(paths).toContain(join(h.config, "secrets"));
    expect(paths).toContain(h.dir.join("keys.txt"));
    const diag = await h.service.diagnose();
    expect(diag.hints.slice(0, 2)).toEqual([
      "just secret-add <키> [env]",
      "xeon secret add <name>",
    ]);
    expect(diag.sops).toEqual({ available: true, version: "3.13.3", reason: "ok" });
    expect(diag.key).toEqual({ source: "file", available: true, reason: "ok" });
    expect(diag.fileFallbackNotice).toBe(true);
    expect(diag.providers).toEqual([{ id: "sops", registered: true, entries: 2 }]);
    expect(diag.orphaned).toBe(1);
    expect(diag.missing).toBe(0);
    expect(JSON.stringify(diag)).not.toContain(h.value);
  });

  test("diagnose explains a missing sops binary", async () => {
    const h = await harness({
      config: (keyFile) => ({
        ...DEFAULT_SECRETS_CONFIG,
        sops: {
          files: [{ env: "dev", path: FIXTURE }],
          binary: join(keyFile, "..", "absent-sops"),
        },
        ageKey: { source: "file", filePath: keyFile },
      }),
    });
    const diag = await h.service.diagnose();
    expect(diag.sops).toEqual({ available: false, version: null, reason: "binary_missing" });
    expect(diag.hints.some((line) => line.includes("sops"))).toBe(true);
    const lease = await h.service.withEnv(HANDLE, envCtx("gh api user"));
    expect(lease.ok).toBe(false);
    if (!lease.ok) {
      expect(lease.error).toEqual({
        kind: "provider_unavailable",
        provider: "sops",
        reason: "binary_missing",
      });
    }
  });

  test("lease of a meta whose key is gone from the sops file is secret_missing for the real handle", async () => {
    const h = await harness({
      meta: [{ name: "gone-token", ref: "dev/NOT_THERE", modes: ["runtime-http"] }],
    });
    const result = await h.service.lease(handleOf("gone-token"), httpCtx());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toEqual({
        kind: "secret_missing",
        handle: handleOf("gone-token"),
        where: "provider",
      });
    }
  });
});
