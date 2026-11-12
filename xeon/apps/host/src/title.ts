import { hasWordCharacter, userWrittenText } from "@fresnel/contracts/conversation";
import type { TurnStartInput } from "@fresnel/contracts/wire";

// 대화 제목의 자동 정하기(M2 마감 G2-12). 첫 입력에서 뽑는다. 제목을 만드는 모델 호출(자동 제목)은 M3다.
// F wire `thread.rename`의 제목 상한은 200자이고, 첫 입력에서 뽑는 길이는 80자다(F wire §3.3.1).

/** 첫 입력에서 뽑는 제목의 길이(유니코드 코드 포인트 수) */
export const TITLE_FROM_INPUT_MAX = 80;

/**
 * 입력에서 제목을 뽑는다: 공백(줄바꿈 포함)을 한 칸으로 줄이고 앞뒤를 자른 뒤 앞 80자다. 코드 포인트 단위로 자르므로 이모지 같은
 * 두 코드 유닛 문자를 반으로 가르지 않는다. 첨부 표식과 이미지 이름은 빼고 사람이 쓴 글만 본다(`userWrittenText`, DP-142).
 * 글이 없거나(첨부만 보냄) 글자·숫자가 하나도 없으면(`,`) undefined다. 순수 함수
 */
export function titleFromInput(input: TurnStartInput): string | undefined {
  const collapsed = userWrittenText(input).replaceAll(/\s+/gu, " ").trim();
  if (collapsed === "" || !hasWordCharacter(collapsed)) return undefined;
  return Array.from(collapsed).slice(0, TITLE_FROM_INPUT_MAX).join("").trimEnd();
}
