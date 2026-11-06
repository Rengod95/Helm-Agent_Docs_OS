// 엔진 정책 시험(engine.rs의 순수 단위 시험을 옮긴다). 프로세스와 시계를 쓰지 않는다.
import { describe, expect, test } from "bun:test";
import { engineEnv } from "../../src/main/lib/env-path.ts";
import {
  backoffMs,
  createRestartPolicy,
  createStderrSplitter,
  DEFAULT_RESTART_LIMIT,
  DEFAULT_SHUTDOWN_GRACE_MS,
  engineConfigFrom,
  engineFlags,
  exitOf,
  parseTarget,
  REMOTE_ADDRESS_MAX_BYTES,
  safeModeChosen,
  shutdownRequestFrame,
  sidecarArgs,
  signalNumberOf,
  STDERR_LINE_MAX_BYTES,
  validateTarget,
  type RestartDecision,
} from "../../src/main/engine/policy.ts";
import type { EngineState, EngineTarget } from "../../src/main/engine/state.ts";

const enc = (text: string): Uint8Array => new TextEncoder().encode(text);
const remote = (address: string): EngineTarget => ({ kind: "remote", address });

describe("restart policy (RestartPolicy, 4.4)", () => {
  test("backs off then gives up at the limit", () => {
    const policy = createRestartPolicy(3);
    expect(policy.onExit(0)).toEqual({ kind: "restart", attempt: 1, delayMs: 0 });
    expect(policy.onExit(0)).toEqual({ kind: "restart", attempt: 2, delayMs: 1_000 });
    expect(policy.onExit(0)).toEqual({ kind: "restart", attempt: 3, delayMs: 2_000 });
    // D-05: restartLimit + 1번째 종료는 failed
    expect(policy.onExit(0)).toEqual({ kind: "giveUp", attempts: 3 });
  });

  test("the backoff caps at eight seconds", () => {
    const policy = createRestartPolicy(10);
    const delays = Array.from({ length: 7 }, () => {
      const decision: RestartDecision = policy.onExit(0);
      return decision.kind === "restart" ? decision.delayMs : Number.NaN;
    });
    expect(delays).toEqual([0, 1_000, 2_000, 4_000, 8_000, 8_000, 8_000]);
    expect(backoffMs(9)).toBe(8_000);
  });

  test("the count covers only the last ten minutes", () => {
    const policy = createRestartPolicy(1);
    expect(policy.onExit(0).kind).toBe("restart");
    expect(policy.onExit(599_000)).toEqual({ kind: "giveUp", attempts: 1 });
    // 10분 넘게 재기동이 없었다: 횟수가 0으로 돌아간다
    expect(policy.onExit(601_000)).toEqual({ kind: "restart", attempt: 1, delayMs: 0 });
  });

  test("a limit of zero disables automatic restarts", () => {
    expect(createRestartPolicy(0).onExit(0)).toEqual({ kind: "giveUp", attempts: 0 });
  });

  test("a manual reset clears the count", () => {
    const policy = createRestartPolicy(1);
    policy.onExit(0);
    expect(policy.onExit(0)).toEqual({ kind: "giveUp", attempts: 1 });
    policy.reset();
    expect(policy.onExit(0)).toEqual({ kind: "restart", attempt: 1, delayMs: 0 });
  });
});

describe("configuration from the settings values (from_values)", () => {
  test("uses the defaults for missing or out-of-range values", () => {
    expect(DEFAULT_SHUTDOWN_GRACE_MS).toBe(7_000);
    expect(DEFAULT_RESTART_LIMIT).toBe(3);
    expect(engineConfigFrom(null, null)).toEqual({ shutdownGraceMs: 7_000, restartLimit: 3 });
    expect(engineConfigFrom(999, 11)).toEqual({ shutdownGraceMs: 7_000, restartLimit: 3 });
    expect(engineConfigFrom(180_001, -1)).toEqual({ shutdownGraceMs: 7_000, restartLimit: 3 });
    expect(engineConfigFrom(5_000, 0)).toEqual({ shutdownGraceMs: 5_000, restartLimit: 0 });
  });

  test("the range ends are accepted", () => {
    expect(engineConfigFrom(1_000, 10)).toEqual({ shutdownGraceMs: 1_000, restartLimit: 10 });
    expect(engineConfigFrom(180_000, 0)).toEqual({ shutdownGraceMs: 180_000, restartLimit: 0 });
  });
});

describe("targets (W-08)", () => {
  test("validation accepts addresses and rejects empty, blank, spaced and oversized ones", () => {
    expect(validateTarget({ kind: "local" })).toBeNull();
    for (const ok of [
      "tcp://host:1234",
      "unix:/tmp/fresnel.sock",
      "ssh://me@build/home/me/s.sock",
    ]) {
      expect(validateTarget(remote(ok))).toBeNull();
    }
    // 길이는 바이트로 잰다. 한글 170자는 510바이트, 171자는 513바이트다
    expect(validateTarget(remote("a".repeat(REMOTE_ADDRESS_MAX_BYTES)))).toBeNull();
    expect(validateTarget(remote("가".repeat(170)))).toBeNull();
    for (const bad of ["a".repeat(REMOTE_ADDRESS_MAX_BYTES + 1), "가".repeat(171)]) {
      expect(validateTarget(remote(bad))).toBe("bad-request");
    }
    for (const bad of [
      "",
      "   ",
      "\t",
      "tcp://host 1234",
      " tcp://host:1234",
      "tcp://host:1234\n",
      "tcp://host\u0000:1",
      "tcp://host:1234\u007f",
    ]) {
      expect(validateTarget(remote(bad))).toBe("bad-request");
    }
  });

  test("the IPC shape is read as the Rust serde shape, and anything else is refused", () => {
    expect(parseTarget({ kind: "remote", address: "tcp://host:1234" })).toEqual(
      remote("tcp://host:1234"),
    );
    expect(parseTarget({ kind: "local" })).toEqual({ kind: "local" });
    // 추가 속성은 무시한다. 모르는 종류와 주소 없는 원격은 거부한다
    expect(parseTarget({ kind: "local", extra: 1 })).toEqual({ kind: "local" });
    expect(parseTarget({ kind: "sidecar" })).toBeNull();
    expect(parseTarget({ kind: "remote" })).toBeNull();
    expect(parseTarget({ kind: "remote", address: 7 })).toBeNull();
    expect(parseTarget("local")).toBeNull();
  });
});

