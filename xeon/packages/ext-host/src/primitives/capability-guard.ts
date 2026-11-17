import { createHash } from "node:crypto";
import { canonicalJson, type Result } from "@fresnel/contracts";
import {
  CapabilityError,
  type AnyCapabilityDef,
  type CallContext,
  type CallOptions,
  type CapabilityId,
  type MethodDef,
  type PluginCallVia,
  type PluginCallRequest,
  type ToolError,
  type ToolResultView,
} from "@fresnel/contracts/capabilities";
import {
  toJsonValue,
  type JsonObject,
  type JsonValue,
  type ThreadId,
} from "@fresnel/contracts/conversation";
import {
  capabilityEffectOf,
  isEffectAllowed,
  type LoopCallConditions,
  REPLAY_EFFECT_TABLE,
  type ExtensionName,
  type PortKey,
  type PortLookup,
  type ReplayContext,
  type ReplayEffect,
  type RegistrationId,
  type ToolsPort,
  ToolsPortKey,
} from "@fresnel/contracts/extensions";
import {
  ambient,
  hookStackOf,
  inReadOnlyMethod,
  withAmbient,
  withoutAmbient,
  type Ambient,
  type HookFrame,
} from "./ambient.ts";

/**
 * 기능 id로 정의를 찾는다. `g.capability`가 돌려주는 서비스는 호출 때 메서드의 효과 분류(`idempotent`, `readOnly`)를 알아야 하는데
 * `ServiceKey`는 id와 버전만 싣는다. 그래서 조립 루트가 정의 표를 `ExtHostDeps.capabilityDefs`로 넘긴다(X.primitives.spec §4.4.7).
 * 정의를 못 찾으면 그 기능의 모든 메서드를 선언 없음으로 본다(재실행되는 코드에서는 거부)
 */
export type CapabilityDefLookup = (id: CapabilityId) => AnyCapabilityDef | undefined;

/** 정의 목록으로 조회 함수를 만든다. 같은 id가 여럿이면 뒤의 것이 이긴다 */
export function capabilityDefTable(defs: readonly AnyCapabilityDef[]): CapabilityDefLookup {
  const byId = new Map(defs.map((def) => [def.id, def]));
  return (id) => byId.get(id);
}

const NO_DEFS: CapabilityDefLookup = () => undefined;
export const EMPTY_CAPABILITY_DEFS: CapabilityDefLookup = NO_DEFS;

/** 설정 `l1.tools.pluginCalls`의 키. core-tools가 소유한다. X는 core-tools를 import하지 못하므로 같은 문자열을 여기 둔다 */
const PLUGIN_CALLS_SETTING = "l1.tools.pluginCalls";

/** `fresnel.settings` 포트(조립 루트가 올린다). 설정 키의 유효 값을 읽는다 */
export const SETTINGS_READ_PORT: PortKey<{ value(key: string): unknown }> = {
  name: "fresnel.settings",
};

/**
 * 플러그인 기능 호출의 경로 설정(hooks-core-boundary §5.3 U-1, §9 7단계). 포트와 설정은 호출마다 읽는다.
 * 포트가 없거나 설정이 꺼져 있으면 옛 직접 경로를 쓴다
 */
export interface PluginCallWiring {
  /** `ToolsPort`(fresnel.tools). 조립에 없으면 undefined */
  readonly tools: () => ToolsPort | undefined;
  /** `l1.tools.pluginCalls`. 설정이 없으면 기본값 참이다 */
  readonly enabled: () => boolean;
}

export function pluginCallWiringOf(ports: PortLookup): PluginCallWiring {
  return {
    tools: () => ports.get(ToolsPortKey),
    enabled: () => ports.get(SETTINGS_READ_PORT)?.value(PLUGIN_CALLS_SETTING) !== false,
  };
}

/**
 * 기능 호출 하나의 경로(U-1). `pipeline`은 `executeForPlugin`을 부른다. `light`(readOnly이고 도구 매핑이 없음)와 `direct`는
 * 옛 직접 호출이다. 가벼운 경로의 호출 줄은 턴 기록 포트가 아직 없어 남기지 않는다(M5d에서 더한다)
 */
export type CallRoute = "pipeline" | "light" | "direct";

