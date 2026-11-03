import type { JsonValue } from "@fresnel/contracts/conversation";

// 명령 결과 시트(O-03)의 순수 모델. `command.run`의 `done { message, result }`를 화면과 복사 글로 바꾼다.
// 결과 JSON은 기본으로 접혀 있다. 복사 글은 사람이 읽는 글(`message`)을 앞에, 결과 JSON을 뒤에 둔다.

/** 결과를 보기 좋은 JSON 글로 쓴다. 들여쓰기 두 칸 */
export function resultJsonOf(result: JsonValue): string {
  return JSON.stringify(result, null, 2);
}

/** 결과가 있는가. 값이 `null`이면 JSON 접기를 보이지 않는다 */
export function hasResultOf(result: JsonValue): boolean {
  return result !== null;
}

/** 복사 글. 메시지가 없으면 JSON만, 결과가 `null`이고 메시지도 없으면 빈 글이다 */
export function copyTextOf(output: {
  readonly message: string | null;
  readonly result: JsonValue;
}): string {
  const json = hasResultOf(output.result) ? resultJsonOf(output.result) : "";
  if (output.message === null || output.message === "") return json;
  if (json === "") return output.message;
  return `${output.message}\n\n${json}`;
}
