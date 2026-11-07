import { assertNever, type Result } from "@fresnel/contracts";
import type { SecretName } from "@fresnel/contracts/capabilities";
import { catalogOf, LOCALES, t, type MessageId } from "../i18n/index.ts";

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
  /** OS 키 저장소(키체인 등)에 키를 만들거나 읽지 못했다. 파일 보관으로 몰래 넘어가지 않는다: 이유와 다시 시도만 보인다 */
  | { readonly kind: "keystore" }
  /** 사이드카의 `fresnel secret`이 0이 아닌 코드로 끝났다. `detail`은 그 출력의 앞부분이다(값이 있으면 비어 있다) */
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
  /** 키체인 실패(`keystore`)나 시간 초과(`timeout`, 키체인 창이 응답을 기다리는 경우)라서 화면이 "다시 시도"와 "도움말 열기"를 함께 보인다 */
  | {
      readonly kind: "failed";
      /** 사람이 할 일을 한 문장으로. 종료 코드 같은 기술 문구는 넣지 않는다 */
      readonly text: string;
      readonly keystore: boolean;
      /** 기술 문구. 맞은 원인의 해결 문장이 있으면 먼저 오고, 종료 코드 줄이 줄바꿈으로 이어진다. 화면은 "자세히" 뒤에 둔다. 없으면 생략한다 */
      readonly detail?: string;
    };

const ENCODER = new TextEncoder();

/** CLI 실패 문장의 머리말(apps/cli/src/errors.ts renderFailure). 거절 `detail`의 첫 줄에서 뗀다 */
const FAILURE_HEAD = "fresnel: ";

/** 카탈로그 문장의 자리 값(`{이름}`마다 하나) */
type RejectionParams = Readonly<Record<string, string>>;

/** 맞춰 볼 카탈로그 문장 하나. 해결 문장은 고정이거나(id), 원인(`reason`)을 보고 고른다(함수). 고칠 곳이 정해지지 않으면 `null`이다 */
interface RejectionTemplate {
  readonly message: MessageId;
  readonly fix: MessageId | ((params: RejectionParams) => MessageId) | null;
}

/** 거절 `detail`이 카탈로그 문장과 맞았을 때의 결과. 두 문장 모두 화면 로케일이다 */
interface Rejection {
  /** 사람이 할 일을 한 문장으로 */
  readonly text: string;
  /** 해결 문장. 고칠 곳이 정해지지 않은 원인이면 `null`이다 */
  readonly fix: string | null;
}

/** 공급자를 쓸 수 없을 때의 해결 문장. 버전이 낮거나 등록이 없으면 그 문장을, 그 밖(바이너리 없음 포함)은 기본 문장을 쓴다 */
function providerFixOf(params: RejectionParams): MessageId {
  if (params["reason"] === "version_too_old") {
    return "cli.errors.secret.providerUnavailable.versionTooOld.fix";
  }
  if (params["reason"] === "not_registered") {
    return "cli.errors.secret.providerUnavailable.notRegistered.fix";
  }
  return "cli.errors.secret.providerUnavailable.fix";
}

/**
 * 맞춰 볼 순서. 자리가 있는 문장(`WithReason`, `WithCode`)을 같은 이름의 평범한 문장보다 먼저 둔다.
 * 해결 문장은 `cli.errors.secret.*`의 `.fix`다(CLI가 같은 원인에 붙이는 문장).
 */
const REJECTION_TEMPLATES: readonly RejectionTemplate[] = [
  { message: "cli.errors.secret.providerUnavailable.messageWithReason", fix: providerFixOf },
  { message: "cli.errors.secret.providerUnavailable.message", fix: providerFixOf },
  { message: "cli.errors.secret.keyStore.messageWithCode", fix: "cli.errors.secret.keyStore.fix" },
  { message: "cli.errors.secret.keyStore.message", fix: "cli.errors.secret.keyStore.fix" },
  { message: "cli.errors.secret.keyFile.messageWithCode", fix: "cli.errors.secret.keyFile.fix" },
  { message: "cli.errors.secret.keyFile.message", fix: "cli.errors.secret.keyFile.fix" },
  { message: "cli.errors.secret.sopsFile.messageWithCode", fix: "cli.errors.secret.sopsFile.fix" },
  { message: "cli.errors.secret.sopsFile.message", fix: "cli.errors.secret.sopsFile.fix" },
  // 쓰기 실패에는 이 문장 전용 해결 문장이 없다. 종료 코드만 "자세히"에 남는다
  { message: "cli.errors.secret.writeFailed.message", fix: null },
  {
    message: "cli.errors.secret.keyUnavailable.fileAccessDenied.message",
    fix: "cli.errors.secret.keyUnavailable.fileAccessDenied.fix",
  },
  {
    message: "cli.errors.secret.keyUnavailable.itemMissing.message",
    fix: "cli.errors.secret.keyUnavailable.itemMissing.fix",
  },
  {
    message: "cli.errors.secret.keyUnavailable.message",
    fix: "cli.errors.secret.keyUnavailable.fix",
  },
  {
    message: "cli.errors.secret.readOnlyProvider.message",
    fix: "cli.errors.secret.readOnlyProvider.fix",
  },
  {
    message: "cli.errors.secret.decryptFailed.message",
    fix: "cli.errors.secret.decryptFailed.fix",
  },
];

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

