import { createHash } from "node:crypto";
import { spawn as startChild, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, expect, test } from "bun:test";
import { fileURLToPath } from "node:url";
import { err, ok, repeatAsync, type Logger, type Result } from "@fresnel/contracts";
import type { JsonValue } from "@fresnel/contracts/conversation";
import {
  PLUGIN_HOST_PROTOCOL_VERSION,
  type HostInitParams,
  type IsolatedChild,
  type IsolationProcessPort,
  type IsolationSpawnError,
} from "@fresnel/contracts/extensions";
import {
  createPluginHostSupervisor,
  type CallError,
  type PluginHostSupervisor,
} from "@fresnel/ext-host";

// AGE-59 실제 자식 시험. 자식은 실제로 `bun apps/host/src/main.ts plugin-host --stdio`로 뜨고, 엔진 쪽은 Node의 child_process 파이프로 말한다.
// 20 MiB와 100 MiB 요청(ASCII와 한글), 100 MiB 답, 전송 중 SIGKILL, 전송 중 SIGSTOP(멈춤 시한), 엔진 쪽 역압과 RSS를 값으로 본다.
// 값은 길이와 SHA-256으로 비교한다. 자식은 시험이 끝나면 모두 거둔다(남는 프로세스가 없어야 한다).

const MIB = 1024 * 1024;
const MAIN_ENTRY = fileURLToPath(new URL("../../src/main.ts", import.meta.url));
/** 확장 호스트(`@fresnel/ext-host`)의 진입 파일(절대 경로). 자식이 싣는 엔트리가 같은 모듈을 가져오게 한다 */
const EXT_HOST_ENTRY = fileURLToPath(
  new URL("../../../../packages/ext-host/src/index.ts", import.meta.url),
);

/** 실제 자식이 싣는 플러그인 엔트리 글. 자식의 가상 모듈에는 `@fresnel/ext-host`가 없어 절대 경로로 가져온다 */
function entrySourceOf(hostPath: string): string {
  return `import { createHash } from "node:crypto";
import { hostOf } from ${JSON.stringify(hostPath)};

function digestOf(text) {
  return { length: new TextEncoder().encode(text).byteLength, sha256: createHash("sha256").update(text).digest("hex") };
}
function textOf(params) {
  if (typeof params !== "object" || params === null || !("text" in params)) return "";
  return typeof params.text === "string" ? params.text : "";
}
function sizeOf(params) {
  if (typeof params !== "object" || params === null || !("size" in params)) return 0;
  return typeof params.size === "number" ? params.size : 0;
}
export const extension = ({ register }) => {
  register("bigt", {}, (g) => {
    const host = hostOf(g);
    host.registerMethod("digest", { handler: async (params) => digestOf(textOf(params)) });
    host.registerMethod("produce", { handler: async (params) => ({ text: "가".repeat(Math.ceil(sizeOf(params) / 3)) }) });
  });
};
`;
}

/** 엔트리 파일을 쓸 폴더. 시험 시작에 한 번 만든다 */
const FIXTURE_DIR = mkdtempSync(join(tmpdir(), "fresnel-big-input-"));
writeFileSync(join(FIXTURE_DIR, "big-transfer-plugin.ts"), entrySourceOf(EXT_HOST_ENTRY));
/** 엔진이 알리는 조각 상한(바이트). 100 MiB 시험이 들어갈 만큼 크다 */
const ENGINE_TRANSFER_MAX = 512 * MIB;
/** 기록에 들어가면 안 되는 표지. 값 안에 넣어 기록을 뒤진다 */
const MARKER = "PAYLOAD-MARKER-real-0b9e";

const INIT: HostInitParams = {
  protocolVersion: PLUGIN_HOST_PROTOCOL_VERSION,
  extension: "bigt",
  versionId: "bigt-1",
  manifest: {
    schemaVersion: 2,
    name: "bigt",
    version: "0.1.0",
    entry: "./big-transfer-plugin.ts",
    plugins: [{ layer: "plugin", hooks: [] }],
    methods: [
      { verb: "digest", params: {}, result: {}, readOnly: false },
      { verb: "produce", params: {}, result: {}, readOnly: false },
    ],
  },
  root: FIXTURE_DIR,
  entry: "./big-transfer-plugin.ts",
  settings: {},
};

afterAll(() => {
  rmSync(FIXTURE_DIR, { recursive: true, force: true });
});

const children: ChildProcess[] = [];
const supervisors: PluginHostSupervisor[] = [];
const logLines: string[] = [];

afterEach(() => {
  for (const sup of supervisors.splice(0)) sup.dispose("shutdown");
  for (const child of children.splice(0)) {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
  }
});

const quietLogger: Logger = {
  debug: (event, fields) => {
    logLines.push(JSON.stringify({ event, fields: fields ?? null }));
  },
  info: (event, fields) => {
    logLines.push(JSON.stringify({ event, fields: fields ?? null }));
  },
  warn: (event, fields) => {
    logLines.push(JSON.stringify({ event, fields: fields ?? null }));
  },
  error: (event, fields) => {
    logLines.push(JSON.stringify({ event, fields: fields ?? null }));
  },
  child: () => quietLogger,
};

