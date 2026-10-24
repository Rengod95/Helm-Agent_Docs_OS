import { parseJson } from "@xeon/contracts";

// L4.cli.spec §4.8. `config set`, `--set`, `/set`의 값 해석. 최종 판정은 host의 settings.set이다(checkSettingWrite).

/** `raw`를 먼저 JSON으로 읽고, 읽을 수 없으면 문자열로 본다(F wire §4.11). 순수 함수 */
export function interpretRaw(raw: string): unknown {
  const parsed = parseJson(raw);
  return parsed.ok ? parsed.value : raw;
}

/** 값 한 줄 표시. 문자열은 따옴표를 붙여 JSON과 같게 보인다 */
export function showValue(value: unknown): string {
  // wire에서 온 값은 JSON이라 undefined가 없다. 방어로만 둔다
  return value === undefined ? "undefined" : JSON.stringify(value);
}
