import { createHash } from "node:crypto";
import { err, type Result } from "@fresnel/contracts";
import type { JsonObject, ThreadId } from "@fresnel/contracts/conversation";
import type {
  ScriptDraftCall,
  ScriptDraftGate,
  ScriptRunFailure,
  ScriptRunResult,
  ToolsPort,
} from "@fresnel/contracts/extensions";
import type { FixedDraftMark } from "../m4/plugin-set.ts";

// 초안 스크립트의 승인 문(설계 B, AGE-58 [제안], L4.host-service.spec §4.27). 테스트 런(과 테스트 챗) 대화에 묶인 초안의 `g.runScript`를
// 호출마다 승인 카드로 연다. 카드는 L1 도구 실행 블록의 초안 호출 경로(`executeForPlugin`의 `script` 대상)가 연다:
// 위험 등급 `exec`, 초안 표지, 승인 상속 없음, "이번 한 번"만, 드래프트 승인 `auto`에도 건너뛰지 않는다(`alwaysCard`).
// 일반 대화, 묶이지 않은 초안(다른 초안, 덧씌우기만 한 초안)은 `script_not_approved`다. 거절하면 스크립트는 돌지 않는다.

export interface ScriptDraftGateDeps {
  /** 도구 서비스(`fresnel.tools`). 지연 조회다. 없으면 카드를 열 수 없어 거절한다 */
  readonly tools: () => ToolsPort | undefined;
  /** 이 대화에 묶인 테스트 런 초안 표지. 테스트 런이 아니면 undefined다 */
  readonly testRunDraftsOf: (threadId: ThreadId) => readonly FixedDraftMark[] | undefined;
  /** 호출마다 새로 나는 요청 id(1~64자). 재시작 뒤에도 겹치지 않아야 한다(같은 id는 기록된 결과를 돌려주고 다시 돌지 않는다) */
  readonly newRequestId: () => string;
  /**
   * 프로세스가 시작할 때 한 번 정하는 값(1~16자). 기억의 열쇠에 섞어, 재시작 뒤 되살아난 같은 테스트 런이 이전 승인을 기억하지 못하게 한다
   * (가장 보수적인 쪽: 다시 묻는다). 생략하면 "0"이다(시험용)
   */
  readonly bootId?: string;
}

const NOT_APPROVED: Result<ScriptRunResult, ScriptRunFailure> = err({
  kind: "script_not_approved",
});

function cardInput(call: ScriptDraftCall): JsonObject {
  return {
    command: call.card.command,
    args: [...call.card.args],
    envNames: [...call.card.envNames],
    stdinBytes: call.card.stdinBytes,
    stdinPreview: call.card.stdinPreview,
  };
}

/**
 * "이 테스트 런 동안 다시 묻지 않음"의 열쇠(AGE-58 [제안], [결정: 2026-11-19, 사용자, AGE-58]): 초안의 내용 해시, 스크립트 이름, 프로세스 시작 값을 섞는다.
 * 내용이 바뀐 초안은 해시가 달라 다른 열쇠이고, 기억은 승인 기록의 `thread` 범위라서 그 테스트 런 대화(와 자식 대화)를 넘지 않는다
 */
function memoryKeyOf(boot: string, contentHash: string, name: string): string {
  const digest = createHash("sha256").update(`${contentHash}\n${name}`).digest("hex");
  return `${boot}-${digest.slice(0, 32)}`;
}

export function createScriptDraftGate(deps: ScriptDraftGateDeps): ScriptDraftGate {
  const boot = (deps.bootId ?? "0").replace(/[^A-Za-z0-9]/g, "").slice(-12);
  return async (call) => {
    // 일반 대화이거나 이 대화에 묶이지 않은 초안이면 띄우지 않는다
    const marks = deps.testRunDraftsOf(call.threadId);
    const bound = marks?.find((mark) => mark.plugin === call.extension);
    if (bound === undefined) return NOT_APPROVED;
    const tools = deps.tools();
    if (tools === undefined) return err({ kind: "script_denied", cause: "unavailable" });
    // 승인된 호출만 `run`을 부르고, 그 결과를 여기서 받는다(도구 결과 값은 같은 내용의 사본이다)
    let outcome: Result<ScriptRunResult, ScriptRunFailure> | undefined;
    const opened = await tools.executeForPlugin({
      threadId: call.threadId,
      plugin: { name: call.extension, scopeId: call.registration },
      via: "method",
      target: {
        kind: "script",
        name: call.name,
        memoryKey: memoryKeyOf(boot, bound.contentHash, call.name),
        run: async (signal) => {
          outcome = await call.run(signal);
          return outcome.ok
            ? {
                ok: true,
                value: { exitCode: outcome.value.exitCode, timedOut: outcome.value.timedOut },
              }
            : { ok: false, value: { failure: outcome.error.kind } };
        },
      },
      input: cardInput(call),
      requestId: deps.newRequestId(),
    });
    if (!opened.ok) {
      return err({
        kind: "script_denied",
        cause: opened.error.kind,
        ...(opened.error.resolvedBy === undefined ? {} : { resolvedBy: opened.error.resolvedBy }),
      });
    }
    // 카드를 승인했는데 실행 결과가 없으면(기록된 결과의 재생) 돌지 않은 것으로 거절한다
    return outcome ?? err({ kind: "script_denied", cause: "unknown_outcome" });
  };
}
