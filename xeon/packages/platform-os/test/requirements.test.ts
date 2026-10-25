import { describe, expect, test } from "bun:test";
import { err, ok, type Result } from "@xeon/contracts";
import type { BinaryError, BinaryName, ResolvedBinary } from "@xeon/contracts/services";
import {
  binaryRequirements,
  checkExternalBinaries,
  type BinaryCheckDeps,
} from "../src/binaries/requirements.ts";
import { createOsService } from "../src/service.ts";
import { fakeRuntime } from "./support/runtime.ts";

const signal = new AbortController().signal;

function needs(platform: "darwin" | "linux" | "win32"): Record<string, string> {
  return Object.fromEntries(binaryRequirements(platform).map((row) => [row.name, row.need]));
}

describe("binaryRequirements", () => {
  test("OS마다 필수·선택·미사용이 다르다", () => {
    expect(needs("darwin")).toEqual({
      rg: "required",
      sops: "required",
      age: "required",
      git: "optional",
      bwrap: "not_used",
      socat: "not_used",
      security: "required",
      "secret-tool": "not_used",
    });
    expect(needs("linux")).toEqual({
      rg: "required",
      sops: "required",
      age: "required",
      git: "optional",
      bwrap: "required",
      socat: "required",
      security: "not_used",
      "secret-tool": "optional",
    });
    expect(needs("win32")).toEqual({
      rg: "required",
      sops: "required",
      age: "required",
      git: "optional",
      bwrap: "not_used",
      socat: "not_used",
      security: "not_used",
      "secret-tool": "not_used",
    });
  });

  test("표가 BinaryName 8개를 모두 한 번씩 다룬다", () => {
    const expected: BinaryName[] = [
      "rg",
      "sops",
      "age",
      "git",
      "bwrap",
      "socat",
      "security",
      "secret-tool",
    ];
    for (const platform of ["darwin", "linux", "win32"] as const) {
      expect(binaryRequirements(platform).map((row) => row.name)).toEqual(expected);
    }
  });

  test("최소 버전은 소비 패키지의 상수와 같다", () => {
    const versions = Object.fromEntries(
      binaryRequirements("linux").map((row) => [row.name, row.minVersion]),
    );
    expect(versions["sops"]).toBe("3.10.0");
    expect(versions["bwrap"]).toBe("0.4.0");
    expect(versions["socat"]).toBeUndefined();
  });
});

type Answer = Result<ResolvedBinary, BinaryError>;

function found(name: BinaryName, version = "1.0.0"): Answer {
  return ok({ name, path: `/usr/bin/${name}`, version, source: "system" });
}

function deps(platform: BinaryCheckDeps["platform"], answers: Partial<Record<BinaryName, Answer>>) {
  const asked: { name: BinaryName; minVersion: string | undefined }[] = [];
  const value: BinaryCheckDeps = {
    platform,
    resolveBinary: (name, opts) => {
      asked.push({ name, minVersion: opts.minVersion });
      return Promise.resolve(answers[name] ?? found(name));
    },
  };
  return { value, asked };
}

describe("checkExternalBinaries", () => {
  test("모두 있으면 ready이고 사용하지 않는 바이너리는 묻지 않는다", async () => {
    const { value, asked } = deps("darwin", {});
    const report = await checkExternalBinaries(value, signal);
    expect(report.ok).toBe(true);
    if (!report.ok) return;
    expect(report.value.ready).toBe(true);
    expect(report.value.blocking).toEqual([]);
    expect(report.value.degraded).toEqual([]);
    expect(report.value.items.map((item) => item.name)).toEqual([
      "rg",
      "sops",
      "age",
      "git",
      "security",
    ]);
    expect(asked.map((entry) => entry.name)).not.toContain("bwrap");
    expect(asked.find((entry) => entry.name === "sops")?.minVersion).toBe("3.10.0");
  });

  test("Linux에서 socat이 없으면 필수 누락이라 ready가 아니고 안내 문구를 싣는다", async () => {
    const hint = "socat 패키지를 설치한다 (예: apt install socat)";
    const { value } = deps("linux", {
      socat: err({ kind: "not_found", name: "socat", searched: ["/usr/bin"], hint }),
    });
    const report = await checkExternalBinaries(value, signal);
    if (!report.ok) throw new Error("unexpected cancel");
    expect(report.value.ready).toBe(false);
    expect(report.value.blocking).toEqual(["socat"]);
    const socat = report.value.items.find((item) => item.name === "socat");
    expect(socat?.status).toEqual({ kind: "missing", hint });
    expect(socat?.need).toBe("required");
  });

  test("선택 바이너리 누락은 degraded이고 ready를 막지 않는다", async () => {
    const { value } = deps("linux", {
      "secret-tool": err({ kind: "not_found", name: "secret-tool", searched: [], hint: "h" }),
      git: err({ kind: "not_found", name: "git", searched: [], hint: "g" }),
    });
    const report = await checkExternalBinaries(value, signal);
    if (!report.ok) throw new Error("unexpected cancel");
    expect(report.value.ready).toBe(true);
    expect(report.value.degraded).toEqual(["git", "secret-tool"]);
  });

  test("버전이 낮거나 쓸 수 없는 바이너리를 구분한다", async () => {
    const { value } = deps("linux", {
      bwrap: err({ kind: "version_too_old", name: "bwrap", found: "0.3.0", required: "0.4.0" }),
      sops: err({ kind: "version_unreadable", name: "sops", path: "/usr/bin/sops" }),
    });
    const report = await checkExternalBinaries(value, signal);
    if (!report.ok) throw new Error("unexpected cancel");
    const byName = Object.fromEntries(report.value.items.map((item) => [item.name, item.status]));
    expect(byName["bwrap"]).toEqual({ kind: "too_old", found: "0.3.0", required: "0.4.0" });
    expect(byName["sops"]).toEqual({ kind: "unusable", reason: "version_unreadable" });
    expect(report.value.blocking).toEqual(["sops", "bwrap"]);
  });

  test("점검 중에 중단되면 cancelled다", async () => {
    const controller = new AbortController();
    const { value } = deps("linux", {});
    const aborting: BinaryCheckDeps = {
      ...value,
      resolveBinary: (name, opts, sig) => {
        controller.abort();
        return value.resolveBinary(name, opts, sig);
      },
    };
    expect(await checkExternalBinaries(aborting, controller.signal)).toEqual({
      ok: false,
      error: { kind: "cancelled" },
    });
  });
});

describe("OsServiceHandle.checkBinaries", () => {
  test("서비스의 resolveBinary를 거쳐 이 OS의 표를 점검한다", async () => {
    const started = await createOsService(
      {
        resourceDir: "/opt/xeon/resources",
        logSink: () => {},
        logRedact: (line) => line,
        // 소스 실행의 @vscode/ripgrep 연결을 끄고 번들이 없는 환경을 만든다
        bundledSource: () => Promise.resolve(ok(undefined)),
      },
      fakeRuntime(),
    );
    if (!started.ok) throw new Error("service did not start");
    const report = await started.value.checkBinaries(signal);
    if (!report.ok) throw new Error("unexpected cancel");
    // fakeRuntime의 파일 시스템에는 어떤 바이너리도 없다
    expect(report.value.platform).toBe("linux");
    expect(report.value.ready).toBe(false);
    expect(report.value.blocking).toEqual(["rg", "sops", "age", "bwrap", "socat"]);
    expect(report.value.degraded).toEqual(["git", "secret-tool"]);
    const rg = report.value.items.find((item) => item.name === "rg");
    expect(rg?.status.kind).toBe("missing");
    await started.value.dispose();
  });
});
