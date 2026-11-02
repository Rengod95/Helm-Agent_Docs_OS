// 확장 메서드 표와 호출(X.primitives.spec §3.9.2, §4.12). 등록은 host-api.ts의 registerMethod가 하고,
// 이 파일은 컴파일된 검사기, 기록 찾기, 호출 절차, 보고를 맡는다. 예상할 수 있는 실패는 ExtMethodOutcome 값이다.
import {
  assertNever,
  attempt,
  attemptAsync,
  err,
  ok,
  type Result,
  type Thrown,
} from "@fresnel/contracts";
import type { ThreadId } from "@fresnel/contracts/conversation";
import type { ExtMethodDecl, ExtensionName, RegistrationId } from "@fresnel/contracts/extensions";
import { Compile, type Validator } from "typebox/schema";
import type { HandlerGate, HandlerRunOutcome } from "./dispatch-types.ts";
import type { Generation, HostCore } from "./core.ts";
import type { ResourceRecord, ResourceRegistry } from "./resources.ts";

/** 처리기가 받는 호출 맥락. threadId는 호출이 thread에 묶였을 때만 있다 */
export interface ExtMethodCallContext {
  readonly threadId: ThreadId | null;
  /** 호출 하나의 id. threadId가 있으면 디스패치 키 `method:<callId>`가 된다 */
  readonly callId: string;
  /** 호출한 쪽이 취소하거나 scope 세대가 닫히면 abort된다. 예산을 넘겨도 abort된다(ExtHostDeps.methodRun이 있을 때) */
  readonly signal: AbortSignal;
  readonly caller: "wire" | "ui";
}

/** `hostOf(g).registerMethod(verb, def)`의 정의. 동사는 인자로 준다 */
export interface ExtMethodResourceDef {
  handler(params: unknown, ctx: ExtMethodCallContext): Promise<unknown>;
}

/** 검사 문제 하나. `path`는 JSON Pointer이고 루트는 `""`다 */
export interface ExtMethodIssue {
  readonly path: string;
  readonly message: string;
}

export interface ExtMethodInfo {
  readonly extension: ExtensionName;
  readonly verb: string;
  /** 매니페스트 `methods`의 항목 */
  readonly decl: ExtMethodDecl;
  readonly scopeId: RegistrationId;
}

export interface ExtMethodCallInput {
  readonly extension: ExtensionName;
  readonly verb: string;
  readonly params: unknown;
  readonly threadId: ThreadId | null;
  readonly signal: AbortSignal;
  readonly caller: "wire" | "ui";
  /** 생략하면 X가 새 id를 만든다. 재실행 기록의 멱등 키로 쓰려면 호출자가 준다 */
  readonly callId?: string;
}

/** 호출 결과. 예상할 수 있는 실패는 값이다(던지지 않는다) */
export type ExtMethodOutcome =
  | { readonly kind: "ok"; readonly value: unknown }
  | { readonly kind: "not_found" }
  | { readonly kind: "extension_off" }
  | { readonly kind: "params_invalid"; readonly issues: readonly ExtMethodIssue[] }
  | { readonly kind: "result_invalid"; readonly issues: readonly ExtMethodIssue[] }
  | { readonly kind: "threw"; readonly message: string }
  /** 확장 메서드 시간 예산(`x.operations.budget.uiMs`)을 넘었다. `budgetMs`는 그 유효 값이다. `ExtHostDeps.methodRun`이 있을 때만 난다 */
  | { readonly kind: "timeout"; readonly budgetMs: number }
  | { readonly kind: "aborted" };

/** `ExtHostDeps.onMethodSettled`의 인자. 처리기에 닿은 호출마다 한 번 불린다 */
export interface ExtMethodSettled {
  readonly extension: ExtensionName;
  readonly scopeId: RegistrationId;
  readonly verb: string;
  readonly outcome: "ok" | "params_invalid" | "result_invalid" | "threw" | "timeout" | "aborted";
  /** 처리기가 활성인 시간(ms). params_invalid는 0이고 timeout은 예산과 같다 */
  readonly activeMs: number;
  /** threw일 때 처리기 오류 메시지 앞 500자(ExtMethodOutcome.threw.message와 같다). 다른 결과에는 없다 */
  readonly message?: string;
}

/**
 * 처리기를 예산 안에서 실행하는 함수. `ExtHostDeps.methodRun`의 모양이고 DispatchPolicy.run과 같은 재료를 받는다.
 * X.operations가 `runWithBudget`으로 구현한다(primitives는 operations를 import하지 않는다)
 */
export type MethodRun = <T>(
  work: (signal: AbortSignal, gate: HandlerGate) => Promise<T>,
  outer: AbortSignal | undefined,
) => Promise<HandlerRunOutcome<T>>;

