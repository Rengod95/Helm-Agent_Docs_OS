import { parse } from "../base/index.ts";
import { applyLeafMasks, type LeafMask } from "../conversation/index.ts";
import { InputQueuedPayloadSchema, type InputQueuedPayload } from "./catalog/input.ts";

// L0.secrets.spec §3.5.1, F.wire-settings.spec §3.4.5a. 대기 입력 칩의 화면 가림.
// 호스트가 `input.queued` payload의 `/item` 아래 문자열 잎(글 파트)에 구한 구간을 같은 문자열에 적용한다. 대화 기록(`maskItemRecord`)과 같은 규칙이다.
// 포인터는 payload 기준이고, 호스트가 정하고 화면은 적용만 한다. 적용 뒤 모양이 맞지 않으면 null이다(호출자는 읽을 수 없는 사실로 둔다).

/** `input.queued` payload에 잎 표식을 적용한 복사본을 돌려준다. 표식이 없으면 그대로다. 입력은 바뀌지 않는다 */
export function maskQueuedInput(
  payload: InputQueuedPayload,
  leaves: readonly LeafMask[] | undefined,
): InputQueuedPayload | null {
  if (leaves === undefined || leaves.length === 0) return payload;
  const masked = applyLeafMasks(payload, leaves);
  if (!masked.ok) return null;
  const checked = parse(InputQueuedPayloadSchema, masked.value);
  return checked.ok ? checked.value : null;
}
