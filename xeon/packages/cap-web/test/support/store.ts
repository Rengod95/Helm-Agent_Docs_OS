import type { Clock } from "@xeon/contracts";
import type { IdByPrefix, IdFactory, IdPrefix } from "@xeon/contracts/conversation";
import { openTestStore, type TestStore } from "@xeon/platform-store/testing";

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

function encode(value: number, length: number): string {
  let rest = value;
  let out = "";
  for (let i = 0; i < length; i += 1) {
    out = CROCKFORD.charAt(rest % 32) + out;
    rest = Math.floor(rest / 32);
  }
  return out;
}

/** 시각과 호출 번호로 유효한 ULID를 만드는 시험용 IdFactory */
function idsAt(clock: Clock): IdFactory {
  let counter = 0;
  return {
    next<P extends IdPrefix>(prefix: P): IdByPrefix[P] {
      counter += 1;
      const ulid = `${encode(clock.now(), 10)}${encode(7, 8)}${encode(counter, 8)}`;
      // oxlint-disable-next-line typescript/consistent-type-assertions, typescript/no-unsafe-type-assertion -- 허용 목록 A2 브랜드 생성: 시험용 IdFactory (eng.typescript.guide TY-06)
      return `${prefix}_${ulid}` as IdByPrefix[P];
    },
  };
}

const owned: TestStore[] = [];

/** 실제 SQLite 임시 파일 저장소(TS-07). afterEach(releaseStores)가 닫는다 */
export async function openWebStore(clock: Clock): Promise<TestStore> {
  const store = await openTestStore({ clock, ids: idsAt(clock) });
  owned.push(store);
  return store;
}

export async function releaseStores(): Promise<void> {
  const open = owned.splice(0);
  await Promise.all(open.map((store) => store[Symbol.asyncDispose]()));
}
