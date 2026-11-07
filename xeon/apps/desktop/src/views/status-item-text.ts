import { tKey } from "@fresnel/client/i18n";
import type { StatusItemRecord } from "@fresnel/contracts/records";

// 상태줄 칸의 글. 엔진 내장 칸(`core.*`)은 메시지 키와 숫자 인자를 보내므로 현재 로케일로 푼다. 키가 없거나 모르는 키면
// 소유자가 보낸 `text`를 그대로 쓴다(그룹이 setItem으로 올린 칸, 키를 모르는 옛 엔진).

export function statusItemText(item: StatusItemRecord): string {
  if (item.textKey === undefined) return item.text;
  return tKey(item.textKey, item.text, item.textArgs ?? {});
}
