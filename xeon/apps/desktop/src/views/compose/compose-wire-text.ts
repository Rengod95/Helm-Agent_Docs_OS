import { t, type MessageId } from "@fresnel/client/i18n";
import type { WireManifestIssue } from "@fresnel/contracts/wire";

// 엔진이 영어로 만들어 주는 종류 카탈로그 제목과 검사 문장 중 앱이 아는 것은 한국어 카탈로그 문장으로 바꿔 보인다.
// 종류는 id로, 검사 문장은 code로 고르고 영어 원문은 비교하지 않는다. 모르는 것은 원문 그대로다.

const KIND_TITLE: Readonly<Record<string, MessageId>> = {
  "plugin-group": "desktop.craft.orbit.kind.group",
  "single-plugin": "desktop.craft.orbit.kind.single",
};

/** 새 그룹 시작점 카드의 제목 */
export function kindTitleOf(id: string, title: string): string {
  const key = KIND_TITLE[id];
  return key === undefined ? title : t(key);
}

const ISSUE_TEXT: Readonly<Record<string, MessageId>> = {
  "AU-012": "desktop.compose.issue.au012",
};

/** 뼈대·검사 문제의 문장 */
export function issueTextOf(issue: Pick<WireManifestIssue, "code" | "message">): string {
  const key = ISSUE_TEXT[issue.code];
  return key === undefined ? issue.message : t(key);
}
