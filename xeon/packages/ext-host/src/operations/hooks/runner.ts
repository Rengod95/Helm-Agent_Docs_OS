import {
  FIRST_DENY,
  HOOKS,
  type ExtensionManifest,
  type HookProcessPort,
  type HookSignatures,
  type TraceFailureReason,
  type TraceHandlerResult,
} from "@fresnel/contracts/extensions";
import { assertNever, attempt } from "@fresnel/contracts";
import { Value } from "typebox/value";
import { ambient } from "../../primitives/ambient.ts";
import { isBlocking } from "../../primitives/fold/first.ts";
import type { ExtensionUnit } from "../../primitives/host.ts";
import type { HandlerOutcomeRecord } from "../failure.ts";
import type { HookHookName, LoadedHook } from "./config.ts";
import { hookEnv } from "./env.ts";
import { hookUnitName } from "./names.ts";
import {
  encodeHookInput,
  HOOK_OUTPUT_MAX_CHARS,
  HOOK_SCHEMA_VERSION,
  HOOK_STDERR_MAX_CHARS,
  interpretHookRun,
  type HookInput,
} from "./protocol.ts";

// 외부 훅 실행기(X.operations.spec §4.7.4). 훅마다 내장 단위 하나가 그 훅의 지점에 핸들러 하나를 단다. 그래서 사용자가
// `hooks.order.*`로 외부 훅을 다른 핸들러 사이로 옮길 수 있다. 호출 때 그 thread에 적용되는 훅 정의를 읽어 실행한다.
// 실패 장부 키는 단위가 아니라 `hook:<id>`다.

/** 외부 훅 단위의 loadIndex 밑값. 모든 확장 뒤에 범위 순서, 설정 순서로 이어 붙인다(§4.7.4) */
export const HOOK_UNIT_LOAD_INDEX_BASE = 1_000_000;

/** 외부 훅 하나의 계측 행 이름(X.operations §4.8.2). 실패 장부 키와 같은 `hook:<id>`다 */
function hookRegistrationId(id: string): string {
  return `hook:${id}`;
}

/** 훅 출력 실패의 계측 이유. 시간 초과, 출력 검사 실패, 그 밖의 비정상 종료와 시작 실패다 */
function traceReasonOf(failure: string): TraceFailureReason {
  if (failure === "timeout") return "timeout";
  if (failure === "hook_output") return "result_invalid";
  return "threw";
}

/** 값의 JSON 문자 수. 직렬화할 수 없으면 0이다(디스패처의 `sizeOfValue`와 같은 규칙) */
function sizeOfPatch(value: unknown): number {
  const size = attempt(() => JSON.stringify(value).length);
  return size.ok ? size.value : 0;
}

export interface HookRunnerDeps {
  /** `fresnel.process` 포트. 없으면 외부 훅은 실행하지 않는다 */
  readonly process: () => HookProcessPort | undefined;
  /** 이 thread에 적용되는 외부 훅(신뢰된 범위만, 중복 정리 뒤). 호출 때마다 현재 설정을 읽는다 */
  readonly hooks: (threadId: string) => readonly LoadedHook[];
  /** 설정 `x.operations.hookDisabled`에 저장된 id */
  readonly savedDisabled: () => readonly string[];
  /** thread의 작업 폴더. 모르면 undefined */
  readonly projectDir: (threadId: string) => string | undefined;
  readonly home: () => string;
  readonly parentEnv: () => Readonly<Record<string, string | undefined>>;
  /** `x.operations.hookEnvAllow` */
  readonly envAllow: () => readonly string[];
  /** 훅 정의에 timeoutMs가 없을 때의 예산(ms) */
  readonly budgetMs: () => number;
  readonly setTimer: (ms: number, fn: () => void) => () => void;
  readonly now: () => number;
  /** 실패 장부로 보낸다(AutoDisabler.onOutcome) */
  readonly report: (record: HandlerOutcomeRecord) => void;
  readonly log: (line: string) => void;
}

/** 훅 단위를 만드는 입력. `loadIndex`는 모든 확장 뒤에 이어 붙이는 순번이다(§4.7.4) */
export interface HookUnitSpec {
  readonly id: string;
  readonly point: HookHookName;
  readonly loadIndex: number;
}

export interface HookRunner {
  /** 훅 하나의 단위. 그 훅의 지점에 핸들러 하나를 단다 */
  unitOf(spec: HookUnitSpec): ExtensionUnit;
  /** 자동 끄기·질문 답이 부른다. 이번 실행에서 건너뛴다 */
  disable(id: string): void;
  enable(id: string): void;
  isDisabled(id: string): boolean;
}

type ExecResult =
  | { readonly kind: "none" }
  | { readonly kind: "decision"; readonly value: unknown }
  | { readonly kind: "patch"; readonly value: unknown }
  | { readonly kind: "deny"; readonly reason: string }
  | { readonly kind: "failed" };