export function routeOf(
  wiring: PluginCallWiring,
  id: CapabilityId,
  method: string,
  decl: MethodDef | undefined,
): CallRoute {
  const port = wiring.tools();
  if (decl === undefined || port === undefined || !wiring.enabled()) return "direct";
  if (port.toolMappedFor(id, method)) return "pipeline";
  return capabilityEffectOf(decl) === "capability.readOnly" ? "light" : "pipeline";
}

export interface GuardTarget {
  readonly id: CapabilityId;
  /** 공급자 서비스 객체. 메서드가 함수 값인 객체다 */
  readonly service: unknown;
  readonly defs: CapabilityDefLookup;
  /**
   * 지금 바인딩된 공급자의 `idempotent` 선언을 믿는가(M3-REQ-31, X.loading-trust.spec §4.6.4). 호출마다 읽는다.
   * 외부 확장은 적합성 시험을 강제할 수 없으므로 거짓이고, 그 공급자의 `idempotent` 메서드는 재실행되는 문맥에서 선언 없음으로 본다
   */
  readonly providerTrusted: () => boolean;
  readonly extension: ExtensionName;
  readonly scopeId: RegistrationId;
  /** 호출이 일어난 대화의 turn 조건(interactive, 읽기 전용 천장). 포트가 없으면 생략한다 */
  readonly conditionsOf?: (threadId: ThreadId) => LoopCallConditions | undefined;
  /**
   * 호출자가 넘긴 `options.context`를 그대로 실어도 되는가. 내장 확장(L1.tools 어댑터처럼 `fresnel.*` 포트를 읽는 코드)만 참이다.
   * 거짓이면 `caller`는 항상 이 확장으로 다시 채우고 호출자가 고를 수 있는 것은 `threadId`와 `toolCallId`뿐이다
   * (호스트·모델 행세, `interactive`, 시크릿 승인 증거 위조를 막는다)
   */
  readonly contextTrusted: boolean;
  /** 플러그인 기능 호출의 파이프라인 경로 설정(U-1). 없으면 모든 호출이 옛 직접 경로다 */
  readonly pluginCalls: PluginCallWiring;
}

type AnyMethod = (...args: readonly unknown[]) => unknown;

function isIndexable(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null;
}

function isMethod(value: unknown): value is AnyMethod {
  return typeof value === "function";
}

/** `requestId` 길이 규칙(F.capabilities.spec §3.1) */
const REQUEST_ID_MAX = 64;

/** 재실행되는 문맥. 맥락이 없으면(setup, 명령 처리기, 도구 execute) 재실행되지 않으므로 null */
function replayContextOf(amb: Ambient | undefined): ReplayContext | null {
  if (amb === undefined || amb.invocation !== undefined) return null;
  return amb.drive === null ? "on" : "drive";
}

function refuse(
  id: CapabilityId,
  method: string,
  code: string,
  message: string,
  detail?: JsonValue,
): Promise<never> {
  return Promise.reject(
    new CapabilityError({
      capability: id,
      method,
      code,
      message,
      retryable: false,
      ...(detail === undefined ? {} : { detail }),
    }),
  );
}

function effectLabel(effect: ReplayEffect): string {
  const row = REPLAY_EFFECT_TABLE[effect];
  return `${effect} (on ${row.on}, drive ${row.drive})`;
}

function untrustedContext(
  given: CallContext | undefined,
  ambientThread: ThreadId | undefined,
  extension: ExtensionName,
  conditions?: LoopCallConditions,
): CallContext {
  const threadId = ambientThread ?? given?.threadId;
  const toolCallId = given?.toolCallId;
  return {
    ...(threadId === undefined ? {} : { threadId }),
    ...(toolCallId === undefined ? {} : { toolCallId }),
    caller: { kind: "extension", extension },
    // 호출이 일어난 대화의 조건은 호스트가 채운다. 호출자가 고를 수 없다
    ...(conditions === undefined
      ? {}
      : {
          interactive: conditions.interactive,
          ...(conditions.sandbox === undefined ? {} : { sandbox: conditions.sandbox }),
        }),
  };
}

