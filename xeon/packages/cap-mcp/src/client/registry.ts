import {
  canonicalJson,
  detach,
  ok,
  repeatAsync,
  type Clock,
  type Logger,
  type Result,
  type Scheduler,
  type TimerHandle,
} from "@xeon/contracts";
import type { McpServerState } from "@xeon/contracts/capabilities";
import {
  connectMcp,
  type McpConnection,
  type McpFailure,
  type RawPrompt,
  type RawTool,
} from "../adapter.ts";
import type { McpMasker } from "../ports/secrets.ts";
import { sandboxOf, type McpSettings } from "../settings.ts";
import type { OpenedTransport, TransportFactory } from "../transport/factory.ts";
import type { BlockedReason, ServerDefinition } from "../types.ts";
import { backoffDelayMs } from "./backoff.ts";

// 서버별 연결 상태 기계(L2.mcp.plan §2 client/registry.ts, L2.mcp.spec §4.1, §4.8).
// disabled → connecting → connected ↔ reconnecting → failed, 정책이 막으면 blocked.
// 상태가 바뀌어도 도구 집합은 여기서 바꾸지 않는다: 바뀐 서버를 모아 두고 단계 경계에서 service가 한 번에 반영한다(§4.9).

export interface RegistryDeps {
  readonly clock: Clock;
  readonly scheduler: Scheduler;
  readonly logger: Logger;
  readonly masker: McpMasker;
  readonly transports: TransportFactory;
  readonly settings: () => McpSettings;
  /** 기동 승인을 올릴 대화(가장 최근에 정의를 읽은 대화). 없으면 undefined */
  readonly threadOf?: () => string | undefined;
  readonly client: { readonly name: string; readonly version: string };
  /** 서버 상태나 도구 목록이 바뀌었다. 단계 경계에서 반영할 서버를 모으는 쪽이 받는다 */
  readonly onChanged: (serverId: string) => void;
}

interface ServerError {
  readonly code: string;
  readonly message: string;
  readonly at: number;
}

/** 읽기 전용 스냅숏 */
export interface ServerSnapshot {
  readonly definition: ServerDefinition;
  readonly state: McpServerState;
  readonly blockedReason: BlockedReason | undefined;
  readonly protocolVersion: string | undefined;
  readonly tools: readonly RawTool[];
  readonly prompts: readonly RawPrompt[];
  readonly lastError: ServerError | undefined;
  readonly lastConnectedAt: number | undefined;
}

interface SyncEntry {
  readonly definition: ServerDefinition;
  readonly blockedReason: BlockedReason | undefined;
}

/** 호출 하나가 연결을 쓰는 동안 잡는 표. 놓으면 끄기와 정의 삭제가 연결을 닫을 수 있다 */
interface ConnectionLease {
  readonly connection: McpConnection;
  readonly definition: ServerDefinition;
  release(): void;
}

export interface ServerRegistry {
  /** 정의 집합을 맞춘다. 추가는 연결을 시작하고, 삭제는 닫고, 바뀐 정의는 다시 연결한다. 기다리지 않는다 */
  sync(entries: readonly SyncEntry[]): void;
  get(serverId: string): ServerSnapshot | undefined;
  list(): readonly ServerSnapshot[];
  /** 연결이 `connected`일 때만 표를 준다. 아니면 undefined */
  acquire(serverId: string): ConnectionLease | undefined;
  /** 꺼진·실패 서버를 켜고 연결한다. 시도가 끝나면 돌아온다 */
  connect(serverId: string): Promise<void>;
  /** 닫고 다시 연결한다. 도구 목록을 다시 읽는다 */
  reconnect(serverId: string): Promise<void>;
  /** 이 세션에서 끈다. 진행 중 호출은 제한 시간까지 끝나기를 기다린 뒤 닫는다 */
  disable(serverId: string): Promise<void>;
  /** 진행 중인 모든 연결 시도가 끝나기를 기다린다(시험과 종료) */
  settled(): Promise<void>;
  shutdown(): Promise<void>;
}

