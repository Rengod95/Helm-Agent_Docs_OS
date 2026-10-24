import { parse } from "@xeon/contracts";
import {
  EventIdSchema,
  ItemIdSchema,
  ThreadIdSchema,
  TurnIdSchema,
  type EventId,
  type ItemId,
  type ThreadId,
  type TurnId,
} from "@xeon/contracts/conversation";
import { SecretNameSchema, type SecretName } from "@xeon/contracts/capabilities";
import { StoreIdSchema, type StoreId } from "@xeon/contracts/wire";

// 시험용 ID. F의 ID 형식(접두 + ULID 26자, 첫 글자 0-7)을 지키는 결정적 값이다. 브랜드를 붙이는 단언은 F의 파서를 거친다:
// F 밖에서 `as`를 쓰지 않으려고 형식이 맞는 문자열을 parse로 들인다.

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** 0-7로 시작하는 26자 ULID 모양 문자열. n이 같으면 같다 */
function ulid(n: number): string {
  let rest = n;
  let digits = "";
  do {
    digits = `${CROCKFORD[rest % 32] ?? "0"}${digits}`;
    rest = Math.floor(rest / 32);
  } while (rest > 0);
  return `0${digits.padStart(25, "0")}`;
}

function must<T>(result: { readonly ok: true; readonly value: T } | { readonly ok: false }): T {
  if (!result.ok) throw new Error("test id does not match its schema");
  return result.value;
}

export function threadId(n: number): ThreadId {
  return must(parse(ThreadIdSchema, `thr_${ulid(n)}`));
}
export function turnId(n: number): TurnId {
  return must(parse(TurnIdSchema, `trn_${ulid(n)}`));
}
export function itemId(n: number): ItemId {
  return must(parse(ItemIdSchema, `itm_${ulid(n)}`));
}
export function eventId(n: number): EventId {
  return must(parse(EventIdSchema, `evt_${ulid(n)}`));
}
export function storeId(n: number): StoreId {
  return must(parse(StoreIdSchema, `sto_${ulid(n)}`));
}

export function secretName(text: string): SecretName {
  return must(parse(SecretNameSchema, text));
}
