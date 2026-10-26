import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import {
  DEFAULT_SECRETS_CONFIG,
  defaultSopsFile,
  DEFAULT_SOPS_ENV,
  withDefaultSopsFile,
} from "../src/config.ts";
import { computeProtectedPaths } from "../src/protected-paths.ts";
import { createProcessLock } from "../src/providers/lock.ts";
import { formatOfPath } from "../src/providers/sops-keys.ts";

// spec §4.8: 설정에 SOPS 파일이 없으면 사용자 기본 파일을 쓴다. 위치는 사용자 하나에 하나인 config 디렉터리 아래다.

const CONFIG = "/home/u/.config/xeon";

describe("default SOPS file", () => {
  test("is env user at <config>/secrets/sops/user.yaml, a yaml file", () => {
    expect(defaultSopsFile(CONFIG)).toEqual({
      env: "user",
      path: join(CONFIG, "secrets", "sops", "user.yaml"),
    });
    expect(DEFAULT_SOPS_ENV).toBe("user");
    expect(formatOfPath(defaultSopsFile(CONFIG).path)).toBe("yaml");
  });

  test("fills an empty files list and leaves a configured list alone", () => {
    expect(withDefaultSopsFile(DEFAULT_SECRETS_CONFIG, CONFIG).sops.files).toEqual([
      defaultSopsFile(CONFIG),
    ]);
    const mine = { env: "dev", path: "/x/dev.sops.yaml" };
    const configured = { ...DEFAULT_SECRETS_CONFIG, sops: { files: [mine], binary: null } };
    expect(withDefaultSopsFile(configured, CONFIG)).toBe(configured);
    // 기본 파일을 섞지 않는다
    expect(withDefaultSopsFile(configured, CONFIG).sops.files).toEqual([mine]);
  });

  test("keeps the other settings and the binary override", () => {
    const base = { ...DEFAULT_SECRETS_CONFIG, sops: { files: [], binary: "/opt/sops" } };
    const filled = withDefaultSopsFile(base, CONFIG);
    expect(filled.sops.binary).toBe("/opt/sops");
    expect(filled.lease).toEqual(base.lease);
  });

  test("the sandbox protected paths cover the default file", () => {
    const filled = withDefaultSopsFile(DEFAULT_SECRETS_CONFIG, CONFIG);
    const protectedPaths = computeProtectedPaths({
      files: filled.sops.files,
      configDir: CONFIG,
      ageKeyFilePath: null,
    });
    expect(protectedPaths).toContain(defaultSopsFile(CONFIG).path);
    expect(protectedPaths).toContain(join(CONFIG, "secrets"));
  });
});

describe("process lock", () => {
  test("runs work on one path one after another, even across lock objects", async () => {
    const events: string[] = [];
    const slow = async (label: string, ms: number): Promise<string> => {
      events.push(`start ${label}`);
      await new Promise((resolve) => setTimeout(resolve, ms));
      events.push(`end ${label}`);
      return label;
    };
    const [a, b, other] = await Promise.all([
      createProcessLock().withLock("/p/a.yaml", () => slow("a", 20)),
      createProcessLock().withLock("/p/a.yaml", () => slow("b", 1)),
      createProcessLock().withLock("/p/other.yaml", () => slow("other", 1)),
    ]);
    expect([a, b, other]).toEqual([
      { ok: true, value: "a" },
      { ok: true, value: "b" },
      { ok: true, value: "other" },
    ]);
    // 같은 경로는 겹치지 않는다
    expect(events.indexOf("end a")).toBeLessThan(events.indexOf("start b"));
  });

  test("a failing task does not block the next one", async () => {
    const lock = createProcessLock();
    const first = lock
      .withLock("/p/b.yaml", async (): Promise<string> => {
        await Promise.resolve();
        throw new Error("boom");
      })
      .then(
        () => "resolved",
        (caught: unknown) => (caught instanceof Error ? caught.message : "other"),
      );
    const second = lock.withLock("/p/b.yaml", () => Promise.resolve("after"));
    expect(await first).toBe("boom");
    expect(await second).toEqual({ ok: true, value: "after" });
  });
});
