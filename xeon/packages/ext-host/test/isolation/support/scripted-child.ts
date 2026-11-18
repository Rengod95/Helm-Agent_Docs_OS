// 후보 실행기 시험의 자식 대역. 실제 플러그인 호스트 대신 줄 단위 프레임을 말하는 스크립트를 돌린다.
// 자식은 플러그인 코드를 읽거나 실행하지 않는다. 엔진이 보낸 프레임을 기록하고, 스크립트가 정한 프레임만 쓴다.
// `host.init`은 대역이 정해진 등록 선언으로 답하고, 그 밖의 요청과 알림은 스크립트가 기다려 받는다.
import { PassThrough } from "node:stream";
import { detach, err, ok, parse, parseJson, type Result } from "@fresnel/contracts";
import type { JsonValue } from "@fresnel/contracts/conversation";
import {
  PLUGIN_HOST_PROTOCOL_VERSION,
  RawPluginHostFrameSchema,
  type IsolatedChild,
  type IsolationProcessPort,
  type IsolationSpawnError,
  type IsolationSpawnSpec,
  type PluginHostErrorKind,
  type PluginHostFrame,
  type RawPluginHostFrame,
} from "@fresnel/contracts/extensions";

/** 엔진이 보낸 요청 하나(`id`와 `method`가 있다) */
interface InboundRequest {
  readonly id: number;
  readonly method: string;
  readonly params: unknown;
}

/** 스크립트가 쓰는 자식의 입출력 */
export interface ChildIo {
  /** 엔진이 보낸 요청 가운데 `method`인 다음 것을 기다린다. 받은 프레임은 모두 `received()`에 남는다 */
  next(method: string): Promise<InboundRequest>;
  /** `engine.call`을 보내고 같은 `id`의 응답 프레임을 기다린다 */
  engineCall(params: JsonValue): Promise<RawPluginHostFrame>;
  /** 요청에 결과로 답한다 */
  reply(id: number, result: JsonValue): void;
  /** 요청에 오류로 답한다 */
  fail(id: number, kind: PluginHostErrorKind, message: string): void;
  /** 표준오류에 글을 쓴다(줄바꿈을 붙여 쓴다) */
  stderr(text: string): void;
  /** 예기치 않게 끝난 것처럼 만든다 */
  crash(): void;
  /** 받은 프레임 전부(요청, 알림, 응답). 줄마다 디코딩된 값이다 */
  received(): readonly RawPluginHostFrame[];
}

/** 자식 스크립트. `spawn`은 몇 번째 띄우기인지(0부터)다 */
export type ChildScript = (io: ChildIo, spawn: number) => Promise<void>;

interface ScriptedChild {
  readonly child: IsolatedChild;
  alive(): boolean;
  received(): readonly RawPluginHostFrame[];
  /** 엔진이 자식에게 보낸 신호 */
  signals(): readonly string[];
}

export interface ScriptedPort extends IsolationProcessPort {
  readonly specs: readonly IsolationSpawnSpec[];
  readonly children: readonly ScriptedChild[];
  /** 스크립트가 던진 오류. 시험 끝에 비어 있어야 한다 */
  readonly failures: readonly unknown[];
  /** 다음 띄우기를 실패시킨다 */
  failNextSpawn(error: IsolationSpawnError): void;
}

export interface ScriptedPortOptions {
  /** `host.init`에 답할 등록 선언(JSON) */
  readonly decls: JsonValue[];
  readonly script: ChildScript;
}

export interface HookSpec {
  readonly point: string;
  readonly handlerIndex: number;
}

/** 등록 선언 하나(JSON). 상태가 있으면 초기 문서를 준다 */
export function declOf(id: string, hooks: readonly HookSpec[], initial?: JsonValue): JsonValue {
  return {
    id,
    defaultEnabled: null,
    state: initial === undefined ? null : { schema: { type: "object" }, initial, version: 1 },
    hooks: hooks.map((hook) => ({
      point: hook.point,
      handlerIndex: hook.handlerIndex,
      coalesce: false,
    })),
    tools: [],
    commands: [],
    methods: [],
    flags: [],
    providers: [],
    mcpServers: [],
    renderers: [],
    hasDisposers: false,
    hasMigration: false,
    drive: null,
  };
}

function requestOf(frame: RawPluginHostFrame): InboundRequest {
  if (frame.id === undefined || frame.method === undefined) {
    throw new Error("the frame is not a request");
  }
  return { id: frame.id, method: frame.method, params: frame.params };
}

interface Started {
  readonly child: IsolatedChild;
  readonly scripted: ScriptedChild;
  readonly script: Promise<void>;
}