/**
 * 기능 서비스를 감싼다(ADR-0015 §3.1 2번, §3.2). 도구 매핑이 있거나 readOnly가 아닌 메서드는 플러그인 기능 호출 파이프라인(U-1 (가), (다))으로,
 * readOnly 메서드는 가벼운 경로로 보낸다. 파이프라인 경로는 재실행 효과 표를 건너뛴다(U-5). 멱등 키가 그 역할을 한다.
 * 옛 직접 경로(포트나 설정이 없거나 정의가 없는 메서드)는 on 핸들러와 drive 함수 안의 호출만 효과 표로 검사한다.
 * 거부는 서비스 메서드의 실패 규약대로 `CapabilityError`로 거부(reject)한다
 */
export function guardCapabilityService(target: GuardTarget): Readonly<Record<string, unknown>> {
  const { id, service, defs } = target;
  const def = defs(id);
  if (!isIndexable(service)) return {};
  const names = def === undefined ? Object.keys(service) : Object.keys(def.service.methods);
  const wrapped: [string, unknown][] = [];
  for (const name of names) {
    const method = service[name];
    if (!isMethod(method)) continue;
    const decl: MethodDef | undefined = def?.service.methods[name];
    const declared: ReplayEffect =
      decl === undefined ? "capability.undeclared" : capabilityEffectOf(decl);
    wrapped.push([
      name,
      (input: unknown, options?: unknown) => {
        const effect: ReplayEffect =
          declared === "capability.idempotent" && !target.providerTrusted()
            ? "capability.undeclared"
            : declared;
        const given: CallOptions | undefined = isIndexable(options) ? options : undefined;
        const amb = ambient();
        // 도구 파이프라인 안에서 도는 내장 호출(도구 호출 id를 싣는다, L1.tools 어댑터)은 이미 관문을 지났다.
        // 다시 경로를 고르면 되돌이가 생기므로 검사 없이 공급자를 부른다(U-8)
        if (isPipelineInternal(target, given)) {
          return callService(target, method, service, input, given, amb, given?.requestId);
        }
        // `readOnly: true` 메서드는 `query`로 확인 없이 지나가므로 읽기 전용으로 선언된 기능 메서드만 부를 수 있다
        if (inReadOnlyMethod() && effect !== "capability.readOnly") {
          return refuse(
            id,
            name,
            "effect_not_allowed",
            `${id}.${name} is ${effectLabel(effect)}; a readOnly extension method may only call readOnly capability methods`,
          );
        }
        const route = routeOf(target.pluginCalls, id, name, decl);
        const threadId = amb?.threadId ?? given?.context?.threadId;
        const port = target.pluginCalls.tools();
        if (route === "pipeline" && threadId !== undefined && port !== undefined) {
          // 호출 식별은 명시 키가 우선이고 없으면 훅·드라이브 안의 순번으로 정한다. 둘 다 없으면 옛 경로다
          const identity = given?.requestId ?? identityOf(amb, target.scopeId, id, name);
          if (identity !== undefined) {
            return callThroughPipeline({
              target,
              port,
              name,
              input,
              given,
              amb,
              threadId,
              requestId: identity,
            });
          }
        }
        const context = replayContextOf(amb);
        const requestId = given?.requestId;
        if (context !== null) {
          if (!isEffectAllowed(effect, context)) {
            return refuse(
              id,
              name,
              "effect_not_allowed",
              `${id}.${name} is ${effectLabel(effect)}${declared === effect ? "" : " because its provider is not built in, so the idempotent declaration is not trusted"}; it cannot run in a ${context === "on" ? "handler" : "drive function"} that may be replayed`,
            );
          }
          if (effect === "capability.idempotent" && requestId === undefined) {
            // 명시 키만 받는다([결정: adr.0015] §3.4 3번). 기본 키는 주지 않는다
            return refuse(
              id,
              name,
              "invalid_input",
              `${id}.${name} is idempotent and needs an explicit requestId in a ${context === "on" ? "handler" : "drive function"}`,
            );
          }
          if (
            requestId !== undefined &&
            (requestId.length < 1 || requestId.length > REQUEST_ID_MAX)
          ) {
            return refuse(id, name, "invalid_input", `requestId must be 1-${REQUEST_ID_MAX} chars`);
          }
        }
        return callService(target, method, service, input, given, amb, requestId);
      },
    ]);
  }
  if (def !== undefined) {
    // 정의 밖 멤버(예: `dialog.commands` 공급자의 TS 메서드 `registerAction`)는 기능 메서드가 아니므로 그대로 넘긴다
    for (const name of memberNames(service)) {
      if (name in def.service.methods) continue;
      const member = service[name];
      wrapped.push([name, isMethod(member) ? member.bind(service) : member]);
    }
  }
  return Object.fromEntries(wrapped);
}

