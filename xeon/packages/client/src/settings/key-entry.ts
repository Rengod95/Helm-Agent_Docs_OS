import { assertNever, type Result } from "@fresnel/contracts";
import type { SecretName } from "@fresnel/contracts/capabilities";
import type { FailureKind } from "@fresnel/contracts/services";
import { t, type MessageId } from "../i18n/index.ts";

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
  /** OS 키 저장소(키체인 등)에 키를 만들거나 읽지 못했다(종류 코드 `key_store`). 파일 보관으로 몰래 넘어가지 않는다: 이유와 다시 시도만 보인다 */
  | { readonly kind: "keystore" }
  /**
   * 사이드카의 `fresnel secret`이 0이 아닌 코드로 끝났다. `code`는 출력의 `fresnel-code` 줄이고(모르거나 없으면 `unknown`),
   * `detail`은 그 줄을 뺀 출력의 앞부분이다(값이 있으면 비어 있다). 원인은 문장이 아니라 `code`로 정한다
   */
  | {
      readonly kind: "rejected";
      readonly exitCode: number | null;
      readonly code: FailureKind;
      readonly detail: string;
    }
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
  /** 키체인 실패(`keystore`)나 시간 초과(`timeout`, 키체인 창이 응답을 기다리는 경우)라서 화면이 "다시 시도"와 "도움말 열기"를 함께 보인다 */
  | {
      readonly kind: "failed";
      /** 사람이 할 일을 한 문장으로. 종료 코드 같은 기술 문구는 넣지 않는다 */
      readonly text: string;
      readonly keystore: boolean;
      /** 실패의 종류 코드. 키체인 실패는 `key_store`다. 시간 초과나 요청 실패처럼 코드가 없으면 생략한다. 화면과 제공자 카드가 쓴다 */
      readonly code?: FailureKind;
      /** 고치는 법 한 문장. 알려진 원인이면 있다. 화면은 원인 문장 바로 밑에 보인다. 키체인, 시간 초과, 모르는 원인은 원인 문장에 고치는 법이 들어 있어 없다 */
      readonly fix?: string;
      /** 기술 문구. 맞은 원인의 해결 문장이 있으면 먼저 오고, 종료 코드 줄이 줄바꿈으로 이어진다. 화면은 "자세히" 뒤에 둔다. 없으면 생략한다 */
      readonly detail?: string;
    };

const ENCODER = new TextEncoder();

/** CLI 실패 문장의 머리말(apps/cli/src/errors.ts renderFailure). 모르는 원인의 "자세히" 첫 줄에서 뗀다 */
const FAILURE_HEAD = "fresnel: ";

/** 종류 코드의 원인 문장과 해결 문장 id */
interface ReasonIds {
  readonly text: MessageId;
  readonly fix: MessageId;
}

/**
 * 종류 코드마다 원인 문장과 해결 문장의 카탈로그 id. 카탈로그 id는 점으로 나눈 camelCase만 쓰므로(MESSAGE_KEY_PATTERN)
 * 코드의 밑줄은 camelCase로 바꾼다. `unknown`은 일반 문장(`client.settings.key.rejected`)만 쓰므로 여기 없다.
 */
