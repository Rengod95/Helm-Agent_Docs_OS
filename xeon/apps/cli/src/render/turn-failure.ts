import { classifyTurnFailure, type TurnFailureKind } from "@fresnel/client";
import { t, type MessageId } from "@fresnel/client/i18n";

// 실패한 turn의 오류 문장을 print 모드의 이유 한 줄과 "해결:" 줄로 바꾼다. 판정은 client의 classifyTurnFailure가 하고
// 여기서는 문구만 고른다. 원문 JSON은 `--json` 출력에만 남긴다. 종류를 모르는 오류는 원문을 한 줄로 줄여 이유에 싣는다.

const MESSAGE: Readonly<Record<TurnFailureKind, MessageId>> = {
  auth: "cli.errors.chat.turnFailure.auth.message",
  permission_denied: "cli.errors.chat.turnFailure.permissionDenied.message",
  host_mismatch: "cli.errors.chat.turnFailure.hostMismatch.message",
  bad_request: "cli.errors.chat.turnFailure.badRequest.message",
  context_overflow: "cli.errors.chat.turnFailure.contextOverflow.message",
  model_not_found: "cli.errors.chat.turnFailure.modelNotFound.message",
  rate_limited: "cli.errors.chat.turnFailure.rateLimited.message",
  server: "cli.errors.chat.turnFailure.server.message",
  network: "cli.errors.chat.turnFailure.network.message",
  interrupted: "cli.errors.chat.turnFailure.interrupted.message",
  unknown: "cli.errors.chat.turnFailure.unknown.message",
};

const FIX: Readonly<Record<TurnFailureKind, MessageId>> = {
  auth: "cli.errors.chat.turnFailure.auth.fix",
  permission_denied: "cli.errors.chat.turnFailure.permissionDenied.fix",
  host_mismatch: "cli.errors.chat.turnFailure.hostMismatch.fix",
  bad_request: "cli.errors.chat.turnFailure.badRequest.fix",
  context_overflow: "cli.errors.chat.turnFailure.contextOverflow.fix",
  model_not_found: "cli.errors.chat.turnFailure.modelNotFound.fix",
  rate_limited: "cli.errors.chat.turnFailure.rateLimited.fix",
  server: "cli.errors.chat.turnFailure.server.fix",
  network: "cli.errors.chat.turnFailure.network.fix",
  interrupted: "cli.errors.chat.turnFailure.interrupted.fix",
  unknown: "cli.errors.chat.turnFailure.unknown.fix",
};

/** 서버가 대기 초를 알린 429의 해결 줄 */
const RATE_LIMITED_WAIT_FIX: MessageId = "cli.errors.chat.turnFailure.rateLimited.fixWait";

export interface TurnFailureText {
  readonly message: string;
  readonly fix: string;
}

/** 원문을 한 줄로 줄인다. 줄바꿈과 연속 빈칸을 한 칸으로 모으고 길면 자른다 */
function oneLineOf(text: string, max = 160): string {
  const flat = text.replaceAll(/\s+/g, " ").trim();
  return flat.length <= max ? flat : `${flat.slice(0, max)}…`;
}

/** 실패한 turn의 오류 문장(없으면 null)을 이유 한 줄과 해결 한 줄로 바꾼다 */
export function turnFailureTextOf(error: string | null): TurnFailureText {
  if (error === null || error.trim() === "") {
    return {
      message: t("cli.errors.chat.turnFailed.message"),
      fix: t("cli.errors.chat.turnFailure.noDetail.fix"),
    };
  }
  const failure = classifyTurnFailure(error);
  if (failure.kind === "unknown") {
    return { message: t(MESSAGE.unknown, { error: oneLineOf(error) }), fix: t(FIX.unknown) };
  }
  const seconds = failure.params?.["seconds"];
  const fix =
    failure.kind === "rate_limited" && seconds !== undefined
      ? t(RATE_LIMITED_WAIT_FIX, { seconds })
      : t(FIX[failure.kind]);
  return { message: t(MESSAGE[failure.kind]), fix };
}
