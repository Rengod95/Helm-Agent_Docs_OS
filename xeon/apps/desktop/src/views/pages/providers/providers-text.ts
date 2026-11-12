import { t, type MessageId } from "@fresnel/client/i18n";

// 설정 "모델과 계정" 구역의 문장 고르기. 칸 검사에서 떨어진 칸의 이름을 문장 키로 고른다.

/** 입력 칸 이름. client `checkAccount`가 가리키는 칸이다 */
export type FieldName = "provider" | "accountId" | "credential" | "priority" | "reservePct";

const FIELD_ID: Readonly<Record<FieldName, MessageId>> = {
  provider: "desktop.providers.field.provider",
  accountId: "desktop.providers.field.accountId",
  credential: "desktop.providers.field.credential",
  priority: "desktop.providers.field.priority",
  reservePct: "desktop.providers.field.reservePct",
};

/** "{칸} 값이 맞지 않아요" */
export function invalidTextOf(field: FieldName): string {
  return t("desktop.providers.invalid", { field: t(FIELD_ID[field]) });
}
