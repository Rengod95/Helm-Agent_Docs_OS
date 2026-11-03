import type { Clock, Scheduler, TimerHandle } from "@fresnel/contracts";
import type {
  BackendResult,
  BridgeBackend,
  BridgePolicyContext,
  BridgePort,
  ConfirmAnswer,
  ConfirmRequest,
  HostSnapshot,
  NavigateTarget,
  SettingRead,
} from "../../../src/views/app/index.ts";

/** 손으로 돌리는 시계와 타이머 */
export class ManualTime implements Clock, Scheduler {
  private current = 1_000_000;
  private nextId = 1;
  private readonly timers = new Map<TimerHandle, { at: number; fn: () => void }>();
  now(): number {
    return this.current;
  }
  setTimeout(fn: () => void, ms: number): TimerHandle {
    const id = this.nextId;
    this.nextId += 1;
    this.timers.set(id, { at: this.current + ms, fn });
    return id;
  }
  clearTimeout(handle: TimerHandle): void {
    this.timers.delete(handle);
  }
  pending(): number {
    return this.timers.size;
  }
  /** ms만큼 흘리며 기한이 된 타이머를 순서대로 부른다 */
  advance(ms: number): void {
    const target = this.current + ms;
    for (;;) {
      let next: { id: TimerHandle; at: number; fn: () => void } | undefined;
      for (const [id, timer] of this.timers) {
        if (timer.at <= target && (next === undefined || timer.at < next.at))
          next = { id, ...timer };
      }
      if (next === undefined) break;
      this.timers.delete(next.id);
      this.current = next.at;
      next.fn();
    }
    this.current = target;
  }
}

/** 서로 이어진 포트 한 쌍. 보낼 때 structuredClone을 거친다(MessagePort처럼 값이 복사된다) */
/** 프레임 쪽 끝. 일부러 postMessage라는 이름을 피해 Window.postMessage 규칙과 섞이지 않게 한다 */
interface FrameEnd {
  send(message: unknown): void;
  listen(handler: (data: unknown) => void): void;
}

export interface PortPair {
  readonly host: BridgePort;
  readonly frame: FrameEnd;
  /** 프레임이 받은 메시지 */
  readonly toFrame: unknown[];
  readonly closedByHost: () => boolean;
}

export function portPair(): PortPair {
  let hostHandler: ((data: unknown) => void) | undefined;
  let frameHandler: ((data: unknown) => void) | undefined;
  const toFrame: unknown[] = [];
  let closed = false;
  const host: BridgePort = {
    postMessage(message) {
      const copy: unknown = structuredClone(message);
      toFrame.push(copy);
      frameHandler?.(copy);
    },
    setHandler(handler) {
      hostHandler = handler;
    },
    close() {
      closed = true;
    },
  };
  const frame: FrameEnd = {
    send(message) {
      hostHandler?.(structuredClone(message));
    },
    listen(handler) {
      frameHandler = handler;
    },
  };
  return { host, frame, toFrame, closedByHost: () => closed };
}

export function policyContext(overrides: Partial<BridgePolicyContext> = {}): BridgePolicyContext {
  return {
    extension: "helm",
    enabled: true,
    safeMode: false,
    methods: new Map([
      ["status", { readOnly: true, approval: false }],
      ["start", { readOnly: false, approval: false }],
      ["wipe", { readOnly: false, approval: true }],
    ]),
    readsRecordKinds: ["note.created"],
    settingPrefixes: ["ext.helm.", "l3.helm."],
    ownCommands: new Set(["helm-start"]),
    allowPost: true,
    openThreadId: "thr_1",
    ...overrides,
  };
}

const HOST_SNAPSHOT: HostSnapshot = {
  threadId: "thr_1",
  threadTitle: "title",
  connection: "connected",
  locale: "ko",
  theme: "dark",
  extension: { enabled: true, trust: "user", safeMode: false },
};

const okValue = (value: unknown): BackendResult<unknown> => ({ ok: true, value });

export interface BackendCalls {
  readonly names: string[];
  readonly resizes: number[];
  readonly diagnostics: { op: string; size: number }[];
  readonly navigations: { target: NavigateTarget; shellConfirmed: boolean }[];
}

export interface FakeBackendOptions {
  readonly queryResult?: BackendResult<unknown>;
  readonly settings?: readonly SettingRead[];
  readonly externalAllowed?: boolean;
  readonly eventRows?: readonly unknown[];
}

export function fakeBackend(options: FakeBackendOptions = {}): {
  backend: BridgeBackend;
  calls: BackendCalls;
} {
  const calls: BackendCalls = { names: [], resizes: [], diagnostics: [], navigations: [] };
  const backend: BridgeBackend = {
    query(verb) {
      calls.names.push(`query:${verb}`);
      return Promise.resolve(options.queryResult ?? okValue({ phase: "idle" }));
    },
    events(kinds, limit) {
      calls.names.push(`events:${kinds.join(",")}:${String(limit)}`);
      return Promise.resolve({ ok: true, value: options.eventRows ?? [] });
    },
    settings(keys) {
      calls.names.push(`settings:${keys.join(",")}`);
      return Promise.resolve({ ok: true, value: options.settings ?? [] });
    },
    host() {
      calls.names.push("host");
      return HOST_SNAPSHOT;
    },
    call(verb) {
      calls.names.push(`call:${verb}`);
      return Promise.resolve(okValue({ done: true }));
    },
    command(name, args) {
      calls.names.push(`command:${name}:${args}`);
      return Promise.resolve(okValue(null));
    },
    post(threadId, text) {
      calls.names.push(`post:${threadId}:${text}`);
      return Promise.resolve(okValue(null));
    },
    requestApproval(threadId, title) {
      calls.names.push(`requestApproval:${threadId}:${title}`);
      return Promise.resolve(okValue({ outcome: "allow" }));
    },
    navigate(target, shellConfirmed) {
      calls.navigations.push({ target, shellConfirmed });
      return Promise.resolve(okValue(null));
    },
    confirmExternal() {
      return Promise.resolve(options.externalAllowed ?? true);
    },
    resize(height) {
      calls.resizes.push(height);
    },
    diagnostic(line) {
      calls.diagnostics.push(line);
    },
  };
  return { backend, calls };
}

export function confirmer(answers: readonly ConfirmAnswer[]): {
  confirm: (request: ConfirmRequest) => Promise<ConfirmAnswer>;
  asked: ConfirmRequest[];
} {
  const asked: ConfirmRequest[] = [];
  let index = 0;
  return {
    asked,
    confirm(request) {
      asked.push(request);
      const answer = answers[index] ?? "deny";
      index += 1;
      return Promise.resolve(answer);
    },
  };
}

/** 마이크로태스크를 비워 비동기 판정이 끝나게 한다 */
export async function flush(): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });
}

export function request(id: number, op: string, args: unknown): unknown {
  return { v: 1, id, op, args };
}
