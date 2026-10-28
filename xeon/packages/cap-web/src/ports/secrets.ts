import type { Result } from "@xeon/contracts";

/** 외부 전송 마스킹 판정. `Redactor.containsKnown`과 같은 모양이다(L0.secrets) */
export interface OutboundSecretGuard {
  containsKnown(text: string): boolean;
}

export type HeaderSecretError =
  | { readonly kind: "unset"; readonly setting: string }
  | { readonly kind: "unavailable"; readonly setting: string };

/**
 * 플러그인 provider의 인증 값. `ext.<이름>.<키>` 설정이 가리키는 비밀의 값을 전송 직전에만 얻는다.
 * 값은 provider 코드, 로그, 오류에 나타나지 않는다(L2.web.spec §3.6.1). 구현은 L0.secrets 런타임 HTTP 모드를 쓰는
 * 조립 쪽이 맡는다(M3).
 */
export interface HeaderSecretResolver {
  valueOf(setting: string, signal: AbortSignal): Promise<Result<string, HeaderSecretError>>;
}
