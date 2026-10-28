import type { Result } from "@xeon/contracts";
import { ok, err } from "@xeon/contracts";
import {
  parseSecretRef,
  type SecretHandle,
  type SecretRefError,
} from "@xeon/contracts/capabilities";
import type { JsonObject } from "@xeon/contracts/conversation";
import type { SecretError, SecretService, ToolRunContext, UseCtx } from "@xeon/contracts/services";
import { isJsonObject } from "./util.ts";

// L1.tools.spec §4.12, L0.secrets.spec §4.2. 도구 호출이 비밀을 쓰면(`secretEnv`) 실행 전에 `xeon.secrets.check`로 정책을 본다.
// `needs_approval`이면 사람의 승인이 필요하고, 받은 증거(`ApprovalEvidence`)를 호출에 실어 `xeon.exec`의 `withEnv`가 `lease`에 넣는다(U-19).
// 값은 이 파일에 오지 않는다. 참조(`secret://<name>`)만 다룬다.

/** secrets 서비스 중 이 파일이 쓰는 메서드 */
export type SecretChecker = Pick<SecretService, "check">;

/** 도구 인자의 `secretEnv`(env 이름 → 비밀 참조)가 가리키는 비밀과 명령줄 */
interface SecretEnvUse {
  readonly handles: readonly SecretHandle[];
  readonly command: string | undefined;
}

interface SecretEnvRefError {
  readonly name: string;
  readonly error: SecretRefError;
}

/**
 * `args.secretEnv`에서 비밀 참조를 모은다. 인자에 `secretEnv`가 없으면 ok(undefined)다.
 * `$VAR`, `{{secret:x}}` 같은 남의 구문과 틀린 참조는 오류 값으로 돌려준다(L0.secrets.spec §3.1: 비밀 인자로 선언된 필드에만 거부한다)
 */
function scanSecretEnv(args: JsonObject): Result<SecretEnvUse | undefined, SecretEnvRefError> {
  const declared = args["secretEnv"];
  if (!isJsonObject(declared)) return ok(undefined);
  const seen = new Set<SecretHandle>();
  const handles: SecretHandle[] = [];
  for (const [name, ref] of Object.entries(declared)) {
    const parsed = parseSecretRef(typeof ref === "string" ? ref : "");
    if (!parsed.ok) return err({ name, error: parsed.error });
    if (!seen.has(parsed.value.handle)) {
      seen.add(parsed.value.handle);
      handles.push(parsed.value.handle);
    }
  }
  if (handles.length === 0) return ok(undefined);
  const command = args["command"];
  return ok({ handles, command: typeof command === "string" ? command : undefined });
}

/** 승인 제목의 길이 상한(`ApprovalRequestInput.title`) */
const TITLE_MAX = 120;

/** 호출 인자의 `secretEnv`가 가리키는 비밀. 참조가 틀리거나 `secretEnv`가 없으면 빈 목록이다(틀린 참조는 `checkSecretUse`가 거부한다) */
export function secretHandlesOf(args: JsonObject): readonly SecretHandle[] {
  const scanned = scanSecretEnv(args);
  return scanned.ok && scanned.value !== undefined ? scanned.value.handles : [];
}

/**
 * 비밀을 쓰는 호출의 승인 제목. 사용자가 이 승인으로 어떤 비밀을 내주는지 제목에서 알아야 하므로 비밀 참조를 앞에 둔다.
 * 제목 길이를 넘으면 들어가는 만큼만 적고 나머지는 개수로 알린다
 */
export function secretUseTitle(toolName: string, handles: readonly SecretHandle[]): string {
  const head = `Allow "${toolName}" to use `;
  const full = `${head}${handles.join(", ")}?`;
  if (full.length <= TITLE_MAX) return full;
  for (let shown = handles.length - 1; shown >= 1; shown -= 1) {
    const rest = handles.length - shown;
    const title = `${head}${handles.slice(0, shown).join(", ")} (+${String(rest)} more)?`;
    if (title.length <= TITLE_MAX) return title;
  }
  return `${head}${String(handles.length)} secrets?`.slice(0, TITLE_MAX);
}