function startChild(options: ScriptedPortOptions, spawn: number): Started {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const decoder = new TextDecoder();
  const inbox: RawPluginHostFrame[] = [];
  /** 요청과 응답을 기다림이 이미 받은 줄 번호 */
  const taken = new Set<number>();
  const signalLog: string[] = [];
  const exitHolder: {
    settle?: (info: { readonly code: number | null; readonly signal: string | null }) => void;
  } = {};
  const exited = new Promise<{ readonly code: number | null; readonly signal: string | null }>(
    (resolve) => {
      exitHolder.settle = resolve;
    },
  );
  let wake: (() => void) | undefined;
  let finished = false;
  let nextId = 1;
  let pending = "";

  function finish(info: { readonly code: number | null; readonly signal: string | null }): void {
    if (finished) return;
    finished = true;
    stdout.end();
    stderr.end();
    stdin.destroy();
    exitHolder.settle?.(info);
  }

  function send(frame: PluginHostFrame): void {
    if (!finished) stdout.write(`${JSON.stringify(frame)}\n`);
  }

  function arrived(frame: RawPluginHostFrame): void {
    inbox.push(frame);
    if (frame.method === "host.init" && frame.id !== undefined) {
      send({
        id: frame.id,
        result: { protocolVersion: PLUGIN_HOST_PROTOCOL_VERSION, registrations: options.decls },
      });
      return;
    }
    const resume = wake;
    wake = undefined;
    resume?.();
  }

  /** 기다림이 맞는 줄을 받을 때까지 기다린다. 한 번 받은 줄은 다시 받지 않는다 */
  function take(match: (frame: RawPluginHostFrame) => boolean): Promise<RawPluginHostFrame> {
    return new Promise((resolve) => {
      const attempt = (): void => {
        for (const [at, frame] of inbox.entries()) {
          if (taken.has(at) || !match(frame)) continue;
          taken.add(at);
          resolve(frame);
          return;
        }
        wake = attempt;
      };
      attempt();
    });
  }

  stdin.on("data", (chunk: Uint8Array) => {
    pending += decoder.decode(chunk, { stream: true });
    const lines = pending.split("\n");
    pending = lines.pop() ?? "";
    for (const line of lines) {
      if (line.length === 0) continue;
      const json = parseJson(line);
      if (!json.ok) throw new Error("the engine sent a line that is not JSON");
      const frame = parse(RawPluginHostFrameSchema, json.value);
      if (!frame.ok) throw new Error("the engine sent a line that is not a frame");
      arrived(frame.value);
    }
  });
  stdin.on("end", () => {
    finish({ code: 0, signal: null });
  });

  const io: ChildIo = {
    next: async (method) =>
      requestOf(await take((frame) => frame.id !== undefined && frame.method === method)),
    engineCall: (params) => {
      const id = nextId;
      nextId += 1;
      send({ id, method: "engine.call", params });
      return take(
        (frame) => frame.id === id && (frame.result !== undefined || frame.error !== undefined),
      );
    },
    reply: (id, result) => {
      send({ id, result });
    },
    fail: (id, kind, message) => {
      send({ id, error: { kind, message } });
    },
    stderr: (text) => {
      if (!finished) stderr.write(text);
    },
    crash: () => {
      finish({ code: 1, signal: null });
    },
    received: () => [...inbox],
  };

  const child: IsolatedChild = {
    pid: 9000 + spawn,
    stdin,
    stdout,
    stderr,
    exited,
    kill(signal) {
      signalLog.push(signal);
      finish({ code: null, signal });
    },
  };

  const scripted: ScriptedChild = {
    child,
    alive: () => !finished,
    received: () => [...inbox],
    signals: () => [...signalLog],
  };

  return { child, scripted, script: options.script(io, spawn) };
}

export function createScriptedPort(options: ScriptedPortOptions): ScriptedPort {
  const specs: IsolationSpawnSpec[] = [];
  const children: ScriptedChild[] = [];
  const failures: unknown[] = [];
  let failure: IsolationSpawnError | undefined;
  return {
    specs,
    children,
    failures,
    failNextSpawn(error) {
      failure = error;
    },
    async spawn(spec: IsolationSpawnSpec): Promise<Result<IsolatedChild, IsolationSpawnError>> {
      specs.push(spec);
      if (failure !== undefined) {
        const pending = failure;
        failure = undefined;
        return err(pending);
      }
      const started = startChild(options, children.length);
      children.push(started.scripted);
      // 스크립트가 던지면 시험이 볼 수 있게 남긴다(기다리는 중에 끝난 스크립트는 던지지 않는다)
      detach(started.script, (cause) => {
        failures.push(cause);
      });
      return ok(started.child);
    },
  };
}
