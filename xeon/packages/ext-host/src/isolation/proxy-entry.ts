// 격리 확장의 엔진 쪽 대리 등록(M5b-1 part 2). 플러그인 호스트 프로세스가 선언한 등록을 엔진의 실제 ExtHost에 같은 모양으로 등록한다.
// 훅, 도구, 명령, 메서드 호출은 감독(supervisor)으로 보내고, 자식이 `engine.call`로 부르는 상태 쓰기와 기록은 등록 라우터가
// 실제 `g`로 옮긴다. 감독 하나는 세션이다. 엔트리가 처음 연고, 등록이 모두 꺼지면 닫고, 다시 켜지면 새로 연다.
// 이 파일은 던진다. 호출자(디스패처)는 던진 `PluginProcessError`로 실패 이유를 알고, 그 밖의 값은 `threw`로 센다.
import { Type, type Static, type TSchema } from "typebox";
import {
  assertNever,
  attempt,
  Bug,
  detach,
  err,
  ok,
  parse,
  rethrow,
  type Logger,
  type Result,
} from "@fresnel/contracts";
import { ToolHintsSchema, ToolNameSchema, ToolRiskSchema } from "@fresnel/contracts/capabilities";
import { JsonValueSchema, toJsonValue, type JsonValue } from "@fresnel/contracts/conversation";
import {
  HOOKS,
  PLUGIN_HOST_NOTIFY_HOOKS,
  PLUGIN_HOST_PROTOCOL_VERSION,
  RecordKindSchema,
  type ExtensionEntry,
  type ExtensionManifest,
  type ExtensionName,
  type HookName,
  type HostDisposeParams,
  type HostInitParams,
  type IsolationProcessPort,
  type IsolationSpawnSpec,
  type PluginHostRequestName,
  type PluginRegistrationDecl,
  type RecordKind,
  type RegistrationApi,
  type RegistrationDef,
  type RegistrationSetup,
  type ToolChangeReport,
  type ToolResourceDef,
} from "@fresnel/contracts/extensions";
import { handlerOfHook, stateAs } from "../erase.ts";
import { ambient, type Ambient } from "../primitives/ambient.ts";
import type { AnyState } from "../primitives/erased-types.ts";
import type { ExtMethodResourceDef } from "../primitives/ext-method.ts";
import { hostOf } from "../primitives/host-api.ts";
import type {
  CommandResourceDef,
  FlagResourceDef,
  RendererResourceDef,
} from "../primitives/resources.ts";
import { isHookName } from "./child-api.ts";
import { createEngineCallRouter } from "./engine-calls.ts";
import { PluginProcessError } from "./errors.ts";
import {
  createPluginHostSupervisor,
  type CallError,
  type PluginHostSupervisor,
  type RestartLimitInfo,
  type SupervisorError,
} from "./supervisor.ts";

/** 시작 응답 시간 기본 한도(ms). 자식이 엔트리를 싣고 등록을 만드는 시간이다 */
const DEFAULT_INIT_TIMEOUT_MS = 10_000;

/** 이 종류의 오류는 프로세스가 없어서 생긴 것이다. 호출은 `process_exit`로 센다 */
const SUPERVISOR_FAILURE_KINDS: ReadonlySet<string> = new Set([
  "spawn_failed",
  "sandbox_unavailable",
  "init_failed",
  "init_timeout",
  "restart_limit",
  "declarations_changed",
  "disposed",
]);

/** 기록을 주입하지 않았을 때 쓰는 로거. 기록을 버린다(주입된 로거가 있으면 그것을 쓴다) */
const SILENT: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  child: () => SILENT,
};

/** 격리 확장 시작 실패. `code`는 로더 진단 코드와 같은 이름이다(X.loading-trust.spec §4.9, 격리 실패 표) */
export type IsolatedEntryCode =
  | "isolation_unavailable"
  | "isolation_drive_unsupported"
  | "isolation_protocol"
  | "entry_threw";

export class IsolatedEntryError extends Error {
  override readonly name: string = "IsolatedEntryError";
  readonly code: IsolatedEntryCode;

  constructor(code: IsolatedEntryCode, message: string) {
    super(message);
    this.code = code;
  }
}

