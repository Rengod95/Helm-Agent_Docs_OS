import type { MessageId } from "@fresnel/client/i18n";
import type { WebRecommendation } from "@fresnel/client";
import { assertNever } from "@fresnel/contracts";
import type { FirstRunModel, GroupRowId, StepId, StepState } from "./first-run-model.ts";

// 첫 실행 화면의 문장 고르기. 문장은 메시지 키로 들고 있다가 그릴 때 `t()`로 만든다(모듈을 읽을 때의 로케일에 묶이지 않도록).
// 오류 문장은 `settings.tsx`의 `errorText`를 그대로 쓴다(키 등록과 같은 오류 값).

const STEP_TITLE_ID: Readonly<Record<StepId, MessageId>> = {
  tools: "desktop.firstRun.step.tools",
  key: "desktop.firstRun.step.key",
  model: "desktop.firstRun.step.model",
  search: "desktop.firstRun.step.search",
  groups: "desktop.firstRun.step.groups",
};

export function stepTitleOf(id: StepId): MessageId {
  return STEP_TITLE_ID[id];
}

/**
 * 단계 오른쪽 끝의 요약 문장. 기본 모델이 끝났을 때는 모델 이름을 그대로 보이므로 이 함수가 아니라 화면이 그린다.
 * 점검 결과를 못 받은 단계는 "확인할 수 없음"이다.
 */
export function summaryOf(step: StepState, model: FirstRunModel): MessageId {
  if (step.unknown) return "desktop.firstRun.summary.unknown";
  switch (step.id) {
    case "tools":
      return step.done
        ? "desktop.firstRun.summary.toolsReady"
        : "desktop.firstRun.summary.toolsMissing";
    case "key":
      return step.done ? "desktop.firstRun.summary.keyDone" : "desktop.firstRun.summary.keyTodo";
    case "model":
      if (step.locked) return "desktop.firstRun.summary.modelLocked";
      return "desktop.firstRun.summary.modelTodo";
    case "search":
      if (model.searchState === "ready") return "desktop.firstRun.summary.searchReady";
      if (model.searchState === "dismissed") return "desktop.firstRun.summary.searchDismissed";
      return "desktop.firstRun.summary.searchPending";
    case "groups":
      return step.done ? "desktop.firstRun.summary.groupsOn" : "desktop.firstRun.summary.groupsOff";
    default:
      return assertNever(step.id, "StepId");
  }
}

/**
 * "대화 시작"이 꺼져 있을 때 왜인지 한 줄. 키가 먼저고 그다음 기본 모델이다. 시작할 수 있거나 점검 결과가 아직 없으면 null이다.
 * 외부 도구 단계는 시작 조건이 아니다(`readyToChat`)
 */
export function startBlockedOf(model: FirstRunModel | null): MessageId | null {
  if (model === null || model.readyToChat) return null;
  const done = (id: StepId): boolean => model.steps.some((step) => step.id === id && step.done);
  if (!done("key")) return "desktop.firstRun.chat.blockedKey";
  if (!done("model")) return "desktop.firstRun.chat.blockedModel";
  return null;
}

const GROUP_NAME_ID: Readonly<Record<GroupRowId, MessageId>> = {
  helm: "desktop.firstRun.group.helm.name",
  learning: "desktop.firstRun.group.learning.name",
  review: "desktop.firstRun.group.review.name",
};

const GROUP_WHAT_ID: Readonly<Record<GroupRowId, MessageId>> = {
  helm: "desktop.firstRun.group.helm.what",
  learning: "desktop.firstRun.group.learning.what",
  review: "desktop.firstRun.group.review.what",
};

export function groupNameOf(id: GroupRowId): MessageId {
  return GROUP_NAME_ID[id];
}

export function groupWhatOf(id: GroupRowId): MessageId {
  return GROUP_WHAT_ID[id];
}

const RECOMMEND_STATE_ID: Readonly<Record<WebRecommendation["state"], MessageId>> = {
  ready: "desktop.firstRun.search.state.ready",
  "needs-key": "desktop.firstRun.search.state.needsKey",
  "not-installed": "desktop.firstRun.search.state.notInstalled",
  unavailable: "desktop.firstRun.search.state.unavailable",
};

export function recommendStateOf(state: WebRecommendation["state"]): MessageId {
  return RECOMMEND_STATE_ID[state];
}