describe("arguments and safe mode (sidecar_args)", () => {
  test("safe mode is a flag on a local engine, and the remote address is an argument of a remote one", () => {
    expect(engineFlags({ kind: "local" }, "default")).toEqual([]);
    expect(sidecarArgs({ kind: "local" }, "default")).toEqual(["host", "--stdio"]);
    expect(sidecarArgs({ kind: "local" }, "on")).toEqual(["host", "--stdio", "--safe-mode"]);
    // 끄기도 플래그다. 설정으로 켠 안전 모드를 호스트가 이번 시작에만 끈다
    expect(sidecarArgs({ kind: "local" }, "off")).toEqual(["host", "--stdio", "--no-safe-mode"]);
    expect(sidecarArgs(remote("tcp://host:1234"), "default")).toEqual([
      "host",
      "--stdio",
      "--remote",
      "tcp://host:1234",
    ]);
    // 안전 모드는 로컬 엔진에만 붙는다. 원격 대상에서 켜져 있어도 플래그는 빠진다
    expect(sidecarArgs(remote("tcp://host:1234"), "on")).toEqual([
      "host",
      "--stdio",
      "--remote",
      "tcp://host:1234",
    ]);
    expect(sidecarArgs(remote("tcp://host:1234"), "off")).toEqual([
      "host",
      "--stdio",
      "--remote",
      "tcp://host:1234",
    ]);
  });

  test("a chosen boolean becomes on or off, never default", () => {
    expect(safeModeChosen(true)).toBe("on");
    expect(safeModeChosen(false)).toBe("off");
  });

  test("the environment drops only BUN_OPTIONS and keeps the order of the rest", () => {
    const env = engineEnv(
      { PATH: "/bin", BUN_OPTIONS: "--inspect", BUN_OPTIONS_X: "keep", HOME: "/home/u" },
      null,
      "darwin",
    );
    expect(Object.keys(env)).toEqual(["PATH", "BUN_OPTIONS_X", "HOME"]);
  });
});

describe("stderr lines (E10)", () => {
  test("lines split across chunks, trim the CR, and truncate at 8 KiB", () => {
    const splitter = createStderrSplitter();
    expect(splitter.push(enc("one\ntw"))).toEqual(["one"]);
    expect(splitter.push(enc("o\r\n"))).toEqual(["two"]);
    const long = new Uint8Array(STDERR_LINE_MAX_BYTES + 100).fill(0x78);
    const lines = splitter.push(new Uint8Array([...long, ...enc("\nnext\n")]));
    expect(lines.length).toBe(2);
    expect(lines[0]?.length).toBe(STDERR_LINE_MAX_BYTES);
    expect(lines[1]).toBe("next");
    expect(splitter.push(enc("no newline"))).toEqual([]);
    expect(splitter.finish()).toBe("no newline");
    expect(splitter.finish()).toBeNull();
  });
});

describe("shutdown request (4.3 step 2)", () => {
  test("is one JSON-RPC line with the shutdown id", () => {
    const line = new TextDecoder().decode(shutdownRequestFrame(7));
    expect(line.endsWith("\n")).toBe(true);
    const value: unknown = JSON.parse(line.trimEnd());
    expect(value).toEqual({
      jsonrpc: "2.0",
      id: "shell:shutdown:7",
      method: "host.shutdown",
      params: { reason: "client_exit" },
    });
  });
});

describe("exit records and signals (EngineExit)", () => {
  test("the exit time is RFC 3339 UTC with milliseconds", () => {
    expect(exitOf(1, null, Date.UTC(2026, 9, 24))).toEqual({
      code: 1,
      signal: null,
      at: "2026-10-24T00:00:00.000Z",
    });
  });

  test("a signal name becomes its number, and an unknown name is null", () => {
    expect(signalNumberOf("SIGKILL")).toBe(9);
    expect(signalNumberOf(null)).toBeNull();
    expect(signalNumberOf("NOT_A_SIGNAL")).toBeNull();
  });
});

describe("state objects keep the IPC key names", () => {
  test("restarting and failed states serialize with the schema keys", () => {
    const exit = exitOf(1, null, Date.UTC(2026, 9, 24));
    const restarting: EngineState = {
      kind: "restarting",
      attempt: 1,
      retryAt: "2026-10-24T00:00:01.000Z",
      lastExit: exit,
    };
    expect(JSON.stringify(restarting)).toBe(
      '{"kind":"restarting","attempt":1,"retryAt":"2026-10-24T00:00:01.000Z","lastExit":{"code":1,"signal":null,"at":"2026-10-24T00:00:00.000Z"}}',
    );
    const failed: EngineState = { kind: "failed", attempts: 3, lastExit: exit };
    expect(JSON.stringify(failed)).toBe(
      '{"kind":"failed","attempts":3,"lastExit":{"code":1,"signal":null,"at":"2026-10-24T00:00:00.000Z"}}',
    );
    expect(JSON.stringify({ kind: "running", source: "sidecar", pid: 42 })).toBe(
      '{"kind":"running","source":"sidecar","pid":42}',
    );
  });
});
