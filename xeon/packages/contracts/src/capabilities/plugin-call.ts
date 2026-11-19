import type { JsonValue, ThreadId } from "../conversation/index.ts";
import type { CapabilityId, ToolName } from "./ids.ts";
import type { ToolRisk } from "./tool-meta.ts";

// 플러그인 기능 호출의 값(hooks-core-boundary §4.6, L1.tools §4.6 executeForPlugin). ToolsPort(extensions)와 ToolService(services)가
// 같이 쓰므로 둘보다 낮은 이 층에 둔다. services/tools.ts는 같은 이름을 다시 내보낸다(tool-meta.ts와 같은 규칙).

/** 플러그인 호출을 낸 경로. 훅, 도구, 명령, 기능 메서드, 주도 함수의 `tool` 명령, 효과 작업자 */
export type PluginCallVia = "hook" | "tool" | "command" | "method" | "drive" | "effect";

/**
 * 플러그인 호출의 대상. 주도 함수의 `tool` 명령은 도구 이름을 부르고(모델 도구와 같은 이름 공간), 기능 메서드 호출은
 * 기능 id와 메서드 이름을 준다. 기능 메서드는 도구 매핑(`ToolSpec.method`)으로 도구를 찾고, 없으면 합성 이름 `cap:<기능>.<메서드>`를 본다
 */
export type PluginCallTarget =
  | { readonly kind: "tool"; readonly name: ToolName }
  | { readonly kind: "capability"; readonly capability: CapabilityId; readonly method: string }
  /**
   * 초안 스크립트 실행(설계 B, AGE-58 [제안]). 도구 실행 블록이 합성 항목(위험 등급 `exec`)으로 승인 카드를 열고, 승인되면 `run`을 부른다.
   * 입력(`input`)은 카드가 보여 줄 값이다. 초안 출신 호출에만 열린다(아니면 `unavailable`). `ok`가 거짓이면 도구 결과가 오류다
   */
  | {
      readonly kind: "script";
      readonly name: string;
      readonly run: (
        signal: AbortSignal,
      ) => Promise<{ readonly ok: boolean; readonly value: JsonValue }>;
    };

export interface PluginCallRequest {
  readonly threadId: ThreadId;
  /** 호출한 플러그인. `scopeId`는 등록 id(재생 멱등 키의 범위), `name`은 호출 주체 `plugin:<name>`이 된다 */
  readonly plugin: { readonly name: string; readonly scopeId: string };
  readonly via: PluginCallVia;
  readonly target: PluginCallTarget;
  /** 도구 대상이면 인자 객체여야 한다(검증은 도구 스키마가 한다) */
  readonly input: JsonValue;
  /** 1~64자. 같은 (`plugin.scopeId`, `requestId`)는 한 번만 실행하고 기록된 결과를 돌려준다(재생 멱등 키) */
  readonly requestId: string;
  /** 플러그인 도구 안에서 부른 호출이면 바깥 도구 호출 id(`ToolCallPayload.parentToolCallId`) */
  readonly parentToolCallId?: string;
  /** 이 호출을 시작한 훅 스택의 길이. 설정 `l1.tools.pluginCallDepth`를 넘으면 `hook_depth`로 거부한다 */
  readonly hookDepth?: number;
  /**
   * 사람이 이미 답한 승인을 이 호출이 이어받는다는 주장(U-11). 정책이 묻기만 하는 호출에서만 카드를 건너뛴다.
   * 엔진이 승인 기록과 대조해 맞을 때만 쓰고, 맞지 않으면 무시하고 보통의 승인 카드를 띄운다.
   * `risk`는 옛 주장 모양이라 쓰지 않는다(위험 등급은 승인 기록의 값을 본다)
   */
  readonly inheritApproval?: { readonly approvalId: string; readonly risk?: ToolRisk };
  /**
   * 호출 조건(U-12). 효과 작업자는 요청 때 기록한 `interactive`와 샌드박스 천장을 싣는다(나중에 돌아도 같은 조건이다).
   * 없으면 이 대화에서 진행 중인 호출의 값을 따르고, 그것도 없으면 대화형이다
   */
  readonly conditions?: { readonly interactive: boolean; readonly sandbox?: "read-only" };
  readonly signal?: AbortSignal;
}

/** 플러그인 호출이 돌려주는 도구 결과. 기능 메서드의 반환은 `structuredContent`로 되돌린다 */
export interface ToolResultView {
  /** 텍스트 내용을 줄바꿈으로 이은 값. 재생에서는 빈 문자열일 수 있다(durable 기록에 텍스트가 없다) */
  readonly content: string;
  /** 구조화 반환값. 기능 메서드의 반환 모양이 여기에 들어간다. 없으면 null */
  readonly structuredContent: JsonValue | null;
  readonly isError: boolean;
  readonly details: JsonValue | null;
}

/**
 * 플러그인 호출이 결과를 내지 못한 이유.
 * - `unavailable`: 대상 도구나 기능 메서드가 없다
 * - `invalid_args`: 요청 값이 형식에 맞지 않다(requestId 길이, 인자 검증, 플러그인 이름)
 * - `denied`: 정책 거부 또는 사용자가 승인을 거부했다
 * - `blocked`: 훅(`tool.call.before`, `guard.tool.before`)이 막았다. 핸들러 실패도 막음이다(fail-closed)
 * - `hook_cycle`: 훅 안의 호출이 같은 훅 체인을 되부른다(다음 층에서 낸다)
 * - `hook_depth`: 훅 스택이 `l1.tools.pluginCallDepth`를 넘었다
 * - `aborted`: 호출이 중단됐다
 * - `storage`: 저장소 커밋이나 읽기가 실패했다
 * - `unknown_outcome`: 같은 요청의 의도는 기록됐는데 결과가 없다. 효과가 났을 수 있어 다시 실행하지 않는다
 */
export type ToolErrorKind =
  | "unavailable"
  | "invalid_args"
  | "denied"
  | "blocked"
  | "hook_cycle"
  | "hook_depth"
  | "aborted"
  | "storage"
  | "unknown_outcome";

/**
 * 플러그인 호출의 실패 값. 메시지는 `[fresnel:<코드>] <사유>` 형식을 따른다.
 * `resolvedBy`는 `denied`일 때만 있다: 정책 규칙이 막았는지, 사용자가 거부했는지, 무인 실행이라 물을 수 없었는지.
 * 취소·만료로 끝난 승인은 거부한 쪽이 없으므로 싣지 않는다
 */
export interface ToolError {
  readonly kind: ToolErrorKind;
  readonly message: string;
  readonly resolvedBy?: "policy" | "human" | "noninteractive";
}