/** 띄울 프로세스 정보. 앱의 `launch`가 명령과 환경을 고른다 */
export interface IsolationLaunchInfo {
  readonly name: ExtensionName;
  /** 확장 루트 절대 경로. 읽기 전용으로 열린다 */
  readonly root: string;
  /** 매니페스트 `entry`(루트 상대 경로) */
  readonly entry: string;
  /** 판 식별자. 라벨 `ext:<이름>:<versionId>`에 쓴다 */
  readonly versionId: string;
}

/** 띄울 명령. 환경은 허용 목록으로만 만든다(시크릿과 DB 경로를 넣지 않는다) */
export interface IsolationLaunch {
  readonly command: string;
  readonly args: readonly string[];
  readonly env: Readonly<Record<string, string>>;
}

/** 대리 등록 하나를 만드는 의존. 감독 설정과 시계를 주입받는다 */
export interface IsolatedEntryDeps {
  /** 매니페스트. host.init의 `manifest`와 설정 키 목록을 만든다 */
  readonly manifest: ExtensionManifest;
  /** 확장 루트 절대 경로 */
  readonly root: string;
  /** 판 식별자(라벨과 host.init의 versionId) */
  readonly versionId: string;
  readonly port: IsolationProcessPort;
  readonly launch: (info: IsolationLaunchInfo) => IsolationLaunch;
  readonly setTimer: (ms: number, fn: () => void) => () => void;
  readonly now: () => number;
  /** 표준오류 줄 마스킹과 감독의 진단이 쓴다. 없으면 기록을 버린다 */
  readonly logger?: Logger;
  /** 설정 키의 유효 값. host.init의 설정에 쓴다(`hostOf(g).settingValue`와 같은 값) */
  readonly settingValue?: (key: string) => unknown;
  readonly initTimeoutMs?: number;
  readonly idleMs?: number;
  readonly killGraceMs?: number;
  readonly maxRestarts?: number;
  readonly maskSecrets?: (line: string) => string;
  /** 등록이 모두 꺼져 세션을 닫을 때의 사유. 다시 읽기 중이면 `reload`다 */
  readonly endReason?: () => "reload" | "disabled";
  readonly onRestartLimit?: (info: RestartLimitInfo) => void;
  /** 세션(감독)을 열 때마다 한 번 부른다. 로더는 이것으로 끊을 감독을 안다 */
  readonly onSupervisor?: (supervisor: PluginHostSupervisor) => void;
}

/** 자식이 보낸 도구 선언(`PluginToolDecl.def`)의 모양. `execute`는 빠져 있다 */
const ToolDeclSchema = Type.Object({
  name: ToolNameSchema,
  description: Type.String(),
  parameters: JsonValueSchema,
  replay: Type.Union([Type.Literal("safe"), Type.Literal("unsafe")]),
  exposure: Type.Optional(Type.Union([Type.Literal("always"), Type.Literal("deferred")])),
  risk: Type.Optional(ToolRiskSchema),
  hints: Type.Optional(ToolHintsSchema),
  replaces: Type.Optional(
    Type.Object({
      extension: Type.String(),
      trust: Type.Union([
        Type.Literal("builtin"),
        Type.Literal("user"),
        Type.Literal("project"),
        Type.Literal("untrusted"),
      ]),
    }),
  ),
});

const FlagDeclSchema = Type.Object({
  type: Type.Union([Type.Literal("boolean"), Type.Literal("string")]),
  description: Type.Optional(Type.String()),
  default: Type.Optional(Type.Union([Type.Boolean(), Type.String()])),
});

/** `CommandOutput`(resources.ts)의 모양. 문자열이면 메시지만이다 */
const CommandOutputSchema = Type.Union([
  Type.String(),
  Type.Object({
    message: Type.Union([Type.String(), Type.Null()]),
    result: Type.Optional(JsonValueSchema),
  }),
]);

type ToolDef = Omit<ToolResourceDef, "execute">;

/** 검증을 마친 선언. 등록을 만들기 전에 모두 만들어 두어, 하나라도 맞지 않으면 아무것도 등록하지 않는다 */
interface PreparedDecl {
  readonly decl: PluginRegistrationDecl;
  readonly def: RegistrationDef<AnyState>;
  readonly hasState: boolean;
  /** 상태의 초기 문서(JSON). 상태가 없으면 null */
  readonly initial: JsonValue;
  readonly hooks: readonly { readonly point: HookName; readonly handlerIndex: number }[];
  readonly tools: readonly ToolDef[];
  readonly flags: readonly { readonly name: string; readonly def: FlagResourceDef }[];
  readonly renderers: readonly {
    readonly customType: RecordKind;
    readonly def: RendererResourceDef;
  }[];
}

