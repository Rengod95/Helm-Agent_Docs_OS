// 확장 지우기(B-04, `ext.remove`)의 순수 판단: 어떤 행을 지울 수 있나, 결과를 어떤 문장으로 알리나.
import { assertNever } from "@fresnel/contracts";
import type { MessageId } from "@fresnel/client/i18n";
import type { ExtListEntry, ExtRemoveResult } from "@fresnel/contracts/wire";

/**
 * 지울 수 있는 확장인가. `ext.remove`는 사용자 확장 위치의 설치본 폴더를 지우므로 `origin`이 `user`인 것만 지운다.
 * 내장, 관리자(`managed`), 작업 폴더(`project`) 확장은 앱이 지우지 않는다. `origin`이 없는 옛 호스트의 행은 지우기를 막는다
 */
export function removableOf(entry: Pick<ExtListEntry, "origin">): boolean {
  return entry.origin === "user";
}

/** 지운 결과 문장. 로더가 내리면 `now`, 켜기가 경계로 미뤄졌으면 `nextStepBoundary`, 로더가 없으면 `restart`다 */
export function removeDoneText(appliesAt: ExtRemoveResult["appliesAt"]): MessageId {
  switch (appliesAt) {
    case "now":
      return "desktop.workbench.remove.done.now";
    case "nextStepBoundary":
      return "desktop.workbench.remove.done.boundary";
    case "restart":
      return "desktop.workbench.remove.done.restart";
    default:
      return assertNever(appliesAt, "removeDoneText");
  }
}

/** 이미 없는 이름(`extension.notFound`, 3401)을 지우려 했나. 목록이 낡았다는 뜻이라 문장이 다르다 */
export const REMOVE_NOT_FOUND_CODE = 3401;
