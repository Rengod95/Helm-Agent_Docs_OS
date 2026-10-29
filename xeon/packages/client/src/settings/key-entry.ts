import { assertNever, type Result } from "@xeon/contracts";
import type { SecretName } from "@xeon/contracts/capabilities";
import { t } from "../i18n/index.ts";

// 모델 키 값 입력(L4.desktop.spec §4.14.1). 값은 입력란을 떠나는 순간 `take()`가 입력란을 비우고, 그 뒤로는 바이트 배열
// 하나로만 존재한다. React 상태, zustand 거울, 로그, 반환 값에는 들어가지 않는다. 바이트 배열은 보낸 뒤 0으로 덮는다.
// 약점: 입력란을 읽는 순간 JS 문자열이 하나 생긴다. 문자열은 지울 수 없어 가비지 수집이 거둘 때까지 WebView 힙에 남는다.

/** 값을 받는 쪽(셸)이 돌려주는 실패. 값은 들어 있지 않다 */
export type KeyRegisterError =
  /** 이 연결에는 셸이 값을 받는 길이 없다(서비스 연결, 사이드카 바이너리 없음). 터미널 안내로 돌아간다 */
  | { readonly kind: "unavailable" }
  | { readonly kind: "empty" }
  | { readonly kind: "too-large" }
  | { readonly kind: "busy" }
  | { readonly kind: "timeout" }
  /** 사이드카의 `xeon secret`이 0이 아닌 코드로 끝났다. `detail`은 그 출력의 앞부분이다(값이 있으면 비어 있다) */
  | { readonly kind: "rejected"; readonly exitCode: number | null; readonly detail: string }
  | { readonly kind: "failed" };

export interface KeyRegistrar {
  registerKey(
    secretName: SecretName,
    action: "add" | "set",
    value: Uint8Array,
  ): Promise<Result<null, KeyRegisterError>>;
}

/** 값 입력란. `take()`는 지금 값을 돌려주고 입력란을 곧바로 비운다 */
export interface KeyField {
  take(): string;
}

export type KeyOutcome =
  | { readonly kind: "registered" }
  /** 입력란이 비어 있었다. 아무것도 보내지 않았다 */
  | { readonly kind: "empty" }
  /** 이 연결에서는 화면이 값을 받을 수 없다. 터미널 명령을 안내한다 */
  | { readonly kind: "terminal" }
  | { readonly kind: "failed"; readonly text: string };

const ENCODER = new TextEncoder();

export function keyErrorText(error: KeyRegisterError): string {
  switch (error.kind) {
    case "unavailable":
      return t("client.settings.key.unavailable");
    case "empty":
      return t("client.settings.key.empty");
    case "too-large":
      return t("client.settings.key.tooLarge");
    case "busy":
      return t("client.settings.key.busy");
    case "timeout":
      return t("client.settings.key.timeout");
    case "rejected":
      if (error.detail !== "")
        return t("client.settings.key.rejectedDetail", { detail: error.detail });
      return error.exitCode === null
        ? t("client.settings.key.rejectedNoCode")
        : t("client.settings.key.rejectedCode", { exitCode: error.exitCode });
    case "failed":
      return t("client.settings.key.failed");
    default:
      return assertNever(error, "KeyRegisterError");
  }
}

/**
 * 입력란에서 값을 꺼내 등록한다. `take()`는 첫 `await` 전에 호출되므로 입력란은 이 함수가 돌아오기 전에 이미 비어 있다.
 * 앞뒤 공백과 줄바꿈은 지운다(붙여넣기에 따라온다).
 */
export async function submitKey(
  registrar: KeyRegistrar,
  secretName: SecretName,
  action: "add" | "set",
  field: KeyField,
): Promise<KeyOutcome> {
  const typed = field.take().trim();
  if (typed === "") return { kind: "empty" };
  const bytes = ENCODER.encode(typed);
  try {
    const result = await registrar.registerKey(secretName, action, bytes);
    if (result.ok) return { kind: "registered" };
    if (result.error.kind === "unavailable") return { kind: "terminal" };
    return { kind: "failed", text: keyErrorText(result.error) };
  } finally {
    bytes.fill(0);
  }
}