interface CallContext {
  readonly threadId: string;
  readonly signal: AbortSignal;
}

const FOLD_OF: { readonly [N in HookHookName]: "tap" | "first" | "chain" } = {
  "input.user.before": "chain",
  "input.bash.before": "first",
  "tool.call.before": "first",
  "tool.result": "chain",
  "thread.start": "tap",
  "thread.compact.before": "first",
  "boundary.settle.after": "tap",
  "thread.shutdown": "tap",
};

function isDecisionOf<N extends "tool.call.before" | "input.bash.before" | "thread.compact.before">(
  point: N,
  value: unknown,
): value is HookSignatures[N]["decision"] {
  const schema = HOOKS[point].result;
  return schema !== undefined && Value.Check(schema, value);
}

function isPatchOf<N extends "input.user.before" | "tool.result">(
  point: N,
  value: unknown,
): value is HookSignatures[N]["patch"] {
  const schema = HOOKS[point].result;
  return schema !== undefined && Value.Check(schema, value);
}

export function createHookRunner(deps: HookRunnerDeps): HookRunner {
  const autoOff = new Set<string>();
  const isDisabled = (id: string): boolean => autoOff.has(id) || deps.savedDisabled().includes(id);

  async function runOne(
    hook: LoadedHook,
    point: HookHookName,
    payload: unknown,
    current: unknown,
    ctx: CallContext,
    process: HookProcessPort,
  ): Promise<ExecResult> {
    const fold = FOLD_OF[point];
    const projectDir = deps.projectDir(ctx.threadId) ?? deps.home();
    const cwd = hook.def.cwd === "home" ? deps.home() : projectDir;
    const input: HookInput = {
      schemaVersion: HOOK_SCHEMA_VERSION,
      hookId: hook.def.id,
      point,
      fold,
      threadId: ctx.threadId,
      cwd,
      payload,
      ...(fold === "chain" ? { current } : {}),
    };
    const controller = new AbortController();
    const abort = (): void => controller.abort();
    ctx.signal.addEventListener("abort", abort, { once: true });
    const cancelTimer = deps.setTimer(hook.def.timeoutMs ?? deps.budgetMs(), abort);
    const startedAt = deps.now();
    const raw = await process
      .run({
        argv: hook.def.command,
        cwd,
        env: hookEnv(deps.parentEnv(), hook.def, deps.envAllow(), {
          hookId: hook.def.id,
          point,
          threadId: ctx.threadId,
          projectDir,
        }),
        stdin: encodeHookInput(input),
        maxStdoutChars: HOOK_OUTPUT_MAX_CHARS,
        maxStderrChars: HOOK_STDERR_MAX_CHARS,
        signal: controller.signal,
      })
      .finally(() => {
        cancelTimer();
        ctx.signal.removeEventListener("abort", abort);
      });
    let verdict = interpretHookRun(fold, raw);
    // 결정·패치는 지점의 스키마로 다시 검사한다. 틀리면 출력 실패다
    const schema = HOOKS[point].result;
    if (
      (verdict.kind === "decision" || verdict.kind === "patch") &&
      schema !== undefined &&
      !Value.Check(schema, verdict.kind === "decision" ? verdict.decision : verdict.patch)
    ) {
      verdict = {
        kind: "failure",
        failure: "hook_output",
        detail: "output does not match the hook result schema",
      };
    }
    const record = (result: HandlerOutcomeRecord["result"], message?: string): void => {
      deps.report({
        owner: { type: "hook", hookId: hook.def.id },
        tier: hook.tier,
        point,
        fold,
        failure: HOOKS[point].failure,
        result,
        activeMs: deps.now() - startedAt,
        at: deps.now(),
        ...(message === undefined ? {} : { message: message.slice(0, 500) }),
      });
    };
    // 계측 행: 이 훅의 활성 시간과 결과를 디스패치 항목에 `hook:<id>`로 넣는다. 단위의 행은 숨겨진다(X.operations §4.8.2)
    const traced = (
      result: TraceHandlerResult,
      reason: TraceFailureReason | null,
      size: number,
    ) => {
      ambient()?.trace?.record({
        registrationId: hookRegistrationId(hook.def.id),
        durationMs: deps.now() - startedAt,
        startedAt,
        result,
        size,
        skippedBy: null,
        reason,
      });
    };
    switch (verdict.kind) {
      case "pass":
        record("ok");
        traced("passed", null, 0);
        return { kind: "none" };
      case "decision":
        record("ok");
        traced(isBlocking(verdict.decision) ? "blocked" : "passed", null, 0);
        return { kind: "decision", value: verdict.decision };
      case "patch":
        record("ok");
        traced("modified", null, sizeOfPatch(verdict.patch));
        return { kind: "patch", value: verdict.patch };
      case "deny":
        record("ok");
        traced("blocked", null, 0);
        return { kind: "deny", reason: verdict.reason };
      case "failure":
        record(verdict.failure === "timeout" ? "timeout" : verdict.failure, verdict.detail);
        traced("failed", traceReasonOf(verdict.failure), 0);
        deps.log(`hook ${hook.def.id} failed: ${verdict.failure} ${verdict.detail}`);
        return { kind: "failed" };
      default:
        return assertNever(verdict, "HookVerdict");
    }
  }

  /** 훅 하나를 실행한다. thread에 적용되지 않는 훅(다른 작업 폴더의 것, 꺼진 것, 도구가 안 맞는 것)은 아무것도 하지 않는다 */
  async function exec(
    id: string,
    point: HookHookName,
    payload: unknown,
    current: unknown,
    ctx: CallContext,
    toolName?: string,
  ): Promise<ExecResult> {
    const process = deps.process();
    if (process === undefined) return { kind: "none" };
    const hook = deps
      .hooks(ctx.threadId)
      .find((candidate) => candidate.def.id === id && candidate.def.point === point);
    if (hook === undefined || isDisabled(id)) return { kind: "none" };
    if (
      toolName !== undefined &&
      hook.def.tools !== undefined &&
      !hook.def.tools.includes(toolName)
    ) {
      return { kind: "none" };
    }
    return runOne(hook, point, payload, current, ctx, process);
  }

  function makeUnit(spec: HookUnitSpec): ExtensionUnit {
    const name = hookUnitName(spec.id);
    const id = spec.id;
    const manifest: ExtensionManifest = {
      schemaVersion: 2,
      name,
      version: "0.1.0",
      entry: "./src/index.ts",
      plugins: [{ layer: "plugin", hooks: [spec.point] }],
    };
    return {
      manifest,
      entry: ({ register }) => {
        register(name, {}, (g) => {
          switch (spec.point) {
            case "thread.start":
            case "boundary.settle.after":
            case "thread.shutdown": {
              const point = spec.point;
              g.on(point, async (payload, ctx) => {
                await exec(id, point, payload, undefined, ctx);
              });
              break;
            }
            case "tool.call.before":
              g.on("tool.call.before", async (payload, ctx) => {
                const result = await exec(
                  id,
                  "tool.call.before",
                  payload,
                  undefined,
                  ctx,
                  payload.toolName,
                );
                if (result.kind === "decision") {
                  return isDecisionOf("tool.call.before", result.value) ? result.value : undefined;
                }
                if (result.kind === "deny") {
                  return {
                    block: true,
                    reason: result.reason === "" ? "denied by an external hook" : result.reason,
                    terminate: false,
                  };
                }
                return result.kind === "failed" ? FIRST_DENY["tool.call.before"] : undefined;
              });
              break;
            case "input.bash.before":
              g.on("input.bash.before", async (payload, ctx) => {
                const result = await exec(id, "input.bash.before", payload, undefined, ctx);
                if (result.kind === "decision") {
                  return isDecisionOf("input.bash.before", result.value) ? result.value : undefined;
                }
                if (result.kind === "deny") {
                  return {
                    type: "deny",
                    reason: result.reason === "" ? "denied by an external hook" : result.reason,
                  };
                }
                return result.kind === "failed" ? FIRST_DENY["input.bash.before"] : undefined;
              });
              break;
            case "thread.compact.before":
              // 실패해도 막지 않는 지점(fail-open)이라 거부값이 없다
              g.on("thread.compact.before", async (payload, ctx) => {
                const result = await exec(id, "thread.compact.before", payload, undefined, ctx);
                if (result.kind === "decision") {
                  return isDecisionOf("thread.compact.before", result.value)
                    ? result.value
                    : undefined;
                }
                return undefined;
              });
              break;
            case "input.user.before":
              g.on("input.user.before", async (payload, current, ctx) => {
                const result = await exec(id, "input.user.before", payload, current, ctx);
                return result.kind === "patch" && isPatchOf("input.user.before", result.value)
                  ? result.value
                  : undefined;
              });
              break;
            case "tool.result":
              g.on("tool.result", async (payload, current, ctx) => {
                const result = await exec(
                  id,
                  "tool.result",
                  payload,
                  current,
                  ctx,
                  payload.toolName,
                );
                return result.kind === "patch" && isPatchOf("tool.result", result.value)
                  ? result.value
                  : undefined;
              });
              break;
            default:
              assertNever(spec.point, "HookHookName");
          }
        });
      },
      loadIndex: spec.loadIndex,
      builtin: true,
    };
  }

  return {
    unitOf: makeUnit,
    disable(id) {
      autoOff.add(id);
    },
    enable(id) {
      autoOff.delete(id);
    },
    isDisabled,
  };
}
