import { attemptAsync, parse, parseJson } from "@fresnel/contracts";
import { Type } from "typebox";

// X.operations.spec §9 7번 [결정: 2026-11-04 사용자 B5]. 여러 번의 시작에서 반복해 자동으로 꺼지는 확장은 사용자에게 계속 꺼 둘지 묻는다.
// 조용히 `ext.<name>.enabled=false`로 기록하지 않는다. 이 원장은 시작(프로세스)마다 한 번씩 자동 끄기를 세고, 기준 횟수에 닿으면 질문을 낸다.

/** 질문을 내는 자동 끄기 시작 횟수 기본값 [제안, 사용자 자동 승인] */
export const REPEAT_DISABLE_THRESHOLD = 3;

/** 원장을 담는 저장 포트. 읽기는 없으면 null이다. 쓰기는 통째로 바꾼다 */
export interface RepeatDisableBackend {
  read(): Promise<string | null>;
  write(text: string): Promise<void>;
}

const StateSchema = Type.Object({
  schemaVersion: Type.Literal(1),
  /** 확장 이름 → 자동으로 꺼진 시작 횟수 */
  starts: Type.Record(Type.String(), Type.Integer({ minimum: 1 })),
});

export interface RepeatDisableQuestion {
  readonly name: string;
  /** 자동으로 꺼진 시작 횟수 */
  readonly disabledStarts: number;
}

export interface RepeatDisableLedger {
  /** 저장본을 읽는다. 없거나 손상됐으면 빈 상태로 시작한다. 시작 때 한 번 부른다 */
  load(): Promise<void>;
  /** 이번 프로세스에서 확장이 자동으로 꺼졌다. 프로세스마다 이름당 한 번만 센다 */
  recordAutoDisable(name: string): void;
  /** 기준 횟수 이상 반복해 꺼졌으면 질문, 아니면 null */
  question(name: string): RepeatDisableQuestion | null;
  /** 사용자가 답했거나(켜 둔다) 확장을 제거했다. 횟수를 지운다 */
  clear(name: string): void;
  /** 쓰기가 모두 끝나기를 기다린다 */
  flush(): Promise<void>;
}

export interface RepeatDisableDeps {
  readonly backend: RepeatDisableBackend;
  readonly threshold?: number;
  readonly log?: (line: string) => void;
}

export function createRepeatDisableLedger(deps: RepeatDisableDeps): RepeatDisableLedger {
  const threshold = deps.threshold ?? REPEAT_DISABLE_THRESHOLD;
  const log = deps.log ?? (() => {});
  let starts: Record<string, number> = {};
  const counted = new Set<string>();
  let pending: Promise<void> = Promise.resolve();

  function persist(): void {
    const text = `${JSON.stringify({ schemaVersion: 1, starts }, null, 2)}\n`;
    pending = pending.then(async () => {
      const written = await attemptAsync(() => deps.backend.write(text));
      if (!written.ok) log("repeat-disable state not written");
      return undefined;
    });
  }

  return {
    async load() {
      const read = await attemptAsync(() => deps.backend.read());
      if (!read.ok || read.value === null) {
        if (!read.ok) log("repeat-disable state not readable");
        return;
      }
      const json = parseJson(read.value);
      const checked = json.ok ? parse(StateSchema, json.value) : undefined;
      if (checked?.ok === true) {
        starts = { ...checked.value.starts };
        return;
      }
      log("repeat-disable state corrupt, starting empty");
    },
    recordAutoDisable(name) {
      if (counted.has(name)) return;
      counted.add(name);
      starts = { ...starts, [name]: (starts[name] ?? 0) + 1 };
      persist();
    },
    question(name) {
      const count = starts[name] ?? 0;
      return count >= threshold ? { name, disabledStarts: count } : null;
    },
    clear(name) {
      counted.delete(name);
      if (starts[name] === undefined) return;
      starts = Object.fromEntries(Object.entries(starts).filter(([key]) => key !== name));
      persist();
    },
    flush: () => pending,
  };
}
