// 자식 requestId 파생(L1.agents.spec §4.5, AG-6). 같은 소유 작업을 다시 실행하면 같은 값이 나와야 재개 때 자식이 중복 생성되지 않는다.
import { sha256Hex } from "./hash.ts";

/** 자식 requestId 길이 상한. 자식 turn.started.requestId(1~64자)가 되기 때문이다 */
const CHILD_REQUEST_ID_MAX = 64;

/**
 * 호출자가 준 requestId는 그대로 쓰고, 없으면 `<ownerRequestId>:spawn:<n>`을 쓴다. 64자를 넘으면
 * `spawn:` + sha256(원래 키) 앞 40자로 바꾼다 [제안]. 순수 함수
 */
export function childRequestId(raw: string): string {
  if (raw.length <= CHILD_REQUEST_ID_MAX) return raw;
  return `spawn:${sha256Hex(raw).slice(0, 40)}`;
}

export function derivedRequestId(ownerRequestId: string, n: number): string {
  return childRequestId(`${ownerRequestId}:spawn:${String(n)}`);
}

/**
 * 소유 작업(ownerRequestId)마다 0부터 생성 순번을 매긴다. 같은 작업이 다시 실행되면 같은 순서로 spawn을 부르므로
 * 같은 순번이 나온다. 프로세스 안에서만 센다
 */
export interface SpawnCounter {
  next(ownerRequestId: string): number;
}

export function createSpawnCounter(): SpawnCounter {
  const counts = new Map<string, number>();
  return {
    next(ownerRequestId): number {
      const n = counts.get(ownerRequestId) ?? 0;
      counts.set(ownerRequestId, n + 1);
      return n;
    },
  };
}
