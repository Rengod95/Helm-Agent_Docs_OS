import {
  FIRST_DENY,
  HOOKS,
  type ExtensionManifest,
  type HookProcessPort,
  type HookSignatures,
} from "@fresnel/contracts/extensions";
import { assertNever } from "@fresnel/contracts";
import { Value } from "typebox/value";
import type { ExtensionUnit } from "../../primitives/host.ts";
import type { HandlerOutcomeRecord } from "../failure.ts";
import {
  HOOK_HOOKS,
  HOOK_SOURCES,
  type HookHookName,
  type HookSource,
  type LoadedHook,
} from "./config.ts";
import { hookEnv } from "./env.ts";
import {
  encodeHookInput,
  HOOK_OUTPUT_MAX_CHARS,
  HOOK_SCHEMA_VERSION,
  HOOK_STDERR_MAX_CHARS,
  interpretHookRun,
  type HookInput,
} from "./protocol.ts";

// 외부 훅 실행기(X.operations.spec §4.7.4). 설정 범위마다 내장 단위 하나가 8개 지점에 핸들러를 달고,
// 호출 때 그 범위의 훅을 읽어 하나씩 실행한다. 실패 장부 키는 단위가 아니라 `hook:<id>`다.

const HOOK_UNIT_PREFIX = "fresnel-hooks-";
/** 외부 훅 단위의 loadIndex. 모든 확장 뒤에 범위 순서로 이어 붙인다(§4.7.4) */
const HOOK_UNIT_LOAD_INDEX_BASE = 1_000_000;

export function hookUnitName(source: HookSource): string {
  return `${HOOK_UNIT_PREFIX}${source}`;
}

export function isHookUnitName(name: string): boolean {
  return name.startsWith(HOOK_UNIT_PREFIX);
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

export interface HookRunner {
  /** 범위마다 하나, 관리 → 사용자 → 작업 폴더 → 로컬 순서 */
  units(): readonly ExtensionUnit[];
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
    switch (verdict.kind) {
      case "pass":
        record("ok");
        return { kind: "none" };
      case "decision":
        record("ok");
        return { kind: "decision", value: verdict.decision };
      case "patch":
        record("ok");
        return { kind: "patch", value: verdict.patch };
      case "deny":
        record("ok");
        return { kind: "deny", reason: verdict.reason };
      case "failure":
        record(verdict.failure === "timeout" ? "timeout" : verdict.failure, verdict.detail);
        deps.log(`hook ${hook.def.id} failed: ${verdict.failure} ${verdict.detail}`);
        return { kind: "failed" };
      default:
        return assertNever(verdict, "HookVerdict");
    }
  }

  async function exec(
    source: HookSource,
    point: HookHookName,
    payload: unknown,
    current: unknown,
    ctx: CallContext,
    toolName?: string,
  ): Promise<ExecResult> {
    const process = deps.process();
    if (process === undefined) return { kind: "none" };
    const matching = deps
      .hooks(ctx.threadId)
      .filter(
        (hook) =>
          hook.source === source &&
          hook.def.point === point &&
          !isDisabled(hook.def.id) &&
          (toolName === undefined ||
            hook.def.tools === undefined ||
            hook.def.tools.includes(toolName)),
      );
    // 같은 지점의 훅은 하나씩 순서대로 실행한다. 결정·패치·거부·실패가 나오면 거기서 멈춘다
    const runFrom = async (position: number): Promise<ExecResult> => {
      const hook = matching[position];
      if (hook === undefined) return { kind: "none" };
      const result = await runOne(hook, point, payload, current, ctx, process);
      return result.kind === "none" ? runFrom(position + 1) : result;
    };
    return runFrom(0);
  }

  function makeUnit(source: HookSource, index: number): ExtensionUnit {
    const name = hookUnitName(source);
    const manifest: ExtensionManifest = {
      schemaVersion: 2,
      name,
      version: "0.1.0",
      entry: "./src/index.ts",
      plugins: [{ layer: "plugin", hooks: [...HOOK_HOOKS] }],
    };
    return {
      manifest,
      entry: ({ register }) => {
        register(name, {}, (g) => {
          const tap = (point: "thread.start" | "boundary.settle.after" | "thread.shutdown") =>
            g.on(point, async (payload, ctx) => {
              await exec(source, point, payload, undefined, ctx);
            });
          tap("thread.start");
          tap("boundary.settle.after");
          tap("thread.shutdown");
          g.on("tool.call.before", async (payload, ctx) => {
            const result = await exec(
              source,
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
          g.on("input.bash.before", async (payload, ctx) => {
            const result = await exec(source, "input.bash.before", payload, undefined, ctx);
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
          // thread.compact.before는 실패해도 막지 않는 지점(fail-open)이라 거부값이 없다
          g.on("thread.compact.before", async (payload, ctx) => {
            const result = await exec(source, "thread.compact.before", payload, undefined, ctx);
            if (result.kind === "decision") {
              return isDecisionOf("thread.compact.before", result.value) ? result.value : undefined;
            }
            return undefined;
          });
          g.on("input.user.before", async (payload, current, ctx) => {
            const result = await exec(source, "input.user.before", payload, current, ctx);
            return result.kind === "patch" && isPatchOf("input.user.before", result.value)
              ? result.value
              : undefined;
          });
          g.on("tool.result", async (payload, current, ctx) => {
            const result = await exec(
              source,
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
        });
      },
      loadIndex: HOOK_UNIT_LOAD_INDEX_BASE + index,
      builtin: true,
    };
  }

  return {
    units: () => HOOK_SOURCES.map((source, index) => makeUnit(source, index)),
    disable(id) {
      autoOff.add(id);
    },
    enable(id) {
      autoOff.delete(id);
    },
    isDisabled,
  };
}
