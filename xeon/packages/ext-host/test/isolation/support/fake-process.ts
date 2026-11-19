// 감독 시험의 프로세스 대역. 실제 플러그인 호스트(`runPluginHost`)를 같은 프로세스 안에서 메모리 파이프로 돌린다.
// 시험은 엔진이 자식에게 쓴 바이트, 받은 신호, 스스로 끝내기(crash), 표준오류 쓰기를 본다. 자식 프로세스는 띄우지 않는다.
import { PassThrough } from "node:stream";
import { detach, err, ok, repeatAsync, type Logger, type Result } from "@fresnel/contracts";
import type {
  IsolatedChild,
  IsolationProcessPort,
  IsolationSpawnError,
  IsolationSpawnSpec,
} from "@fresnel/contracts/extensions";
import * as extHost from "../../../src/index.ts";
import { runPluginHost } from "../../../src/isolation/child-runtime.ts";

interface FakeChildOptions {
  /** 자식이 SIGTERM을 무시한다(SIGKILL만 끝낸다) */
  readonly ignoreSigterm?: boolean;
  /** 자식이 아무것도 읽지 않는다(host.init 시간 초과 시험) */
  readonly silent?: boolean;
  /** 옛 자식: `host.init` 응답에서 조각 칸(`transfer`)을 뺀다(AGE-59 협상 시험) */
  readonly oldChild?: boolean;
}

interface ExitInfo {
  readonly code: number | null;
  readonly signal: string | null;
}

export interface FakeChild {
  readonly child: IsolatedChild;
  /** 자식이 읽은 바이트(엔진이 쓴 줄들)를 문자열로 */
  received(): string;
  /** 자식이 쓴 바이트(자식이 엔진에 보낸 줄들: 요청, 응답, `engine.call`)를 문자열로 */
  emitted(): string;
  /** 받은 신호 목록 */
  readonly signals: string[];
  /** 스스로 끝난 것처럼 만든다(예기치 않은 종료) */
  crash(): void;
  /** 표준오류에 글을 쓴다 */
  writeStderr(text: string): void;
  isAlive(): boolean;
}

export interface FakeProcessPort extends IsolationProcessPort {
  readonly children: FakeChild[];
  readonly specs: IsolationSpawnSpec[];
  /** 다음 띄우기를 실패시킨다 */
  failNextSpawn(error: IsolationSpawnError): void;
  /** 다음 띄우기에 옵션을 준다 */
  nextOptions(options: FakeChildOptions): void;
}

/** 입력을 그대로 넘기면서 자식이 읽은 바이트를 기록한다 */
async function* tapped(
  source: AsyncIterable<Uint8Array>,
  sink: (chunk: Uint8Array) => void,
): AsyncGenerator<Uint8Array> {
  for await (const chunk of source) {
    sink(chunk);
    yield chunk;
  }
}

/** 옛 자식의 `host.init` 응답을 흉내 낸다: 조각 칸을 뺀다. 다른 줄은 그대로다 */
function withoutTransferAnswer(line: string): string {
  return line.replace(/,"transfer":\{"maxBytes":\d+\}/, "");
}