/**
 * 템플릿의 `{이름}` 자리에 줄의 글을 맞춘다. 맞으면 자리 이름마다 받은 글을, 아니면 `null`을 돌려준다.
 * 템플릿에는 단순 자리만 있다(복수형과 선택형은 이 문장들에 없다). apps/desktop/src/app/restore.ts의 같은 함수와 같다.
 */
function paramsOf(template: string, line: string): RejectionParams | null {
  // 괄호가 있는 split은 홀수 자리에 자리 이름을 넣는다
  const pieces = template.split(/\{(\w+)\}/u);
  const names: string[] = [];
  let pattern = "^";
  for (const [index, piece] of pieces.entries()) {
    if (index % 2 === 1) {
      names.push(piece);
      pattern += "(.*?)";
    } else {
      pattern += escapeRegExp(piece);
    }
  }
  const matched = new RegExp(`${pattern}$`, "u").exec(line);
  if (matched === null) return null;
  const params: Record<string, string> = {};
  for (const [index, name] of names.entries()) {
    params[name] = matched[index + 1] ?? "";
  }
  return params;
}

/** 거절 `detail`의 첫 줄에서 머리말을 뗀 글. 줄이 없으면 빈 글이다 */
function firstLineOf(detail: string): string {
  const line = (detail.split("\n")[0] ?? "").trim();
  return line.startsWith(FAILURE_HEAD) ? line.slice(FAILURE_HEAD.length) : line;
}

/**
 * 거절 `detail`의 첫 줄이 CLI 실패 문장 가운데 하나와 맞으면 그 문장을 화면 로케일로 다시 만든다. 맞는 문장이 없으면 `null`이다.
 * 사이드카는 CLI 로케일로 쓰므로 en과 ko 문장을 모두 맞춘다. 줄 안의 값(공급자 이름, 원인 코드)은 그대로 쓴다.
 */
function rejectionOf(detail: string): Rejection | null {
  const line = firstLineOf(detail);
  for (const template of REJECTION_TEMPLATES) {
    for (const locale of LOCALES) {
      const source = catalogOf(locale)[template.message];
      if (source === undefined) continue;
      const params = paramsOf(source, line);
      if (params === null) continue;
      const fix = typeof template.fix === "function" ? template.fix(params) : template.fix;
      return { text: t(template.message, params), fix: fix === null ? null : t(fix) };
    }
  }
  return null;
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
      // 첫 줄이 CLI 실패 문장과 맞으면 그 문장을 보인다. 맞지 않는 출력은 원문을 보이지 않는다(터미널 안내가 섞여 있을 수 있다).
      // 해결 문장과 종료 코드는 `keyErrorDetail`이 "자세히"용으로 준다
      return rejectionOf(error.detail)?.text ?? t("client.settings.key.rejected");
    case "failed":
      return t("client.settings.key.failed");
    default:
      return assertNever(error, "KeyRegisterError");
  }
}

/**
 * "자세히" 뒤에 둘 기술 문구. 맞은 원인의 해결 문장이 먼저 오고, 종료 코드가 있으면 그 줄이 줄바꿈으로 이어진다.
 * 둘 다 없으면 `null`이다
 */
export function keyErrorDetail(error: KeyRegisterError): string | null {
  if (error.kind !== "rejected") return null;
  const lines: string[] = [];
  const fix = rejectionOf(error.detail)?.fix;
  if (typeof fix === "string") lines.push(fix);
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
    return {
      kind: "failed",
      text: keyErrorText(result.error),
      keystore: result.error.kind === "keystore" || result.error.kind === "timeout",
      ...(detail === null ? {} : { detail }),
    };
  } finally {
    bytes.fill(0);
  }
}