/** 세션 하나: 감독과, 요청 id에서 디스패치 문맥으로 가는 표 */
interface Session {
  readonly supervisor: PluginHostSupervisor;
  readonly ambients: Map<number, Ambient>;
  /** 도구 실행 요청 id에서 그 호출의 `ctx.changes`로 가는 표 */
  readonly changes: Map<number, ToolChangeReport>;
}

/** 훅 디스패처가 넘기는 문맥(`{scopeId, state, threadId, signal}`). 모양을 확인한 뒤 읽는다 */
interface HookContext {
  readonly state: unknown;
  readonly threadId: unknown;
  readonly signal: AbortSignal;
}

function isHookContext(value: unknown): value is HookContext {
  return (
    typeof value === "object" &&
    value !== null &&
    "state" in value &&
    "threadId" in value &&
    "signal" in value &&
    value.signal instanceof AbortSignal
  );
}

/**
 * 자식이 보낸 JSON Schema 문서를 검증에 쓰는 스키마로 쓴다. TypeBox 1.x의 `TSchema`는 구조 타입이고 스키마는 JSON Schema 객체다.
 * `Compile`은 JSON Schema 키워드로 검사하므로 깊은 검사가 그대로 된다. 정적 타입은 주장하지 않는다(`parse`의 Static은 unknown이다).
 * 그래서 `Type.Unsafe`를 쓰지 않는다(TY-26 허용 모양이 아니다)
 */
export function schemaOfJson(json: JsonValue): TSchema | undefined {
  if (json === null || typeof json !== "object" || Array.isArray(json)) return undefined;
  return json;
}

/** `drive` 또는 다른 막힌 API 이름 목록을 메시지에서 읽는다(child-api의 `unsupported`가 낸 문장) */
function unsupportedNamesOf(message: string): readonly string[] {
  const marker = " uses ";
  const start = message.indexOf(marker);
  if (start < 0) return [];
  const from = start + marker.length;
  const end = message.indexOf(", which", from);
  return (end < 0 ? message.slice(from) : message.slice(from, end)).split(", ");
}

function startErrorOf(error: SupervisorError): IsolatedEntryError {
  switch (error.kind) {
    case "spawn_failed":
    case "sandbox_unavailable":
      return new IsolatedEntryError("isolation_unavailable", error.message);
    case "init_failed":
      if (error.hostKind === "unsupported_api") {
        return unsupportedNamesOf(error.message).includes("drive")
          ? new IsolatedEntryError("isolation_drive_unsupported", error.message)
          : new IsolatedEntryError("isolation_protocol", error.message);
      }
      return error.hostKind === "handler_threw"
        ? new IsolatedEntryError("entry_threw", error.message)
        : new IsolatedEntryError("isolation_protocol", error.message);
    case "init_timeout":
    case "process_exit":
    case "restart_limit":
    case "declarations_changed":
    case "disposed":
      return new IsolatedEntryError("isolation_protocol", error.message);
    default:
      return assertNever(error, "SupervisorError");
  }
}

/** 호출 실패를 디스패처가 읽는 오류로 바꾼다. 프로세스 종료와 시간 초과는 `PluginProcessError`다 */
function failureOf(error: CallError): Error {
  if (error.kind === "process_killed") {
    return new PluginProcessError("process_killed", error.message);
  }
  if (error.kind === "process_exit" || SUPERVISOR_FAILURE_KINDS.has(error.kind)) {
    return new PluginProcessError("process_exit", error.message);
  }
  return new Error(error.message);
}

/** 응답을 값으로 바꾼다. `null`은 undefined다(자식이 값을 내지 않았다) */
function settledOf(reply: Result<JsonValue, CallError>): JsonValue | undefined {
  if (!reply.ok) throw failureOf(reply.error);
  return reply.value === null ? undefined : reply.value;
}