interface Entry {
  definition: ServerDefinition;
  blockedReason: BlockedReason | undefined;
  state: McpServerState;
  /** 세션에서 끈 서버. 정의의 enabled와 별개다 */
  sessionDisabled: boolean;
  connection: McpConnection | undefined;
  opened: OpenedTransport | undefined;
  tools: readonly RawTool[];
  prompts: readonly RawPrompt[];
  protocolVersion: string | undefined;
  lastError: ServerError | undefined;
  lastConnectedAt: number | undefined;
  failures: number;
  timer: TimerHandle | undefined;
  /** 연결 시도 세대. 새 시도나 닫기가 오래된 시도의 결과를 무효로 만든다 */
  generation: number;
  abort: AbortController | undefined;
  pending: Promise<void> | undefined;
  inflight: number;
  idle: (() => void)[];
  /** 우리가 닫는 중이라 연결 끊김을 장애로 보지 않는다 */
  closing: boolean;
  /** 비밀 env 서버가 사용자의 기동 승인을 기다린다(상태 blocked, 사유 approval_required) */
  awaitingApproval: boolean;
}

function freshEntry(definition: ServerDefinition, blockedReason: BlockedReason | undefined): Entry {
  return {
    definition,
    blockedReason,
    state: "disabled",
    sessionDisabled: false,
    connection: undefined,
    opened: undefined,
    tools: [],
    prompts: [],
    protocolVersion: undefined,
    lastError: undefined,
    lastConnectedAt: undefined,
    failures: 0,
    timer: undefined,
    generation: 0,
    abort: undefined,
    pending: undefined,
    inflight: 0,
    idle: [],
    closing: false,
    awaitingApproval: false,
  };
}

function sameDefinition(a: ServerDefinition, b: ServerDefinition): boolean {
  return a.source === b.source && canonicalJson(a.def) === canonicalJson(b.def);
}

function snapshotOf(entry: Entry): ServerSnapshot {
  return {
    definition: entry.definition,
    state: entry.state,
    blockedReason:
      entry.blockedReason ?? (entry.awaitingApproval ? "approval_required" : undefined),
    protocolVersion: entry.protocolVersion,
    tools: entry.tools,
    prompts: entry.prompts,
    lastError: entry.lastError,
    lastConnectedAt: entry.lastConnectedAt,
  };
}