/** 실제 자식을 띄우는 포트. Node의 파이프 stdio를 그대로 넘긴다 */
function nodePort(): IsolationProcessPort {
  return {
    spawn(spec): Promise<Result<IsolatedChild, IsolationSpawnError>> {
      const child = startChild(spec.command, [...spec.args], {
        stdio: ["pipe", "pipe", "pipe"],
        env: { ...spec.env },
      });
      children.push(child);
      const exited = new Promise<{ readonly code: number | null; readonly signal: string | null }>(
        (resolve) => {
          child.once("error", () => resolve({ code: null, signal: null }));
          child.once("exit", (code, signal) => resolve({ code, signal }));
        },
      );
      return Promise.resolve(
        ok({
          pid: child.pid ?? 0,
          stdin: child.stdin,
          stdout: child.stdout,
          stderr: child.stderr,
          exited,
          kill: (signal) => {
            child.kill(signal);
          },
        }),
      );
    },
  };
}

function realTimer(ms: number, fn: () => void): () => void {
  const handle = setTimeout(fn, ms);
  return () => {
    clearTimeout(handle);
  };
}

function supervisorOf(port: IsolationProcessPort, stallMs?: number): PluginHostSupervisor {
  const sup = createPluginHostSupervisor({
    process: port,
    specOf: () => ({
      command: process.execPath,
      args: [MAIN_ENTRY, "plugin-host", "--stdio"],
      readRoot: FIXTURE_DIR,
      env: { PATH: process.env["PATH"] ?? "" },
      label: "ext:bigt:1",
    }),
    setTimer: realTimer,
    now: () => Date.now(),
    logger: quietLogger,
    initParams: () => INIT,
    initTimeoutMs: 15_000,
    killGraceMs: 500,
    transferMaxBytes: () => ENGINE_TRANSFER_MAX,
    ...(stallMs === undefined ? {} : { transferStallMs: stallMs }),
    onEngineCall: () =>
      Promise.resolve(err({ kind: "unknown_target" as const, message: "no engine calls here" })),
    onRestartLimit: () => undefined,
  });
  supervisors.push(sup);
  return sup;
}

let calls = 0;

/** 감독이 프로세스 끝을 기록했는가(상태가 멈춤이나 유휴로 바뀜). 기록을 기다리는 짧은 되풀이다 */
async function settledStopped(sup: PluginHostSupervisor): Promise<boolean> {
  let left = 500;
  return repeatAsync<boolean>(async () => {
    const state = sup.status().state;
    if (state === "stopped" || state === "idle") return { value: true };
    left -= 1;
    if (left <= 0) return { value: false };
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 10);
    });
    return undefined;
  });
}

/** 엔진의 메서드 호출 본문(`method.call`). 문맥 칸은 대리 등록이 실어 보내는 모양이다 */
function methodBody(verb: string, params: JsonValue): JsonValue {
  calls += 1;
  return {
    threadId: null,
    deadlineMs: null,
    replay: false,
    caller: "engine",
    state: null,
    settings: {},
    registration: "bigt",
    verb,
    params,
    callId: `big-${String(calls)}`,
    callerKind: "wire",
  };
}

/** 답 모양: 길이와 해시. 엔트리의 `digest` 메서드가 같은 식으로 답한다 */
type DigestReply = {
  readonly length: number;
  readonly sha256: string;
};

function digestOf(text: string): DigestReply {
  return {
    length: new TextEncoder().encode(text).byteLength,
    sha256: createHash("sha256").update(text).digest("hex"),
  };
}

/** 표지를 앞에 둔 ASCII 글 */
function asciiOf(bytes: number): string {
  const head = `${MARKER} `;
  return head + "a".repeat(bytes - head.length);
}

/** 한글 글. 한 글자는 UTF-8 세 바이트다 */
function koreanOf(bytes: number): string {
  return "가".repeat(Math.ceil(bytes / 3));
}

function resultOf(outcome: Result<JsonValue, CallError>): JsonValue {
  if (!outcome.ok)
    throw new Error(`the call failed: ${outcome.error.kind}: ${outcome.error.message}`);
  return outcome.value;
}

/** 자식 프로세스의 표준입력 대기열 크기를 짧은 간격으로 재고, 최대와 표본 수를 돌려준다 */
function sampleQueue(child: ChildProcess): {
  readonly stop: () => { max: number; samples: number };
} {
  let max = 0;
  let samples = 0;
  const timer = setInterval(() => {
    samples += 1;
    max = Math.max(max, child.stdin?.writableLength ?? 0);
  }, 2);
  return {
    stop: () => {
      clearInterval(timer);
      return { max, samples };
    },
  };
}