function startFakeChild(pid: number, options: FakeChildOptions): FakeChild {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const decoder = new TextDecoder();
  const received: string[] = [];
  const emitted: string[] = [];
  const signals: string[] = [];
  const exitHolder: { settle?: (info: ExitInfo) => void } = {};
  const exited = new Promise<ExitInfo>((resolve) => {
    exitHolder.settle = resolve;
  });
  let finished = false;

  function finish(info: ExitInfo): void {
    if (finished) return;
    finished = true;
    stdout.end();
    stderr.end();
    stdin.end();
    exitHolder.settle?.(info);
  }

  if (options.silent !== true) {
    const runtime = runPluginHost({
      input: tapped(stdin, (chunk) => {
        received.push(decoder.decode(chunk, { stream: true }));
      }),
      output: {
        write: (line) => {
          const sent = options.oldChild === true ? withoutTransferAnswer(line) : line;
          emitted.push(sent);
          if (!finished) stdout.write(sent);
        },
      },
      stderr: {
        write: (text) => {
          if (!finished) stderr.write(text);
        },
      },
      sdkModules: { "@fresnel/ext-host": extHost },
    });
    detach(
      runtime.then(() => finish({ code: 0, signal: null })),
      () => finish({ code: 1, signal: null }),
    );
  }

  const child: IsolatedChild = {
    pid,
    stdin,
    stdout,
    stderr,
    exited,
    kill(signal) {
      signals.push(signal);
      if (options.ignoreSigterm === true && signal === "SIGTERM") return;
      finish({ code: null, signal });
    },
  };

  return {
    child,
    received: () => received.join(""),
    emitted: () => emitted.join(""),
    signals,
    crash: () => finish({ code: 1, signal: null }),
    writeStderr: (text) => {
      if (!finished) stderr.write(text);
    },
    isAlive: () => !finished,
  };
}

export function createFakeProcessPort(): FakeProcessPort {
  const children: FakeChild[] = [];
  const specs: IsolationSpawnSpec[] = [];
  let failure: IsolationSpawnError | undefined;
  let nextFlags: FakeChildOptions = {};
  let pid = 4000;
  return {
    children,
    specs,
    failNextSpawn(error) {
      failure = error;
    },
    nextOptions(options) {
      nextFlags = options;
    },
    async spawn(spec): Promise<Result<IsolatedChild, IsolationSpawnError>> {
      specs.push(spec);
      if (failure !== undefined) {
        const pending = failure;
        failure = undefined;
        return err(pending);
      }
      const flags = nextFlags;
      nextFlags = {};
      pid += 1;
      const started = startFakeChild(pid, flags);
      children.push(started);
      return ok(started.child);
    },
  };
}

// ── 시계와 기다림 ─────────────────────────────────────────────────────────

export interface ManualClock {
  readonly now: () => number;
  readonly setTimer: (ms: number, fn: () => void) => () => void;
  /** 시각을 옮기고, 그 안에 든 타이머를 시각 순으로 실행한다 */
  advance(ms: number): void;
  /** 걸려 있는 타이머 수 */
  armed(): number;
}

export function createManualClock(): ManualClock {
  let time = 0;
  let seq = 0;
  const timers = new Map<number, { readonly at: number; readonly fn: () => void }>();
  return {
    now: () => time,
    setTimer(ms, fn) {
      seq += 1;
      const id = seq;
      timers.set(id, { at: time + ms, fn });
      return () => {
        timers.delete(id);
      };
    },
    advance(ms) {
      time += ms;
      const due = [...timers]
        .filter(([, timer]) => timer.at <= time)
        .toSorted(([, a], [, b]) => a.at - b.at);
      for (const [id, timer] of due) {
        if (timers.delete(id)) timer.fn();
      }
    },
    armed: () => timers.size,
  };
}

/** 조건이 참이 될 때까지 짧게 기다린다. 실제 시계를 쓰므로 감독의 수동 시계와 섞이지 않는다 */
export async function until(check: () => boolean, what: string): Promise<void> {
  const started = Date.now();
  await repeatAsync<void>(async () => {
    if (check()) return { value: undefined };
    if (Date.now() - started > 3000) throw new Error(`timed out waiting for ${what}`);
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 2);
    });
    return undefined;
  });
}

/** 기록만 하는 로거. 이벤트 이름을 모은다(값은 시험이 보지 않는다) */
export function recordingLogger(events: string[]): Logger {
  const logger: Logger = {
    debug: (event) => {
      events.push(event);
    },
    info: (event) => {
      events.push(event);
    },
    warn: (event) => {
      events.push(event);
    },
    error: (event) => {
      events.push(event);
    },
    child: () => logger,
  };
  return logger;
}
