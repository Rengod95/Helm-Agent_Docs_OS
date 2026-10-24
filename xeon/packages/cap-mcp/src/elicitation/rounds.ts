import { sha256Hex } from "../hash.ts";

// L2.mcp.spec §4.6 5번, 6번. 라운드 상한과 requestId 규칙.

/** 승인 요청 키와 같은 상한(F `L2_APPROVAL_REQUEST_ID_MAX`) */
const REQUEST_ID_MAX = 64;

/**
 * 라운드 r의 요청 키는 `<기본 requestId>#r<r>`이다. 합친 길이가 64자를 넘으면 기본값 부분을 SHA-256 앞 32자 hex로
 * 줄인다. 같은 라운드를 다시 보낼 때는 같은 키를 쓴다(eng.transactions.design TX-05).
 */
export async function roundRequestId(baseRequestId: string, round: number): Promise<string> {
  const suffix = `#r${round}`;
  if (baseRequestId.length + suffix.length <= REQUEST_ID_MAX) return `${baseRequestId}${suffix}`;
  return `${(await sha256Hex(baseRequestId)).slice(0, 32)}${suffix}`;
}

/** `round`(이번에 보낼 라운드)가 상한을 넘었는가. 첫 라운드는 1이다 */
export function roundsExceeded(round: number, maxRounds: number): boolean {
  return round > maxRounds;
}
