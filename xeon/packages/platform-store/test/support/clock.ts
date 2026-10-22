import type { Clock, RandomSource, Scheduler, TimerHandle } from "@xeon/contracts";
import type { IdByPrefix, IdFactory, IdPrefix } from "@xeon/contracts/conversation";

/** 운영 코드가 받는 Clock과 Scheduler를 한 객체로 구현한다(eng.testing.guide TS-03) */
export interface ManualClock extends Clock, Scheduler {
  now(): number;
  setTimeout(fn: () => void, ms: number): TimerHandle;
  clearTimeout(handle: TimerHandle): void;
  /** ms만큼 진행하며 그 사이 만기 타이머를 만기 시각 순서로 실행한다. 같은 시각이면 등록 순서 */
  advance(ms: number): Promise<void>;
  /** 절대 시각으로 이동한다. 과거로 가는 것도 허용한다 */
  set(at: number): Promise<void>;
  pendingTimers(): readonly { readonly at: number; readonly label?: string }[];
}

interface Timer {
  readonly handle: TimerHandle;
  readonly at: number;
  readonly order: number;
  readonly fn: () => void;
}

const DEFAULT_START = 1_767_571_200_000;

export function manualClock(start: number = DEFAULT_START): ManualClock {
  let current = start;
  let nextHandle = 1;
  let nextOrder = 0;
  const timers = new Map<TimerHandle, Timer>();

  const runDue = async (until: number): Promise<void> => {
    const due = [...timers.values()]
      .filter((timer) => timer.at <= until)
      .toSorted((a, b) => a.at - b.at || a.order - b.order)[0];
    if (due === undefined) return;
    timers.delete(due.handle);
    current = Math.max(current, due.at);
    due.fn();
    await Promise.resolve();
    await runDue(until);
  };

  return {
    now: (): number => current,
    setTimeout(fn: () => void, ms: number): TimerHandle {
      const handle = nextHandle;
      nextHandle += 1;
      nextOrder += 1;
      timers.set(handle, { handle, at: current + ms, order: nextOrder, fn });
      return handle;
    },
    clearTimeout(handle: TimerHandle): void {
      timers.delete(handle);
    },
    async advance(ms: number): Promise<void> {
      const target = current + ms;
      await runDue(target);
      current = target;
    },
    async set(at: number): Promise<void> {
      if (at >= current) {
        await runDue(at);
      }
      current = at;
    },
    pendingTimers(): readonly { readonly at: number }[] {
      return [...timers.values()]
        .toSorted((a, b) => a.at - b.at)
        .map((timer) => ({ at: timer.at }));
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

/** 시각 10자 + 시드·번호 16자의 유효한 ULID를 만든다. 같은 시드와 시계에서 같은 열을 낸다 */
export function fixedIdFactory(clock: Pick<Clock, "now">, seed: string = "seed"): IdFactory {
  let counter = 0;
  let seedValue = 0;
  for (const ch of seed) seedValue = (seedValue * 31 + ch.charCodeAt(0)) % 1_000_000_007;
  return {
    next<P extends IdPrefix>(prefix: P): IdByPrefix[P] {
      counter += 1;
      const ulid = `${encode(clock.now(), 10)}${encode(seedValue, 8)}${encode(counter, 8)}`;
      // oxlint-disable-next-line typescript/consistent-type-assertions, typescript/no-unsafe-type-assertion -- 허용 목록 A2 브랜드 생성: 테스트 대역 fixedIdFactory (eng.typescript.guide TY-06)
      return `${prefix}_${ulid}` as IdByPrefix[P];
    },
  };
}

/** 같은 시드는 같은 열을 낸다. [0, 1) 균등 */
export function seededRandom(seed: number): RandomSource {
  let state = seed >>> 0;
  return (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