/** 내장 도구 어댑터처럼 신뢰한 호출자가 도구 호출 id를 싣고 부르는 호출인가 */
function isPipelineInternal(target: GuardTarget, given: CallOptions | undefined): boolean {
  return target.contextTrusted && given?.context?.toolCallId !== undefined;
}

/** 옛 직접 경로: 호출 문맥을 채우고 공급자를 맥락 없이 부른다 */
function callService(
  target: GuardTarget,
  method: AnyMethod,
  service: unknown,
  input: unknown,
  given: CallOptions | undefined,
  amb: Ambient | undefined,
  requestId: string | undefined,
): unknown {
  const merged: CallOptions = {
    ...given,
    ...(requestId === undefined ? {} : { requestId }),
    // 내장 확장(L1.tools 어댑터)이 채운 호출 문맥(도구 호출 id, 모델 호출자, 승인 증거)은 덮지 않는다.
    // 그 밖의 확장은 호출자를 직접 고르지 못한다. caller는 항상 이 확장이고 threadId와 toolCallId만 받는다
    context:
      target.contextTrusted && given?.context !== undefined
        ? given.context
        : untrustedContext(
            given?.context,
            amb?.threadId,
            target.extension,
            conditionsFor(target, amb?.threadId ?? given?.context?.threadId),
          ),
  };
  // 공급자 안에서 도는 도구와 서비스는 재실행되는 문맥이 아니다. 호출자의 ambient가 따라 들어가지 않게 끊는다
  return withoutAmbient(() => method.call(service, input, merged));
}

/**
 * 파이프라인 경로의 멱등 키(U-5). 명시 키가 없으면 호출이 일어난 흐름의 식별로 정한다: 재실행되는 drive는 계통(lineageId)과
 * 기준 판 번호와 순번, 훅 핸들러와 도구·명령·메서드 호출은 디스패치 키와 순번이다. 순번은 호출마다 올라간다.
 * 식별할 것이 없으면 undefined(옛 경로)
 */
function identityOf(
  amb: Ambient | undefined,
  scopeId: RegistrationId,
  id: CapabilityId,
  method: string,
): string | undefined {
  if (amb === undefined) return undefined;
  if (amb.drive !== null) {
    const n = amb.drive.i;
    amb.drive.i += 1;
    return callKeyOf({
      scopeId,
      lineageId: amb.drive.lineageId,
      baseRev: amb.drive.baseRev,
      capability: id,
      method,
      n,
    });
  }
  if (amb.dispatchKey === null) return undefined;
  const n = amb.counter;
  amb.counter += 1;
  return callKeyOf({
    scopeId,
    dispatchKey: amb.dispatchKey,
    capability: id,
    method,
    n,
  });
}

function callKeyOf(fingerprint: unknown): string {
  return `call:${createHash("sha256").update(canonicalJson(fingerprint)).digest("hex").slice(0, 40)}`;
}

function hashOf(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 40);
}

/** 호출이 시작된 경로 이름(U-4). 훅 핸들러 안은 `hook`, drive는 `drive`, 나머지는 도구·명령·메서드 호출이다 */
function viaOf(amb: Ambient | undefined): PluginCallVia {
  if (amb === undefined) return "method";
  if (amb.point !== null) return "hook";
  if (amb.drive !== null) return "drive";
  return amb.invocation ?? "method";
}

interface PipelineCall {
  readonly target: GuardTarget;
  readonly port: ToolsPort;
  readonly name: string;
  readonly input: unknown;
  readonly given: CallOptions | undefined;
  readonly amb: Ambient | undefined;
  readonly threadId: ThreadId;
  readonly requestId: string;
}

