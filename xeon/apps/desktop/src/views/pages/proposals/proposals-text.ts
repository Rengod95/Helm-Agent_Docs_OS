import { assertNever } from "@fresnel/contracts";
import type { MessageId } from "@fresnel/client/i18n";
import type { ProposalAction, ProposalScope, DecisionError } from "@fresnel/client/settings";
import type { SkillScope } from "@fresnel/contracts/capabilities";
import type { CommandError } from "../../commands.ts";
import type {
  KindFilter,
  SkillPeekFailure,
  SourceFilter,
  StatusFilter,
} from "./proposals-model.ts";

// 제안 화면의 문장 고르기. 문장은 메시지 id로 들고 있다가 그릴 때 `t()`로 만든다.
// 결정 결과의 문장(`DecisionOutcome`)과 출처·종류·상태 이름은 `@fresnel/client/settings`가 이미 만든 것을 그대로 쓴다.

export function statusFilterIdOf(status: StatusFilter): MessageId {
  switch (status) {
    case "pending":
      return "desktop.proposals.filter.status.pending";
    case "applied":
      return "desktop.proposals.filter.status.applied";
    case "all":
      return "desktop.proposals.filter.status.all";
    default:
      return assertNever(status, "StatusFilter");
  }
}

export function sourceFilterIdOf(source: SourceFilter): MessageId {
  switch (source) {
    case "all":
      return "desktop.proposals.filter.source.all";
    case "learning":
      return "client.settings.proposals.source.learning";
    case "knowledge":
      return "client.settings.proposals.source.knowledge";
    default:
      return assertNever(source, "SourceFilter");
  }
}

export function kindFilterIdOf(kind: KindFilter): MessageId {
  switch (kind) {
    case "all":
      return "desktop.proposals.filter.kind.all";
    case "skill":
      return "client.settings.proposals.kind.skill";
    case "memory":
      return "client.settings.proposals.kind.memory";
    case "feedback":
      return "client.settings.proposals.kind.feedback";
    case "script":
      return "client.settings.proposals.kind.script";
    default:
      return assertNever(kind, "KindFilter");
  }
}

export function actionLabelIdOf(action: ProposalAction): MessageId {
  switch (action) {
    case "approve":
      return "desktop.proposals.action.approve";
    case "edit":
      return "desktop.proposals.action.edit";
    case "reject":
      return "desktop.proposals.action.reject";
    case "revert":
      return "desktop.proposals.action.revert";
    default:
      return assertNever(action, "ProposalAction");
  }
}

/** 결정이 적용되었을 때의 알림. 승인만 하고 아직 적용하지 않았으면 따로 말한다 */
export function doneNoticeIdOf(action: ProposalAction, applied: boolean): MessageId {
  switch (action) {
    case "approve":
      return applied
        ? "desktop.proposals.done.approved"
        : "desktop.proposals.done.approvedNotApplied";
    case "edit":
      return "desktop.proposals.done.edited";
    case "reject":
      return "desktop.proposals.done.rejected";
    case "revert":
      return "desktop.proposals.done.reverted";
    default:
      return assertNever(action, "ProposalAction");
  }
}

export function scopeIdOf(scope: ProposalScope): MessageId {
  return scope === "user" ? "desktop.proposals.scope.user" : "desktop.proposals.scope.project";
}

/** 스킬의 출처(범위)의 문장. 사용자와 작업 폴더는 적용 범위와 같은 글을 쓴다 */
export function skillScopeIdOf(scope: SkillScope): MessageId {
  switch (scope) {
    case "user":
      return "desktop.proposals.scope.user";
    case "project":
      return "desktop.proposals.scope.project";
    case "extension":
      return "desktop.proposals.skill.scope.extension";
    case "path":
      return "desktop.proposals.skill.scope.path";
    default:
      return assertNever(scope, "SkillScope");
  }
}

/** 충돌 스킬 본문을 읽지 못했을 때의 문장 */
export function skillFailureIdOf(failure: SkillPeekFailure): MessageId {
  switch (failure) {
    case "notFound":
      return "desktop.proposals.skill.notFound";
    case "unsupported":
      return "desktop.proposals.skill.unsupported";
    case "offline":
      return "desktop.proposals.skill.offline";
    case "failed":
      return "desktop.proposals.skill.failed";
    default:
      return assertNever(failure, "SkillPeekFailure");
  }
}

/** 결정 params를 만들지 못한 이유의 문장 */
export function decisionErrorIdOf(error: DecisionError): MessageId {
  switch (error.kind) {
    case "empty_body":
      return "desktop.proposals.edit.empty";
    case "scope_not_applicable":
      return "desktop.proposals.failed.scopeNotApplicable";
    case "not_allowed":
      return "desktop.proposals.failed.notAllowed";
    default:
      return assertNever(error, "DecisionError");
  }
}

/** 연결이나 host 오류(`CommandError`)의 문장. 기대한 실패는 `DecisionOutcome`으로 따로 온다 */
export function commandErrorIdOf(error: CommandError): MessageId {
  switch (error.kind) {
    case "offline":
      return "desktop.offline.hint";
    case "unsupported":
      return "desktop.proposals.unsupported";
    case "switching":
      return "desktop.approvals.failure.switching";
    case "locked":
    case "rejected":
    case "failed":
      return "desktop.proposals.actionFailed";
    default:
      return assertNever(error, "CommandError");
  }
}