export function createRegistry(deps: RegistryDeps): ServerRegistry {
  const entries = new Map<string, Entry>();

  function setState(entry: Entry, state: McpServerState): void {
    if (entry.state === state) return;
    entry.state = state;
    deps.onChanged(entry.definition.id);
  }

  function recordError(entry: Entry, code: string, message: string): void {
    entry.lastError = { code, message: deps.masker.mask(message), at: deps.clock.now() };
  }

  function clearTimer(entry: Entry): void {
    if (entry.timer !== undefined) {
      deps.scheduler.clearTimeout(entry.timer);
      entry.timer = undefined;
    }
  }

  /** 연결과 전송을 닫는다. 진행 중 호출이 있으면 `drainMs`까지 기다린다 */
  async function closeConnection(entry: Entry, drainMs: number): Promise<void> {
    const connection = entry.connection;
    entry.connection = undefined;
    entry.opened = undefined;
    if (connection === undefined) return;
    entry.closing = true;
    if (entry.inflight > 0) {
      await new Promise<void>((resolve) => {
        const handle = deps.scheduler.setTimeout(resolve, drainMs);
        entry.idle.push(() => {
          deps.scheduler.clearTimeout(handle);
          resolve();
        });
      });
    }
    await connection.close();
    entry.closing = false;
  }

  function scheduleAttempt(entry: Entry, delayMs: number): void {
    clearTimer(entry);
    const generation = entry.generation;
    entry.timer = deps.scheduler.setTimeout(() => {
      entry.timer = undefined;
      if (entry.generation !== generation) return;
      startAttempt(entry);
    }, delayMs);
  }

  function failAttempt(entry: Entry, code: string, message: string): void {
    recordError(entry, code, message);
    entry.failures += 1;
    const settings = deps.settings();
    if (entry.failures >= settings.reconnect.maxAttempts) {
      setState(entry, "failed");
      return;
    }
    setState(entry, "reconnecting");
    scheduleAttempt(entry, backoffDelayMs(entry.failures, settings.reconnect.maxDelayMs));
  }

  async function runAttempt(entry: Entry, generation: number): Promise<void> {
    const stale = (): boolean => entry.generation !== generation;
    const abort = new AbortController();
    entry.abort = abort;
    const settings = deps.settings();
    const connectMs = entry.definition.def.timeouts?.connectMs ?? settings.connectTimeoutMs;
    entry.awaitingApproval = false;
    const opened = await deps.transports.open(entry.definition, abort.signal, {
      sandbox: sandboxOf(entry.definition, settings),
      threadId: deps.threadOf?.(),
    });
    if (stale()) return;
    if (!opened.ok && opened.error.code === "approval_required") {
      // 사용자의 기동 승인을 기다린다. 장애가 아니라서 재시도 타이머와 실패 횟수를 쓰지 않는다. 응답이 오면 연결을 다시 시작한다
      entry.awaitingApproval = true;
      entry.lastError = undefined;
      setState(entry, "blocked");
      deps.onChanged(entry.definition.id);
      return;
    }
    if (!opened.ok) {
      failAttempt(entry, opened.error.code, opened.error.message);
      return;
    }
    const connected = await connectMcp({
      transport: opened.value.transport,
      negotiation: settings.versionNegotiation,
      connectTimeoutMs: connectMs,
      signal: abort.signal,
      client: deps.client,
      logger: deps.logger,
    });
    if (!connected.ok) {
      const tail = opened.value.stderrTail().slice(-3).join(" | ");
      if (!stale()) {
        failAttempt(
          entry,
          connected.error.code,
          tail.length > 0
            ? `${connected.error.message} (stderr: ${tail})`
            : connected.error.message,
        );
      }
      return;
    }
    const connection = connected.value;
    if (stale()) {
      await connection.close();
      return;
    }
    const listOptions = { signal: abort.signal, timeoutMs: connectMs };
    const noTools: Result<readonly RawTool[], McpFailure> = ok([]);
    const noPrompts: Result<readonly RawPrompt[], McpFailure> = ok([]);
    const tools = connection.serverCapabilities.includes("tools")
      ? await connection.listTools(listOptions)
      : noTools;
    const prompts = connection.serverCapabilities.includes("prompts")
      ? await connection.listPrompts(listOptions)
      : noPrompts;
    if (stale()) {
      await connection.close();
      return;
    }
    if (!tools.ok || !prompts.ok) {
      const failure = !tools.ok ? tools.error : prompts.ok ? undefined : prompts.error;
      await connection.close();
      failAttempt(entry, failure?.code ?? "protocol_error", failure?.message ?? "listing failed");
      return;
    }
    entry.connection = connection;
    entry.opened = opened.value;
    entry.tools = tools.value;
    entry.prompts = prompts.value;
    entry.protocolVersion = connection.protocolVersion;
    entry.lastConnectedAt = deps.clock.now();
    entry.failures = 0;
    connection.onClose(() => handleClosed(entry, generation));
    setState(entry, "connected");
    deps.onChanged(entry.definition.id);
  }

  function handleClosed(entry: Entry, generation: number): void {
    if (entry.generation !== generation || entry.closing) return;
    entry.connection = undefined;
    entry.opened = undefined;
    entry.failures = 0;
    recordError(entry, "server_disconnected", "the connection to the server was lost");
    setState(entry, "reconnecting");
    // 연결이 끊긴 순간 서버 도구는 바로 쓸 수 없다. 도구 집합에서 빼는 일은 다음 단계 경계가 한다
    deps.onChanged(entry.definition.id);
    scheduleAttempt(entry, backoffDelayMs(1, deps.settings().reconnect.maxDelayMs));
  }

  function startAttempt(entry: Entry): void {
    entry.generation += 1;
    const generation = entry.generation;
    if (entry.state !== "reconnecting") setState(entry, "connecting");
    const work = runAttempt(entry, generation).finally(() => {
      if (entry.pending === work) entry.pending = undefined;
    });
    entry.pending = work;
    detach(work, (cause) => {
      deps.logger.error("mcp.attempt_failed", {
        server: entry.definition.id,
        message: cause instanceof Error ? deps.masker.mask(cause.message) : "unknown",
      });
      recordError(entry, "internal", "connection attempt crashed");
      setState(entry, "failed");
    });
  }

  /** 시도를 시작하고 끝나기를 기다린다 */
  async function attemptNow(entry: Entry): Promise<void> {
    startAttempt(entry);
    await entry.pending;
  }

  /** 정의가 바뀐 서버를 닫고 새 정의로 다시 시작한다 */
  async function restart(entry: Entry): Promise<void> {
    await shutDownEntry(entry, drainMsOf(entry));
    entry.tools = [];
    entry.prompts = [];
    apply(entry);
  }

  /** 진행 중인 시도와 타이머를 무효로 만든다 */
  function invalidate(entry: Entry): void {
    entry.generation += 1;
    clearTimer(entry);
    entry.abort?.abort();
    entry.abort = undefined;
  }

  async function shutDownEntry(entry: Entry, drainMs: number): Promise<void> {
    invalidate(entry);
    await closeConnection(entry, drainMs);
  }

  function drainMsOf(entry: Entry): number {
    return entry.definition.def.timeouts?.callMs ?? deps.settings().callTimeoutMs;
  }

  function apply(entry: Entry): void {
    if (entry.blockedReason !== undefined) {
      setState(entry, "blocked");
      return;
    }
    if (entry.definition.def.enabled === false || entry.sessionDisabled) {
      setState(entry, "disabled");
      return;
    }
    entry.failures = 0;
    startAttempt(entry);
  }

  return {
    sync(next) {
      const wanted = new Set(next.map((item) => item.definition.id));
      for (const [id, entry] of entries) {
        if (wanted.has(id)) continue;
        entries.delete(id);
        detach(shutDownEntry(entry, drainMsOf(entry)), (cause) =>
          deps.logger.error("mcp.close_failed", {
            server: id,
            message: cause instanceof Error ? deps.masker.mask(cause.message) : "unknown",
          }),
        );
        deps.onChanged(id);
      }
      for (const item of next) {
        const existing = entries.get(item.definition.id);
        if (existing === undefined) {
          const entry = freshEntry(item.definition, item.blockedReason);
          entries.set(item.definition.id, entry);
          apply(entry);
          continue;
        }
        const changed =
          !sameDefinition(existing.definition, item.definition) ||
          existing.blockedReason !== item.blockedReason;
        if (!changed) continue;
        existing.definition = item.definition;
        existing.blockedReason = item.blockedReason;
        detach(restart(existing), (cause) =>
          deps.logger.error("mcp.restart_failed", {
            server: item.definition.id,
            message: cause instanceof Error ? deps.masker.mask(cause.message) : "unknown",
          }),
        );
        deps.onChanged(item.definition.id);
      }
    },
    get(serverId) {
      const entry = entries.get(serverId);
      return entry === undefined ? undefined : snapshotOf(entry);
    },
    list() {
      return [...entries.values()].map(snapshotOf);
    },
    acquire(serverId) {
      const entry = entries.get(serverId);
      if (entry === undefined || entry.state !== "connected" || entry.connection === undefined) {
        return undefined;
      }
      entry.inflight += 1;
      let released = false;
      return {
        connection: entry.connection,
        definition: entry.definition,
        release() {
          if (released) return;
          released = true;
          entry.inflight -= 1;
          if (entry.inflight === 0) {
            const waiters = entry.idle.splice(0);
            for (const wake of waiters) wake();
          }
        },
      };
    },
    async connect(serverId) {
      const entry = entries.get(serverId);
      if (entry === undefined || entry.blockedReason !== undefined) return;
      entry.sessionDisabled = false;
      await shutDownEntry(entry, drainMsOf(entry));
      entry.failures = 0;
      await attemptNow(entry);
    },
    async reconnect(serverId) {
      const entry = entries.get(serverId);
      if (entry === undefined || entry.blockedReason !== undefined) return;
      entry.sessionDisabled = false;
      await shutDownEntry(entry, drainMsOf(entry));
      entry.failures = 0;
      await attemptNow(entry);
    },
    async disable(serverId) {
      const entry = entries.get(serverId);
      if (entry === undefined) return;
      entry.sessionDisabled = true;
      setState(entry, "disabled");
      await shutDownEntry(entry, drainMsOf(entry));
    },
    settled() {
      return repeatAsync(async () => {
        const waiting = [...entries.values()].flatMap((entry) =>
          entry.pending === undefined ? [] : [entry.pending],
        );
        if (waiting.length === 0) return { value: undefined };
        await Promise.all(waiting);
        return undefined;
      });
    },
    async shutdown() {
      const all = [...entries.values()];
      entries.clear();
      await Promise.all(all.map((entry) => shutDownEntry(entry, 0)));
    },
  };
}