/** 파이프라인 경로. `executeForPlugin`을 부르고 결과를 서비스 메서드의 반환 모양으로 되돌린다 */
async function callThroughPipeline(call: PipelineCall): Promise<unknown> {
  const { target, port, name, input, amb, threadId, requestId } = call;
  const id = target.id;
  if (requestId.length < 1 || requestId.length > REQUEST_ID_MAX) {
    return refuse(id, name, "invalid_input", `requestId must be 1-${REQUEST_ID_MAX} chars`);
  }
  const json = toJsonValue(input ?? {});
  if (json === undefined) {
    return refuse(id, name, "invalid_input", `${id}.${name} input must be JSON`);
  }
  const stack: readonly HookFrame[] = hookStackOf(amb);
  const tool = `${id}.${name}`;
  const argsHash = hashOf(canonicalJson(json));
  // 같은 호출자가 같은 대상을 같은 인자로 다시 부르면 순환이다(U-8 (나))
  if (
    stack.some(
      (frame) =>
        frame.tool === tool && frame.plugin === target.extension && frame.argsHash === argsHash,
    )
  ) {
    return refuse(
      id,
      name,
      "plugin_call_hook_cycle",
      `[fresnel:hook_cycle] ${target.extension} calls ${tool} again with the same arguments inside its own call chain.`,
    );
  }
  // 훅 핸들러 안에서 시작한 호출은 자기 칸을 스택에 더해 그 호출이 낸 훅에 보인다
  const frame: HookFrame | undefined =
    amb !== undefined && amb.point !== null
      ? { plugin: target.extension, point: amb.point, tool, argsHash }
      : undefined;
  const conditions = conditionsFor(target, threadId);
  const parent = amb?.invocation === "tool" ? amb.callId : undefined;
  const signal = call.given?.signal ?? amb?.handler?.signal ?? amb?.drive?.signal;
  const request: PluginCallRequest = {
    threadId,
    plugin: { name: target.extension, scopeId: target.scopeId },
    via: viaOf(amb),
    target: { kind: "capability", capability: id, method: name },
    input: json,
    requestId,
    hookDepth: stack.length,
    ...(parent === undefined ? {} : { parentToolCallId: parent }),
    ...(conditions === undefined ? {} : { conditions }),
    ...(signal === undefined ? {} : { signal }),
  };
  // 훅 스택은 복사한 맥락으로 싣는다. 복사본의 counter는 파이프라인이 쓰지 않으므로 바깥 흐름과 어긋나지 않는다
  const result: Result<ToolResultView, ToolError> =
    frame === undefined || amb === undefined
      ? await port.executeForPlugin(request)
      : await withAmbient({ ...amb, hookStack: [...stack, frame] }, () =>
          port.executeForPlugin(request),
        );
  if (!result.ok) {
    return refuse(id, name, `plugin_call_${result.error.kind}`, result.error.message);
  }
  const view = result.value;
  if (view.isError) {
    // 공급자가 낸 오류 코드(도구 결과의 details.code)는 그대로 싣는다. 호출자가 코드로 나눠 처리하기 때문이다
    return refuse(
      id,
      name,
      providerCodeOf(view.details) ?? "plugin_call_failed",
      view.content === "" ? `${id}.${name} failed` : view.content,
      view.details ?? undefined,
    );
  }
  return view.structuredContent ?? undefined;
}

/** 도구 결과 details의 `code`(공급자 오류 코드). 없으면 undefined */
export function providerCodeOf(details: JsonValue | null): string | undefined {
  if (!isJsonRecord(details)) return undefined;
  const code = details.code;
  return typeof code === "string" ? code : undefined;
}

function isJsonRecord(value: JsonValue | null): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function conditionsFor(
  target: GuardTarget,
  threadId: ThreadId | undefined,
): LoopCallConditions | undefined {
  return threadId === undefined ? undefined : target.conditionsOf?.(threadId);
}

/** 서비스 객체의 자기 키와 클래스 프로토타입의 메서드 이름 */
function memberNames(service: Readonly<Record<string, unknown>>): readonly string[] {
  const proto: unknown = Object.getPrototypeOf(service);
  const inherited =
    isIndexable(proto) && proto !== Object.prototype ? Object.getOwnPropertyNames(proto) : [];
  return [...new Set([...Object.keys(service), ...inherited])].filter(
    (name) => name !== "constructor",
  );
}
