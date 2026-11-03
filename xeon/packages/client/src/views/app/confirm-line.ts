import { t } from "../../i18n/index.ts";
import type { ConfirmRequest } from "./bridge-host.ts";

// 프레임 `call` 확인 줄의 글(ADR-0021 §3.4). 확장 이름과 동작 이름은 매니페스트에서 온 값이고 프레임이 정한 글은 없다.
// 줄은 셸 층에 그리고 프레임 위에 겹치지 않는다. 버튼 글은 `confirmButtons`다.

export function confirmLineText(request: ConfirmRequest): string {
  return t("client.view.confirm.line", { extension: request.extension, action: request.action });
}

export function confirmButtons(): readonly {
  readonly answer: "allow" | "allow_always" | "deny";
  readonly label: string;
}[] {
  // 표준 승인 카드가 따로 뜨는 메서드의 카드는 끌 수 없다. 이 줄만 끄는 선택은 모든 호출에 준다(§3.4 [제안])
  return [
    { answer: "allow", label: t("client.view.confirm.allow") },
    { answer: "allow_always", label: t("client.view.confirm.allowAlways") },
    { answer: "deny", label: t("client.view.confirm.deny") },
  ];
}
