// 구성 탭 캔버스의 글 고르기. 모델의 값을 메시지 키로 바꾸고(글은 카탈로그에만 있다), 검사 문장은 앱이 아는 것만 한국어로 보인다.
import { t, type MessageId } from "@fresnel/client/i18n";
import type { ProductText } from "@fresnel/client/workbench";
import type { WireManifestIssue } from "@fresnel/contracts/wire";

/** 블록이 내는 것의 종류 글: 기록, 입력 큐, 상태 문서 */
export const PRODUCT_TEXT: Readonly<Record<ProductText, MessageId>> = {
  record: "desktop.craft.composition.product.record",
  post: "desktop.craft.composition.product.post",
  state: "desktop.craft.composition.product.state",
};

const ISSUE_TEXT: Readonly<Record<string, MessageId>> = {
  "AU-012": "desktop.craft.composition.issue.au012",
};

/** 블록의 검사 문장. 앱이 아는 코드는 카탈로그 문장으로, 모르는 것은 엔진이 준 원문 그대로 보인다 */
export function issueTextOf(issue: Pick<WireManifestIssue, "code" | "message">): string {
  const key = ISSUE_TEXT[issue.code];
  return key === undefined ? issue.message : t(key);
}