export interface ExtMethods {
  /** 지금 등록된 메서드. 꺼진 scope의 것은 없다 */
  list(): readonly ExtMethodInfo[];
  /** 호출한다. 예상할 수 있는 실패는 값으로 돌려준다 */
  call(input: ExtMethodCallInput): Promise<ExtMethodOutcome>;
}

/**
 * 등록된 처리기의 내부 모양. 셋째 인자는 예산 시계 장치다. host-api.ts가 이것을 ambient의 `handler`에 싣고,
 * `hostOf(g).awaitUser`가 사용자 응답 대기 동안 시계를 멈춘다(X.operations.spec §4.2.3)
 */
type Handler = (params: unknown, ctx: ExtMethodCallContext, gate: HandlerGate) => Promise<unknown>;

/**
 * 등록 하나의 정의와 검사기. 리소스 기록의 def다. scope 세대가 닫혀 기록이 해제되면 검사기도 함께 버려지므로
 * 캐시는 등록 (확장, 동사, scope)마다 하나다. 다시 켜면 setup이 새로 등록하며 새로 컴파일한다
 */
export class ExtMethodEntry {
  readonly decl: ExtMethodDecl;
  readonly params: Validator;
  readonly result: Validator;
  readonly handler: Handler;

  constructor(decl: ExtMethodDecl, params: Validator, result: Validator, handler: Handler) {
    this.decl = decl;
    this.params = params;
    this.result = result;
    this.handler = handler;
  }
}

/** 스키마를 컴파일할 수 없을 때의 원인. `which`는 `params` 또는 `result`다 */
export interface MethodSchemaError {
  readonly which: "params" | "result";
  readonly message: string;
  readonly cause: unknown;
}

/** 선언의 params·result를 컴파일해 등록 값을 만든다. 잘못된 정규식 같은 컴파일 실패는 값으로 돌려준다 */
export function methodEntryOf(
  decl: ExtMethodDecl,
  handler: Handler,
): Result<ExtMethodEntry, MethodSchemaError> {
  const params = attempt(() => Compile(decl.params));
  if (!params.ok) return err(schemaErrorOf("params", params.error));
  const result = attempt(() => Compile(decl.result));
  if (!result.ok) return err(schemaErrorOf("result", result.error));
  return ok(new ExtMethodEntry(decl, params.value, result.value, handler));
}

function schemaErrorOf(which: "params" | "result", thrown: Thrown): MethodSchemaError {
  return { which, message: messageOf(thrown.cause), cause: thrown.cause };
}

const MAX_ISSUES = 20;
const MAX_MESSAGE = 500;

/** 던져진 값의 짧은 글. 문자열이나 Error의 메시지만 쓰고 스택은 싣지 않는다 */
function messageOf(cause: unknown): string {
  if (typeof cause === "string") return cause;
  if (cause instanceof Error) return cause.message;
  return "a non-Error value was thrown";
}

/** 값이 스키마를 지키는지 본다. 어긋난 곳은 최대 20개까지 돌려준다 */
function schemaIssuesOf(validator: Validator, value: unknown): ExtMethodIssue[] {
  const [valid, errors] = validator.Errors(value);
  if (valid) return [];
  return errors
    .slice(0, MAX_ISSUES)
    .map((error) => ({ path: error.instancePath, message: error.message }));
}

/** RFC 6901 토큰 이스케이프: `~`는 `~0`, `/`는 `~1` */
function escapePointer(key: string): string {
  return key.replaceAll("~", "~0").replaceAll("/", "~1");
}

/**
 * JSON으로 옮길 수 없는 첫 자리. 순환, undefined, 함수, 기호, BigInt, 유한하지 않은 수, 일반 객체·배열이 아닌 값.
 * JSON.stringify에 맡기지 않는다. 던지지 않고 경로를 붙여 돌려준다
 */
function jsonIssueOf(
  value: unknown,
  path: string,
  ancestors: Set<object>,
): ExtMethodIssue | undefined {
  if (value === null || typeof value === "string" || typeof value === "boolean") return undefined;
  if (typeof value === "number") {
    return Number.isFinite(value)
      ? undefined
      : { path, message: "a number must be finite to be JSON" };
  }
  if (typeof value !== "object") {
    return { path, message: `${typeof value} is not JSON` };
  }
  if (ancestors.has(value)) return { path, message: "a cycle is not JSON" };
  const prototype: unknown = Object.getPrototypeOf(value);
  if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) {
    return { path, message: "only plain objects and arrays are JSON" };
  }
  ancestors.add(value);
  const issue = firstChildIssue(value, path, ancestors);
  ancestors.delete(value);
  return issue;
}

