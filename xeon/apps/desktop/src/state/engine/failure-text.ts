import { t } from "@xeon/client/i18n";

/**
 * 턴이 실패했는데 host가 원인 문장을 주지 않았을 때 거울에 넣는 문장. reduce.ts가 `t`라는 이름의 지역 변수를 많이 쓰므로
 * 번역 함수는 이 모듈에서 부른다(no-shadow). 거울에 들어가는 순간의 로케일로 문장을 만든다.
 */
export function unknownFailureText(): string {
  return t("desktop.engine.turnFailureUnknown");
}
