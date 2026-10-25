import type { TurnStartInput } from "@xeon/contracts/wire";

// 대화 제목의 자동 정하기(M2 마감 G2-12). 첫 입력에서 뽑는다. 제목을 만드는 모델 호출(자동 제목)은 M3다.
// F wire `thread.rename`의 제목 상한은 200자이고, 첫 입력에서 뽑는 길이는 80자다(F wire §3.3.1).

/** 첫 입력에서 뽑는 제목의 길이(유니코드 코드 포인트 수) */
export const TITLE_FROM_INPUT_MAX = 80;

/** 입력의 텍스트 블록을 이어 붙인다. 이미지 블록은 건너뛴다 */
function textOf(input: TurnStartInput): string {
  if (typeof input === "string") return input;
  return input.flatMap((block) => (block.type === "text" ? [block.text] : [])).join(" ");
}

/**
 * 입력에서 제목을 뽑는다: 공백(줄바꿈 포함)을 한 칸으로 줄이고 앞뒤를 자른 뒤 앞 80자다. 코드 포인트 단위로 자르므로 이모지 같은
 * 두 코드 유닛 문자를 반으로 가르지 않는다. 텍스트가 없으면(이미지만 보냄) undefined다. 순수 함수
 */
export function titleFromInput(input: TurnStartInput): string | undefined {
  const collapsed = textOf(input).replaceAll(/\s+/gu, " ").trim();
  if (collapsed === "") return undefined;
  return Array.from(collapsed).slice(0, TITLE_FROM_INPUT_MAX).join("").trimEnd();
}
