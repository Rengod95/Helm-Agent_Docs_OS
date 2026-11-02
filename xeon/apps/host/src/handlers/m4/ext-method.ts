import { assertNever, parse } from "@fresnel/contracts";
import { ThreadIdSchema, type ThreadId } from "@fresnel/contracts/conversation";
import { classifyMethodName, wireError, WireError } from "@fresnel/contracts/wire";

// 확장 메서드 wire `ext.<확장>.<동사>`(F.wire-settings.spec §4.2, L4.host-service.spec §3.3.3, X-2·X-3). 닫힌 `WireMethodName` 표 밖의 이름을
// 연결 층이 이 파일로 넘긴다. 호출과 검사는 X의 `ExtHost.methods`(포트)가 하고, 이 파일은 wire 모양(thread 지정, 오류 대응)만 맡는다.

/** 확장 메서드 호출 결과. X의 `ExtMethodOutcome`과 같은 모양이다(예상 가능한 실패는 값) */
export type ExtMethodCallOutcome =
  | { readonly kind: "ok"; readonly value: unknown }
  | { readonly kind: "not_found" }
  | { readonly kind: "extension_off" }
  | {
      readonly kind: "params_invalid";
      readonly issues: readonly { readonly path: string; readonly message: string }[];
    }
  | {
      readonly kind: "result_invalid";
      readonly issues: readonly { readonly path: string; readonly message: string }[];
    }
  | { readonly kind: "threw"; readonly message: string }
  | { readonly kind: "timeout"; readonly budgetMs: number }
  | { readonly kind: "aborted" };

export interface ExtMethodCallRequest {
  readonly extension: string;
  readonly verb: string;
  readonly params: Readonly<Record<string, unknown>>;
  readonly threadId: ThreadId | null;
  readonly signal: AbortSignal;
}

/** 조립 루트가 `ExtHost.methods.call`로 구현하는 포트. 던지지 않는다 */
export interface ExtMethodPort {
  call(request: ExtMethodCallRequest): Promise<ExtMethodCallOutcome>;
}

/** 확장 구간(10000~19999, F.wire-settings.spec §3.5.3)의 호스트 정의 코드. `kind`는 `ext.<확장>.<이름>`이다 */
const EXT_METHOD_ERROR_CODES = {
  /** 처리기가 던졌거나, 결과가 선언과 다르거나, 시간 예산을 넘었다. `details.outcome`이 구분한다 */
  failed: 10001,
  /** 확장이 꺼져 있거나 그 대화에서 꺼져 있다 */
  off: 10002,
} as const;

/** wire 요청 params에서 대화를 가리키는 예약 키. 처리기에는 `ctx.threadId`로 가고 `decl.params` 검사에서는 빠진다 */
const EXT_METHOD_THREAD_KEY = "threadId";

interface ParsedName {
  readonly extension: string;
  readonly verb: string;
}

/** `ext.<확장>.<동사>`를 나눈다. 확장 이름이 아니면 undefined */
export function parseExtMethodName(method: string): ParsedName | undefined {
  if (classifyMethodName(method) !== "extension") return undefined;
  const [, extension = "", verb = ""] = method.split(".");
  return { extension, verb };
}

function invalidParams(path: string, message: string): WireError {
  return wireError("jsonrpc.invalidParams", { details: { issues: [{ path, message }] } });
}

/** params에서 예약 키 `threadId`를 떼어 낸다. 값이 대화 id 모양이 아니면 invalidParams */
function splitThread(raw: Readonly<Record<string, unknown>>): {
  readonly threadId: ThreadId | null;
  readonly params: Record<string, unknown>;
} {
  const { [EXT_METHOD_THREAD_KEY]: threadValue, ...rest } = raw;
  if (threadValue === undefined) return { threadId: null, params: rest };
  const parsed = parse(ThreadIdSchema, threadValue);
  if (!parsed.ok) throw invalidParams(`/${EXT_METHOD_THREAD_KEY}`, "must be a thread id");
  return { threadId: parsed.value, params: rest };
}

function extensionError(
  extension: string,
  name: "failed" | "off",
  message: string,
  details: Readonly<Record<string, unknown>>,
): WireError {
  const kind = `ext.${extension}.${name}`;
  return new WireError(EXT_METHOD_ERROR_CODES[name], message, {
    kind,
    retryable: false,
    details,
  });
}

/**
 * 확장 메서드 하나를 부른다. 성공하면 결과 객체를 돌려주고, 실패는 WireError를 던진다(연결 층이 JSON-RPC 오류로 옮긴다).
 * 대응표(F.wire-settings.spec §4.2): not_found → jsonrpc.methodNotFound, params_invalid → jsonrpc.invalidParams(issues),
 * aborted → request.cancelled, extension_off → `ext.<확장>.off`(10002), threw·result_invalid·timeout → `ext.<확장>.failed`(10001, `details.outcome`).
 */
export async function runExtMethod(
  port: ExtMethodPort,
  name: ParsedName,
  rawParams: Readonly<Record<string, unknown>>,
  signal: AbortSignal,
): Promise<Record<string, unknown>> {
  const { threadId, params } = splitThread(rawParams);
  const outcome = await port.call({
    extension: name.extension,
    verb: name.verb,
    params,
    threadId,
    signal,
  });
  switch (outcome.kind) {
    case "ok": {
      const value = outcome.value;
      if (typeof value !== "object" || value === null || Array.isArray(value)) {
        throw extensionError(name.extension, "failed", "result is not an object", {
          verb: name.verb,
          outcome: "result_not_object",
        });
      }
      return Object.fromEntries(Object.entries(value));
    }
    case "not_found":
      throw wireError("jsonrpc.methodNotFound", {
        details: { method: `ext.${name.extension}.${name.verb}` },
      });
    case "extension_off":
      throw extensionError(name.extension, "off", "extension is off", { verb: name.verb });
    case "params_invalid":
      throw wireError("jsonrpc.invalidParams", {
        details: {
          issues: outcome.issues.slice(0, 20).map((issue) => ({
            path: issue.path.slice(0, 512),
            message: issue.message.slice(0, 512),
          })),
        },
      });
    case "result_invalid":
      throw extensionError(name.extension, "failed", "result does not match the declaration", {
        verb: name.verb,
        outcome: "result_invalid",
      });
    case "threw":
      throw extensionError(name.extension, "failed", outcome.message.slice(0, 256), {
        verb: name.verb,
        outcome: "threw",
      });
    case "timeout":
      throw extensionError(name.extension, "failed", "method time budget exceeded", {
        verb: name.verb,
        outcome: "timeout",
        budgetMs: outcome.budgetMs,
      });
    case "aborted":
      throw wireError("request.cancelled");
    default:
      return assertNever(outcome, "ExtMethodCallOutcome");
  }
}