const REASON_IDS: Readonly<Record<Exclude<FailureKind, "unknown">, ReasonIds>> = {
  key_store: {
    text: "client.settings.key.reason.keyStore.text",
    fix: "client.settings.key.reason.keyStore.fix",
  },
  key_missing: {
    text: "client.settings.key.reason.keyMissing.text",
    fix: "client.settings.key.reason.keyMissing.fix",
  },
  key_file: {
    text: "client.settings.key.reason.keyFile.text",
    fix: "client.settings.key.reason.keyFile.fix",
  },
  key_fallback_unconfirmed: {
    text: "client.settings.key.reason.keyFallbackUnconfirmed.text",
    fix: "client.settings.key.reason.keyFallbackUnconfirmed.fix",
  },
  service_local_only: {
    text: "client.settings.key.reason.serviceLocalOnly.text",
    fix: "client.settings.key.reason.serviceLocalOnly.fix",
  },
  already_exists: {
    text: "client.settings.key.reason.alreadyExists.text",
    fix: "client.settings.key.reason.alreadyExists.fix",
  },
  not_found: {
    text: "client.settings.key.reason.notFound.text",
    fix: "client.settings.key.reason.notFound.fix",
  },
  value_too_short: {
    text: "client.settings.key.reason.valueTooShort.text",
    fix: "client.settings.key.reason.valueTooShort.fix",
  },
  value_empty: {
    text: "client.settings.key.reason.valueEmpty.text",
    fix: "client.settings.key.reason.valueEmpty.fix",
  },
  cancelled: {
    text: "client.settings.key.reason.cancelled.text",
    fix: "client.settings.key.reason.cancelled.fix",
  },
  sops_missing: {
    text: "client.settings.key.reason.sopsMissing.text",
    fix: "client.settings.key.reason.sopsMissing.fix",
  },
  sops_version: {
    text: "client.settings.key.reason.sopsVersion.text",
    fix: "client.settings.key.reason.sopsVersion.fix",
  },
  age_missing: {
    text: "client.settings.key.reason.ageMissing.text",
    fix: "client.settings.key.reason.ageMissing.fix",
  },
  provider_unavailable: {
    text: "client.settings.key.reason.providerUnavailable.text",
    fix: "client.settings.key.reason.providerUnavailable.fix",
  },
  decrypt_failed: {
    text: "client.settings.key.reason.decryptFailed.text",
    fix: "client.settings.key.reason.decryptFailed.fix",
  },
  read_only_provider: {
    text: "client.settings.key.reason.readOnlyProvider.text",
    fix: "client.settings.key.reason.readOnlyProvider.fix",
  },
  write_failed: {
    text: "client.settings.key.reason.writeFailed.text",
    fix: "client.settings.key.reason.writeFailed.fix",
  },
  store_busy: {
    text: "client.settings.key.reason.storeBusy.text",
    fix: "client.settings.key.reason.storeBusy.fix",
  },
  service_unreachable: {
    text: "client.settings.key.reason.serviceUnreachable.text",
    fix: "client.settings.key.reason.serviceUnreachable.fix",
  },
};

/** 거절 `detail`의 첫 줄에서 머리말을 뗀 글. 줄이 없으면 빈 글이다 */
function firstLineOf(detail: string): string {
  const line = (detail.split("\n")[0] ?? "").trim();
  return line.startsWith(FAILURE_HEAD) ? line.slice(FAILURE_HEAD.length) : line;
}

/** 실패의 종류 코드. 키체인 실패는 `key_store`다. 시간 초과와 요청 실패는 코드가 없다 */
function codeOf(error: KeyRegisterError): FailureKind | undefined {
  if (error.kind === "keystore") return "key_store";
  if (error.kind === "rejected") return error.code;
  return undefined;
}

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
    case "keystore":
      return t("client.settings.key.keystore");
    case "rejected":
      // 원인은 종류 코드가 정한다. 모르는 코드는 일반 문장이고, 출력의 문장은 맞춰 보지 않는다(터미널 안내가 섞여 있을 수 있다)
      return error.code === "unknown"
        ? t("client.settings.key.rejected")
        : t(REASON_IDS[error.code].text);
    case "failed":
      return t("client.settings.key.failed");
    default:
      return assertNever(error, "KeyRegisterError");
  }
}

/** 원인 문장 밑에 바로 보일 해결 문장. 알려진 종류 코드만 있다. 키체인, 시간 초과, 모르는 원인은 `null`이다 */
function keyErrorFixOf(error: KeyRegisterError): string | null {
  if (error.kind !== "rejected" || error.code === "unknown") return null;
  return t(REASON_IDS[error.code].fix);
}

/**
 * "자세히" 뒤에 둘 기술 문구. 맞은 원인의 해결 문장이 먼저 오고, 모르는 원인이면 사이드카 출력의 첫 줄이 온다.
 * 종료 코드가 있으면 그 줄이 줄바꿈으로 이어진다. 둘 다 없으면 `null`이다
 */
export function keyErrorDetail(error: KeyRegisterError): string | null {
  if (error.kind !== "rejected") return null;
  const lines: string[] = [];
  if (error.code === "unknown") {
    const first = firstLineOf(error.detail);
    if (first !== "") lines.push(first);
  } else {
    lines.push(t(REASON_IDS[error.code].fix));
  }
  if (error.exitCode !== null) {
    lines.push(t("client.settings.key.detailExitCode", { exitCode: error.exitCode }));
  }
  return lines.length === 0 ? null : lines.join("\n");
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
    const detail = keyErrorDetail(result.error);
    const code = codeOf(result.error);
    const fix = keyErrorFixOf(result.error);
    return {
      kind: "failed",
      text: keyErrorText(result.error),
      keystore: result.error.kind === "keystore" || result.error.kind === "timeout",
      ...(code === undefined ? {} : { code }),
      ...(fix === null ? {} : { fix }),
      ...(detail === null ? {} : { detail }),
    };
  } finally {
    bytes.fill(0);
  }
}