test("a 20 MiB ASCII input reaches the real child whole, and its digest is the engine's", async () => {
  const sup = supervisorOf(nodePort());
  expect((await sup.start()).ok).toBe(true);
  const text = asciiOf(20 * MIB);
  const reply = await sup.call("method.call", methodBody("digest", { text }));
  expect(resultOf(reply)).toEqual(digestOf(text));
  expect(logLines.join("")).not.toContain(MARKER);
}, 120_000);

test("a 100 MiB ASCII input and a 100 MiB Korean input reach the real child whole and come back as the same digest", async () => {
  const sup = supervisorOf(nodePort());
  expect((await sup.start()).ok).toBe(true);
  const ascii = asciiOf(100 * MIB);
  expect(resultOf(await sup.call("method.call", methodBody("digest", { text: ascii })))).toEqual(
    digestOf(ascii),
  );
  const korean = `${MARKER} ${koreanOf(100 * MIB)}`;
  expect(resultOf(await sup.call("method.call", methodBody("digest", { text: korean })))).toEqual(
    digestOf(korean),
  );
  expect(logLines.join("")).not.toContain(MARKER);
}, 240_000);

test("a 100 MiB Korean reply from the real child comes back whole, and its digest is the one the child made", async () => {
  const sup = supervisorOf(nodePort());
  expect((await sup.start()).ok).toBe(true);
  const reply = resultOf(await sup.call("method.call", methodBody("produce", { size: 100 * MIB })));
  const text =
    typeof reply === "object" && reply !== null && "text" in reply ? reply.text : undefined;
  expect(typeof text).toBe("string");
  expect(digestOf(typeof text === "string" ? text : "")).toEqual(digestOf(koreanOf(100 * MIB)));
}, 240_000);

test("the real child is killed in the middle of a 100 MiB transfer: the call ends as process_exit, and a later call restarts the child", async () => {
  const port = nodePort();
  const sup = supervisorOf(port);
  expect((await sup.start()).ok).toBe(true);
  const child = children[0];
  if (child === undefined) throw new Error("no child");
  const pending = sup.call("method.call", methodBody("digest", { text: asciiOf(100 * MIB) }));
  // 전송이 시작된 뒤 죽인다(100 MiB는 이 시간 안에 다 나가지 않는다)
  setTimeout(() => {
    child.kill("SIGKILL");
  }, 150);
  const outcome = await pending;
  expect(outcome).toMatchObject({ ok: false, error: { kind: "process_exit" } });
  // 죽음이 감독에 기록될 때까지 기다린 뒤 다음 호출을 낸다(기록 전의 호출은 죽은 파이프에 쓰게 된다)
  expect(await settledStopped(sup)).toBe(true);
  // 엔진은 그대로다: 다음 호출은 새 자식으로 된다
  const again = await sup.call("method.call", methodBody("digest", { text: "after kill" }));
  expect(resultOf(again)).toEqual(digestOf("after kill"));
  expect(children.length).toBe(2);
  expect(logLines.join("")).not.toContain(MARKER);
}, 120_000);

test("the real child stops reading in the middle of a transfer: after the stall time the call ends as process_killed naming the stall", async () => {
  const port = nodePort();
  const sup = supervisorOf(port, 1_000);
  expect((await sup.start()).ok).toBe(true);
  const child = children[0];
  if (child === undefined) throw new Error("no child");
  const pending = sup.call("method.call", methodBody("digest", { text: asciiOf(100 * MIB) }));
  setTimeout(() => {
    // 멈춘 자식은 읽지 않는다. 엔진의 쓰기가 비워지지 않아 멈춤 시한이 전송을 끊는다
    child.kill("SIGSTOP");
  }, 150);
  const outcome = await pending;
  expect(outcome.ok).toBe(false);
  if (outcome.ok) throw new Error("the call should fail");
  expect(outcome.error.kind).toBe("process_killed");
  expect(outcome.error.message).toContain("stalled");
  expect(logLines.join("")).not.toContain(MARKER);
}, 120_000);

test("while 100 MiB is sent the child's input queue stays at or under 8 MiB, and the engine's RSS grows less than 1.5 times the line", async () => {
  const sup = supervisorOf(nodePort());
  expect((await sup.start()).ok).toBe(true);
  const child = children[0];
  if (child === undefined) throw new Error("no child");
  const text = asciiOf(100 * MIB);
  const body = methodBody("digest", { text });
  const lineBytes = new TextEncoder().encode(JSON.stringify(body)).byteLength;
  Bun.gc(true);
  const before = process.memoryUsage().rss;
  let peakRss = before;
  const rssTimer = setInterval(() => {
    peakRss = Math.max(peakRss, process.memoryUsage().rss);
  }, 5);
  const queue = sampleQueue(child);
  const reply = await sup.call("method.call", body);
  const { max, samples } = queue.stop();
  clearInterval(rssTimer);
  expect(resultOf(reply)).toEqual(digestOf(text));
  expect(samples).toBeGreaterThan(0);
  expect(max).toBeLessThanOrEqual(8 * MIB);
  expect(peakRss - before).toBeLessThan(lineBytes * 1.5);
}, 240_000);
