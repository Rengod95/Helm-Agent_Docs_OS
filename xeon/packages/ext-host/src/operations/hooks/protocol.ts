import { parseJson } from "@fresnel/contracts";
import type { HookRawRun } from "@fresnel/contracts/extensions";
import { Type } from "typebox";
import { Value } from "typebox/value";
import type { HookHookName } from "./config.ts";

// stdin/stdout JSON, 종료 코드, 출력 상한(X.operations.spec §4.7.3)

export const HOOK_SCHEMA_VERSION = "fresnel.hook.v1";
export const HOOK_OUTPUT_MAX_CHARS = 10_000;
export const HOOK_STDERR_MAX_CHARS = 10_000;
export const HOOK_EXIT_DENY = 2;
const DENY_REASON_CHARS = 500;

export interface HookInput {
  readonly schemaVersion: typeof HOOK_SCHEMA_VERSION;
  readonly hookId: string;
  readonly point: HookHookName;
  readonly fold: "tap" | "first" | "chain";
  readonly threadId: string;
  readonly cwd: string;
  readonly payload: unknown;
  /** chain 훅에서만. 앞 핸들러까지 누적된 값 */
  readonly current?: unknown;
}

/** stdin에 쓸 한 줄(개행 포함) */
export function encodeHookInput(input: HookInput): string {
  return `${JSON.stringify(input)}\n`;
}

const HookOutputSchema = Type.Object(
  {
    decision: Type.Optional(Type.Unknown()),
    patch: Type.Optional(Type.Unknown()),
    message: Type.Optional(Type.String({ maxLength: 2000 })),
  },
  { additionalProperties: false },
);

export type HookFailureKind = "hook_exit" | "hook_spawn" | "hook_output" | "timeout";

export type HookVerdict =
  | { readonly kind: "pass" }
  | { readonly kind: "decision"; readonly decision: unknown }
  | { readonly kind: "patch"; readonly patch: unknown }
  | { readonly kind: "deny"; readonly reason: string }
  | { readonly kind: "failure"; readonly failure: HookFailureKind; readonly detail: string };

function parseOutput(stdout: string): { ok: true; value: unknown } | { ok: false } {
  const text = stdout.trim();
  if (text === "") return { ok: true, value: {} };
  const parsed = parseJson(text);
  return parsed.ok ? { ok: true, value: parsed.value } : { ok: false };
}

/** 순수 함수. §4.7.3 종료 코드 표. 결정·패치의 지점 스키마 검사는 호출하는 쪽이 한다 */
export function interpretHookRun(fold: "tap" | "first" | "chain", run: HookRawRun): HookVerdict {
  if (run.spawnError !== undefined) {
    return { kind: "failure", failure: "hook_spawn", detail: run.spawnError };
  }
  if (run.timedOut) return { kind: "failure", failure: "timeout", detail: "hook timed out" };
  if (run.exitCode === HOOK_EXIT_DENY) {
    if (fold === "first") return { kind: "deny", reason: run.stderr.slice(0, DENY_REASON_CHARS) };
    return { kind: "pass" };
  }
  if (run.exitCode !== 0) {
    const how =
      run.exitCode === null ? `signal ${run.signal ?? "unknown"}` : `exit ${run.exitCode}`;
    return { kind: "failure", failure: "hook_exit", detail: how };
  }
  if (run.stdoutTruncated) {
    return { kind: "failure", failure: "hook_output", detail: "stdout exceeds the limit" };
  }
  if (fold === "tap") return { kind: "pass" };
  const parsed = parseOutput(run.stdout);
  if (!parsed.ok || !Value.Check(HookOutputSchema, parsed.value)) {
    return { kind: "failure", failure: "hook_output", detail: "stdout is not a valid hook output" };
  }
  const { decision, patch } = parsed.value;
  if (fold === "first" && decision !== undefined) return { kind: "decision", decision };
  if (fold === "chain" && patch !== undefined) return { kind: "patch", patch };
  return { kind: "pass" };
}
