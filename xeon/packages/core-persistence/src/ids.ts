import { Bug } from "@xeon/contracts";
import {
  isId,
  type EffectId,
  type EventId,
  type ThreadId,
  type TurnId,
} from "@xeon/contracts/conversation";

/** 저장소에서 읽은 문자열을 브랜드 ID로 좁힌다. 형식이 틀리면 저장된 데이터가 깨진 것이라 Bug다 */
export function toThreadId(value: string): ThreadId {
  if (!isId("thr", value)) throw new Bug(`store.row_invalid: bad thread id ${value}`);
  return value;
}

export function toTurnId(value: string): TurnId {
  if (!isId("trn", value)) throw new Bug(`store.row_invalid: bad turn id ${value}`);
  return value;
}

export function toEventId(value: string): EventId {
  if (!isId("evt", value)) throw new Bug(`store.row_invalid: bad event id ${value}`);
  return value;
}

export function toEffectId(value: string): EffectId {
  if (!isId("efx", value)) throw new Bug(`store.row_invalid: bad effect id ${value}`);
  return value;
}

/** 세션 임대 자원 이름(L0.store.spec §3.1 resource) */
export function sessionResource(threadId: ThreadId): string {
  return `session:${threadId}`;
}