function firstChildIssue(
  value: object,
  path: string,
  ancestors: Set<object>,
): ExtMethodIssue | undefined {
  const children: readonly (readonly [string, unknown])[] = Array.isArray(value)
    ? value.map((item, index) => [`${index}`, item] as const)
    : Object.entries(value).map(([key, item]) => [escapePointer(key), item] as const);
  for (const [segment, item] of children) {
    const issue = jsonIssueOf(item, `${path}/${segment}`, ancestors);
    if (issue !== undefined) return issue;
  }
  return undefined;
}

/** 처리기 결과 검사: JSON이 아니면 그 자리 하나, JSON이면 decl.result의 어긋남 */
function resultIssuesOf(entry: ExtMethodEntry, value: unknown): ExtMethodIssue[] {
  const json = jsonIssueOf(value, "", new Set<object>());
  if (json !== undefined) return [json];
  return schemaIssuesOf(entry.result, value);
}

interface UntilAborted {
  readonly done: Promise<void>;
  /** 호출이 끝나면 부른다. 신호에 남은 듣기를 거둔다 */
  readonly release: () => void;
}

/** 신호가 abort되면 끝나는 약속. 이미 abort된 신호면 바로 끝난다. 듣기는 `stop`으로 거둔다 */
function untilAborted(signal: AbortSignal): UntilAborted {
  const stop = new AbortController();
  const done = new Promise<void>((resolve) => {
    const onAbort = (): void => {
      resolve();
    };
    if (signal.aborted) onAbort();
    else signal.addEventListener("abort", onAbort, { once: true, signal: stop.signal });
  });
  return {
    done,
    release: () => {
      stop.abort();
    },
  };
}

function entryOf(def: unknown): ExtMethodEntry | undefined {
  return def instanceof ExtMethodEntry ? def : undefined;
}

/**
 * 호출이 닿을 수 있는 세대. scope가 없거나 열려 있지 않거나(꺼지는 중, 꺼짐, 멈춤), threadId가 있을 때 그 thread에서
 * 꺼져 있으면 undefined다. threadId가 null이면 세대만 본다
 */
function openGenerationOf(
  core: HostCore,
  scopeId: RegistrationId,
  threadId: ThreadId | null,
): Generation | undefined {
  const generation = core.scopes.get(scopeId)?.generation ?? null;
  if (generation === null || !generation.open) return undefined;
  if (threadId !== null && !core.activeIn(threadId, scopeId)) return undefined;
  return generation;
}

/** 등록된 기록이 없을 때. 매니페스트가 그 동사를 선언했고 확장의 scope가 모두 꺼졌으면 extension_off다 */
function absentOutcome(
  core: HostCore,
  extension: ExtensionName,
  verb: string,
  threadId: ThreadId | null,
): ExtMethodOutcome {
  const unit = core.units.get(extension);
  const declared = (unit?.manifest.methods ?? []).some((decl) => decl.verb === verb);
  if (unit === undefined || !declared) return { kind: "not_found" };
  const someOn = unit.scopeIds.some((id) => openGenerationOf(core, id, threadId) !== undefined);
  return someOn ? { kind: "not_found" } : { kind: "extension_off" };
}

export interface ExtMethodsDeps {
  readonly core: HostCore;
  readonly resources: ResourceRegistry;
  /** 처리기에 닿은 호출의 보고(ExtHostDeps.onMethodSettled). 없으면 보고하지 않는다 */
  readonly onMethodSettled: ((info: ExtMethodSettled) => void) | undefined;
  /** 처리기 실행기(ExtHostDeps.methodRun). 없으면 예산 없이 실행한다 */
  readonly methodRun: MethodRun | undefined;
}

const NOOP = (): void => {};
/** 예산이 없을 때 처리기가 받는 게이트. 멈출 시계가 없으므로 아무것도 하지 않는다 */
const NO_GATE: HandlerGate = { pause: NOOP, resume: NOOP };

/**
 * 예산 없이 실행한다(ExtHostDeps.methodRun이 없을 때). 신호가 abort되면 처리기를 기다리지 않고 aborted를 돌려주고,
 * 나중에 끝난 값과 예외는 버린다. 결과 모양은 runWithBudget과 같다
 */
function runUnbudgeted<T>(
  work: (signal: AbortSignal, gate: HandlerGate) => Promise<T>,
  outer: AbortSignal | undefined,
  now: () => number,
): Promise<HandlerRunOutcome<T>> {
  const startedAt = now();
  const signal = outer ?? new AbortController().signal;
  const run = attemptAsync(() => work(signal, NO_GATE));
  const watch = untilAborted(signal);
  return Promise.race([
    run.then((result): HandlerRunOutcome<T> => {
      const activeMs = now() - startedAt;
      return result.ok
        ? { kind: "settled", value: result.value, activeMs }
        : { kind: "threw", error: result.error.cause, activeMs };
    }),
    watch.done.then((): HandlerRunOutcome<T> => ({ kind: "aborted", reason: signal.reason })),
  ]).finally(watch.release);
}