/** 명령줄에서 정책이 판정할 target을 만든다(platform-exec `commandTarget`과 같은 규칙) */
function commandTarget(command: string): UseCtx["target"] {
  const trimmed = command.trim();
  return { kind: "command", argv0: trimmed.split(/\s+/)[0] ?? "", commandLine: trimmed };
}

/** `bash:<명령 이름>` 형식의 사용 목적. cap-workspace의 shell `run`이 lease에 넘기는 purpose와 같은 규칙이다 */
function purposeOf(command: string): string {
  const first = command.trim().split(/\s+/)[0] ?? "";
  const name = (first.split("/").at(-1) ?? "").replace(/[^A-Za-z0-9._+-]/g, "").slice(0, 48);
  return name === "" ? "bash" : `bash:${name}`;
}

export type SecretUseVerdict =
  | { readonly kind: "none" }
  | { readonly kind: "denied"; readonly reason: string }
  | {
      readonly kind: "needs_approval";
      readonly handles: readonly SecretHandle[];
      readonly scope: "per-session" | "per-use";
    };

function deniedBy(handle: SecretHandle, detail: string): SecretUseVerdict {
  return {
    kind: "denied",
    reason: `[xeon:secret_denied] The call cannot use ${handle}: ${detail}.`,
  };
}

function errorDetail(error: SecretError): string {
  return error.kind === "denied" ? error.reason : error.kind;
}

/**
 * 호출이 쓰는 비밀마다 `check`를 부른다(증거 없이). 하나라도 거부면 거부, `needs_approval`이 있으면 승인이 필요하다.
 * 승인이 더 엄격한 쪽(per-use)을 따른다.
 */
export async function checkSecretUse(
  secrets: SecretChecker | undefined,
  input: {
    readonly toolName: string;
    readonly args: JsonObject;
    readonly run: ToolRunContext;
    readonly toolCallId: string;
  },
): Promise<SecretUseVerdict> {
  const scanned = scanSecretEnv(input.args);
  if (!scanned.ok) {
    return {
      kind: "denied",
      reason: `[xeon:invalid_secret_ref] secretEnv.${scanned.error.name} is not a secret://<name> reference.`,
    };
  }
  const use = scanned.value;
  if (use === undefined) return { kind: "none" };
  if (secrets === undefined) {
    return {
      kind: "denied",
      reason: "[xeon:secret_unavailable] The secrets service is not available.",
    };
  }
  if (use.command === undefined) {
    return {
      kind: "denied",
      reason: "[xeon:invalid_secret_ref] secretEnv needs a command to bind to.",
    };
  }
  const command = use.command;
  const ctx: UseCtx = {
    mode: "env",
    purpose: purposeOf(command),
    target: commandTarget(command),
    actor: "agent",
    threadId: input.run.threadId,
    toolCallId: input.toolCallId,
    projectId: null,
    approval: null,
  };
  const tally = await tallyChecks(secrets, use.handles, ctx, {
    needsApproval: false,
    perUse: false,
  });
  if ("kind" in tally) return tally;
  if (!tally.needsApproval) return { kind: "none" };
  return {
    kind: "needs_approval",
    handles: use.handles,
    scope: tally.perUse ? "per-use" : "per-session",
  };
}

interface Tally {
  readonly needsApproval: boolean;
  readonly perUse: boolean;
}

/** 비밀을 차례로 확인한다. 거부가 나오면 거기서 멈추고 거부를 돌려준다 */
async function tallyChecks(
  secrets: SecretChecker,
  handles: readonly SecretHandle[],
  ctx: UseCtx,
  soFar: Tally,
): Promise<Tally | SecretUseVerdict> {
  const [handle, ...rest] = handles;
  if (handle === undefined) return soFar;
  const checked = await secrets.check(handle, ctx);
  if (!checked.ok) return deniedBy(handle, errorDetail(checked.error));
  const decision = checked.value;
  if (decision.kind === "deny") return deniedBy(handle, decision.reason);
  const next: Tally =
    decision.kind === "needs_approval"
      ? { needsApproval: true, perUse: soFar.perUse || decision.approval === "per-use" }
      : soFar;
  return tallyChecks(secrets, rest, ctx, next);
}