function jsonOf(value: unknown, what: string): JsonValue {
  const json = toJsonValue(value);
  if (json === undefined) throw new Error(`${what} is not JSON`);
  return json;
}

/** 선언 하나를 검증한다. 등록에 쓸 정의와 리소스 정의를 만든다. 실패는 사람이 읽는 사유 문장이다 */
function prepareDecl(decl: PluginRegistrationDecl): Result<PreparedDecl, string> {
  const hooks: { point: HookName; handlerIndex: number }[] = [];
  for (const hook of decl.hooks) {
    if (!isHookName(hook.point)) return err(`hook point ${hook.point} of ${decl.id} is unknown`);
    hooks.push({ point: hook.point, handlerIndex: hook.handlerIndex });
  }
  let stateDef: RegistrationDef<AnyState>["state"];
  if (decl.state !== null) {
    const schema = schemaOfJson(decl.state.schema);
    if (schema === undefined) return err(`state schema of ${decl.id} is not a JSON Schema`);
    stateDef = { schema, initial: stateAs(decl.state.initial), version: decl.state.version };
  }
  const def: RegistrationDef<AnyState> = {
    ...(stateDef === undefined ? {} : { state: stateDef }),
    ...(decl.defaultEnabled === null ? {} : { defaultEnabled: decl.defaultEnabled }),
  };
  const tools: ToolDef[] = [];
  for (const entry of decl.tools) {
    const parsed = parse(ToolDeclSchema, entry.def);
    if (!parsed.ok || parsed.value.name !== entry.name) {
      return err(`tool ${entry.name} of ${decl.id} does not match its declaration`);
    }
    const parameters = schemaOfJson(parsed.value.parameters);
    if (parameters === undefined) return err(`tool ${entry.name} of ${decl.id} has no schema`);
    tools.push(toolDefOf(parsed.value, parameters));
  }
  const flags: { name: string; def: FlagResourceDef }[] = [];
  for (const entry of decl.flags) {
    const parsed = parse(FlagDeclSchema, entry.def);
    if (!parsed.ok) return err(`flag ${entry.name} of ${decl.id} does not match its declaration`);
    flags.push({ name: entry.name, def: flagDefOf(parsed.value) });
  }
  const renderers: { customType: RecordKind; def: RendererResourceDef }[] = [];
  for (const entry of decl.renderers) {
    const kind = parse(RecordKindSchema, entry.customType);
    if (!kind.ok) return err(`renderer ${entry.customType} of ${decl.id} is not a record kind`);
    renderers.push({ customType: kind.value, def: { module: entry.module, export: entry.export } });
  }
  return ok({
    decl,
    def,
    hasState: decl.state !== null,
    initial: decl.state?.initial ?? null,
    hooks,
    tools,
    flags,
    renderers,
  });
}

function toolDefOf(decl: Static<typeof ToolDeclSchema>, parameters: TSchema): ToolDef {
  return {
    name: decl.name,
    description: decl.description,
    parameters,
    replay: decl.replay,
    ...(decl.exposure === undefined ? {} : { exposure: decl.exposure }),
    ...(decl.risk === undefined ? {} : { risk: decl.risk }),
    ...(decl.hints === undefined ? {} : { hints: decl.hints }),
    ...(decl.replaces === undefined ? {} : { replaces: decl.replaces }),
  };
}

function flagDefOf(decl: Static<typeof FlagDeclSchema>): FlagResourceDef {
  return {
    type: decl.type,
    ...(decl.description === undefined ? {} : { description: decl.description }),
    ...(decl.default === undefined ? {} : { default: decl.default }),
  };
}

/** 설정 키의 유효 값을 JSON 객체로 모은다. 값이 없는 키는 빠진다(엔진 쪽 `settingValue`와 같다) */
function settingsWith(
  read: (key: string) => unknown,
  keys: readonly string[],
): Record<string, JsonValue> {
  const out: Record<string, JsonValue> = {};
  for (const key of keys) {
    const value = toJsonValue(read(key));
    if (value !== undefined) out[key] = value;
  }
  return out;
}

/**
 * 호출 때의 상태 문서. 상태가 없거나 thread가 없거나 열려 있지 않으면 초기 문서다. 자식은 이 값을 `g.state()`로 읽는다
 */