export function createExtMethods(deps: ExtMethodsDeps): ExtMethods {
  const { core, resources } = deps;
  const run: MethodRun =
    deps.methodRun ?? ((work, outer) => runUnbudgeted(work, outer, core.deps.now));

  function registered(): { readonly record: ResourceRecord; readonly entry: ExtMethodEntry }[] {
    return resources.list("ext_method").flatMap((record) => {
      const entry = entryOf(record.def);
      return entry === undefined ? [] : [{ record, entry }];
    });
  }

  /** 보고 구독자의 예외는 `report`로 남기고 호출 결과는 바꾸지 않는다 */
  function settle(info: ExtMethodSettled): void {
    const onSettled = deps.onMethodSettled;
    if (onSettled === undefined) return;
    const reported = attempt(() => {
      onSettled(info);
    });
    if (!reported.ok) {
      core.deps.report({
        level: "error",
        code: "handler_failed",
        scopeId: info.scopeId,
        extension: info.extension,
        message: "onMethodSettled threw",
        cause: reported.error.cause,
      });
    }
  }

  return {
    list() {
      return registered().map(({ record, entry }) => ({
        extension: record.extension,
        verb: record.name,
        decl: entry.decl,
        scopeId: record.scopeId,
      }));
    },
    async call(input) {
      const found = registered().find(
        ({ record }) => record.extension === input.extension && record.name === input.verb,
      );
      if (found === undefined)
        return absentOutcome(core, input.extension, input.verb, input.threadId);
      const { record, entry } = found;
      const generation = openGenerationOf(core, record.scopeId, input.threadId);
      if (generation === undefined) return { kind: "extension_off" };
      if (input.signal.aborted) return { kind: "aborted" };
      const report = (
        outcome: ExtMethodSettled["outcome"],
        activeMs: number,
        message?: string,
      ): void => {
        settle({
          extension: record.extension,
          scopeId: record.scopeId,
          verb: record.name,
          outcome,
          activeMs,
          ...(message === undefined ? {} : { message }),
        });
      };
      const paramIssues = schemaIssuesOf(entry.params, input.params);
      if (paramIssues.length > 0) {
        report("params_invalid", 0);
        return { kind: "params_invalid", issues: paramIssues };
      }
      const callId = input.callId ?? crypto.randomUUID();
      // 처리기 신호는 호출한 쪽의 취소와 scope 세대의 닫힘을 합친 것이다. 예산 실행기는 여기에 예산 신호를 더해 준다
      const signal = AbortSignal.any([input.signal, generation.abort.signal]);
      const startedAt = core.deps.now();
      const outcome = await run(
        (handlerSignal, gate) =>
          entry.handler(
            input.params,
            { threadId: input.threadId, callId, signal: handlerSignal, caller: input.caller },
            gate,
          ),
        signal,
      );
      switch (outcome.kind) {
        case "settled": {
          const issues = resultIssuesOf(entry, outcome.value);
          if (issues.length > 0) {
            report("result_invalid", outcome.activeMs);
            return { kind: "result_invalid", issues };
          }
          report("ok", outcome.activeMs);
          return { kind: "ok", value: outcome.value };
        }
        case "threw": {
          core.deps.report({
            level: "warning",
            code: "handler_failed",
            scopeId: record.scopeId,
            extension: record.extension,
            message: `method ${record.name} threw`,
            cause: outcome.error,
          });
          const message = messageOf(outcome.error).slice(0, MAX_MESSAGE);
          report("threw", outcome.activeMs, message);
          return { kind: "threw", message };
        }
        case "timeout": {
          core.deps.report({
            level: "warning",
            code: "handler_failed",
            scopeId: record.scopeId,
            extension: record.extension,
            message: `method ${record.name} timeout`,
          });
          // 예산 시계는 멈춘 시간을 뺀 값이라 시간 초과 때의 활성 시간은 예산과 같다
          report("timeout", outcome.budgetMs);
          return { kind: "timeout", budgetMs: outcome.budgetMs };
        }
        case "aborted": {
          // 나중에 끝난 처리기의 결과는 버린다. scope 세대가 닫혔으면 extension_off, 아니면 호출한 쪽이 취소한 것이다
          report("aborted", core.deps.now() - startedAt);
          return generation.abort.signal.aborted ? { kind: "extension_off" } : { kind: "aborted" };
        }
        default:
          return assertNever(outcome, "HandlerRunOutcome");
      }
    },
  };
}
