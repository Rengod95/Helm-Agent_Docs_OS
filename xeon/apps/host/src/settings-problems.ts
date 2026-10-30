import { parseModelRef } from "@xeon/contracts/services";
import type { SettingProblem } from "@xeon/contracts/settings";

// L4.host-service.spec HS-80, F.wire-settings.spec §4.10 11. 값은 검사를 통과했어도 호스트만 아는 사실로 쓸 수 없을 때 `problem`을 싣는다.
// 이 파일은 조립 루트 밖의 순수 함수다. 설정 화면과 데스크톱 첫 실행 안내가 이 표시를 본다.

const MODEL_DEFAULT_KEY = "l1.models.default";

/**
 * 저장된 기본 모델 id가 지금 카탈로그(`modelIds`)에 없으면 `unknownModel` 문제를 돌려준다. 값이 문자열이 아니거나(null 포함)
 * 참조 형식이 틀리면 문제가 없다. 형식은 쓰기 검사가 판정한다. 추론 수준 접미는 떼고 비교한다(HS-78과 같다).
 */
export function settingProblemOf(
  key: string,
  value: unknown,
  modelIds: (provider: string) => readonly string[],
): SettingProblem | undefined {
  if (key !== MODEL_DEFAULT_KEY || typeof value !== "string") return undefined;
  const parsed = parseModelRef(value);
  if (!parsed.ok) return undefined;
  if (modelIds(parsed.value.provider).includes(parsed.value.modelId)) return undefined;
  return { kind: "unknownModel", args: { id: value } };
}
