import { t } from "../../i18n/index.ts";
import type { ConfirmRequest } from "./bridge-host.ts";

// 프레임 `call` 확인 줄의 글(ADR-0021 §3.4). 확장 이름과 동작 이름은 매니페스트에서 온 값이고 프레임이 정한 글은 없다.
// 줄은 셸 층에 그리고 프레임 위에 겹치지 않는다. 버튼 글은 `confirmButtons`다.

export function confirmLineText(request: ConfirmRequest): string {
  return t("client.view.confirm.line", { extension: request.extension, action: request.action });
}

export function confirmButtons(): readonly {
  readonly answer: "allow" | "deny";
  readonly label: string;
}[] {
  // 확인 줄은 끌 수 없고 호출마다 뜬다. "이 화면에서 묻지 않기" 같은 단축은 없다(2026-11-04 사용자, B2 1안).
  // 표준 승인 카드(`approval: true`)는 이 줄과 따로 뜨며 역시 끌 수 없다.
  return [
    { answer: "allow", label: t("client.view.confirm.allow") },
    { answer: "deny", label: t("client.view.confirm.deny") },
  ];
}
