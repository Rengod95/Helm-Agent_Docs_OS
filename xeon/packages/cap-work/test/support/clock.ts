// 런타임 중립 테스트 대역(eng.testing.guide TS-03, review.decisions-2 U-03). F에 testing 서브패스를 두지 않는다.
import { Bug, type Clock, type Scheduler, type TimerHandle } from "@xeon/contracts";
import { isId, type IdFactory, type IdPrefix } from "@xeon/contracts/conversation";

export interface ManualClock extends Clock, Scheduler {
  now(): number;
  /** ms만큼 진행하며 그 사이 만기 타이머를 만기 시각 순서로 실행한다 */
  advance(ms: number): void;
  /** 절대 시각으로 이동한다. 과거로 가는 것도 허용한다(시계 점프 시험) */
  set(at: number): void;
}

/** 기본 시작값 2026-01-05T00:00:00Z */
export function manualClock(start: number = 1_767_571_200_000): ManualClock {
  let current = start;
  let nextHandle = 1;
  const timers = new Map<TimerHandle, { at: number; fn: () => void }>();
  return {
    now: () => current,
    setTimeout(fn: () => void, ms: number): TimerHandle {
      const handle = nextHandle;
      nextHandle += 1;
      timers.set(handle, { at: current + ms, fn });
      return handle;
    },
    clearTimeout(handle: TimerHandle): void {
      timers.delete(handle);
    },
    advance(ms: number): void {
      const target = current + ms;
      for (;;) {
        const due = [...timers.entries()]
          .filter(([, timer]) => timer.at <= target)
          .toSorted((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
        if (due === undefined) break;
        timers.delete(due[0]);
        current = Math.max(current, due[1].at);
        due[1].fn();
      }
      current = target;
    },
    set(at: number): void {
      current = at;
    },
  };
}

const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

function encode(value: number, length: number): string {
  let rest = value;
  let out = "";
  for (let i = 0; i < length; i += 1) {
    out = ALPHABET.charAt(rest % 32) + out;
    rest = Math.floor(rest / 32);
  }
  return out;
}

/** 같은 seed와 같은 호출 순서면 같은 ID를 낸다. 시계를 읽지 않아 D0이다 */
export function fixedIdFactory(seed: number = 1): IdFactory {
  let counter = 0;
  return {
    next<P extends IdPrefix>(prefix: P) {
      counter += 1;
      // ULID 첫 글자는 0-7이어야 한다. seed는 둘째~여섯째 글자, 순번은 나머지에 둔다
      const value = `${prefix}_0${encode(seed, 5)}${encode(counter, 20)}`;
      if (!isId(prefix, value)) throw new Bug(`fixedIdFactory made a bad id: ${value}`);
      return value;
    },
  };
}

/** 같은 시드는 같은 열을 낸다. [0, 1) 균등(mulberry32) */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
