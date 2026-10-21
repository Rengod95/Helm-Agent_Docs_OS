import { Type, type TUnsafe } from "typebox";
import type { Brand } from "../base/index.ts";

export type ThreadId = Brand<string, "ThreadId">; // thr_<ULID>
export type TurnId = Brand<string, "TurnId">; // trn_<ULID>
export type StepId = Brand<string, "StepId">; // stp_<ULID>
export type ItemId = Brand<string, "ItemId">; // itm_<ULID>
export type PartId = Brand<string, "PartId">; // prt_<ULID>
export type EventId = Brand<string, "EventId">; // evt_<ULID> (F.records.spec)
export type EffectId = Brand<string, "EffectId">; // efx_<ULID> (F.records.spec)
export type CheckpointId = Brand<string, "CheckpointId">; // ckp_<ULID> (F.records.spec)

export type IdPrefix = "thr" | "trn" | "stp" | "itm" | "prt" | "evt" | "efx" | "ckp";

export interface IdByPrefix {
  thr: ThreadId;
  trn: TurnId;
  stp: StepId;
  itm: ItemId;
  prt: PartId;
  evt: EventId;
  efx: EffectId;
  ckp: CheckpointId;
}

/** ULID 26자. 첫 글자는 48비트 시각 상한 때문에 0-7, Crockford base32 대문자. */
export const ULID_PATTERN: string = "[0-7][0-9A-HJKMNP-TV-Z]{25}";
/** 접두 3 + "_" + 26 */
export const ID_LENGTH: number = 30;

export function idPattern(prefix: IdPrefix): string {
  return `^${prefix}_${ULID_PATTERN}$`;
}

const ID_REGEXES: Readonly<Record<IdPrefix, RegExp>> = {
  thr: new RegExp(idPattern("thr")),
  trn: new RegExp(idPattern("trn")),
  stp: new RegExp(idPattern("stp")),
  itm: new RegExp(idPattern("itm")),
  prt: new RegExp(idPattern("prt")),
  evt: new RegExp(idPattern("evt")),
  efx: new RegExp(idPattern("efx")),
  ckp: new RegExp(idPattern("ckp")),
};

export function isId<P extends IdPrefix>(prefix: P, value: unknown): value is IdByPrefix[P] {
  return typeof value === "string" && ID_REGEXES[prefix].test(value);
}

function idSchema<B extends string>(prefix: IdPrefix): TUnsafe<B> {
  return Type.Unsafe<B>(
    Type.String({ pattern: idPattern(prefix), minLength: ID_LENGTH, maxLength: ID_LENGTH }),
  );
}

export const ThreadIdSchema: TUnsafe<ThreadId> = idSchema("thr");
export const TurnIdSchema: TUnsafe<TurnId> = idSchema("trn");
export const StepIdSchema: TUnsafe<StepId> = idSchema("stp");
export const ItemIdSchema: TUnsafe<ItemId> = idSchema("itm");
export const PartIdSchema: TUnsafe<PartId> = idSchema("prt");
export const EventIdSchema: TUnsafe<EventId> = idSchema("evt");
export const EffectIdSchema: TUnsafe<EffectId> = idSchema("efx");
export const CheckpointIdSchema: TUnsafe<CheckpointId> = idSchema("ckp");

/** 발급은 F 밖에서 한다. 구현은 L0(platform-os, 시계·난수)이 맡고 L1 이상은 주입받는다. */
export interface IdFactory {
  next<P extends IdPrefix>(prefix: P): IdByPrefix[P];
}