function stateNow(
  g: RegistrationApi<AnyState>,
  p: PreparedDecl,
  threadId: string | null,
  open: boolean,
): JsonValue {
  if (!p.hasState || threadId === null || !open) return p.initial;
  return jsonOf(g.state(), `the state of ${p.decl.id}`);
}

function requireEntry(entry: string | undefined): string {
  if (entry === undefined) throw new Bug("isolation.entry_missing");
  return entry;
}

/**
 * 격리 확장의 엔트리를 만든다. 엔트리는 설치 때 한 번 돈다. 감독을 열고 `host.init`으로 등록 선언을 받아, 같은 등록을
 * 실제 `host.register`로 만든다(setup에서 대리 훅, 도구, 명령, 메서드, 플래그, provider, MCP 서버, 렌더러를 붙인다).
 * 시작에 실패하면 `IsolatedEntryError`를 던진다. 설치가 그 값을 진단 코드로 옮긴다(entry-loader.ts)
 */
export function createIsolatedEntry(deps: IsolatedEntryDeps): ExtensionEntry {
  const logger = deps.logger ?? SILENT;
  // 코드 없는 확장(`entry` 없음)은 로더가 엔진 안으로 정한다(`no_entry`). 여기에 오면 로더의 불변 조건 위반이다
  const entryPath = requireEntry(deps.manifest.entry);
  const settingKeys = Object.values(deps.manifest.userConfig ?? {}).map((entry) => entry.setting);
  const registrations = new Map<string, RegistrationApi<AnyState>>();
  const eventCounters = new Map<string, number>();
  const endReason = deps.endReason ?? ((): "reload" | "disabled" => "disabled");
  /** 살아 있는 등록 수(setup이 돌고 아직 정리되지 않은 것). 0이 되면 세션을 닫는다 */
  let live = 0;
  let current: Session | undefined;

  function initParamsOf(): HostInitParams {
    return {
      protocolVersion: PLUGIN_HOST_PROTOCOL_VERSION,
      extension: deps.manifest.name,
      versionId: deps.versionId,
      manifest: jsonOf(deps.manifest, "the manifest"),
      root: deps.root,
      entry: entryPath,
      settings: settingsWith((key) => deps.settingValue?.(key), settingKeys),
    };
  }

  function spawnSpecOf(): IsolationSpawnSpec {
    const launch = deps.launch({
      name: deps.manifest.name,
      root: deps.root,
      entry: entryPath,
      versionId: deps.versionId,
    });
    return {
      command: launch.command,
      args: [...launch.args],
      readRoot: deps.root,
      env: { ...launch.env },
      label: `ext:${deps.manifest.name}:${deps.versionId}`,
    };
  }

  function openSession(): Session {
    const ambients = new Map<number, Ambient>();
    const changes = new Map<number, ToolChangeReport>();
    const router = createEngineCallRouter({
      gOf: (registration) => registrations.get(registration),
      replayOf: () => false,
      ambientOf: (requestId) => (requestId === null ? undefined : ambients.get(requestId)),
      changesOf: (requestId) => (requestId === null ? undefined : changes.get(requestId)),
    });
    const supervisor = createPluginHostSupervisor({
      process: deps.port,
      specOf: spawnSpecOf,
      setTimer: deps.setTimer,
      now: deps.now,
      logger,
      initParams: initParamsOf,
      initTimeoutMs: deps.initTimeoutMs ?? DEFAULT_INIT_TIMEOUT_MS,
      onEngineCall: router,
      onRestartLimit: (info) => {
        deps.onRestartLimit?.(info);
      },
      ...(deps.idleMs === undefined ? {} : { idleMs: deps.idleMs }),
      ...(deps.killGraceMs === undefined ? {} : { killGraceMs: deps.killGraceMs }),
      ...(deps.maxRestarts === undefined ? {} : { maxRestarts: deps.maxRestarts }),
      ...(deps.maskSecrets === undefined ? {} : { maskSecrets: deps.maskSecrets }),
    });
    return { supervisor, ambients, changes };
  }

  /** 떠 있는 세션을 돌려준다. 없으면 연다(다시 켜진 등록이 부른다) */
  function sessionNow(): Session {
    if (current !== undefined) return current;
    const opened = openSession();
    current = opened;
    deps.onSupervisor?.(opened.supervisor);
    return opened;
  }

  function retire(reason: HostDisposeParams["reason"]): void {
    const closing = current;
    current = undefined;
    closing?.supervisor.dispose(reason);
  }

  /** 호출 하나를 감독에 보낸다. 요청 id를 디스패치 문맥에 잇는다(라우터가 쓴다) */
  function invoke(
    method: PluginHostRequestName,
    params: JsonValue,
    signal: AbortSignal | undefined,
    amb: Ambient | undefined,
    changes?: ToolChangeReport,
  ): Promise<Result<JsonValue, CallError>> {
    const session = sessionNow();
    let requestId: number | undefined;
    const call = session.supervisor.call(method, params, {
      ...(signal === undefined ? {} : { signal }),
      onRequestId: (id) => {
        requestId = id;
        if (amb !== undefined) session.ambients.set(id, amb);
        if (changes !== undefined) session.changes.set(id, changes);
      },
    });
    return call.finally(() => {
      if (requestId !== undefined) {
        session.ambients.delete(requestId);
        session.changes.delete(requestId);
      }
    });
  }

  /** 호출 문맥의 공통 필드. 상태와 설정은 호출 때의 값이다 */
  function frameOf(g: RegistrationApi<AnyState>, threadId: string | null, state: JsonValue) {
    return {
      threadId,
      deadlineMs: null,
      replay: false,
      caller: "engine",
      state,
      settings: settingsWith((key) => hostOf(g).settingValue(key), settingKeys),
    };
  }

  function hookHandler(
    g: RegistrationApi<AnyState>,
    p: PreparedDecl,
    point: HookName,
    handlerIndex: number,
  ): (...args: readonly unknown[]) => unknown {
    const notify = PLUGIN_HOST_NOTIFY_HOOKS.some((name) => name === point);
    const chain = HOOKS[point].fold === "chain";
    const eventBase = `${p.decl.id}:${point}:${handlerIndex}`;
    return (...args) => {
      // 디스패처는 (payload, current?, ctx)를 넘긴다. 문맥은 마지막 인자다
      const amb = ambient();
      const context = args[args.length - 1];
      if (!isHookContext(context)) throw new Bug("isolation.hook_context_missing");
      const threadId = typeof context.threadId === "string" ? context.threadId : null;
      const state = p.hasState ? jsonOf(context.state, `the state of ${p.decl.id}`) : null;
      const payload = jsonOf(args[0], `the ${point} payload`);
      const currentValue = chain ? jsonOf(args[1], `the ${point} current value`) : null;
      const body = {
        ...frameOf(g, threadId, state),
        registration: p.decl.id,
        point,
        handlerIndex,
        payload,
        current: currentValue,
        ...(amb === undefined || amb.dispatchKey === null ? {} : { dispatchKey: amb.dispatchKey }),
      };
      if (notify) {
        // 관찰 알림은 기다리지 않는다. 발화 순서대로 하나씩 전달하도록 eventKey를 늘린다(멱등 키)
        const next = (eventCounters.get(eventBase) ?? 0) + 1;
        eventCounters.set(eventBase, next);
        const sent = sessionNow().supervisor.notify(
          "event.notify",
          jsonOf({ ...body, eventKey: `${eventBase}#${next}` }, "the event"),
        );
        detach(
          sent.then((reply) => {
            if (!reply.ok) logger.warn("plugin_host.notify_failed", { point });
            return reply.ok;
          }),
          () => {
            logger.error("plugin_host.notify_unhandled", { point });
          },
        );
        return undefined;
      }
      return invoke("hook.invoke", jsonOf(body, "the hook call"), context.signal, amb).then(
        settledOf,
      );
    };
  }

  function toolOf(g: RegistrationApi<AnyState>, p: PreparedDecl, tool: ToolDef): ToolResourceDef {
    return {
      ...tool,
      async execute(args, ctx) {
        const amb = ambient();
        const state = stateNow(g, p, ctx.threadId, true);
        const body = jsonOf(
          {
            ...frameOf(g, ctx.threadId, state),
            registration: p.decl.id,
            name: tool.name,
            args,
            toolCallId: ctx.toolCallId,
            callerInfo: ctx.caller,
          },
          "the tool call",
        );
        return settledOf(await invoke("tool.execute", body, ctx.signal, amb, ctx.changes));
      },
    };
  }

  function commandOf(
    g: RegistrationApi<AnyState>,
    p: PreparedDecl,
    name: string,
    description: string | null,
  ): CommandResourceDef {
    return {
      ...(description === null ? {} : { description }),
      async handler(args, ctx) {
        const amb = ambient();
        const state = stateNow(g, p, ctx.threadId, true);
        const body = jsonOf(
          {
            ...frameOf(g, ctx.threadId, state),
            registration: p.decl.id,
            name,
            args,
            invocationId: ctx.invocationId,
          },
          "the command call",
        );
        const value = settledOf(await invoke("command.run", body, ctx.signal, amb));
        if (value === undefined) return undefined;
        const output = parse(CommandOutputSchema, value);
        if (!output.ok) throw new Error(`the output of command ${name} does not match its shape`);
        return output.value;
      },
    };
  }

  function methodOf(
    g: RegistrationApi<AnyState>,
    p: PreparedDecl,
    verb: string,
  ): ExtMethodResourceDef {
    return {
      async handler(params, ctx) {
        const amb = ambient();
        const state = stateNow(g, p, ctx.threadId, ctx.threadOpen !== false);
        const body = jsonOf(
          {
            ...frameOf(g, ctx.threadId, state),
            registration: p.decl.id,
            verb,
            params: jsonOf(params, "the method params"),
            callId: ctx.callId,
            callerKind: ctx.caller,
          },
          "the method call",
        );
        return settledOf(await invoke("method.call", body, ctx.signal, amb));
      },
    };
  }

  /** 등록 하나의 setup. 실제 `g`를 받아 대리 훅과 리소스를 붙이고, 정리 때 자식의 정리 동작과 세션 닫기를 맡는다 */
  function setupOf(p: PreparedDecl): RegistrationSetup<AnyState> {
    return (g) => {
      registrations.set(p.decl.id, g);
      // 정리 동작을 먼저 건다. setup이 중간에 던지면 등록은 세지 않은 채 끝나므로 `live`가 어긋나지 않는다
      let active = false;
      g.onDispose(async () => {
        if (!active) return;
        active = false;
        live -= 1;
        if (p.decl.hasDisposers && current?.supervisor.status().state === "running") {
          const done = await invoke(
            "scope.dispose",
            jsonOf({ registration: p.decl.id }, "the scope"),
            undefined,
            undefined,
          );
          if (!done.ok)
            logger.warn("plugin_host.scope_dispose_failed", { registration: p.decl.id });
        }
        if (live === 0) retire(endReason());
      });
      const host = hostOf(g);
      for (const hook of p.hooks) {
        g.on(
          hook.point,
          handlerOfHook(hook.point, hookHandler(g, p, hook.point, hook.handlerIndex)),
        );
      }
      for (const tool of p.tools) host.registerTool(toolOf(g, p, tool));
      for (const command of p.decl.commands) {
        host.registerCommand(command.name, commandOf(g, p, command.name, command.description));
      }
      for (const method of p.decl.methods) {
        host.registerMethod(method.verb, methodOf(g, p, method.verb));
      }
      for (const flag of p.flags) host.registerFlag(flag.name, flag.def);
      for (const provider of p.decl.providers)
        host.registerProvider(provider.name, provider.config);
      for (const server of p.decl.mcpServers) host.registerMcpServer(server.name, server.config);
      for (const renderer of p.renderers) {
        host.registerMessageRenderer(renderer.customType, renderer.def);
      }
      live += 1;
      active = true;
    };
  }

  return async (host) => {
    const session = sessionNow();
    const started = await session.supervisor.start();
    if (!started.ok) {
      retire("disabled");
      throw startErrorOf(started.error);
    }
    const prepared: PreparedDecl[] = [];
    for (const decl of started.value.registrations) {
      const result = prepareDecl(decl);
      if (!result.ok) {
        retire("disabled");
        throw new IsolatedEntryError("isolation_protocol", result.error);
      }
      prepared.push(result.value);
    }
    for (const p of prepared) {
      const registered = attempt(() => host.register(p.decl.id, p.def, setupOf(p)));
      if (!registered.ok) {
        retire("disabled");
        rethrow(registered.error.cause);
      }
    }
  };
}
