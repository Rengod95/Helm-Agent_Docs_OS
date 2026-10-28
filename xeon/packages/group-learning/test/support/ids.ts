import type { ItemId, ThreadId, TurnId } from "@xeon/contracts/conversation";
import { fixedIdFactory } from "@xeon/ext-host/testing";

// 순수 함수 시험이 쓰는 고정 id. 브랜드 id는 발급기로만 만든다(eng.typescript.guide TY-09).
const ids = fixedIdFactory(0);

export const THREAD: ThreadId = ids.next("thr");
export const ITEM: ItemId = ids.next("itm");
export const TURN: TurnId = ids.next("trn");
