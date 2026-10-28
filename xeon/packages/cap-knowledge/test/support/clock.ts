import type { Clock } from "@xeon/contracts";
import type { IdByPrefix, IdFactory, IdPrefix, LocalIdFactory } from "@xeon/contracts/conversation";

// 시험용 시계와 ID 발급기(eng.testing.guide TS-03). F에는 ./testing이 없어 각 패키지 test/ 안에 둔다.

export interface ManualClock extends Clock {
  advance(ms: number): void;
  set(at: number): void;
}

const START = 1_767_571_200_000;

export function manualClock(start: number = START): ManualClock {
  let current = start;
  return {
    now: (): number => current,
    advance(ms: number): void {
      current += ms;
    },
    set(at: number): void {
      current = at;
    },
  };
}

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

/** 시각 10자 + 번호 16자의 유효한 ULID. 저장소 시험 인스턴스용 */
export function fixedIdFactory(clock: Pick<Clock, "now">): IdFactory {
  let counter = 0;
  return {
    next<P extends IdPrefix>(prefix: P): IdByPrefix[P] {
      counter += 1;
      const ulid = `${encode(clock.now(), 10)}${encode(0, 8)}${encode(counter, 8)}`;
      // oxlint-disable-next-line typescript/consistent-type-assertions, typescript/no-unsafe-type-assertion -- 허용 목록 A2 브랜드 생성: 테스트 대역 fixedIdFactory (eng.typescript.guide TY-06)
      return `${prefix}_${ulid}` as IdByPrefix[P];
    },
  };
}

/** `knl_<ULID>`처럼 호출 순서대로 번호가 붙는 지역 ID */
export function fixedLocalIds(): LocalIdFactory {
  let counter = 0;
  return {
    next(prefix) {
      counter += 1;
      return `${prefix}_${encode(1_000_000, 18)}${encode(counter, 8)}`;
    },
  };
}
