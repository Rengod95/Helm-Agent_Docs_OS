// 공개 기능 `models.complete`의 공급 구현(hooks-core-boundary §6.2, D-30). `ModelService.completeForPlugin`을 감싼다.
// 호출자 이름은 호출 문맥의 `caller.extension`에서 얻는다. 없으면 호출을 거부한다. 재생 키는 `options.requestId`다.
import {
  CapabilityError,
  ModelsComplete,
  type CapabilityApi,
  type CommonErrorCode,
  type PluginModelError,
} from "@fresnel/contracts/capabilities";
import type { ModelService } from "@fresnel/contracts/services";

type CompleteFor = Pick<ModelService, "completeForPlugin">;

/** 제공자 오류 종류 → 공통 기능 오류 코드와 재시도 가능 여부. 표에 없는 종류는 `upstream_error`(재시도 없음)다 */
interface ErrorClass {
  readonly code: CommonErrorCode;
  readonly retryable: boolean;
}
const ERROR_CLASS_BY_KIND: ReadonlyMap<string, ErrorClass> = new Map<string, ErrorClass>([
  ["aborted", { code: "aborted", retryable: false }],
  ["denied_by_guard", { code: "denied", retryable: false }],
  ["rate_limited", { code: "rate_limited", retryable: true }],
  ["overloaded", { code: "upstream_error", retryable: true }],
  ["transport", { code: "upstream_error", retryable: true }],
  ["no_model_for_role", { code: "unavailable", retryable: false }],
  ["model_not_found", { code: "unavailable", retryable: false }],
  ["model_denied", { code: "unavailable", retryable: false }],
  ["provider_unavailable", { code: "unavailable", retryable: false }],
  ["invalid_ref", { code: "unavailable", retryable: false }],
  ["provider_conflict", { code: "unavailable", retryable: false }],
  ["invalid_provider", { code: "unavailable", retryable: false }],
  ["secret_unresolved", { code: "unavailable", retryable: false }],
  ["oauth_token_on_default_provider", { code: "unavailable", retryable: false }],
]);
const FALLBACK_CLASS: ErrorClass = { code: "upstream_error", retryable: false };

/**
 * 제공자 호출 오류를 기능 오류로 옮긴다. 공통 코드를 고르고 제공자 종류는 `detail.kind`에 남긴다.
 * 기능 메서드는 실패를 거부(CapabilityError)로 알린다(F.capabilities 오류 규약)
 */
function failureOf(error: PluginModelError): CapabilityError {
  const { code, retryable } = ERROR_CLASS_BY_KIND.get(error.kind) ?? FALLBACK_CLASS;
  return new CapabilityError({
    capability: ModelsComplete.id,
    method: "complete",
    code,
    retryable,
    message: error.message,
    detail: { kind: error.kind },
  });
}

/** `models.complete` 공급자. 결과의 텍스트, 사용량, 정지 이유를 돌려준다 */
export function modelsCompleteOf(service: CompleteFor): CapabilityApi<typeof ModelsComplete> {
  return {
    complete: async (input, options) => {
      const plugin = options.context?.caller.extension;
      if (plugin === undefined) {
        throw new CapabilityError({
          capability: ModelsComplete.id,
          method: "complete",
          code: "invalid_input",
          message: "the call has no plugin identity",
          retryable: false,
        });
      }
      const result = await service.completeForPlugin({
        threadId: input.threadId,
        // 등록 id가 따로 없어 확장 이름을 범위로 쓴다(사용량 귀속과 재생 키의 범위)
        plugin: { name: plugin, scopeId: plugin },
        requestId: options.requestId,
        messages: input.messages,
        ...(input.label === undefined ? {} : { label: input.label }),
        ...(options.signal === undefined ? {} : { signal: options.signal }),
      });
      if (!result.ok) throw failureOf(result.error);
      return {
        text: result.value.text,
        usage: result.value.usage,
        stopReason: result.value.stopReason,
      };
    },
  };
}
