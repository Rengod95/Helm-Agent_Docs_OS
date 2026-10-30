import type { Result } from "@xeon/contracts";

/** 외부 전송 마스킹 판정. `Redactor.containsKnown`과 같은 모양이다(L0.secrets) */
export interface OutboundSecretGuard {
  containsKnown(text: string): boolean;
}

/**
 * 플러그인 provider 인증 헤더 하나. `setting`(`ext.<이름>.<키>`)이 가리키는 값은 `secret://<name>` 참조이고,
 * 실제 값은 전송 직전에만 헤더에 들어간다(L2.web.spec §3.6.1).
 */
export interface SecretHeader {
  /** 값을 넣을 헤더 이름(소문자로 보낸다) */
  readonly header: string;
  /** `ext.<이름>.<키>` 설정 키. 값은 참조 문자열이다 */
  readonly setting: string;
  /** "Bearer"면 값 앞에 `Bearer `를 붙인다(`authorization` 헤더) */
  readonly scheme?: "Bearer";
}

/** 비밀 헤더를 실을 요청의 나머지 부분. 헤더 값은 `SecretHeader`가 정한다 */
export interface HeaderSecretTarget {
  readonly method: "GET" | "POST";
  /** 질의 비밀을 두지 않는다. 호스트는 조립 쪽이 전송 대상 바인딩으로 검사한다 */
  readonly url: string;
  readonly body: string | Uint8Array | null;
}

/** 전송 응답 가운데 비밀 에코 검사에 쓰는 부분 */
export interface HeaderSendResponse {
  readonly status: number;
  /** 이름은 소문자 */
  readonly headers: Readonly<Record<string, string>>;
  /** 텍스트 본문이 아니면 null. 에코 검사는 본문 텍스트와 헤더 값을 본다 */
  readonly bodyText: string | null;
}

export type HeaderSecretError =
  | { readonly kind: "unset"; readonly setting: string }
  | { readonly kind: "unavailable"; readonly setting: string };

/**
 * 플러그인 provider의 헤더 비밀을 전송 직전에만 치환하는 통로. cap-web은 값을 얻지 않는다. 구현은 L0의 플러그인 HTTP 통로
 * (`createPluginHttp(...).send`, `SecretService.withHttp`)를 감싸 조립 쪽 어댑터가 맡는다(L4 후속 유닛).
 */
export interface HeaderSecretSender {
  /**
   * 각 `setting`을 확인하고 `send`를 한 번 부른다. `send`에 든 헤더 값은 `send` 안에서만 살아 있다. `echoed`는 응답 본문이나 헤더가
   * 비밀 값을 되돌려 줬을 때 참이다. 설정이 비었거나 참조를 풀 수 없으면 `unset`·`unavailable`이고 `send`는 불리지 않는다.
   */
  send<T extends HeaderSendResponse>(
    secretHeaders: readonly SecretHeader[],
    target: HeaderSecretTarget,
    signal: AbortSignal,
    send: (headers: Readonly<Record<string, string>>) => Promise<T>,
  ): Promise<Result<{ readonly response: T; readonly echoed: boolean }, HeaderSecretError>>;
}
