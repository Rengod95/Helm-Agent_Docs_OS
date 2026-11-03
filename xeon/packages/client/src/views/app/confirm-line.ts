import { t } from "../../i18n/index.ts";
import type { ConfirmRequest } from "./bridge-host.ts";

// 프레임 `call` 확인 줄의 글과 규칙(ADR-0021 §3.4). 확장 이름, 동작 이름, 라벨은 매니페스트에서 온 값이고 프레임이 정한 글은 없다.
// 줄은 셸 층에 그리고 프레임 위에 겹치지 않는다. 화면 쪽이 지킬 계약: 줄이 나타난 뒤 `CONFIRM_CLICK_GUARD_MS` 동안 누름을 무시하고,
// 처음 초점은 `confirmButtons()`에서 `defaultFocus`가 참인 버튼(거부)에 둔다.

/** 줄이 나타난 뒤 이 시간 안의 누름은 무시한다(화면이 떠서 클릭을 가로채는 것을 막는다) */
export const CONFIRM_CLICK_GUARD_MS = 500;

export interface ConfirmButton {
  readonly answer: "allow" | "deny";
  readonly label: string;
  /** 줄이 열릴 때 초점을 받는다. 거부만 참이다 */
  readonly defaultFocus: boolean;
}

/** 배지 글. 프로젝트에서 온 확장은 "프로젝트" 배지를 따로 단다 */
export function confirmBadges(request: ConfirmRequest): readonly string[] {
  const badges = [t(`client.view.confirm.trust.${request.trust}`)];
  if (request.trust === "project") badges.push(t("client.view.confirm.projectBadge"));
  return badges;
}

/** 확인 줄 문장. 매니페스트 라벨이 있으면 동사 대신 라벨을 보인다 */
export function confirmLineText(request: ConfirmRequest): string {
  return t("client.view.confirm.line", {
    extension: request.extension,
    action: request.label ?? request.action,
  });
}

export function confirmButtons(): readonly ConfirmButton[] {
  // 확인 줄은 끌 수 없고 호출마다 뜬다. "이 화면에서 묻지 않기" 같은 단축은 없다(2026-11-04 사용자, B2 1안).
  // 표준 승인 카드(`approval: true`)는 이 줄과 따로 뜨며 역시 끌 수 없다.
  return [
    { answer: "allow", label: t("client.view.confirm.allow"), defaultFocus: false },
    { answer: "deny", label: t("client.view.confirm.deny"), defaultFocus: true },
  ];
}
