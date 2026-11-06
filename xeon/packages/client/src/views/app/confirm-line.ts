import { assertNever } from "@fresnel/contracts";
import { t } from "../../i18n/index.ts";
import type { ConfirmRequest } from "./bridge-host.ts";
import { secretKeyPartsOf, stripUnsafeText } from "./policy.ts";

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

/** 라벨은 확장이 쓴 글이라 제어·방향 제어·보이지 않는 글자를 지운다. 라벨 옆에 실제로 실행되는 동사를 함께 보인다. 지우고 남은 라벨이 없으면 동사만 보인다 */
function shownAction(request: ConfirmRequest): string {
  const label = request.label === undefined ? "" : stripUnsafeText(request.label, false).trim();
  return label === "" ? request.action : `${label} (${request.action})`;
}

/** 확인 줄 문장. 종류마다 문장이 다르다. 매니페스트 라벨이 있으면 라벨과 실제 동사를 함께 보이고, 외부 링크는 정규화한 주소를 보인다 */
export function confirmLineText(request: ConfirmRequest): string {
  const extension = request.extension;
  switch (request.kind) {
    case "external":
      // 확장 없이 대화 화면의 출처 칩이 연 것이면 확장 이름이 없다
      if (extension === "") {
        return request.punycodeHost === undefined
          ? t("client.view.confirm.externalChat", { url: request.action })
          : t("client.view.confirm.externalChatPunycode", {
              url: request.action,
              host: request.punycodeHost,
            });
      }
      return request.punycodeHost === undefined
        ? t("client.view.confirm.external", { extension, url: request.action })
        : t("client.view.confirm.externalPunycode", {
            extension,
            url: request.action,
            host: request.punycodeHost,
          });
    case "secret": {
      // 내부 이름(`ext--<확장>--<꼬리>`) 대신 "확장의 'key' 키"로 보인다. 모양이 다르면 이름을 그대로 보인다
      const parts = secretKeyPartsOf(request.action);
      const name =
        parts === null
          ? request.action
          : t("client.view.confirm.secretKey", { plugin: parts.plugin, key: parts.key });
      return t("client.view.confirm.secret", { extension, name });
    }
    case "approval":
      return t("client.view.confirm.approval", { extension, action: shownAction(request) });
    case "call":
    case "command":
      return t("client.view.confirm.line", { extension, action: shownAction(request) });
    default:
      return assertNever(request.kind, "ConfirmKind");
  }
}

export function confirmButtons(): readonly ConfirmButton[] {
  // 확인 줄은 끌 수 없고 호출마다 뜬다. "이 화면에서 묻지 않기" 같은 단축은 없다(2026-11-04 사용자, B2 1안).
  // 표준 승인 카드(`approval: true`)는 이 줄과 따로 뜨며 역시 끌 수 없다.
  return [
    { answer: "allow", label: t("client.view.confirm.allow"), defaultFocus: false },
    { answer: "deny", label: t("client.view.confirm.deny"), defaultFocus: true },
  ];
}
