// 구성기 화면의 글 고르기. 모델의 값을 메시지 키로 바꾼다(글은 카탈로그에만 있다).
import type { MessageId } from "@fresnel/client/i18n";
import type { ProfileChoice, ProfileDraftProblem, ProductText } from "@fresnel/client/workbench";
import type { PhaseNodeKind } from "@fresnel/contracts/extensions";
import { assertNever } from "@fresnel/contracts";
import { WIRE_ERRORS } from "@fresnel/contracts/wire";
import type { CommandError } from "../commands.ts";

/** 화면 머리의 보기 넷. "새 그룹"은 보기가 아니라 머리의 동작이라 이 묶음에 없다 */
export type ComposeViewId = "group" | "flow" | "profile" | "code";
export const COMPOSE_VIEWS: readonly ComposeViewId[] = ["group", "flow", "profile", "code"];

export const VIEW_TEXT: Readonly<Record<ComposeViewId, MessageId>> = {
  group: "desktop.compose.view.group",
  flow: "desktop.compose.view.flow",
  profile: "desktop.compose.view.profile",
  code: "desktop.compose.view.code",
};

export const PRODUCT_TEXT: Readonly<Record<ProductText, MessageId>> = {
  record: "desktop.compose.product.record",
  post: "desktop.compose.product.post",
  state: "desktop.compose.product.state",
};

export const NODE_TEXT: Readonly<Record<PhaseNodeKind, MessageId>> = {
  phase: "desktop.compose.node.phase",
  turn: "desktop.compose.node.turn",
  spawn: "desktop.compose.node.spawn",
  gather: "desktop.compose.node.gather",
  capability: "desktop.compose.node.capability",
  human: "desktop.compose.node.human",
  record: "desktop.compose.node.record",
  end: "desktop.compose.node.end",
};

export const CHOICE_TEXT: Readonly<Record<ProfileChoice, MessageId>> = {
  on: "desktop.compose.profile.choice.on",
  off: "desktop.compose.profile.choice.off",
  keep: "desktop.compose.profile.choice.keep",
};

export const PROBLEM_TEXT: Readonly<Record<ProfileDraftProblem, MessageId>> = {
  id: "desktop.compose.profile.problem.id",
  title: "desktop.compose.profile.problem.name",
};

/** 프로필 저장·삭제·미리 보기 실패의 글 */
export function profileErrorText(error: CommandError): MessageId {
  switch (error.kind) {
    case "offline":
      return "desktop.compose.offline";
    case "unsupported":
      return "desktop.compose.error.unsupported";
    case "rejected":
      if (error.code === WIRE_ERRORS["profile.conflict"].code) {
        return "desktop.compose.profile.error.conflict";
      }
      if (error.code === WIRE_ERRORS["profile.notFound"].code) {
        return "desktop.inspect.profile.error.notFound";
      }
      return "desktop.compose.profile.error.failed";
    case "locked":
    case "failed":
    case "switching":
      return "desktop.compose.profile.error.failed";
    default:
      return assertNever(error, "CommandError");
  }
}
