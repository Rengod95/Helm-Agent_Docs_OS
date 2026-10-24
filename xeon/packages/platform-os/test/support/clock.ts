import type {
  Clock,
  LogFields,
  Logger,
  RandomSource,
  Scheduler,
  TimerHandle,
} from "@xeon/contracts";

// 테스트 대역. F에는 testing 서브패스를 두지 않고 쓰는 패키지의 test/ 안에 둔다(review.decisions-2 U-03).
// 시그니처는 eng.testing.guide TS-03을 따른다.

/** 2026-01-05T00:00:00Z */
export const DEFAULT_START = 1_767_571_200_000;

export interface ManualClock extends Clock, Scheduler {
  now(): number;
  setTimeout(fn: () => void, ms: number): TimerHandle;
  clearTimeout(handle: TimerHandle): void;
  /** ms만큼 진행하며 그 사이 만기 타이머를 만기 시각 순서로 실행한다. 같은 시각이면 등록 순서 */
  advance(ms: number): Promise<void>;
  /** 절대 시각으로 이동한다. 과거로 가는 것도 허용한다(시계 점프 시험) */
  set(at: number): Promise<void>;
  pendingTimers(): readonly { readonly at: number; readonly label?: string }[];
}

interface Pending {
  readonly at: number;
  readonly seq: number;
  readonly fn: () => void;
}

/** 음수, NaN은 0, 소수는 버린다. 운영 구현과 같은 규칙이어야 한다(L0.os.spec §3.4) */
function normalizeDelay(ms: number): number {
  if (Number.isNaN(ms) || ms <= 0) return 0;
  return Math.floor(ms);
}

export function manualClock(start: number = DEFAULT_START): ManualClock {
  let current = start;
  let nextHandle = 1;
  let nextSeq = 1;
  const timers = new Map<TimerHandle, Pending>();

  const dueBefore = (limit: number): [TimerHandle, Pending] | undefined => {
    let best: [TimerHandle, Pending] | undefined;
    for (const entry of timers) {
      if (entry[1].at > limit) continue;
      if (
        best === undefined ||
        entry[1].at < best[1].at ||
        (entry[1].at === best[1].at && entry[1].seq < best[1].seq)
      ) {
        best = entry;
      }
    }
    return best;
  };

  const runUntil = async (limit: number): Promise<void> => {
    const due = dueBefore(limit);
    if (due === undefined) {
      current = Math.max(current, limit);
      return;
    }
    const [handle, timer] = due;
    timers.delete(handle);
    current = Math.max(current, timer.at);
    timer.fn();
    // 비동기 콜백이 만든 후속 타이머가 같은 구간에 들어올 수 있게 마이크로태스크를 비운다
    await Promise.resolve();
    await runUntil(limit);
  };

  return {
    now: () => current,
    setTimeout(fn, ms) {
      const handle = nextHandle;
      nextHandle += 1;
      timers.set(handle, { at: current + normalizeDelay(ms), seq: nextSeq, fn });
      nextSeq += 1;
      return handle;
    },
    clearTimeout(handle) {
      timers.delete(handle);
    },
    advance: (ms) => runUntil(current + normalizeDelay(ms)),
    async set(at) {
      if (at >= current) {
        await runUntil(at);
        return;
      }
      current = at;
    },
    pendingTimers: () => [...timers.values()].map((t) => ({ at: t.at })),
  };
}

/** 같은 seed는 같은 열을 낸다. [0, 1) 균등(mulberry32) */
export function seededRandom(seed: number): RandomSource {
  let state = seed >>> 0;
  return (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

export interface MemoryLogger {
  readonly logger: Logger;
  readonly records: readonly {
    readonly level: string;
    readonly event: string;
    readonly fields: LogFields;
  }[];
}

/** 기록된 로그를 배열로 돌려주는 Logger */
export function memoryLogger(): MemoryLogger {
  const records: { level: string; event: string; fields: LogFields }[] = [];
  const make = (fixed: LogFields): Logger => {
    const write = (level: string) => (event: string, fields?: LogFields) => {
      records.push({ level, event, fields: { ...fixed, ...fields } });
    };
    return {
      debug: write("debug"),
      info: write("info"),
      warn: write("warn"),
      error: write("error"),
      child: (extra) => make({ ...fixed, ...extra }),
    };
  };
  return { logger: make({}), records };
}
